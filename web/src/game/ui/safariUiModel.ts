import type { GameDigitalAction } from '../../gameInput'
import type { HgssSafariDecoratorUnavailableReason } from '../safari/hgssSafariFieldCommands'
import {
  HGSS_SAFARI_AREA_COUNT,
  HGSS_SAFARI_AREAS_PER_SET,
  HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
  HGSS_SAFARI_OBJECT_COUNT,
  type HgssSafariAreaId,
  type HgssSafariAreaSlot,
  type HgssSafariObjectCategoryCounts,
  type HgssSafariObjectId,
} from '../safari/hgssSafariState'

export type SafariAreaArrangement = readonly [
  HgssSafariAreaId,
  HgssSafariAreaId,
  HgssSafariAreaId,
  HgssSafariAreaId,
  HgssSafariAreaId,
  HgssSafariAreaId,
]

export type SafariCustomizerBlockCounts = readonly [
  HgssSafariObjectCategoryCounts,
  HgssSafariObjectCategoryCounts,
  HgssSafariObjectCategoryCounts,
  HgssSafariObjectCategoryCounts,
  HgssSafariObjectCategoryCounts,
  HgssSafariObjectCategoryCounts,
]

export type SafariCustomizerPhase = 'slots' | 'menu' | 'areas' | 'order' | 'confirmation'
export type SafariCustomizerOperation = 'replace' | 'swap'

export type SafariCustomizerPendingChange = {
  areas: SafariAreaArrangement
  sourceSlot: HgssSafariAreaSlot
  targetAreaId: HgssSafariAreaId
  operation: SafariCustomizerOperation
  swappedSlot?: HgssSafariAreaSlot
}

export type SafariCustomizerModel = {
  phase: SafariCustomizerPhase
  areas: SafariAreaArrangement
  blockCounts: SafariCustomizerBlockCounts
  showBlockCounts: boolean
  slotCursor: HgssSafariAreaSlot
  orderCursor: HgssSafariAreaSlot
  areaCursor: HgssSafariAreaId
  /** Les indices natifs 6/7/8 partagent la même case RETOUR. */
  returnColumn?: 0 | 1 | 2
  menuCursor: 0 | 1 | 2
  confirmationCursor: 0 | 1
  pendingChange?: SafariCustomizerPendingChange
}

export type SafariCustomizerEffect =
  | { kind: 'commit', change: SafariCustomizerPendingChange }
  | { kind: 'close' }

export type SafariCustomizerAction =
  | { kind: 'input', action: GameDigitalAction }
  | { kind: 'focus-slot', slot: number }
  | { kind: 'activate-slot', slot: number }
  | { kind: 'focus-menu', choice: number }
  | { kind: 'activate-menu', choice: number }
  | { kind: 'focus-area', areaId: number }
  | { kind: 'activate-area', areaId: number }
  | { kind: 'focus-order-slot', slot: number }
  | { kind: 'activate-order-slot', slot: number }
  | { kind: 'focus-return', column?: number }
  | { kind: 'activate-return' }
  | { kind: 'focus-confirmation', choice: number }
  | { kind: 'activate-confirmation', choice: number }

export type SafariCustomizerUpdate = {
  model: SafariCustomizerModel
  effect?: SafariCustomizerEffect
  handled: boolean
}

export type SafariDecoratorPhase = 'objects' | 'confirmation' | 'notice'

/** Codes renvoyés par `ov108_021EA52C` avant l'ouverture de la confirmation. */
export type SafariDecoratorChoice = {
  objectId: HgssSafariObjectId
  unavailableReason?: HgssSafariDecoratorUnavailableReason
}

export type SafariDecoratorChoiceInput = number | {
  objectId: number
  unavailableReason?: number
}

export type SafariDecoratorModel = {
  phase: SafariDecoratorPhase
  choices: readonly SafariDecoratorChoice[]
  objectIds: readonly HgssSafariObjectId[]
  cursor: number
  /** Les deux indices natifs 6/7 partagent la même case RETOUR. */
  returnColumn?: 0 | 1
  confirmationCursor: 0 | 1
  noticeReason?: HgssSafariDecoratorUnavailableReason
}

