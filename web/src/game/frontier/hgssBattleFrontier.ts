import type { PokemonParty } from '../pokemon/pokemonParty'

export const hgssBattleFrontierBannedSpeciesIds = [
  150, 151, 249, 250, 251, 382, 383, 384, 385,
  386, 483, 484, 487, 489, 490, 491, 492, 493,
] as const

const hgssBattleFrontierBannedSpecies = new Set<number>(hgssBattleFrontierBannedSpeciesIds)

function isEligibleForHgssBattleFrontier(pokemon: PokemonParty['members'][number]): boolean {
  if (pokemon.isEgg || hgssBattleFrontierBannedSpecies.has(pokemon.speciesId)) return false
  // PICHU TROIZÉPI est la forme 1 dans HGSS et figure séparément dans la ROM.
  return pokemon.speciesId !== 172 || pokemon.form !== 1
}

/** Projection de PartyIsValidForFrontier(..., checkDuplicateItems = TRUE). */
export function isHgssPartyValidForBattleFrontier(
  party: PokemonParty,
  requiredCount: number,
  checkDuplicateItems = true,
): boolean {
  if (!Number.isInteger(requiredCount) || requiredCount < 1 || requiredCount > 4) return false
  const eligible = party.members.filter(isEligibleForHgssBattleFrontier)
  const choose = (start: number, selected: typeof eligible): boolean => {
    if (selected.length === requiredCount) return true
    for (let index = start; index < eligible.length; index += 1) {
      const candidate = eligible[index]!
      if (selected.some((pokemon) => pokemon.speciesId === candidate.speciesId)) continue
      if (checkDuplicateItems && candidate.heldItemId !== 0 && selected.some((pokemon) => pokemon.heldItemId === candidate.heldItemId)) continue
      if (choose(index + 1, [...selected, candidate])) return true
    }
    return false
  }
  return choose(0, [])
}

/** BattleHall_DoesPartyContainEligibleMons de scrcmd_20.c. */
export function isHgssPartyValidForBattleHall(party: PokemonParty, requiredCount: number): boolean {
  const eligible = party.members.filter((pokemon) => isEligibleForHgssBattleFrontier(pokemon) && pokemon.level >= 30)
  if (requiredCount === 2) {
    return eligible.some((pokemon, index) => eligible.some((other, otherIndex) => (
      index !== otherIndex && pokemon.speciesId === other.speciesId
    )))
  }
  return eligible.length >= requiredCount
}

export function getHgssBattleFacilityEligiblePartySlots(
  party: PokemonParty,
  facility: 'hall' | 'castle' | 'arcade',
): number[] {
  return party.members.flatMap((pokemon, slot) => (
    isEligibleForHgssBattleFrontier(pokemon) && (facility !== 'hall' || pokemon.level >= 30) ? [slot] : []
  ))
}
