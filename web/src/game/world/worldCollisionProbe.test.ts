import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { getMapGroundHeight, getMapGroundHeights, getMapOrigin } from './mapCoordinates'
import { createWorldSession } from './worldSession'
import { createOpeningJourneyAgent } from '../simulation/openingJourneyAgent'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('world collision probe', () => {
  probe('reports Bourg Geon ground support, terrain attributes, and immediate move decisions', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    expect(map).toBeDefined()
    if (!map) return

    const session = createWorldSession(inventory.resolvedMapCatalog.maps)
    session.loadMap(60, 11, 17, 'south')

    const cells = [] as Array<{ tileX: number, tileZ: number, attribute?: number, height?: number }>
    for (let z = 15; z <= 19; z += 1) {
      for (let x = 9; x <= 13; x += 1) {
        const attribute = map.terrain && x >= 0 && z >= 0 && x < map.terrain.width && z < map.terrain.height
          ? map.terrain.attributes[z * map.terrain.width + x]
          : undefined
        cells.push({
          tileX: x,
          tileZ: z,
          attribute,
          height: getMapGroundHeight(map, x, z),
        })
      }
    }

    const summarizeMove = (result: ReturnType<typeof session.tryMove>) => {
      if (!result) return null
      if (result.kind === 'blocked') {
        return {
          kind: result.kind,
          reason: result.reason,
          tileX: result.tileX,
          tileZ: result.tileZ,
          attribute: result.attribute,
        }
      }
      return {
        kind: result.kind,
        tileX: result.state.tileX,
        tileZ: result.state.tileZ,
        mapId: result.state.map.id,
        groundHeight: result.state.groundHeight,
        warp: result.warp ? { header: result.warp.header, anchor: result.warp.anchor } : undefined,
        coordinate: result.coordinate ? { scriptId: result.coordinate.scriptId } : undefined,
      }
    }

    const moves = {
      north: summarizeMove(session.tryMove(0, -1, 'north')),
      south: summarizeMove(session.tryMove(0, 1, 'south')),
      west: summarizeMove(session.tryMove(-1, 0, 'west')),
      east: summarizeMove(session.tryMove(1, 0, 'east')),
    }

    const probeMove = (tileX: number, tileZ: number, deltaX: number, deltaZ: number, direction: 'north' | 'south' | 'west' | 'east') => {
      const isolatedSession = createWorldSession(inventory.resolvedMapCatalog.maps)
      isolatedSession.loadMap(60, tileX, tileZ, direction)
      return summarizeMove(isolatedSession.tryMove(deltaX, deltaZ, direction))
    }

    const targetedMoves = {
      intoAttribute1024: probeMove(11, 17, 1, 0, 'east'),
      intoBlocked8000: probeMove(11, 16, 0, -1, 'north'),
      intoTallSurface: probeMove(9, 18, 0, 1, 'south'),
    }

    const sampledLayers = {
      at9x19: getMapGroundHeights(map, 9, 19) ?? [],
      at10x19: getMapGroundHeights(map, 10, 19) ?? [],
      at12x17: getMapGroundHeights(map, 12, 17) ?? [],
    }

    console.log(JSON.stringify({ cells, moves, targetedMoves, sampledLayers }, null, 2))
    expect(targetedMoves.intoAttribute1024).toMatchObject({ kind: 'moved', tileX: 12, tileZ: 17, mapId: 60 })
    expect(targetedMoves.intoBlocked8000).toMatchObject({ kind: 'blocked', tileX: 11, tileZ: 15 })
    expect(targetedMoves.intoTallSurface).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 9, tileZ: 19, attribute: 32768 })
  }, 30000)

  probe('reports Salon terrain attributes and immediate move decisions from the entrance anchor', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 63)
    expect(map).toBeDefined()
    if (!map) return

    const spawn = map.events?.warps.find((warp) => warp.header === 64) ?? map.events?.warps[0]
    expect(spawn).toBeDefined()
    if (!spawn) return

    const session = createWorldSession(inventory.resolvedMapCatalog.maps)
    session.loadMap(63, spawn.x, spawn.z, 'west')

    const cells = [] as Array<{ tileX: number, tileZ: number, attribute?: number }>
    for (let z = Math.max(0, spawn.z - 2); z <= spawn.z + 2; z += 1) {
      for (let x = Math.max(0, spawn.x - 2); x <= spawn.x + 2; x += 1) {
        const attribute = map.terrain && x < map.terrain.width && z < map.terrain.height
          ? map.terrain.attributes[z * map.terrain.width + x]
          : undefined
        cells.push({ tileX: x, tileZ: z, attribute })
      }
    }

    const summarizeMove = (result: ReturnType<typeof session.tryMove>) => {
      if (!result) return null
      if (result.kind === 'blocked') {
        return {
          kind: result.kind,
          reason: result.reason,
          tileX: result.tileX,
          tileZ: result.tileZ,
          attribute: result.attribute,
        }
      }
      return {
        kind: result.kind,
        tileX: result.state.tileX,
        tileZ: result.state.tileZ,
        mapId: result.state.map.id,
      }
    }

    const moves = {
      north: summarizeMove(session.tryMove(0, -1, 'north')),
      south: summarizeMove(session.tryMove(0, 1, 'south')),
      west: summarizeMove(session.tryMove(-1, 0, 'west')),
      east: summarizeMove(session.tryMove(1, 0, 'east')),
    }

    console.log(JSON.stringify({ spawn: { tileX: spawn.x, tileZ: spawn.z }, cells, moves }, null, 2))
    expect(cells.length).toBeGreaterThan(0)
    expect(moves.north).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 3, tileZ: 2, attribute: 32768 })
    expect(moves.south).toMatchObject({ kind: 'moved', tileX: 3, tileZ: 4, mapId: 63 })
    expect(moves.west).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 2, tileZ: 4, attribute: 32768 })
    expect(moves.east).toMatchObject({ kind: 'moved', tileX: 4, tileZ: 4, mapId: 63 })
  }, 30000)

  probe('reports the Bourg Geon house-exit anchor and its four player moves', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const town = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 60)
    const home = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.id === 63)
    expect(town).toBeDefined()
    expect(home).toBeDefined()
    if (!town || !home) return

    const exit = town.events?.warps.find((warp) => warp.header === 63)
    expect(exit).toBeDefined()
    if (!exit) return
    const origin = getMapOrigin(town)
    const tileX = exit.x - origin.x
    const tileZ = exit.z - origin.z
    const terrainAttributeAt = (x: number, z: number): number | undefined => town.terrain
      && x >= 0 && z >= 0 && x < town.terrain.width && z < town.terrain.height
      ? town.terrain.attributes[z * town.terrain.width + x]
      : undefined
    const doorwayBehaviors = {
      homeExit: terrainAttributeAt(tileX, tileZ),
      elmLab: terrainAttributeAt(684 - origin.x, 393 - origin.z),
    }
    const townWarps = (town.events?.warps ?? []).map((warp, index) => ({
      index,
      worldX: warp.x,
      worldZ: warp.z,
      localX: warp.x - origin.x,
      localZ: warp.z - origin.z,
      attribute: terrainAttributeAt(warp.x - origin.x, warp.z - origin.z),
      header: warp.header,
      anchor: warp.anchor,
    }))
    const doorTiles = town.terrain
      ? Array.from(town.terrain.attributes.entries())
        .filter(([, attribute]) => (attribute & 0xff) === 105)
        .map(([index, attribute]) => ({ x: index % town.terrain!.width, z: Math.floor(index / town.terrain!.width), attribute }))
      : []
    const summarizeMove = (deltaX: number, deltaZ: number, direction: 'north' | 'south' | 'west' | 'east') => {
      const session = createWorldSession(inventory.resolvedMapCatalog.maps)
      session.loadMap(60, tileX, tileZ, direction)
      const result = session.tryMove(deltaX, deltaZ, direction)
      return result?.kind === 'blocked'
        ? { kind: result.kind, reason: result.reason, tileX: result.tileX, tileZ: result.tileZ, attribute: result.attribute }
        : result && { kind: result.kind, tileX: result.state.tileX, tileZ: result.state.tileZ, warp: result.warp }
    }
    const moves = {
      north: summarizeMove(0, -1, 'north'),
      south: summarizeMove(0, 1, 'south'),
      west: summarizeMove(-1, 0, 'west'),
      east: summarizeMove(1, 0, 'east'),
    }
    const transitionSession = createWorldSession(inventory.resolvedMapCatalog.maps)
    transitionSession.loadMap(63, 3, 10, 'east')
    const transition = transitionSession.transitionTo(60, 1)
    const transitionSummary = transition.kind === 'transitioned'
      ? { kind: transition.kind, mapId: transition.state.map.id, tileX: transition.state.tileX, tileZ: transition.state.tileZ, direction: transition.state.direction }
      : transition
    const outdoorTileZ = tileZ + 1
    const fieldState = createFieldScriptState('male')
    const firstInputAgent = createOpeningJourneyAgent(inventory.resolvedMapCatalog.maps)
    // Les deux premières étapes sont chambre → salon puis salon → extérieur.
    firstInputAgent.nextInput({ mapId: 64, tileX: 3, tileZ: 4, direction: 'south' }, fieldState)
    firstInputAgent.nextInput({ mapId: 63, tileX: 3, tileZ: 10, direction: 'west' }, fieldState)
    const firstOutdoorInput = firstInputAgent.nextInput({ mapId: 60, tileX, tileZ: outdoorTileZ, direction: 'south' }, fieldState)
    const agent = createOpeningJourneyAgent(inventory.resolvedMapCatalog.maps)
    agent.nextInput({ mapId: 64, tileX: 3, tileZ: 4, direction: 'south' }, fieldState)
    agent.nextInput({ mapId: 63, tileX: 3, tileZ: 10, direction: 'west' }, fieldState)
    const labRoute = createWorldSession(inventory.resolvedMapCatalog.maps)
    labRoute.loadMap(60, tileX, outdoorTileZ, 'south')
    let labWarp: { input: string, target?: unknown, coordinate?: unknown } | undefined
    const movementByInput = {
      up: { deltaX: 0, deltaZ: -1, direction: 'north' as const },
      down: { deltaX: 0, deltaZ: 1, direction: 'south' as const },
      left: { deltaX: -1, deltaZ: 0, direction: 'west' as const },
      right: { deltaX: 1, deltaZ: 0, direction: 'east' as const },
    }
    for (let step = 0; step < 128; step += 1) {
      const state = labRoute.getState()
      expect(state).toBeDefined()
      if (!state) break
      const input = agent.nextInput({ mapId: state.map.id, tileX: state.tileX, tileZ: state.tileZ, direction: state.direction }, fieldState)
      expect(input).not.toBe('confirm')
      if (!input || input === 'confirm') break
      const movement = movementByInput[input]
      expect(movement).toBeDefined()
      const result = labRoute.tryMove(movement.deltaX, movement.deltaZ, movement.direction)
      expect(result).toMatchObject({ kind: 'moved' })
      if (result && result.kind === 'moved' && result.warp) {
        labWarp = { input, target: result.warp, coordinate: result.coordinate }
        break
      }
    }
    console.log(JSON.stringify({ exit, localSpawn: { tileX, tileZ }, doorwayBehaviors, townWarps, doorTiles, moves, transition: transitionSummary, firstOutdoorInput, labWarp }, null, 2))

    expect(moves.north).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX, tileZ: tileZ - 1 })
    expect(moves.west).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: tileX - 1, tileZ })
    expect(moves.east).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: tileX + 1, tileZ })
    expect(moves.south).toMatchObject({ kind: 'moved', tileX, tileZ: tileZ + 1 })
    expect(transition).toMatchObject({ kind: 'transitioned', state: { map: { id: 60 }, tileX, tileZ: outdoorTileZ } })
    // En mode audit automatique uniquement, la route vers le laboratoire part
    // bien vers l'ouest depuis la case extérieure finale.
    expect(firstOutdoorInput).toBe('left')
    expect(labWarp).toMatchObject({ input: 'up', target: { kind: 'warp', header: 61 }, coordinate: undefined })
  }, 30000)
})
