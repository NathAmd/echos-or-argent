import type { PokemonCatalog } from '../../ndsTypes'
import { createCanonicalPokemon, type CanonicalPokemon, type PokemonTrainerIdentity } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { calculatePokemonStats, type PokemonStatValues } from '../pokemon/pokemonFormulas'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'

export const hgssRoamerMapIds = [
  33, 34, 35, 36, 37, 38, 39, 40, 41, 42, 43, 44, 45, 46, 47, 48,
  9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26,
  91, 92, 93, 27, 28, 30, 32,
] as const

export type HgssRoamer = {
  instanceId: PokemonInstanceId
  metLocation: number
  locationIndex: number
  individualValues: PokemonStatValues
  personality: number
  speciesId: number
  currentHp: number
  level: number
  status: number
  active: boolean
}

export type HgssRoamerSaveState = {
  playerLocationHistory: [number, number]
  roamers: Array<HgssRoamer | undefined>
  massOutbreaksEnabled: boolean
  repelSteps: number
  flutePlayed: 0 | 1 | 2
}

const roamerDefinitions = [
  { speciesId: 243, level: 40, firstLocation: 0, locationCount: 16 },
  { speciesId: 244, level: 40, firstLocation: 0, locationCount: 16 },
  { speciesId: 380, level: 35, firstLocation: 16, locationCount: 25 },
  { speciesId: 381, level: 35, firstLocation: 16, locationCount: 25 },
] as const

const roamerAdjacency: readonly (readonly number[])[] = [
  [1, 15], [0, 2], [1, 3, 7], [2, 4, 7], [3, 5], [4, 6], [5, 7], [2, 3, 8],
  [7, 9, 11], [8, 10, 11], [9], [8, 9, 12, 13], [11, 13], [11, 12, 15], [13, 15], [0, 14],
  [17, 37], [16, 37, 18], [17, 19], [18, 20, 38], [19, 21, 22, 23, 24, 38],
  [22, 23, 26], [20, 21, 23, 31], [20, 21, 22, 25, 27], [19, 20, 25, 38],
  [23, 24, 27], [21, 27], [23, 25, 26, 28], [27, 29], [28, 30], [29, 33, 34],
  [22, 37], [31, 33], [30, 32, 34], [30, 33], [34, 36], [16, 34], [16, 17, 39, 40],
  [19, 20, 24], [37, 40], [37, 39, 24],
]

export function createHgssRoamerSaveState(): HgssRoamerSaveState {
  return {
    playerLocationHistory: [0, 0],
    roamers: Array.from({ length: 4 }),
    massOutbreaksEnabled: false,
    repelSteps: 0,
    flutePlayed: 0,
  }
}

export function cloneHgssRoamerSaveState(state: HgssRoamerSaveState): HgssRoamerSaveState {
  return {
    playerLocationHistory: [...state.playerLocationHistory],
    roamers: state.roamers.map((roamer) => roamer && ({
      ...roamer,
      individualValues: { ...roamer.individualValues },
    })),
    massOutbreaksEnabled: state.massOutbreaksEnabled,
    repelSteps: state.repelSteps,
    flutePlayed: state.flutePlayed,
  }
}

function chooseInitialLocation(state: HgssRoamerSaveState, roamerId: number, rng: HgssLcrng): number {
  const definition = roamerDefinitions[roamerId]
  if (!definition) throw new Error(`Le Pokémon fuyard HGSS ${roamerId} est invalide.`)
  const previousMapId = state.playerLocationHistory[1]
  const currentIndex = state.roamers[roamerId]?.locationIndex ?? 0
  const currentMapId = hgssRoamerMapIds[currentIndex]
  let locationIndex: number
  do {
    locationIndex = rng.nextU16() % definition.locationCount + definition.firstLocation
  } while (hgssRoamerMapIds[locationIndex] === previousMapId || hgssRoamerMapIds[locationIndex] === currentMapId)
  return locationIndex
}

function moveHgssRoamerRandom(state: HgssRoamerSaveState, roamerId: number, rng: HgssLcrng): void {
  const roamer = state.roamers[roamerId]
  if (!roamer?.active) return
  const locationIndex = chooseInitialLocation(state, roamerId, rng)
  roamer.locationIndex = locationIndex
  roamer.metLocation = hgssRoamerMapIds[locationIndex]!
}

function moveHgssRoamerAdjacent(state: HgssRoamerSaveState, roamerId: number, rng: HgssLcrng): void {
  const roamer = state.roamers[roamerId]
  if (!roamer?.active) return
  const neighbors = roamerAdjacency[roamer.locationIndex]
  if (!neighbors?.length) throw new Error(`La route adjacente du Pokémon fuyard ${roamer.locationIndex} est absente.`)
  const previousMapId = state.playerLocationHistory[1]
  if (neighbors.length === 1 && hgssRoamerMapIds[neighbors[0]!] === previousMapId) {
    moveHgssRoamerRandom(state, roamerId, rng)
    return
  }
  let locationIndex: number
  do {
    locationIndex = neighbors[rng.nextU16() % neighbors.length]!
  } while (hgssRoamerMapIds[locationIndex] === previousMapId)
  roamer.locationIndex = locationIndex
  roamer.metLocation = hgssRoamerMapIds[locationIndex]!
}

