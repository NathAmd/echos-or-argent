import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const hardcoreStateFormat = 'pokemaster-hgss-hardcore-state' as const
export const hardcoreStateVersion = 1 as const

export type HardcoreStateV1 = Readonly<{
  format: typeof hardcoreStateFormat
  version: typeof hardcoreStateVersion
  highestProgression: number
}>

const stateKeys = ['format', 'highestProgression', 'version'] as const

function requirePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error("L'état Hardcore doit être un objet JSON.")
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("L'état Hardcore doit être un objet JSON simple.")
  }
  return value as Record<string, unknown>
}

export function createInitialHardcoreState(): HardcoreStateV1 {
  return Object.freeze({
    format: hardcoreStateFormat,
    version: hardcoreStateVersion,
    highestProgression: 0,
  })
}

/** Toute restauration repasse par une frontière exacte et JSON stricte. */
export function parseHardcoreStateV1(value: unknown): HardcoreStateV1 {
  if (!isJsonSaveValue(value)) throw new Error("L'état Hardcore n'est pas une valeur JSON stricte.")
  const state = requirePlainRecord(value)
  const actualKeys = Object.keys(state).sort()
  if (actualKeys.length !== stateKeys.length
    || actualKeys.some((key, index) => key !== stateKeys[index])) {
    throw new Error("L'état Hardcore contient des champs inconnus ou manquants.")
  }
  if (state.format !== hardcoreStateFormat || state.version !== hardcoreStateVersion) {
    throw new Error(`Le format Hardcore ${String(state.format)} v${String(state.version)} n'est pas pris en charge.`)
  }
  if (!Number.isSafeInteger(state.highestProgression) || (state.highestProgression as number) < 0) {
    throw new Error("L'état Hardcore contient une progression invalide.")
  }
  return Object.freeze({
    format: hardcoreStateFormat,
    version: hardcoreStateVersion,
    highestProgression: state.highestProgression as number,
  })
}

export function isHardcoreStateV1(value: unknown): value is HardcoreStateV1 {
  try {
    parseHardcoreStateV1(value)
    return true
  } catch {
    return false
  }
}
