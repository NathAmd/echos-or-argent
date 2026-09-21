import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import type { MapActorRuntime } from '../../mapRuntimeTypes'
import type { HgssFollowerEmote } from '../../rom/overworld/followerEmotes'
import type {
  HgssFollowerReaction,
  HgssFollowerReactionCatalog,
} from '../../rom/overworld/followerReactions'
import type { FieldScriptClearWaitOptions } from '../scripts/fieldScriptExecutionState'
import type { FieldDialogueRuntime } from '../ui/fieldDialogueRuntime'
import { applyHgssFollowerReactionEffects } from './followerReactionSelection'
import { playHgssFollowerReaction } from './followerReactionPlayback'
import type { CanonicalPokemon } from './canonicalPokemon'

export type BrowserFollowerReactionState = {
  buffers: Map<number, string>
  playerName: string
  followerMood: number
}

export type BrowserFollowerReactionResources = Readonly<{
  catalog: Pick<HgssFollowerReactionCatalog, 'interactionMessages' | 'movements'>
  resolveEmote?: (emoteId: number) => HgssFollowerEmote | undefined
  getItemName: (itemId: number) => string | undefined
}>

export type BrowserFollowerReactionExecutionPort = Readonly<{
  setRunner: (runner: undefined) => void
  beginWait: (wait: 'input' | 'followerReaction') => void
  clearWait: (options?: FieldScriptClearWaitOptions) => void
}>

export type BrowserFollowerReactionTimerPort = Readonly<{
  schedule: (callback: () => void, delayMs: number) => unknown
  cancel: (handle: unknown) => void
  framesToMilliseconds: (frames: number) => number
}>

export type BrowserFollowerReactionRuntimePorts<TState extends BrowserFollowerReactionState> = Readonly<{
  readState: () => TState
  readMapLabel: () => string
  readResources: () => BrowserFollowerReactionResources
  formatMessage: (message: string, state: TState) => string
  runtime: Pick<MapActorRuntime, 'playFollowerReactionMotion' | 'playFollowerEmote'>
  readAudio: () => Pick<RomAudioRuntime, 'playSoundEffect' | 'playCry'> | undefined
  dialogue: Pick<FieldDialogueRuntime, 'showMessages' | 'hide'>
  execution: BrowserFollowerReactionExecutionPort
  clearMovement: () => void
  giveFashionAccessory: (accessoryId: number) => void
  reportStatus: (message: string) => void
  advance: () => void
  timer: BrowserFollowerReactionTimerPort
}>

export type BrowserFollowerReactionRuntime = Readonly<{
  start: (pokemon: CanonicalPokemon, reaction: HgssFollowerReaction) => void
  cancel: () => boolean
  consumeMessageConfirmation: () => boolean
  isActive: () => boolean
}>

type PendingTimer = {
  handle: unknown
  scheduled: boolean
  settled: boolean
  resolve: () => void
}

type PlaybackSession = {
  messageResolve?: () => void
  timers: Set<PendingTimer>
}

const hgssSoundEffectEnd = 2378
const hgssNormalCrySoundId = hgssSoundEffectEnd + 1

function interruptedPlaybackError(): Error {
  return new Error('La réaction follower ROM a été interrompue.')
}

