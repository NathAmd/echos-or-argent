import type { GameDigitalAction } from '../../gameInput'
import type { HgssBrowserSaveSlot } from '../save/hgssSaveStorage'
import type { NewGamePlusJsonValue } from './newGamePlusTypes'

export type NewGamePlusCreationSource = {
  slot: HgssBrowserSaveSlot
  playerName: string
  summary: string
}

export type NewGamePlusCreationModuleOption = {
  id: string
  title: string
  description: string
  enabledByDefault?: boolean
  configChoices: readonly Readonly<{ label: string, config: NewGamePlusJsonValue }>[]
}

export type NewGamePlusCreationItem =
  | { kind: 'source', slot: HgssBrowserSaveSlot }
  | { kind: 'target', slot: HgssBrowserSaveSlot }
  | { kind: 'module', moduleId: string }
  | { kind: 'submit' }
  | { kind: 'cancel' }

export type NewGamePlusCreationState = {
  open: boolean
  cursor: number
  sources: readonly NewGamePlusCreationSource[]
  targets: readonly HgssBrowserSaveSlot[]
  modules: readonly NewGamePlusCreationModuleOption[]
  items: readonly NewGamePlusCreationItem[]
  sourceSlot?: HgssBrowserSaveSlot
  targetSlot?: HgssBrowserSaveSlot
  enabledModuleIds: ReadonlySet<string>
  moduleConfigIndexes: ReadonlyMap<string, number>
}

export type NewGamePlusCreationSelection = {
  sourceSlot: HgssBrowserSaveSlot
  targetSlot: HgssBrowserSaveSlot
  modules: readonly Readonly<{ id: string, config: NewGamePlusJsonValue }>[]
}

export type NewGamePlusCreationResult =
  | { kind: 'ignored' }
  | { kind: 'state', state: NewGamePlusCreationState }
  | { kind: 'cancelled', state: NewGamePlusCreationState }
  | { kind: 'created', selection: NewGamePlusCreationSelection, state: NewGamePlusCreationState }

export type NewGamePlusCreationController = {
  getState: () => NewGamePlusCreationState
  open: (options: {
    sources: readonly NewGamePlusCreationSource[]
    targets: readonly HgssBrowserSaveSlot[]
    modules: readonly NewGamePlusCreationModuleOption[]
    preferredSourceSlot?: HgssBrowserSaveSlot
    preferredTargetSlot?: HgssBrowserSaveSlot
  }) => NewGamePlusCreationState
  close: () => NewGamePlusCreationState
  resolveCreation: (accepted: boolean) => NewGamePlusCreationState
  focus: (index: number) => NewGamePlusCreationState
  configureModule: (moduleId: string, configIndex: number) => NewGamePlusCreationState
  handle: (action: GameDigitalAction) => NewGamePlusCreationResult
}

const closedState = (): NewGamePlusCreationState => ({
  open: false,
  cursor: 0,
  sources: [],
  targets: [],
  modules: [],
  items: [],
  enabledModuleIds: new Set(),
  moduleConfigIndexes: new Map(),
})

