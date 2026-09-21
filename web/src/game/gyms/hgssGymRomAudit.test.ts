import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createFieldScriptMapInitSequenceRunner, createFieldScriptState, setFieldScriptMapState } from '../scripts/fieldScriptRunner'
import { readNarcMembers } from '../../rom/narc'
import { parseNitroFileNames } from '../../rom/nitrofs'
import { composeNitroModelAnimationFrames } from '../../rom/model/nitroModelFrameComposition'
import { resolveHgssGymPropPresentations } from './hgssGymPropAnimations'
import { hgssAllGymMapIds, hgssGymMapCatalog } from './hgssGymMapCatalog'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romAudit = process.env.RUN_GYM_AUDIT === '1' && existsSync(romPath) ? it : it.skip

describe('HGSS gym ROM inventory', () => {
  romAudit('keeps every physical gym room backed by decoded scripts, geometry and animated ROM props', async () => {
    const buffer = await readFile(romPath)
    const rom = new Uint8Array(buffer)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const header = new DataView(rom.buffer, rom.byteOffset, rom.byteLength)
    const fntOffset = header.getUint32(0x40, true)
    const fntSize = header.getUint32(0x44, true)
    const fatOffset = header.getUint32(0x48, true)
    const fatSize = header.getUint32(0x4c, true)
    const fnt = rom.subarray(fntOffset, fntOffset + fntSize)
    const names = parseNitroFileNames(fnt, new DataView(fnt.buffer, fnt.byteOffset, fnt.byteLength).getUint16(6, true), fatSize / 8)
    const archiveId = [...names].find(([, path]) => path === '/a/1/0/6')?.[0]
    if (archiveId === undefined) throw new Error("L’archive ROM d’animations de décor est absente.")
    const fat = new DataView(rom.buffer, rom.byteOffset + fatOffset, fatSize)
    const archiveOffset = fat.getUint32(archiveId * 8, true)
    const archiveEnd = fat.getUint32(archiveId * 8 + 4, true)
    const animationMembers = readNarcMembers(rom, archiveOffset, archiveEnd - archiveOffset)
    const maps = new Map(inventory.resolvedMapCatalog.maps.map((map) => [map.id, map]))
    const report = hgssAllGymMapIds.map((mapId) => {
      const map = maps.get(mapId)
      if (!map) throw new Error(`La carte ROM d’arène ${mapId} est absente.`)
      const props = (map.model?.mapProps ?? []).map((prop) => {
        const base = inventory.mapPropModelResolver?.(prop.modelId, map.header.areaDataBank, 'room')
        const metadata = inventory.mapPropAnimationMetadataResolver?.(prop.modelId, 'room')
        return {
          modelId: prop.modelId,
          decoded: Boolean(base?.surfaces?.length),
          animations: (metadata?.animationArchiveIds ?? []).map((archiveId) => ({
            archiveId,
            kind: String.fromCharCode(...rom.subarray(animationMembers[archiveId]!.offset, animationMembers[archiveId]!.offset + 3)),
            decoded: inventory.mapPropAnimationResolver?.(
              prop.modelId,
              map.header.areaDataBank,
              archiveId,
              'room',
            ),
          })),
        }
      })
      return {
        mapId,
        label: map.label,
        scripts: map.fieldScripts.entryOffsets.length,
        initScripts: map.initScripts.length,
        objects: map.events?.objects.length ?? 0,
        coordinates: map.events?.coordinateEvents.length ?? 0,
        backgrounds: map.events?.backgrounds.length ?? 0,
        warps: map.events?.warps.length ?? 0,
        terrain: Boolean(map.terrain),
        model: Boolean(map.model),
        props,
      }
    })

    expect(hgssGymMapCatalog).toHaveLength(16)
    expect(report).toHaveLength(18)
    expect(report.filter(({ terrain, model }) => !terrain || !model)).toEqual([])
    expect(report.filter(({ scripts }) => scripts === 0)).toEqual([])
    expect(report.flatMap(({ mapId, props }) => props.filter(({ decoded }) => !decoded).map(({ modelId }) => ({ mapId, modelId })))).toEqual([])
    expect([396, 397].map((mapId) => maps.get(mapId)?.initScripts.length)).toEqual([0, 0])
    const blackthorn = maps.get(141)!
    expect([120, 121, 120].map((modelId) => inventory.mapPropModelResolver?.(modelId, blackthorn.header.areaDataBank, 'room')).every(Boolean)).toBe(true)
    const cianwood = maps.get(139)!
    const cianwoodWinch = inventory.mapPropModelResolver?.(173, cianwood.header.areaDataBank, 'room')
    const cianwoodTracks = inventory.mapPropAnimationMetadataResolver?.(174, 'room')?.animationArchiveIds.map((archiveId) => inventory.mapPropAnimationResolver?.(173, cianwood.header.areaDataBank, archiveId, 'room')?.frames)
    const decodedCianwoodTracks = cianwoodTracks?.filter((track): track is NonNullable<typeof track> => Boolean(track)) ?? []
    expect(cianwoodWinch && decodedCianwoodTracks.length === cianwoodTracks?.length ? composeNitroModelAnimationFrames(cianwoodWinch, decodedCianwoodTracks) : []).toHaveLength(120)
    const vermilion = maps.get(365)!
    expect([199, 200].map((modelId) => resolveHgssGymPropPresentations(vermilion, [{ targetModelId: modelId, animationModelId: modelId }], true, inventory.mapPropModelResolver, inventory.mapPropAnimationResolver, inventory.mapPropAnimationMetadataResolver)[0]?.frames?.length)).toEqual([120, 120])
    expect(Array.from({ length: 12 }, (_, model) => inventory.gymOverlayModelResolver?.('/a/2/4/6', model)).every(Boolean)).toBe(true)
    expect(Array.from({ length: 12 }, (_, model) => Array.from({ length: 4 }, (_, track) => inventory.gymOverlayAnimationResolver?.('/a/2/4/6', model, 12 + track * 12 + model))).flat().filter(Boolean)).toHaveLength(48)
    expect(Array.from({ length: 12 }, (_, modelId) => { const model = inventory.gymOverlayModelResolver?.('/a/2/4/6', modelId); const tracks = Array.from({ length: 4 }, (_, track) => inventory.gymOverlayAnimationResolver?.('/a/2/4/6', modelId, 12 + track * 12 + modelId)?.frames).filter((frames): frames is NonNullable<typeof frames> => Boolean(frames)); return model && tracks.length === 4 ? composeNitroModelAnimationFrames(model, tracks).length : 0 }).every(Boolean)).toBe(true)
    expect(Array.from({ length: 4 }, (_, index) => inventory.gymOverlayAnimationResolver?.('/a/2/5/5', 4 + index, index)).filter(Boolean)).toHaveLength(4)
    expect(inventory.mapPropModelResolver?.(111, maps.get(135)!.header.areaDataBank, 'room')).toBeTruthy()
    const ecruteakCandle = inventory.mapPropModelResolver?.(128, maps.get(80)!.header.areaDataBank, 'room')
    expect(maps.get(80)?.model?.surfaces?.every(({ fogEnabled }) => fogEnabled)).toBe(true)
    expect(ecruteakCandle?.surfaces?.map(({ materialName, fogEnabled }) => ({ materialName, fogEnabled }))).toEqual([{ materialName: 'dun_spot', fogEnabled: false }])
    expect(inventory.eventTextureResolver?.(250)).toBeTruthy()
    expect(maps.get(365)?.events?.objects.filter(({ id }) => id <= 5).map(({ id, x, z, spriteId, movement }) => ({ id, x, z, spriteId, movement }))).toEqual([
      { id: 0, x: 5, z: 8, spriteId: 349, movement: 0 }, { id: 1, x: 6, z: 8, spriteId: 349, movement: 0 }, { id: 2, x: 7, z: 8, spriteId: 349, movement: 0 },
      { id: 3, x: 5, z: 10, spriteId: 349, movement: 0 }, { id: 4, x: 6, z: 10, spriteId: 349, movement: 0 }, { id: 5, x: 7, z: 10, spriteId: 349, movement: 0 },
    ])
    const animations = report.flatMap(({ props }) => props.flatMap(({ animations }) => animations))
    expect(animations.filter(({ decoded }) => !decoded?.frames.length).map(({ archiveId, kind }) => ({ archiveId, kind }))).toEqual([])
    const dynamicMaterialAnimations = animations.filter(({ kind }) => kind === 'BTA' || kind === 'BMA').filter(({ decoded }) => (
      new Set(decoded?.frames.map((frame) => JSON.stringify(frame.surfaces?.map((surface) => ({
        color: surface.materialColor,
        alpha: surface.materialAlpha,
        uvs: surface.uvs ? Array.from(surface.uvs) : undefined,
      })))) ?? []).size > 1
    ))
    expect(dynamicMaterialAnimations.length).toBeGreaterThan(0)
  }, 120000)

  romAudit('discovers native Gymmick initializers from decoded map sequences', async () => {
    const buffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([buffer], basename(romPath)))
    const mechanisms: Array<{ mapId: number, label: string, gymType: number, action: string }> = []
    for (const map of inventory.resolvedMapCatalog.maps) {
      const state = createFieldScriptState('male', 'AUDIT', {
        pokemonRuntime: {
          catalog: inventory.pokemonCatalog,
          itemCatalog: inventory.itemCatalog,
          rng: createHgssLcrng(0),
          trainer: { id: 1, name: 'AUDIT', gender: 'male' },
          language: 3,
          gameVersion: 7,
          now: () => new Date(2026, 0, 1),
        },
      })
      setFieldScriptMapState(state, map, 0, 0, 'south')
      const runner = createFieldScriptMapInitSequenceRunner(map, state, 'transition')
      if (!runner) continue
      try {
        for (let index = 0; index < 64; index += 1) {
          const step = runner.resume()
          if (step.kind === 'gymMechanism') mechanisms.push({ mapId: map.id, label: map.label, gymType: step.gymType, action: step.action })
          if (step.kind === 'ended' || step.kind === 'choice' || step.kind === 'battle') break
        }
      } catch { /* Les autres applications d’initialisation sont hors de cet inventaire. */ }
    }
    expect(mechanisms).toEqual([
      { mapId: 80, label: 'Rosalia', gymType: 1, action: 'init' },
      { mapId: 135, label: 'Mauville', gymType: 4, action: 'init' },
      { mapId: 139, label: 'Irisia', gymType: 2, action: 'init' },
      { mapId: 141, label: 'Ebènelle', gymType: 6, action: 'init' },
      { mapId: 180, label: 'Ecorcia', gymType: 5, action: 'init' },
      { mapId: 365, label: 'Carmin sur Mer', gymType: 3, action: 'init' },
      { mapId: 480, label: 'Parmanie', gymType: 7, action: 'init' },
      { mapId: 496, label: 'Jadielle', gymType: 8, action: 'init' },
    ])
  }, 120000)
})