export function createBrowserFollowerReactionRuntime<TState extends BrowserFollowerReactionState>(
  ports: BrowserFollowerReactionRuntimePorts<TState>,
): BrowserFollowerReactionRuntime {
  let activeSession: PlaybackSession | undefined

  const isCurrent = (session: PlaybackSession): boolean => activeSession === session

  const ensureCurrent = (session: PlaybackSession): void => {
    if (!isCurrent(session)) throw interruptedPlaybackError()
  }

  const settleMessage = (session: PlaybackSession): boolean => {
    const resolve = session.messageResolve
    if (!resolve) return false
    session.messageResolve = undefined
    resolve()
    return true
  }

  const settleTimer = (session: PlaybackSession, pending: PendingTimer): void => {
    if (pending.settled) return
    pending.settled = true
    session.timers.delete(pending)
    pending.resolve()
  }

  const cancelTimers = (session: PlaybackSession): void => {
    for (const pending of [...session.timers]) {
      if (pending.scheduled) ports.timer.cancel(pending.handle)
      settleTimer(session, pending)
    }
  }

  const cancel = (): boolean => {
    const session = activeSession
    if (!session) return false
    activeSession = undefined
    const messagePending = Boolean(session.messageResolve)
    settleMessage(session)
    cancelTimers(session)
    if (messagePending) ports.dialogue.hide()
    ports.execution.clearWait({ invalidateAsync: true, clearAcceptedInputs: true })
    return true
  }

  const consumeMessageConfirmation = (): boolean => {
    const session = activeSession
    if (!session?.messageResolve) return false
    ports.dialogue.hide()
    ports.execution.beginWait('followerReaction')
    settleMessage(session)
    return true
  }

  const playStepSound = (session: PlaybackSession, pokemon: CanonicalPokemon, soundId: number): void => {
    if (soundId === 0) return
    const audio = ports.readAudio()
    // ov02_0224FDF8: les IDs SDAT vont jusqu'a SEQ_SE_END; les deux
    // branches suivantes appellent PlayCryEx avec le motif 0 ou 11.
    const sound = soundId <= hgssSoundEffectEnd
      ? audio?.playSoundEffect(soundId)
      : audio?.playCry(pokemon.speciesId, soundId === hgssNormalCrySoundId ? 0 : 11, undefined, undefined, pokemon.form)
    void sound?.catch((error: unknown) => {
      if (!isCurrent(session)) return
      ports.reportStatus(error instanceof Error
        ? error.message
        : 'Le son de réaction follower ROM ne peut pas être lu.')
    })
  }

  const formatReactionMessage = (
    pokemon: CanonicalPokemon,
    messageId: number,
    resources: BrowserFollowerReactionResources,
  ): string => {
    const rawMessage = resources.catalog.interactionMessages[messageId - 1]
    if (rawMessage === undefined) {
      throw new Error(`Le message follower ROM ${messageId} est absent de la banque 265.`)
    }
    const state = ports.readState()
    const previousBuffers = state.buffers
    state.buffers = new Map(previousBuffers)
    state.buffers.set(0, pokemon.nickname ?? pokemon.speciesName)
    state.buffers.set(1, pokemon.speciesName)
    state.buffers.set(2, state.playerName)
    state.buffers.set(3, ports.readMapLabel())
    state.buffers.set(4, resources.getItemName(pokemon.heldItemId) ?? '')
    try {
      return ports.formatMessage(rawMessage, state)
    } finally {
      state.buffers = previousBuffers
    }
  }

  const waitFrames = (session: PlaybackSession, frames: number): Promise<void> => {
    ensureCurrent(session)
    ports.execution.beginWait('followerReaction')
    return new Promise<void>((resolve) => {
      const pending: PendingTimer = {
        handle: undefined,
        scheduled: false,
        settled: false,
        resolve,
      }
      session.timers.add(pending)
      pending.handle = ports.timer.schedule(
        () => { settleTimer(session, pending) },
        ports.timer.framesToMilliseconds(frames),
      )
      pending.scheduled = true
    }).then(() => { ensureCurrent(session) })
  }

  const fail = (session: PlaybackSession, error: unknown): void => {
    if (!isCurrent(session)) return
    activeSession = undefined
    settleMessage(session)
    cancelTimers(session)
    ports.reportStatus(error instanceof Error
      ? error.message
      : 'La réaction follower ROM ne peut pas être jouée.')
    ports.execution.setRunner(undefined)
    ports.execution.clearWait({
      invalidateAsync: true,
      clearAcceptedInputs: true,
      clearSoundEffect: true,
    })
    ports.dialogue.hide()
  }

  const start = (pokemon: CanonicalPokemon, reaction: HgssFollowerReaction): void => {
    cancel()
    const session: PlaybackSession = {
      timers: new Set(),
    }
    activeSession = session
    ports.execution.beginWait('followerReaction')
    let resources: BrowserFollowerReactionResources
    try {
      resources = ports.readResources()
    } catch (error) {
      fail(session, error)
      return
    }

    void playHgssFollowerReaction(reaction, {
      playMotion: async (step) => {
        ensureCurrent(session)
        const motion = resources.catalog.movements[step.movementId - 1]
        if (!motion) throw new Error(`Le mouvement follower ROM ${step.movementId} est absent du catalogue.`)
        ports.execution.beginWait('followerReaction')
        await ports.runtime.playFollowerReactionMotion(
          motion,
          pokemon.speciesId === 50 || pokemon.speciesId === 51,
          () => { playStepSound(session, pokemon, step.soundId) },
        )
        ensureCurrent(session)
      },
      playEmote: async (emoteId) => {
        ensureCurrent(session)
        const emote = resources.resolveEmote?.(emoteId)
        if (!emote) throw new Error(`Les ressources de l’emote follower ROM ${emoteId} sont absentes.`)
        ports.execution.beginWait('followerReaction')
        await ports.runtime.playFollowerEmote(emote, (soundId) => {
          void ports.readAudio()?.playSoundEffect(soundId).catch((error: unknown) => {
            if (!isCurrent(session)) return
            ports.reportStatus(error instanceof Error
              ? error.message
              : 'Le son de l’emote follower ROM ne peut pas être lu.')
          })
        })
        ensureCurrent(session)
      },
      showMessage: (messageId) => {
        ensureCurrent(session)
        ports.clearMovement()
        ports.dialogue.showMessages(formatReactionMessage(pokemon, messageId, resources), {
          speaker: pokemon.nickname ?? pokemon.speciesName,
        })
        ports.execution.beginWait('input')
        return new Promise<void>((resolve) => {
          let settled = false
          session.messageResolve = () => {
            if (settled) return
            settled = true
            resolve()
          }
        })
      },
      waitFrames: (frames) => waitFrames(session, frames),
    }).then(() => {
      ensureCurrent(session)
      const state = ports.readState()
      const effects = applyHgssFollowerReactionEffects(pokemon, state.followerMood, reaction)
      state.followerMood = effects.mood
      if (effects.fashionItemId !== 0) ports.giveFashionAccessory(effects.fashionItemId)
      activeSession = undefined
      ports.execution.clearWait()
      const grantedReward = effects.fashionItemId !== 0
        ? ` Accessoire ${effects.fashionItemId} remis.`
        : ''
      ports.reportStatus(
        `${pokemon.nickname ?? pokemon.speciesName} termine la réaction ROM ${reaction.reactionId}.${grantedReward}`,
      )
      ports.advance()
    }).catch((error: unknown) => { fail(session, error) })
  }

  return Object.freeze({
    start,
    cancel,
    consumeMessageConfirmation,
    isActive: () => activeSession !== undefined,
  })
}
