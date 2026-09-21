import type { RealtimeTestDebugCommand } from './realtimeTestScript'

export type RealtimeJourneyStatus =
  | 'idle'
  | 'running'
  | 'paused-for-battle'
  | 'finalizing'
  | 'passed'
  | 'failed'
  | 'stopped'

export type RealtimeJourneyBattle = 'none' | 'simple' | 'double' | 'safari'

export type RealtimeJourneyGoal = 'zephyr-badge' | 'togepi-egg' | 'hive-badge' | 'plain-badge' | 'fog-badge'

export type RealtimeJourneyCheckpoint = Readonly<{
  id: string
  label: string
}>

export type RealtimeJourneySnapshot = Readonly<{
  battle: RealtimeJourneyBattle
  debugReady: boolean
  script: boolean
  zephyrBadge: boolean
  falknerDefeated: boolean
  togepiEggReceived: boolean
  togepiReturnComplete: boolean
  slowpokeWellCleared: boolean
  hiveBadge: boolean
  bugsyDefeated: boolean
  hiveGymComplete: boolean
  ilexForestCleared: boolean
  cutLearned: boolean
  radioQuizComplete: boolean
  plainBadge: boolean
  whitneyDefeated: boolean
  plainGymComplete: boolean
  squirtBottleReceived: boolean
  sudowoodoCleared: boolean
  legendaryBeastsReleased: boolean
  fogBadge: boolean
  mortyDefeated: boolean
  fogGymComplete: boolean
  checkpoint?: RealtimeJourneyCheckpoint
  error?: unknown
}>

export type RealtimeJourneyPersistenceResult = Readonly<{
  saveReady: boolean
  error?: unknown
}>

export type RealtimeJourneyPersistenceCallback = (result: RealtimeJourneyPersistenceResult) => void
export type RealtimeJourneyDebugCommand = Extract<RealtimeTestDebugCommand, { kind: 'godmode' | 'instant-kill' }>

export type RealtimeJourneyHostCallbacks = Readonly<{
  startTerrain: (seed: number) => void
  pauseTerrain: () => void
  resumeTerrain: () => void
  stopTerrain: () => void
  advanceBattle: () => void
  executeDebugCommand: (command: RealtimeJourneyDebugCommand) => unknown
  requestPersistence: (confirm: RealtimeJourneyPersistenceCallback) => void | (() => void)
  onStateChange?: (state: RealtimeJourneyState) => void
}>

export type RealtimeJourneyHost = RealtimeJourneyHostCallbacks

export type RealtimeJourneyStart = Readonly<{
  seed: number
  goal?: RealtimeJourneyGoal
  checkpoint?: RealtimeJourneyCheckpoint
}>

export type RealtimeJourneyState = Readonly<{
  status: RealtimeJourneyStatus
  seed?: number
  checkpoint?: RealtimeJourneyCheckpoint
  error?: Error
}>

export type RealtimeJourneyCoordinator = Readonly<{
  start: (request: RealtimeJourneyStart) => boolean
  tick: (snapshot: RealtimeJourneySnapshot) => void
  stop: () => boolean
  getState: () => RealtimeJourneyState
}>

const activeStatuses = new Set<RealtimeJourneyStatus>(['running', 'paused-for-battle', 'finalizing'])

function copyCheckpoint(checkpoint: RealtimeJourneyCheckpoint | undefined): RealtimeJourneyCheckpoint | undefined {
  return checkpoint ? Object.freeze({ id: checkpoint.id, label: checkpoint.label }) : undefined
}

function sameCheckpoint(left: RealtimeJourneyCheckpoint | undefined, right: RealtimeJourneyCheckpoint | undefined): boolean {
  return left?.id === right?.id && left?.label === right?.label
}

function asError(error: unknown, fallback: string): Error {
  if (error instanceof Error) return error
  if (typeof error === 'string' && error.trim()) return new Error(error)
  return new Error(fallback)
}

function resolveGoal(goal: RealtimeJourneyGoal | undefined): RealtimeJourneyGoal {
  if (goal === undefined || goal === 'zephyr-badge') return 'zephyr-badge'
  if (goal === 'togepi-egg' || goal === 'hive-badge' || goal === 'plain-badge' || goal === 'fog-badge') return goal
  throw new RangeError(`Jalon de campagne temps réel inconnu : ${String(goal)}.`)
}

