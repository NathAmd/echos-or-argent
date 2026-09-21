import type { GameDigitalAction } from '../../gameInput'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssSafariCellSpriteAsset, HgssSafariUiAssets } from '../../rom/safari/safariUiAssets'
import type { HgssSafariAreaId, HgssSafariObjectId } from '../safari/hgssSafariState'
import { createNitroCellSprite } from './nitroCellSpritePresentation'
import { formatHgssRomMessage } from './romMessageFormatting'
import {
  HGSS_SAFARI_OBJECTS_PER_PAGE,
  createSafariCustomizerModel,
  createSafariDecoratorModel,
  updateSafariCustomizer,
  updateSafariDecorator,
  type SafariCustomizerAction,
  type SafariCustomizerModel,
  type SafariCustomizerPendingChange,
  type SafariDecoratorAction,
  type SafariDecoratorChoiceInput,
  type SafariDecoratorModel,
} from './safariUiModel'

export type SafariUiMessageBanks = Readonly<Record<number, Readonly<Record<number, string>>>>

export const hgssSafariUiSoundEffects = {
  select: 1500,
  cursor: 1509,
  page: 1505,
  yesNo: 1508,
  unavailable: 1523,
  orderDestination: 1692,
} as const

export type SafariUiRomText = {
  customizer: {
    prompt: string
    exchangePrompt: string
    destinationPrompt: string
    replacementPrompt: string
    returnLabel: string
    cancelLabel: string
    exchangeLabel: string
    orderLabel: string
    yesLabel: string
    noLabel: string
    pageTemplate: string
    countLabels: readonly string[]
    countTemplate: string
    areaNames: readonly string[]
  }
  decorator: {
    placePromptTemplate: string
    returnLabel: string
    yesLabel: string
    noLabel: string
    noObjects: string
    pageTemplate: string
    unavailableMessages: readonly string[]
    objectNames: readonly string[]
    objectDescriptions: readonly string[]
  }
}

export type SafariCustomizerControllerOptions = {
  assets: HgssSafariUiAssets
  messageBanks: SafariUiMessageBanks
  initialAreas: readonly HgssSafariAreaId[]
  initialBlockCounts?: readonly (readonly number[])[]
  showBlockCounts?: boolean
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playSoundEffect?: (sequenceId: number) => void
  onCommit: (change: SafariCustomizerPendingChange) => void
  onClose: () => void
  onSelectionChange?: (model: SafariCustomizerModel) => void
}

export type SafariCustomizerController = {
  open: (
    areas?: readonly HgssSafariAreaId[],
    blockCounts?: readonly (readonly number[])[],
    showBlockCounts?: boolean,
  ) => void
  close: () => void
  isOpen: () => boolean
  handle: (action: GameDigitalAction) => boolean
  getModel: () => SafariCustomizerModel
}

export type SafariDecoratorControllerOptions = {
  assets: HgssSafariUiAssets
  messageBanks: SafariUiMessageBanks
  objectIds?: readonly HgssSafariObjectId[]
  candidates?: readonly SafariDecoratorChoiceInput[]
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playSoundEffect?: (sequenceId: number) => void
  createObjectPreview?: (
    objectId: HgssSafariObjectId,
    nativeSprites: HgssSafariCellSpriteAsset,
  ) => HTMLElement | undefined
  onSelect: (objectId: HgssSafariObjectId) => void
  onClose: () => void
  onSelectionChange?: (model: SafariDecoratorModel) => void
}

export type SafariDecoratorController = {
  open: (candidates?: readonly SafariDecoratorChoiceInput[]) => void
  close: () => void
  isOpen: () => boolean
  handle: (action: GameDigitalAction) => boolean
  getModel: () => SafariDecoratorModel
}

type NativePageControls = {
  root: HTMLElement
  previous: HTMLButtonElement
  next: HTMLButtonElement
  label: HTMLElement
}

type CustomizerView = {
  prompt: HTMLElement
  sidePanel: HTMLElement
  lockedBackdrop: HTMLElement
  unlockedBackdrop: HTMLElement
  slots: HTMLButtonElement[]
  slotGraphicHosts: HTMLElement[]
  slotNames: HTMLElement[]
  menuPanel: HTMLElement
  menuButtons: HTMLButtonElement[]
  areaPanel: HTMLElement
  areas: HTMLButtonElement[]
  pager: NativePageControls
  counters: HTMLElement
  counterValues: HTMLElement[]
  returnButton: HTMLButtonElement
  confirmation: HTMLElement
  confirmationPrompt: HTMLElement
  confirmationPreview: HTMLElement
  confirmationAccept: HTMLButtonElement
  confirmationAcceptLabel: HTMLElement
  confirmationCancel: HTMLButtonElement
}

type DecoratorView = {
  catalogBackdrop: HTMLElement
  placementBackdrop: HTMLElement
  catalogueBadge?: HTMLElement
  transitionBadge?: HTMLElement
  placementBadge?: HTMLElement
  grid: HTMLElement
  objects: HTMLButtonElement[]
  pager: NativePageControls
  detailPreview: HTMLElement
  detailName: HTMLElement
  detailDescription: HTMLElement
  empty: HTMLElement
  returnButton: HTMLButtonElement
  confirmation: HTMLElement
  confirmationPrompt: HTMLElement
  confirmationAccept: HTMLButtonElement
  confirmationAcceptLabel: HTMLElement
  confirmationCancel: HTMLButtonElement
  notice: HTMLElement
  noticeText: HTMLElement
}

