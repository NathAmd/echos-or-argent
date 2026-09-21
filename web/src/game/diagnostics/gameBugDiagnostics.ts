import { copyBugDiagnosticValue } from './bugReportSnapshot'
import { diagnosticErrorDetail } from './runtimeDiagnosticLog'
import { getMapOrigin } from '../world/mapCoordinates'
import type { FollowerWorldState, WorldSession, WorldState } from '../world/worldSession'

type DiagnosticWorldSession = Pick<
  WorldSession,
  'getState' | 'getFollowerState' | 'getFacingTerrainAttribute'
>

type DiagnosticMovementRuntime = Readonly<{
  isPlayerMoving: () => boolean
  isFollowerMoving: () => boolean
  isScriptMoving: () => boolean
}>

type DiagnosticScriptExecution = Readonly<{
  getWait: () => unknown
  getAcceptedInputs: () => readonly unknown[]
  getSoundEffectId: () => unknown
  getAsyncGeneration: () => number
}>

type DiagnosticDialogueRuntime = Readonly<{
  getSnapshot: () => object
}>

type DiagnosticStateController = Readonly<{
  getState: () => unknown
}>

type DiagnosticOakIntroRuntime = Readonly<{
  getSnapshot: () => Readonly<{ renderState?: unknown }>
}>

export type GameBugDiagnosticState = Readonly<{
  game: Readonly<{
    flow: unknown
    activeSaveSlot: unknown
    lastSessionSaveAt: unknown
    frameCounter: number
    options: unknown
    profile: unknown
    rom: unknown
  }>
  script: Readonly<{
    activeFieldScript: unknown
    activeDoorTransition: unknown
    pendingWarpTarget: unknown
    pendingCoordinateScriptId: unknown
    pendingWildEncounterCheck: unknown
    forcedPlayerMovement: unknown
  }>
  battle: Readonly<{
    active: unknown
    activeDouble: unknown
    uiMode: unknown
    cursor: unknown
    messageQueue: readonly unknown[]
    messageInputLocked: boolean
    presentationAnimationLocks: number
    playerSlot: unknown
    opponentSlot: unknown
    preparedEncounter: unknown
  }>
  ui: Readonly<{
    utilityNotice: unknown
  }>
  logs: Readonly<{
    errors: readonly unknown[]
    inputs: readonly unknown[]
    statuses: readonly unknown[]
  }>
}>

export type GameBugDiagnosticsPorts = Readonly<{
  readState: () => GameBugDiagnosticState
  readWorldSession: () => DiagnosticWorldSession | undefined
  readMovementRuntime: () => DiagnosticMovementRuntime
  readScriptExecution: () => DiagnosticScriptExecution
  readDialogueRuntime: () => DiagnosticDialogueRuntime
  readMainMenu: () => DiagnosticStateController
  readTitleMenu: () => DiagnosticStateController
  readOakIntroRuntime: () => DiagnosticOakIntroRuntime
  readDialogueSpeaker: () => string | null | undefined
  readFadeOpacity: () => string
  readVisibleElements: () => readonly Record<string, unknown>[]
  createReproductionState: (world: WorldState, follower: FollowerWorldState | undefined) => unknown
}>

export type GameBugDiagnosticsCollector = () => Record<string, unknown>

/**
 * Projects the live game runtimes into the serializable state attached to a bug
 * report. Browser-only observations stay behind readers so this collector can be
 * exercised without installing DOM globals.
 */
export function createGameBugDiagnosticsCollector(
  ports: GameBugDiagnosticsPorts,
): GameBugDiagnosticsCollector {
  return () => {
    const state = ports.readState()
    const worldSession = ports.readWorldSession()
    const world = worldSession?.getState()
    const follower = worldSession?.getFollowerState()
    const worldRuntime = world && (() => {
      const runtime = ports.readMovementRuntime()
      return {
        playerMoving: runtime.isPlayerMoving(),
        followerMoving: runtime.isFollowerMoving(),
        scriptMoving: runtime.isScriptMoving(),
      }
    })()
    const compactFollower = follower && {
      mapId: follower.map.id,
      tileX: follower.tileX,
      tileZ: follower.tileZ,
      direction: follower.direction,
      movement: follower.movement,
    }

    let reproductionState: unknown
    let reproductionError: unknown
    if (world) {
      try {
        reproductionState = ports.createReproductionState(world, follower)
      } catch (error) {
        reproductionError = diagnosticErrorDetail(error)
      }
    }

    const map = world?.map
    const scriptExecution = ports.readScriptExecution()
    const dialogueRuntime = ports.readDialogueRuntime()
    return copyBugDiagnosticValue({
      game: state.game,
      world: world && {
        mapId: map?.id,
        mapLabel: map?.label,
        mapHeader: map?.header,
        mapOrigin: map && getMapOrigin(map),
        tileX: world.tileX,
        tileZ: world.tileZ,
        direction: world.direction,
        locomotion: world.locomotion,
        groundHeight: world.groundHeight,
        facingTerrainAttribute: worldSession?.getFacingTerrainAttribute(),
        follower: compactFollower,
        eventCounts: map?.events && {
          objects: map.events.objects.length,
          warps: map.events.warps.length,
          coordinates: map.events.coordinateEvents.length,
          backgrounds: map.events.backgrounds.length,
        },
        model: map?.model && {
          positions: map.model.positions?.length ?? 0,
          surfaces: map.model.surfaces?.length ?? 0,
          textures: map.model.textures?.length ?? 0,
          tileBounds: map.model.tileBounds,
        },
        runtime: worldRuntime,
      },
      script: {
        active: Boolean(state.script.activeFieldScript),
        wait: scriptExecution.getWait(),
        acceptedInputs: scriptExecution.getAcceptedInputs(),
        soundEffectId: scriptExecution.getSoundEffectId(),
        asyncWaitToken: scriptExecution.getAsyncGeneration(),
        doorTransition: state.script.activeDoorTransition,
        pendingWarpTarget: state.script.pendingWarpTarget,
        pendingCoordinateScriptId: state.script.pendingCoordinateScriptId,
        pendingWildEncounterCheck: state.script.pendingWildEncounterCheck,
        forcedPlayerMovement: state.script.forcedPlayerMovement,
        message: {
          speaker: ports.readDialogueSpeaker(),
          ...dialogueRuntime.getSnapshot(),
        },
      },
      battle: {
        active: copyBugDiagnosticValue(state.battle.active),
        activeDouble: copyBugDiagnosticValue(state.battle.activeDouble),
        uiMode: state.battle.uiMode,
        cursor: state.battle.cursor,
        messageQueue: [...state.battle.messageQueue],
        inputLocked: state.battle.messageInputLocked || state.battle.presentationAnimationLocks > 0,
        playerSlot: state.battle.playerSlot,
        opponentSlot: state.battle.opponentSlot,
        preparedEncounter: state.battle.preparedEncounter,
      },
      ui: {
        mainMenu: ports.readMainMenu().getState(),
        titleMenu: ports.readTitleMenu().getState(),
        oakIntro: ports.readOakIntroRuntime().getSnapshot().renderState,
        fadeOpacity: ports.readFadeOpacity(),
        utilityNotice: state.ui.utilityNotice,
        visibleElements: ports.readVisibleElements(),
      },
      logs: state.logs,
      reproductionState,
      reproductionError,
    }) as Record<string, unknown>
  }
}