export type SafariDecoratorEffect =
  | { kind: 'select', objectId: HgssSafariObjectId }
  | { kind: 'close' }

export type SafariDecoratorAction =
  | { kind: 'input', action: GameDigitalAction }
  | { kind: 'focus-object', index: number }
  | { kind: 'activate-object', index: number }
  | { kind: 'focus-return', column?: number }
  | { kind: 'activate-return' }
  | { kind: 'focus-confirmation', choice: number }
  | { kind: 'activate-confirmation', choice: number }

export type SafariDecoratorUpdate = {
  model: SafariDecoratorModel
  effect?: SafariDecoratorEffect
  handled: boolean
}

type GridDirection = Extract<GameDigitalAction, 'up' | 'down' | 'left' | 'right'>
export const HGSS_SAFARI_OBJECTS_PER_PAGE = 6 as const
export const HGSS_SAFARI_OBJECT_COLUMNS = 2 as const

function requireInteger(value: number, min: number, max: number, label: string): number {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new Error(`${label} ${value} is outside ${min}..${max}.`)
  }
  return value
}

function requireAreaId(value: number): HgssSafariAreaId {
  return requireInteger(value, 0, HGSS_SAFARI_AREA_COUNT - 1, 'Safari area') as HgssSafariAreaId
}

function requireAreaSlot(value: number): HgssSafariAreaSlot {
  return requireInteger(value, 0, HGSS_SAFARI_AREAS_PER_SET - 1, 'Safari slot') as HgssSafariAreaSlot
}

function requireObjectId(value: number): HgssSafariObjectId {
  return requireInteger(value, 0, HGSS_SAFARI_OBJECT_COUNT - 1, 'Safari object') as HgssSafariObjectId
}

function requireChoice(value: number): 0 | 1 {
  return requireInteger(value, 0, 1, 'Safari confirmation choice') as 0 | 1
}

/** OUI is always the left/top choice and NON the right/bottom choice. */
function moveSafariConfirmationCursor(direction: GridDirection): 0 | 1 {
  return direction === 'left' || direction === 'up' ? 0 : 1
}

function requireMenuChoice(value: number): 0 | 1 | 2 {
  return requireInteger(value, 0, 2, 'Safari customizer menu choice') as 0 | 1 | 2
}

function requireCustomizerReturnColumn(value: number): 0 | 1 | 2 {
  return requireInteger(value, 0, 2, 'Safari customizer return column') as 0 | 1 | 2
}

function requireUnavailableReason(value: number): HgssSafariDecoratorUnavailableReason {
  return requireInteger(value, 1, 4, 'Safari unavailable reason') as HgssSafariDecoratorUnavailableReason
}

function copyArrangement(areas: readonly number[]): SafariAreaArrangement {
  if (areas.length !== HGSS_SAFARI_AREAS_PER_SET) {
    throw new Error(`Safari arrangement has ${areas.length} slots instead of ${HGSS_SAFARI_AREAS_PER_SET}.`)
  }
  const copy = areas.map(requireAreaId)
  return copy as unknown as SafariAreaArrangement
}

function zeroObjectCategoryCounts(): HgssSafariObjectCategoryCounts {
  return [0, 0, 0, 0, 0]
}

function copyBlockCounts(counts?: readonly (readonly number[])[]): SafariCustomizerBlockCounts {
  if (counts === undefined) {
    return Array.from({ length: HGSS_SAFARI_AREAS_PER_SET }, zeroObjectCategoryCounts) as unknown as SafariCustomizerBlockCounts
  }
  if (counts.length !== HGSS_SAFARI_AREAS_PER_SET) {
    throw new Error(`Safari block counter set has ${counts.length} slots instead of ${HGSS_SAFARI_AREAS_PER_SET}.`)
  }
  return counts.map((values, slot) => {
    if (values.length !== 5) throw new Error(`Safari block counter slot ${slot} has ${values.length} categories instead of 5.`)
    return values.map((value, category) => requireInteger(
      value,
      0,
      HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
      `Safari block counter ${slot}:${category}`,
    )) as HgssSafariObjectCategoryCounts
  }) as unknown as SafariCustomizerBlockCounts
}

