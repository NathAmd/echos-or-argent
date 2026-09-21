import type { PokemonCatalog } from '../../ndsTypes'
import { getUsableSimpleBattleMoveIndexes } from './simpleBattleSession'
import type {
  DoubleBattleMoveAction,
  DoubleBattleParticipant,
  DoubleBattlePosition,
  DoubleBattleSession,
} from './doubleBattleSession'
import { requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function activePokemon(participant: DoubleBattleParticipant) {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}

export function getSelectableDoubleBattleMoveIndexes(
  session: DoubleBattleSession,
  position: DoubleBattlePosition,
): number[] {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(participant)
  const opposingSide = position.side === 'player' ? 'opponent' : 'player'
  const imprisonedMoveIds = new Set(session.teams[opposingSide]
    .filter((opponent) => opponent.volatile.imprisoned && activePokemon(opponent).currentHp > 0)
    .flatMap((opponent) => activePokemon(opponent).moves.map(({ moveId }) => moveId)))
  return getUsableSimpleBattleMoveIndexes({ pokemon }).filter((index) => {
    const move = pokemon.moves[index]!
    return move.moveId !== participant.volatile.disabledMoveId
      && (participant.volatile.encoreTurns === 0 || index === participant.volatile.encoreMoveIndex)
      && (participant.volatile.tauntTurns === 0 || move.data.category !== 2)
      && (participant.volatile.choiceMoveId === 0 || participant.volatile.choiceMoveId === move.moveId)
      && (!participant.volatile.tormented || move.moveId !== participant.volatile.lastMoveId)
      && !imprisonedMoveIds.has(move.moveId)
  })
}

export function resolveDoubleBattleActionMoveData(
  session: DoubleBattleSession,
  action: DoubleBattleMoveAction,
  catalog: PokemonCatalog,
) {
  const participant = requireDoubleBattleParticipantAt(session, action.actor)
  const pokemon = activePokemon(participant)
  if (action.moveIndex === -1) {
    const usable = getSelectableDoubleBattleMoveIndexes(session, action.actor)
    if (usable.length > 0) {
      throw new Error(`Lutte ne peut pas être choisie tant que ${pokemon.speciesName} possède encore des PP.`)
    }
    const struggle = catalog.moves[165]
    if (!struggle) throw new Error('Les données ROM de Lutte sont absentes.')
    return struggle
  }
  const move = pokemon.moves[action.moveIndex]
  if (!move || move.pp <= 0) {
    throw new Error(`La capacité ${action.moveIndex} de ${pokemon.speciesName} n'est pas utilisable.`)
  }
  return move.data
}
