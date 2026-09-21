import type { CanonicalPokemon } from './canonicalPokemon'

export type PokemonPartySlotSource =
  | { kind: 'single', partySlot: number }
  | { kind: 'double', ownerId: string, partySlot: number }
  | { kind: 'field', partySlot: number, cancellable: boolean }

export type CanonicalPokemonPartyTarget = {
  source: PokemonPartySlotSource
  instanceId: CanonicalPokemon['instanceId']
}

export type ResolvedCanonicalPokemonPartyTarget = {
  pokemon: CanonicalPokemon
  partySlot: number
}

export type ResolvePokemonParty = (source: PokemonPartySlotSource) => CanonicalPokemon[] | undefined

/**
 * Capture l'identifiant persistant utilisé par les flux différés. L'espèce est
 * délibérément exclue : une évolution remplace l'objet du slot sans changer
 * l'instance suivie par une confirmation d'apprentissage ultérieure.
 */
export function createCanonicalPokemonPartyTarget(
  pokemon: CanonicalPokemon,
  source: PokemonPartySlotSource,
): CanonicalPokemonPartyTarget {
  return {
    source,
    instanceId: pokemon.instanceId,
  }
}

function matchesCanonicalPokemonPartyTarget(
  pokemon: CanonicalPokemon,
  target: CanonicalPokemonPartyTarget,
): boolean {
  return pokemon.instanceId === target.instanceId
}

/**
 * Resolves the current party object, first through its captured slot and then
 * through stable identity if the party was reordered while a UI was pending.
 */
export function resolveCanonicalPokemonPartyTarget(
  target: CanonicalPokemonPartyTarget,
  resolveParty: ResolvePokemonParty,
): ResolvedCanonicalPokemonPartyTarget | undefined {
  const party = resolveParty(target.source)
  if (!party) return undefined
  const preferred = party[target.source.partySlot]
  if (preferred && matchesCanonicalPokemonPartyTarget(preferred, target)) {
    return { pokemon: preferred, partySlot: target.source.partySlot }
  }
  const partySlot = party.findIndex((pokemon) => matchesCanonicalPokemonPartyTarget(pokemon, target))
  return partySlot < 0 ? undefined : { pokemon: party[partySlot]!, partySlot }
}
