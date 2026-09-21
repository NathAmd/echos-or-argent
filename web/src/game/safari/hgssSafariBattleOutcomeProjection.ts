import type { DetailedBattleOutcomeEvent } from '../battle/battleOutcomeObserver'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssSafariBattleOutcome } from './hgssSafariBattle'

type SafariFinishedEvent = Extract<DetailedBattleOutcomeEvent, { kind: 'battle-finished' }>

export type HgssSafariBattleOutcomeSource = Readonly<{
  outcome: HgssSafariBattleOutcome
  opponent: Pick<CanonicalPokemon, 'instanceId'>
}>

/** Projette chaque sortie terminale Safari vers le cycle de vie de combat commun. */
export function projectHgssSafariBattleFinishOutcome(
  finish: HgssSafariBattleOutcomeSource,
): SafariFinishedEvent {
  if (finish.outcome === 'active') {
    throw new Error('Un combat Safari encore actif ne peut pas être finalisé.')
  }
  if (finish.outcome === 'caught') {
    return {
      kind: 'battle-finished',
      outcome: 'capture',
      capturedPokemon: {
        instanceId: finish.opponent.instanceId,
        side: 'opponent',
        partyIndex: 0,
      },
    }
  }
  return { kind: 'battle-finished', outcome: 'flee' }
}
