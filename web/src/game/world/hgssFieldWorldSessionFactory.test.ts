import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview, PlayerGender, RomInventory } from '../../ndsTypes'
import type { MapPropAnimationMetadata } from '../../rom/model/mapPropAnimationMetadata'
import { blackthornMagmaMetatileBehavior } from '../gyms/blackthornGymMechanism'
import {
  createFieldScriptState,
  type FieldPokemonRuntime,
  type FieldScriptState,
} from '../scripts/fieldScriptRunner'
import { createDynamicWorldActorRegistry, type RemotePlayerWorldActor } from './dynamicWorldActorRegistry'
import {
  createHgssActiveGymWorldResolvers,
  createHgssFieldWorldSession,
  type HgssFieldWorldSessionInventory,
} from './hgssFieldWorldSessionFactory'
import { hgssRocketHideoutClearedFlag } from './hgssWeeklyWorld'
import {
  baseWorldSessionExtensionPorts,
  hgssDynamicWarpSentinelAnchor,
  hgssDynamicWarpSentinelMapId,
} from './worldSession'

const mapPropMetadata = (classId: number, animationArchiveIds: number[]): MapPropAnimationMetadata => ({
  hasAnimations: true,
  flags: 3,
  isBicycleSlope: false,
  controlValue: classId,
  classId,
  animationArchiveIds,
})

