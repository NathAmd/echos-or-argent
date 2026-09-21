import type { PokemonCatalog } from '../../ndsTypes'
import { createCanonicalPokemon, type CanonicalPokemon, type PokemonOrigin, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { generateHgssShinyPersonality, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import { getGenderFromPersonality, type PokemonGender } from '../pokemon/pokemonFormulas'

const compoundEyesAbilityId = 14

export type WildPokemonNatureSource =
  | { kind: 'random' }
  | { kind: 'fixed', value: number }

export type CreateCanonicalWildPokemonOptions = {
  speciesId: number
  level: number
  catalog: PokemonCatalog
  rng: HgssLcrng
  originalTrainer: PokemonTrainerIdentity
  origin: PokemonOrigin
  nature?: WildPokemonNatureSource
  compoundEyes?: boolean
  forceShiny?: boolean
  /** Premier Pokémon : Synchro et Joli Sourire sont résolus avant la création native. */
  leadPokemon?: CanonicalPokemon
  /** Safari/Concours : jusqu'à quatre créations afin d'obtenir au moins un IV à 31. */
  forceOnePerfectIv?: boolean
}

function randRange(rng: HgssLcrng, maximum: number): number {
  return rng.nextU16() % maximum
}

function createPersonalityWithNature(rng: HgssLcrng, nature: number): number {
  if (!Number.isInteger(nature) || nature < 0 || nature >= 25) {
    throw new Error(`La nature sauvage HGSS ${nature} est invalide.`)
  }
  for (;;) {
    const personality = (rng.nextU16() | (rng.nextU16() << 16)) >>> 0
    if (personality % 25 === nature) return personality
  }
}

function createPersonalityWithNatureAndGender(
  rng: HgssLcrng,
  nature: number,
  gender: Exclude<PokemonGender, 'genderless'>,
  personalData: PokemonCatalog['personalData'][number],
): number {
  for (;;) {
    const personality = (rng.nextU16() | (rng.nextU16() << 16)) >>> 0
    if (personality % 25 === nature && getGenderFromPersonality(personalData, personality) === gender) return personality
  }
}

function rollWildNature(options: CreateCanonicalWildPokemonOptions): number {
  if (options.nature?.kind === 'fixed') return options.nature.value
  const lead = options.leadPokemon
  return lead && !lead.isEgg && lead.abilityId === 28 && randRange(options.rng, 2) === 0
    ? lead.nature
    : randRange(options.rng, 25)
}

function hasPerfectIv(pokemon: CanonicalPokemon): boolean {
  return Object.values(pokemon.individualValues).some((value) => value === 31)
}

function rollWildHeldItem(
  rng: HgssLcrng,
  heldItems: readonly [number, number],
  compoundEyes: boolean,
): number {
  const chance = randRange(rng, 100)
  const [commonItem, rareItem] = heldItems
  if (commonItem === rareItem && commonItem !== 0) return commonItem
  const commonThreshold = compoundEyes ? 20 : 45
  const rareThreshold = compoundEyes ? 80 : 95
  if (chance < commonThreshold) return 0
  return chance < rareThreshold ? commonItem : rareItem
}

export function hasWildHeldItemCompoundEyesInfluence(leadPokemon: CanonicalPokemon | undefined): boolean {
  return leadPokemon !== undefined && !leadPokemon.isEgg && leadPokemon.abilityId === compoundEyesAbilityId
}

export function createCanonicalWildPokemon(options: CreateCanonicalWildPokemonOptions): CanonicalPokemon {
  const personalData = options.catalog.personalData[options.speciesId]
  if (!personalData) throw new Error(`L'espece sauvage HGSS ${options.speciesId} est absente du catalogue ROM.`)
  const lead = options.leadPokemon
  const canCoerceGender = personalData.genderRatio !== 0 && personalData.genderRatio !== 254 && personalData.genderRatio !== 255
  const cuteCharmGender = canCoerceGender && lead && !lead.isEgg && lead.abilityId === 56 && randRange(options.rng, 3) !== 0
    ? lead.gender === 'female' ? 'male' : lead.gender === 'male' ? 'female' : undefined
    : undefined
  const attempts = options.forceOnePerfectIv && !cuteCharmGender ? 4 : 1
  let pokemon: CanonicalPokemon | undefined
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const nature = rollWildNature(options)
    const personality = options.forceShiny
      ? generateHgssShinyPersonality(options.originalTrainer.id, options.rng)
      : cuteCharmGender
        ? createPersonalityWithNatureAndGender(options.rng, nature, cuteCharmGender, personalData)
        : createPersonalityWithNature(options.rng, nature)
    pokemon = createCanonicalPokemon(options.catalog, {
      speciesId: options.speciesId,
      level: options.level,
      rng: options.rng,
      personality: { kind: 'fixed', value: personality },
      individualValues: { kind: 'random' },
      originalTrainer: options.originalTrainer,
      origin: options.origin,
      ballId: 4,
    })
    if (!options.forceOnePerfectIv || cuteCharmGender || hasPerfectIv(pokemon)) break
  }
  if (!pokemon) throw new Error(`La génération sauvage HGSS de l'espèce ${options.speciesId} n'a produit aucun Pokémon.`)
  pokemon.heldItemId = rollWildHeldItem(options.rng, personalData.heldItems, options.compoundEyes === true)
  return pokemon
}
