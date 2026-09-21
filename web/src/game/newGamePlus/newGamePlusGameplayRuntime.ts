import type { PokemonCatalog } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import {
  composeGameplayExtensionPorts,
  type GameplayExtensionPortContribution,
} from '../extensions/composeGameplayExtensionPorts'
import {
  baseGameplayExtensionPorts,
  type GameplayExtensionPorts,
} from '../extensions/gameplayExtensionPorts'
import {
  cloneVersionedSaveExtensions,
  isVersionedSaveExtensionsEnvelope,
  type JsonSaveValue,
  type VersionedSaveExtensions,
} from '../save/versionedSaveExtensions'
import { parseNewGamePlusProfileV1 } from './newGamePlusProfile'
import type { NewGamePlusProfileV1 } from './newGamePlusTypes'
import {
  assertNewGamePlusTeamRuleCompatibility,
} from './modules/teamRuleCompatibility'
import { allBattlesInDuoModuleId } from './modules/allBattlesInDuoModule'
import { createAllBattlesInDuoRuntime } from './modules/allBattlesInDuoRule'
import {
  allPokemonAccessibleModuleId,
  allPokemonAccessibleSaveExtensionKey,
  allPokemonAccessibleSaveExtensionVersion,
  createAllPokemonAccessibleRuntime,
  type AllPokemonAccessibleRuntime,
  type AllPokemonAccessibleRuntimeOptions,
} from './modules/allPokemonAccessibleModule'
import { parseAllPokemonAccessibleStateV1 } from './modules/allPokemonAccessibleState'
import { createAllPokemonQuestWorldCoordinator, type AllPokemonQuestWorldCoordinator, type AllPokemonQuestWorldLocation } from './modules/allPokemonQuestWorldCoordinator'
import {
  createEeveeTeamRuntime,
  decodeEeveeTeamRuntimeState,
  eeveeTeamModuleId,
  type EeveePermanentDeathLookup,
} from './modules/eeveeTeamModule'
import { hardcoreModuleId } from './modules/hardcoreModule'
import {
  createHardcoreRuntime,
  hardcoreSaveExtensionKey,
  hardcoreSaveExtensionVersion,
} from './modules/hardcoreRule'
import { parseHardcoreStateV1 } from './modules/hardcoreState'
import {
  createMonotypeTeamRuntime,
  decodeMonotypeConfig,
  decodeMonotypeRuntimeState,
  monotypeModuleId,
} from './modules/monotypeModule'
import {
  createNuzlockeRuntime,
  nuzlockeSaveExtensionKey,
  nuzlockeSaveExtensionVersion,
} from './modules/nuzlockeRule'
import { nuzlockeModuleId } from './modules/nuzlockeModule'
import { parseNuzlockeStateV1 } from './modules/nuzlockeState'
import { permanentDeathModuleId } from './modules/permanentDeathModule'
import {
  createPermanentDeathRuntime,
  permanentDeathSaveExtensionKey,
  permanentDeathSaveExtensionVersion,
  type PermanentDeathRuntime,
} from './modules/permanentDeathRule'
import { parsePermanentDeathStateV1 } from './modules/permanentDeathState'
import {
  createSoloRunTeamRuntime,
  decodeSoloRunConfig,
  decodeSoloRunRuntimeState,
  soloRunModuleId,
} from './modules/soloRunModule'
import { createRandomizerRuntime, randomizerModuleId } from './modules/randomizerModule'
import { visibleWildPokemonModuleId } from './modules/visibleWildPokemonModule'
import {
  createVisibleWildPokemonRuntime,
  visibleWildPokemonSaveExtensionKey,
  visibleWildPokemonSaveExtensionVersion,
} from './modules/visibleWildPokemonRule'
import { parseVisibleWildPokemonStateV1 } from './modules/visibleWildPokemonState'

export { allBattlesInDuoModuleId } from './modules/allBattlesInDuoModule'
export const monotypeSaveExtensionKey = 'new-game-plus.monotype'
export const soloRunSaveExtensionKey = 'new-game-plus.solo-run'
export const eeveeTeamSaveExtensionKey = 'new-game-plus.eevee-team'

