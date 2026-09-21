import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssPokedexState } from '../pokedex/hgssPokedex'
import { markPokemonCaught } from '../pokedex/hgssPokedex'
import { createCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { basePokemonInitialTeamResolver, resolvePokemonInitialTeam, type PokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'
import {
  addPokemonPartyMember,
  removePokemonPartyMember,
  replacePokemonParty,
  resetPokemonPartyPokeathlonModifiers,
  type PokemonParty,
} from '../pokemon/pokemonParty'
import {
  assertPokemonPartyMutationAllowed,
  basePokemonTeamPolicy,
  PokemonTeamPolicyVetoError,
  resolvePokemonPartyMutationDecision,
  type PokemonPartyMutationDecision,
  type PokemonPartyMutationReason,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'
import { hgssStarterSpeciesIds } from '../pokemon/hgssStarters'

export type HgssScriptedPokemonRuntime = Readonly<{
  catalog: PokemonCatalog
  rng: HgssLcrng
  trainer: PokemonTrainerIdentity
  language: number
  gameVersion: number
  now: () => Date
}>

export function giveHgssStarterToParty(
  party: PokemonParty,
  pokedex: HgssPokedexState,
  choice: number,
  mapSection: number,
  runtime: HgssScriptedPokemonRuntime,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
  initialTeamResolver: PokemonInitialTeamResolver = basePokemonInitialTeamResolver,
): CanonicalPokemon {
  const speciesId = hgssStarterSpeciesIds[choice]
  if (speciesId === undefined) throw new Error(`Starter HGSS ${choice} invalide.`)
  const definitions = resolvePokemonInitialTeam({
    choice,
    baseDefinition: { speciesId, level: 5, form: 0 },
  }, initialTeamResolver)
  const now = runtime.now()
  const initialTeam = definitions.map((definition) => createCanonicalPokemon(runtime.catalog, {
    speciesId: definition.speciesId,
    level: definition.level,
    form: definition.form,
    rng: runtime.rng,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: runtime.trainer,
    origin: {
      language: runtime.language,
      gameVersion: runtime.gameVersion,
      metLocation: mapSection,
      metLevel: definition.level,
      metTerrain: 12,
      metDate: { year: now.getFullYear(), month: now.getMonth() + 1, day: now.getDate() },
    },
    ballId: 4,
  }))
  assertPokemonPartyMutationAllowed('starter', party.members, initialTeam, policy)
  replacePokemonParty(party, initialTeam)
  initialTeamResolver.onInitialTeamCommitted?.(initialTeam)
  for (const pokemon of initialTeam) markPokemonCaught(pokedex, pokemon, runtime.language)
  return initialTeam[0]!
}

export function appendScriptedPokemonToParty(
  party: PokemonParty,
  pokemon: CanonicalPokemon,
  reason: Extract<PokemonPartyMutationReason, 'gift' | 'loan'>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  const result = tryAppendScriptedPokemonToParty(party, pokemon, reason, policy)
  if (result.kind === 'blocked') throw new PokemonTeamPolicyVetoError(result)
}

export function tryAppendScriptedPokemonToParty(
  party: PokemonParty,
  pokemon: CanonicalPokemon,
  reason: Extract<PokemonPartyMutationReason, 'gift' | 'loan'>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): Readonly<{ kind: 'added' }> | Extract<PokemonPartyMutationDecision, { kind: 'blocked' }> {
  const decision = resolvePokemonPartyMutationDecision(reason, party.members, [...party.members, pokemon], policy)
  if (decision.kind === 'blocked') return decision
  if (!addPokemonPartyMember(party, pokemon)) throw new Error("L'équipe HGSS est pleine.")
  return Object.freeze({ kind: 'added' })
}

export function replaceScriptedPokemonInParty(
  party: PokemonParty,
  partySlot: number,
  pokemon: CanonicalPokemon,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  const after = [...party.members]
  if (!after[partySlot]) throw new Error(`Le Pokémon d’équipe ${partySlot} à échanger est absent.`)
  after[partySlot] = pokemon
  assertPokemonPartyMutationAllowed('npc-trade', party.members, after, policy)
  party.members[partySlot] = pokemon
  resetPokemonPartyPokeathlonModifiers(party, partySlot)
}

export function preflightScriptedPokemonRemoval(
  party: PokemonParty,
  partySlot: number,
  reason: Extract<PokemonPartyMutationReason, 'loan' | 'daycare'>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): CanonicalPokemon {
  const decision = resolveScriptedPokemonRemovalDecision(party, partySlot, reason, policy)
  if (decision.kind === 'blocked') throw new PokemonTeamPolicyVetoError(decision)
  return decision.pokemon
}

export function resolveScriptedPokemonRemovalDecision(
  party: PokemonParty,
  partySlot: number,
  reason: Extract<PokemonPartyMutationReason, 'loan' | 'daycare'>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): Readonly<{ kind: 'allowed', pokemon: CanonicalPokemon }> | Extract<PokemonPartyMutationDecision, { kind: 'blocked' }> {
  const pokemon = party.members[partySlot]
  if (!pokemon) throw new Error(`Le Pokémon d’équipe ${partySlot} à retirer est absent.`)
  const decision = resolvePokemonPartyMutationDecision(reason, party.members, party.members.filter((_, index) => index !== partySlot), policy)
  return decision.kind === 'blocked' ? decision : Object.freeze({ kind: 'allowed', pokemon })
}

export function removeScriptedPokemonFromParty(
  party: PokemonParty,
  partySlot: number,
  reason: Extract<PokemonPartyMutationReason, 'loan' | 'daycare'>,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): CanonicalPokemon {
  preflightScriptedPokemonRemoval(party, partySlot, reason, policy)
  const removed = removePokemonPartyMember(party, partySlot)
  if (!removed) throw new Error(`Le Pokémon d’équipe ${partySlot} à retirer est absent.`)
  return removed
}
