import { cloneFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { normalizeNewGamePlusJsonValue, parseNewGamePlusProfileV1, requireNewGamePlusModuleId } from './newGamePlusProfile'
import {
  NewGamePlusApplicationError,
  NewGamePlusValidationError,
  type NewGamePlusJsonValue,
  type NewGamePlusModuleDefinition,
  type NewGamePlusModuleSelection,
  type NewGamePlusProfileDraft,
  type NewGamePlusProfileV1,
} from './newGamePlusTypes'

export type NewGamePlusRegistry = Readonly<{
  listModules: () => readonly Readonly<{
    id: string
    revision: number
    title: string
    description: string
    enabledByDefault: boolean
    defaultConfig: NewGamePlusJsonValue
  }>[]
  createProfile: (draft: NewGamePlusProfileDraft) => NewGamePlusProfileV1
  restoreProfile: (value: unknown) => NewGamePlusProfileV1
  applyProfile: (
    profile: unknown,
    source: FieldScriptState,
    destination: FieldScriptState,
  ) => FieldScriptState
}>

type RegisteredModule = Readonly<{
  definition: NewGamePlusModuleDefinition
  defaultConfig: NewGamePlusJsonValue
}>

function requireRevision(value: number, moduleId: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new NewGamePlusValidationError(`La révision du module New Game+ ${moduleId} est invalide.`)
  }
  return value
}

function requireModuleCopy(value: string, field: 'title' | 'description', moduleId: string): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new NewGamePlusValidationError(`Le champ ${field} du module New Game+ ${moduleId} est invalide.`)
  }
  return value
}

function decodeModuleConfig(module: RegisteredModule, value: unknown): NewGamePlusJsonValue {
  try {
    return normalizeNewGamePlusJsonValue(module.definition.decodeConfig(value), `module.${module.definition.id}.config`)
  } catch (error) {
    if (error instanceof NewGamePlusValidationError) throw error
    const detail = error instanceof Error ? error.message : String(error)
    throw new NewGamePlusValidationError(
      `La configuration du module New Game+ ${module.definition.id} est invalide : ${detail}`,
      { cause: error },
    )
  }
}

function registerModules(definitions: readonly NewGamePlusModuleDefinition[]): Map<string, RegisteredModule> {
  const modules = new Map<string, RegisteredModule>()
  for (const definition of definitions) {
    const id = requireNewGamePlusModuleId(definition.id, 'registre.id')
    requireRevision(definition.revision, id)
    requireModuleCopy(definition.title, 'title', id)
    requireModuleCopy(definition.description, 'description', id)
    if (definition.enabledByDefault !== undefined && typeof definition.enabledByDefault !== 'boolean') {
      throw new NewGamePlusValidationError(`La valeur enabledByDefault du module New Game+ ${id} est invalide.`)
    }
    if (modules.has(id)) throw new NewGamePlusValidationError(`Le module New Game+ ${id} est enregistré plusieurs fois.`)
    const provisional: RegisteredModule = { definition, defaultConfig: null }
    const defaultConfig = decodeModuleConfig(provisional, definition.createDefaultConfig())
    modules.set(id, Object.freeze({ definition, defaultConfig }))
  }
  return modules
}

function resolveSelections(
  modules: ReadonlyMap<string, RegisteredModule>,
  selections: readonly NewGamePlusModuleSelection[],
): readonly Readonly<{ module: RegisteredModule, selection: NewGamePlusModuleSelection }>[] {
  const selectedIds = new Set<string>()
  return selections.map((selection) => {
    if (selectedIds.has(selection.id)) {
      throw new NewGamePlusValidationError(`Le module New Game+ ${selection.id} est sélectionné plusieurs fois.`)
    }
    selectedIds.add(selection.id)
    const module = modules.get(selection.id)
    if (!module) throw new NewGamePlusValidationError(`Le module New Game+ ${selection.id} n'est pas installé.`)
    if (selection.revision !== module.definition.revision) {
      throw new NewGamePlusValidationError(
        `Le module New Game+ ${selection.id} attend la révision ${module.definition.revision}, pas ${selection.revision}.`,
      )
    }
    const config = decodeModuleConfig(module, selection.config)
    return Object.freeze({ module, selection: Object.freeze({ ...selection, config }) })
  })
}

function normalizeProfile(
  modules: ReadonlyMap<string, RegisteredModule>,
  value: unknown,
): Readonly<{ profile: NewGamePlusProfileV1, resolved: ReturnType<typeof resolveSelections> }> {
  const parsed = parseNewGamePlusProfileV1(value)
  const resolved = resolveSelections(modules, parsed.modules)
  const profile = parseNewGamePlusProfileV1({
    ...parsed,
    modules: resolved.map(({ selection }) => selection),
  })
  return Object.freeze({ profile, resolved })
}

export function createNewGamePlusRegistry(
  definitions: readonly NewGamePlusModuleDefinition[],
): NewGamePlusRegistry {
  const modules = registerModules(definitions)

  const restoreProfile = (value: unknown): NewGamePlusProfileV1 => normalizeProfile(modules, value).profile

  const createProfile = (draft: NewGamePlusProfileDraft): NewGamePlusProfileV1 => {
    const selections = draft.modules.map(({ id, config }): NewGamePlusModuleSelection => {
      const module = modules.get(id)
      if (!module) throw new NewGamePlusValidationError(`Le module New Game+ ${id} n'est pas installé.`)
      return {
        id,
        revision: module.definition.revision,
        config: decodeModuleConfig(module, config === undefined ? module.defaultConfig : config),
      }
    })
    return restoreProfile({
      format: 'pokemaster-hgss-new-game-plus',
      version: 1,
      source: draft.source,
      modules: selections,
    })
  }

  const applyProfile = (
    value: unknown,
    source: FieldScriptState,
    destination: FieldScriptState,
  ): FieldScriptState => {
    const { resolved } = normalizeProfile(modules, value)
    const transaction = cloneFieldScriptState(destination)
    for (const { module, selection } of resolved) {
      try {
        // Une copie distincte empêche aussi un module fautif d'altérer la vue
        // source du module suivant.
        module.definition.apply({
          source: cloneFieldScriptState(source),
          destination: transaction,
        }, selection.config)
      } catch (error) {
        throw new NewGamePlusApplicationError(module.definition.id, error)
      }
    }
    return transaction
  }

  const listModules = () => Object.freeze([...modules.values()].map(({ definition, defaultConfig }) => Object.freeze({
    id: definition.id,
    revision: definition.revision,
    title: definition.title,
    description: definition.description,
    enabledByDefault: definition.enabledByDefault ?? false,
    defaultConfig: normalizeNewGamePlusJsonValue(defaultConfig),
  })))

  return Object.freeze({ listModules, createProfile, restoreProfile, applyProfile })
}
