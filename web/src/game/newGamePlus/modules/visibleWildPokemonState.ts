import {
  dynamicWorldActorLimits,
  parseDynamicWorldActor,
} from '../../world/dynamicWorldActorRegistry'
import type { PlayerDirection } from '../../../ndsTypes'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const visibleWildPokemonStateFormat = 'pokemaster-hgss-visible-wild-state' as const
export const visibleWildPokemonStateVersion = 1 as const

export type VisibleWildEncounterMethod = 'land' | 'surfing' | 'safari'

export type PersistedVisibleWildActorV1 = Readonly<{
  id: string
  mapId: number
  tileX: number
  tileZ: number
  direction: PlayerDirection
  speciesId: number
  form: number
  level: number
  encounterKey: string
  encounterMethod: VisibleWildEncounterMethod
  movementStep: number
}>

export type RetiredVisibleWildEncounterV1 = Readonly<{
  mapId: number
  encounterKey: string
}>

export type VisibleWildPopulationCycleV1 = Readonly<{
  mapId: number
  generation: number
  /** Impose au moins un sync sans acteur avant de recycler les cles. */
  repopulationPending: boolean
}>

export type VisibleWildPokemonStateV1 = Readonly<{
  format: typeof visibleWildPokemonStateFormat
  version: typeof visibleWildPokemonStateVersion
  actors: readonly PersistedVisibleWildActorV1[]
  retiredEncounters: readonly RetiredVisibleWildEncounterV1[]
  populationCycles: readonly VisibleWildPopulationCycleV1[]
}>

export const visibleWildPokemonStateLimits = Object.freeze({
  maximumRetiredEncounters: 4_096,
  maximumPopulationCycles: 4_096,
})
const actorKeys = [
  'direction',
  'encounterKey',
  'encounterMethod',
  'form',
  'id',
  'level',
  'mapId',
  'movementStep',
  'speciesId',
  'tileX',
  'tileZ',
] as const
const retiredKeys = ['encounterKey', 'mapId'] as const
const populationCycleKeys = ['generation', 'mapId', 'repopulationPending'] as const
const legacyStateKeys = ['actors', 'format', 'retiredEncounters', 'version'] as const
const stateKeys = ['actors', 'format', 'populationCycles', 'retiredEncounters', 'version'] as const
const encounterMethods = new Set<VisibleWildEncounterMethod>(['land', 'surfing', 'safari'])
const encounterKeyPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`L'état Pokémon visibles contient une valeur invalide à ${path}.`)
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`L'état Pokémon visibles contient un objet non sérialisable à ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, expected: readonly string[], path: string): void {
  const keys = Object.keys(record).sort()
  if (keys.length !== expected.length || keys.some((key, index) => key !== expected[index])) {
    throw new Error(`L'état Pokémon visibles contient des champs invalides à ${path}.`)
  }
}

function requireArray(value: unknown, maximum: number, path: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new Error(`L'état Pokémon visibles contient une liste invalide à ${path}.`)
  }
  return value
}

function requireInteger(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`L'état Pokémon visibles contient un entier invalide à ${path}.`)
  }
  return value as number
}

export function requireVisibleWildEncounterKey(value: unknown, path: string): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > dynamicWorldActorLimits.maxIdentifierLength
    || !encounterKeyPattern.test(value)) {
    throw new Error(`La clé de rencontre Pokémon visible est invalide à ${path}.`)
  }
  return value
}

function parseActor(value: unknown, index: number): PersistedVisibleWildActorV1 {
  const path = `actors[${index}]`
  const record = requireRecord(value, path)
  requireExactKeys(record, actorKeys, path)
  if (!encounterMethods.has(record.encounterMethod as VisibleWildEncounterMethod)) {
    throw new Error(`L'état Pokémon visibles contient une méthode invalide à ${path}.encounterMethod.`)
  }
  const movementStep = requireInteger(record.movementStep, 0, 0xffff_ffff, `${path}.movementStep`)
  const actor = parseDynamicWorldActor({
    id: record.id,
    kind: 'visible-wild',
    mapId: record.mapId,
    tileX: record.tileX,
    tileZ: record.tileZ,
    direction: record.direction,
    collision: 'blocking',
    interaction: 'action',
    speciesId: record.speciesId,
    form: record.form,
    level: record.level,
  })
  if (!actor
    || actor.kind !== 'visible-wild'
    || actor.speciesId > 493
    || !actor.id.startsWith('ngp-visible-wild:')) {
    throw new Error(`L'état Pokémon visibles contient un acteur invalide à ${path}.`)
  }
  return Object.freeze({
    id: actor.id,
    mapId: actor.mapId,
    tileX: actor.tileX,
    tileZ: actor.tileZ,
    direction: actor.direction,
    speciesId: actor.speciesId,
    form: actor.form,
    level: actor.level,
    encounterKey: requireVisibleWildEncounterKey(record.encounterKey, `${path}.encounterKey`),
    encounterMethod: record.encounterMethod as VisibleWildEncounterMethod,
    movementStep,
  })
}

function parseRetired(value: unknown, index: number): RetiredVisibleWildEncounterV1 {
  const path = `retiredEncounters[${index}]`
  const record = requireRecord(value, path)
  requireExactKeys(record, retiredKeys, path)
  return Object.freeze({
    mapId: requireInteger(record.mapId, 0, dynamicWorldActorLimits.maxMapId, `${path}.mapId`),
    encounterKey: requireVisibleWildEncounterKey(record.encounterKey, `${path}.encounterKey`),
  })
}