const runtimeRevision = 1
const runtimeModuleCompositionPriority = new Map<string, number>([
  nuzlockeModuleId,
  hardcoreModuleId,
  permanentDeathModuleId,
  randomizerModuleId,
  allPokemonAccessibleModuleId,
  visibleWildPokemonModuleId,
  allBattlesInDuoModuleId,
  monotypeModuleId,
  soloRunModuleId,
  eeveeTeamModuleId,
].map((moduleId, priority) => [moduleId, priority]))
const knownRuntimeExtensionKeys = new Set([
  nuzlockeSaveExtensionKey,
  monotypeSaveExtensionKey,
  soloRunSaveExtensionKey,
  eeveeTeamSaveExtensionKey,
  hardcoreSaveExtensionKey,
  permanentDeathSaveExtensionKey,
  allPokemonAccessibleSaveExtensionKey,
  visibleWildPokemonSaveExtensionKey,
])

type RuntimeStateWriter = Readonly<{
  version: number
  save: () => JsonSaveValue
}>

function orderRuntimeModuleSelections(
  selections: NewGamePlusProfileV1['modules'],
): NewGamePlusProfileV1['modules'] {
  return Object.freeze([...selections].sort((left, right) => {
    const priorityDifference = (runtimeModuleCompositionPriority.get(left.id) ?? Number.MAX_SAFE_INTEGER)
      - (runtimeModuleCompositionPriority.get(right.id) ?? Number.MAX_SAFE_INTEGER)
    if (priorityDifference !== 0) return priorityDifference
    return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
  }))
}

export type NewGamePlusGameplayRuntime = Readonly<{
  profile: NewGamePlusProfileV1
  ports: GameplayExtensionPorts
  /** Applique les migrations de modules sur une copie hôte avant son commit. */
  applyFieldStateMigrations: (field: FieldScriptState) => void
  snapshotExtensions: (existing?: VersionedSaveExtensions) => VersionedSaveExtensions | undefined
  getModuleRuntime: (moduleId: string) => unknown
}>

export type AllPokemonAccessibleGameplayRuntime = AllPokemonAccessibleRuntime & Readonly<{
  questWorldCoordinator: AllPokemonQuestWorldCoordinator
}>

export type NewGamePlusGameplayRuntimeOptions = Readonly<{
  catalog: PokemonCatalog
  extensions?: VersionedSaveExtensions
  activation: 'new' | 'resume'
  basePorts?: GameplayExtensionPorts
  isPermanentlyDead?: EeveePermanentDeathLookup
  readProgression?: () => number
  allPokemonAccessible?: Omit<AllPokemonAccessibleRuntimeOptions, 'catalog' | 'config' | 'state'>
  allPokemonQuestLocations?: readonly AllPokemonQuestWorldLocation[]
}>

function requireRuntimeExtensionEnvelope(
  extensions: VersionedSaveExtensions | undefined,
): VersionedSaveExtensions | undefined {
  if (extensions !== undefined && !isVersionedSaveExtensionsEnvelope(extensions)) {
    throw new Error('Le bloc des extensions runtime New Game+ est invalide.')
  }
  return extensions
}

function rejectUnknownRuntimeExtensions(extensions: VersionedSaveExtensions | undefined): void {
  if (!extensions) return
  for (const key of Object.keys(extensions)) {
    if (key.startsWith('new-game-plus.') && !knownRuntimeExtensionKeys.has(key)) {
      throw new Error(`L’extension runtime New Game+ « ${key} » est inconnue.`)
    }
  }
}

function readRuntimeState(
  extensions: VersionedSaveExtensions | undefined,
  key: string,
  moduleId: string,
  selected: boolean,
  activation: 'new' | 'resume' | 'normal',
  decode: (value: unknown) => unknown,
): unknown {
  const entry = extensions?.[key]
  if (entry && !selected) {
    throw new Error(`L’extension ${key} est présente alors que le module ${moduleId} n’est pas sélectionné.`)
  }
  if (!entry) {
    if (selected && activation === 'resume') {
      throw new Error(`L’état sauvegardé du module New Game+ ${moduleId} est absent.`)
    }
    return undefined
  }
  if (entry.version !== runtimeRevision) {
    throw new Error(`La version ${entry.version} de l’extension ${key} n’est pas prise en charge.`)
  }
  return decode(entry.value)
}

