import type { GameDigitalAction } from '../../gameInput'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { getHgssFollowerFishingReactionChance, type HgssFishingRod } from './wildEncounterSelection'

export const HGSS_FISHING_CAST_FRAMES = 34 as const
export const HGSS_FISHING_CAST_SOUND_FRAME = 10 as const
export const HGSS_FISHING_CAST_SOUND_SEQUENCE_ID = 1615 as const
export const HGSS_FISHING_NO_BITE_WAIT_FRAMES = 120 as const
export const HGSS_FISHING_LANDED_DELAY_FRAMES = 16 as const
export const HGSS_FISHING_RECOVERY_FRAMES = 3 as const

export type HgssFishingResult = 'landed' | 'no-bite' | 'got-away' | 'too-early'
export type HgssFishingMessageId = 49 | 50 | 51 | 52
export type HgssFishingPhase = 'casting' | 'waiting' | 'bite' | 'got-away-delay' | 'landed-delay' | 'message' | 'recovering' | 'complete'

export type HgssFishingSessionState = {
  phase: HgssFishingPhase
  framesRemaining: number
  result?: HgssFishingResult
}

export type HgssFishingSessionOptions = {
  rod: HgssFishingRod
  hasEncounter: boolean
  rng: Pick<HgssLcrng, 'nextU16'>
  /** Présent uniquement lorsque FollowMon_IsActive est vrai. */
  followerMood?: number
  /** Présent uniquement si le follower peut afficher l'indicateur de touche. */
  followerFriendship?: number
  onCastSound?: (sequenceId: typeof HGSS_FISHING_CAST_SOUND_SEQUENCE_ID) => void
  onBite?: (target: 'player' | 'follower') => void
  onBiteEnd?: (target: 'player' | 'follower') => void
  onMessage?: (messageId: HgssFishingMessageId) => void
  onMessageDismiss?: (messageId: HgssFishingMessageId) => void
  onComplete?: (result: HgssFishingResult) => void
}

export type HgssFishingSession = {
  tick: () => void
  handle: (action: GameDigitalAction) => boolean
  getState: () => Readonly<HgssFishingSessionState>
}

const hookWindowBaseFrames: Readonly<Record<HgssFishingRod, number>> = {
  oldRod: 45,
  goodRod: 30,
  superRod: 15,
}

const followerMoodBonusFrames = [
  [0, 0, 0],
  [9, 6, 3],
  [15, 12, 6],
  [21, 18, 9],
  [30, 24, 12],
] as const

const rodIndexes: Readonly<Record<HgssFishingRod, 0 | 1 | 2>> = {
  oldRod: 0,
  goodRod: 1,
  superRod: 2,
}

function requireMood(mood: number): number {
  if (!Number.isInteger(mood) || mood < -127 || mood > 127) {
    throw new Error(`L’humeur de pêche HGSS ${mood} est invalide.`)
  }
  return mood
}

/** Port des tables ov01_02208D7C/ov01_02208D88 du mini-jeu de pêche HGSS. */
export function getHgssFishingHookWindowFrames(rod: HgssFishingRod, followerMood?: number): number {
  const base = hookWindowBaseFrames[rod]
  if (followerMood === undefined) return base
  const mood = requireMood(followerMood)
  const row = mood <= -10 ? 0 : mood <= 9 ? 1 : mood <= 49 ? 2 : mood <= 99 ? 3 : 4
  return base + followerMoodBonusFrames[row]![rodIndexes[rod]]
}

function messageIdForResult(result: HgssFishingResult): HgssFishingMessageId {
  if (result === 'no-bite') return 49
  if (result === 'got-away') return 50
  if (result === 'too-early') return 51
  return 52
}

