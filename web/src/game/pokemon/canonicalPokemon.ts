import type { PokemonCatalog } from '../../ndsTypes'
import { getExperienceForLevel } from '../../rom/pokemon/growthTable'
import { deriveInitialMoveIds } from '../../rom/pokemon/levelUpLearnset'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import {
  calculatePokemonStats,
  getAbilityFromPersonality,
  getGenderFromPersonality,
  getNatureFromPersonality,
  isShinyPersonality,
  resolvePokemonPersonalData,
  type PokemonGender,
  type PokemonStatValues,
} from './pokemonFormulas'
import {
  createBoxPokemonRandomValues,
  type HgssLcrng,
  type PokemonIndividualValueSource,
  type PokemonOriginalTrainerSource,
  type PokemonPersonalitySource,
} from './hgssPokemonRng'
import { createPokemonInstanceId, type PokemonInstanceId } from './pokemonInstanceId'

export type PokemonTrainerIdentity = {
  id: number
  name: string
  gender: 'male' | 'female'
  /** Texte saisi par un joueur ou libellé résolu exclusivement depuis la ROM locale. */
  nameSource?: PokemonTextSource
  /** Identifiant numérique de l'échange PNJ qui fournit le nom local. */
  localTradeId?: number
  /** Appartenance au joueur courant, indépendante d'un nom OT non portable. */
  isPlayer?: boolean
}

export type PokemonMetDate = {
  year: number
  month: number
  day: number
}

export type PokemonOrigin = {
  language: number
  gameVersion: number
  metLocation: number
  metLevel: number
  metTerrain: number
  metDate?: PokemonMetDate
  /** Lieu/date de remise de l'Œuf PK4, conservés après son éclosion. */
  eggLocation?: number
  eggDate?: PokemonMetDate
}

/**
 * Provenance du texte de surnom conservé dans le runtime.
 *
 * L'absence de provenance reste volontairement ambiguë pour les anciennes
 * sauvegardes. Elle ne doit jamais être interprétée comme une saisie joueur à
 * une frontière réseau.
 */
export type PokemonTextSource = 'user-text' | 'local-ref'
export type PokemonNicknameSource = PokemonTextSource

export type CanonicalPokemonMove = {
  moveId: number
  pp: number
  maxPp: number
  ppUps: number
  data: PokemonMoveData
}

export type CanonicalPokemon = {
  readonly instanceId: PokemonInstanceId
  speciesId: number
  speciesName: string
  nickname?: string
  nicknameSource?: PokemonNicknameSource
  /** 0 désigne le libellé local d'Œuf; les valeurs positives encodent tradeId + 1. */
  nicknameLocalRef?: number
  form: number
  personality: number
  originalTrainer: PokemonTrainerIdentity
  origin: PokemonOrigin
  level: number
  experience: number
  individualValues: PokemonStatValues
  effortValues: PokemonStatValues
  nature: number
  gender: PokemonGender
  abilityId: number
  shiny: boolean
  friendship: number
  moves: CanonicalPokemonMove[]
  stats: PokemonStatValues
  currentHp: number
  status: number
  /** Octet Pokérus natif du PK4 ; absent seulement des anciennes fixtures, normalisé à zéro à la création/restauration. */
  pokerus?: number
  heldItemId: number
  /** Courrier de la structure PartyPokemon. Seule l'identité Kenya est décodée à ce stade. */
  mailIdentity?: 'kenya'
  ballId: number
  isEgg: boolean
  fatefulEncounter: boolean
  shinyLeafMask: number
  /** Cool, Beauté, Grâce, Intelligence, Robustesse et Lustre du PK4 natif. */
  contestValues?: [number, number, number, number, number, number]
  ribbonIds: number[]
}

export type CreateCanonicalPokemonOptions = {
  /** Injecté lors d'une restauration ; absent pour une nouvelle instance. */
  instanceId?: PokemonInstanceId
  speciesId: number
  level: number
  rng: HgssLcrng
  personality: PokemonPersonalitySource
  individualValues: PokemonIndividualValueSource
  originalTrainer: PokemonTrainerIdentity
  originalTrainerId?: PokemonOriginalTrainerSource
  origin: PokemonOrigin
  form?: number
  heldItemId?: number
  moveIds?: readonly number[]
  friendship?: number
  ballId: number
}

