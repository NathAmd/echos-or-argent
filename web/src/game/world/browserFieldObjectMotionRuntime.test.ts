import { describe, expect, it, vi } from 'vitest'
import type { MapEventPreview, OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  createBrowserFieldObjectMotionRuntime,
  type BrowserFieldObjectMotionState,
  type BrowserFieldObjectMotionWorldPort,
} from './browserFieldObjectMotionRuntime'
import {
  hgssFollowerObjectId,
  type WorldMoveResult,
  type WorldObjectMovement,
  type WorldState,
} from './worldSession'

type Deferred = {
  promise: Promise<void>
  resolve: () => void
  reject: (reason?: unknown) => void
}

function deferred(): Deferred {
  let resolve!: () => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<void>((accept, decline) => {
    resolve = accept
    reject = decline
  })
  return { promise, resolve, reject }
}

async function flushPromises(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function object(
  id: number,
  movement: number,
  x: number,
  z: number,
  overrides: Partial<MapEventPreview['objects'][number]> = {},
): MapEventPreview['objects'][number] {
  return {
    id,
    spriteId: 1,
    movement,
    type: 0,
    eventFlag: 0,
    scriptId: 0,
    facingDirection: 1,
    parameters: [0, 0, 0],
    xRange: 4,
    zRange: 4,
    x,
    z,
    ...overrides,
  }
}

function createMap(objects: MapEventPreview['objects'] = []): OpeningMapPreview {
  const id = 42
  return {
    id,
    label: 'Field object motion test map',
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
      name: 'field-object-motion',
      width: 3,
      height: 2,
      headers: new Uint16Array([9, 9, 9, 9, 9, id]),
      altitudes: new Uint8Array(6),
      modelIds: new Uint16Array(6),
    },
    events: { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects, warps: [] },
    terrain: { modelId: 0, width: 32, height: 32, attributes: new Uint16Array(32 * 32) },
  }
}

function rng(): HgssLcrng {
  let seed = 0
  return {
    getSeed: () => seed,
    nextU16: () => seed++,
  }
}

function moveResult(objectMovements: WorldObjectMovement[]): WorldMoveResult {
  return { kind: 'blocked', reason: 'npc', tileX: 0, tileZ: 0, objectMovements }
}

function pushedMovement(overrides: Partial<WorldObjectMovement> = {}): WorldObjectMovement {
  return {
    objectId: 1,
    kind: 'strength-push',
    direction: 'east',
    finalDirection: 'north',
    distance: 2,
    worldX: 70,
    worldZ: 40,
    tileX: 6,
    tileZ: 8,
    ...overrides,
  }
}