/** Moves within a wrapping grid while keeping partial final rows reachable. */
export function moveSafariGridCursor(
  cursor: number,
  count: number,
  columns: number,
  direction: GridDirection,
): number {
  requireInteger(count, 1, Number.MAX_SAFE_INTEGER, 'Safari grid count')
  requireInteger(columns, 1, count, 'Safari grid columns')
  requireInteger(cursor, 0, count - 1, 'Safari grid cursor')
  const row = Math.floor(cursor / columns)
  const column = cursor % columns
  const rowStart = row * columns
  const rowLength = Math.min(columns, count - rowStart)
  if (direction === 'left') return rowStart + ((column - 1 + rowLength) % rowLength)
  if (direction === 'right') return rowStart + ((column + 1) % rowLength)

  const rowCount = Math.ceil(count / columns)
  const delta = direction === 'up' ? -1 : 1
  for (let offset = 1; offset <= rowCount; offset += 1) {
    const nextRow = (row + delta * offset + rowCount * offset) % rowCount
    const candidate = nextRow * columns + column
    if (candidate < count) return candidate
  }
  return cursor
}

export function createSafariCustomizerModel(
  areas: readonly number[],
  blockCounts?: readonly (readonly number[])[],
  showBlockCounts = false,
): SafariCustomizerModel {
  const arrangement = copyArrangement(areas)
  return {
    phase: 'slots',
    areas: arrangement,
    blockCounts: copyBlockCounts(blockCounts),
    showBlockCounts,
    slotCursor: 0,
    orderCursor: 0,
    areaCursor: arrangement[0],
    menuCursor: 0,
    confirmationCursor: 1,
  }
}

function focusCustomizerSlot(model: SafariCustomizerModel, slotValue: number): SafariCustomizerModel {
  const slot = requireAreaSlot(slotValue)
  return { ...model, slotCursor: slot, areaCursor: model.areas[slot], returnColumn: undefined }
}

function focusCustomizerArea(model: SafariCustomizerModel, areaValue: number): SafariCustomizerModel {
  return { ...model, areaCursor: requireAreaId(areaValue), returnColumn: undefined }
}

function focusCustomizerMenu(model: SafariCustomizerModel, choiceValue: number): SafariCustomizerModel {
  return { ...model, menuCursor: requireMenuChoice(choiceValue) }
}

function focusCustomizerOrderSlot(model: SafariCustomizerModel, slotValue: number): SafariCustomizerModel {
  return { ...model, orderCursor: requireAreaSlot(slotValue), returnColumn: undefined }
}

function focusCustomizerReturn(
  model: SafariCustomizerModel,
  columnValue = model.phase === 'areas' ? model.areaCursor % 3 : model.phase === 'order' ? model.orderCursor % 3 : model.slotCursor % 3,
): SafariCustomizerModel {
  return { ...model, returnColumn: requireCustomizerReturnColumn(columnValue) }
}

function createReplacementChange(model: SafariCustomizerModel): SafariCustomizerPendingChange | undefined {
  const sourceSlot = model.slotCursor
  const currentAreaId = model.areas[sourceSlot]
  const targetAreaId = model.areaCursor
  if (currentAreaId === targetAreaId) return undefined
  const areas = [...model.areas] as HgssSafariAreaId[]
  areas[sourceSlot] = targetAreaId
  return {
    areas: copyArrangement(areas),
    sourceSlot,
    targetAreaId,
    operation: 'replace',
  }
}

