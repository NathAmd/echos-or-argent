import type {
  FieldScriptClearWaitOptions,
  FieldScriptExecutionWaitKind,
} from './fieldScriptExecutionState'

type PolledFieldScriptExecution = Readonly<{
  getWait: () => FieldScriptExecutionWaitKind | undefined
  getSoundEffectId: () => number | undefined
  clearWait: (options?: FieldScriptClearWaitOptions) => void
}>

type PolledFieldRuntime = Readonly<{
  isScriptMoving: () => boolean
  isFollowerMoving: () => boolean
}>

type PolledFieldAudio = Readonly<{
  isSoundEffectPlaying: (sequenceId: number) => boolean
  isFanfarePlaying: () => boolean
  isCryPlaying: () => boolean
}>

export type FieldScriptWaitPollerOptions = Readonly<{
  execution: PolledFieldScriptExecution
  runtime: PolledFieldRuntime
  isScriptActive: () => boolean
  readAudio: () => PolledFieldAudio | undefined
  resume: () => void
}>

export type FieldScriptWaitPoller = Readonly<{
  tick: () => void
}>

/** Polls the frame-bound waits which cannot complete through a promise callback. */
export function createFieldScriptWaitPoller(options: FieldScriptWaitPollerOptions): FieldScriptWaitPoller {
  const settle = (
    wait: FieldScriptExecutionWaitKind,
    complete: () => boolean,
    clearOptions?: FieldScriptClearWaitOptions,
  ): void => {
    if (!options.isScriptActive() || options.execution.getWait() !== wait || !complete()) return
    options.execution.clearWait(clearOptions)
    options.resume()
  }

  return Object.freeze({
    tick: () => {
      // Keep the native order and allow a resumed runner to settle its next
      // already-complete wait during the same rendered frame.
      settle('movement', () => !options.runtime.isScriptMoving())
      settle('followerMovement', () => !options.runtime.isFollowerMoving())
      const soundEffectId = options.execution.getSoundEffectId()
      settle(
        'soundEffect',
        () => soundEffectId !== undefined
          && !(options.readAudio()?.isSoundEffectPlaying(soundEffectId) ?? false),
        { clearSoundEffect: true },
      )
      settle('fanfare', () => !(options.readAudio()?.isFanfarePlaying() ?? false))
      settle('cry', () => !(options.readAudio()?.isCryPlaying() ?? false))
    },
  })
}