function createMap(id: number, width = 8, height = 8, events?: MapEventPreview): OpeningMapPreview {
  return {
    id,
    label: `Map ${id}`,
    header: {
      mapId: id,
      wildEncounterBank: 255,
      areaDataBank: 0,
      moveModelBank: 0,
      worldMapX: 0,
      worldMapY: 0,
      matrixId: id,
      scriptsBank: 0,
      scriptHeaderBank: 0,
      msgBank: 0,
      dayMusicId: 0,
      nightMusicId: 0,
      eventsBank: 0,
      mapSection: 0,
      areaIcon: 0,
      momCallIntroParam: 0,
      region: 0,
      weather: 0,
      mapType: 0,
      cameraType: 0,
      followMode: 0,
      battleBackground: 0,
      bikeAllowed: false,
      runningAllowed: false,
      escapeRopeAllowed: false,
      flyAllowed: false,
      outgoingCalls: false,
      incomingCalls: false,
      radioSignal: false,
    },
    fieldScripts: { bank: 0, bytes: new Uint8Array([0x13, 0xfd]), headerSize: 2, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: id,
      name: `matrix-${id}`,
      width: 1,
      height: 1,
      headers: new Uint16Array([id]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    events,
    terrain: { modelId: 0, width, height, attributes: new Uint16Array(width * height) },
    model: {
      modelId: 0,
      vertexCount: 0,
      triangleCount: 0,
      quadCount: 0,
      materialCount: 0,
      pieceCount: 0,
      tileBounds: { minX: 0, maxX: width, minZ: 0, maxZ: height },
    },
  }
}

function createInventory(
  maps: OpeningMapPreview[],
  extra: Omit<Partial<HgssFieldWorldSessionInventory>, 'resolvedMapCatalog'> = {},
): HgssFieldWorldSessionInventory {
  return { resolvedMapCatalog: { startMapId: maps[0]?.id ?? 0, maps }, ...extra }
}

function useClock(state: FieldScriptState, now: Date): void {
  state.pokemonRuntime = { now: () => now } as FieldPokemonRuntime
}

function createBlackthornState(): Uint8Array {
  const data = new Uint8Array(0x20)
  const view = new DataView(data.buffer)
  const platforms = [[13, 75, 0], [9, 58, 1], [14, 32, 0]] as const
  platforms.forEach(([x, z, rotation], index) => {
    view.setUint16(index * 2, x, true)
    view.setUint16(6 + index * 2, z, true)
    data[12 + index] = rotation
  })
  return data
}

describe('HGSS field world session factory', () => {
  it('wires save collections, MapProp metadata, and world extension ports', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{
        scriptId: 700,
        x: 1,
        z: 2,
        width: 1,
        height: 1,
        y: 0,
        expectedValue: 9,
        variableId: 0x4000,
      }],
      objects: [
        { id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 50, scriptId: 701, facingDirection: 0, xRange: 0, zRange: 0, x: 3, z: 1 },
        { id: 8, spriteId: 1, movement: 0, type: 1, eventFlag: 0, scriptId: 3000, facingDirection: 0, parameters: [3, 0, 0], xRange: 0, zRange: 0, x: 1, z: 3 },
      ],
      warps: [],
    }
    const fieldState = createFieldScriptState('male', 'ETHAN')
    const remotePlayer: RemotePlayerWorldActor = {
      id: 'remote:lyra',
      kind: 'remote-player',
      mapId: 1,
      tileX: 2,
      tileZ: 1,
      direction: 'west',
      collision: 'blocking',
      interaction: 'action',
      displayName: 'LYRA',
      spriteId: 1,
    }
    const dynamicActors = createDynamicWorldActorRegistry()
    dynamicActors.upsert(remotePlayer)
    const room = createMap(280, 64, 64)
    room.model!.mapProps = [{ modelId: 224, position: [168, 16, -158], rotation: [0, 0, 0], scale: [1, 1, 1] }]
    const metadataCalls: Array<{ modelId: number, domain?: 'field' | 'room', areaDataBank?: number }> = []
    const session = createHgssFieldWorldSession({
      inventory: createInventory([createMap(1, 8, 8, events), room], {
        mapPropAnimationMetadataResolver: (modelId, domain, areaDataBank) => {
          metadataCalls.push({ modelId, domain, areaDataBank })
          return modelId === 224 && domain === 'field' ? mapPropMetadata(3, [127, 128]) : undefined
        },
      }),
      readFieldState: () => fieldState,
      readPlayerGender: () => 'male',
      extensionPorts: { dynamicActors },
    })

    session.loadMap(1, 1, 1, 'east')
    expect(session.findDynamicActorInteraction()).toEqual(remotePlayer)
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'dynamic-actor' })

    fieldState.flags.add(50)
    expect(session.findEventAt(3, 1)).toBeUndefined()
    fieldState.flags.delete(50)
    expect(session.findEventAt(3, 1)).toEqual({ kind: 'npc', id: 7, scriptId: 701 })
    fieldState.hiddenObjectIds.add(7)
    expect(session.findEventAt(3, 1)).toBeUndefined()
    fieldState.hiddenObjectIds.delete(7)

    fieldState.trainerFlags.add(1)
    expect(session.findEngagingTrainers()).toEqual([])
    fieldState.trainerFlags.delete(1)
    expect(session.findEngagingTrainers()).toMatchObject([{ objectId: 8, trainerId: 1 }])

    fieldState.variables.set(0x4000, 9)
    expect(session.tryMove(0, 1, 'south')).toMatchObject({
      kind: 'moved',
      coordinate: { scriptId: 700, variableId: 0x4000, expectedValue: 9 },
    })

    session.loadMap(280, 42, 47, 'south')
    expect(session.resolveScriptDoor(42, 22)).toMatchObject({
      modelId: 224,
      classId: 3,
      animationArchiveIds: [127, 128],
    })
    expect(metadataCalls).toContainEqual({ modelId: 224, domain: 'field', areaDataBank: 0 })
  })

  it('reads the current clock, flags, Safari state, gender, and dynamic warp', () => {
    type MapVariantResolver = NonNullable<RomInventory['mapVariantResolver']>
    const contexts: Array<Parameters<MapVariantResolver>[1]> = []
    const mapVariantResolver: MapVariantResolver = (map, context) => {
      contexts.push(context)
      return { ...map, label: `${map.label}:${context.weekday}:${context.playerGender}` }
    }
    let fieldState = createFieldScriptState('female', 'LYRA')
    let gender: PlayerGender = 'female'
    useClock(fieldState, new Date(2026, 7, 26, 12))
    fieldState.flags.add(hgssRocketHideoutClearedFlag)
    const firstSafariState = fieldState.safariZone
    const session = createHgssFieldWorldSession({
      inventory: createInventory([createMap(1), createMap(2)], { mapVariantResolver }),
      readFieldState: () => fieldState,
      readPlayerGender: () => gender,
      extensionPorts: baseWorldSessionExtensionPorts,
    })

    expect(session.loadMap(1, 1, 1, 'south')).toMatchObject({ map: { label: 'Map 1:3:female' } })
    expect(contexts.at(-1)).toEqual({
      weekday: 3,
      rocketHideoutCleared: true,
      safariZone: firstSafariState,
      playerGender: 'female',
    })

    gender = 'male'
    fieldState.flags.delete(hgssRocketHideoutClearedFlag)
    useClock(fieldState, new Date(2026, 7, 30, 12))
    expect(session.refreshMapVariant()).toMatchObject({ map: { label: 'Map 1:0:male' } })
    expect(contexts.at(-1)).toMatchObject({ weekday: 0, rocketHideoutCleared: false, playerGender: 'male' })

    const replacementState = createFieldScriptState('male', 'ETHAN')
    replacementState.dynamicWarp = { mapId: 2, warpId: 0xffff, x: 2, z: 3, direction: 2 }
    useClock(replacementState, new Date(2026, 7, 31, 12))
    fieldState = replacementState
    expect(session.transitionTo(hgssDynamicWarpSentinelMapId, hgssDynamicWarpSentinelAnchor)).toMatchObject({
      kind: 'transitioned',
      state: { map: { id: 2, label: 'Map 2:1:male' }, tileX: 2, tileZ: 3, direction: 'west' },
    })
  })

  it('keeps Violet height and Blackthorn collision resolvers live', () => {
    const fieldState = createFieldScriptState('male', 'ETHAN')
    fieldState.gymmick = { type: 4, data: new Uint8Array(0x20) }
    const session = createHgssFieldWorldSession({
      inventory: createInventory([createMap(135, 24, 24)]),
      readFieldState: () => fieldState,
      readPlayerGender: () => 'male',
      extensionPorts: baseWorldSessionExtensionPorts,
    })

    expect(session.loadMap(135, 14, 19)).toMatchObject({ groundHeight: 32 })
    new DataView(fieldState.gymmick.data.buffer).setUint32(0, 1, true)
    expect(session.loadMap(135, 16, 21)).toMatchObject({ groundHeight: 496 })

    const resolvers = createHgssActiveGymWorldResolvers(() => fieldState)
    fieldState.gymmick = { type: 6, data: createBlackthornState() }
    expect(resolvers.collision?.(141, 13, 75, blackthornMagmaMetatileBehavior)).toBe(false)
    expect(resolvers.collision?.(141, 0, 0, blackthornMagmaMetatileBehavior)).toBe(true)
    expect(resolvers.collision?.(141, 0, 0, 45)).toBeUndefined()
    expect(resolvers.collision?.(140, 13, 75, blackthornMagmaMetatileBehavior)).toBeUndefined()

    fieldState.gymmick = { type: 0, data: new Uint8Array(0x20) }
    expect(resolvers.height?.(135, 14, 19)).toBeUndefined()
    expect(resolvers.collision?.(141, 13, 75, blackthornMagmaMetatileBehavior)).toBeUndefined()
  })
})