function romText(template: string | undefined, values: readonly string[] = []): string {
  return formatHgssRomMessage(template ?? '', values).trim()
}

export function resolveSafariUiRomText(messageBanks: SafariUiMessageBanks): SafariUiRomText {
  const options = messageBanks[45]
  const standard = messageBanks[427]
  const customizer = messageBanks[429]
  const decorator = messageBanks[430]
  return {
    customizer: {
      prompt: romText(customizer?.[0]),
      exchangePrompt: romText(customizer?.[1]),
      destinationPrompt: romText(customizer?.[2]),
      replacementPrompt: romText(customizer?.[3]),
      returnLabel: romText(customizer?.[4]),
      cancelLabel: romText(customizer?.[6]),
      exchangeLabel: romText(customizer?.[7]),
      orderLabel: romText(customizer?.[8]),
      yesLabel: romText(options?.[12]),
      noLabel: romText(options?.[13]),
      pageTemplate: customizer?.[9] ?? '',
      countLabels: Array.from({ length: 5 }, (_, index) => romText(customizer?.[10 + index])),
      countTemplate: customizer?.[15] ?? '',
      areaNames: Array.from({ length: 12 }, (_, areaId) => romText(customizer?.[16 + areaId])),
    },
    decorator: {
      placePromptTemplate: decorator?.[0] ?? '',
      returnLabel: romText(decorator?.[8]),
      yesLabel: romText(options?.[12]),
      noLabel: romText(options?.[13]),
      noObjects: romText(standard?.[9]),
      pageTemplate: decorator?.[12] ?? '',
      unavailableMessages: Array.from({ length: 4 }, (_, index) => romText(decorator?.[4 + index])),
      objectNames: Array.from({ length: 24 }, (_, objectId) => romText(decorator?.[14 + objectId])),
      objectDescriptions: Array.from({ length: 24 }, (_, objectId) => romText(decorator?.[38 + objectId])),
    },
  }
}

function createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  return element
}

function appendKeycap(button: HTMLButtonElement, action: 'confirm' | 'cancel', fallback: string): void {
  const keycap = createElement('kbd', 'safari-ui-keycap')
  keycap.dataset.inputKey = action
  keycap.textContent = fallback
  button.append(keycap)
}

function createLabeledButton(className: string, label: string, action?: 'confirm' | 'cancel'): {
  button: HTMLButtonElement
  label: HTMLElement
} {
  const button = createElement('button', className)
  button.type = 'button'
  const labelElement = createElement('span', 'safari-ui-button-label')
  labelElement.textContent = label
  button.append(labelElement)
  if (action) appendKeycap(button, action, action === 'confirm' ? 'A' : 'B')
  return { button, label: labelElement }
}

function findBackgroundGraphic(
  groups: HgssSafariUiAssets['customizer']['backgroundGroups'],
  screenMemberId: number,
): NitroGraphic | undefined {
  return groups.flatMap(({ layers }) => layers).find((layer) => layer.screenMemberId === screenMemberId)?.graphic
}

function appendNativeLayerStack(
  root: HTMLElement,
  graphics: readonly (NitroGraphic | undefined)[],
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  className = '',
): HTMLElement {
  const stack = createElement('div', `safari-ui-native-stack ${className}`.trim())
  stack.setAttribute('aria-hidden', 'true')
  for (const graphic of graphics) {
    if (!graphic) continue
    const layer = createGraphic(graphic)
    layer.classList.add('safari-ui-native-layer')
    stack.append(layer)
  }
  root.append(stack)
  return stack
}

function createNativeSprite(
  asset: HgssSafariCellSpriteAsset,
  sequenceIndex: number,
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  className: string,
): HTMLElement | undefined {
  if (!asset.animation?.sequences?.[sequenceIndex]?.frames.length) return undefined
  return createNitroCellSprite(asset, sequenceIndex, createGraphic, `safari-ui-native-sprite ${className}`)
}

function appendNativeSprite(
  root: HTMLElement,
  asset: HgssSafariCellSpriteAsset,
  sequenceIndex: number,
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  className: string,
): HTMLElement | undefined {
  const sprite = createNativeSprite(asset, sequenceIndex, createGraphic, className)
  if (sprite) root.append(sprite)
  return sprite
}

function setCurrent(button: HTMLButtonElement, current: boolean): void {
  button.tabIndex = current ? 0 : -1
  button.setAttribute('aria-current', String(current))
}

function focusWithoutScroll(button: HTMLElement | undefined): void {
  button?.focus({ preventScroll: true })
}

function addGraphicLabel(button: HTMLButtonElement, graphic: HTMLElement | undefined, label: string): void {
  const graphicHost = createElement('span', 'safari-ui-card-graphic-host')
  const name = createElement('span', 'safari-ui-card-name')
  name.textContent = label
  if (graphic) {
    graphic.classList.add('safari-ui-card-graphic')
    graphic.setAttribute('aria-hidden', 'true')
    graphicHost.append(graphic)
  }
  button.append(graphicHost, name)
  if (label) button.setAttribute('aria-label', label)
}