export function updateHgssRoamersForMapTransition(state: HgssRoamerSaveState, mapId: number, rng: HgssLcrng): void {
  if (!state.roamers.some((roamer) => roamer?.active)) return
  if (state.playerLocationHistory[0] !== mapId) {
    state.playerLocationHistory[1] = state.playerLocationHistory[0]
    state.playerLocationHistory[0] = mapId
  }
  state.flutePlayed = 0
  state.roamers.forEach((roamer, roamerId) => {
    if (!roamer?.active) return
    if (rng.nextU16() % 16 === 0) moveHgssRoamerRandom(state, roamerId, rng)
    else moveHgssRoamerAdjacent(state, roamerId, rng)
  })
}

export function repelActiveHgssRoamersFromMap(state: HgssRoamerSaveState, mapId: number, rng: HgssLcrng): void {
  state.roamers.forEach((roamer, roamerId) => {
    if (roamer?.active && roamer.metLocation === mapId) moveHgssRoamerRandom(state, roamerId, rng)
  })
}

export function selectHgssRoamerEncounter(
  state: HgssRoamerSaveState,
  mapId: number,
  rng: HgssLcrng,
): { roamerId: number, roamer: HgssRoamer } | undefined {
  const candidates = state.roamers.flatMap((roamer, roamerId) => (
    roamer?.active && roamer.metLocation === mapId ? [{ roamerId, roamer }] : []
  ))
  if (candidates.length === 0 || rng.nextU16() % 2 === 0) return undefined
  return candidates.length === 1 ? candidates[0] : candidates[rng.nextU16() % candidates.length]
}

export function createCanonicalHgssRoamerPokemon(
  roamer: HgssRoamer,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  trainer: PokemonTrainerIdentity,
  language: number,
  gameVersion: number,
  encounterIdentity: Readonly<Pick<HgssRoamer, 'speciesId' | 'level'>> = roamer,
): CanonicalPokemon {
  const pokemon = createCanonicalPokemon(catalog, {
    instanceId: roamer.instanceId,
    speciesId: encounterIdentity.speciesId,
    level: encounterIdentity.level,
    rng,
    personality: { kind: 'fixed', value: roamer.personality },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: trainer,
    origin: { language, gameVersion, metLocation: roamer.metLocation, metLevel: encounterIdentity.level, metTerrain: 0 },
    ballId: 4,
  })
  pokemon.individualValues = { ...roamer.individualValues }
  pokemon.stats = calculatePokemonStats(catalog.personalData[encounterIdentity.speciesId]!, encounterIdentity.level, pokemon.individualValues, pokemon.effortValues, pokemon.nature)
  pokemon.currentHp = Math.min(roamer.currentHp, pokemon.stats.hp)
  pokemon.status = roamer.status
  return pokemon
}

export function applyHgssRoamerBattleResult(
  state: HgssRoamerSaveState,
  roamerId: number,
  pokemon: CanonicalPokemon,
  result: 'won' | 'lost' | 'escaped' | 'captured',
  mapId: number,
  rng: HgssLcrng,
): void {
  const roamer = state.roamers[roamerId]
  if (!roamer?.active || result === 'lost') return
  if ((result === 'won' && pokemon.currentHp === 0) || result === 'captured') {
    state.roamers[roamerId] = undefined
  } else {
    roamer.currentHp = pokemon.currentHp
    roamer.status = pokemon.status
  }
  repelActiveHgssRoamersFromMap(state, mapId, rng)
}

export function createHgssRoamer(
  state: HgssRoamerSaveState,
  roamerId: number,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  trainer: PokemonTrainerIdentity,
  language: number,
  gameVersion: number,
): HgssRoamer {
  const definition = roamerDefinitions[roamerId]
  if (!definition) throw new Error(`Le Pokémon fuyard HGSS ${roamerId} est invalide.`)
  const generated = createCanonicalPokemon(catalog, {
    speciesId: definition.speciesId,
    level: definition.level,
    rng,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: { ...trainer, id: trainer.id & 0xffff },
    origin: { language, gameVersion, metLocation: 0, metLevel: definition.level, metTerrain: 0 },
    ballId: 4,
  })
  const locationIndex = chooseInitialLocation(state, roamerId, rng)
  const roamer: HgssRoamer = {
    instanceId: generated.instanceId,
    metLocation: hgssRoamerMapIds[locationIndex]!,
    locationIndex,
    individualValues: { ...generated.individualValues },
    personality: generated.personality,
    speciesId: definition.speciesId,
    currentHp: generated.stats.hp,
    level: definition.level,
    status: 0,
    active: true,
  }
  state.roamers[roamerId] = roamer
  return roamer
}