function createOrderChange(model: SafariCustomizerModel): SafariCustomizerPendingChange | undefined {
  const sourceSlot = model.slotCursor
  const swappedSlot = model.orderCursor
  if (sourceSlot === swappedSlot) return undefined
  const areas = [...model.areas] as HgssSafariAreaId[]
  const targetAreaId = areas[swappedSlot]!
  const sourceAreaId = areas[sourceSlot]!
  areas[sourceSlot] = targetAreaId
  areas[swappedSlot] = sourceAreaId
  return {
    areas: copyArrangement(areas),
    sourceSlot,
    targetAreaId,
    operation: 'swap',
    swappedSlot,
  }
}

function commitCustomizerChange(
  model: SafariCustomizerModel,
  change: SafariCustomizerPendingChange,
): SafariCustomizerUpdate {
  const blockCounts = copyBlockCounts(model.blockCounts)
  const mutableCounts = blockCounts as unknown as HgssSafariObjectCategoryCounts[]
  if (change.operation === 'replace') {
    mutableCounts[change.sourceSlot] = zeroObjectCategoryCounts()
  } else if (change.swappedSlot !== undefined) {
    const sourceCounts = mutableCounts[change.sourceSlot]!
    mutableCounts[change.sourceSlot] = mutableCounts[change.swappedSlot]!
    mutableCounts[change.swappedSlot] = sourceCounts
  }
  return {
    model: {
      ...model,
      phase: 'slots',
      areas: change.areas,
      blockCounts,
      areaCursor: change.areas[change.sourceSlot],
      orderCursor: change.sourceSlot,
      confirmationCursor: 1,
      returnColumn: undefined,
      pendingChange: undefined,
    },
    effect: { kind: 'commit', change },
    handled: true,
  }
}

function activateCustomizerSlot(model: SafariCustomizerModel, slotValue: number = model.slotCursor): SafariCustomizerUpdate {
  const focused = focusCustomizerSlot(model, slotValue)
  return { model: { ...focused, phase: 'menu', menuCursor: 0, returnColumn: undefined }, handled: true }
}

function activateCustomizerMenu(model: SafariCustomizerModel, choiceValue: number = model.menuCursor): SafariCustomizerUpdate {
  const focused = focusCustomizerMenu(model, choiceValue)
  if (focused.menuCursor === 0) {
    return {
      model: { ...focused, phase: 'areas', areaCursor: focused.areas[focused.slotCursor] },
      handled: true,
    }
  }
  if (focused.menuCursor === 1) {
    return {
      model: { ...focused, phase: 'order', orderCursor: focused.slotCursor },
      handled: true,
    }
  }
  return { model: { ...focused, phase: 'slots', returnColumn: undefined }, handled: true }
}

function activateCustomizerArea(model: SafariCustomizerModel, areaValue: number = model.areaCursor): SafariCustomizerUpdate {
  const focused = focusCustomizerArea(model, areaValue)
  const pendingChange = createReplacementChange(focused)
  if (!pendingChange) return { model: { ...focused, phase: 'areas', returnColumn: undefined }, handled: true }
  if (!focused.showBlockCounts) return commitCustomizerChange(focused, pendingChange)
  return {
    model: { ...focused, phase: 'confirmation', confirmationCursor: 1, pendingChange },
    handled: true,
  }
}

function activateCustomizerOrderSlot(
  model: SafariCustomizerModel,
  slotValue: number = model.orderCursor,
): SafariCustomizerUpdate {
  const focused = focusCustomizerOrderSlot(model, slotValue)
  const change = createOrderChange(focused)
  return change
    ? commitCustomizerChange(focused, change)
    : { model: { ...focused, phase: 'slots', returnColumn: undefined }, handled: true }
}

function activateCustomizerConfirmation(model: SafariCustomizerModel, choiceValue: number = model.confirmationCursor): SafariCustomizerUpdate {
  const choice = requireChoice(choiceValue)
  if (choice === 1 || !model.pendingChange) {
    return {
      model: { ...model, phase: 'areas', confirmationCursor: 1, pendingChange: undefined },
      handled: true,
    }
  }
  return commitCustomizerChange(model, model.pendingChange)
}