export function createNewGamePlusCreationController(): NewGamePlusCreationController {
  let state = closedState()

  const close = (): NewGamePlusCreationState => {
    state = closedState()
    return state
  }
  const resolveCreation = (accepted: boolean): NewGamePlusCreationState => (
    accepted ? close() : state
  )
  const open: NewGamePlusCreationController['open'] = ({
    sources,
    targets,
    modules,
    preferredSourceSlot,
    preferredTargetSlot,
  }) => {
    const uniqueSources = [...new Map(sources.map((source) => [source.slot, { ...source }])).values()]
    const uniqueTargets = [...new Set(targets)]
    const uniqueModules = [...new Map(modules.map((module) => [module.id, {
      ...module,
      configChoices: module.configChoices.map((choice) => ({ ...choice })),
    }])).values()]
    const items: NewGamePlusCreationItem[] = [
      ...uniqueSources.map(({ slot }): NewGamePlusCreationItem => ({ kind: 'source', slot })),
      ...uniqueTargets.map((slot): NewGamePlusCreationItem => ({ kind: 'target', slot })),
      ...uniqueModules.map(({ id }): NewGamePlusCreationItem => ({ kind: 'module', moduleId: id })),
      { kind: 'submit' },
      { kind: 'cancel' },
    ]
    state = {
      open: true,
      cursor: 0,
      sources: uniqueSources,
      targets: uniqueTargets,
      modules: uniqueModules,
      items,
      sourceSlot: uniqueSources.some(({ slot }) => slot === preferredSourceSlot) ? preferredSourceSlot : uniqueSources[0]?.slot,
      targetSlot: uniqueTargets.includes(preferredTargetSlot as HgssBrowserSaveSlot) ? preferredTargetSlot : uniqueTargets[0],
      enabledModuleIds: new Set(uniqueModules.filter(({ enabledByDefault }) => enabledByDefault).map(({ id }) => id)),
      moduleConfigIndexes: new Map(uniqueModules.map(({ id }) => [id, 0])),
    }
    return state
  }
  const focus = (index: number): NewGamePlusCreationState => {
    if (!state.open || !Number.isInteger(index) || index < 0 || index >= state.items.length) return state
    state = { ...state, cursor: index }
    return state
  }
  const configureModule = (moduleId: string, configIndex: number): NewGamePlusCreationState => {
    const module = state.modules.find(({ id }) => id === moduleId)
    if (!state.open || !module || !Number.isInteger(configIndex) || configIndex < 0 || configIndex >= module.configChoices.length) return state
    const moduleConfigIndexes = new Map(state.moduleConfigIndexes)
    moduleConfigIndexes.set(moduleId, configIndex)
    state = { ...state, moduleConfigIndexes }
    return state
  }
  const handle = (action: GameDigitalAction): NewGamePlusCreationResult => {
    if (!state.open) return { kind: 'ignored' }
    const focusedItem = state.items[state.cursor]
    if ((action === 'left' || action === 'right') && focusedItem?.kind === 'module') {
      const module = state.modules.find(({ id }) => id === focusedItem.moduleId)
      if (module && module.configChoices.length > 1) {
        const current = state.moduleConfigIndexes.get(module.id) ?? 0
        const direction = action === 'left' ? -1 : 1
        return { kind: 'state', state: configureModule(module.id, (current + direction + module.configChoices.length) % module.configChoices.length) }
      }
    }
    if ((action === 'up' || action === 'down' || action === 'page-previous' || action === 'page-next') && state.items.length > 0) {
      const direction = action === 'up' || action === 'page-previous' ? -1 : 1
      return { kind: 'state', state: focus((state.cursor + direction + state.items.length) % state.items.length) }
    }
    if (action === 'cancel' || action === 'menu') return { kind: 'cancelled', state: close() }
    if (action !== 'confirm') return { kind: 'ignored' }
    const item = state.items[state.cursor]
    if (!item) return { kind: 'ignored' }
    if (item.kind === 'source') state = { ...state, sourceSlot: item.slot }
    if (item.kind === 'target') state = { ...state, targetSlot: item.slot }
    if (item.kind === 'module') {
      const enabledModuleIds = new Set(state.enabledModuleIds)
      if (enabledModuleIds.has(item.moduleId)) enabledModuleIds.delete(item.moduleId)
      else enabledModuleIds.add(item.moduleId)
      state = { ...state, enabledModuleIds }
    }
    if (item.kind === 'cancel') return { kind: 'cancelled', state: close() }
    if (item.kind === 'submit') {
      if (state.sourceSlot === undefined || state.targetSlot === undefined) return { kind: 'state', state }
      const selection = {
        sourceSlot: state.sourceSlot,
        targetSlot: state.targetSlot,
        modules: state.modules.filter(({ id }) => state.enabledModuleIds.has(id)).map(({ id, configChoices }) => ({
          id,
          config: configChoices[state.moduleConfigIndexes.get(id) ?? 0]!.config,
        })),
      }
      // La validation finale dépend du registre et du runtime hôte. Le draft
      // reste propriétaire du contrôleur jusqu'à leur confirmation explicite.
      return { kind: 'created', selection, state }
    }
    return { kind: 'state', state }
  }
  return { getState: () => state, open, close, resolveCreation, focus, configureModule, handle }
}
