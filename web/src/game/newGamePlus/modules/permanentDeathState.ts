import { parsePokemonInstanceId, type PokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const permanentDeathStateFormat = 'pokemaster-hgss-permanent-death-state' as const
export const permanentDeathStateVersion = 1 as const

export type PermanentDeathStateV1 = Readonly<{
  format: typeof permanentDeathStateFormat
  version: typeof permanentDeathStateVersion
  deadPokemonInstanceIds: readonly PokemonInstanceId[]
}>

const stateKeys = ['deadPokemonInstanceIds', 'format', 'version'] as const
const maximumPersistedDeaths = 65_535

function requirePlainRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error("L'état de mort définitive doit être un objet JSON.")
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error("L'état de mort définitive doit être un objet JSON simple.")
  }
  return value as Record<string, unknown>
}

function requireExactStateKeys(state: Record<string, unknown>): void {
  const keys = Object.keys(state).sort()
  if (keys.length !== stateKeys.length || keys.some((key, index) => key !== stateKeys[index])) {
    throw new Error("L'état de mort définitive contient des champs absents ou inconnus.")
  }
}

function parseDeadPokemonInstanceIds(value: unknown): readonly PokemonInstanceId[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype) {
    throw new Error("L'état de mort définitive ne contient pas une liste d'instances valide.")
  }
  if (value.length > maximumPersistedDeaths) {
    throw new Error("L'état de mort définitive contient trop d'instances.")
  }

  const parsed = value.map((instanceId) => parsePokemonInstanceId(instanceId)).sort()
  for (let index = 1; index < parsed.length; index += 1) {
    if (parsed[index - 1] === parsed[index]) {
      throw new Error(`L'instance ${parsed[index]} est déclarée plusieurs fois dans l'état de mort définitive.`)
    }
  }
  return Object.freeze(parsed)
}

export function createEmptyPermanentDeathState(): PermanentDeathStateV1 {
  return Object.freeze({
    format: permanentDeathStateFormat,
    version: permanentDeathStateVersion,
    deadPokemonInstanceIds: Object.freeze([]),
  })
}

/** Restaure uniquement une valeur JSON v1 exacte et la canonise par instanceId. */
export function parsePermanentDeathStateV1(value: unknown): PermanentDeathStateV1 {
  if (!isJsonSaveValue(value)) {
    throw new Error("L'état de mort définitive n'est pas une valeur JSON stricte.")
  }
  const state = requirePlainRecord(value)
  requireExactStateKeys(state)
  if (state.format !== permanentDeathStateFormat || state.version !== permanentDeathStateVersion) {
    throw new Error(
      `Le format de mort définitive ${String(state.format)} v${String(state.version)} n'est pas pris en charge.`,
    )
  }
  return Object.freeze({
    format: permanentDeathStateFormat,
    version: permanentDeathStateVersion,
    deadPokemonInstanceIds: parseDeadPokemonInstanceIds(state.deadPokemonInstanceIds),
  })
}

export function isPermanentDeathStateV1(value: unknown): value is PermanentDeathStateV1 {
  try {
    parsePermanentDeathStateV1(value)
    return true
  } catch {
    return false
  }
}
