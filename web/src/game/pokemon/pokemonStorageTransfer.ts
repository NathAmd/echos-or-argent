import { cloneCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import { assertHgssFieldPartyInvariant, clonePokemonParty, hgssPartyCapacity, type PokemonParty } from './pokemonParty'
import { clonePokemonStorage, hgssStorageBoxCapacity, hgssStorageBoxCount, type PokemonStorage } from './pokemonStorage'
import { basePokemonTeamPolicy, createPokemonPartyMutationIntent, type PokemonTeamPolicy } from './pokemonTeamPolicy'

export type PokemonStorageLocation =
  | { kind: 'party', slot: number }
  | { kind: 'box', box: number, slot: number }

export type PokemonStorageTransferResult =
  | { kind: 'transferred', party: PokemonParty, storage: PokemonStorage }
  | { kind: 'released', party: PokemonParty, storage: PokemonStorage }
  | { kind: 'blocked', reason: string, code?: string }

function readLocation(
  party: PokemonParty,
  storage: PokemonStorage,
  location: PokemonStorageLocation,
): CanonicalPokemon | undefined {
  return location.kind === 'party'
    ? party.members[location.slot]
    : storage.boxes[location.box]?.[location.slot]
}

function isValidLocation(location: PokemonStorageLocation): boolean {
  return Number.isInteger(location.slot) && location.slot >= 0 && (
    location.kind === 'party'
      ? location.slot < hgssPartyCapacity
      : Number.isInteger(location.box) && location.box >= 0 && location.box < hgssStorageBoxCount
        && location.slot < hgssStorageBoxCapacity
  )
}

function sameLocation(first: PokemonStorageLocation, second: PokemonStorageLocation): boolean {
  return first.kind === second.kind && first.slot === second.slot
    && (first.kind === 'party' || first.box === (second as Extract<PokemonStorageLocation, { kind: 'box' }>).box)
}

/**
 * Transaction atomique partagée par toute interface PC. Aucune mutation n'est
 * publiée si une position est invalide ou si l'équipe terrain deviendrait
 * inutilisable.
 */
export function transferPokemonStorage(
  sourceParty: PokemonParty,
  sourceStorage: PokemonStorage,
  source: PokemonStorageLocation,
  target: PokemonStorageLocation,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonStorageTransferResult {
  if (!isValidLocation(source) || !isValidLocation(target) || sameLocation(source, target)) {
    return { kind: 'blocked', reason: 'Cette destination PC est invalide.' }
  }
  const pokemon = readLocation(sourceParty, sourceStorage, source)
  if (!pokemon) return { kind: 'blocked', reason: 'Aucun Pokémon ne se trouve à cet emplacement.' }

  const party = clonePokemonParty(sourceParty)
  const storage = clonePokemonStorage(sourceStorage)
  const targetPokemon = readLocation(party, storage, target)

  if (source.kind === 'party' && target.kind === 'party') {
    if (!targetPokemon) return { kind: 'blocked', reason: 'Cette place d’équipe est vide.' }
    ;[party.members[source.slot], party.members[target.slot]] = [party.members[target.slot]!, party.members[source.slot]!]
    ;[party.pokeathlonModifiers![source.slot], party.pokeathlonModifiers![target.slot]] = [party.pokeathlonModifiers![target.slot]!, party.pokeathlonModifiers![source.slot]!]
  } else if (source.kind === 'box' && target.kind === 'box') {
    storage.boxes[target.box]![target.slot] = cloneCanonicalPokemon(pokemon)
    storage.boxes[source.box]![source.slot] = targetPokemon ? cloneCanonicalPokemon(targetPokemon) : undefined
    storage.currentBox = target.box
  } else if (source.kind === 'party' && target.kind === 'box') {
    storage.boxes[target.box]![target.slot] = cloneCanonicalPokemon(pokemon)
    if (targetPokemon) {
      party.members[source.slot] = cloneCanonicalPokemon(targetPokemon)
      party.pokeathlonModifiers![source.slot] = [0, 0, 0, 0, 0]
    } else {
      party.members.splice(source.slot, 1)
      party.pokeathlonModifiers!.splice(source.slot, 1)
    }
    storage.currentBox = target.box
  } else if (source.kind === 'box' && target.kind === 'party') {
    if (target.slot > party.members.length || (target.slot === party.members.length && party.members.length >= hgssPartyCapacity)) {
      return { kind: 'blocked', reason: "L’équipe est déjà complète." }
    }
    if (target.slot === party.members.length) {
      party.members.push(cloneCanonicalPokemon(pokemon))
      party.pokeathlonModifiers!.push([0, 0, 0, 0, 0])
    } else {
      party.members[target.slot] = cloneCanonicalPokemon(pokemon)
      party.pokeathlonModifiers![target.slot] = [0, 0, 0, 0, 0]
    }
    storage.boxes[source.box]![source.slot] = targetPokemon ? cloneCanonicalPokemon(targetPokemon) : undefined
    storage.currentBox = source.box
  } else return { kind: 'blocked', reason: 'Cette destination PC est invalide.' }

  try {
    assertHgssFieldPartyInvariant(party)
  } catch {
    return { kind: 'blocked', reason: "Il faut garder dans l’équipe au moins un Pokémon apte au combat." }
  }
  if (source.kind !== 'box' || target.kind !== 'box') {
    const veto = policy.vetoPartyMutation(createPokemonPartyMutationIntent(
      source.kind === 'party' && target.kind === 'party' ? 'reorder' : 'pc',
      sourceParty.members,
      party.members,
    ))
    if (veto) return { kind: 'blocked', ...veto }
  }
  return { kind: 'transferred', party, storage }
}

/** Échange atomiquement les objets tenus sans déplacer les Pokémon concernés. */
export function transferPokemonHeldItem(
  sourceParty: PokemonParty,
  sourceStorage: PokemonStorage,
  source: PokemonStorageLocation,
  target: PokemonStorageLocation,
): PokemonStorageTransferResult {
  if (!isValidLocation(source) || !isValidLocation(target) || sameLocation(source, target)) {
    return { kind: 'blocked', reason: 'Cette destination PC est invalide.' }
  }
  const sourcePokemon = readLocation(sourceParty, sourceStorage, source)
  const targetPokemon = readLocation(sourceParty, sourceStorage, target)
  if (!sourcePokemon?.heldItemId) return { kind: 'blocked', reason: 'Ce Pokémon ne tient aucun objet.' }
  if (!targetPokemon) return { kind: 'blocked', reason: 'Un objet doit être confié à un Pokémon.' }
  const party = clonePokemonParty(sourceParty)
  const storage = clonePokemonStorage(sourceStorage)
  const clonedSource = readLocation(party, storage, source)!
  const clonedTarget = readLocation(party, storage, target)!
  ;[clonedSource.heldItemId, clonedTarget.heldItemId] = [clonedTarget.heldItemId, clonedSource.heldItemId]
  if (target.kind === 'box') storage.currentBox = target.box
  return { kind: 'transferred', party, storage }
}

/** Libère atomiquement un Pokémon sans jamais publier une équipe inutilisable. */
export function releasePokemonStorage(
  sourceParty: PokemonParty,
  sourceStorage: PokemonStorage,
  source: PokemonStorageLocation,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonStorageTransferResult {
  if (!isValidLocation(source) || !readLocation(sourceParty, sourceStorage, source)) {
    return { kind: 'blocked', reason: 'Aucun Pokémon ne se trouve à cet emplacement.' }
  }
  const party = clonePokemonParty(sourceParty)
  const storage = clonePokemonStorage(sourceStorage)
  if (source.kind === 'party') {
    party.members.splice(source.slot, 1)
    party.pokeathlonModifiers!.splice(source.slot, 1)
  }
  else {
    storage.boxes[source.box]![source.slot] = undefined
    storage.currentBox = source.box
  }
  try {
    assertHgssFieldPartyInvariant(party)
  } catch {
    return { kind: 'blocked', reason: "Il faut garder dans l’équipe au moins un Pokémon apte au combat." }
  }
  if (source.kind === 'party') {
    const veto = policy.vetoPartyMutation(createPokemonPartyMutationIntent('pc', sourceParty.members, party.members))
    if (veto) return { kind: 'blocked', ...veto }
  }
  return { kind: 'released', party, storage }
}