export function createHgssFishingSession(options: HgssFishingSessionOptions): HgssFishingSession {
  let biteTarget: 'player' | 'follower' | undefined
  let state: HgssFishingSessionState = {
    phase: 'casting',
    framesRemaining: HGSS_FISHING_CAST_FRAMES,
  }

  const enterMessage = (result: HgssFishingResult): void => {
    state = {
      phase: 'message',
      // La ROM initialise son compteur à 16 précisément pour que l'état 14
      // puisse écouter A/B dès que l'impression du message est terminée.
      framesRemaining: 0,
      result,
    }
    options.onMessage?.(messageIdForResult(result))
  }

  const finish = (): void => {
    if (!state.result || state.phase === 'complete') return
    const result = state.result
    state = { ...state, phase: 'complete', framesRemaining: 0 }
    options.onComplete?.(result)
  }

  const clearBite = (): void => {
    if (!biteTarget) return
    options.onBiteEnd?.(biteTarget)
    biteTarget = undefined
  }

  const acknowledgeMessage = (): void => {
    if (!state.result || state.phase !== 'message') return
    options.onMessageDismiss?.(messageIdForResult(state.result))
    clearBite()
    state = { phase: 'recovering', framesRemaining: HGSS_FISHING_RECOVERY_FRAMES, result: state.result }
  }

  return {
    tick() {
      if (state.phase === 'complete' || state.phase === 'message') return
      const previousRemaining = state.framesRemaining
      state = { ...state, framesRemaining: Math.max(0, previousRemaining - 1) }
      if (state.phase === 'casting') {
        const elapsed = HGSS_FISHING_CAST_FRAMES - state.framesRemaining
        if (elapsed === HGSS_FISHING_CAST_SOUND_FRAME) options.onCastSound?.(HGSS_FISHING_CAST_SOUND_SEQUENCE_ID)
        if (state.framesRemaining === 0) {
          // Les états 3→4 (touche) et 12→13 (aucune touche) sont tous
          // deux rejoués immédiatement par la SysTask native : leur premier
          // décrément appartient donc encore à la 34e frame du lancer.
          state = options.hasEncounter
            ? { phase: 'waiting', framesRemaining: (options.rng.nextU16() % 4 + 1) * 30 - 1 }
            : { phase: 'waiting', framesRemaining: HGSS_FISHING_NO_BITE_WAIT_FRAMES - 1 }
        }
      } else if (state.phase === 'waiting' && state.framesRemaining === 0) {
        if (!options.hasEncounter) enterMessage('no-bite')
        else {
          // L'état 4 lance l'indicateur puis enchaîne l'état 5 dans la
          // même frame, qui consomme aussitôt la première unité de fenêtre.
          state = { phase: 'bite', framesRemaining: getHgssFishingHookWindowFrames(options.rod, options.followerMood) - 1 }
          const chance = options.followerFriendship === undefined ? 0 : getHgssFollowerFishingReactionChance(options.followerFriendship)
          biteTarget = chance > 0 && options.rng.nextU16() % 100 < chance ? 'follower' : 'player'
          options.onBite?.(biteTarget)
        }
      } else if (state.phase === 'bite' && state.framesRemaining === 0) {
        // L'état 5 ne rejoue pas l'état 11 dans la même callback.
        state = { phase: 'got-away-delay', framesRemaining: 1, result: 'got-away' }
      } else if (state.phase === 'got-away-delay' && state.framesRemaining === 0) enterMessage('got-away')
      else if (state.phase === 'landed-delay' && state.framesRemaining === 0) enterMessage('landed')
      else if (state.phase === 'recovering' && state.framesRemaining === 0) finish()
    },
    handle(action) {
      if (state.phase === 'complete') return false
      if (action === 'confirm') {
        if (state.phase === 'waiting') enterMessage('too-early')
        else if (state.phase === 'bite') {
          clearBite()
          state = { phase: 'landed-delay', framesRemaining: HGSS_FISHING_LANDED_DELAY_FRAMES, result: 'landed' }
        } else if (state.phase === 'message') acknowledgeMessage()
      } else if (action === 'cancel' && state.phase === 'message') acknowledgeMessage()
      return true
    },
    getState: () => state,
  }
}