function customizerInput(model: SafariCustomizerModel, action: GameDigitalAction): SafariCustomizerUpdate {
  if (action === 'cancel') {
    if (model.phase === 'confirmation') {
      return { model: { ...model, phase: 'areas', pendingChange: undefined }, handled: true }
    }
    if (model.phase === 'areas' || model.phase === 'order') {
      return { model: { ...model, phase: 'slots', pendingChange: undefined, returnColumn: undefined }, handled: true }
    }
    if (model.phase === 'menu') return { model: { ...model, phase: 'slots' }, handled: true }
    return { model, effect: { kind: 'close' }, handled: true }
  }
  if (action === 'confirm') {
    if (model.returnColumn !== undefined) {
      if (model.phase === 'slots') return { model, effect: { kind: 'close' }, handled: true }
      if (model.phase === 'areas' || model.phase === 'order') {
        return { model: { ...model, phase: 'slots', returnColumn: undefined }, handled: true }
      }
    }
    if (model.phase === 'slots') return activateCustomizerSlot(model)
    if (model.phase === 'menu') return activateCustomizerMenu(model)
    if (model.phase === 'areas') return activateCustomizerArea(model)
    if (model.phase === 'order') return activateCustomizerOrderSlot(model)
    return activateCustomizerConfirmation(model)
  }
  if (action === 'page-previous' || action === 'page-next') {
    const delta = action === 'page-previous' ? -1 : 1
    if (model.phase === 'areas') {
      const page = Math.floor(model.areaCursor / HGSS_SAFARI_AREAS_PER_SET)
      const nextPage = Math.max(0, Math.min(1, page + delta))
      if (nextPage === page) return { model, handled: true }
      const next = requireAreaId(nextPage * HGSS_SAFARI_AREAS_PER_SET + model.areaCursor % HGSS_SAFARI_AREAS_PER_SET)
      return {
        model: model.returnColumn === undefined
          ? focusCustomizerArea(model, next)
          : { ...model, areaCursor: next },
        handled: true,
      }
    }
  }
  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    if (model.phase === 'slots' || model.phase === 'order') {
      const cursor = model.phase === 'order' ? model.orderCursor : model.slotCursor
      const column = model.returnColumn ?? (cursor % 3) as 0 | 1 | 2
      if (model.returnColumn !== undefined) {
        if (action === 'left' || action === 'right') return { model, handled: true }
        const target = action === 'up' ? 3 + column : column
        return {
          model: model.phase === 'order'
            ? focusCustomizerOrderSlot(model, target)
            : focusCustomizerSlot(model, target),
          handled: true,
        }
      }
      if ((action === 'up' && cursor < 3) || (action === 'down' && cursor >= 3)) {
        return { model: focusCustomizerReturn(model, column), handled: true }
      }
      const next = moveSafariGridCursor(cursor, HGSS_SAFARI_AREAS_PER_SET, 3, action)
      return {
        model: model.phase === 'order'
          ? focusCustomizerOrderSlot(model, next)
          : focusCustomizerSlot(model, next),
        handled: true,
      }
    }
    if (model.phase === 'menu') {
      const delta = action === 'up' || action === 'left' ? -1 : 1
      const next = (model.menuCursor + delta + 3) % 3
      return { model: focusCustomizerMenu(model, next), handled: true }
    }
    if (model.phase === 'areas') {
      const pageStart = Math.floor(model.areaCursor / HGSS_SAFARI_AREAS_PER_SET) * HGSS_SAFARI_AREAS_PER_SET
      const localCursor = model.areaCursor - pageStart
      const column = model.returnColumn ?? (localCursor % 3) as 0 | 1 | 2
      if (model.returnColumn !== undefined) {
        if (action === 'left' || action === 'right') return { model, handled: true }
        const target = action === 'up' ? 3 + column : column
        return { model: focusCustomizerArea(model, pageStart + target), handled: true }
      }
      if ((action === 'up' && localCursor < 3) || (action === 'down' && localCursor >= 3)) {
        return { model: focusCustomizerReturn(model, column), handled: true }
      }
      if (action === 'up' || action === 'down') {
        return {
          model: focusCustomizerArea(model, model.areaCursor + (action === 'up' ? -3 : 3)),
          handled: true,
        }
      }
      // The two six-area pages meet only at their native 5/6 boundary. All
      // other horizontal moves stay on the visible row instead of jumping
      // diagonally to the following row.
      if (action === 'right' && model.areaCursor === HGSS_SAFARI_AREAS_PER_SET - 1) {
        return { model: focusCustomizerArea(model, HGSS_SAFARI_AREAS_PER_SET), handled: true }
      }
      if (action === 'left' && model.areaCursor === HGSS_SAFARI_AREAS_PER_SET) {
        return { model: focusCustomizerArea(model, HGSS_SAFARI_AREAS_PER_SET - 1), handled: true }
      }
      const next = pageStart + moveSafariGridCursor(
        localCursor,
        HGSS_SAFARI_AREAS_PER_SET,
        3,
        action,
      )
      return { model: focusCustomizerArea(model, next), handled: true }
    }
    return {
      model: { ...model, confirmationCursor: moveSafariConfirmationCursor(action) },
      handled: true,
    }
  }
  return { model, handled: false }
}

