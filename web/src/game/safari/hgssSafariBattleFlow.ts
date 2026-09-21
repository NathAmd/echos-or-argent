import type { HgssCaptureResult } from '../battle/hgssCapture'
import { hgssBattleAudioSequences } from '../battle/hgssBattleAudio'
import type {
  HgssSafariBattleAction,
  HgssSafariBattleEvent,
  HgssSafariBattleOutcome,
  HgssSafariBattleTurn,
} from './hgssSafariBattle'

export const hgssSafariBattleCommandMessages = [
  { action: 'ball', messageId: 931 },
  { action: 'bait', messageId: 932 },
  { action: 'mud', messageId: 933 },
  { action: 'run', messageId: 927 },
] as const satisfies readonly { action: HgssSafariBattleAction, messageId: number }[]

export type HgssSafariBattleAnimation =
  | { kind: 'encounter' }
  | { kind: 'ball', capture: HgssCaptureResult }
  | { kind: 'bait', strongReaction: boolean }
  | { kind: 'mud', strongReaction: boolean }
  | { kind: 'opponentFled' }
  | { kind: 'exit', outcome: HgssSafariBattleOutcome }

export type HgssSafariBattleSceneCue = 'opponent-gauge' | 'safari-gauge' | 'capture-fade'

export type HgssSafariBattleAudioCue = {
  kind: 'music' | 'sound'
  sequenceId: number
}

export type HgssSafariBattlePresentationEntry = {
  messageId: number
  values: readonly string[]
  animation?: HgssSafariBattleAnimation
  sceneCues?: {
    beforeMessage?: HgssSafariBattleSceneCue
    afterPrinter?: HgssSafariBattleSceneCue
    /** Certains scripts lancent leur délai avec le cue; la capture attend d'abord son fondu. */
    afterPrinterTiming?: 'parallel-with-delay' | 'before-delay'
  }
  audio?: HgssSafariBattleAudioCue
  /**
   * `WaitButtonABTime` expire seul mais accepte A/B/tactile, alors que les
   * messages du task de capture attendent strictement le printer + délai.
   */
  advance: 'automatic' | 'input-or-timeout'
  /** Le lancer n'est émis qu'une fois le message précédent terminé. */
  animationTiming?: 'on-present' | 'after-message'
  /** Délai du script avant la création du printer. */
  beforeFrames?: number
  minimumFrames?: number
}

export type HgssSafariBattlePresentationNames = {
  playerName: string
  opponentName: string
  safariBallName: string
}

export function createHgssSafariBattleIntroduction(
  names: HgssSafariBattlePresentationNames,
): HgssSafariBattlePresentationEntry[] {
  return [{
    messageId: 965,
    values: [names.opponentName],
    animation: { kind: 'encounter' },
    sceneCues: { beforeMessage: 'opponent-gauge', afterPrinter: 'safari-gauge' },
    advance: 'input-or-timeout',
    beforeFrames: 122,
    minimumFrames: 7,
  }]
}

function presentEvent(
  event: HgssSafariBattleEvent,
  names: HgssSafariBattlePresentationNames,
): HgssSafariBattlePresentationEntry[] {
  if (event.kind === 'ball') {
    const captureMessageId = event.capture.caught ? 867 : 863 + event.capture.shakes
    return [
      { messageId: 857, values: [names.playerName, names.safariBallName], animation: { kind: 'ball', capture: event.capture }, advance: 'automatic', animationTiming: 'after-message' },
      { messageId: captureMessageId, values: event.capture.caught ? [names.opponentName] : [], sceneCues: event.capture.caught ? { afterPrinter: 'capture-fade', afterPrinterTiming: 'before-delay' } : undefined, audio: event.capture.caught ? { kind: 'music', sequenceId: hgssBattleAudioSequences.captureVictoryMusic } : undefined, advance: 'automatic', minimumFrames: 30 },
    ]
  }
  if (event.kind === 'bait') {
    return [
      { messageId: 851, values: [names.playerName, names.opponentName], animation: { kind: 'bait', strongReaction: event.strongReaction }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 },
      { messageId: event.strongReaction ? 853 : 852, values: [names.opponentName], advance: 'input-or-timeout', minimumFrames: 30 },
    ]
  }
  if (event.kind === 'mud') {
    return [
      { messageId: 854, values: [names.playerName, names.opponentName], animation: { kind: 'mud', strongReaction: event.strongReaction }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 },
      { messageId: event.strongReaction ? 856 : 855, values: [names.opponentName], advance: 'input-or-timeout', minimumFrames: 30 },
    ]
  }
  if (event.kind === 'watching') return [{ messageId: 849, values: [names.opponentName], advance: 'input-or-timeout', minimumFrames: 30 }]
  if (event.kind === 'opponent-fled') {
    return [{ messageId: 784, values: [names.opponentName], animation: { kind: 'opponentFled' }, audio: { kind: 'sound', sequenceId: hgssBattleAudioSequences.fleeSound }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 }]
  }
  if (event.kind === 'player-ran') {
    return [{ messageId: 781, values: [], animation: { kind: 'exit', outcome: 'player-ran' }, audio: { kind: 'sound', sequenceId: hgssBattleAudioSequences.fleeSound }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 }]
  }
  if (event.kind === 'balls-out') {
    return [{ messageId: 850, values: [], animation: { kind: 'exit', outcome: 'balls-out' }, audio: { kind: 'sound', sequenceId: hgssBattleAudioSequences.safariBallsOutSound }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 }]
  }
  return [{ messageId: 874, values: [], animation: { kind: 'exit', outcome: 'storage-full' }, advance: 'input-or-timeout', animationTiming: 'after-message', minimumFrames: 30 }]
}

/** Conserve l'ordre des sous-scripts de combat Safari, sans texte de repli inventé. */
export function resolveHgssSafariBattleTurnPresentation(
  turn: HgssSafariBattleTurn,
  names: HgssSafariBattlePresentationNames,
): HgssSafariBattlePresentationEntry[] {
  return turn.events.flatMap((event) => presentEvent(event, names))
}
