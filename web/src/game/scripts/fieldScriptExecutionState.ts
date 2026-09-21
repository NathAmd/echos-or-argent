import type { GameDigitalAction } from '../../gameInput'
import type { FieldScriptWaitKind } from '../ui/fieldDialogWait'
import type { FieldScriptRunner, FieldScriptStep } from './fieldScriptProtocol'

export type FieldScriptAcceptedInput = Extract<FieldScriptStep, { kind: 'inputWait' }>['accepts'][number]

export type FieldScriptExecutionWaitKind = FieldScriptWaitKind

export type FieldScriptAsyncWaitToken<TRunner> = Readonly<{
  generation: number
  wait: FieldScriptExecutionWaitKind
  runner: TRunner | undefined
  runnerBound: boolean
}>

export type FieldScriptExecutionSnapshot = Readonly<{
  active: boolean
  wait: FieldScriptExecutionWaitKind | undefined
  acceptedInputs: readonly FieldScriptAcceptedInput[]
  asyncGeneration: number
  pendingMovementTaskCount: number
  soundEffectId: number | undefined
}>

export type FieldScriptRunnerStorage<TRunner> = Readonly<{
  read: () => TRunner | undefined
  write: (runner: TRunner | undefined) => void
}>

export type FieldScriptBeginWaitOptions = Readonly<{
  acceptedInputs?: readonly FieldScriptAcceptedInput[]
  soundEffectId?: number
}>

export type FieldScriptBeginAsyncWaitOptions = FieldScriptBeginWaitOptions & Readonly<{
  bindRunner?: boolean
}>

export type FieldScriptClearWaitOptions = Readonly<{
  invalidateAsync?: boolean
  clearAcceptedInputs?: boolean
  clearSoundEffect?: boolean
}>

export type FieldScriptExecutionState<TRunner> = Readonly<{
  getRunner: () => TRunner | undefined
  setRunner: (runner: TRunner | undefined) => void
  getWait: () => FieldScriptExecutionWaitKind | undefined
  getAcceptedInputs: () => readonly FieldScriptAcceptedInput[]
  getAsyncGeneration: () => number
  getPendingMovementTaskCount: () => number
  getSoundEffectId: () => number | undefined
  snapshot: () => FieldScriptExecutionSnapshot
  reset: () => void
  beginWait: (wait: FieldScriptExecutionWaitKind, options?: FieldScriptBeginWaitOptions) => void
  beginAsyncWait: (wait: FieldScriptExecutionWaitKind, options?: FieldScriptBeginAsyncWaitOptions) => FieldScriptAsyncWaitToken<TRunner>
  clearWait: (options?: FieldScriptClearWaitOptions) => void
  invalidateAsync: () => number
  isAsyncWaitCurrent: (token: FieldScriptAsyncWaitToken<TRunner>) => boolean
  resumeInput: (action: GameDigitalAction) => boolean
  addMovementTask: (task: Promise<void>) => void
  hasMovementTasks: () => boolean
  drainMovementTasks: () => Promise<void>[]
  clearMovementTasks: () => void
}>

function acceptedInputForAction(action: GameDigitalAction): FieldScriptAcceptedInput | undefined {
  if (action === 'confirm' || action === 'cancel') return action
  if (action === 'left' || action === 'right' || action === 'up' || action === 'down') return 'direction'
  return undefined
}

export function createFieldScriptExecutionState<TRunner = FieldScriptRunner>(
  runnerStorage?: FieldScriptRunnerStorage<TRunner>,
): FieldScriptExecutionState<TRunner> {
  let internalRunner: TRunner | undefined
  let wait: FieldScriptExecutionWaitKind | undefined
  let acceptedInputs = new Set<FieldScriptAcceptedInput>()
  let asyncGeneration = 0
  let movementTasks: Promise<void>[] = []
  let soundEffectId: number | undefined
  const getRunner = (): TRunner | undefined => runnerStorage?.read() ?? internalRunner
  const setRunner = (runner: TRunner | undefined): void => {
    if (runnerStorage) runnerStorage.write(runner)
    else internalRunner = runner
  }

  const getAcceptedInputs = (): readonly FieldScriptAcceptedInput[] => [...acceptedInputs]

  const invalidateAsync = (): number => {
    asyncGeneration += 1
    return asyncGeneration
  }

  const beginWait = (nextWait: FieldScriptExecutionWaitKind, options: FieldScriptBeginWaitOptions = {}): void => {
    wait = nextWait
    if (options.acceptedInputs !== undefined) acceptedInputs = new Set(options.acceptedInputs)
    if (options.soundEffectId !== undefined) soundEffectId = options.soundEffectId
  }

  const beginAsyncWait = (
    nextWait: FieldScriptExecutionWaitKind,
    options: FieldScriptBeginAsyncWaitOptions = {},
  ): FieldScriptAsyncWaitToken<TRunner> => {
    beginWait(nextWait, options)
    return Object.freeze({
      generation: invalidateAsync(),
      wait: nextWait,
      runner: getRunner(),
      runnerBound: options.bindRunner ?? false,
    })
  }

  const clearWait = (options: FieldScriptClearWaitOptions = {}): void => {
    if (options.invalidateAsync) invalidateAsync()
    wait = undefined
    if (options.clearAcceptedInputs) acceptedInputs.clear()
    if (options.clearSoundEffect) soundEffectId = undefined
  }

  const isAsyncWaitCurrent = (token: FieldScriptAsyncWaitToken<TRunner>): boolean => (
    wait === token.wait
    && asyncGeneration === token.generation
    && (!token.runnerBound || getRunner() === token.runner)
  )

  const resumeInput = (action: GameDigitalAction): boolean => {
    if (!getRunner() || wait !== 'input') return false
    const input = acceptedInputForAction(action)
    if (!input || !acceptedInputs.has(input)) return false
    clearWait({ invalidateAsync: true, clearAcceptedInputs: true })
    return true
  }

  const drainMovementTasks = (): Promise<void>[] => {
    const tasks = movementTasks
    movementTasks = []
    return tasks
  }

  const reset = (): void => {
    setRunner(undefined)
    wait = undefined
    acceptedInputs.clear()
    invalidateAsync()
    movementTasks = []
    soundEffectId = undefined
  }

  return Object.freeze({
    getRunner,
    setRunner,
    getWait: () => wait,
    getAcceptedInputs,
    getAsyncGeneration: () => asyncGeneration,
    getPendingMovementTaskCount: () => movementTasks.length,
    getSoundEffectId: () => soundEffectId,
    snapshot: () => Object.freeze({
      active: getRunner() !== undefined,
      wait,
      acceptedInputs: getAcceptedInputs(),
      asyncGeneration,
      pendingMovementTaskCount: movementTasks.length,
      soundEffectId,
    }),
    reset,
    beginWait,
    beginAsyncWait,
    clearWait,
    invalidateAsync,
    isAsyncWaitCurrent,
    resumeInput,
    addMovementTask: (task) => { movementTasks.push(task) },
    hasMovementTasks: () => movementTasks.length > 0,
    drainMovementTasks,
    clearMovementTasks: () => { movementTasks = [] },
  })
}
