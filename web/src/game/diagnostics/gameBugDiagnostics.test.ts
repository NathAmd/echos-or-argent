import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { FollowerWorldState, WorldState } from '../world/worldSession'
import {
  createGameBugDiagnosticsCollector,
  type GameBugDiagnosticState,
  type GameBugDiagnosticsPorts,
} from './gameBugDiagnostics'

function createMap(): OpeningMapPreview {
  return {
    id: 7,
    label: 'Route test',
    header: { mapId: 7, mapType: 4 },
    matrix: {
      matrixIndex: 0,
      name: 'test',
      width: 2,
      height: 2,
      headers: new Uint16Array([0, 7, 0, 7]),
      altitudes: new Uint8Array(4),
      modelIds: new Uint16Array(4),
    },
    events: {
      objects: [{ id: 1 }, { id: 2 }],
      warps: [{ x: 1 }, { x: 2 }, { x: 3 }],
      coordinateEvents: [{ scriptId: 9 }],
      backgrounds: [{ scriptId: 10 }, { scriptId: 11 }, { scriptId: 12 }, { scriptId: 13 }],
    },
    model: {
      positions: new Float32Array(6),
      surfaces: [{ positions: new Float32Array() }, { positions: new Float32Array() }],
      textures: [{ id: 'one' }],
      tileBounds: { minX: 1, maxX: 8, minZ: 2, maxZ: 9 },
    },
  } as unknown as OpeningMapPreview
}

function createState(): GameBugDiagnosticState {
  return {
    game: {
      flow: 'bedroom',
      activeSaveSlot: 2,
      lastSessionSaveAt: '2026-08-27T12:00:00.000Z',
      frameCounter: 912,
      options: { textSpeed: 'fast' },
      profile: { name: 'LYRA' },
      rom: { gameCode: 'IPKF' },
    },
    script: {
      activeFieldScript: { id: 18 },
      activeDoorTransition: true,
      pendingWarpTarget: { mapId: 8 },
      pendingCoordinateScriptId: 42,
      pendingWildEncounterCheck: true,
      forcedPlayerMovement: 'north',
    },
    battle: {
      active: { turn: 3 },
      activeDouble: undefined,
      uiMode: 'moves',
      cursor: 1,
      messageQueue: ['Un message'],
      messageInputLocked: false,
      presentationAnimationLocks: 1,
      playerSlot: 0,
      opponentSlot: 1,
      preparedEncounter: { speciesName: 'Hoothoot' },
    },
    ui: { utilityNotice: 'Sauvegarde prête' },
    logs: {
      errors: [{ kind: 'error' }],
      inputs: [{ kind: 'confirm' }],
      statuses: [{ kind: 'loaded' }],
    },
  }
}

function createPorts(overrides: Partial<GameBugDiagnosticsPorts> = {}): GameBugDiagnosticsPorts {
  const map = createMap()
  const world: WorldState = {
    map,
    tileX: 37,
    tileZ: 9,
    direction: 'west',
    locomotion: 'walking',
    groundHeight: 16,
  }
  const follower: FollowerWorldState = {
    map,
    tileX: 36,
    tileZ: 9,
    direction: 'east',
    movement: 12,
  }
  return {
    readState: createState,
    readWorldSession: () => ({
      getState: () => world,
      getFollowerState: () => follower,
      getFacingTerrainAttribute: () => 0x80,
    }),
    readMovementRuntime: () => ({
      isPlayerMoving: () => true,
      isFollowerMoving: () => false,
      isScriptMoving: () => true,
    }),
    readScriptExecution: () => ({
      getWait: () => 'input',
      getAcceptedInputs: () => ['confirm', 'cancel'],
      getSoundEffectId: () => 1500,
      getAsyncGeneration: () => 6,
    }),
    readDialogueRuntime: () => ({
      getSnapshot: () => ({ visible: true, fullText: 'Bonjour', pageIndex: 0 }),
    }),
    readMainMenu: () => ({ getState: () => ({ open: false, screen: 'root' }) }),
    readTitleMenu: () => ({ getState: () => ({ open: false, cursor: 0 }) }),
    readOakIntroRuntime: () => ({ getSnapshot: () => ({ renderState: { mode: 'dialog' } }) }),
    readDialogueSpeaker: () => 'Prof. Orme',
    readFadeOpacity: () => '0.35',
    readVisibleElements: () => [{ id: 'field-dialogue', opacity: '1' }],
    createReproductionState: (currentWorld, currentFollower) => ({
      saved: true,
      mapId: currentWorld.map.id,
      followerX: currentFollower?.tileX,
    }),
    ...overrides,
  }
}

