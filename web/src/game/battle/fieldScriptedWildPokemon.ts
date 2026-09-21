import type { PokemonCatalog } from '../../ndsTypes'
import type { ScriptedWildPokemonDefinition } from './fieldBattleRosterPolicy'
import type { PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import { createCanonicalWildPokemon } from '../encounters/wildPokemonGeneration'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

export type FieldScriptedWildPokemonOptions = Readonly<{
  definition: ScriptedWildPokemonDefinition
  battleParameter?: number
  catalog: PokemonCatalog
  rng: HgssLcrng
  originalTrainer: PokemonTrainerIdentity
  language: number
  gameVersion: number
  metLocation: number
  metTerrain: number
}>

/** Matérialisation partagée par les scripts ROM et les quêtes NG+. */
export function createFieldScriptedWildPokemon(options: FieldScriptedWildPokemonOptions) {
  return createCanonicalWildPokemon({
    speciesId: options.definition.speciesId,
    level: options.definition.level,
    catalog: options.catalog,
    rng: options.rng,
    originalTrainer: options.originalTrainer,
    origin: { language: options.language, gameVersion: options.gameVersion, metLocation: options.metLocation,
      metLevel: options.definition.level, metTerrain: options.metTerrain },
    forceShiny: (options.battleParameter ?? 0) !== 0,
  })
}