/** Valide aussi les parties normales : aucun état NG+ connu ne peut y être injecté. */
export function assertNewGamePlusRuntimeExtensionsMatchProfile(
  profile: NewGamePlusProfileV1 | undefined,
  extensions: VersionedSaveExtensions | undefined,
  activation: 'new' | 'resume' | 'normal',
): void {
  requireRuntimeExtensionEnvelope(extensions)
  rejectUnknownRuntimeExtensions(extensions)
  const selectedIds = new Set(profile?.modules.map(({ id }) => id) ?? [])
  readRuntimeState(extensions, nuzlockeSaveExtensionKey, nuzlockeModuleId, selectedIds.has(nuzlockeModuleId), activation, parseNuzlockeStateV1)
  readRuntimeState(extensions, monotypeSaveExtensionKey, monotypeModuleId, selectedIds.has(monotypeModuleId), activation, decodeMonotypeRuntimeState)
  readRuntimeState(extensions, soloRunSaveExtensionKey, soloRunModuleId, selectedIds.has(soloRunModuleId), activation, decodeSoloRunRuntimeState)
  readRuntimeState(extensions, eeveeTeamSaveExtensionKey, eeveeTeamModuleId, selectedIds.has(eeveeTeamModuleId), activation, decodeEeveeTeamRuntimeState)
  readRuntimeState(extensions, hardcoreSaveExtensionKey, hardcoreModuleId, selectedIds.has(hardcoreModuleId), activation, parseHardcoreStateV1)
  readRuntimeState(extensions, permanentDeathSaveExtensionKey, permanentDeathModuleId, selectedIds.has(permanentDeathModuleId), activation, parsePermanentDeathStateV1)
  readRuntimeState(extensions, allPokemonAccessibleSaveExtensionKey, allPokemonAccessibleModuleId, selectedIds.has(allPokemonAccessibleModuleId), activation, parseAllPokemonAccessibleStateV1)
  readRuntimeState(extensions, visibleWildPokemonSaveExtensionKey, visibleWildPokemonModuleId, selectedIds.has(visibleWildPokemonModuleId), activation, parseVisibleWildPokemonStateV1)
}

