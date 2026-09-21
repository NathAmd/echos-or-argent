import { hgssBattleAudioSequences } from './hgssBattleAudio'
import { isHgssBattleBallItemId, resolveHgssBallIdFromItemId } from '../../rom/battle/battleBallSprites'

export type HgssCaptureShakeCount = 0 | 1 | 2 | 3 | 4
export type HgssCaptureMode = 'normal' | 'safari'

export type HgssCaptureAnimationPhase =
  | { kind: 'throw', animationId: 0, motionFrames: 16, soundEffectId: number, outcomeMayBeRevealed: false }
  | { kind: 'open', animationId: 1, captureRollAfterFrames: 23, soundEffectId: number, completion: 'ball-animation', outcomeMayBeRevealed: false }
  | { kind: 'fall', animationId: 3, slideFrames: 10, slideHorizontalPixels: 32, verticalOffsets: readonly number[], animationFrameIndexes: readonly (0 | 1)[], completionFrames: 21, soundCues: readonly HgssCaptureSoundCue[], outcomeMayBeRevealed: false }
  | { kind: 'shake', animationId: 4, ordinal: 1 | 2 | 3, windupFrames: 14, horizontalOffsets: readonly number[], completionFrames: number, soundCue: HgssCaptureSoundCue, outcomeMayBeRevealed: false }
  | { kind: 'shake-cooldown', ordinal: 1 | 2 | 3, frames: 12, outcomeMayBeRevealed: false }
  | { kind: 'pre-click', frames: 12, outcomeMayBeRevealed: false }
  | { kind: 'click', animationId: 6, soundEffectId: number, completion: 'ball-animation', outcomeMayBeRevealed: true }
  | { kind: 'breakout', ballCleanupFrames: 2, completion: 'pokemon-send-out-controller', outcomeMayBeRevealed: true }

export type HgssCaptureSoundCue = {
  frame: number
  sequenceId: number
  pan: 0x75
}

export type HgssCaptureAnimationPlan = {
  mode: HgssCaptureMode
  itemId: number
  ballId: number
  logicalShakes: HgssCaptureShakeCount
  renderedShakes: 0 | 1 | 2 | 3
  caught: boolean
  phases: readonly HgssCaptureAnimationPhase[]
  result: {
    messageId: number
    minimumFramesAfterPrinter: 30
    successMusicId?: number
    fadeBallAfterPrinter: boolean
  }
}

/** `ov07_02237310`, utilisé par l'état interne 13 de BALL_ANIM_FALL. */
export const HGSS_CAPTURE_FALL_VERTICAL_OFFSETS = Object.freeze([
  -7, -5, -3, -2, 2, 3, 5, 7, -5, -3, -2, 2, 3, 5, -2, -1, 1, 2, -2, 2,
])

/** Entrées NANR de `ov07_02237310`, forcées une fois par VBlank de rebond. */
export const HGSS_CAPTURE_FALL_ANIMATION_FRAME_INDEXES = Object.freeze([
  1, 0, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 1,
] as const satisfies readonly (0 | 1)[])

/** `ov07_02237200`: les sons sont émis après l'incrément du compteur local. */
export const HGSS_CAPTURE_FALL_SOUND_CUES = Object.freeze([
  { frame: 1, sequenceId: hgssBattleAudioSequences.ballFallImpactSound, pan: 0x75 },
  { frame: 8, sequenceId: hgssBattleAudioSequences.ballFallImpactSound, pan: 0x75 },
  { frame: 14, sequenceId: hgssBattleAudioSequences.ballFallBounce2Sound, pan: 0x75 },
  { frame: 18, sequenceId: hgssBattleAudioSequences.ballFallBounce3Sound, pan: 0x75 },
  { frame: 20, sequenceId: hgssBattleAudioSequences.ballFallBounce4Sound, pan: 0x75 },
] as const satisfies readonly HgssCaptureSoundCue[])

/** Trois lignes de `ov07_02237254`, sans leur sentinelle 0x00ff. */
export const HGSS_CAPTURE_SHAKE_HORIZONTAL_OFFSETS = Object.freeze([
  Object.freeze([-2, 0, 2, 2, 0, -2]),
  Object.freeze([-1, 0, 1, 1, 0, -1]),
  Object.freeze([-1, 0, 1, 1, 0, -1, 0, 0, 0, 0, 0]),
] as const)