function areaGraphic(
  areaId: HgssSafariAreaId,
  options: Pick<SafariCustomizerControllerOptions, 'assets' | 'createGraphic'>,
): HTMLElement | undefined {
  const preview = options.assets.customizer.areaPreviews.find((asset) => asset.areaId === areaId)
  if (!preview) return undefined
  if (preview.animation?.sequences?.[0]?.frames.length) {
    return createNitroCellSprite(preview, 0, options.createGraphic, 'safari-ui-area-preview')
  }
  return preview.frames[0] ? options.createGraphic(preview.frames[0]) : undefined
}

type PageSequenceSet = {
  previous: readonly [enabled: number, pressed: number, disabled: number]
  next: readonly [enabled: number, pressed: number, disabled: number]
}

function createNativePageControls(
  asset: HgssSafariCellSpriteAsset,
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  sequences: PageSequenceSet,
): NativePageControls {
  const root = createElement('nav', 'safari-ui-pager')
  const createPageButton = (direction: 'previous' | 'next'): HTMLButtonElement => {
    const button = createElement('button', `safari-ui-page-button is-${direction}`)
    button.type = 'button'
    button.dataset.safariPage = direction
    const variants = ['enabled', 'pressed', 'disabled'] as const
    variants.forEach((variant, index) => {
      appendNativeSprite(button, asset, sequences[direction][index], createGraphic, `safari-ui-page-${variant}`)
    })
    return button
  }
  const previous = createPageButton('previous')
  const label = createElement('span', 'safari-ui-page-label')
  const next = createPageButton('next')
  root.append(previous, label, next)
  return { root, previous, next, label }
}

function syncPageButton(button: HTMLButtonElement, enabled: boolean, label: string): void {
  button.disabled = !enabled
  button.dataset.pageState = enabled ? 'enabled' : 'disabled'
  button.setAttribute('aria-disabled', String(!enabled))
  button.setAttribute('aria-label', label)
}

function pulsePageButton(button: HTMLButtonElement): void {
  if (button.disabled) return
  button.dataset.pagePressed = 'true'
  const clear = () => { delete button.dataset.pagePressed }
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(clear)
  else clear()
}

function customizerCursorKey(model: SafariCustomizerModel): string {
  return `${model.phase}:${model.slotCursor}:${model.menuCursor}:${model.areaCursor}:${model.orderCursor}:${model.returnColumn ?? -1}:${model.confirmationCursor}`
}

function decoratorCursorKey(model: SafariDecoratorModel): string {
  return `${model.phase}:${model.cursor}:${model.returnColumn ?? -1}:${model.confirmationCursor}`
}

