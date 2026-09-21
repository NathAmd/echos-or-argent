import type { PokemonCatalog } from '../../ndsTypes'
import { markPokemonCaught, type HgssPokedexState } from '../pokedex/hgssPokedex'
import type { CanonicalPokemon, PokemonTrainerIdentity } from './canonicalPokemon'
import { calculatePokemonStats, resolvePokemonPersonalData } from './pokemonFormulas'
import type { PokemonParty } from './pokemonParty'

export const hgssHatchedTogepiFlag = 0x983
export const hgssElmEggHatchedCallTrigger = 0
export const hgssEggsHatchedGameStat = 12
export const hgssHatchedEggScore = 7

export type HgssTogepiEggIdentity = {
  personality: number
  gender: CanonicalPokemon['gender']
}

export type HgssEggHatchResult = {
  partySlot: number
  pokemon: CanonicalPokemon
  isMrPokemonTogepi: boolean
}

export function findHgssHatchableEggSlot(party: PokemonParty): number | undefined {
  const slot = party.members.findIndex((pokemon) => pokemon.isEgg && pokemon.friendship === 0)
  return slot < 0 ? undefined : slot
}

export function isHgssMrPokemonTogepi(
  pokemon: CanonicalPokemon | undefined,
  identity: HgssTogepiEggIdentity | undefined,
  trainer: PokemonTrainerIdentity,
  language: number,
  gameVersion: number,
): boolean {
  if (!pokemon || !identity || ![175, 176, 468].includes(pokemon.speciesId)) return false
  return pokemon.originalTrainer.id === trainer.id
    && pokemon.originalTrainer.gender === trainer.gender
    && pokemon.origin.language === language
    && pokemon.origin.gameVersion === gameVersion
    && pokemon.personality === identity.personality
    && pokemon.gender === identity.gender
}

/**
 * Applique la transformation PK4 effectuée par sub_0206D328 puis
 * MonSetTrainerMemo(..., 6, mapSection) dans le jeu natif.
 */
export function hatchHgssPartyEgg(
  party: PokemonParty,
  partySlot: number,
  context: {
    catalog: PokemonCatalog
    pokedex: HgssPokedexState
    trainer: PokemonTrainerIdentity
    language: number
    gameVersion: number
    mapSection: number
    now: Date
    nickname?: string
    togepiEggIdentity?: HgssTogepiEggIdentity
  },
): HgssEggHatchResult {
  const pokemon = party.members[partySlot]
  if (!pokemon?.isEgg || pokemon.friendship !== 0) {
    throw new Error(`L'emplacement ${partySlot} ne contient aucun Œuf HGSS prêt à éclore.`)
  }

  const receivedDate = pokemon.origin.eggDate ?? pokemon.origin.metDate
  const receivedLocation = pokemon.origin.eggLocation ?? pokemon.origin.metLocation
  const now = context.now
  pokemon.origin = {
    ...pokemon.origin,
    eggLocation: receivedLocation,
    eggDate: receivedDate && { ...receivedDate },
    metLocation: context.mapSection,
    metLevel: 0,
    // Stratégie 6 du Trainer Memo : éclosion sur la carte courante.
    metTerrain: 6,
    metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
  }
  pokemon.originalTrainer = { ...context.trainer }
  pokemon.isEgg = false
  pokemon.nickname = context.nickname?.trim() || undefined
  if (pokemon.nickname === pokemon.speciesName) pokemon.nickname = undefined
  pokemon.nicknameSource = pokemon.nickname === undefined ? undefined : 'user-text'
  pokemon.nicknameLocalRef = undefined
  pokemon.friendship = 120
  pokemon.ballId = 4
  pokemon.status = 0
  const personalData = resolvePokemonPersonalData(context.catalog, pokemon.speciesId, pokemon.form)
  pokemon.stats = calculatePokemonStats(personalData, pokemon.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  pokemon.currentHp = pokemon.stats.hp
  markPokemonCaught(context.pokedex, pokemon, context.language)

  return {
    partySlot,
    pokemon,
    isMrPokemonTogepi: isHgssMrPokemonTogepi(
      pokemon,
      context.togepiEggIdentity,
      context.trainer,
      context.language,
      context.gameVersion,
    ),
  }
}
