import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { DoubleBattleParticipantInput } from './doubleBattleSession'
import { getUsableFieldBattlePartySlots } from './fieldBattlePartySelection'

export type FieldDoubleBattlePlayerRoster =
  | readonly [DoubleBattleParticipantInput]
  | readonly [DoubleBattleParticipantInput, DoubleBattleParticipantInput]

export type FieldDoubleBattlePlayerRosterOptions = Readonly<{
  party: CanonicalPokemon[]
  teamPolicy: PokemonTeamPolicy
  allowSingleParticipant: boolean
}>

/**
 * Ouvre au maximum deux slots joueur distincts. Le slot unique n'est admis
 * que par l'appelant NG+ : le format double HGSS normal conserve son prérequis.
 */
export function createFieldDoubleBattlePlayerRoster(
  options: FieldDoubleBattlePlayerRosterOptions,
): FieldDoubleBattlePlayerRoster {
  const slots = getUsableFieldBattlePartySlots(
    options.party,
    { format: 'double', phase: 'initial' },
    options.teamPolicy,
  )
  if (slots.length === 0) throw new Error('Le combat duo requiert au moins un Pokémon joueur utilisable.')
  const first = { ownerId: 'player', party: options.party, activePartyIndex: slots[0]!, controlled: true }
  if (slots.length === 1) {
    if (!options.allowSingleParticipant) throw new Error('Le combat duo ROM requiert deux Pokémon joueur utilisables.')
    return [first]
  }
  return [first, { ownerId: 'player', party: options.party, activePartyIndex: slots[1]!, controlled: true }]
}