function isJourneyGoalReached(snapshot: RealtimeJourneySnapshot, goal: RealtimeJourneyGoal): boolean {
  const zephyrReached = snapshot.zephyrBadge
    && snapshot.falknerDefeated
    && snapshot.battle === 'none'
    && !snapshot.script
  switch (goal) {
    case 'zephyr-badge': return zephyrReached
    case 'togepi-egg': return zephyrReached && snapshot.togepiEggReceived && snapshot.togepiReturnComplete
    case 'hive-badge': return zephyrReached
      && snapshot.togepiEggReceived
      && snapshot.slowpokeWellCleared
      && snapshot.hiveBadge
      && snapshot.bugsyDefeated
      && snapshot.hiveGymComplete
    case 'plain-badge': return zephyrReached
      && snapshot.togepiEggReceived
      && snapshot.slowpokeWellCleared
      && snapshot.hiveBadge
      && snapshot.bugsyDefeated
      && snapshot.ilexForestCleared
      && snapshot.cutLearned
      && snapshot.radioQuizComplete
      && snapshot.plainBadge
      && snapshot.whitneyDefeated
      && snapshot.plainGymComplete
    case 'fog-badge': return zephyrReached
      && snapshot.togepiEggReceived
      && snapshot.slowpokeWellCleared
      && snapshot.hiveBadge
      && snapshot.bugsyDefeated
      && snapshot.ilexForestCleared
      && snapshot.cutLearned
      && snapshot.radioQuizComplete
      && snapshot.plainBadge
      && snapshot.whitneyDefeated
      && snapshot.squirtBottleReceived
      && snapshot.sudowoodoCleared
      && snapshot.legendaryBeastsReleased
      && snapshot.fogBadge
      && snapshot.mortyDefeated
      && snapshot.fogGymComplete
    default: throw new RangeError(`Jalon de campagne temps réel inconnu : ${String(goal)}.`)
  }
}

function createState(
  status: RealtimeJourneyStatus,
  seed?: number,
  checkpoint?: RealtimeJourneyCheckpoint,
  error?: Error,
): RealtimeJourneyState {
  return Object.freeze({ status, seed, checkpoint: copyCheckpoint(checkpoint), error })
}

/**
 * Coordinates a live campaign milestone without owning a clock, input,
 * storage or presentation. The host feeds snapshots through `tick` and owns
 * every side effect behind the callbacks above.
 */