describe('createGameBugDiagnosticsCollector', () => {
  it('projects the complete live game snapshot through injected ports', () => {
    const report = createGameBugDiagnosticsCollector(createPorts())()

    expect(report).toMatchObject({
      game: {
        flow: 'bedroom',
        activeSaveSlot: 2,
        frameCounter: 912,
        profile: { name: 'LYRA' },
      },
      world: {
        mapId: 7,
        mapLabel: 'Route test',
        mapOrigin: { x: 32, z: 0 },
        tileX: 37,
        tileZ: 9,
        direction: 'west',
        locomotion: 'walking',
        groundHeight: 16,
        facingTerrainAttribute: 0x80,
        follower: {
          mapId: 7,
          tileX: 36,
          tileZ: 9,
          direction: 'east',
          movement: 12,
        },
        eventCounts: { objects: 2, warps: 3, coordinates: 1, backgrounds: 4 },
        model: {
          positions: 6,
          surfaces: 2,
          textures: 1,
          tileBounds: { minX: 1, maxX: 8, minZ: 2, maxZ: 9 },
        },
        runtime: { playerMoving: true, followerMoving: false, scriptMoving: true },
      },
      script: {
        active: true,
        wait: 'input',
        acceptedInputs: ['confirm', 'cancel'],
        soundEffectId: 1500,
        asyncWaitToken: 6,
        doorTransition: true,
        pendingWarpTarget: { mapId: 8 },
        pendingCoordinateScriptId: 42,
        pendingWildEncounterCheck: true,
        forcedPlayerMovement: 'north',
        message: {
          speaker: 'Prof. Orme',
          visible: true,
          fullText: 'Bonjour',
          pageIndex: 0,
        },
      },
      battle: {
        active: { turn: 3 },
        uiMode: 'moves',
        cursor: 1,
        messageQueue: ['Un message'],
        inputLocked: true,
        playerSlot: 0,
        opponentSlot: 1,
        preparedEncounter: { speciesName: 'Hoothoot' },
      },
      ui: {
        mainMenu: { open: false, screen: 'root' },
        titleMenu: { open: false, cursor: 0 },
        oakIntro: { mode: 'dialog' },
        fadeOpacity: '0.35',
        utilityNotice: 'Sauvegarde prête',
        visibleElements: [{ id: 'field-dialogue', opacity: '1' }],
      },
      logs: {
        errors: [{ kind: 'error' }],
        inputs: [{ kind: 'confirm' }],
        statuses: [{ kind: 'loaded' }],
      },
      reproductionState: { saved: true, mapId: 7, followerX: 36 },
    })
  })

  it('does not probe world-only runtimes or reproduction without a world', () => {
    const createReproductionState = vi.fn()
    const isPlayerMoving = vi.fn(() => false)
    const report = createGameBugDiagnosticsCollector(createPorts({
      readWorldSession: () => undefined,
      readMovementRuntime: () => ({
        isPlayerMoving,
        isFollowerMoving: vi.fn(() => false),
        isScriptMoving: vi.fn(() => false),
      }),
      createReproductionState,
    }))()

    expect(report).not.toHaveProperty('world')
    expect(report).not.toHaveProperty('reproductionState')
    expect(report).not.toHaveProperty('reproductionError')
    expect(createReproductionState).not.toHaveBeenCalled()
    expect(isPlayerMoving).not.toHaveBeenCalled()
  })

  it('keeps the report usable when reproduction state construction fails', () => {
    const report = createGameBugDiagnosticsCollector(createPorts({
      createReproductionState: () => { throw new TypeError('save failed') },
    }))()

    expect(report).not.toHaveProperty('reproductionState')
    expect(report.reproductionError).toMatchObject({
      name: 'TypeError',
      message: 'save failed',
      stack: expect.any(String),
    })
    expect(report).toHaveProperty('world.mapId', 7)
  })

  it('normalizes rich and circular battle values', () => {
    const activeBattle: Record<string, unknown> = { turn: 4, seed: 9n }
    activeBattle.self = activeBattle
    const baseState = createState()
    const report = createGameBugDiagnosticsCollector(createPorts({
      readState: () => ({
        ...baseState,
        battle: { ...baseState.battle, active: activeBattle },
      }),
    }))()

    expect(report).toHaveProperty('battle.active', {
      turn: 4,
      seed: '9',
      self: '[Circular]',
    })
  })

  it('reads fresh state for every report and detaches previous snapshots', () => {
    let frameCounter = 1
    const messages = ['premier']
    const baseState = createState()
    const collect = createGameBugDiagnosticsCollector(createPorts({
      readState: () => ({
        ...baseState,
        game: { ...baseState.game, frameCounter },
        battle: { ...baseState.battle, messageQueue: messages },
      }),
    }))

    const first = collect()
    frameCounter = 2
    messages.push('second')
    const second = collect()

    expect(first).toHaveProperty('game.frameCounter', 1)
    expect(first).toHaveProperty('battle.messageQueue', ['premier'])
    expect(second).toHaveProperty('game.frameCounter', 2)
    expect(second).toHaveProperty('battle.messageQueue', ['premier', 'second'])
  })
})
