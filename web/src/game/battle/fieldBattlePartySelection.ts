import {
  basePokemonTeamPolicy,
  getPokemonBattleEligibilityVeto,
  type PokemonBattleEligibilityIntent,
  type PokemonTeamMember,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'

export type FieldBattlePartyMember = PokemonTeamMember
export type FieldBattlePartySelectionContext = Readonly<Pick<PokemonBattleEligibilityIntent, 'format' | 'phase'>>

export function getUsableFieldBattlePartySlots(
  party: readonly FieldBattlePartyMember[],
  context?: FieldBattlePartySelectionContext,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): number[] {
  return party
    .map((pokemon, index) => ({ pokemon, index }))
    .filter(({ pokemon, index }) => !pokemon.isEgg && pokemon.currentHp > 0
      && (!context || !getPokemonBattleEligibilityVeto(party, index, context, policy)))
    .map(({ index }) => index)
}

export function getFirstUsableFieldBattlePartySlot(
  party: readonly FieldBattlePartyMember[],
  context?: FieldBattlePartySelectionContext,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): number {
  return party.findIndex((pokemon, index) => !pokemon.isEgg && pokemon.currentHp > 0
    && (!context || !getPokemonBattleEligibilityVeto(party, index, context, policy)))
}