function buildCustomizerView(
  root: HTMLElement,
  options: SafariCustomizerControllerOptions,
  text: SafariUiRomText['customizer'],
): CustomizerView {
  const surface = createElement('div', 'safari-ui-surface')
  const header = createElement('header', 'safari-ui-header')
  const prompt = createElement('h2', 'safari-ui-prompt')
  header.append(prompt)

  const layout = createElement('div', 'safari-customizer-layout')
  const slotPanel = createElement('section', 'safari-customizer-slots')
  appendNativeLayerStack(slotPanel, [
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 7),
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 10),
  ], options.createGraphic, 'safari-ui-native-top')
  const slotGrid = createElement('div', 'safari-customizer-slot-grid')
  slotGrid.setAttribute('role', 'grid')
  const slotGraphicHosts: HTMLElement[] = []
  const slotNames: HTMLElement[] = []
  const slots = Array.from({ length: 6 }, (_, slot) => {
    const button = createElement('button', 'safari-ui-area-card safari-ui-slot-card')
    button.type = 'button'
    button.dataset.safariSlot = String(slot)
    button.setAttribute('role', 'gridcell')
    const graphicHost = createElement('span', 'safari-ui-card-graphic-host')
    const name = createElement('span', 'safari-ui-card-name')
    slotGraphicHosts.push(graphicHost)
    slotNames.push(name)
    button.append(graphicHost, name)
    appendNativeSprite(button, options.assets.customizer.objectSprites, 0, options.createGraphic, 'safari-ui-cursor-normal')
    appendNativeSprite(button, options.assets.customizer.objectSprites, 2, options.createGraphic, 'safari-ui-cursor-order-target')
    appendNativeSprite(button, options.assets.customizer.objectSprites, 3, options.createGraphic, 'safari-ui-cursor-order-source')
    slotGrid.append(button)
    return button
  })
  slotPanel.append(slotGrid)

  const sidePanel = createElement('section', 'safari-customizer-side')
  const lockedBackdrop = appendNativeLayerStack(sidePanel, [
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 3),
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 4),
  ], options.createGraphic, 'safari-ui-native-bottom safari-ui-native-locked')
  const unlockedBackdrop = appendNativeLayerStack(sidePanel, [
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 2),
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 4),
  ], options.createGraphic, 'safari-ui-native-bottom safari-ui-native-unlocked')

  const menuPanel = createElement('div', 'safari-customizer-menu')
  const menuButtons = [text.exchangeLabel, text.orderLabel, text.cancelLabel].map((label, choice) => {
    const control = createLabeledButton('safari-ui-action safari-customizer-menu-action', label)
    control.button.dataset.safariMenuChoice = String(choice)
    menuPanel.append(control.button)
    return control.button
  })

  const areaPanel = createElement('div', 'safari-customizer-catalog')
  appendNativeLayerStack(areaPanel, [
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 8),
    findBackgroundGraphic(options.assets.customizer.backgroundGroups, 9),
  ], options.createGraphic, 'safari-ui-native-catalog')
  const areaGrid = createElement('div', 'safari-customizer-area-grid')
  areaGrid.setAttribute('role', 'grid')
  const areas = Array.from({ length: 12 }, (_, areaValue) => {
    const areaId = areaValue as HgssSafariAreaId
    const button = createElement('button', 'safari-ui-area-card safari-ui-catalog-card')
    button.type = 'button'
    button.dataset.safariArea = String(areaId)
    button.setAttribute('role', 'gridcell')
    addGraphicLabel(button, areaGraphic(areaId, options), text.areaNames[areaId] ?? '')
    appendNativeSprite(button, options.assets.customizer.objectSprites, 0, options.createGraphic, 'safari-ui-cursor-normal')
    areaGrid.append(button)
    return button
  })
  const pager = createNativePageControls(options.assets.customizer.objectSprites, options.createGraphic, {
    previous: [4, 4, 6],
    next: [5, 5, 7],
  })
  areaPanel.append(areaGrid, pager.root)

  const counters = createElement('dl', 'safari-customizer-counters')
  const counterValues = text.countLabels.map((label) => {
    const row = createElement('div', 'safari-customizer-counter')
    const name = createElement('dt')
    const value = createElement('dd')
    name.textContent = label
    row.append(name, value)
    counters.append(row)
    return value
  })
  sidePanel.append(menuPanel, areaPanel, counters)
  layout.append(slotPanel, sidePanel)

  const footer = createElement('footer', 'safari-ui-footer')
  const returnControl = createLabeledButton('safari-ui-action safari-ui-return', text.returnLabel, 'cancel')
  returnControl.button.dataset.safariReturn = ''
  appendNativeSprite(returnControl.button, options.assets.customizer.objectSprites, 1, options.createGraphic, 'safari-ui-cursor-return')
  footer.append(returnControl.button)

  const confirmation = createElement('section', 'safari-ui-confirmation')
  confirmation.setAttribute('role', 'dialog')
  confirmation.setAttribute('aria-modal', 'true')
  const confirmationPrompt = createElement('p', 'safari-ui-confirmation-prompt')
  const confirmationPreview = createElement('div', 'safari-ui-confirmation-preview')
  const confirmationActions = createElement('div', 'safari-ui-confirmation-actions')
  const acceptControl = createLabeledButton('safari-ui-action safari-ui-confirm', text.yesLabel, 'confirm')
  acceptControl.button.dataset.safariConfirmation = '0'
  const cancelControl = createLabeledButton('safari-ui-action safari-ui-cancel', text.noLabel, 'cancel')
  cancelControl.button.dataset.safariConfirmation = '1'
  confirmationActions.append(acceptControl.button, cancelControl.button)
  confirmation.append(confirmationPrompt, confirmationPreview, confirmationActions)
  surface.append(header, layout, footer, confirmation)
  root.replaceChildren(surface)
  return {
    prompt,
    sidePanel,
    lockedBackdrop,
    unlockedBackdrop,
    slots,
    slotGraphicHosts,
    slotNames,
    menuPanel,
    menuButtons,
    areaPanel,
    areas,
    pager,
    counters,
    counterValues,
    returnButton: returnControl.button,
    confirmation,
    confirmationPrompt,
    confirmationPreview,
    confirmationAccept: acceptControl.button,
    confirmationAcceptLabel: acceptControl.label,
    confirmationCancel: cancelControl.button,
  }
}

