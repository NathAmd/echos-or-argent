import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { isSurfableMetatile } from '../player/hgssPlayerMovement'
import { getMapGroundHeights, getMapOrigin, getMapTileBounds } from './mapCoordinates'
import { createWorldSession } from './worldSession'

const defaultRomPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romPath = process.env.ROM_AUDIT_PATH ? resolve(process.env.ROM_AUDIT_PATH) : defaultRomPath
const probe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Route 48 native terrain', () => {
  probe('keeps the ROM bridge, water and height layers distinguishable', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const map = inventory.resolvedMapCatalog.maps.find((candidate) => candidate.label === 'Route 48')
    expect(map).toBeDefined()
    if (!map?.terrain) return

    const layeredTiles: Array<{ x: number, z: number, attribute: number, heights: readonly number[] }> = []
    const surfTiles: Array<{ x: number, z: number, attribute: number, heights: readonly number[] }> = []
    const bridgeTiles: Array<{ x: number, z: number, attribute: number, heights: readonly number[] }> = []
    const behaviorCounts = new Map<number, number>()
    for (let z = 0; z < map.terrain.height; z += 1) {
      for (let x = 0; x < map.terrain.width; x += 1) {
        const attribute = map.terrain.attributes[z * map.terrain.width + x]!
        const behavior = attribute & 0xff
        behaviorCounts.set(behavior, (behaviorCounts.get(behavior) ?? 0) + 1)
        const heights = getMapGroundHeights(map, x, z) ?? []
        if (heights.length > 1) layeredTiles.push({ x, z, attribute, heights })
        if (isSurfableMetatile(attribute)) surfTiles.push({ x, z, attribute, heights })
        if (behavior >= 112 && behavior <= 115) bridgeTiles.push({ x, z, attribute, heights })
      }
    }
    const layeredSurfCatalog: Array<{ id: number, label: string, count: number, blocked: number, behaviors: number[], samples: string[] }> = []
    for (const candidate of inventory.resolvedMapCatalog.maps) {
      if (!candidate.terrain) continue
      let count = 0
      let blocked = 0
      const behaviors = new Set<number>()
      const samples: string[] = []
      for (let index = 0; index < candidate.terrain.attributes.length; index += 1) {
        const attribute = candidate.terrain.attributes[index]!
        if (!isSurfableMetatile(attribute)) continue
        const x = index % candidate.terrain.width
        const z = Math.floor(index / candidate.terrain.width)
        const heights = getMapGroundHeights(candidate, x, z) ?? []
        if (heights.length < 2) continue
        count += 1
        if ((attribute & 0x8000) !== 0) blocked += 1
        behaviors.add(attribute & 0xff)
        if (samples.length < 4) samples.push(`${x},${z}:${heights.join('/')}`)
      }
      if (count > 0) layeredSurfCatalog.push({ id: candidate.id, label: candidate.label, count, blocked, behaviors: [...behaviors].sort((a, b) => a - b), samples })
    }
    const olivine = inventory.resolvedMapCatalog.maps.find(({ id }) => id === 77)
    const olivineLayerNeighborhood = olivine?.terrain
      ? Array.from({ length: 3 }, (_, offsetZ) => Array.from({ length: 4 }, (_, offsetX) => {
          const x = 24 + offsetX
          const z = 51 + offsetZ
          const attribute = olivine.terrain!.attributes[z * olivine.terrain!.width + x]!
          return `${x},${z}:${attribute & 0xff}:${(getMapGroundHeights(olivine, x, z) ?? []).join('/')}`
        }))
      : []

    console.log(JSON.stringify({
      id: map.id,
      matrix: {
        index: map.matrix.matrixIndex,
        width: map.matrix.width,
        height: map.matrix.height,
        hasHeaders: map.matrix.hasHeaders,
        origin: getMapOrigin(map),
        bounds: getMapTileBounds(map),
      },
      terrain: {
        width: map.terrain.width,
        height: map.terrain.height,
        collisionPlates: map.terrain.collisionPlates?.length ?? 0,
      },
      behaviors: [...behaviorCounts].sort(([left], [right]) => left - right),
      layeredTiles: layeredTiles.map(({ x, z, heights }) => `${x},${z}:${heights.join('/')}`),
      bridgeTileCount: bridgeTiles.length,
      surfTiles: {
        count: surfTiles.length,
        layered: surfTiles.filter((tile) => tile.heights.length > 1).length,
      },
      propModelIds: map.model?.mapProps?.map(({ modelId }) => modelId),
      bridgeSurfaceNames: [...new Set(map.model?.surfaces
        ?.filter((surface) => /bridge|slope|river|sea/.test(`${surface.materialName ?? ''} ${surface.textureName ?? ''}`))
        .map((surface) => `${surface.materialName ?? ''}/${surface.textureName ?? ''}`))],
      layeredSurfCatalog,
      olivineLayerNeighborhood,
    }, null, 2))

    expect(map.id).toBe(152)
    expect(surfTiles.length).toBeGreaterThan(0)
    expect(layeredTiles).toHaveLength(27)
    expect(layeredTiles.every(({ attribute, heights }) => attribute === 115 && heights[0] === 10.5 && heights[1] === 13)).toBe(true)
    expect(bridgeTiles.filter(({ attribute }) => (attribute & 0xff) === 115).every(({ attribute }) => (attribute & 0x8000) === 0)).toBe(true)
    expect(layeredSurfCatalog.every(({ blocked }) => blocked === 0)).toBe(true)
    expect(layeredSurfCatalog.reduce((total, entry) => total + entry.count, 0)).toBe(244)
    expect([...new Set(layeredSurfCatalog.flatMap(({ behaviors }) => behaviors))].sort((a, b) => a - b)).toEqual([21, 115])

    const olivineBridge = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(olivineBridge.loadMap(77, 25, 52, 'east', 'walking')).toMatchObject({ groundHeight: 2 })
    expect(olivineBridge.isFacingSurfableSurface()).toBe(false)
    expect(olivineBridge.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved', state: { tileX: 26, tileZ: 52, groundHeight: 2, locomotion: 'walking' },
    })
    olivineBridge.setDirection('north')
    expect(olivineBridge.isFacingSurfableSurface()).toBe(false)

    const olivineWater = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(olivineWater.loadMap(77, 26, 52, 'north', 'surfing')).toMatchObject({ groundHeight: 0.5 })
    expect(olivineWater.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved', movement: 'surf', state: { tileX: 26, tileZ: 51, groundHeight: 0.5, locomotion: 'surfing' },
    })

    const bridgeWalk = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(bridgeWalk.loadMap(152, 23, 4, 'south', 'walking')).toMatchObject({ groundHeight: 13 })
    for (let z = 5; z <= 14; z += 1) {
      expect(bridgeWalk.tryMove(0, 1, 'south'), `pont vertical z=${z}`).toMatchObject({
        kind: 'moved', state: { tileX: 23, tileZ: z, groundHeight: 13, locomotion: 'walking' },
      })
      expect(bridgeWalk.isFacingSurfableSurface(), `Surf vertical z=${z}`).toBe(false)
    }

    const bridgeTop = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(bridgeTop.loadMap(152, 23, 8, 'west', 'walking')).toMatchObject({ groundHeight: 13 })
    expect(bridgeTop.isFacingSurfableSurface()).toBe(false)

    const westToEast = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(westToEast.loadMap(152, 26, 18, 'east', 'walking')).toMatchObject({ groundHeight: 13 })
    for (let x = 27; x <= 38; x += 1) {
      expect(westToEast.tryMove(1, 0, 'east'), `pont horizontal ouest-est x=${x}`).toMatchObject({
        kind: 'moved', state: { tileX: x, tileZ: 18, groundHeight: 13, locomotion: 'walking' },
      })
      expect(westToEast.isFacingSurfableSurface(), `Surf horizontal ouest-est x=${x}`).toBe(false)
    }
    const eastToWest = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(eastToWest.loadMap(152, 38, 18, 'west', 'walking')).toMatchObject({ groundHeight: 13 })
    for (let x = 37; x >= 26; x -= 1) {
      expect(eastToWest.tryMove(-1, 0, 'west'), `pont horizontal est-ouest x=${x}`).toMatchObject({
        kind: 'moved', state: { tileX: x, tileZ: 18, groundHeight: 13, locomotion: 'walking' },
      })
    }

    const bridgeWater = createWorldSession(inventory.resolvedMapCatalog.maps)
    expect(bridgeWater.loadMap(152, 30, 18, 'east', 'surfing')).toMatchObject({ groundHeight: 10.5 })
    for (let x = 31; x <= 34; x += 1) expect(bridgeWater.tryMove(1, 0, 'east'), `eau sous le pont x=${x}`).toMatchObject({
      kind: 'moved', movement: 'surf', state: { tileX: x, tileZ: 18, groundHeight: 10.5, locomotion: 'surfing' },
    })
  }, 30000)
})
