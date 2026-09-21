import { cloneCanonicalPokemon, type CanonicalPokemon } from './canonicalPokemon'
import { basePokemonTeamPolicy, createPokemonPartyMutationIntent, type PokemonTeamPolicy } from './pokemonTeamPolicy'
import type { HgssPokeathlonModifiers } from '../../rom/pokemon/pokeathlonPerformance'
import type { HgssLcrng } from './hgssPokemonRng'

export const hgssPartyCapacity = 6

export type PokemonParty = {
  members: CanonicalPokemon[]
  /** PartyExtra natif : cinq modificateurs Aprijuice attachés à chaque slot. */
  pokeathlonModifiers?: HgssPokeathlonModifiers[]
}

export type PokemonPartyReorderResult =
  | { kind: 'reordered' }
  | { kind: 'blocked', reason: string, code?: string }

const zeroPokeathlonModifiers: HgssPokeathlonModifiers = Object.freeze([0, 0, 0, 0, 0])

function clonePokeathlonModifiers(modifiers: HgssPokeathlonModifiers): HgssPokeathlonModifiers {
  if (modifiers.length !== 5 || modifiers.some((value) => !Number.isInteger(value) || value < -128 || value > 127)) {
    throw new Error('Les modificateurs Aprijuice HGSS doivent contenir cinq octets signés.')
  }
  return Object.freeze([...modifiers]) as unknown as HgssPokeathlonModifiers
}

function normalizePokeathlonModifiers(party: PokemonParty): HgssPokeathlonModifiers[] {
  const modifiers = party.pokeathlonModifiers ?? []
  if (modifiers.length > party.members.length) modifiers.splice(party.members.length)
  while (modifiers.length < party.members.length) modifiers.push(zeroPokeathlonModifiers)
  party.pokeathlonModifiers = modifiers
  return modifiers
}

export function createPokemonParty(
  members: readonly CanonicalPokemon[] = [],
  pokeathlonModifiers?: readonly HgssPokeathlonModifiers[],
): PokemonParty {
  if (members.length > hgssPartyCapacity) {
    throw new Error(`Une equipe HGSS ne peut pas contenir plus de ${hgssPartyCapacity} Pokemon.`)
  }
  if (pokeathlonModifiers !== undefined && pokeathlonModifiers.length !== members.length) {
    throw new Error('Les modificateurs Aprijuice HGSS ne correspondent pas aux slots de l’équipe.')
  }
  return {
    members: members.map(cloneCanonicalPokemon),
    pokeathlonModifiers: members.map((_, slot) => clonePokeathlonModifiers(pokeathlonModifiers?.[slot] ?? zeroPokeathlonModifiers)),
  }
}

export function clonePokemonParty(party: PokemonParty): PokemonParty {
  return createPokemonParty(party.members, normalizePokeathlonModifiers(party))
}

export function replacePokemonParty(party: PokemonParty, members: readonly CanonicalPokemon[]): void {
  const previous = new Map(party.members.map((pokemon, slot) => [pokemon.instanceId, getPokemonPartyPokeathlonModifiers(party, slot)]))
  const replacement = createPokemonParty(members, members.map((pokemon) => previous.get(pokemon.instanceId) ?? zeroPokeathlonModifiers))
  party.members = replacement.members
  party.pokeathlonModifiers = replacement.pokeathlonModifiers
}

export function addPokemonPartyMember(party: PokemonParty, pokemon: CanonicalPokemon): boolean {
  if (party.members.length >= hgssPartyCapacity) return false
  const modifiers = normalizePokeathlonModifiers(party)
  party.members.push(cloneCanonicalPokemon(pokemon))
  modifiers.push(zeroPokeathlonModifiers)
  return true
}

export function removePokemonPartyMember(party: PokemonParty, slot: number): CanonicalPokemon | undefined {
  if (!Number.isInteger(slot) || slot < 0 || slot >= party.members.length) return undefined
  const modifiers = normalizePokeathlonModifiers(party)
  modifiers.splice(slot, 1)
  return party.members.splice(slot, 1)[0]
}

