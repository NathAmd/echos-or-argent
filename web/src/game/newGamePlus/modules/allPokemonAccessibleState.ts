import { parsePokemonInstanceId, type PokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'

export const allPokemonAccessibleStateFormat = 'pokemaster-hgss-all-pokemon-accessible-state' as const
export const allPokemonAccessibleStateVersion = 1 as const

export type AllPokemonQuestStatus = 'locked' | 'available' | 'captured' | 'defeated'

export type AllPokemonQuestStateV1 = Readonly<{
  speciesId: number
  status: AllPokemonQuestStatus
  /** Non nul uniquement entre le démarrage explicite du combat et son issue. */
  encounterInstanceId: PokemonInstanceId | null
}>

export type AllPokemonAccessibleStateV1 = Readonly<{
  format: typeof allPokemonAccessibleStateFormat
  version: typeof allPokemonAccessibleStateVersion
  quests: readonly AllPokemonQuestStateV1[]
}>

const stateKeys = ['format', 'quests', 'version'] as const
const questKeys = ['encounterInstanceId', 'speciesId', 'status'] as const
const questStatuses = new Set<AllPokemonQuestStatus>(['locked', 'available', 'captured', 'defeated'])

function requirePlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`L’état Tous les Pokémon contient une valeur invalide à ${path}.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`L’état Tous les Pokémon contient un objet non sérialisable à ${path}.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(record).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`L’état Tous les Pokémon contient des champs invalides à ${path}.`)
  }
}

function requireSpeciesId(value: unknown, path: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 493) {
    throw new Error(`L’état Tous les Pokémon contient une espèce invalide à ${path}.`)
  }
  return value as number
}

function parseQuest(value: unknown, index: number): AllPokemonQuestStateV1 {
  const path = `quests[${index}]`
  const quest = requirePlainRecord(value, path)
  requireExactKeys(quest, questKeys, path)
  if (!questStatuses.has(quest.status as AllPokemonQuestStatus)) {
    throw new Error(`L’état Tous les Pokémon contient un statut invalide à ${path}.status.`)
  }
  const encounterInstanceId = quest.encounterInstanceId === null
    ? null
    : parsePokemonInstanceId(quest.encounterInstanceId)
  const status = quest.status as AllPokemonQuestStatus
  if (encounterInstanceId !== null && status !== 'available') {
    throw new Error(`L’état Tous les Pokémon associe une rencontre à une quête terminale ou verrouillée à ${path}.`)
  }
  return Object.freeze({
    speciesId: requireSpeciesId(quest.speciesId, `${path}.speciesId`),
    status,
    encounterInstanceId,
  })
}

export function createInitialAllPokemonAccessibleState(
  questSpeciesIds: readonly number[],
): AllPokemonAccessibleStateV1 {
  const unique = [...new Set(questSpeciesIds)].sort((left, right) => left - right)
  if (unique.length !== questSpeciesIds.length) {
    throw new Error('La liste initiale des quêtes Tous les Pokémon contient un doublon.')
  }
  for (const speciesId of unique) requireSpeciesId(speciesId, 'questSpeciesIds')
  return Object.freeze({
    format: allPokemonAccessibleStateFormat,
    version: allPokemonAccessibleStateVersion,
    quests: Object.freeze(unique.map((speciesId) => Object.freeze({
      speciesId,
      status: 'locked' as const,
      encounterInstanceId: null,
    }))),
  })
}

/** Décode entièrement l’extension avant que son état puisse remplacer le runtime actif. */
export function parseAllPokemonAccessibleStateV1(value: unknown): AllPokemonAccessibleStateV1 {
  if (!isJsonSaveValue(value)) {
    throw new Error("L’état Tous les Pokémon n’est pas une valeur JSON stricte.")
  }
  const state = requirePlainRecord(value, 'racine')
  requireExactKeys(state, stateKeys, 'racine')
  if (state.format !== allPokemonAccessibleStateFormat
    || state.version !== allPokemonAccessibleStateVersion) {
    throw new Error(
      `Le format Tous les Pokémon ${String(state.format)} v${String(state.version)} n’est pas pris en charge.`,
    )
  }
  if (!Array.isArray(state.quests)) {
    throw new Error("L’état Tous les Pokémon ne contient pas une liste de quêtes valide.")
  }
  const quests = state.quests.map(parseQuest).sort((left, right) => left.speciesId - right.speciesId)
  for (let index = 1; index < quests.length; index += 1) {
    if (quests[index - 1]!.speciesId === quests[index]!.speciesId) {
      throw new Error(`L’espèce ${quests[index]!.speciesId} possède plusieurs états de quête Tous les Pokémon.`)
    }
  }
  return Object.freeze({
    format: allPokemonAccessibleStateFormat,
    version: allPokemonAccessibleStateVersion,
    quests: Object.freeze(quests),
  })
}

export function isAllPokemonAccessibleStateV1(value: unknown): value is AllPokemonAccessibleStateV1 {
  try {
    parseAllPokemonAccessibleStateV1(value)
    return true
  } catch {
    return false
  }
}
