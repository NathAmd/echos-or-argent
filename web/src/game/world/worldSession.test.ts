import { describe, expect, it, vi } from 'vitest'
import type { MapEventPreview, NitroMapPropPreview, OpeningMapPreview } from '../../ndsTypes'
import type { MapPropAnimationMetadata } from '../../rom/model/mapPropAnimationMetadata'
import { createHgssWaterfallMovement } from '../scripts/hgssWaterfallMovement'
import { hgssWarpMetatileBehaviors } from './hgssWarpActivation'
import {
  createWorldSession,
  type AuthoritativePlayerStep,
  type AuthoritativePlayerTransition,
} from './worldSession'

const mapPropMetadata = (classId: number, animationArchiveIds: number[]): MapPropAnimationMetadata => ({
  hasAnimations: true,
  flags: 3,
  isBicycleSlope: false,
  controlValue: classId,
  classId,
  animationArchiveIds,
})

function createMap(id: number, events?: MapEventPreview): OpeningMapPreview {
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
    terrain: {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0x8000, 0, 0, 0, 0, 0]),
    },
    model: {
      modelId: 0,
      vertexCount: 0,
      triangleCount: 0,
      quadCount: 0,
      materialCount: 0,
      pieceCount: 0,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
    },
  }
}

function createFieldMap(id: number, events?: MapEventPreview): OpeningMapPreview {
  return {
    ...createMap(id, events),
    matrix: {
      matrixIndex: id,
      name: `field-${id}`,
      width: 2,
      height: 1,
      headers: new Uint16Array([60, id]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 0]),
    },
    model: undefined,
  }
}

function createSharedFieldMap(id: number, matrix: OpeningMapPreview['matrix'], events?: MapEventPreview): OpeningMapPreview {
  return {
    ...createMap(id, events),
    matrix,
    terrain: {
      modelId: 0,
      width: 32,
      height: 32,
      attributes: new Uint16Array(32 * 32),
    },
    model: undefined,
  }
}

function createMapProp(modelId: number, x: number, z: number): NitroMapPropPreview {
  return {
    modelId,
    position: [x, 16, z],
    rotation: [0, 0, 0],
    scale: [1, 1, 1],
  }
}

function createLayeredBridgeMap(): OpeningMapPreview {
  const map = createMap(1)
  map.terrain!.attributes[1 * 4 + 1] = 113
  map.terrain!.attributes[1 * 4 + 2] = 115
  map.terrain!.attributes[2 * 4 + 2] = 21
  map.terrain!.collisionPlates = [
    { minX: -2, maxX: 2, minZ: -2, maxZ: 2, normalX: 0, normalY: 1, normalZ: 0, distance: 0 },
    { minX: -1, maxX: 1, minZ: -1, maxZ: 0, normalX: 0, normalY: 1, normalZ: 0, distance: 1 },
  ]
  return map
}

function createWaterfallMap(): OpeningMapPreview {
  const map = createMap(1)
  // Colonne navigable : eau haute, Cascade, eau basse.
  map.terrain!.attributes[0 * 4 + 1] = 21
  map.terrain!.attributes[1 * 4 + 1] = 19
  map.terrain!.attributes[2 * 4 + 1] = 21
  map.terrain!.collisionPlates = [
    { minX: -2, maxX: 2, minZ: -2, maxZ: -1, normalX: 0, normalY: 1, normalZ: 0, distance: 1 },
    { minX: -2, maxX: 2, minZ: -1, maxZ: 0, normalX: 0, normalY: 1, normalZ: 0, distance: 0.5 },
    { minX: -2, maxX: 2, minZ: 0, maxZ: 2, normalX: 0, normalY: 1, normalZ: 0, distance: 0 },
  ]
  return map
}

