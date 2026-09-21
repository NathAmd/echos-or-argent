import type { PokemonCatalog } from '../../../ndsTypes'
import type { HgssWildEncounterData } from '../../../rom/encounters/wildEncounterData'
import type { DetailedBattleOutcomeEvent, DetailedBattleOutcomeObserver } from '../../battle/battleOutcomeObserver'
import type { WildEncounterStartedEvent, WildEncounterStartedObserver } from '../../encounters/wildEncounterStartedObserver'
import { parsePokemonInstanceId, type PokemonInstanceId } from '../../pokemon/pokemonInstanceId'
import { isJsonSaveValue } from '../../save/versionedSaveExtensions'
import type { FieldScriptState } from '../../scripts/fieldScriptRunner'
import { defineNewGamePlusModule } from '../newGamePlusTypes'
import {
  createAllPokemonAccessibilityPlan,
  createAllPokemonAccessibleEncounterPort,
  resolveAllPokemonRayquazaDisappearanceFlagId,
  type AllPokemonAccessibilityPlan,
  type AllPokemonEncounterMapSource,
  type AllPokemonQuestDefinition,
  type AllPokemonQuestRequirement,
  type AllPokemonTransitiveOneShotEvidence,
} from './allPokemonAccessibilityPlanner'
import {
  allPokemonAccessibleStateVersion,
  createInitialAllPokemonAccessibleState,
  parseAllPokemonAccessibleStateV1,
  type AllPokemonAccessibleStateV1,
  type AllPokemonQuestStateV1,
  type AllPokemonQuestStatus,
} from './allPokemonAccessibleState'

export const allPokemonAccessibleModuleId = 'all-pokemon-accessible'
export const allPokemonAccessibleSaveExtensionKey = 'new-game-plus.all-pokemon-accessible'
export const allPokemonAccessibleSaveExtensionVersion = allPokemonAccessibleStateVersion

export type AllPokemonAccessibleConfig = Readonly<{
  /** Seed public : il stabilise les zones choisies et ne remplace jamais le RNG HGSS. */
  seed: string
  /** Atteste une chaîne de configuration indépendante de tout texte résolu depuis la ROM. */
  seedSource?: 'config-text'
}>

export const defaultAllPokemonAccessibleConfig: AllPokemonAccessibleConfig = Object.freeze({
  seed: 'pokemaster-hgss-all-pokemon-v1',
  seedSource: 'config-text',
})

export type AllPokemonSaveStatistics = Readonly<{
  money: number
  battlesWon: number
  /** Espèces capturées, lues depuis le Pokédex sauvegardé ; les doublons sont ignorés. */
  caughtSpeciesIds: readonly number[]
}>

export type AllPokemonQuestView = AllPokemonQuestDefinition & Readonly<{
  status: AllPokemonQuestStatus
  encounterInstanceId: PokemonInstanceId | null
  requirementMet: boolean
}>

export type AllPokemonAccessibleRuntime = Readonly<{
  config: AllPokemonAccessibleConfig
  plan: AllPokemonAccessibilityPlan
  fieldWildEncounterIdentityPort: ReturnType<typeof createAllPokemonAccessibleEncounterPort>
  wildEncounterStartedObserver: WildEncounterStartedObserver
  detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver
  refreshQuestAvailability: () => readonly AllPokemonQuestView[]
  listQuests: () => readonly AllPokemonQuestView[]
  canStartQuestEncounter: (speciesId: number) => boolean
  /** Couture à appeler avant de matérialiser l’acteur ou le combat de quête. */
  prepareQuestEncounter: (speciesId: number) => AllPokemonQuestDefinition | undefined
  /** Applique uniquement les migrations V1 prouvées sur un état hôte cloné. */
  applyFieldStateMigrations: (field: FieldScriptState) => void
  snapshotState: () => AllPokemonAccessibleStateV1
}>

export type AllPokemonAccessibleRuntimeOptions = Readonly<{
  catalog: PokemonCatalog
  mapSources: readonly AllPokemonEncounterMapSource[]
  encounterCatalog: readonly HgssWildEncounterData[]
  config?: unknown
  state?: unknown
  knownAccessibleSpeciesIds?: readonly number[]
  transitiveOneShotEvidence?: AllPokemonTransitiveOneShotEvidence
  readStatistics: () => AllPokemonSaveStatistics
}>

const legacyConfigKeys = ['seed'] as const
const configKeys = ['seed', 'seedSource'] as const

