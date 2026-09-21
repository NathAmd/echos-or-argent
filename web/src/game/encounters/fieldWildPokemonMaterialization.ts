import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon, PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { assertHgssFieldPartyInvariant, type PokemonParty } from '../pokemon/pokemonParty'
import type { FieldWildEncounterRouteResolver } from './fieldWildEncounterRouteResolver'
import { createCanonicalHgssRoamerPokemon, type HgssRoamerSaveState } from './hgssRoamers'
import type { PreparedFieldWildEncounter, PreparedSafariWildEncounter } from './wildEncounterSelection'
import { createCanonicalWildPokemon, hasWildHeldItemCompoundEyesInfluence } from './wildPokemonGeneration'

export type FieldWildPokemonMaterializationRuntime = {
  readonly catalog: PokemonCatalog
  readonly rng: HgssLcrng
  readonly trainer: PokemonTrainerIdentity
  readonly language: number
  readonly gameVersion: number
}

export type FieldWildPokemonMaterializationOptions = {
  readonly prepared: PreparedFieldWildEncounter
  readonly routeResolver: FieldWildEncounterRouteResolver
  readonly pokemonRuntime: FieldWildPokemonMaterializationRuntime | undefined
  readonly metLocation: number | undefined
  readonly resolveMetTerrain: () => number
  readonly party: PokemonParty
  readonly roamers: Pick<HgssRoamerSaveState, 'roamers'>
  readonly materializeSafariEncounter: (encounter: PreparedSafariWildEncounter) => CanonicalPokemon
}

/** Matérialise l'identité préparée sans relire ni modifier la sélection sauvage. */
export function materializeFieldWildPokemon(
  options: FieldWildPokemonMaterializationOptions,
): CanonicalPokemon | undefined {
  const runtime = options.pokemonRuntime
  if (!runtime) return undefined
  const route = options.routeResolver(options.prepared.encounter)
  if (route.engine === 'safari') return options.materializeSafariEncounter(route.encounter)
  if (options.metLocation === undefined) throw new Error('La carte ROM de la rencontre sauvage est absente.')
  assertHgssFieldPartyInvariant(options.party)
  const roamer = route.encounter.method === 'roamer'
    ? options.roamers.roamers[route.encounter.roamerId]
    : undefined
  return roamer ? createCanonicalHgssRoamerPokemon(
    roamer,
    runtime.catalog,
    runtime.rng,
    runtime.trainer,
    runtime.language,
    runtime.gameVersion,
    { speciesId: route.encounter.speciesId, level: route.encounter.level },
  ) : createCanonicalWildPokemon({
    speciesId: route.encounter.speciesId,
    level: route.encounter.level,
    catalog: runtime.catalog,
    rng: runtime.rng,
    originalTrainer: runtime.trainer,
    origin: {
      language: runtime.language,
      gameVersion: runtime.gameVersion,
      metLocation: options.metLocation,
      metLevel: route.encounter.level,
      metTerrain: options.resolveMetTerrain(),
    },
    compoundEyes: hasWildHeldItemCompoundEyesInfluence(options.party.members[0]),
    leadPokemon: options.party.members[0],
  })
}
