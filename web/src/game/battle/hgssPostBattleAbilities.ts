import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { applyHgssPostBattlePokerus, type HgssPokerusAcquisition, type PokemonParty } from '../pokemon/pokemonParty'

const pickupCommonItems = [17, 18, 26, 3, 79, 78, 27, 25, 2, 28, 50, 80, 81, 93, 23, 29, 51, 41] as const
const pickupRareItems = [25, 92, 221, 23, 38, 278, 383, 40, 413, 234, 353] as const
const pickupWeightThresholds = [30, 40, 50, 60, 70, 80, 90, 94, 98] as const
const honeyGatherChanceByLevel = [5, 10, 15, 20, 25, 30, 35, 40, 45, 50] as const

export type HgssPostBattleAbilityItem = { partySlot: number, abilityId: 53 | 118, itemId: number }

/** BtlCmd_GenerateEndOfBattleItem et ses quatre tables de l'overlay 12 HGSS. */
export function applyHgssPostBattleAbilityItems(party: CanonicalPokemon[], rng: HgssLcrng): HgssPostBattleAbilityItem[] {
  const generated: HgssPostBattleAbilityItem[] = []
  for (let partySlot = 0; partySlot < party.length; partySlot += 1) {
    const pokemon = party[partySlot]!
    if (pokemon.speciesId <= 0 || pokemon.isEgg || pokemon.heldItemId !== 0) continue
    if (pokemon.abilityId === 53 && rng.nextU16() % 10 === 0) {
      const roll = rng.nextU16() % 100
      const levelBand = Math.min(9, Math.floor((pokemon.level - 1) / 10))
      let itemId: number | undefined
      for (let index = 0; index < pickupWeightThresholds.length; index += 1) {
        if (pickupWeightThresholds[index]! > roll) { itemId = pickupCommonItems[levelBand + index]; break }
        if (roll >= 98) { itemId = pickupRareItems[levelBand + 99 - roll]; break }
      }
      if (itemId !== undefined) { pokemon.heldItemId = itemId; generated.push({ partySlot, abilityId: 53, itemId }) }
    }
    if (pokemon.abilityId === 118 && pokemon.heldItemId === 0) {
      const levelBand = Math.min(9, Math.floor(Math.max(0, pokemon.level - 1) / 10))
      if (rng.nextU16() % 100 < honeyGatherChanceByLevel[levelBand]!) { pokemon.heldItemId = 94; generated.push({ partySlot, abilityId: 118, itemId: 94 }) }
    }
  }
  return generated
}

export type HgssPostBattleProgression = Readonly<{
  abilityItems: readonly HgssPostBattleAbilityItem[]
  pokerus: Readonly<{ acquisition?: HgssPokerusAcquisition, spreadSlots: readonly number[] }>
}>

/**
 * Ordre natif de fin de combat hors liaison : Ramassage/Cherche Miel ne sont
 * exécutés que par le script de victoire, puis le contrôleur tente le Pokérus
 * et sa propagation pour toute issue de combat.
 */
export function applyHgssPostBattleProgression(
  party: PokemonParty,
  rng: HgssLcrng,
  battleWon: boolean,
): HgssPostBattleProgression {
  const abilityItems = battleWon ? applyHgssPostBattleAbilityItems(party.members, rng) : []
  const pokerus = applyHgssPostBattlePokerus(party, rng)
  return Object.freeze({ abilityItems: Object.freeze(abilityItems), pokerus })
}