export function createSafariCustomizerController(
  root: HTMLElement,
  options: SafariCustomizerControllerOptions,
): SafariCustomizerController {
  const text = resolveSafariUiRomText(options.messageBanks).customizer
  let model = createSafariCustomizerModel(options.initialAreas, options.initialBlockCounts, options.showBlockCounts)
  root.classList.add('safari-ui', 'safari-customizer')
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  const view = buildCustomizerView(root, options, text)
  let confirmationKey = ''

  function syncSlotGraphics(): void {
    view.slots.forEach((button, slot) => {
      const areaId = model.areas[slot]!
      if (button.dataset.safariAreaId === String(areaId)) return
      button.dataset.safariAreaId = String(areaId)
      const graphicHost = view.slotGraphicHosts[slot]!
      graphicHost.replaceChildren()
      const graphic = areaGraphic(areaId, options)
      if (graphic) {
        graphic.classList.add('safari-ui-card-graphic')
        graphic.setAttribute('aria-hidden', 'true')
        graphicHost.append(graphic)
      }
      const label = text.areaNames[areaId] ?? ''
      view.slotNames[slot]!.textContent = label
      if (label) button.setAttribute('aria-label', label)
    })
  }

  function sync(focusActive: boolean): void {
    root.dataset.safariPhase = model.phase
    syncSlotGraphics()
    view.prompt.textContent = model.phase === 'menu'
      ? text.prompt
      : model.phase === 'areas'
        ? text.exchangePrompt
        : model.phase === 'order'
          ? text.destinationPrompt
          : ''
    view.slots.forEach((button, slot) => {
      setCurrent(button, model.returnColumn === undefined && (
        (model.phase === 'slots' && slot === model.slotCursor)
        || (model.phase === 'order' && slot === model.orderCursor)
      ))
      button.dataset.safariOrderSource = String(model.phase === 'order' && slot === model.slotCursor)
    })
    view.menuButtons.forEach((button, choice) => setCurrent(button, model.phase === 'menu' && choice === model.menuCursor))
    const areaPage = Math.floor(model.areaCursor / 6)
    view.areas.forEach((button, areaId) => {
      button.hidden = Math.floor(areaId / 6) !== areaPage
      setCurrent(button, model.phase === 'areas' && model.returnColumn === undefined && areaId === model.areaCursor)
      button.setAttribute('aria-pressed', String(model.areas.includes(areaId as HgssSafariAreaId)))
    })
    view.menuPanel.hidden = model.phase !== 'menu'
    view.areaPanel.hidden = model.phase !== 'areas'
    view.counters.hidden = !model.showBlockCounts
    view.sidePanel.hidden = (model.phase === 'slots' || model.phase === 'order') && !model.showBlockCounts
    view.lockedBackdrop.hidden = model.showBlockCounts
    view.unlockedBackdrop.hidden = !model.showBlockCounts
    view.pager.label.textContent = romText(text.pageTemplate, [String(areaPage + 1)])
    syncPageButton(
      view.pager.previous,
      areaPage > 0,
      romText(text.pageTemplate, [String(Math.max(1, areaPage))]),
    )
    syncPageButton(
      view.pager.next,
      areaPage < 1,
      romText(text.pageTemplate, [String(Math.min(2, areaPage + 2))]),
    )

    const counterSlot = model.phase === 'order' ? model.orderCursor : model.slotCursor
    const counts = model.blockCounts[counterSlot] ?? [0, 0, 0, 0, 0]
    view.counterValues.forEach((value, index) => {
      value.textContent = romText(text.countTemplate, [String(counts[index] ?? 0)])
    })

    view.confirmation.hidden = model.phase !== 'confirmation'
    setCurrent(
      view.returnButton,
      model.returnColumn !== undefined && (model.phase === 'slots' || model.phase === 'areas' || model.phase === 'order'),
    )
    if (model.phase === 'confirmation' && model.pendingChange) {
      const pending = model.pendingChange
      const nextKey = `${pending.operation}:${pending.targetAreaId}`
      view.confirmationPrompt.textContent = text.replacementPrompt
      view.confirmationAcceptLabel.textContent = text.yesLabel
      if (confirmationKey !== nextKey) {
        confirmationKey = nextKey
        view.confirmationPreview.replaceChildren()
        const preview = areaGraphic(pending.targetAreaId, options)
        if (preview) {
          preview.classList.add('safari-ui-card-graphic')
          preview.setAttribute('aria-hidden', 'true')
          view.confirmationPreview.append(preview)
        }
      }
      setCurrent(view.confirmationAccept, model.confirmationCursor === 0)
      setCurrent(view.confirmationCancel, model.confirmationCursor === 1)
    } else {
      setCurrent(view.confirmationAccept, false)
      setCurrent(view.confirmationCancel, false)
    }
    if (focusActive) {
      if (model.returnColumn !== undefined) focusWithoutScroll(view.returnButton)
      else if (model.phase === 'slots') focusWithoutScroll(view.slots[model.slotCursor])
      else if (model.phase === 'menu') focusWithoutScroll(view.menuButtons[model.menuCursor])
      else if (model.phase === 'areas') focusWithoutScroll(view.areas[model.areaCursor])
      else if (model.phase === 'order') focusWithoutScroll(view.slots[model.orderCursor])
      else focusWithoutScroll(model.confirmationCursor === 0 ? view.confirmationAccept : view.confirmationCancel)
    }
    options.onSelectionChange?.(model)
  }

  function apply(action: SafariCustomizerAction, focusActive: boolean): boolean {
    const before = model
    const result = updateSafariCustomizer(model, action)
    model = result.model
    if (result.handled && options.playSoundEffect) {
      const cursorChanged = customizerCursorKey(before) !== customizerCursorKey(model)
      let sequenceId: number | undefined
      if (action.kind === 'activate-confirmation') sequenceId = hgssSafariUiSoundEffects.yesNo
      else if (action.kind === 'activate-order-slot' && result.effect?.kind === 'commit') {
        sequenceId = hgssSafariUiSoundEffects.orderDestination
      } else if (action.kind.startsWith('activate-')) sequenceId = hgssSafariUiSoundEffects.select
      else if (action.kind.startsWith('focus-') && cursorChanged) sequenceId = hgssSafariUiSoundEffects.cursor
      else if (action.kind === 'input') {
        if (action.action === 'page-previous' || action.action === 'page-next') {
          if (Math.floor(before.areaCursor / 6) !== Math.floor(model.areaCursor / 6)) sequenceId = hgssSafariUiSoundEffects.page
        } else if (action.action === 'confirm' || action.action === 'cancel') {
          sequenceId = before.phase === 'confirmation'
            ? hgssSafariUiSoundEffects.yesNo
            : hgssSafariUiSoundEffects.select
        } else if (cursorChanged) {
          sequenceId = Math.floor(before.areaCursor / 6) !== Math.floor(model.areaCursor / 6)
            ? hgssSafariUiSoundEffects.page
            : hgssSafariUiSoundEffects.cursor
        }
      }
      if (sequenceId !== undefined) options.playSoundEffect(sequenceId)
    }
    sync(focusActive)
    if (result.effect?.kind === 'commit') options.onCommit(result.effect.change)
    else if (result.effect?.kind === 'close') {
      root.hidden = true
      options.onClose()
    }
    return result.handled
  }

  view.slots.forEach((button, slot) => {
    button.addEventListener('pointerdown', () => {
      if (model.phase === 'slots') apply({ kind: 'focus-slot', slot }, false)
      else if (model.phase === 'order') apply({ kind: 'focus-order-slot', slot }, false)
    })
    button.addEventListener('click', () => {
      if (model.phase === 'slots') apply({ kind: 'activate-slot', slot }, true)
      else if (model.phase === 'order') apply({ kind: 'activate-order-slot', slot }, true)
    })
  })
  view.menuButtons.forEach((button, choice) => {
    button.addEventListener('pointerdown', () => { apply({ kind: 'focus-menu', choice }, false) })
    button.addEventListener('click', () => { apply({ kind: 'activate-menu', choice }, true) })
  })
  view.areas.forEach((button, areaId) => {
    button.addEventListener('pointerdown', () => { apply({ kind: 'focus-area', areaId }, false) })
    button.addEventListener('click', () => { apply({ kind: 'activate-area', areaId }, true) })
  })
  for (const [choice, button] of [view.confirmationAccept, view.confirmationCancel].entries()) {
    button.addEventListener('pointerdown', () => { apply({ kind: 'focus-confirmation', choice }, false) })
    button.addEventListener('click', () => { apply({ kind: 'activate-confirmation', choice }, true) })
  }
  for (const [button, action] of [
    [view.pager.previous, 'page-previous'],
    [view.pager.next, 'page-next'],
  ] as const) {
    button.addEventListener('pointerdown', () => { pulsePageButton(button) })
    button.addEventListener('click', () => { apply({ kind: 'input', action }, true) })
  }
  view.returnButton.addEventListener('pointerdown', () => { apply({ kind: 'focus-return' }, false) })
  view.returnButton.addEventListener('click', () => { apply({ kind: 'activate-return' }, true) })
  sync(false)

  return {
    open(areas = model.areas, blockCounts = model.blockCounts, showBlockCounts = model.showBlockCounts) {
      model = createSafariCustomizerModel(areas, blockCounts, showBlockCounts)
      root.hidden = false
      sync(true)
    },
    close() { root.hidden = true },
    isOpen: () => !root.hidden,
    handle: (action) => root.hidden ? false : apply({ kind: 'input', action }, true),
    getModel: () => model,
  }
}

