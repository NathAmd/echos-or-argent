import type { CanonicalPokemon } from './canonicalPokemon'

export const pokemonLevelPolicySources = Object.freeze([
  'battle',
  'rare-candy',
  'daycare',
] as const)

export type PokemonLevelPolicySource = typeof pokemonLevelPolicySources[number]

export type PokemonLevelPolicyPokemon = Readonly<Pick<
  CanonicalPokemon,
  'instanceId' | 'speciesId' | 'level' | 'experience'
>>

export type PokemonLevelPolicyContext = Readonly<{
  source: PokemonLevelPolicySource
  pokemon: PokemonLevelPolicyPokemon
}>

export type PokemonLevelPolicy = Readonly<{
  resolveLevelCap: (context: PokemonLevelPolicyContext) => number
}>

/** Politique neutre : le niveau maximal natif de HGSS reste 100. */
export const basePokemonLevelPolicy: PokemonLevelPolicy = Object.freeze({
  resolveLevelCap: () => 100,
})

function validatePokemonLevelCap(levelCap: number, source: PokemonLevelPolicySource): number {
  if (!Number.isSafeInteger(levelCap) || levelCap < 1 || levelCap > 100) {
    throw new Error(`Le plafond de niveau Pokémon ${levelCap} pour la source ${source} doit être un entier compris entre 1 et 100.`)
  }
  return levelCap
}

/**
 * Compose des plafonds cumulatifs : le plus bas gagne, quelle que soit la
 * politique qui l'a fourni. La liste est capturée au moment de la composition.
 */
export function composePokemonLevelPolicies(
  policies: readonly PokemonLevelPolicy[],
): PokemonLevelPolicy {
  const orderedPolicies = Object.freeze([...policies])
  return Object.freeze({
    resolveLevelCap(context) {
      let levelCap = 100
      for (const policy of orderedPolicies) {
        levelCap = Math.min(
          levelCap,
          validatePokemonLevelCap(policy.resolveLevelCap(context), context.source),
        )
      }
      return levelCap
    },
  })
}

/** Consulte une politique avec un instantané non mutable du Pokémon. */
export function resolvePokemonLevelCap(
  pokemon: PokemonLevelPolicyPokemon,
  source: PokemonLevelPolicySource,
  policy: PokemonLevelPolicy = basePokemonLevelPolicy,
): number {
  const context: PokemonLevelPolicyContext = Object.freeze({
    source,
    pokemon: Object.freeze({
      instanceId: pokemon.instanceId,
      speciesId: pokemon.speciesId,
      level: pokemon.level,
      experience: pokemon.experience,
    }),
  })
  return validatePokemonLevelCap(policy.resolveLevelCap(context), source)
}
