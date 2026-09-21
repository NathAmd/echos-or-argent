import type { CanonicalPokemon } from './canonicalPokemon'
import { addPokemonPartyMember, hgssPartyCapacity, type PokemonParty } from './pokemonParty'
import {
  findFirstPokemonStorageSlot,
  placePokemonInFirstStorageSlot,
  type PokemonStorage,
  type PokemonStoragePlacement,
} from './pokemonStorage'
import {
  basePokemonTeamPolicy,
  resolvePokemonPartyMutationDecision,
  type PokemonPartyMutationReason,
  type PokemonTeamVeto,
  type PokemonTeamPolicy,
} from './pokemonTeamPolicy'

export type PokemonAcquisitionDestination =
  | { kind: 'party', slot: number }
  | { kind: 'storage', box: number, slot: number }
  | { kind: 'full' }

export type PokemonAcquisitionResult =
  | { kind: 'party', slot: number }
  | { kind: 'storage', placement: PokemonStoragePlacement, redirectedByPolicy?: PokemonTeamVeto }
  | { kind: 'full' }
  | { kind: 'blocked', code: string, reason: string }

export type PokemonAcquisitionPlan =
  | Readonly<{ kind: 'party', slot: number }>
  | Readonly<{ kind: 'storage', box: number, slot: number, previousBox: number, redirectedByPolicy?: PokemonTeamVeto }>
  | Readonly<{ kind: 'full' }>
  | Readonly<{ kind: 'blocked', code: string, reason: string }>

export type PokemonAcquisitionContext = Readonly<{
  reason?: Extract<PokemonPartyMutationReason, 'capture' | 'gift'>
}>

/**
 * Résout la destination HGSS commune avant toute mutation. Les captures
 * ordinaires et Safari ne peuvent ainsi plus diverger sur le passage d'une
 * équipe pleine vers la Boîte active, puis vers les dix-sept suivantes.
 */
export function findPokemonAcquisitionDestination(
  party: Pick<PokemonParty, 'members'>,
  storage: PokemonStorage,
): PokemonAcquisitionDestination {
  if (party.members.length < hgssPartyCapacity) return { kind: 'party', slot: party.members.length }
  const destination = findFirstPokemonStorageSlot(storage)
  return destination ? { kind: 'storage', ...destination } : { kind: 'full' }
}

export function hasPokemonAcquisitionCapacity(
  party: Pick<PokemonParty, 'members'>,
  storage: PokemonStorage,
): boolean {
  return findPokemonAcquisitionDestination(party, storage).kind !== 'full'
}

export function hasPokemonAcquisitionCapacityFor(
  party: Pick<PokemonParty, 'members'>,
  storage: PokemonStorage,
  pokemon: CanonicalPokemon,
  context: PokemonAcquisitionContext = {},
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): boolean {
  const plan = preparePokemonAcquisition(party, storage, pokemon, context, policy)
  return plan.kind === 'party' || plan.kind === 'storage'
}

/**
 * Réserve logiquement la destination avant tout effet irréversible. Si une
 * règle refuse l'ajout à une équipe qui a encore de la place, le PC devient
 * automatiquement la destination de repli. Le veto n'est publié que lorsque
 * ni l'équipe ni le PC ne peuvent accepter le Pokémon.
 */
export function preparePokemonAcquisition(
  party: Pick<PokemonParty, 'members'>,
  storage: PokemonStorage,
  pokemon: CanonicalPokemon,
  context: PokemonAcquisitionContext = {},
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonAcquisitionPlan {
  const destination = findPokemonAcquisitionDestination(party, storage)
  if (destination.kind !== 'party') {
    return destination.kind === 'storage'
      ? Object.freeze({ ...destination, previousBox: storage.currentBox })
      : Object.freeze(destination)
  }
  const decision = resolvePokemonPartyMutationDecision(
    context.reason ?? 'capture',
    party.members,
    [...party.members, pokemon],
    policy,
  )
  if (decision.kind === 'allowed') return Object.freeze(destination)
  const storageDestination = findFirstPokemonStorageSlot(storage)
  return storageDestination
    ? Object.freeze({ kind: 'storage', ...storageDestination, previousBox: storage.currentBox, redirectedByPolicy: Object.freeze({ code: decision.code, reason: decision.reason }) })
    : decision
}

/** Publie exactement le plan réservé, ou échoue sans mutation si l'état a changé. */
export function commitPreparedPokemonAcquisition(
  party: PokemonParty,
  storage: PokemonStorage,
  pokemon: CanonicalPokemon,
  plan: PokemonAcquisitionPlan,
): PokemonAcquisitionResult {
  if (plan.kind === 'full' || plan.kind === 'blocked') return plan
  assertPreparedPokemonAcquisitionAvailable(party, storage, plan)
  if (plan.kind === 'party') {
    if (!addPokemonPartyMember(party, pokemon)) {
      throw new Error("La destination d'équipe HGSS réservée n'est plus disponible.")
    }
    return plan
  }
  const placement = placePokemonInFirstStorageSlot(storage, pokemon)
  if (!placement || placement.box !== plan.box || placement.slot !== plan.slot) {
    throw new Error('La destination PC HGSS réservée n’est plus disponible.')
  }
  return plan.redirectedByPolicy
    ? { kind: 'storage', placement, redirectedByPolicy: plan.redirectedByPolicy }
    : { kind: 'storage', placement }
}

/** Vérifie une réservation sans publier le moindre changement. */
export function assertPreparedPokemonAcquisitionAvailable(
  party: Pick<PokemonParty, 'members'>,
  storage: PokemonStorage,
  plan: Exclude<PokemonAcquisitionPlan, { kind: 'full' | 'blocked' }>,
): void {
  if (plan.kind === 'party') {
    if (party.members.length !== plan.slot || plan.slot >= hgssPartyCapacity) {
      throw new Error("La destination d'équipe HGSS réservée n'est plus disponible.")
    }
    return
  }
  const destination = findFirstPokemonStorageSlot(storage)
  if (!destination || destination.box !== plan.box || destination.slot !== plan.slot || storage.currentBox !== plan.previousBox) {
    throw new Error('La destination PC HGSS réservée n’est plus disponible.')
  }
}

/**
 * Transaction d'acquisition unique : exactement une copie rejoint l'équipe
 * ou le PC, et un stockage plein ne modifie aucun des deux états.
 */
export function acquirePokemonIntoPartyOrStorage(
  party: PokemonParty,
  storage: PokemonStorage,
  pokemon: CanonicalPokemon,
  context: PokemonAcquisitionContext = {},
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonAcquisitionResult {
  return commitPreparedPokemonAcquisition(
    party,
    storage,
    pokemon,
    preparePokemonAcquisition(party, storage, pokemon, context, policy),
  )
}