export function updateSafariCustomizer(
  model: SafariCustomizerModel,
  action: SafariCustomizerAction,
): SafariCustomizerUpdate {
  if (action.kind === 'input') return customizerInput(model, action.action)
  if (action.kind === 'focus-slot') return { model: focusCustomizerSlot(model, action.slot), handled: true }
  if (action.kind === 'activate-slot') return activateCustomizerSlot(model, action.slot)
  if (action.kind === 'focus-menu') return { model: focusCustomizerMenu(model, action.choice), handled: true }
  if (action.kind === 'activate-menu') return activateCustomizerMenu(model, action.choice)
  if (action.kind === 'focus-area') return { model: focusCustomizerArea(model, action.areaId), handled: true }
  if (action.kind === 'activate-area') return activateCustomizerArea(model, action.areaId)
  if (action.kind === 'focus-order-slot') {
    return { model: focusCustomizerOrderSlot(model, action.slot), handled: true }
  }
  if (action.kind === 'activate-order-slot') return activateCustomizerOrderSlot(model, action.slot)
  if (action.kind === 'focus-return') {
    return { model: focusCustomizerReturn(model, action.column), handled: true }
  }
  if (action.kind === 'activate-return') {
    if (model.phase === 'slots') return { model, effect: { kind: 'close' }, handled: true }
    return { model: { ...model, phase: 'slots', returnColumn: undefined }, handled: true }
  }
  if (action.kind === 'focus-confirmation') {
    return { model: { ...model, confirmationCursor: requireChoice(action.choice) }, handled: true }
  }
  return activateCustomizerConfirmation(model, action.choice)
}

function normalizeDecoratorChoice(input: SafariDecoratorChoiceInput): SafariDecoratorChoice {
  if (typeof input === 'number') return { objectId: requireObjectId(input) }
  return {
    objectId: requireObjectId(input.objectId),
    unavailableReason: input.unavailableReason === undefined
      ? undefined
      : requireUnavailableReason(input.unavailableReason),
  }
}

export function createSafariDecoratorModel(
  inputs: readonly SafariDecoratorChoiceInput[],
  initialCursor = 0,
): SafariDecoratorModel {
  const choices = inputs.map(normalizeDecoratorChoice)
  const ids = choices.map(({ objectId }) => objectId)
  if (new Set(ids).size !== ids.length) throw new Error('Safari object selector contains duplicate objects.')
  const cursor = ids.length === 0
    ? 0
    : requireInteger(initialCursor, 0, ids.length - 1, 'Safari object cursor')
  return {
    phase: 'objects',
    choices,
    objectIds: ids,
    cursor,
    confirmationCursor: 1,
    // An empty catalogue still exposes its native RETOUR command to A/Enter.
    returnColumn: ids.length === 0 ? 0 : undefined,
  }
}

