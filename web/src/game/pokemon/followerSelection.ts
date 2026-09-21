import type { CanonicalPokemon } from './canonicalPokemon'
import type { PokemonParty } from './pokemonParty'
import type { PokemonFollowerCatalog } from '../../rom/overworld/followerParameters'

export const hgssMapFollowMode = {
  prevent: 0,
  heightRestricted: 1,
  allow: 2,
} as const

export type PokemonFollowerSelection = {
  slot: number
  pokemon: CanonicalPokemon
  parameterIndex: number
  size: number
  active: boolean
  permitted: boolean
  visible: boolean
}

export type PokemonFollowerMap = {
  id: number
  followMode: number
}

const diglettSpecies = new Set([50, 51])
const bellTowerMapIds = new Set([111, 332, 333, 334, 335, 336, 337, 338, 339, 340, 341])

export function resolvePokemonFollowerSelection(
  party: PokemonParty,
  map: PokemonFollowerMap,
  catalog: PokemonFollowerCatalog,
): PokemonFollowerSelection | undefined {
  const aliveSlot = party.members.findIndex((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0)
  const slot = aliveSlot === -1 ? party.members.findIndex((pokemon) => !pokemon.isEgg) : aliveSlot
  if (slot === -1) return undefined
  const pokemon = party.members[slot]!
  const parameterIndex = catalog.modelIndexBySpecies[pokemon.speciesId]
  if (parameterIndex === undefined) throw new Error(`L'espece follower HGSS ${pokemon.speciesId} est absente du LUT ARM9.`)
  const parameter = catalog.parameters[parameterIndex]
  if (!parameter) throw new Error(`Le modele follower HGSS ${parameterIndex} est absent de l'archive ROM.`)
  const permittedByMode = map.followMode === hgssMapFollowMode.prevent
    ? false
    : map.followMode === hgssMapFollowMode.heightRestricted
      ? parameter.size === 0
      : map.followMode === hgssMapFollowMode.allow
        ? true
        : undefined
  if (permittedByMode === undefined) throw new Error(`Le mode follower HGSS ${map.followMode} est inconnu.`)
  const permitted = permittedByMode && !(diglettSpecies.has(pokemon.speciesId) && bellTowerMapIds.has(map.id))
  const active = aliveSlot !== -1
  return { slot, pokemon, parameterIndex, size: parameter.size, active, permitted, visible: active && permitted }
}