function requirePlainRecord(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} doit être un objet JSON simple.`)
  }
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${path} doit être un objet JSON simple.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(record: Record<string, unknown>, keys: readonly string[], path: string): void {
  const actual = Object.keys(record).sort()
  if (actual.length !== keys.length || actual.some((key, index) => key !== keys[index])) {
    throw new Error(`${path} contient des champs inconnus ou manquants.`)
  }
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

export function decodeAllPokemonAccessibleConfig(value: unknown): AllPokemonAccessibleConfig {
  if (!isJsonSaveValue(value)) {
    throw new Error("La configuration Tous les Pokémon n’est pas une valeur JSON stricte.")
  }
  const config = requirePlainRecord(value, 'La configuration Tous les Pokémon')
  const hasSeedSource = Object.hasOwn(config, 'seedSource')
  requireExactKeys(config, hasSeedSource ? configKeys : legacyConfigKeys, 'La configuration Tous les Pokémon')
  if (hasSeedSource && config.seedSource !== 'config-text') {
    throw new Error('La provenance du seed Tous les Pokémon doit être « config-text ».')
  }
  if (typeof config.seed !== 'string'
    || config.seed.length < 1
    || config.seed.length > 128
    || config.seed.trim() !== config.seed
    || config.seed.normalize('NFC') !== config.seed
    || hasControlCharacter(config.seed)) {
    throw new Error('Le seed Tous les Pokémon doit être une chaîne NFC visible de 1 à 128 caractères.')
  }
  return Object.freeze({ seed: config.seed, seedSource: 'config-text' })
}

function requireStatistics(catalog: PokemonCatalog, value: unknown): AllPokemonSaveStatistics {
  const statistics = requirePlainRecord(value, 'Les statistiques Tous les Pokémon')
  requireExactKeys(statistics, ['battlesWon', 'caughtSpeciesIds', 'money'], 'Les statistiques Tous les Pokémon')
  if (!Number.isSafeInteger(statistics.money) || (statistics.money as number) < 0
    || !Number.isSafeInteger(statistics.battlesWon) || (statistics.battlesWon as number) < 0
    || !Array.isArray(statistics.caughtSpeciesIds)) {
    throw new Error('Les statistiques Tous les Pokémon sont invalides.')
  }
  const caughtSpeciesIds = [...new Set(statistics.caughtSpeciesIds.map((speciesId) => {
    if (!Number.isSafeInteger(speciesId)
      || (speciesId as number) < 1
      || (speciesId as number) > 493
      || catalog.personalData[speciesId as number]?.speciesId !== speciesId) {
      throw new Error(`L’espèce capturée ${String(speciesId)} des statistiques Tous les Pokémon est invalide.`)
    }
    return speciesId as number
  }))].sort((left, right) => left - right)
  return Object.freeze({
    money: statistics.money as number,
    battlesWon: statistics.battlesWon as number,
    caughtSpeciesIds: Object.freeze(caughtSpeciesIds),
  })
}

export function isAllPokemonQuestRequirementMet(
  requirement: AllPokemonQuestRequirement,
  statistics: AllPokemonSaveStatistics,
  catalog: PokemonCatalog,
): boolean {
  const normalized = requireStatistics(catalog, statistics)
  if (requirement.kind === 'money') return normalized.money >= requirement.amount
  if (requirement.kind === 'battles-won') return normalized.battlesWon >= requirement.count
  let count = 0
  for (const speciesId of normalized.caughtSpeciesIds) {
    if (catalog.personalData[speciesId]!.types.includes(requirement.typeId)) count += 1
  }
  return count >= requirement.count
}

function cloneQuestState(state: AllPokemonQuestStateV1): AllPokemonQuestStateV1 {
  return Object.freeze({ ...state })
}

type NormalizedAllPokemonStateForPlan = Readonly<{
  state: AllPokemonAccessibleStateV1
  disappearanceFlagIds: readonly number[]
}>

function normalizeStateForPlan(
  state: AllPokemonAccessibleStateV1,
  plan: AllPokemonAccessibilityPlan,
  rayquazaDisappearanceFlagId: number | undefined,
): NormalizedAllPokemonStateForPlan {
  const expected = plan.quests.map(({ speciesId }) => speciesId)
  const actual = state.quests.map(({ speciesId }) => speciesId)
  if (actual.length === expected.length && actual.every((speciesId, index) => speciesId === expected[index])) {
    return Object.freeze({ state, disappearanceFlagIds: Object.freeze([]) })
  }

  // Les premiers profils V1 créaient une quête Rayquaza même lorsque le
  // module rendait déjà accessibles Kyogre et Groudon. Une fois la dépendance
  // transitive prouvée, cette seule entrée historique peut être retirée sans
  // réinterpréter les autres quêtes ni changer la version du format.
  const expectedSet = new Set(expected)
  const obsolete = state.quests.filter(({ speciesId }) => !expectedSet.has(speciesId))
  const migratedQuests = state.quests.filter(({ speciesId }) => expectedSet.has(speciesId))
  const migratedSpecies = migratedQuests.map(({ speciesId }) => speciesId)
  if (obsolete.length === 1
    && obsolete[0]!.speciesId === 384
    && plan.nativeSpeciesIds.includes(384)
    && migratedSpecies.length === expected.length
    && migratedSpecies.every((speciesId, index) => speciesId === expected[index])) {
    const legacyRayquaza = obsolete[0]!
    if (legacyRayquaza.encounterInstanceId !== null) {
      throw new Error('La reprise contient une ancienne quête Rayquaza encore active ; terminez ce combat avec la version précédente avant la migration.')
    }
    const isTerminal = legacyRayquaza.status === 'captured' || legacyRayquaza.status === 'defeated'
    if (isTerminal && rayquazaDisappearanceFlagId === undefined) {
      throw new Error('La quête Rayquaza terminale ne peut pas être migrée sans drapeau de disparition ROM prouvé.')
    }
    return Object.freeze({
      state: parseAllPokemonAccessibleStateV1({ ...state, quests: migratedQuests }),
      disappearanceFlagIds: isTerminal
        ? Object.freeze([rayquazaDisappearanceFlagId!])
        : Object.freeze([]),
    })
  }
  throw new Error('L’état Tous les Pokémon ne correspond pas aux quêtes du profil et de la ROM actifs.')
}

/**
 * Runtime de domaine. Il ne crée volontairement ni coordonnées, ni dialogue,
 * ni acteur : l’hôte doit fournir ces données de campagne, puis appeler
 * `prepareQuestEncounter` avant de lancer son combat sauvage normal.
 */
export function createAllPokemonAccessibleRuntime(
  options: AllPokemonAccessibleRuntimeOptions,
): AllPokemonAccessibleRuntime {
  if (typeof options.readStatistics !== 'function') {
    throw new Error('Le lecteur de statistiques Tous les Pokémon est absent.')
  }
  const config = decodeAllPokemonAccessibleConfig(options.config ?? defaultAllPokemonAccessibleConfig)
  const plan = createAllPokemonAccessibilityPlan(
    options.catalog,
    options.mapSources,
    options.encounterCatalog,
    {
      seed: config.seed,
      ...(options.knownAccessibleSpeciesIds === undefined
        ? {}
        : { knownAccessibleSpeciesIds: options.knownAccessibleSpeciesIds }),
      ...(options.transitiveOneShotEvidence === undefined
        ? {}
        : { transitiveOneShotEvidence: options.transitiveOneShotEvidence }),
    },
  )
  const restoredState = options.state === undefined
    ? createInitialAllPokemonAccessibleState(plan.quests.map(({ speciesId }) => speciesId))
    : parseAllPokemonAccessibleStateV1(options.state)
  const normalized = normalizeStateForPlan(
    restoredState,
    plan,
    options.transitiveOneShotEvidence === undefined
      ? undefined
      : resolveAllPokemonRayquazaDisappearanceFlagId(options.transitiveOneShotEvidence.landmarks),
  )
  const initialState = normalized.state
  if (initialState.quests.filter(({ encounterInstanceId }) => encounterInstanceId !== null).length > 1) {
    throw new Error('L’état Tous les Pokémon contient plusieurs combats de quête actifs.')
  }
  const questStates = new Map(initialState.quests.map((quest) => [quest.speciesId, cloneQuestState(quest)]))
  const questsBySpecies = new Map(plan.quests.map((quest) => [quest.speciesId, quest]))

  const replaceQuestState = (
    speciesId: number,
    status: AllPokemonQuestStatus,
    encounterInstanceId: PokemonInstanceId | null = null,
  ): void => {
    if (!questStates.has(speciesId)) throw new Error(`La quête de l’espèce ${speciesId} est inconnue.`)
    questStates.set(speciesId, Object.freeze({ speciesId, status, encounterInstanceId }))
  }

  const readCurrentStatistics = (): AllPokemonSaveStatistics => requireStatistics(
    options.catalog,
    options.readStatistics(),
  )

  const requirementMet = (
    quest: AllPokemonQuestDefinition,
    statistics: AllPokemonSaveStatistics,
  ): boolean => isAllPokemonQuestRequirementMet(quest.requirement, statistics, options.catalog)

  const refresh = (): readonly AllPokemonQuestView[] => {
    const statistics = readCurrentStatistics()
    for (const quest of plan.quests) {
      const state = questStates.get(quest.speciesId)!
      if (state.status === 'locked' && requirementMet(quest, statistics)) {
        replaceQuestState(quest.speciesId, 'available')
      }
    }
    return Object.freeze(plan.quests.map((quest) => {
      const state = questStates.get(quest.speciesId)!
      return Object.freeze({
        ...quest,
        status: state.status,
        encounterInstanceId: state.encounterInstanceId,
        requirementMet: requirementMet(quest, statistics),
      })
    }))
  }

  const beginEncounter = (speciesId: number, instanceIdValue: unknown): void => {
    refresh()
    const state = questStates.get(speciesId)
    if (!state) return
    const instanceId = parsePokemonInstanceId(instanceIdValue)
    const active = [...questStates.values()].find(({ encounterInstanceId }) => encounterInstanceId !== null)
    if (active?.speciesId === speciesId && active.encounterInstanceId === instanceId) return
    // Une rencontre native ou scriptée HGSS peut partager l'espèce d'une
    // quête encore verrouillée. L'observateur intervient après le démarrage :
    // il ne doit jamais casser cette rencontre légitime. Elle devient donc la
    // tentative active et suit ensuite exactement les mêmes issues persistées.
    if (state.status === 'captured' || state.status === 'defeated') return
    if (active) replaceQuestState(active.speciesId, 'available')
    replaceQuestState(speciesId, 'available', instanceId)
  }

  const findActiveQuestByInstance = (instanceId: PokemonInstanceId): AllPokemonQuestStateV1 | undefined => (
    [...questStates.values()].find((quest) => quest.encounterInstanceId === instanceId)
  )

  const clearActiveEncounter = (): void => {
    const active = [...questStates.values()].find(({ encounterInstanceId }) => encounterInstanceId !== null)
    if (active) replaceQuestState(active.speciesId, 'available')
  }

  const wildEncounterStartedObserver: WildEncounterStartedObserver = Object.freeze({
    observeWildEncounterStarted(event: WildEncounterStartedEvent) {
      if (questsBySpecies.has(event.speciesId)) beginEncounter(event.speciesId, event.instanceId)
    },
  })

  const detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver = Object.freeze({
    observeBattleOutcome(event: DetailedBattleOutcomeEvent) {
      if (event.kind === 'pokemon-knocked-out' && event.pokemon.side === 'opponent') {
        const active = findActiveQuestByInstance(event.pokemon.instanceId)
        if (active) replaceQuestState(active.speciesId, 'defeated')
        return
      }
      if (event.kind !== 'battle-finished') return
      if (event.outcome === 'capture') {
        const active = findActiveQuestByInstance(event.capturedPokemon.instanceId)
        if (active) replaceQuestState(active.speciesId, 'captured')
        return
      }
      const active = [...questStates.values()].find(({ encounterInstanceId }) => encounterInstanceId !== null)
      if (!active) return
      // Une victoire contre l’unique cible de quête signifie également son KO,
      // même si un projecteur de combat ancien a omis l’événement détaillé.
      if (event.outcome === 'win') replaceQuestState(active.speciesId, 'defeated')
      else clearActiveEncounter()
    },
  })

  const canStartQuestEncounter = (speciesId: number): boolean => {
    refresh()
    const state = questStates.get(speciesId)
    return state?.status === 'available' && state.encounterInstanceId === null
  }

  const prepareQuestEncounter = (speciesId: number): AllPokemonQuestDefinition | undefined => (
    canStartQuestEncounter(speciesId) ? questsBySpecies.get(speciesId) : undefined
  )

  return Object.freeze({
    config,
    plan,
    fieldWildEncounterIdentityPort: createAllPokemonAccessibleEncounterPort(plan),
    wildEncounterStartedObserver,
    detailedBattleOutcomeObserver,
    refreshQuestAvailability: refresh,
    listQuests: refresh,
    canStartQuestEncounter,
    prepareQuestEncounter,
    applyFieldStateMigrations(field) {
      for (const flagId of normalized.disappearanceFlagIds) field.flags.add(flagId)
    },
    snapshotState() {
      return parseAllPokemonAccessibleStateV1({
        format: 'pokemaster-hgss-all-pokemon-accessible-state',
        version: 1,
        quests: [...questStates.values()].sort((left, right) => left.speciesId - right.speciesId),
      })
    },
  })
}

export const allPokemonAccessibleModule = defineNewGamePlusModule<AllPokemonAccessibleConfig>({
  id: allPokemonAccessibleModuleId,
  revision: 1,
  title: 'Tous les Pokémon accessibles',
  description: 'Rend les 493 espèces accessibles par zones cohérentes ou quêtes persistantes.',
  enabledByDefault: false,
  createDefaultConfig: () => ({ ...defaultAllPokemonAccessibleConfig }),
  decodeConfig: decodeAllPokemonAccessibleConfig,
  apply: () => undefined,
})
