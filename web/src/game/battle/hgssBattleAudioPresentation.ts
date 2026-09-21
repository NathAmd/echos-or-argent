import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { startRomAudioPresentation } from '../../audio/romAudioPresentation'
import { resolveHgssBattleVictoryMusic } from './hgssBattleMusic'

type HgssBattleVictoryCueEvent = {
  kind: string
  result?: string
  side?: string
  target?: unknown
}

/** Place la victoire sur la disparition du dernier adversaire, jamais au calcul du tour. */
export function findHgssBattleVictoryFaintIndex(events: readonly HgssBattleVictoryCueEvent[]): number {
  if (!events.some((event) => event.kind === 'result' && event.result === 'won')) return -1
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index]!
    if (event.kind !== 'faint') continue
    const targetSide = typeof event.target === 'object' && event.target !== null && 'side' in event.target
      ? (event.target as { side?: unknown }).side
      : undefined
    if (event.side === 'opponent' || targetSide === 'opponent') return index
  }
  return -1
}

/** Lance la BGM terminale native sans donner sa durée au flux de messages. */
export function startHgssBattleVictoryMusic(
  audio: Pick<RomAudioRuntime, 'playMusic'> | undefined,
  kind: 'wild' | 'trainer',
  trainerClass?: number,
): void {
  const sequenceId = resolveHgssBattleVictoryMusic(kind, trainerClass)
  startRomAudioPresentation(audio ? () => audio.playMusic(sequenceId) : undefined)
}