export function createNewGamePlusGameplayRuntime(
  profileValue: NewGamePlusProfileV1,
  options: NewGamePlusGameplayRuntimeOptions,
): NewGamePlusGameplayRuntime {
  const profile = parseNewGamePlusProfileV1(profileValue)
  const extensions = requireRuntimeExtensionEnvelope(options.extensions)
  rejectUnknownRuntimeExtensions(extensions)
  const selectedIds = new Set(profile.modules.map(({ id }) => id))
  assertNewGamePlusTeamRuleCompatibility({
    soloRun: selectedIds.has(soloRunModuleId),
    allBattlesInDuo: selectedIds.has(allBattlesInDuoModuleId),
    eeveeTeam: selectedIds.has(eeveeTeamModuleId),
    monotype: selectedIds.has(monotypeModuleId),
  })

  const contributions: GameplayExtensionPortContribution[] = []
  const fieldStateMigrations: Array<(field: FieldScriptState) => void> = []
  const stateWriters = new Map<string, RuntimeStateWriter>()
  const runtimes = new Map<string, unknown>()
  const monotypeSelection = profile.modules.find(({ id }) => id === monotypeModuleId)
  const monotypeConfig = monotypeSelection && decodeMonotypeConfig(monotypeSelection.config)
  const soloRunSelection = profile.modules.find(({ id }) => id === soloRunModuleId)
  if (monotypeConfig && soloRunSelection) {
    const soloRunConfig = decodeSoloRunConfig(soloRunSelection.config)
    if (!options.catalog.personalData[soloRunConfig.speciesId]?.types.includes(monotypeConfig.typeId)) {
      throw new Error(`L’espèce Solo Run ${soloRunConfig.speciesId} ne possède pas le type Monotype ${monotypeConfig.typeId}.`)
    }
  }
  let permanentDeathRuntime: PermanentDeathRuntime | undefined
  const permanentDeathSelection = profile.modules.find(({ id }) => id === permanentDeathModuleId)
  if (permanentDeathSelection) {
    const state = readRuntimeState(extensions, permanentDeathSaveExtensionKey, permanentDeathModuleId, true, options.activation, parsePermanentDeathStateV1)
    permanentDeathRuntime = createPermanentDeathRuntime({ enabled: true, ...(state === undefined ? {} : { state }) })
    runtimes.set(permanentDeathModuleId, permanentDeathRuntime)
  }

  for (const selection of orderRuntimeModuleSelections(profile.modules)) {
    if ([nuzlockeModuleId, monotypeModuleId, soloRunModuleId, eeveeTeamModuleId, hardcoreModuleId, permanentDeathModuleId, randomizerModuleId, allBattlesInDuoModuleId, allPokemonAccessibleModuleId, visibleWildPokemonModuleId].includes(selection.id)
      && selection.revision !== runtimeRevision) {
      throw new Error(`La révision runtime du module New Game+ ${selection.id} est invalide.`)
    }
    if (selection.id === nuzlockeModuleId) {
      const state = readRuntimeState(extensions, nuzlockeSaveExtensionKey, selection.id, true, options.activation, parseNuzlockeStateV1)
      const runtime = createNuzlockeRuntime({ enabled: true, ...(state === undefined ? {} : { state }) })
      runtimes.set(selection.id, runtime)
      contributions.push({
        battleActionPolicy: runtime.battleActionPolicy,
        wildEncounterStartedObserver: runtime.wildEncounterStartedObserver,
        detailedBattleOutcomeObserver: runtime.detailedBattleOutcomeObserver,
      })
      stateWriters.set(nuzlockeSaveExtensionKey, {
        version: nuzlockeSaveExtensionVersion,
        save: () => runtime.snapshotState()!,
      })
    } else if (selection.id === monotypeModuleId) {
      const state = readRuntimeState(extensions, monotypeSaveExtensionKey, selection.id, true, options.activation, decodeMonotypeRuntimeState)
      const runtime = createMonotypeTeamRuntime(options.catalog, selection.config, state)
      runtimes.set(selection.id, runtime)
      contributions.push({
        pokemonInitialTeamResolver: runtime.initialTeamResolver,
        pokemonTeamPolicy: runtime.teamPolicy,
      })
      stateWriters.set(monotypeSaveExtensionKey, { version: runtimeRevision, save: runtime.snapshot })
    } else if (selection.id === soloRunModuleId) {
      const state = readRuntimeState(extensions, soloRunSaveExtensionKey, selection.id, true, options.activation, decodeSoloRunRuntimeState)
      const runtime = createSoloRunTeamRuntime(options.catalog, selection.config, state)
      runtimes.set(selection.id, runtime)
      contributions.push({
        pokemonInitialTeamResolver: runtime.initialTeamResolver,
        pokemonTeamPolicy: runtime.teamPolicy,
      })
      stateWriters.set(soloRunSaveExtensionKey, { version: runtimeRevision, save: runtime.snapshot })
    } else if (selection.id === eeveeTeamModuleId) {
      const state = readRuntimeState(extensions, eeveeTeamSaveExtensionKey, selection.id, true, options.activation, decodeEeveeTeamRuntimeState)
      const runtime = createEeveeTeamRuntime(
        options.catalog,
        selection.config,
        state,
        permanentDeathRuntime?.isPermanentlyDead ?? options.isPermanentlyDead,
      )
      runtimes.set(selection.id, runtime)
      contributions.push({
        pokemonInitialTeamResolver: runtime.initialTeamResolver,
        pokemonTeamPolicy: runtime.teamPolicy,
      })
      stateWriters.set(eeveeTeamSaveExtensionKey, { version: runtimeRevision, save: runtime.snapshot })
    } else if (selection.id === hardcoreModuleId) {
      const state = readRuntimeState(extensions, hardcoreSaveExtensionKey, selection.id, true, options.activation, parseHardcoreStateV1)
      const runtime = createHardcoreRuntime({
        enabled: true,
        config: selection.config,
        readProgression: options.readProgression ?? (() => 0),
        ...(state === undefined ? {} : { state }),
      })
      runtimes.set(selection.id, runtime)
      contributions.push({
        battleActionPolicy: runtime.battleActionPolicy,
        pokemonLevelPolicy: runtime.pokemonLevelPolicy,
      })
      stateWriters.set(hardcoreSaveExtensionKey, { version: hardcoreSaveExtensionVersion, save: () => runtime.snapshotState()! })
    } else if (selection.id === permanentDeathModuleId) {
      const runtime = permanentDeathRuntime!
      contributions.push({
        detailedBattleOutcomeObserver: runtime.detailedBattleOutcomeObserver,
        pokemonTeamPolicy: runtime.teamPolicy,
        pokemonPartyHealingPolicy: runtime.healingPolicy,
      })
      stateWriters.set(permanentDeathSaveExtensionKey, {
        version: permanentDeathSaveExtensionVersion,
        save: () => runtime.snapshotState()!,
      })
    } else if (selection.id === randomizerModuleId) {
      const runtime = createRandomizerRuntime(options.catalog, selection.config, {
        isStarterSpeciesAllowed: monotypeConfig
          ? (speciesId) => options.catalog.personalData[speciesId]?.types.includes(monotypeConfig.typeId) ?? false
          : undefined,
        preserveExplicitInitialTeam: selectedIds.has(soloRunModuleId) || selectedIds.has(eeveeTeamModuleId),
      })
      runtimes.set(selection.id, runtime)
      contributions.push({
        pokemonInitialTeamResolver: runtime.initialTeamResolver,
        fieldWildEncounterIdentityPort: runtime.fieldWildEncounterIdentityPort,
        fieldBattleRosterPolicy: runtime.fieldBattleRosterPolicy,
      })
    } else if (selection.id === allBattlesInDuoModuleId) {
      const runtime = createAllBattlesInDuoRuntime(true)
      runtimes.set(selection.id, runtime)
      contributions.push({
        fieldBattleFormatResolver: runtime.fieldBattleFormatResolver,
        fieldBattleRosterPolicy: runtime.fieldBattleRosterPolicy,
        pokemonInitialTeamResolver: runtime.pokemonInitialTeamResolver,
      })
    } else if (selection.id === allPokemonAccessibleModuleId) {
      if (!options.allPokemonAccessible) throw new Error('Les catalogues hôte de Tous les Pokémon accessibles sont absents.')
      if (!options.allPokemonQuestLocations) throw new Error('Les emplacements hôte des quêtes Tous les Pokémon sont absents.')
      const state = readRuntimeState(extensions, allPokemonAccessibleSaveExtensionKey, selection.id, true, options.activation, parseAllPokemonAccessibleStateV1)
      const runtime = createAllPokemonAccessibleRuntime({
        ...options.allPokemonAccessible,
        catalog: options.catalog,
        config: selection.config,
        ...(state === undefined ? {} : { state }),
      })
      const questWorldCoordinator = createAllPokemonQuestWorldCoordinator(runtime, options.allPokemonQuestLocations)
      runtimes.set(selection.id, Object.freeze({ ...runtime, questWorldCoordinator }) satisfies AllPokemonAccessibleGameplayRuntime)
      fieldStateMigrations.push(runtime.applyFieldStateMigrations)
      contributions.push({
        fieldWildEncounterIdentityPort: runtime.fieldWildEncounterIdentityPort,
        wildEncounterStartedObserver: runtime.wildEncounterStartedObserver,
        detailedBattleOutcomeObserver: runtime.detailedBattleOutcomeObserver,
        worldSessionExtensionPorts: questWorldCoordinator.worldSessionExtensionPorts,
      })
      stateWriters.set(allPokemonAccessibleSaveExtensionKey, {
        version: allPokemonAccessibleSaveExtensionVersion,
        save: runtime.snapshotState,
      })
    } else if (selection.id === visibleWildPokemonModuleId) {
      const state = readRuntimeState(extensions, visibleWildPokemonSaveExtensionKey, selection.id, true, options.activation, parseVisibleWildPokemonStateV1)
      const runtime = createVisibleWildPokemonRuntime(selection.config, state)
      runtimes.set(selection.id, runtime)
      contributions.push({ worldSessionExtensionPorts: runtime.worldSessionExtensionPorts })
      stateWriters.set(visibleWildPokemonSaveExtensionKey, {
        version: visibleWildPokemonSaveExtensionVersion,
        save: runtime.snapshotState,
      })
    }
  }

  // Une extension connue mais non sélectionnée constitue toujours une injection.
  assertNewGamePlusRuntimeExtensionsMatchProfile(profile, extensions, options.activation)
  const initialExtensions = extensions
  return Object.freeze({
    profile,
    ports: composeGameplayExtensionPorts(options.basePorts ?? baseGameplayExtensionPorts, contributions),
    applyFieldStateMigrations(field) {
      for (const migrate of fieldStateMigrations) migrate(field)
    },
    snapshotExtensions(existing = initialExtensions) {
      const snapshot: Record<string, { version: number, value: JsonSaveValue }> = existing
        ? { ...cloneVersionedSaveExtensions(existing) }
        : {}
      for (const key of knownRuntimeExtensionKeys) delete snapshot[key]
      for (const [key, writer] of stateWriters) {
        snapshot[key] = { version: writer.version, value: writer.save() }
      }
      return Object.keys(snapshot).length === 0 ? undefined : snapshot
    },
    getModuleRuntime: (moduleId) => runtimes.get(moduleId),
  })
}