function buildDecoratorView(
  root: HTMLElement,
  options: SafariDecoratorControllerOptions,
  text: SafariUiRomText['decorator'],
): DecoratorView {
  const surface = createElement('div', 'safari-ui-surface')
  appendNativeLayerStack(surface, [
    findBackgroundGraphic(options.assets.decorator.backgroundGroups, 2),
    findBackgroundGraphic(options.assets.decorator.backgroundGroups, 3),
  ], options.createGraphic, 'safari-ui-native-main')
  const layout = createElement('div', 'safari-decorator-layout')
  const catalog = createElement('section', 'safari-decorator-catalog')
  const catalogBackdrop = appendNativeLayerStack(catalog, [
    findBackgroundGraphic(options.assets.decorator.backgroundGroups, 6),
    findBackgroundGraphic(options.assets.decorator.backgroundGroups, 8),
  ], options.createGraphic, 'safari-ui-native-catalog')
  const grid = createElement('div', 'safari-decorator-grid')
  grid.setAttribute('role', 'grid')
  const pager = createNativePageControls(options.assets.decorator.objectSprites, options.createGraphic, {
    previous: [5, 6, 7],
    next: [8, 9, 10],
  })
  catalog.append(grid, pager.root)

  const detail = createElement('aside', 'safari-decorator-detail')
  const placementBackdrop = appendNativeLayerStack(detail, [
    findBackgroundGraphic(options.assets.decorator.backgroundGroups, 7),
  ], options.createGraphic, 'safari-ui-native-placement')
  const badgeHost = createElement('div', 'safari-decorator-native-badge')
  const catalogueBadge = appendNativeSprite(badgeHost, options.assets.decorator.objectSprites, 2, options.createGraphic, 'safari-ui-badge-catalogue')
  const transitionBadge = appendNativeSprite(badgeHost, options.assets.decorator.objectSprites, 3, options.createGraphic, 'safari-ui-badge-transition')
  const placementBadge = appendNativeSprite(badgeHost, options.assets.decorator.objectSprites, 4, options.createGraphic, 'safari-ui-badge-placement')
  const detailPreview = createElement('div', 'safari-decorator-preview')
  detailPreview.setAttribute('aria-hidden', 'true')
  const detailName = createElement('h3')
  const detailDescription = createElement('p')
  detail.append(badgeHost, detailPreview, detailName, detailDescription)
  const empty = createElement('p', 'safari-ui-empty')
  empty.textContent = text.noObjects
  empty.setAttribute('role', 'status')
  layout.append(catalog, detail, empty)

  const footer = createElement('footer', 'safari-ui-footer')
  const returnControl = createLabeledButton('safari-ui-action safari-ui-return', text.returnLabel, 'cancel')
  returnControl.button.dataset.safariReturn = ''
  appendNativeSprite(returnControl.button, options.assets.decorator.objectSprites, 1, options.createGraphic, 'safari-ui-cursor-return')
  footer.append(returnControl.button)

  const confirmation = createElement('section', 'safari-ui-confirmation')
  confirmation.setAttribute('role', 'dialog')
  confirmation.setAttribute('aria-modal', 'true')
  const confirmationPrompt = createElement('p', 'safari-ui-confirmation-prompt')
  const confirmationActions = createElement('div', 'safari-ui-confirmation-actions')
  const acceptControl = createLabeledButton('safari-ui-action safari-ui-confirm', '', 'confirm')
  acceptControl.button.dataset.safariConfirmation = '0'
  const cancelControl = createLabeledButton('safari-ui-action safari-ui-cancel', text.noLabel, 'cancel')
  cancelControl.button.dataset.safariConfirmation = '1'
  confirmationActions.append(acceptControl.button, cancelControl.button)
  confirmation.append(confirmationPrompt, confirmationActions)
  const notice = createElement('section', 'safari-ui-notice')
  notice.setAttribute('role', 'alertdialog')
  notice.setAttribute('aria-modal', 'true')
  notice.tabIndex = -1
  const noticeText = createElement('p', 'safari-ui-notice-text')
  notice.append(noticeText)
  surface.append(layout, footer, confirmation, notice)
  root.replaceChildren(surface)
  return {
    catalogBackdrop,
    placementBackdrop,
    catalogueBadge,
    transitionBadge,
    placementBadge,
    grid,
    objects: [],
    pager,
    detailPreview,
    detailName,
    detailDescription,
    empty,
    returnButton: returnControl.button,
    confirmation,
    confirmationPrompt,
    confirmationAccept: acceptControl.button,
    confirmationAcceptLabel: acceptControl.label,
    confirmationCancel: cancelControl.button,
    notice,
    noticeText,
  }
}