export function createRealtimeJourneyCoordinator(host: RealtimeJourneyHostCallbacks): RealtimeJourneyCoordinator {
  let state = createState('idle')
  let activeGoal: RealtimeJourneyGoal = 'zephyr-badge'
  let runToken = 0
  let terrainActive = false
  let godModeRequested = false
  let instantKillRequested = false
  let finalSnapshotValid = false
  let persistencePending = false
  let cancelPersistence: (() => void) | undefined

  const publish = (next: RealtimeJourneyState): void => {
    state = next
    host.onStateChange?.(state)
  }

  const isCurrentRun = (token: number): boolean => token === runToken && activeStatuses.has(state.status)
  const isRunAt = (token: number, status: RealtimeJourneyStatus): boolean => token === runToken && state.status === status

  const finish = (status: 'passed' | 'failed' | 'stopped', error?: Error): boolean => {
    if (!activeStatuses.has(state.status)) return false
    runToken += 1
    const persistenceCancellation = persistencePending ? cancelPersistence : undefined
    persistencePending = false
    cancelPersistence = undefined
    const shouldStopTerrain = terrainActive
    terrainActive = false

    let finalStatus = status
    let finalError = error
    try {
      persistenceCancellation?.()
    } catch (caught) {
      finalStatus = 'failed'
      finalError = asError(caught, 'L’annulation de la sauvegarde du parcours a échoué.')
    }
    try {
      if (shouldStopTerrain) host.stopTerrain()
    } catch (caught) {
      finalStatus = 'failed'
      finalError = asError(caught, 'L’arrêt du parcours terrain a échoué.')
    }
    publish(createState(finalStatus, state.seed, state.checkpoint, finalStatus === 'failed' ? finalError : undefined))
    return true
  }

  const fail = (error: unknown, fallback: string): void => {
    finish('failed', asError(error, fallback))
  }

  const requestBattleCommands = (token: number): void => {
    try {
      if (!godModeRequested) {
        godModeRequested = true
        host.executeDebugCommand({ kind: 'godmode', enabled: true })
      }
      if (!isCurrentRun(token) || state.status !== 'paused-for-battle') return
      if (!instantKillRequested) {
        instantKillRequested = true
        host.executeDebugCommand({ kind: 'instant-kill' })
      }
    } catch (error) {
      if (isCurrentRun(token)) fail(error, 'La préparation automatique du combat a échoué.')
    }
  }

  const advanceBattle = (token: number): void => {
    try {
      host.advanceBattle()
    } catch (error) {
      if (isCurrentRun(token)) fail(error, 'La progression automatique de la présentation du combat a échoué.')
    }
  }

  const beginFinalization = (token: number): void => {
    const completion = activeGoal === 'fog-badge'
      ? { id: 'fog-badge-complete', label: 'Badge Brume obtenu' }
      : activeGoal === 'plain-badge'
        ? { id: 'plain-badge-complete', label: 'Badge Plaine obtenu' }
      : activeGoal === 'hive-badge'
        ? { id: 'hive-badge-complete', label: 'Badge Essaim obtenu' }
        : state.checkpoint
    publish(createState('finalizing', state.seed, completion))
    if (!isCurrentRun(token) || state.status !== 'finalizing') return

    if (terrainActive) {
      terrainActive = false
      try {
        host.stopTerrain()
      } catch (error) {
        fail(error, 'L’arrêt du parcours terrain avant sauvegarde a échoué.')
        return
      }
    }
    if (!isCurrentRun(token) || state.status !== 'finalizing') return

    persistencePending = true
    let callbackSettled = false
    const confirm: RealtimeJourneyPersistenceCallback = (result) => {
      if (token !== runToken || state.status !== 'finalizing' || !persistencePending) return
      callbackSettled = true
      persistencePending = false
      cancelPersistence = undefined
      if (result.error !== undefined) {
        fail(result.error, 'La sauvegarde finale du parcours a échoué.')
      } else if (!result.saveReady) {
        fail(new Error('La sauvegarde finale n’est pas prête.'), 'La sauvegarde finale n’est pas prête.')
      } else if (!finalSnapshotValid) {
        fail(new Error('L’état du jalon de campagne n’est plus stable au moment de sauvegarder.'), 'Le parcours n’est plus dans un état final valide.')
      } else {
        finish('passed')
      }
    }

    try {
      const cancellation = host.requestPersistence(confirm)
      if (typeof cancellation !== 'function') return
      if (token === runToken && state.status === 'finalizing' && persistencePending) {
        cancelPersistence = cancellation
      } else if (!callbackSettled) {
        cancellation()
      }
    } catch (error) {
      if (token === runToken && state.status === 'finalizing') {
        persistencePending = false
        fail(error, 'La demande de sauvegarde finale a échoué.')
      }
    }
  }

  return {
    start(request) {
      const goal = resolveGoal(request.goal)
      if (activeStatuses.has(state.status)) return false
      if (!Number.isSafeInteger(request.seed) || request.seed < 0) {
        throw new RangeError('La seed du parcours doit être un entier sûr positif ou nul.')
      }
      runToken += 1
      const token = runToken
      terrainActive = false
      godModeRequested = false
      instantKillRequested = false
      finalSnapshotValid = false
      persistencePending = false
      cancelPersistence = undefined
      activeGoal = goal
      publish(createState('running', request.seed, request.checkpoint))
      if (!isCurrentRun(token)) return true
      terrainActive = true
      try {
        host.startTerrain(request.seed)
      } catch (error) {
        fail(error, 'Le démarrage du parcours terrain a échoué.')
      }
      return true
    },

    tick(snapshot) {
      if (!activeStatuses.has(state.status)) return
      const token = runToken
      if (state.status !== 'finalizing' && snapshot.checkpoint && !sameCheckpoint(snapshot.checkpoint, state.checkpoint)) {
        publish(createState(state.status, state.seed, snapshot.checkpoint, state.error))
        if (!isCurrentRun(token)) return
      }
      if (snapshot.error !== undefined) {
        fail(snapshot.error, 'Le parcours terrain a signalé une erreur.')
        return
      }

      if (state.status === 'finalizing') {
        finalSnapshotValid = isJourneyGoalReached(snapshot, activeGoal)
        if (!finalSnapshotValid) {
          fail(new Error('Le combat ou le script a repris avant la confirmation de sauvegarde.'), 'L’état final du parcours est devenu invalide.')
        }
        return
      }

      if (state.status === 'paused-for-battle') {
        if (snapshot.battle === 'none') {
          godModeRequested = false
          instantKillRequested = false
          publish(createState('running', state.seed, state.checkpoint))
          if (!isRunAt(token, 'running')) return
          try {
            host.resumeTerrain()
          } catch (error) {
            fail(error, 'La reprise du parcours terrain a échoué.')
          }
          return
        }
        if (snapshot.battle === 'safari') {
          fail(new Error('Cette campagne ne doit pas entrer dans le Parc Safari.'), 'Combat Safari inattendu.')
          return
        }
        if (snapshot.debugReady) {
          if (!instantKillRequested) requestBattleCommands(token)
        } else advanceBattle(token)
        return
      }

      if (snapshot.battle !== 'none') {
        publish(createState('paused-for-battle', state.seed, state.checkpoint))
        if (!isRunAt(token, 'paused-for-battle')) return
        try {
          host.pauseTerrain()
        } catch (error) {
          fail(error, 'La pause du parcours terrain a échoué.')
          return
        }
        if (!isRunAt(token, 'paused-for-battle')) return
        if (snapshot.battle === 'safari') fail(new Error('Cette campagne ne doit pas entrer dans le Parc Safari.'), 'Combat Safari inattendu.')
        else if (snapshot.debugReady) requestBattleCommands(token)
        else advanceBattle(token)
        return
      }

      if (!isJourneyGoalReached(snapshot, activeGoal)) return
      finalSnapshotValid = true
      beginFinalization(token)
    },

    stop() {
      return finish('stopped')
    },

    getState() {
      return state
    },
  }
}