describe('browser field object motion runtime', () => {
  it('projects pushed actor state and preserves actor/follower animation commands until every task settles', async () => {
    const actor = { x: 1, z: 2, direction: 'south' as const, movement: 0 }
    const state: BrowserFieldObjectMotionState = {
      objects: new Map([[1, actor]]),
      flags: new Set(),
      hiddenObjectIds: new Set(),
    }
    const actorTask = deferred()
    const followerTask = deferred()
    const tasks = [actorTask, followerTask]
    const applyMovement = vi.fn(() => tasks.shift()!.promise)
    const syncEventVisibility = vi.fn(() => undefined)
    const runtime = createBrowserFieldObjectMotionRuntime({
      readState: () => state,
      readWorldSession: () => undefined,
      readRng: () => undefined,
      readVBlankFrame: () => 0,
      isFieldScriptActive: () => false,
      runtime: {
        applyMovement,
        isActorMoving: () => false,
        setActorDirection: () => undefined,
        syncEventVisibility,
      },
    })

    runtime.applyMoveResult(moveResult([
      pushedMovement(),
      pushedMovement({
        objectId: hgssFollowerObjectId,
        kind: 'strength-fall',
        direction: 'south',
        finalDirection: 'south',
        distance: 0,
      }),
    ]))

    expect(actor).toEqual({ x: 70, z: 40, direction: 'north', movement: 0 })
    expect(applyMovement.mock.calls).toEqual([
      [1, [
        { action: 15, repetitions: 2, direction: 'east', tileDistance: 0, kind: 'walk' },
        { action: 0, repetitions: 1, direction: 'north', tileDistance: 0, kind: 'face' },
      ]],
      [hgssFollowerObjectId, [
        { action: 69, repetitions: 1, tileDistance: 0, kind: 'effect' },
      ]],
    ])
    expect(runtime.isInputBlocked()).toBe(true)

    actorTask.resolve()
    await flushPromises()
    expect(runtime.isInputBlocked()).toBe(true)
    expect(syncEventVisibility).not.toHaveBeenCalled()

    followerTask.resolve()
    await flushPromises()
    expect(runtime.isInputBlocked()).toBe(false)
    expect(syncEventVisibility).toHaveBeenCalledOnce()
    expect(syncEventVisibility).toHaveBeenCalledWith(state)
  })

  it('does not let stale or invalidated push promises release a newer input lock', async () => {
    const state: BrowserFieldObjectMotionState = { objects: new Map(), flags: new Set(), hiddenObjectIds: new Set() }
    const first = deferred()
    const second = deferred()
    const invalidated = deferred()
    const tasks = [first, second, invalidated]
    const syncEventVisibility = vi.fn()
    const runtime = createBrowserFieldObjectMotionRuntime({
      readState: () => state,
      readWorldSession: () => undefined,
      readRng: () => undefined,
      readVBlankFrame: () => 0,
      isFieldScriptActive: () => false,
      runtime: {
        applyMovement: () => tasks.shift()!.promise,
        isActorMoving: () => false,
        setActorDirection: () => undefined,
        syncEventVisibility,
      },
    })

    runtime.applyMoveResult(moveResult([pushedMovement()]))
    runtime.applyMoveResult(moveResult([pushedMovement({ objectId: 2 })]))
    first.resolve()
    await flushPromises()
    expect(runtime.isInputBlocked()).toBe(true)

    second.resolve()
    await flushPromises()
    expect(runtime.isInputBlocked()).toBe(false)

    runtime.applyMoveResult(moveResult([pushedMovement({ objectId: 3 })]))
    expect(runtime.isInputBlocked()).toBe(true)
    runtime.invalidate()
    expect(runtime.isInputBlocked()).toBe(false)
    invalidated.resolve()
    await flushPromises()
    expect(runtime.isInputBlocked()).toBe(false)
    expect(syncEventVisibility).toHaveBeenCalledTimes(3)
  })

  it('converts field origins for player awareness and autonomous object movement', () => {
    const templates = [
      object(1, 2, 67, 37, { type: 1, parameters: [2, 0, 0] }),
      object(2, 20, 66, 36, { facingDirection: 3 }),
    ]
    const map = createMap(templates)
    const world: WorldState = { map, tileX: 2, tileZ: 5, direction: 'south', locomotion: 'walking' }
    const state: BrowserFieldObjectMotionState = {
      objects: new Map([
        [1, { x: 67, z: 37, direction: 'south', movement: 2 }],
        [2, { x: 66, z: 36, direction: 'east', movement: 20 }],
      ]),
      flags: new Set(),
      hiddenObjectIds: new Set(),
    }
    const setObjectState = vi.fn(() => undefined)
    const tryMoveObject = vi.fn((objectId: number, direction: PlayerDirection) => (
      objectId === 2 && direction === 'east' ? { tileX: 3, tileZ: 4 } : undefined
    ))
    const session: BrowserFieldObjectMotionWorldPort = {
      getState: () => world,
      setObjectState,
      tryMoveObject,
    }
    const applyMovement = vi.fn(async () => undefined)
    const setActorDirection = vi.fn()
    let frame = 0
    let scriptActive = true
    const runtime = createBrowserFieldObjectMotionRuntime({
      readState: () => state,
      readWorldSession: () => session,
      readRng: rng,
      readVBlankFrame: () => frame,
      isFieldScriptActive: () => scriptActive,
      runtime: {
        applyMovement,
        isActorMoving: () => false,
        setActorDirection,
        syncEventVisibility: () => undefined,
      },
    })

    runtime.reset()
    runtime.tick()
    expect(setActorDirection).not.toHaveBeenCalled()
    expect(tryMoveObject).not.toHaveBeenCalled()

    scriptActive = false
    frame = 1
    runtime.tick()

    expect(setActorDirection.mock.calls).toEqual([[1, 'west'], [2, 'east']])
    expect(setObjectState.mock.calls).toEqual([
      [1, undefined, undefined, 'west'],
      [2, undefined, undefined, 'east'],
    ])
    expect(tryMoveObject).toHaveBeenCalledWith(2, 'east')
    expect(state.objects.get(2)).toEqual({ x: 67, z: 36, direction: 'east', movement: 20 })
    expect(applyMovement).toHaveBeenCalledWith(2, [{
      action: 15,
      repetitions: 1,
      direction: 'east',
      tileDistance: 0,
      kind: 'walk',
    }])
  })

  it('releases the push lock and refreshes visibility when an animation rejects', async () => {
    const state: BrowserFieldObjectMotionState = { objects: new Map(), flags: new Set(), hiddenObjectIds: new Set() }
    const task = deferred()
    const syncEventVisibility = vi.fn()
    const runtime = createBrowserFieldObjectMotionRuntime({
      readState: () => state,
      readWorldSession: () => undefined,
      readRng: () => undefined,
      readVBlankFrame: () => 0,
      isFieldScriptActive: () => false,
      runtime: {
        applyMovement: () => task.promise,
        isActorMoving: () => false,
        setActorDirection: () => undefined,
        syncEventVisibility,
      },
    })

    runtime.applyMoveResult(moveResult([pushedMovement()]))
    task.reject(new Error('animation interrupted'))
    await flushPromises()

    expect(runtime.isInputBlocked()).toBe(false)
    expect(syncEventVisibility).toHaveBeenCalledWith(state)
  })
})