export function createSafariDecoratorController(
  root: HTMLElement,
  options: SafariDecoratorControllerOptions,
): SafariDecoratorController {
  const text = resolveSafariUiRomText(options.messageBanks).decorator
  let model = createSafariDecoratorModel(options.candidates ?? options.objectIds ?? [])
  root.classList.add('safari-ui', 'safari-decorator')
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  const view = buildDecoratorView(root, options, text)
  let previewObjectId: HgssSafariObjectId | undefined

  function applyObjectListeners(button: HTMLButtonElement, index: number): void {
    button.addEventListener('pointerdown', () => { apply({ kind: 'focus-object', index }, false) })
    button.addEventListener('click', () => { apply({ kind: 'activate-object', index }, true) })
  }

  function buildObjectButtons(): void {
    view.objects = model.choices.map(({ objectId, unavailableReason }, index) => {
      const button = createElement('button', 'safari-ui-object-card')
      button.type = 'button'
      button.dataset.safariObject = String(objectId)
      if (unavailableReason !== undefined) {
        button.dataset.safariUnavailable = String(unavailableReason)
        button.setAttribute('aria-disabled', 'true')
      }
      button.setAttribute('role', 'gridcell')
      addGraphicLabel(button, undefined, text.objectNames[objectId] ?? '')
      appendNativeSprite(button, options.assets.decorator.objectSprites, 0, options.createGraphic, 'safari-ui-cursor-normal')
      applyObjectListeners(button, index)
      return button
    })
    view.grid.replaceChildren(...view.objects)
  }

  function sync(focusActive: boolean): void {
    root.dataset.safariPhase = model.phase
    const pageCount = Math.max(1, Math.ceil(model.objectIds.length / HGSS_SAFARI_OBJECTS_PER_PAGE))
    const page = Math.floor(model.cursor / HGSS_SAFARI_OBJECTS_PER_PAGE)
    view.objects.forEach((button, index) => {
      button.hidden = Math.floor(index / HGSS_SAFARI_OBJECTS_PER_PAGE) !== page
      setCurrent(button, model.phase === 'objects' && model.returnColumn === undefined && index === model.cursor)
    })
    setCurrent(view.returnButton, model.phase === 'objects' && model.returnColumn !== undefined)
    view.pager.label.textContent = romText(text.pageTemplate, [String(page + 1), String(pageCount)])
    syncPageButton(
      view.pager.previous,
      model.phase === 'objects' && page > 0,
      romText(text.pageTemplate, [String(Math.max(1, page)), String(pageCount)]),
    )
    syncPageButton(
      view.pager.next,
      model.phase === 'objects' && page < pageCount - 1,
      romText(text.pageTemplate, [String(Math.min(pageCount, page + 2)), String(pageCount)]),
    )

    const objectId = model.objectIds[model.cursor]
    const name = objectId === undefined ? '' : text.objectNames[objectId] ?? ''
    if (previewObjectId !== objectId) {
      previewObjectId = objectId
      view.detailPreview.replaceChildren()
      const preview = objectId === undefined
        ? undefined
        : options.createObjectPreview?.(objectId, options.assets.decorator.objectSprites)
      if (preview) view.detailPreview.append(preview)
    }
    view.detailName.textContent = name
    view.detailDescription.textContent = objectId === undefined ? '' : text.objectDescriptions[objectId] ?? ''
    view.empty.hidden = model.objectIds.length !== 0
    view.grid.hidden = model.objectIds.length === 0
    view.pager.root.hidden = model.objectIds.length === 0
    view.catalogBackdrop.hidden = model.phase === 'confirmation'
    view.placementBackdrop.hidden = model.phase !== 'confirmation'
    if (view.catalogueBadge) view.catalogueBadge.hidden = model.phase !== 'objects'
    if (view.transitionBadge) view.transitionBadge.hidden = model.phase !== 'notice'
    if (view.placementBadge) view.placementBadge.hidden = model.phase !== 'confirmation'
    view.confirmation.hidden = model.phase !== 'confirmation'
    view.notice.hidden = model.phase !== 'notice'
    view.noticeText.textContent = model.noticeReason === undefined
      ? ''
      : text.unavailableMessages[model.noticeReason - 1] ?? ''
    if (model.phase === 'confirmation' && objectId !== undefined) {
      view.confirmationPrompt.textContent = romText(text.placePromptTemplate, [name])
      view.confirmationAcceptLabel.textContent = text.yesLabel
      setCurrent(view.confirmationAccept, model.confirmationCursor === 0)
      setCurrent(view.confirmationCancel, model.confirmationCursor === 1)
    } else {
      setCurrent(view.confirmationAccept, false)
      setCurrent(view.confirmationCancel, false)
    }
    if (focusActive) {
      if (model.phase === 'confirmation') {
        focusWithoutScroll(model.confirmationCursor === 0 ? view.confirmationAccept : view.confirmationCancel)
      } else if (model.phase === 'notice') {
        focusWithoutScroll(view.notice)
      } else {
        focusWithoutScroll(model.returnColumn === undefined ? view.objects[model.cursor] : view.returnButton)
      }
    }
    options.onSelectionChange?.(model)
  }

  function apply(action: SafariDecoratorAction, focusActive: boolean): boolean {
    const before = model
    const result = updateSafariDecorator(model, action)
    model = result.model
    if (result.handled && options.playSoundEffect) {
      const cursorChanged = decoratorCursorKey(before) !== decoratorCursorKey(model)
      let sequenceId: number | undefined
      if (action.kind === 'activate-confirmation') sequenceId = hgssSafariUiSoundEffects.yesNo
      else if (action.kind === 'activate-object' && model.phase === 'notice') {
        sequenceId = hgssSafariUiSoundEffects.unavailable
      } else if (action.kind.startsWith('activate-')) sequenceId = hgssSafariUiSoundEffects.select
      else if (action.kind.startsWith('focus-') && cursorChanged) sequenceId = hgssSafariUiSoundEffects.cursor
      else if (action.kind === 'input') {
        const beforePage = Math.floor(before.cursor / HGSS_SAFARI_OBJECTS_PER_PAGE)
        const afterPage = Math.floor(model.cursor / HGSS_SAFARI_OBJECTS_PER_PAGE)
        if (action.action === 'page-previous' || action.action === 'page-next' || beforePage !== afterPage) {
          if (beforePage !== afterPage) sequenceId = hgssSafariUiSoundEffects.page
        } else if (action.action === 'confirm' || action.action === 'cancel') {
          sequenceId = before.phase === 'confirmation'
            ? hgssSafariUiSoundEffects.yesNo
            : before.phase === 'objects' && model.phase === 'notice'
              ? hgssSafariUiSoundEffects.unavailable
              : hgssSafariUiSoundEffects.select
        } else if (cursorChanged) sequenceId = hgssSafariUiSoundEffects.cursor
      }
      if (sequenceId !== undefined) options.playSoundEffect(sequenceId)
    }
    sync(focusActive)
    if (result.effect?.kind === 'select') options.onSelect(result.effect.objectId)
    else if (result.effect?.kind === 'close') {
      root.hidden = true
      options.onClose()
    }
    return result.handled
  }

  for (const [choice, button] of [view.confirmationAccept, view.confirmationCancel].entries()) {
    button.addEventListener('pointerdown', () => { apply({ kind: 'focus-confirmation', choice }, false) })
    button.addEventListener('click', () => { apply({ kind: 'activate-confirmation', choice }, true) })
  }
  for (const [button, action] of [
    [view.pager.previous, 'page-previous'],
    [view.pager.next, 'page-next'],
  ] as const) {
    button.addEventListener('pointerdown', () => { pulsePageButton(button) })
    button.addEventListener('click', () => { apply({ kind: 'input', action }, true) })
  }
  view.returnButton.addEventListener('pointerdown', () => { apply({ kind: 'focus-return' }, false) })
  view.returnButton.addEventListener('click', () => { apply({ kind: 'activate-return' }, true) })
  view.notice.addEventListener('click', () => { apply({ kind: 'input', action: 'confirm' }, true) })
  buildObjectButtons()
  sync(false)

  return {
    open(candidates = model.choices) {
      const previousObjectId = model.objectIds[model.cursor]
      const normalized = candidates.map((candidate) => typeof candidate === 'number' ? candidate : candidate.objectId)
      const rememberedCursor = previousObjectId === undefined ? 0 : normalized.indexOf(previousObjectId)
      model = createSafariDecoratorModel(candidates, rememberedCursor >= 0 ? rememberedCursor : 0)
      buildObjectButtons()
      root.hidden = false
      sync(true)
    },
    close() { root.hidden = true },
    isOpen: () => !root.hidden,
    handle: (action) => root.hidden ? false : apply({ kind: 'input', action }, true),
    getModel: () => model,
  }
}