export function cloneCanonicalPokemon(pokemon: CanonicalPokemon): CanonicalPokemon {
  return {
    ...pokemon,
    originalTrainer: { ...pokemon.originalTrainer },
    origin: {
      ...pokemon.origin,
      metDate: pokemon.origin.metDate && { ...pokemon.origin.metDate },
      eggDate: pokemon.origin.eggDate && { ...pokemon.origin.eggDate },
    },
    individualValues: { ...pokemon.individualValues },
    effortValues: { ...pokemon.effortValues },
    moves: pokemon.moves.map((move) => ({ ...move, data: { ...move.data } })),
    stats: { ...pokemon.stats },
    contestValues: [...(pokemon.contestValues ?? [0, 0, 0, 0, 0, 0])],
    ribbonIds: [...pokemon.ribbonIds],
  }
}

const zeroStatValues: PokemonStatValues = {
  hp: 0,
  attack: 0,
  defense: 0,
  speed: 0,
  specialAttack: 0,
  specialDefense: 0,
}

function requireCatalogEntry<T>(entries: readonly T[], index: number, label: string): T {
  const entry = entries[index]
  if (entry === undefined) throw new Error(`${label} ${index} est absent du catalogue ROM.`)
  return entry
}

function validateTrainer(trainer: PokemonTrainerIdentity, allowEmptyName = false): void {
  if (!Number.isInteger(trainer.id) || trainer.id < 0 || trainer.id > 0xffffffff) {
    throw new Error(`L’identifiant du Dresseur d’origine ${trainer.id} est invalide.`)
  }
  if (!allowEmptyName && !trainer.name) throw new Error('Le nom du Dresseur d’origine est vide.')
}

export function createCanonicalPokemon(catalog: PokemonCatalog, options: CreateCanonicalPokemonOptions): CanonicalPokemon {
  validateTrainer(options.originalTrainer, options.originalTrainerId?.kind === 'randomNonShiny')
  const personalData = requireCatalogEntry(catalog.personalData, options.speciesId, 'L’espece Pokemon')
  const speciesName = requireCatalogEntry(catalog.speciesNames, options.speciesId, 'Le nom de l’espece Pokemon')
  const growthTable = requireCatalogEntry(catalog.growthTables, personalData.growthRate, 'La courbe de croissance')
  const learnset = requireCatalogEntry(catalog.levelUpLearnsets, options.speciesId, 'Le learnset de l’espece Pokemon')
  const randomValues = createBoxPokemonRandomValues(
    options.rng,
    options.personality,
    options.originalTrainerId ?? { kind: 'none' },
    options.individualValues,
  )
  const originalTrainer = options.originalTrainerId && options.originalTrainerId.kind !== 'none'
    ? { ...options.originalTrainer, id: randomValues.originalTrainerId }
    : { ...options.originalTrainer }
  const nature = getNatureFromPersonality(randomValues.personality)
  const effortValues = { ...zeroStatValues }
  const formPersonalData = resolvePokemonPersonalData(catalog, options.speciesId, options.form ?? 0)
  const stats = calculatePokemonStats(formPersonalData, options.level, randomValues.individualValues, effortValues, nature)
  const moveIds = options.moveIds?.filter((moveId) => moveId !== 0) ?? deriveInitialMoveIds(learnset, options.level)
  const moves = moveIds.map((moveId): CanonicalPokemonMove => {
    const data = requireCatalogEntry(catalog.moves, moveId, 'La capacite Pokemon')
    return { moveId, pp: data.pp, maxPp: data.pp, ppUps: 0, data }
  })
  const friendship = options.friendship ?? personalData.baseFriendship
  if (!Number.isInteger(friendship) || friendship < 0 || friendship > 255) {
    throw new Error(`L’amitie Pokemon ${friendship} est invalide.`)
  }

  return {
    instanceId: options.instanceId ?? createPokemonInstanceId(),
    speciesId: options.speciesId,
    speciesName,
    form: options.form ?? 0,
    personality: randomValues.personality,
    originalTrainer,
    origin: {
      ...options.origin,
      metDate: options.origin.metDate && { ...options.origin.metDate },
      eggDate: options.origin.eggDate && { ...options.origin.eggDate },
    },
    level: options.level,
    experience: getExperienceForLevel(growthTable, options.level),
    individualValues: randomValues.individualValues,
    effortValues,
    nature,
    gender: getGenderFromPersonality(personalData, randomValues.personality),
    abilityId: getAbilityFromPersonality(formPersonalData, randomValues.personality),
    shiny: isShinyPersonality(originalTrainer.id, randomValues.personality),
    friendship,
    moves,
    stats,
    currentHp: stats.hp,
    status: 0,
    pokerus: 0,
    heldItemId: options.heldItemId ?? 0,
    ballId: options.ballId,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    contestValues: [0, 0, 0, 0, 0, 0],
    ribbonIds: [],
  }
}