function createShakePhase(ordinal: 1 | 2 | 3): Extract<HgssCaptureAnimationPhase, { kind: 'shake' }> {
  const horizontalOffsets = HGSS_CAPTURE_SHAKE_HORIZONTAL_OFFSETS[ordinal - 1]
  return {
    kind: 'shake',
    animationId: 4,
    ordinal,
    windupFrames: 14,
    horizontalOffsets,
    // L'appel qui rencontre la sentinelle fait encore partie de l'état natif.
    completionFrames: horizontalOffsets.length + 1,
    soundCue: { frame: 5, sequenceId: hgssBattleAudioSequences.ballShakeSound, pan: 0x75 },
    outcomeMayBeRevealed: false,
  }
}

/**
 * Contrat partagé de `Task_GetPokemon`. Normal et Safari ne diffèrent que par
 * la création préalable du BallData; une fois le lancer commencé, la machine
 * d'état, les secousses et le moment de révélation sont identiques.
 */
export function createHgssCaptureAnimationPlan(options: {
  mode: HgssCaptureMode
  itemId: number
  shakes: HgssCaptureShakeCount
  caught: boolean
}): HgssCaptureAnimationPlan {
  if (!isHgssBattleBallItemId(options.itemId)) {
    throw new Error(`L'objet ${options.itemId} n'est pas une Ball utilisable par le combat HGSS.`)
  }
  if (options.mode === 'safari' && options.itemId !== 5) {
    throw new Error(`Le combat Safari HGSS doit lancer l'objet Safari Ball 5, pas ${options.itemId}.`)
  }
  if (options.caught !== (options.shakes === 4)) {
    throw new Error(`Résultat de capture HGSS incohérent : ${options.shakes} jets pour caught=${options.caught}.`)
  }
  const renderedShakes = (options.caught ? 3 : options.shakes) as 0 | 1 | 2 | 3
  const phases: HgssCaptureAnimationPhase[] = [
    { kind: 'throw', animationId: 0, motionFrames: 16, soundEffectId: hgssBattleAudioSequences.throwSound, outcomeMayBeRevealed: false },
    { kind: 'open', animationId: 1, captureRollAfterFrames: 23, soundEffectId: hgssBattleAudioSequences.ballOpenSound, completion: 'ball-animation', outcomeMayBeRevealed: false },
    { kind: 'fall', animationId: 3, slideFrames: 10, slideHorizontalPixels: 32, verticalOffsets: HGSS_CAPTURE_FALL_VERTICAL_OFFSETS, animationFrameIndexes: HGSS_CAPTURE_FALL_ANIMATION_FRAME_INDEXES, completionFrames: 21, soundCues: HGSS_CAPTURE_FALL_SOUND_CUES, outcomeMayBeRevealed: false },
  ]
  for (let index = 0; index < renderedShakes; index += 1) {
    const ordinal = (index + 1) as 1 | 2 | 3
    phases.push(createShakePhase(ordinal))
    phases.push({ kind: 'shake-cooldown', ordinal, frames: 12, outcomeMayBeRevealed: false })
  }
  if (options.caught) {
    phases.push({ kind: 'pre-click', frames: 12, outcomeMayBeRevealed: false })
    phases.push({ kind: 'click', animationId: 6, soundEffectId: hgssBattleAudioSequences.ballCaughtSound, completion: 'ball-animation', outcomeMayBeRevealed: true })
  } else {
    phases.push({ kind: 'breakout', ballCleanupFrames: 2, completion: 'pokemon-send-out-controller', outcomeMayBeRevealed: true })
  }
  return {
    mode: options.mode,
    itemId: options.itemId,
    ballId: resolveHgssBallIdFromItemId(options.itemId),
    logicalShakes: options.shakes,
    renderedShakes,
    caught: options.caught,
    phases,
    result: options.caught
      ? { messageId: 867, minimumFramesAfterPrinter: 30, successMusicId: hgssBattleAudioSequences.captureVictoryMusic, fadeBallAfterPrinter: true }
      : { messageId: 863 + options.shakes, minimumFramesAfterPrinter: 30, fadeBallAfterPrinter: false },
  }
}