function focusDecoratorObject(model: SafariDecoratorModel, indexValue: number): SafariDecoratorModel {
  if (model.objectIds.length === 0) return model
  const index = requireInteger(indexValue, 0, model.objectIds.length - 1, 'Safari object cursor')
  return { ...model, cursor: index, returnColumn: undefined }
}

function focusDecoratorReturn(model: SafariDecoratorModel, columnValue = model.cursor % HGSS_SAFARI_OBJECT_COLUMNS): SafariDecoratorModel {
  const column = requireInteger(columnValue, 0, 1, 'Safari return column') as 0 | 1
  return { ...model, returnColumn: column }
}

function activateDecoratorObject(model: SafariDecoratorModel, indexValue = model.cursor): SafariDecoratorUpdate {
  if (model.returnColumn !== undefined) return { model, effect: { kind: 'close' }, handled: true }
  if (model.objectIds.length === 0) return { model, handled: true }
  const focused = focusDecoratorObject(model, indexValue)
  const reason = focused.choices[focused.cursor]?.unavailableReason
  if (reason !== undefined) {
    return {
      model: { ...focused, phase: 'notice', noticeReason: reason },
      handled: true,
    }
  }
  return { model: { ...focused, phase: 'confirmation', confirmationCursor: 1 }, handled: true }
}

function activateDecoratorConfirmation(model: SafariDecoratorModel, choiceValue: number = model.confirmationCursor): SafariDecoratorUpdate {
  const choice = requireChoice(choiceValue)
  if (choice === 1 || model.objectIds.length === 0) {
    return { model: { ...model, phase: 'objects', confirmationCursor: 1 }, handled: true }
  }
  const objectId = model.objectIds[model.cursor]
  if (objectId === undefined) return { model: { ...model, phase: 'objects' }, handled: true }
  return {
    model: { ...model, phase: 'objects', confirmationCursor: 1, noticeReason: undefined },
    effect: { kind: 'select', objectId },
    handled: true,
  }
}