export function reorderPokemonPartyMembers(
  party: PokemonParty,
  firstSlot: number,
  secondSlot: number,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonPartyReorderResult {
  if (!Number.isInteger(firstSlot) || !Number.isInteger(secondSlot)
    || firstSlot < 0 || secondSlot < 0
    || firstSlot >= party.members.length || secondSlot >= party.members.length
    || firstSlot === secondSlot) return { kind: 'blocked', reason: 'Ce réordonnancement d’équipe est invalide.' }
  const after = [...party.members]
  ;[after[firstSlot], after[secondSlot]] = [after[secondSlot]!, after[firstSlot]!]
  const veto = policy.vetoPartyMutation(createPokemonPartyMutationIntent('reorder', party.members, after))
  if (veto) return { kind: 'blocked', ...veto }
  const modifiers = normalizePokeathlonModifiers(party)
  party.members[firstSlot] = after[firstSlot]!
  party.members[secondSlot] = after[secondSlot]!
  ;[modifiers[firstSlot], modifiers[secondSlot]] = [modifiers[secondSlot]!, modifiers[firstSlot]!]
  return { kind: 'reordered' }
}

/** API booléenne historique, conservée pour les contrôleurs déjà branchés. */
export function swapPokemonPartyMembers(
  party: PokemonParty,
  firstSlot: number,
  secondSlot: number,
  policy: PokemonTeamPolicy = basePokemonTeamPolicy,
): boolean {
  return reorderPokemonPartyMembers(party, firstSlot, secondSlot, policy).kind === 'reordered'
}

export function getPokemonPartyMember(party: PokemonParty, slot: number): CanonicalPokemon | undefined {
  if (!Number.isInteger(slot) || slot < 0 || slot >= hgssPartyCapacity) return undefined
  return party.members[slot]
}

/** ScrCmd_PartyHasPokerus teste l'octet PK4 complet, y compris une ancienne infection guérie. */
export function hasPokemonPartyPokerus(party: PokemonParty): boolean {
  return party.members.some((pokemon) => (pokemon.pokerus ?? 0) !== 0)
}

/** Port de Party_UpdatePokerus : seuls les jours contagieux du nibble bas expirent. */
export function advancePokemonPartyPokerusDays(party: PokemonParty, elapsedDays: number): void {
  if (!Number.isSafeInteger(elapsedDays) || elapsedDays < 0) {
    throw new Error(`Le nombre de jours Pokérus HGSS ${elapsedDays} est invalide.`)
  }
  for (const pokemon of party.members) {
    if (pokemon.speciesId === 0) continue
    const pokerus = pokemon.pokerus ?? 0
    if (!Number.isInteger(pokerus) || pokerus < 0 || pokerus > 0xff) {
      throw new Error(`L'octet Pokérus HGSS ${pokerus} est invalide.`)
    }
    const remainingDays = pokerus & 0x0f
    if (remainingDays === 0) continue
    let next = remainingDays < elapsedDays || elapsedDays > 4
      ? pokerus & 0xf0
      : pokerus - elapsedDays
    if (next === 0) next = 0x10
    pokemon.pokerus = next
  }
}

export type HgssPokerusAcquisition = Readonly<{ partySlot: number, pokerus: number }>

/** Port exact de Party_GivePokerusAtRandom pour une équipe de combat valide. */
export function givePokemonPartyPokerusAtRandom(
  party: PokemonParty,
  rng: HgssLcrng,
): HgssPokerusAcquisition | undefined {
  const trigger = rng.nextU16()
  if (trigger !== 0x4000 && trigger !== 0x8000 && trigger !== 0xc000) return undefined
  const infectable = party.members.some((pokemon) => pokemon.speciesId !== 0 && !pokemon.isEgg)
  if (!infectable) throw new Error('Une équipe HGSS sans Pokémon non-Œuf ne peut pas recevoir le Pokérus après combat.')

  let partySlot: number
  let pokemon: CanonicalPokemon
  do {
    partySlot = rng.nextU16() % party.members.length
    pokemon = party.members[partySlot]!
  } while (pokemon.speciesId === 0 || pokemon.isEgg)

  // Party_MaskMonsWithPokerus teste l’octet entier : une ancienne infection
  // guérie protège également ce slot d’une nouvelle souche.
  if ((pokemon.pokerus ?? 0) !== 0) return undefined
  let pokerus: number
  do pokerus = rng.nextU16() & 0xff
  while ((pokerus & 7) === 0)
  if ((pokerus & 0xf0) !== 0) pokerus &= 7
  pokerus |= pokerus << 4
  pokerus &= 0xf3
  pokerus += 1
  pokemon.pokerus = pokerus
  return Object.freeze({ partySlot, pokerus })
}

/** Port exact de Party_SpreadPokerus, y compris l’infection des Œufs adjacents. */
export function spreadPokemonPartyPokerus(party: PokemonParty, rng: HgssLcrng): number[] {
  if (rng.nextU16() % 3 !== 0) return []
  const infectedSlots: number[] = []
  for (let partySlot = 0; partySlot < party.members.length; partySlot += 1) {
    const pokemon = party.members[partySlot]!
    if (pokemon.speciesId === 0) continue
    const pokerus = pokemon.pokerus ?? 0
    if ((pokerus & 0x0f) === 0) continue
    if (partySlot !== 0) {
      const previous = party.members[partySlot - 1]!
      if (((previous.pokerus ?? 0) & 0xf0) === 0) {
        previous.pokerus = pokerus
        infectedSlots.push(partySlot - 1)
      }
    }
    if (partySlot < party.members.length - 1) {
      const next = party.members[partySlot + 1]!
      if (((next.pokerus ?? 0) & 0xf0) === 0) {
        next.pokerus = pokerus
        infectedSlots.push(partySlot + 1)
        partySlot += 1
      }
    }
  }
  return infectedSlots
}

/** Les deux appels consomment le LCRNG dans l’ordre du contrôleur de combat HGSS. */
export function applyHgssPostBattlePokerus(
  party: PokemonParty,
  rng: HgssLcrng,
): Readonly<{ acquisition?: HgssPokerusAcquisition, spreadSlots: readonly number[] }> {
  const acquisition = givePokemonPartyPokerusAtRandom(party, rng)
  const spreadSlots = spreadPokemonPartyPokerus(party, rng)
  return Object.freeze({ acquisition, spreadSlots: Object.freeze(spreadSlots) })
}

export function getPokemonPartyPokeathlonModifiers(party: PokemonParty, slot: number): HgssPokeathlonModifiers {
  if (!Number.isInteger(slot) || slot < 0 || slot >= party.members.length) {
    throw new Error(`Le slot Aprijuice HGSS ${slot} est invalide.`)
  }
  return normalizePokeathlonModifiers(party)[slot]!
}

export function resetPokemonPartyPokeathlonModifiers(party: PokemonParty, slot: number): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= party.members.length) {
    throw new Error(`Le slot Aprijuice HGSS ${slot} est invalide.`)
  }
  normalizePokeathlonModifiers(party)[slot] = zeroPokeathlonModifiers
}

export function setPokemonPartyPokeathlonModifiers(
  party: PokemonParty,
  slot: number,
  modifiers: HgssPokeathlonModifiers,
): void {
  if (!Number.isInteger(slot) || slot < 0 || slot >= party.members.length) {
    throw new Error(`Le slot Aprijuice HGSS ${slot} est invalide.`)
  }
  normalizePokeathlonModifiers(party)[slot] = clonePokeathlonModifiers(modifiers)
}

export function getFirstUsablePokemonPartySlot(party: PokemonParty): number {
  const slot = party.members.findIndex((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)
  return slot === -1 ? hgssPartyCapacity : slot
}

export class HgssFieldPartyInvariantError extends Error {}

export function assertHgssFieldPartyInvariant(party: PokemonParty): void {
  if (getFirstUsablePokemonPartySlot(party) < hgssPartyCapacity) return
  throw new HgssFieldPartyInvariantError("Invariant HGSS viole: le controle terrain requiert au moins un Pokemon non-oeuf avec des PV.")
}

export function healPokemonParty(party: PokemonParty): void {
  for (const pokemon of party.members) {
    pokemon.currentHp = pokemon.stats.hp
    pokemon.status = 0
    for (const move of pokemon.moves) move.pp = move.maxPp
  }
}
