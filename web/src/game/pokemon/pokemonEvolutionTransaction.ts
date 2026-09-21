import type { PokemonCatalog } from '../../ndsTypes'
import type { PokemonEvolutionRule } from '../../rom/pokemon/evolutionData'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import { takeBagItem } from '../items/bagInventory'
import { cloneCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import { createShedinjaPokemonInstanceId } from './pokemonInstanceId'
import {
  basePokemonTeamPolicy,
  PokemonTeamPolicyVetoError,
  resolvePokemonPartyMutationDecision,
  type PokemonPartyMutationDecision,
  type PokemonTeamPolicy,
  type PokemonTeamVeto,
} from './pokemonTeamPolicy'
import {
  evolveCanonicalPokemon,
  evolveCanonicalPokemonPartyMemberByRule,
  matchesPokemonEvolutionIdentity,
  matchesPokemonPersistentEvolutionIdentity,
  resolveShedinjaEvolution,
  resolveTradeEvolution,
  type PokemonEvolutionIdentity,
  type PokemonEvolutionMutationResult,
  type PokemonPartyEvolutionResult,
} from './pokemonEvolution'

export type ShedinjaCreationContext = {
  inventory: Map<number, number>
  pokeBallItemId?: number
  maxPartySize?: number
  teamPolicy?: PokemonTeamPolicy
}

export type ShedinjaCreationEligibility =
  | { kind: 'eligible', rule: PokemonEvolutionRule, pokeBallItemId: number }
  | { kind: 'not-applicable' }
  | { kind: 'party-full' }
  | { kind: 'missing-poke-ball', pokeBallItemId: number }

export type ShedinjaEvolutionResult = {
  pokemon: CanonicalPokemon
  partySlot: number
  rule: PokemonEvolutionRule
  mutation: PokemonEvolutionMutationResult
  consumedPokeBallItemId: number
}

export type PokemonEvolutionTransactionResult = {
  primary: PokemonPartyEvolutionResult
  shedinja?: ShedinjaEvolutionResult
  shedinjaBlocked?: PokemonTeamVeto
}

function requireEvolutionSource(
  party: readonly CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
): CanonicalPokemon {
  const source = findEvolutionSource(party, preferredPartySlot, identity)
  if (!source) throw new Error(`Le Pokemon ${identity.speciesId}/${identity.personality} a evoluer n'est plus dans l'equipe.`)
  return source
}

function findEvolutionSource(
  party: readonly CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
): CanonicalPokemon | undefined {
  const preferred = party[preferredPartySlot]
  if (preferred && matchesPokemonEvolutionIdentity(preferred, identity)) return preferred
  return party.find((pokemon) => matchesPokemonEvolutionIdentity(pokemon, identity))
}

export function resolveShedinjaCreationEligibility(
  source: CanonicalPokemon,
  catalog: PokemonCatalog,
  party: readonly CanonicalPokemon[],
  context: ShedinjaCreationContext,
): ShedinjaCreationEligibility {
  const rule = resolveShedinjaEvolution(source, catalog)
  if (!rule) return { kind: 'not-applicable' }
  if (party.length >= (context.maxPartySize ?? 6)) return { kind: 'party-full' }
  const pokeBallItemId = context.pokeBallItemId ?? 4
  if ((context.inventory.get(pokeBallItemId) ?? 0) <= 0) return { kind: 'missing-poke-ball', pokeBallItemId }
  return { kind: 'eligible', rule, pokeBallItemId }
}

/**
 * Prévisualise l'évolution sur un clone, puis soumet l'équipe résultante à la
 * même politique que la transaction finale. Ni le Pokémon, ni l'équipe, ni le
 * Sac ne sont modifiés par ce préflight.
 */
export function resolvePokemonEvolutionMutationDecision(
  party: readonly CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
  rule: PokemonEvolutionRule,
  catalog: PokemonCatalog,
  teamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonPartyMutationDecision {
  const source = requireEvolutionSource(party, preferredPartySlot, identity)
  const sourcePartySlot = party.indexOf(source)
  const evolvedPreview = cloneCanonicalPokemon(source)
  evolveCanonicalPokemon(evolvedPreview, rule.targetSpeciesId, catalog, rule)
  return resolvePokemonPartyMutationDecision(
    'evolution',
    party,
    party.map((member, partySlot) => partySlot === sourcePartySlot ? evolvedPreview : member),
    teamPolicy,
  )
}

/**
 * Transaction canonique d'évolution. La méthode 13 peut produire le résultat
 * secondaire méthode 14, sans dupliquer l'objet tenu ni le courrier de Ningale.
 */
export function evolveCanonicalPokemonPartyMemberByRuleTransaction(
  party: CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
  rule: PokemonEvolutionRule,
  catalog: PokemonCatalog,
  shedinjaContext?: ShedinjaCreationContext,
): PokemonEvolutionTransactionResult {
  const source = findEvolutionSource(party, preferredPartySlot, identity)
  if (!source) {
    return { primary: evolveCanonicalPokemonPartyMemberByRule(party, preferredPartySlot, identity, rule, catalog) }
  }
  const sourceSnapshot = cloneCanonicalPokemon(source)
  const sourcePartySlot = party.indexOf(source)
  const primaryPreview = cloneCanonicalPokemon(sourceSnapshot)
  evolveCanonicalPokemon(primaryPreview, rule.targetSpeciesId, catalog, rule)
  const primaryDecision = resolvePokemonEvolutionMutationDecision(
    party, preferredPartySlot, identity, rule, catalog,
    shedinjaContext?.teamPolicy ?? basePokemonTeamPolicy,
  )
  if (primaryDecision.kind === 'blocked') throw new PokemonTeamPolicyVetoError(primaryDecision)
  const eligibility = rule.method === 13 && shedinjaContext
    ? resolveShedinjaCreationEligibility(sourceSnapshot, catalog, party, shedinjaContext)
    : { kind: 'not-applicable' } as const
  let shedinjaCandidate: { pokemon: CanonicalPokemon, mutation: PokemonEvolutionMutationResult } | undefined
  let shedinjaBlocked: PokemonTeamVeto | undefined
  if (eligibility.kind === 'eligible') {
    // Prépare les deux mutations avant d'écrire dans l'équipe ou le Sac.
    const pokemon = {
      ...cloneCanonicalPokemon(primaryPreview),
      instanceId: createShedinjaPokemonInstanceId(sourceSnapshot.instanceId),
    }
    pokemon.nickname = undefined
    pokemon.nicknameSource = undefined
    pokemon.nicknameLocalRef = undefined
    pokemon.heldItemId = 0
    pokemon.mailIdentity = undefined
    pokemon.ballId = eligibility.pokeBallItemId
    const mutation = evolveCanonicalPokemon(
      pokemon,
      eligibility.rule.targetSpeciesId,
      catalog,
      eligibility.rule,
      { learnTargetLevelMoves: false },
    )
    pokemon.status = 0
    pokemon.shinyLeafMask = 0
    pokemon.ribbonIds = []
    const decision = resolvePokemonPartyMutationDecision(
      'shedinja',
      party,
      [...party.map((member, partySlot) => partySlot === sourcePartySlot ? primaryPreview : member), pokemon],
      shedinjaContext?.teamPolicy ?? basePokemonTeamPolicy,
    )
    if (decision.kind === 'blocked') shedinjaBlocked = { code: decision.code, reason: decision.reason }
    else shedinjaCandidate = { pokemon, mutation }
  }
  const primary = evolveCanonicalPokemonPartyMemberByRule(party, preferredPartySlot, identity, rule, catalog)
  if (primary.alreadyApplied || eligibility.kind !== 'eligible' || !shedinjaContext || !shedinjaCandidate) {
    return shedinjaBlocked ? { primary, shedinjaBlocked } : { primary }
  }
  if (!takeBagItem(shedinjaContext.inventory, eligibility.pokeBallItemId, 1)) {
    throw new Error(`La Poké Ball ${eligibility.pokeBallItemId} requise par Munja a disparu pendant la transaction.`)
  }
  const partySlot = party.length
  party.push(shedinjaCandidate.pokemon)
  return {
    primary,
    shedinja: {
      pokemon: shedinjaCandidate.pokemon,
      partySlot,
      rule: eligibility.rule,
      mutation: shedinjaCandidate.mutation,
      consumedPokeBallItemId: eligibility.pokeBallItemId,
    },
  }
}

/** Résolution puis remplacement transactionnel du Pokémon reçu par échange. */
export function evolveCanonicalPokemonPartyMemberAfterTrade(
  party: CanonicalPokemon[],
  preferredPartySlot: number,
  identity: PokemonEvolutionIdentity,
  catalog: PokemonCatalog,
  itemCatalog?: HgssItemCatalog,
): PokemonEvolutionTransactionResult | undefined {
  const source = findEvolutionSource(party, preferredPartySlot, identity)
  const alreadyEvolved = source ? undefined : party.find((pokemon) => (
    matchesPokemonPersistentEvolutionIdentity(pokemon, identity) && pokemon.speciesId !== identity.speciesId
  ))
  const rule = source
    ? resolveTradeEvolution(source, catalog, { itemCatalog })
    : catalog.evolutions[identity.speciesId]?.find((candidate) => (
      (candidate.method === 5 || candidate.method === 6)
      && candidate.targetSpeciesId === alreadyEvolved?.speciesId
    ))
  if (!source && !alreadyEvolved) requireEvolutionSource(party, preferredPartySlot, identity)
  if (!rule) return undefined
  return evolveCanonicalPokemonPartyMemberByRuleTransaction(
    party,
    preferredPartySlot,
    identity,
    rule,
    catalog,
  )
}