function parsePopulationCycle(value: unknown, index: number): VisibleWildPopulationCycleV1 {
  const path = `populationCycles[${index}]`
  const record = requireRecord(value, path)
  requireExactKeys(record, populationCycleKeys, path)
  if (typeof record.repopulationPending !== 'boolean') {
    throw new Error(`L'etat Pokemon visibles contient un booleen invalide a ${path}.repopulationPending.`)
  }
  return Object.freeze({
    mapId: requireInteger(record.mapId, 0, dynamicWorldActorLimits.maxMapId, `${path}.mapId`),
    generation: requireInteger(record.generation, 0, 0xffff_ffff, `${path}.generation`),
    repopulationPending: record.repopulationPending,
  })
}

function encounterIdentity(mapId: number, encounterKey: string): string {
  return `${mapId}:${encounterKey}`
}

function compareActors(left: PersistedVisibleWildActorV1, right: PersistedVisibleWildActorV1): number {
  if (left.mapId !== right.mapId) return left.mapId - right.mapId
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function compareRetired(left: RetiredVisibleWildEncounterV1, right: RetiredVisibleWildEncounterV1): number {
  if (left.mapId !== right.mapId) return left.mapId - right.mapId
  return left.encounterKey < right.encounterKey ? -1 : left.encounterKey > right.encounterKey ? 1 : 0
}

function comparePopulationCycles(left: VisibleWildPopulationCycleV1, right: VisibleWildPopulationCycleV1): number {
  return left.mapId - right.mapId
}

export function createEmptyVisibleWildPokemonState(): VisibleWildPokemonStateV1 {
  return Object.freeze({
    format: visibleWildPokemonStateFormat,
    version: visibleWildPokemonStateVersion,
    actors: Object.freeze([]),
    retiredEncounters: Object.freeze([]),
    populationCycles: Object.freeze([]),
  })
}

/** Parse, borne et canonise entièrement le bloc avant toute restauration. */
export function parseVisibleWildPokemonStateV1(value: unknown): VisibleWildPokemonStateV1 {
  if (!isJsonSaveValue(value)) throw new Error("L'état Pokémon visibles n'est pas une valeur JSON stricte.")
  const state = requireRecord(value, 'racine')
  const hasPopulationCycles = Object.hasOwn(state, 'populationCycles')
  requireExactKeys(state, hasPopulationCycles ? stateKeys : legacyStateKeys, 'racine')
  if (state.format !== visibleWildPokemonStateFormat || state.version !== visibleWildPokemonStateVersion) {
    throw new Error(
      `Le format Pokémon visibles ${String(state.format)} v${String(state.version)} n'est pas pris en charge.`,
    )
  }
  const actors = requireArray(state.actors, dynamicWorldActorLimits.maxActors, 'actors').map(parseActor).sort(compareActors)
  const retired = requireArray(state.retiredEncounters, visibleWildPokemonStateLimits.maximumRetiredEncounters, 'retiredEncounters')
    .map(parseRetired)
    .sort(compareRetired)
  const populationCycles = hasPopulationCycles
    ? requireArray(state.populationCycles, visibleWildPokemonStateLimits.maximumPopulationCycles, 'populationCycles')
      .map(parsePopulationCycle)
      .sort(comparePopulationCycles)
    : []
  const actorIds = new Set<string>()
  const encounterIds = new Set<string>()
  for (const actor of actors) {
    if (actorIds.has(actor.id)) throw new Error(`L'acteur Pokémon visible ${actor.id} est déclaré plusieurs fois.`)
    actorIds.add(actor.id)
    const identity = encounterIdentity(actor.mapId, actor.encounterKey)
    if (encounterIds.has(identity)) throw new Error(`La rencontre Pokémon visible ${identity} est déclarée plusieurs fois.`)
    encounterIds.add(identity)
  }
  for (const entry of retired) {
    const identity = encounterIdentity(entry.mapId, entry.encounterKey)
    if (encounterIds.has(identity)) {
      throw new Error(`La rencontre Pokémon visible ${identity} est à la fois active et retirée.`)
    }
    encounterIds.add(identity)
  }
  const cycleMapIds = new Set<number>()
  for (const cycle of populationCycles) {
    if (cycleMapIds.has(cycle.mapId)) {
      throw new Error(`Le cycle de peuplement Pokemon visible ${cycle.mapId} est declare plusieurs fois.`)
    }
    cycleMapIds.add(cycle.mapId)
    if (cycle.repopulationPending && actors.some(({ mapId }) => mapId === cycle.mapId)) {
      throw new Error(`La carte ${cycle.mapId} ne peut pas attendre son repeuplement tout en conservant un acteur visible.`)
    }
  }
  return Object.freeze({
    format: visibleWildPokemonStateFormat,
    version: visibleWildPokemonStateVersion,
    actors: Object.freeze(actors),
    retiredEncounters: Object.freeze(retired),
    populationCycles: Object.freeze(populationCycles),
  })
}

export function isVisibleWildPokemonStateV1(value: unknown): value is VisibleWildPokemonStateV1 {
  try {
    parseVisibleWildPokemonStateV1(value)
    return true
  } catch {
    return false
  }
}