describe('WorldSession', () => {
  it('keeps indoor actors on the ROM collision-plane height', () => {
    const map = createMap(97)
    map.terrain!.collisionPlates = [{
      minX: -1,
      maxX: 1,
      minZ: -1,
      maxZ: 1,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      distance: 1,
    }]
    const session = createWorldSession([map])

    expect(session.loadMap(97, 1, 1)).toMatchObject({ groundHeight: 16 })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { groundHeight: 16 },
    })
  })

  it('observes the native follower interaction environment from live map state', () => {
    const objects: MapEventPreview['objects'] = [
      { id: 1, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 2 },
      { id: 2, spriteId: 0x54, movement: 0, type: 0, eventFlag: 0, scriptId: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1 },
      { id: 3, spriteId: 1, movement: 0, type: 0, eventFlag: 10, scriptId: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 0, z: 1 },
      { id: 0xfd, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 1 },
    ]
    const map = createMap(60, {
      backgroundEvents: 2,
      backgrounds: [
        { scriptId: 8000, type: 2, x: 0, z: 0, y: 0, direction: 0 },
        { scriptId: 8001, type: 2, x: 3, z: 3, y: 0, direction: 0 },
      ],
      coordinateEvents: [],
      objects,
      warps: [],
    })
    map.header.mapSection = 126
    map.header.weather = 1
    map.terrain!.attributes[1] = 2
    const session = createWorldSession([map], new Set([10, 801]))
    session.loadMap(60, 1, 1, 'south')
    session.setFollowerEnabled(true)

    expect(session.getFollowerInteractionEnvironment()).toEqual({
      mapId: 60,
      mapSection: 126,
      weather: 1,
      metatileBehavior: 2,
      nearbyObjectCount: 1,
      hiddenItemCount: 1,
      facingDirection: 'south',
    })
    session.setObjectState(1, 3, 3)
    expect(session.getFollowerInteractionEnvironment()?.nearbyObjectCount).toBe(0)
  })

  it('keeps the follower one successful player step behind and reconstructs it on load', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'east')
    session.setFollowerEnabled(true)

    expect(session.getFollowerState()).toMatchObject({ map: { id: 1 }, tileX: 0, tileZ: 1, direction: 'east' })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved' })
    expect(session.getFollowerState()).toMatchObject({ map: { id: 1 }, tileX: 1, tileZ: 1, direction: 'east' })
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'moved' })
    expect(session.getFollowerState()).toMatchObject({ map: { id: 1 }, tileX: 2, tileZ: 1, direction: 'north' })

    session.loadMap(1, 2, 2, 'north')
    expect(session.getFollowerState()).toMatchObject({ map: { id: 1 }, tileX: 2, tileZ: 3, direction: 'north' })
  })

  it('does not advance the follower when player movement is blocked', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 2, 'east')
    session.setFollowerEnabled(true)
    const before = session.getFollowerState()

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain' })
    expect(session.getFollowerState()).toBe(before)
    session.setFollowerEnabled(false)
    expect(session.getFollowerState()).toBeUndefined()
  })

  it('rejects every invalid authoritative step without mutating player or follower state', () => {
    const unloaded = createWorldSession([createMap(1)])
    const validStep = {
      from: { mapId: 1, x: 1, z: 1, direction: 'east' },
      to: { mapId: 1, x: 2, z: 1, direction: 'east' },
      movement: 'walk',
    } satisfies AuthoritativePlayerStep
    expect(unloaded.applyAuthoritativePlayerStep(validStep)).toBeUndefined()

    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'east')
    session.setFollowerEnabled(true)
    const playerBefore = session.getState()
    const followerBefore = session.getFollowerState()
    const invalidSteps: unknown[] = [
      { ...validStep, from: { ...validStep.from, mapId: 2 } },
      { ...validStep, from: { ...validStep.from, x: 0 } },
      { ...validStep, from: { ...validStep.from, direction: 'north' } },
      { ...validStep, to: { ...validStep.to, mapId: 2 } },
      { ...validStep, to: { ...validStep.to, z: 2 } },
      { ...validStep, to: { ...validStep.to, x: 3 } },
      { ...validStep, to: { ...validStep.to, direction: 'north' } },
      { ...validStep, movement: 'cycle' },
    ]

    for (const invalidStep of invalidSteps) {
      expect(session.applyAuthoritativePlayerStep(invalidStep as AuthoritativePlayerStep)).toBeUndefined()
      expect(session.getState()).toBe(playerBefore)
      expect(session.getFollowerState()).toBe(followerBefore)
    }

    session.setLocomotion('surfing')
    const surfingState = session.getState()
    expect(session.applyAuthoritativePlayerStep(validStep)).toBeUndefined()
    expect(session.getState()).toBe(surfingState)
    expect(session.getFollowerState()).toBe(followerBefore)
  })

  it('commits an authoritative walk or run exactly and advances the follower one step', () => {
    const map = createMap(97)
    map.terrain!.collisionPlates = [{
      minX: -2, maxX: 2, minZ: -2, maxZ: 2,
      normalX: 0, normalY: 1, normalZ: 0, distance: 1,
    }]
    const session = createWorldSession([map])
    session.loadMap(97, 1, 1, 'north')
    session.setFollowerEnabled(true)

    const result = session.applyAuthoritativePlayerStep({
      from: { mapId: 97, x: 1, z: 1, direction: 'north' },
      to: { mapId: 97, x: 2, z: 1, direction: 'east' },
      movement: 'run',
    })

    expect(result).toEqual({ kind: 'moved', movement: 'run', state: session.getState() })
    expect(session.getState()).toMatchObject({
      map: { id: 97 }, tileX: 2, tileZ: 1, direction: 'east', locomotion: 'walking', groundHeight: 16,
    })
    expect(session.getFollowerState()).toMatchObject({
      map: { id: 97 }, tileX: 1, tileZ: 1, direction: 'east', groundHeight: 16,
    })
  })

  it('projects an authoritative step without replaying collision, events, warps, or object effects', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{ scriptId: 7, x: 2, z: 1, width: 1, height: 1, y: 0, expectedValue: 1, variableId: 0x4000 }],
      objects: [{ id: 4, spriteId: 84, movement: 15, type: 0, eventFlag: 0, scriptId: 10002, facingDirection: 1, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [{ x: 2, z: 1, header: 2, anchor: 0 }],
    })
    const flags = new Set([0x962])
    const variables = new Map([[0x4000, 1]])
    const collision = vi.fn(() => false)
    const getBlockingActorsAt = vi.fn(() => [])
    const session = createWorldSession(
      [map], flags, new Set(), variables, undefined, new Set(), undefined, undefined,
      collision,
      { dynamicActors: { getBlockingActorsAt, getInteractableActorsAt: () => [] } },
    )
    session.loadMap(1, 1, 1, 'east')
    const eventBefore = session.findEventAt(2, 1)

    const result = session.applyAuthoritativePlayerStep({
      from: { mapId: 1, x: 1, z: 1, direction: 'east' },
      to: { mapId: 1, x: 2, z: 1, direction: 'east' },
      movement: 'walk',
    })

    expect(result).toEqual({ kind: 'moved', movement: 'walk', state: session.getState() })
    expect(result).not.toHaveProperty('coordinate')
    expect(result).not.toHaveProperty('warp')
    expect(result).not.toHaveProperty('warpActivation')
    expect(result).not.toHaveProperty('door')
    expect(result).not.toHaveProperty('objectMovements')
    expect(collision).not.toHaveBeenCalled()
    expect(getBlockingActorsAt).not.toHaveBeenCalled()
    expect(flags).toEqual(new Set([0x962]))
    expect(variables).toEqual(new Map([[0x4000, 1]]))
    expect(session.findEventAt(2, 1)).toEqual(eventBefore)
    expect(session.inspectPlayerTile(1, 2, 1)).toMatchObject({ npcOccupied: true })
  })

  it('rejects an invalid authoritative transition atomically', () => {
    const session = createWorldSession([createMap(1), createMap(2)])
    session.loadMap(1, 1, 1, 'east')
    session.setFollowerEnabled(true)
    const playerBefore = session.getState()
    const followerBefore = session.getFollowerState()
    const valid = {
      from: { mapId: 1, x: 1, z: 1, direction: 'east' },
      to: { mapId: 2, x: 1, z: 1, direction: 'south' },
      movement: 'walk',
    } satisfies AuthoritativePlayerTransition
    const invalid: unknown[] = [
      { ...valid, from: { ...valid.from, x: 2 } },
      { ...valid, from: { ...valid.from, direction: 'north' } },
      { ...valid, to: { ...valid.to, mapId: 999 } },
      { ...valid, to: { ...valid.to, x: 99 } },
      { ...valid, to: { ...valid.to, direction: 'invalid' } },
      { ...valid, movement: 'cycle' },
    ]

    for (const transition of invalid) {
      expect(session.applyAuthoritativePlayerTransition(transition as AuthoritativePlayerTransition)).toBeUndefined()
      expect(session.getState()).toBe(playerBefore)
      expect(session.getFollowerState()).toBe(followerBefore)
    }
  })

  it('projects an authoritative map arrival without replaying anchors, collision, scripts, or progression', () => {
    const source = createMap(1)
    const destination = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{ scriptId: 88, x: 2, z: 1, width: 1, height: 1, y: 0, expectedValue: 1, variableId: 0x4000 }],
      objects: [{ id: 4, spriteId: 84, movement: 15, type: 0, eventFlag: 0, scriptId: 10002, facingDirection: 1, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [{ x: 2, z: 1, header: 1, anchor: 0 }],
    })
    const flags = new Set([0x962])
    const variables = new Map([[0x4000, 1]])
    const collision = vi.fn(() => true)
    const getBlockingActorsAt = vi.fn(() => [{ id: 'blocked' }] as never)
    const session = createWorldSession(
      [source, destination], flags, new Set(), variables, undefined, new Set(), undefined, undefined,
      collision,
      { dynamicActors: { getBlockingActorsAt, getInteractableActorsAt: () => [] } },
    )
    session.loadMap(1, 1, 1, 'east')
    session.setFollowerEnabled(true)

    const result = session.applyAuthoritativePlayerTransition({
      from: { mapId: 1, x: 1, z: 1, direction: 'east' },
      to: { mapId: 2, x: 2, z: 1, direction: 'south' },
      movement: 'run',
    })

    expect(result).toEqual({ kind: 'transitioned', movement: 'run', state: session.getState() })
    expect(session.getState()).toMatchObject({
      map: { id: 2 }, tileX: 2, tileZ: 1, direction: 'south', locomotion: 'walking',
    })
    expect(session.getFollowerState()).toMatchObject({ map: { id: 2 }, tileX: 2, tileZ: 0, direction: 'south' })
    expect(collision).not.toHaveBeenCalled()
    expect(getBlockingActorsAt).not.toHaveBeenCalled()
    expect(flags).toEqual(new Set([0x962]))
    expect(variables).toEqual(new Map([[0x4000, 1]]))
    expect(session.findEventAt(2, 1)).toMatchObject({ kind: 'warp', header: 1, anchor: 0 })
  })

  it('inspects bounds, terrain, NPCs, dynamic actors, and height without mutating the world', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [],
    })
    map.terrain!.collisionPlates = [{
      minX: -2, maxX: 2, minZ: -2, maxZ: 2,
      normalX: 0, normalY: 1, normalZ: 0, distance: 1,
    }]
    const dynamicActor = {
      id: 'remote:bob', kind: 'remote-player', displayName: 'BOB', spriteId: 0,
      mapId: 1, tileX: 1, tileZ: 2, direction: 'north', collision: 'blocking', interaction: 'action',
    } as const
    const session = createWorldSession(
      [map], new Set(), new Set(), new Map(), undefined, new Set(), undefined, undefined, undefined,
      {
        dynamicActors: {
          getBlockingActorsAt: (_mapId, tileX, tileZ) => tileX === 1 && tileZ === 2 ? [dynamicActor] : [],
          getInteractableActorsAt: () => [],
        },
      },
    )
    session.loadMap(1, 1, 1, 'south')
    session.setFollowerEnabled(true)
    const playerBefore = session.getState()
    const followerBefore = session.getFollowerState()

    const open = session.inspectPlayerTile(1, 1, 1, { locomotion: 'walking', referenceGroundHeight: 16 })
    expect(open).toMatchObject({
      insideBounds: true, terrainBlocked: false, npcOccupied: false,
      dynamicActorOccupied: false, blocked: false, groundHeight: 16,
    })
    expect(Object.isFrozen(open)).toBe(true)
    expect(session.inspectPlayerTile(1, 4, 1)).toMatchObject({
      insideBounds: false, blocked: true, blockedReason: 'bounds',
    })
    expect(session.inspectPlayerTile(1, 2, 2)).toMatchObject({
      terrainAttribute: 0x8000, terrainBlocked: true, blocked: true, blockedReason: 'terrain',
    })
    expect(session.inspectPlayerTile(1, 2, 1)).toMatchObject({
      npcOccupied: true, blocked: true, blockedReason: 'npc',
    })
    expect(session.inspectPlayerTile(1, 1, 2)).toMatchObject({
      dynamicActorOccupied: true, blocked: true, blockedReason: 'dynamic-actor',
    })
    expect(session.inspectPlayerTile(2, 1, 1)).toBeUndefined()
    expect(session.getState()).toBe(playerBefore)
    expect(session.getFollowerState()).toBe(followerBefore)
  })

  it('turns toward the follower once, then exchanges positions on the next step', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 2, 1, 'east')
    session.setFollowerEnabled(true)
    expect(session.getFollowerState()).toMatchObject({ tileX: 1, tileZ: 1 })

    expect(session.tryMove(-1, 0, 'west', { enforceTurn: true })).toMatchObject({ kind: 'turned' })
    expect(session.getState()).toMatchObject({ tileX: 2, tileZ: 1, direction: 'west' })
    expect(session.getFollowerState()).toMatchObject({ tileX: 1, tileZ: 1, direction: 'east' })
    expect(session.interact()).toEqual({ kind: 'follower' })

    expect(session.tryMove(-1, 0, 'west', { enforceTurn: true })).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1, direction: 'west' },
    })
    expect(session.getFollowerState()).toMatchObject({ tileX: 2, tileZ: 1, direction: 'west' })
  })

  it('keeps the follower unchanged across a pure turn and a wall bump', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 2, 'east')
    session.setFollowerEnabled(true)
    const follower = session.getFollowerState()

    session.setDirection('north')
    expect(session.getFollowerState()).toBe(follower)
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain' })
    expect(session.getFollowerState()).toBe(follower)
  })

  it('detects a face-to-face follower interaction and turns it toward the player', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 2, 1, 'east')
    session.setFollowerEnabled(true)
    session.setDirection('west')

    expect(session.interact()).toEqual({ kind: 'follower' })
    expect(session.faceFollowerAtPlayer()).toMatchObject({ tileX: 1, tileZ: 1, direction: 'east' })
  })

  it('reaches a ROM NPC across a counter tile without crossing an ordinary wall', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 4, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 12, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 0 }],
      warps: [],
    })
    map.terrain!.attributes[5] = 0x8080
    const session = createWorldSession([map])
    session.loadMap(1, 1, 2, 'north')

    expect(session.interact()).toEqual({ kind: 'npc', id: 4, scriptId: 12 })
    map.terrain!.attributes[5] = 0x8000
    expect(session.interact()).toBeUndefined()
  })

  it('resolves the Pokemon Center PC from the facing metatile behavior', () => {
    const map = createMap(1)
    map.terrain!.attributes[5] = 0x8083
    const session = createWorldSession([map])
    session.loadMap(1, 1, 2, 'north')

    expect(session.interact()).toEqual({ kind: 'metatile', scriptId: 2010, behavior: 131 })
    session.setDirection('south')
    map.terrain!.attributes[13] = 0x8083
    expect(session.interact()).toBeUndefined()
  })

  it('keeps explicit ROM background events ahead of metatile interactions', () => {
    const map = createMap(1, {
      backgroundEvents: 1,
      backgrounds: [{ scriptId: 42, type: 0, x: 1, z: 1, y: 0, direction: 0 }],
      coordinateEvents: [],
      objects: [],
      warps: [],
    })
    map.terrain!.attributes[5] = 0x8083
    const session = createWorldSession([map])
    session.loadMap(1, 1, 2, 'north')

    expect(session.interact()).toEqual({ kind: 'background', scriptId: 42, type: 0, direction: 0 })
  })

  it('configures the follower from native offset and facing directions', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'north')
    session.setFollowerEnabled(true)

    expect(session.configureFollower(3, 2)).toMatchObject({ tileX: 2, tileZ: 1, direction: 'west' })
  })

  it('switches native follower behaviours without inventing a spatial movement', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'north')
    session.setFollowerEnabled(true)
    session.configureFollower(3, 2)

    expect(session.applyFollowerScriptMovement(55)).toMatchObject({
      state: { tileX: 2, tileZ: 1, direction: 'west', movement: 55 },
      movement: { movementId: 55, behavior: 'script-follow-55' },
    })
    expect(session.applyFollowerScriptMovement(56)).toMatchObject({
      state: { tileX: 2, tileZ: 1, direction: 'west', movement: 56 },
      movement: { movementId: 56, behavior: 'script-follow-56' },
    })
    expect(session.applyFollowerScriptMovement(48)).toMatchObject({
      state: { tileX: 2, tileZ: 1, direction: 'west', movement: 48 },
      movement: { movementId: 48, behavior: 'standard-follow' },
    })
    expect(() => session.applyFollowerScriptMovement(54)).toThrow('Mouvement follower ROM 54 non decode')
  })

  it('restores the saved follower coordinates, facing, and movement type', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'south')

    expect(session.restoreFollowerState({ tileX: 3, tileZ: 2, direction: 'north', movement: 48 })).toMatchObject({
      map: { id: 1 }, tileX: 3, tileZ: 2, direction: 'north', movement: 48,
    })
    session.setFollowerEnabled(true)
    expect(session.getFollowerState()).toMatchObject({ tileX: 3, tileZ: 2, direction: 'north', movement: 48 })
  })

  it('suspends and reconstructs the follower across map follow-mode changes', () => {
    const exterior = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 2, anchor: 0 }],
    })
    const interior = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 2, z: 2, header: 1, anchor: 0 }],
    })
    const session = createWorldSession([exterior, interior])
    session.loadMap(1, 2, 1, 'west')
    session.setFollowerEnabled(true)

    expect(session.transitionTo(2, 0)).toMatchObject({ kind: 'transitioned', state: { map: interior, tileX: 2, tileZ: 2 } })
    expect(session.getFollowerState()).toMatchObject({ map: interior, tileX: 3, tileZ: 2, direction: 'west' })

    session.setFollowerEnabled(false)
    expect(session.getFollowerState()).toBeUndefined()
    expect(session.transitionTo(1, 0)).toMatchObject({ kind: 'transitioned', state: { map: exterior, tileX: 1, tileZ: 1 } })
    expect(session.getFollowerState()).toBeUndefined()

    session.setFollowerEnabled(true)
    expect(session.getFollowerState()).toMatchObject({ map: exterior, tileX: 2, tileZ: 1, direction: 'west' })
  })

  it('uses the exact destination warp anchor instead of the first reciprocal door', () => {
    const source = createMap(1, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 1, header: 2, anchor: 1 }] })
    const destination = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [
        { x: 0, z: 0, header: 1, anchor: 0 },
        { x: 3, z: 2, header: 99, anchor: 0 },
      ],
    })
    const session = createWorldSession([source, destination])
    session.loadMap(1, 1, 1, 'east')

    expect(session.transitionTo(2, 1)).toMatchObject({ kind: 'transitioned', state: { map: destination, tileX: 3, tileZ: 2 } })
  })

  it('resolves HGSS dynamic-warp sentinels through the live field state', () => {
    const source = createMap(1, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 1, header: 0x0fff, anchor: 0x0100 }] })
    const destination = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [
        { x: 0, z: 0, header: 1, anchor: 0 },
        { x: 3, z: 2, header: 99, anchor: 0 },
      ],
    })
    const dynamicWarp = { mapId: 2, warpId: 1, x: 3, z: 2, direction: 1 }
    const session = createWorldSession([source, destination], new Set(), new Set(), new Map(), undefined, new Set(), () => dynamicWarp)
    session.loadMap(1, 1, 1, 'north')

    expect(session.transitionTo(0x0fff, 0x0100)).toMatchObject({
      kind: 'transitioned',
      state: { map: destination, tileX: 3, tileZ: 2, direction: 'south' },
    })
  })

  it('falls back to explicit dynamic-warp coordinates when no warp anchor is stored', () => {
    const source = createMap(1, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 1, header: 0x0fff, anchor: 0x0100 }] })
    const destination = createMap(2, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [] })
    const dynamicWarp = { mapId: 2, warpId: 0xffff, x: 2, z: 3, direction: 2 }
    const session = createWorldSession([source, destination], new Set(), new Set(), new Map(), undefined, new Set(), () => dynamicWarp)
    session.loadMap(1, 1, 1, 'south')

    expect(session.transitionTo(0x0fff, 0x0100)).toMatchObject({
      kind: 'transitioned',
      state: { map: destination, tileX: 2, tileZ: 3, direction: 'west' },
    })
  })

  it('resolves an outdoor arrival door from the destination anchor before the southward step', () => {
    const source = createMap(1, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 1, header: 2, anchor: 0 }] })
    const destination = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 1, anchor: 0 }],
    })
    destination.terrain!.attributes[1 * destination.terrain!.width + 1] = 0x8069
    destination.model!.mapProps = [{
      modelId: 24,
      position: [2.125, 0, 1.125],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }]
    const session = createWorldSession(
      [source, destination],
      new Set(),
      new Set(),
      new Map(),
      (modelId) => modelId === 24 ? mapPropMetadata(1, [8, 9]) : undefined,
    )
    session.loadMap(1, 1, 1, 'south')

    expect(session.transitionTo(2, 0)).toMatchObject({
      kind: 'transitioned',
      state: { tileX: 1, tileZ: 2, direction: 'south' },
      arrival: {
        fromTileX: 1,
        fromTileZ: 1,
        door: { tag: 1, modelId: 24, classId: 1, animationArchiveIds: [8, 9] },
      },
    })
    session.setFollowerEnabled(true)
    expect(session.getFollowerState()).toMatchObject({ tileX: 1, tileZ: 1, direction: 'south' })
    expect(session.completeDoorArrival()).toMatchObject({ tileX: 1, tileZ: 1, direction: 'south' })
  })

  it('resolves scripted indoor doors from room-space MapProps with field metadata fallback', () => {
    const map = createMap(280)
    map.terrain = {
      modelId: 0,
      width: 64,
      height: 64,
      attributes: new Uint16Array(64 * 64),
    }
    map.model!.tileBounds = { minX: 0, maxX: 64, minZ: 0, maxZ: 64 }
    map.model!.mapProps = [createMapProp(224, 168, -158)]
    const session = createWorldSession(
      [map],
      new Set(),
      new Set(),
      new Map(),
      (modelId, domain = 'field') => modelId === 224 && domain === 'field'
        ? mapPropMetadata(3, [127, 128])
        : undefined,
    )
    session.loadMap(280, 42, 47, 'south')

    expect(session.resolveScriptDoor(42, 22)).toMatchObject({
      modelId: 224,
      classId: 3,
      animationArchiveIds: [127, 128],
    })
  })

  it('resolves indoor northward warp doors from room-space MapProps', () => {
    const map = createMap(280, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 42, z: 22, header: 99, anchor: 0 }],
    })
    map.terrain = {
      modelId: 0,
      width: 64,
      height: 64,
      attributes: new Uint16Array(64 * 64),
    }
    map.terrain.attributes[22 * 64 + 42] = 0x8069
    map.model!.tileBounds = { minX: 0, maxX: 64, minZ: 0, maxZ: 64 }
    map.model!.mapProps = [createMapProp(224, 168, -158)]
    const session = createWorldSession(
      [map],
      new Set(),
      new Set(),
      new Map(),
      (modelId, domain = 'field') => modelId === 224 && domain === 'field'
        ? mapPropMetadata(3, [127, 128])
        : undefined,
    )
    session.loadMap(280, 42, 23, 'north')

    expect(session.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 42, tileZ: 23 },
      warp: { header: 99, anchor: 0 },
      warpActivation: { trigger: 'facing-door', transition: 'door', direction: 'north' },
      door: { modelId: 224, classId: 3, animationArchiveIds: [127, 128] },
    })
  })

  it('never activates the current arrival warp with the action button', () => {
    const source = createMap(1, { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 1, header: 2, anchor: 0 }] })
    const destination = createMap(2, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 2, z: 2, header: 1, anchor: 0 }],
    })
    destination.terrain!.attributes[2 * destination.terrain!.width + 3] = 0x8000
    const session = createWorldSession([source, destination])
    session.loadMap(1, 1, 1, 'east')
    session.transitionTo(2, 0)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain' })
    expect(session.interact()).toBeUndefined()
  })

  it('attaches the native ordered door descriptor before a northbound warp', () => {
    const exterior = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 2, anchor: 0 }],
    })
    exterior.terrain!.attributes[1 * exterior.terrain!.width + 1] = 0x8069
    exterior.model!.mapProps = [{
      modelId: 24,
      position: [1.125, 0, 1.125],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
    }]
    const session = createWorldSession(
      [exterior],
      new Set(),
      new Set(),
      new Map(),
      (modelId) => modelId === 24 ? mapPropMetadata(1, [8, 9]) : undefined,
    )
    session.loadMap(1, 1, 2, 'north')

    expect(session.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 2 },
      warp: { header: 2, anchor: 0 },
      warpActivation: { trigger: 'facing-door', transition: 'door', direction: 'north' },
      door: { tag: 1, modelId: 24, classId: 1, animationArchiveIds: [8, 9] },
    })
  })

  it('uses the indoor high collision bit for integrated room barriers', () => {
    const session = createWorldSession([createMap(64)])
    session.loadMap(64, 1, 1)

    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'moved', state: { tileX: 1, tileZ: 2 } })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 2, tileZ: 2, attribute: 0x8000 })
    expect(session.tryMove(-3, 0, 'west')).toMatchObject({ kind: 'blocked', reason: 'bounds' })
  })

  it('uses terrain bounds for exterior maps beyond the first hard-coded town id', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16) }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'moved', state: { tileX: 1, tileZ: 2 } })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 2 } })
  })

  it('does not mistake exterior matrix-layer flags for collision barriers', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0x0400, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('applies the native collision high bit to exterior terrain', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0x8006, 21,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 2, tileZ: 1 })
  })

  it('lets the player step onto a hidden current-map object even when the base tile stays flagged 0x8000', () => {
    const map = createMap(64, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      warps: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1 }],
    })
    map.terrain!.attributes[1 * map.terrain!.width + 2] = 0x8000
    const hiddenObjectIds = new Set([7])
    const session = createWorldSession([map], new Set(), hiddenObjectIds)
    session.loadMap(64, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('only opens the exact warp tile and keeps its neighbouring wall blocked', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 34, z: 1, header: 62, anchor: 0 }],
    }
    const exterior = createFieldMap(61, events)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0x8069, 21,
        0, 0x8006, 21, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', warp: { header: 62, anchor: 0 } })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 1 })
    session.loadMap(61, 3, 2, 'north')
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 21 })
  })

  it('only overrides collision on the exact ROM warp tile', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 34, z: 1, header: 62, anchor: 0 }],
    }
    const exterior = createFieldMap(61, events)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0x8069, 0x8006,
        0, 0, 0x8006, 0,
        0, 0, 0, 0,
      ]),
    }
    exterior.model = {
      modelId: 0,
      vertexCount: 6,
      triangleCount: 2,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          3, 0, 2, 4, 0, 2, 3, 2, 2,
          4, 0, 2, 4, 2, 2, 3, 2, 2,
        ]),
      }],
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 2, 3, 'north')

    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 2, tileZ: 2 })
    session.loadMap(61, 2, 2, 'north')
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'moved', warp: { header: 62 } })
    session.loadMap(61, 3, 2, 'north')
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 3, tileZ: 1 })
    session.loadMap(61, 2, 1, 'south')
    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'blocked', reason: 'terrain', tileX: 2, tileZ: 2 })
  })

  it('blocks surf-only exterior water from the ROM tile behavior', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 21, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 21 })
  })

  it('turns in place before walking when native player input is enforced', () => {
    const session = createWorldSession([createMap(1)])
    session.loadMap(1, 1, 1, 'south')

    expect(session.tryMove(1, 0, 'east', { enforceTurn: true })).toMatchObject({
      kind: 'turned',
      state: { tileX: 1, tileZ: 1, direction: 'east' },
    })
    expect(session.tryMove(1, 0, 'east', { enforceTurn: true })).toMatchObject({
      kind: 'moved',
      movement: 'walk',
      state: { tileX: 2, tileZ: 1 },
    })
  })

  it('crosses a native directional ledge by two tiles with a jump', () => {
    const map = createMap(1)
    map.terrain!.attributes[1 * 4 + 1] = 56
    const session = createWorldSession([map])
    session.loadMap(1, 0, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      movement: 'ledge-jump',
      state: { tileX: 2, tileZ: 1 },
    })
  })

  it('permits surf tiles only in the surfing state and dismounts onto land', () => {
    const map = createMap(1)
    map.terrain!.attributes[1 * 4 + 2] = 0x8015
    const session = createWorldSession([map])
    session.loadMap(1, 1, 1, 'east')
    expect(session.isFacingSurfableSurface()).toBe(true)
    session.setLocomotion('surfing')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', movement: 'surf', state: { locomotion: 'surfing' } })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', movement: 'surf', state: { locomotion: 'walking' } })
  })

  it('blocks normal and forced input at a Cascade from either height', () => {
    const session = createWorldSession([createWaterfallMap()])

    expect(session.loadMap(1, 1, 0, 'south', 'surfing')).toMatchObject({ groundHeight: 16 })
    expect(session.interact()).toEqual({ kind: 'metatile', scriptId: 10005, behavior: 19 })
    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 19 })
    expect(session.tryMove(0, 1, 'south', { forced: true })).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 19 })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 0, groundHeight: 16 })

    expect(session.loadMap(1, 1, 2, 'north', 'surfing')).toMatchObject({ groundHeight: 0 })
    expect(session.interact()).toEqual({ kind: 'metatile', scriptId: 10005, behavior: 19 })
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 19 })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 2, groundHeight: 0 })

    expect(session.loadMap(1, 1, 1, 'south', 'surfing')).toMatchObject({ groundHeight: 8 })
    expect(session.tryMove(0, 1, 'south', { forced: true })).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 21 })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 1, groundHeight: 8 })
  })

  it('keeps Cascade traversal available to the validated native script in both directions', () => {
    const session = createWorldSession([createWaterfallMap()])

    session.loadMap(1, 1, 0, 'south', 'surfing')
    expect(session.interact()).toEqual({ kind: 'metatile', scriptId: 10005, behavior: 19 })
    session.applyObjectMovement(255, createHgssWaterfallMovement('south'))
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 2, groundHeight: 0, locomotion: 'surfing' })

    expect(session.interact()).toBeUndefined()
    session.setDirection('north')
    expect(session.interact()).toEqual({ kind: 'metatile', scriptId: 10005, behavior: 19 })
    session.applyObjectMovement(255, createHgssWaterfallMovement('north'))
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 0, groundHeight: 16, locomotion: 'surfing' })
  })

  it('does not expose a Cascade as ordinary Surf water from land', () => {
    const session = createWorldSession([createWaterfallMap()])
    session.loadMap(1, 0, 1, 'east', 'walking')

    expect(session.isFacingSurfableSurface()).toBe(false)
    expect(session.interact()).toBeUndefined()
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 19 })
  })

  it('does not expose the Cascade behavior rendered below an occupied upper layer', () => {
    const map = createWaterfallMap()
    // La case haute et la Cascade partagent ici une seconde plaque : le
    // comportement 19 de la couche d'eau ne doit pas traverser ce pont.
    map.terrain!.collisionPlates!.push({
      minX: -1,
      maxX: 0,
      minZ: -1,
      maxZ: 0,
      normalX: 0,
      normalY: 1,
      normalZ: 0,
      distance: 1,
    })
    const session = createWorldSession([map])

    expect(session.loadMap(1, 1, 0, 'south', 'surfing')).toMatchObject({ groundHeight: 16 })
    expect(session.interact()).toBeUndefined()
    expect(session.tryMove(0, 1, 'south', { forced: true })).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1, groundHeight: 16 },
    })
  })

  it('walks on an upper BDHC bridge layer without treating the water below as Surf', () => {
    const session = createWorldSession([createLayeredBridgeMap()])
    session.loadMap(1, 1, 1, 'east')

    expect(session.getState()).toMatchObject({ groundHeight: 16, locomotion: 'walking' })
    expect(session.isFacingSurfableSurface()).toBe(false)
    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      movement: 'walk',
      state: { tileX: 2, tileZ: 1, groundHeight: 16, locomotion: 'walking' },
    })
    session.setDirection('south')
    expect(session.isFacingSurfableSurface()).toBe(false)
  })

  it('treats every surfable behavior as dry support when its upper BDHC layer is selected', () => {
    const map = createLayeredBridgeMap()
    map.terrain!.attributes[1 * 4 + 2] = 19
    const session = createWorldSession([map])
    session.loadMap(1, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved', state: { tileX: 2, tileZ: 1, groundHeight: 16, locomotion: 'walking' },
    })
    session.setDirection('south')
    expect(session.isFacingSurfableSurface()).toBe(false)
  })

  it('restores the ROM bridge layer from locomotion without a custom save field', () => {
    const map = createLayeredBridgeMap()
    const walking = createWorldSession([map])
    const surfing = createWorldSession([map])

    expect(walking.loadMap(1, 2, 1, 'south', 'walking')).toMatchObject({ groundHeight: 16 })
    expect(surfing.loadMap(1, 2, 1, 'south', 'surfing')).toMatchObject({ groundHeight: 0 })
    expect(surfing.isFacingSurfableSurface()).toBe(true)
  })

  it('keeps a dynamic gym height authoritative while loading a map', () => {
    const map = createLayeredBridgeMap()
    const session = createWorldSession(
      [map], new Set(), new Set(), new Map(), undefined, new Set(), undefined, undefined,
      { height: () => 37 },
    )

    expect(session.loadMap(1, 2, 1, 'south', 'surfing')).toMatchObject({ groundHeight: 37 })
  })

  it('continues automatically over ice and directional slide tiles', () => {
    const map = createMap(1)
    map.terrain!.attributes[1 * 4 + 2] = 0x8020
    map.terrain!.attributes[2 * 4 + 2] = 0x8043
    const session = createWorldSession([map])
    session.loadMap(1, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', continuationDirection: 'east' })
    session.loadMap(1, 2, 1, 'south')
    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'moved', continuationDirection: 'south' })
  })

  it('pushes every strength rock through the shared collision system once Force is active', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 4, spriteId: 84, movement: 15, type: 0, eventFlag: 0, scriptId: 10002, facingDirection: 1, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [],
    })
    const flags = new Set<number>()
    const session = createWorldSession([map], flags)
    session.loadMap(1, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'npc' })
    flags.add(0x962)
    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { tileX: 2, tileZ: 1 },
      objectMovements: [{
        objectId: 4,
        kind: 'strength-push',
        direction: 'east',
        finalDirection: 'east',
        distance: 1,
        tileX: 3,
        tileZ: 1,
      }],
    })
    expect(session.findEventAt(3, 1)).toEqual({ kind: 'npc', id: 4, scriptId: 10002 })
  })

  it('drops a strength boulder through a ROM hole and persists both floor states', () => {
    const upper = createMap(41, {
      backgroundEvents: 0, backgrounds: [], coordinateEvents: [{ scriptId: 1, x: 3, z: 1, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 1 }], warps: [],
      objects: [{ id: 4, spriteId: 84, movement: 15, type: 0, eventFlag: 490, scriptId: 10002, facingDirection: 1, xRange: 0, zRange: 0, x: 2, z: 1 }],
    })
    upper.header.mapSection = 217
    upper.model!.surfaces = [{
      materialIndex: 0,
      materialName: 'd_stairhole',
      positions: new Float32Array([16, 0, -16, 32, 0, -16, 16, 0, 0]),
    }]
    const lower = createMap(77, {
      backgroundEvents: 0, backgrounds: [], coordinateEvents: [], warps: [],
      objects: [{ id: 0, spriteId: 84, movement: 15, type: 0, eventFlag: 494, scriptId: 3, facingDirection: 1, xRange: 0, zRange: 0, x: 1, z: 1 }],
    })
    lower.header.mapSection = 217
    const flags = new Set([0x962, 494])
    const session = createWorldSession([upper, lower], flags)
    session.loadMap(41, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { tileX: 2, tileZ: 1 },
      objectMovements: [{ objectId: 4, kind: 'strength-fall', tileX: 3, tileZ: 1 }],
    })
    expect(flags.has(490)).toBe(true)
    expect(flags.has(494)).toBe(false)
    expect(session.findEventAt(3, 1)).toBeUndefined()

    session.loadMap(77, 0, 1, 'east')
    expect(session.findEventAt(1, 1)).toEqual({ kind: 'npc', id: 0, scriptId: 3 })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'npc' })
  })

  it('slides and locks native gym ice blocks when the player collides during a forced slide', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 2, spriteId: 406, movement: 15, type: 0, eventFlag: 0, scriptId: 0, facingDirection: 1, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [],
    })
    map.terrain!.attributes[1 * 4 + 2] = 0x8020
    map.terrain!.attributes[1 * 4 + 3] = 0x8020
    const session = createWorldSession([map])
    session.loadMap(1, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east', { forced: true })).toMatchObject({
      kind: 'blocked',
      reason: 'npc',
      objectMovements: [{
        objectId: 2,
        kind: 'ice-block-slide',
        direction: 'east',
        finalDirection: 'north',
        distance: 1,
        tileX: 3,
        tileZ: 1,
      }],
    })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 1 })
    expect(session.findEventAt(3, 1)).toEqual({ kind: 'npc', id: 2, scriptId: 0 })
  })

  it('prioritizes a coordinate script over a warp when both share the same tile', () => {
    const source = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      objects: [],
      warps: [{ x: 1, z: 0, header: 2, anchor: 0 }],
      coordinateEvents: [{ scriptId: 7, x: 1, z: 0, width: 1, height: 1, y: 0, expectedValue: 1, variableId: 0x4000 }],
    })
    const destination = createMap(2)
    const variables = new Map([[0x4000, 1]])
    source.terrain!.attributes[1] = hgssWarpMetatileBehaviors.warpEast
    const session = createWorldSession([source, destination], new Set(), new Set(), variables)
    session.loadMap(1, 0, 0, 'east')

    const result = session.tryMove(1, 0, 'east')
    expect(result).toMatchObject({ kind: 'moved', state: { map: { id: 1 }, tileX: 1, tileZ: 0 }, coordinate: { scriptId: 7 } })
    expect(result?.kind === 'moved' ? result.warp : undefined).toBeUndefined()
  })

  it('blocks a visible story object before a completed-step warp and releases it through its ROM flag', () => {
    const flags = new Set<number>()
    const map = createMap(301, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 290, movement: 0, type: 0, eventFlag: 529, scriptId: 0, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 1 }],
      warps: [{ x: 1, z: 1, header: 302, anchor: 0 }],
    })
    map.terrain!.attributes[1 * map.terrain!.width + 1] = hgssWarpMetatileBehaviors.warpNorth
    const session = createWorldSession([map], flags)
    session.loadMap(301, 1, 2, 'north')

    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'npc', event: { id: 7 } })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 2 })

    flags.add(529)
    expect(session.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1 },
      warp: { header: 302, anchor: 0 },
      warpActivation: { trigger: 'completed-step', transition: 'direct', direction: 'north' },
    })
  })

  it('keeps story objects and the follower ahead of a colliding behavior-105 door', () => {
    const flags = new Set<number>()
    const map = createMap(77, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 4, spriteId: 1, movement: 0, type: 0, eventFlag: 470, scriptId: 1, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 1 }],
      warps: [{ x: 1, z: 1, header: 78, anchor: 0 }],
    })
    map.terrain!.attributes[1 * map.terrain!.width + 1] = 0x8069
    const destination = createMap(78, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 77, anchor: 0 }],
    })
    const session = createWorldSession([map, destination], flags)
    session.loadMap(77, 1, 2, 'north')

    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'npc', event: { id: 4 } })
    flags.add(470)
    expect(session.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 2 },
      warp: { header: 78 },
      warpActivation: { trigger: 'facing-door', transition: 'door', direction: 'north' },
    })

    session.restoreFollowerState({ tileX: 1, tileZ: 1, direction: 'south' })
    expect(session.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'follower' })
    expect(session.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 2 },
      warp: { header: 78 },
      warpActivation: { trigger: 'facing-door', transition: 'door', direction: 'north' },
    })
    expect(session.transitionTo(78, 0, 'north')).toMatchObject({ kind: 'transitioned', state: { map: { id: 78 } } })
    expect(session.getFollowerState()).not.toMatchObject({ tileX: session.getState()?.tileX, tileZ: session.getState()?.tileZ })
  })

  it('does not activate inert WarpEvent anchors or a directional warp from the wrong direction', () => {
    const inert = createMap(109, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 479, anchor: 0 }],
    })
    inert.terrain!.attributes[1 * inert.terrain!.width + 1] = 0x8000
    const inertSession = createWorldSession([inert])
    inertSession.loadMap(109, 1, 2, 'north')
    expect(inertSession.tryMove(0, -1, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain' })

    const directional = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 1, z: 1, header: 2, anchor: 0 }],
    })
    directional.terrain!.attributes[1 * directional.terrain!.width + 1] = hgssWarpMetatileBehaviors.warpEast
    const directionalSession = createWorldSession([directional])
    directionalSession.loadMap(1, 1, 2, 'north')
    expect(directionalSession.tryMove(0, -1, 'north')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1 },
      warp: undefined,
    })
    expect(directionalSession.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1 },
      warp: { header: 2 },
      warpActivation: { trigger: 'current-held', transition: 'direct', direction: 'east', heldDirection: 'east' },
    })
  })

  it('does not activate an adjacent WarpEvent through the action button', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      objects: [],
      warps: [{ x: 1, z: 0, header: 2, anchor: 0 }],
      coordinateEvents: [],
    })
    map.terrain!.attributes[1] = 0x8069
    const session = createWorldSession([map])
    session.loadMap(1, 0, 0, 'east')

    expect(session.interact()).toBeUndefined()
  })

  it('prioritizes an adjacent NPC over the current warp on the action button', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 0 }],
      warps: [{ x: 0, z: 0, header: 2, anchor: 0 }],
      coordinateEvents: [],
    })
    const session = createWorldSession([map])
    session.loadMap(1, 0, 0, 'east')

    expect(session.interact()).toMatchObject({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('prioritizes an adjacent NPC over an adjacent warp on the action button', () => {
    const map = createMap(1, {
      backgroundEvents: 0,
      backgrounds: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 0 }],
      warps: [{ x: 1, z: 0, header: 2, anchor: 0 }],
      coordinateEvents: [],
    })
    const session = createWorldSession([map])
    session.loadMap(1, 0, 0, 'east')

    expect(session.interact()).toMatchObject({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('respects the directional collision of exterior jump ledges', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 56, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'moved', state: { tileX: 1, tileZ: 2 } })
    expect(session.tryMove(1, -1, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
    session.loadMap(61, 1, 1)
    expect(session.tryMove(1, 0, 'north')).toMatchObject({ kind: 'blocked', reason: 'terrain', attribute: 56 })
  })

  it('keeps the 0x0600 terrain variant traversable indoors', () => {
    const interior = createMap(64)
    interior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array([
        0, 0, 0, 0,
        0, 0, 0x0600, 0,
        0, 0, 0, 0,
        0, 0, 0, 0,
      ]),
    }
    const session = createWorldSession([interior])
    session.loadMap(64, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('keeps exterior collision driven by ROM terrain when the rendered geometry has a gap', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array(16),
    }
    exterior.model = {
      modelId: 0,
      vertexCount: 6,
      triangleCount: 2,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          1, 1, 1,
          2, 1, 1,
          1, 1, 2,
          2, 1, 1,
          2, 1, 2,
          1, 1, 2,
        ]),
      }],
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('does not invent collision from rendered height differences', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array(16),
    }
    exterior.model = {
      modelId: 0,
      vertexCount: 12,
      triangleCount: 4,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          1, 1, 1,
          2, 1, 1,
          1, 1, 2,
          2, 1, 1,
          2, 1, 2,
          1, 1, 2,
          2, 4, 1,
          3, 4, 1,
          2, 4, 2,
          3, 4, 1,
          3, 4, 2,
          2, 4, 2,
        ]),
      }],
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('prefers the exterior layer closest to the current floor when a tile also contains higher decorative geometry', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array(16),
    }
    exterior.model = {
      modelId: 0,
      vertexCount: 18,
      triangleCount: 6,
      quadCount: 0,
      materialCount: 3,
      pieceCount: 3,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          1, 1, 1,
          2, 1, 1,
          1, 1, 2,
          2, 1, 1,
          2, 1, 2,
          1, 1, 2,
        ]),
      }, {
        materialIndex: 1,
        positions: new Float32Array([
          2, 1, 1,
          3, 1, 1,
          2, 1, 2,
          3, 1, 1,
          3, 1, 2,
          2, 1, 2,
        ]),
      }, {
        materialIndex: 2,
        positions: new Float32Array([
          2, 4, 1,
          3, 4, 1,
          2, 4, 2,
          3, 4, 1,
          3, 4, 2,
          2, 4, 2,
        ]),
      }],
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 1, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1, groundHeight: 1 } })
    expect(session.getState()?.groundHeight).toBe(1)
  })

  it('does not turn a horizontal decorative prop above the player into a blocked tile', () => {
    const exterior = createFieldMap(61)
    exterior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array(16),
    }
    exterior.model = {
      modelId: 0,
      vertexCount: 6,
      triangleCount: 2,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        supportsMovement: false,
        positions: new Float32Array([
          1, 4, 1,
          2, 4, 1,
          1, 4, 2,
          2, 4, 1,
          2, 4, 2,
          1, 4, 2,
        ]),
      }],
    }
    const session = createWorldSession([exterior])
    session.loadMap(61, 0, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 1, tileZ: 1 } })
  })

  it('does not invent interior collision from rendered wall geometry', () => {
    const interior = createMap(61)
    interior.terrain = {
      modelId: 0,
      width: 4,
      height: 4,
      attributes: new Uint16Array(16),
    }
    interior.model = {
      modelId: 0,
      vertexCount: 3,
      triangleCount: 1,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 4, minZ: 0, maxZ: 4 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          2, 0, 0,
          2, 2, 0,
          2, 0, 3,
        ]),
      }],
    }
    const session = createWorldSession([interior])
    session.loadMap(61, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 2, tileZ: 1 } })
  })

  it('uses matrix world coordinates for exterior maps beyond the first town id', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 33, z: 1, header: 62, anchor: 0 }],
    }
    const map = createFieldMap(61, events)
    map.terrain!.attributes[1 * map.terrain!.width + 1] = hgssWarpMetatileBehaviors.warpEast
    const session = createWorldSession([map])
    session.loadMap(61, 0, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1, direction: 'east' },
      warp: { header: 62, anchor: 0 },
      warpActivation: { trigger: 'completed-step-held', transition: 'direct', direction: 'east', heldDirection: 'east' },
    })
    expect(session.getState()).toMatchObject({ tileX: 1, tileZ: 1, direction: 'east' })
  })

  it('uses the full repeated-cell footprint for exterior movement bounds', () => {
    const session = createWorldSession([{
      ...createMap(61),
      matrix: {
        matrixIndex: 61,
        name: 'field-61-repeat',
        width: 2,
        height: 1,
        headers: new Uint16Array([61, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 1]),
      },
      terrain: {
        modelId: 0,
        width: 32,
        height: 32,
        attributes: new Uint16Array(32 * 32),
      },
      model: undefined,
    }])
    session.loadMap(61, 31, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', state: { tileX: 32, tileZ: 1 } })
  })

  it('automatically switches to the adjacent matrix header when crossing a field-map seam', () => {
    const matrix: OpeningMapPreview['matrix'] = {
      matrixIndex: 71,
      name: 'shared-field',
      width: 2,
      height: 1,
      headers: new Uint16Array([60, 61]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 0]),
    }
    const leftMap = createSharedFieldMap(60, matrix)
    const rightMap = createSharedFieldMap(61, matrix)
    const makeGroundSurface = (height: number): NonNullable<OpeningMapPreview['model']> => ({
      modelId: 0,
      vertexCount: 6,
      triangleCount: 2,
      quadCount: 0,
      materialCount: 1,
      pieceCount: 1,
      tileBounds: { minX: 0, maxX: 32, minZ: 0, maxZ: 32 },
      surfaces: [{
        materialIndex: 0,
        positions: new Float32Array([
          0, height, 0, 32, height, 0, 0, height, 32,
          32, height, 0, 32, height, 32, 0, height, 32,
        ]),
      }],
    })
    leftMap.model = makeGroundSurface(7)
    rightMap.model = makeGroundSurface(2)
    const session = createWorldSession([leftMap, rightMap])
    session.loadMap(60, 31, 1, 'east')
    session.setFollowerEnabled(true)

    const move = session.tryMove(1, 0, 'east')

    expect(move).toMatchObject({ kind: 'moved', state: { tileX: 0, tileZ: 1, direction: 'east', groundHeight: 2 } })
    expect(move?.kind === 'moved' ? move.state.map.id : undefined).toBe(61)
    expect(session.getState()?.map.id).toBe(61)
    // Le suiveur reste une case derrière, donc encore supporté par la BDHC de
    // la parcelle gauche même si le rendu utilise le repère de la carte droite.
    expect(session.getFollowerState()).toMatchObject({ map: { id: 61 }, tileX: -1, tileZ: 1, groundHeight: 7 })
  })

  it('resolves adjacent matrix-header interactions before any explicit warp transition', () => {
    const matrix: OpeningMapPreview['matrix'] = {
      matrixIndex: 71,
      name: 'shared-field-events',
      width: 2,
      height: 1,
      headers: new Uint16Array([60, 61]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 0]),
    }
    const rightEvents: MapEventPreview = {
      backgroundEvents: 1,
      backgrounds: [{ scriptId: 91, type: 0, x: 32, z: 1, y: 0, direction: 4 }],
      coordinateEvents: [],
      objects: [],
      warps: [],
    }
    const leftMap = createSharedFieldMap(60, matrix)
    const rightMap = createSharedFieldMap(61, matrix, rightEvents)
    const session = createWorldSession([leftMap, rightMap])
    session.loadMap(60, 31, 1, 'east')

    expect(session.resolveInteraction()).toEqual({
      map: rightMap,
      worldX: 32,
      worldZ: 1,
      event: { kind: 'background', scriptId: 91, type: 0, direction: 4 },
    })
    expect(session.interact()).toEqual({ kind: 'background', scriptId: 91, type: 0, direction: 4 })
  })

  it('resolves a native counter behavior stored in the adjacent matrix header', () => {
    const matrix: OpeningMapPreview['matrix'] = {
      matrixIndex: 72,
      name: 'shared-field-counter',
      width: 2,
      height: 1,
      headers: new Uint16Array([60, 61]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 0]),
    }
    const rightEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 2, xRange: 0, zRange: 0, x: 33, z: 1 }],
      warps: [],
    }
    const leftMap = createSharedFieldMap(60, matrix)
    const rightMap = createSharedFieldMap(61, matrix, rightEvents)
    rightMap.terrain!.attributes[1 * 32] = 0x8080
    const session = createWorldSession([leftMap, rightMap])
    session.loadMap(60, 31, 1, 'east')

    expect(session.resolveInteraction()).toEqual({
      map: rightMap,
      worldX: 33,
      worldZ: 1,
      event: { kind: 'npc', id: 7, scriptId: 42 },
    })
    expect(session.interact()).toEqual({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('blocks NPC tiles and exposes adjacent interactions', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [],
    }
    const session = createWorldSession([createMap(64, events)])
    session.loadMap(64, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'npc' })
    expect(session.resolveInteraction()).toEqual({
      map: session.getState()?.map,
      worldX: 2,
      worldZ: 1,
      event: { kind: 'npc', id: 7, scriptId: 42 },
    })
    expect(session.interact()).toEqual({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('detects an undefeated trainer only inside the ROM sight line', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 1, eventFlag: 0, scriptId: 3004, facingDirection: 0, parameters: [4, 0, 0], xRange: 0, zRange: 0, x: 1, z: 4 }],
      warps: [],
    }
    const trainerFlags = new Set<number>()
    const session = createWorldSession([createMap(64, events)], new Set(), new Set(), new Map(), undefined, trainerFlags)
    session.loadMap(64, 1, 1, 'south')

    expect(session.findEngagingTrainers()).toEqual([{
      objectId: 7,
      trainerId: 5,
      scriptId: 3004,
      direction: 'north',
      distance: 3,
      encounterType: 0,
    }])

    trainerFlags.add(5)
    expect(session.findEngagingTrainers()).toEqual([])
  })

  it('blocks trainer sight with native collision and lets a rotating trainer face the player', () => {
    const fixedEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 1, eventFlag: 0, scriptId: 3004, facingDirection: 0, parameters: [4, 0, 0], xRange: 0, zRange: 0, x: 1, z: 4 }],
      warps: [],
    }
    const blockedMap = createMap(64, fixedEvents)
    blockedMap.terrain!.attributes[2 * blockedMap.terrain!.width + 1] = 0x8000
    const blocked = createWorldSession([blockedMap])
    blocked.loadMap(64, 1, 1)
    expect(blocked.findEngagingTrainers()).toEqual([])

    const rotatingMap = createMap(65, {
      ...fixedEvents,
      objects: [{ ...fixedEvents.objects[0]!, type: 2, facingDirection: 1, x: 4, z: 1 }],
    })
    const rotating = createWorldSession([rotatingMap])
    rotating.loadMap(65, 1, 1)
    expect(rotating.findEngagingTrainers()[0]).toMatchObject({ direction: 'west', distance: 3 })
  })

  it('exposes the ROM background script on the tile the player faces', () => {
    const events: MapEventPreview = {
      backgroundEvents: 1,
      backgrounds: [{ scriptId: 2, type: 0, x: 2, z: 1, y: 0, direction: 4 }],
      coordinateEvents: [],
      objects: [],
      warps: [],
    }
    const session = createWorldSession([createMap(64, events)])
    session.loadMap(64, 1, 1, 'south')

    expect(session.interact()).toBeUndefined()
    session.setDirection('east')
    expect(session.interact()).toEqual({ kind: 'background', scriptId: 2, type: 0, direction: 4 })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved' })
  })

  it('resolves a validated destination anchor', () => {
    const bedroomEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 2, z: 1, header: 63, anchor: 0 }],
    }
    const salonEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 3, z: 2, header: 64, anchor: 0 }],
    }
    const bedroom = createMap(64, bedroomEvents)
    bedroom.terrain!.attributes[1 * bedroom.terrain!.width + 2] = hgssWarpMetatileBehaviors.warpEast
    const session = createWorldSession([bedroom, createMap(63, salonEvents)])
    session.loadMap(64, 1, 1, 'south')

    const move = session.tryMove(1, 0, 'east')
    expect(move).toMatchObject({
      kind: 'moved',
      state: { tileX: 2, tileZ: 1, direction: 'east' },
      warp: { header: 63, anchor: 0 },
      warpActivation: { trigger: 'completed-step-held', transition: 'direct', direction: 'east', heldDirection: 'east' },
    })
    expect(session.transitionTo(63, 0)).toMatchObject({ kind: 'transitioned', state: { tileX: 3, tileZ: 2, direction: 'east' } })
  })

  it('moves NPC collision state after entering a map through a warp', () => {
    const bedroomEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [],
      warps: [{ x: 2, z: 1, header: 63, anchor: 0 }],
    }
    const salonEvents: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 1 }],
      warps: [{ x: 3, z: 2, header: 64, anchor: 0 }],
    }
    const session = createWorldSession([createMap(64, bedroomEvents), createMap(63, salonEvents)])
    session.loadMap(64, 1, 1)
    session.transitionTo(63, 0)
    session.applyObjectMovement(7, [{ action: 12, repetitions: 1, kind: 'walk', direction: 'east', tileDistance: 0 }])

    expect(session.findEventAt(1, 1)).toBeUndefined()
    expect(session.findEventAt(2, 1)).toEqual({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('moves NPC collision by the ROM jump distance', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 1, z: 1 }],
      warps: [],
    }
    const session = createWorldSession([createMap(64, events)])
    session.loadMap(64, 0, 1)

    session.applyObjectMovement(7, [{ action: 55, repetitions: 1, kind: 'jump', direction: 'east', tileDistance: 1 }])

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved' })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'blocked', reason: 'npc' })
  })

  it('updates collision and interaction anchors after direct object relocation', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 1, movement: 0, type: 0, eventFlag: 0, scriptId: 42, facingDirection: 0, xRange: 0, zRange: 0, x: 2, z: 1 }],
      warps: [],
    }
    const session = createWorldSession([createMap(64, events)])
    session.loadMap(64, 1, 1, 'east')

    session.setObjectState(7, 3, 1, 'west')

    expect(session.findEventAt(2, 1)).toBeUndefined()
    expect(session.findEventAt(3, 1)).toEqual({ kind: 'npc', id: 7, scriptId: 42 })
    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved' })
    session.setDirection('east')
    expect(session.interact()).toEqual({ kind: 'npc', id: 7, scriptId: 42 })
  })

  it('keeps scripted player movement in the authoritative world state', () => {
    const session = createWorldSession([createMap(64)])
    session.loadMap(64, 1, 1, 'south')

    session.applyObjectMovement(255, [
      { action: 12, repetitions: 2, kind: 'walk', direction: 'east', tileDistance: 0 },
      { action: 0, repetitions: 1, kind: 'face', direction: 'north', tileDistance: 0 },
    ])

    expect(session.getState()).toMatchObject({ tileX: 3, tileZ: 1, direction: 'north' })
    expect(session.tryMove(0, 1, 'south')).toMatchObject({ kind: 'moved', state: { tileX: 3, tileZ: 2 } })
  })

  it('advances the follower behind native scripted player movement unless paused', () => {
    const session = createWorldSession([createMap(64)])
    session.loadMap(64, 1, 2, 'east')
    session.setFollowerEnabled(true)

    const follower = session.applyObjectMovement(255, [
      { action: 12, repetitions: 2, kind: 'walk', direction: 'east', tileDistance: 0 },
    ])

    expect(session.getState()).toMatchObject({ tileX: 3, tileZ: 2 })
    expect(follower).toMatchObject({
      follower: { tileX: 2, tileZ: 2, direction: 'east' },
      followerActions: [
        { direction: 'east', repetitions: 1 },
        { direction: 'east', repetitions: 1 },
      ],
    })

    session.applyObjectMovement(255, [
      { action: 15, repetitions: 1, kind: 'walk', direction: 'south', tileDistance: 0 },
    ], false)
    expect(session.getFollowerState()).toMatchObject({ tileX: 2, tileZ: 2 })
  })

  it('replays every corner of a scripted player path instead of interpolating to its endpoint', () => {
    const session = createWorldSession([createMap(64)])
    session.loadMap(64, 1, 2, 'east')
    session.setFollowerEnabled(true)

    const movement = session.applyObjectMovement(255, [
      { action: 12, repetitions: 1, kind: 'walk', direction: 'east', tileDistance: 0 },
      { action: 8, repetitions: 2, kind: 'walk', direction: 'north', tileDistance: 0 },
    ])

    expect(session.getState()).toMatchObject({ tileX: 2, tileZ: 0 })
    expect(movement).toMatchObject({
      follower: { tileX: 2, tileZ: 1, direction: 'north' },
      followerActions: [
        { direction: 'east', repetitions: 1 },
        { direction: 'east', repetitions: 1 },
        { direction: 'north', repetitions: 1 },
      ],
    })
  })

  it('triggers coordinate scripts from the stepped tile when the ROM variable matches', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{ scriptId: 88, x: 2, z: 1, width: 1, height: 1, y: 0, expectedValue: 5, variableId: 0x40ce }],
      objects: [],
      warps: [],
    }
    const session = createWorldSession([createMap(64, events)], new Set(), new Set(), new Map([[0x40ce, 5]]))
    session.loadMap(64, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      coordinate: { kind: 'coordinate', scriptId: 88, variableId: 0x40ce, expectedValue: 5 },
    })
  })

  it('observes live script variable updates for coordinate triggers', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{ scriptId: 92, x: 2, z: 1, width: 1, height: 1, y: 0, expectedValue: 1, variableId: 0x40cf }],
      objects: [],
      warps: [],
    }
    const variables = new Map<number, number>()
    const session = createWorldSession([createMap(64, events)], new Set(), new Set(), variables)
    session.loadMap(64, 1, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({ kind: 'moved', coordinate: undefined })

    session.loadMap(64, 1, 1, 'east')
    variables.set(0x40cf, 1)

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      coordinate: { kind: 'coordinate', scriptId: 92, variableId: 0x40cf, expectedValue: 1 },
    })
  })

  it('resolves coordinate trigger positions in matrix world coordinates', () => {
    const events: MapEventPreview = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [{ scriptId: 91, x: 33, z: 1, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 0x4000 }],
      objects: [],
      warps: [],
    }
    const session = createWorldSession([createFieldMap(61, events)])
    session.loadMap(61, 0, 1, 'east')

    expect(session.tryMove(1, 0, 'east')).toMatchObject({
      kind: 'moved',
      coordinate: { kind: 'coordinate', scriptId: 91 },
    })
  })
})
