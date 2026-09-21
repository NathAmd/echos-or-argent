import type { HgssTrainerPokemon } from '../../rom/battle/trainerData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'

export type FieldTrainerRosterContext = Readonly<{
  battleKind: 'trainer' | 'tag-trainer' | 'multi-trainer'
  role: 'ally' | 'opponent'
  trainerId: number
}>

export type FieldTrainerHouseRosterContext = Readonly<{
  battleKind: 'trainer-house'
  role: 'opponent'
  trainerId: number
  trainerHouseSlot: number
}>

export type ScriptedWildPokemonDefinition = Readonly<{
  speciesId: number
  level: number
  form?: number
  heldItemId?: number
  moveIds?: readonly [number, number, number, number]
}>

export type FieldBattleRosterPolicy = Readonly<{
  transformTrainerParty: (
    party: readonly Readonly<HgssTrainerPokemon>[],
    context: FieldTrainerRosterContext,
  ) => readonly Readonly<HgssTrainerPokemon>[]
  transformTrainerHouseParty: (
    party: readonly CanonicalPokemon[],
    context: FieldTrainerHouseRosterContext,
  ) => readonly CanonicalPokemon[]
  transformScriptedWildPokemon: (
    pokemon: ScriptedWildPokemonDefinition,
  ) => ScriptedWildPokemonDefinition
}>

/** Les definitions ROM traversent le port sans transformation dans le jeu de base. */
export const baseFieldBattleRosterPolicy: FieldBattleRosterPolicy = Object.freeze({
  transformTrainerParty: (party) => party,
  transformTrainerHouseParty: (party) => party,
  transformScriptedWildPokemon: (pokemon) => pokemon,
})

/** Les overlays de roster sont appliques dans un ordre explicite et fige. */
export function composeFieldBattleRosterPolicies(
  policies: readonly FieldBattleRosterPolicy[],
): FieldBattleRosterPolicy {
  const ordered = Object.freeze([...policies])
  return Object.freeze({
    transformTrainerParty: (party, context) => ordered.reduce(
      (current, policy) => policy.transformTrainerParty(current, context),
      party,
    ),
    transformTrainerHouseParty: (party, context) => ordered.reduce(
      (current, policy) => policy.transformTrainerHouseParty(current, context),
      party,
    ),
    transformScriptedWildPokemon: (pokemon) => ordered.reduce(
      (current, policy) => policy.transformScriptedWildPokemon(current),
      pokemon,
    ),
  })
}
