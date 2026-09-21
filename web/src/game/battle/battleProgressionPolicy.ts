import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import {
  basePokemonLevelPolicy,
  type PokemonLevelPolicy,
} from '../pokemon/pokemonLevelPolicy'
import {
  applyDefeatedPokemonProgression,
  type BattleProgressionResult,
  type HgssBattleExperienceModifiers,
} from './battleProgression'

/**
 * Requête de progression indépendante de toute présentation. Les références
 * Pokémon restent celles que le moteur de progression doit effectivement
 * lire et mettre à jour.
 */
export type DefeatedPokemonProgressionRequest = Readonly<{
  pokemon: CanonicalPokemon
  defeated: CanonicalPokemon
  trainerBattle: boolean
  experienceDivisor?: number
  modifiers?: Readonly<HgssBattleExperienceModifiers>
}>

/**
 * Une politique transforme les paramètres avant l'application des règles
 * HGSS. Elle ne calcule ni n'affiche elle-même l'EXP.
 */
export type BattleProgressionPolicy = Readonly<{
  transformDefeatedPokemonRequest: (
    request: DefeatedPokemonProgressionRequest,
  ) => DefeatedPokemonProgressionRequest
}>

/** Signature historique exposée aux moteurs de combat après composition. */
export type BattleProgressionApplicator = (
  pokemon: CanonicalPokemon,
  defeated: CanonicalPokemon,
  catalog: PokemonCatalog,
  trainerBattle: boolean,
  experienceDivisor?: number,
  modifiers?: HgssBattleExperienceModifiers,
) => BattleProgressionResult

/** Politique neutre : la requête et le comportement HGSS restent inchangés. */
export const baseBattleProgressionPolicy: BattleProgressionPolicy = Object.freeze({
  transformDefeatedPokemonRequest: (request) => request,
})

/**
 * Compose les transformations dans l'ordre fourni. Chaque politique reçoit le
 * résultat de la précédente et la liste est figée au moment de la composition.
 */
export function composeBattleProgressionPolicies(
  policies: readonly BattleProgressionPolicy[],
): BattleProgressionPolicy {
  const orderedPolicies = Object.freeze([...policies])
  return Object.freeze({
    transformDefeatedPokemonRequest(request) {
      return orderedPolicies.reduce(
        (current, policy) => policy.transformDefeatedPokemonRequest(current),
        request,
      )
    },
  })
}

/** Applique une requête après passage dans le port de politique. */
export function applyDefeatedPokemonProgressionWithPolicy(
  request: DefeatedPokemonProgressionRequest,
  catalog: PokemonCatalog,
  policy: BattleProgressionPolicy = baseBattleProgressionPolicy,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): BattleProgressionResult {
  const resolved = policy.transformDefeatedPokemonRequest(request)
  return applyDefeatedPokemonProgression(
    resolved.pokemon,
    resolved.defeated,
    catalog,
    resolved.trainerBattle,
    resolved.experienceDivisor,
    resolved.modifiers === undefined ? undefined : { ...resolved.modifiers },
    levelPolicy,
  )
}

/** Adaptateur de composition conservant la signature historique du moteur. */
export function createBattleProgressionApplicator(
  policy: BattleProgressionPolicy = baseBattleProgressionPolicy,
  levelPolicy: PokemonLevelPolicy = basePokemonLevelPolicy,
): BattleProgressionApplicator {
  return (pokemon, defeated, catalog, trainerBattle, experienceDivisor, modifiers) => (
    applyDefeatedPokemonProgressionWithPolicy({
      pokemon,
      defeated,
      trainerBattle,
      experienceDivisor,
      modifiers,
    }, catalog, policy, levelPolicy)
  )
}