function decoratorInput(model: SafariDecoratorModel, action: GameDigitalAction): SafariDecoratorUpdate {
  if (model.phase === 'notice') {
    if (action === 'confirm' || action === 'cancel' || action === 'up' || action === 'down'
      || action === 'left' || action === 'right' || action === 'page-previous' || action === 'page-next') {
      return { model: { ...model, phase: 'objects', noticeReason: undefined }, handled: true }
    }
    return { model, handled: false }
  }
  if (action === 'cancel') {
    if (model.phase === 'confirmation') {
      return { model: { ...model, phase: 'objects', confirmationCursor: 1 }, handled: true }
    }
    return { model, effect: { kind: 'close' }, handled: true }
  }
  if (action === 'confirm') {
    if (model.phase === 'objects' && model.returnColumn !== undefined) {
      return { model, effect: { kind: 'close' }, handled: true }
    }
    return model.phase === 'objects' ? activateDecoratorObject(model) : activateDecoratorConfirmation(model)
  }
  if (action === 'page-previous' || action === 'page-next') {
    if (model.phase !== 'objects' || model.objectIds.length === 0) return { model, handled: false }
    const delta = action === 'page-previous' ? -1 : 1
    const pageCount = Math.ceil(model.objectIds.length / HGSS_SAFARI_OBJECTS_PER_PAGE)
    const currentPage = Math.floor(model.cursor / HGSS_SAFARI_OBJECTS_PER_PAGE)
    const nextPage = Math.max(0, Math.min(pageCount - 1, currentPage + delta))
    if (nextPage === currentPage) return { model, handled: true }
    const pageLength = Math.min(
      HGSS_SAFARI_OBJECTS_PER_PAGE,
      model.objectIds.length - nextPage * HGSS_SAFARI_OBJECTS_PER_PAGE,
    )
    const next = nextPage * HGSS_SAFARI_OBJECTS_PER_PAGE
      + Math.min(model.cursor % HGSS_SAFARI_OBJECTS_PER_PAGE, pageLength - 1)
    return {
      model: model.returnColumn === undefined
        ? focusDecoratorObject(model, next)
        : { ...model, cursor: next },
      handled: true,
    }
  }
  if (action === 'up' || action === 'down' || action === 'left' || action === 'right') {
    if (model.phase === 'confirmation') {
      return {
        model: { ...model, confirmationCursor: moveSafariConfirmationCursor(action) },
        handled: true,
      }
    }
    if (model.objectIds.length === 0) return { model, handled: true }
    const pageStart = Math.floor(model.cursor / HGSS_SAFARI_OBJECTS_PER_PAGE) * HGSS_SAFARI_OBJECTS_PER_PAGE
    const pageLength = Math.min(HGSS_SAFARI_OBJECTS_PER_PAGE, model.objectIds.length - pageStart)
    const localCursor = model.cursor - pageStart
    const column = model.returnColumn ?? (localCursor % HGSS_SAFARI_OBJECT_COLUMNS) as 0 | 1
    if (model.returnColumn !== undefined) {
      if (action === 'left' || action === 'right') return { model, handled: true }
      const localTarget = action === 'up' ? 4 + column : column
      const target = pageStart + Math.min(localTarget, pageLength - 1)
      return { model: focusDecoratorObject(model, target), handled: true }
    }
    if (action === 'up') {
      if (localCursor < HGSS_SAFARI_OBJECT_COLUMNS) {
        return { model: focusDecoratorReturn(model, column), handled: true }
      }
      return { model: focusDecoratorObject(model, model.cursor - HGSS_SAFARI_OBJECT_COLUMNS), handled: true }
    }
    if (action === 'down') {
      const target = model.cursor + HGSS_SAFARI_OBJECT_COLUMNS
      if (localCursor >= 4 || target >= pageStart + pageLength) {
        return { model: focusDecoratorReturn(model, column), handled: true }
      }
      return { model: focusDecoratorObject(model, target), handled: true }
    }
    const horizontalTarget = model.cursor + (action === 'left' ? -1 : 1)
    const targetOnSameRow = horizontalTarget >= pageStart
      && horizontalTarget < pageStart + pageLength
      && Math.floor((horizontalTarget - pageStart) / HGSS_SAFARI_OBJECT_COLUMNS)
        === Math.floor(localCursor / HGSS_SAFARI_OBJECT_COLUMNS)
    if (targetOnSameRow) {
      return { model: focusDecoratorObject(model, horizontalTarget), handled: true }
    }
    // A missing cell on a partial final row is a real edge, just like the
    // outer column of a complete row. Page navigation clamps on the last page.
    return decoratorInput(model, action === 'left' ? 'page-previous' : 'page-next')
  }
  return { model, handled: false }
}

export function updateSafariDecorator(model: SafariDecoratorModel, action: SafariDecoratorAction): SafariDecoratorUpdate {
  if (action.kind === 'input') return decoratorInput(model, action.action)
  if (model.phase === 'notice') {
    return { model: { ...model, phase: 'objects', noticeReason: undefined }, handled: true }
  }
  if (action.kind === 'focus-object') {
    return { model: focusDecoratorObject(model, action.index), handled: true }
  }
  if (action.kind === 'activate-object') return activateDecoratorObject(model, action.index)
  if (action.kind === 'focus-return') {
    return { model: focusDecoratorReturn(model, action.column), handled: true }
  }
  if (action.kind === 'activate-return') return { model, effect: { kind: 'close' }, handled: true }
  if (action.kind === 'focus-confirmation') {
    return { model: { ...model, confirmationCursor: requireChoice(action.choice) }, handled: true }
  }
  return activateDecoratorConfirmation(model, action.choice)
}
