import type { WildEncounterStartedEvent, WildEncounterStartedMethod } from '../../encounters/wildEncounterStartedObserver'
import { parsePokemonInstanceId, type PokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const nuzlockeStateFormat = 'pokemaster-hgss-nuzlocke-state' as const
export const nuzlockeStateVersion = 1 as const

export type NuzlockeEncounterOutcome = 'started' | 'caught' | 'missed'

/** Première rencontre consommée d'une section de carte HGSS. */
export type NuzlockeSectionEncounterV1 = Readonly<{
  mapSectionId: number
  instanceId: PokemonInstanceId
  method: WildEncounterStartedMethod
  speciesId: number
  level: number
  outcome: NuzlockeEncounterOutcome
}>

/**
 * Instantané autonome et versionné. L'ordre croissant des sections rend sa
 * sérialisation déterministe, indépendamment de l'ordre de restauration.
 */
export type NuzlockeStateV1 = Readonly<{
  format: typeof nuzlockeStateFormat
  version: typeof nuzlockeStateVersion
  sections: readonly NuzlockeSectionEncounterV1[]
}>

const encounterMethods = new Set<WildEncounterStartedMethod>([
  'land',
  'surfing',
  'fishing',
  'roamer',
  'safari',
  'scripted',
])
const encounterOutcomes = new Set<NuzlockeEncounterOutcome>(['started', 'caught', 'missed'])
const stateKeys = ['format', 'sections', 'version'] as const
const sectionKeys = ['instanceId', 'level', 'mapSectionId', 'method', 'outcome', 'speciesId'] as const

function requirePlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`L'état Nuzlocke contient une valeur invalide à ${path}.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`L'état Nuzlocke contient un objet non sérialisable à ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actualKeys = Object.keys(record).sort()
  if (actualKeys.length !== keys.length || actualKeys.some((key, index) => key !== keys[index])) {
    throw new Error(`L'état Nuzlocke contient des champs invalides à ${path}.`)
  }
}

function requireInteger(value: unknown, minimum: number, maximum: number, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`L'état Nuzlocke contient un entier invalide à ${path}.`)
  }
  return value as number
}

function parseSection(value: unknown, index: number): NuzlockeSectionEncounterV1 {
  const path = `sections[${index}]`
  const section = requirePlainRecord(value, path)
  requireExactKeys(section, sectionKeys, path)
  if (!encounterMethods.has(section.method as WildEncounterStartedMethod)) {
    throw new Error(`L'état Nuzlocke contient une méthode invalide à ${path}.method.`)
  }
  if (!encounterOutcomes.has(section.outcome as NuzlockeEncounterOutcome)) {
    throw new Error(`L'état Nuzlocke contient une issue invalide à ${path}.outcome.`)
  }
  return Object.freeze({
    mapSectionId: requireInteger(section.mapSectionId, 0, 0xffff, `${path}.mapSectionId`),
    instanceId: parsePokemonInstanceId(section.instanceId),
    method: section.method as WildEncounterStartedMethod,
    speciesId: requireInteger(section.speciesId, 1, 493, `${path}.speciesId`),
    level: requireInteger(section.level, 1, 100, `${path}.level`),
    outcome: section.outcome as NuzlockeEncounterOutcome,
  })
}

export function createEmptyNuzlockeState(): NuzlockeStateV1 {
  return Object.freeze({
    format: nuzlockeStateFormat,
    version: nuzlockeStateVersion,
    sections: Object.freeze([]),
  })
}

/** Toute donnée restaurée repasse par cette frontière stricte. */
export function parseNuzlockeStateV1(value: unknown): NuzlockeStateV1 {
  if (!isJsonSaveValue(value)) throw new Error("L'état Nuzlocke n'est pas une valeur JSON stricte.")
  const state = requirePlainRecord(value, 'racine')
  requireExactKeys(state, stateKeys, 'racine')
  if (state.format !== nuzlockeStateFormat || state.version !== nuzlockeStateVersion) {
    throw new Error(`Le format Nuzlocke ${String(state.format)} v${String(state.version)} n'est pas pris en charge.`)
  }
  if (!Array.isArray(state.sections)) throw new Error("L'état Nuzlocke ne contient pas une liste de sections valide.")
  const sections = state.sections.map(parseSection).sort((left, right) => left.mapSectionId - right.mapSectionId)
  for (let index = 1; index < sections.length; index += 1) {
    if (sections[index - 1]!.mapSectionId === sections[index]!.mapSectionId) {
      throw new Error(`La section ${sections[index]!.mapSectionId} est déclarée plusieurs fois dans l'état Nuzlocke.`)
    }
  }
  return Object.freeze({
    format: nuzlockeStateFormat,
    version: nuzlockeStateVersion,
    sections: Object.freeze(sections),
  })
}

export function isNuzlockeStateV1(value: unknown): value is NuzlockeStateV1 {
  try {
    parseNuzlockeStateV1(value)
    return true
  } catch {
    return false
  }
}

export function createNuzlockeSectionEncounter(
  event: WildEncounterStartedEvent,
): NuzlockeSectionEncounterV1 {
  return parseNuzlockeStateV1({
    format: nuzlockeStateFormat,
    version: nuzlockeStateVersion,
    sections: [{
      mapSectionId: event.mapSectionId,
      instanceId: event.instanceId,
      method: event.method,
      speciesId: event.speciesId,
      level: event.level,
      outcome: 'started',
    }],
  }).sections[0]!
}
