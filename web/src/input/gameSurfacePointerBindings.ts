import type { GameDigitalAction } from '../gameInput'
import type { IntroRenderState } from '../game/intro/introTypes'
import type { InputPromptProfile } from '../game/ui/inputPrompts'
import { createDelegatedButtonActivation } from '../game/ui/controlActivation'
import { canSkipOpeningCinematic } from '../game/boot/openingCinematic'
import {
  getIntroPointerAction,
  shouldHandleIntroPointerAction,
  type IntroPointerAction,
} from '../introControls'

export type GameSurfaceFlowState = 'empty' | 'boot' | 'title' | 'intro' | 'bedroom'

export type GameSurfacePointerElements = Readonly<{
  fieldDialogue: HTMLElement
  battleMessage: HTMLElement
  battleCommands: HTMLElement
  battleMoves: HTMLElement
  battleScreen: HTMLElement
  battleEvolution: HTMLElement
  runtimeCanvas: HTMLCanvasElement
  fieldNumber: HTMLFormElement
  fieldNumberInput: HTMLInputElement
  fieldNickname: HTMLFormElement
  fieldNicknameInput: HTMLInputElement
  screenCanvas: HTMLCanvasElement
}>

export type GameSurfacePointerScheduler = Readonly<{
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
}>

export type GameSurfacePointerBindingsOptions = Readonly<{
  elements: GameSurfacePointerElements
  dispatchPointer: (action: GameDigitalAction) => void
  bot: Readonly<{
    isRunning: () => boolean
    stop: (message: string) => void
  }>
  battle: Readonly<{
    readCursor: () => number
    writeCursor: (cursor: number) => void
    renderCursor: (container: HTMLElement) => void
    isBagOpen: () => boolean
    readInputProfile: () => InputPromptProfile
  }>
  field: Readonly<{
    readFlowState: () => GameSurfaceFlowState
    isMainMenuOpen: () => boolean
    submitNumber: (value: number | undefined) => void
    submitNickname: (value: string | undefined) => void
  }>
  intro: Readonly<{
    readRenderState: () => IntroRenderState | undefined
    readOpeningElapsedMs: () => number
    advance: (action?: IntroPointerAction) => unknown
    preview: (action: IntroPointerAction) => unknown
  }>
  scheduler?: GameSurfacePointerScheduler
}>

export type GameSurfacePointerBindings = Readonly<{
  dispose: () => void
}>

function browserScheduler(): GameSurfacePointerScheduler {
  return {
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
  }
}

/**
 * Owns pointer and form listeners attached directly to the game surfaces.
 * Browser-global keyboard/gamepad listeners remain owned by browserInputBindings.
 */
export function installGameSurfacePointerBindings(
  options: GameSurfacePointerBindingsOptions,
): GameSurfacePointerBindings {
  const {
    fieldDialogue,
    battleMessage,
    battleCommands,
    battleMoves,
    battleScreen,
    battleEvolution,
    runtimeCanvas,
    fieldNumber,
    fieldNumberInput,
    fieldNickname,
    fieldNicknameInput,
    screenCanvas,
  } = options.elements
  const scheduler = options.scheduler ?? browserScheduler()
  const removers: Array<() => void> = []
  let fieldPointerHoldTimer: number | undefined
  let fieldPointerLongPress = false
  let disposed = false

  const listen = <EventType extends Event>(
    target: EventTarget,
    type: string,
    listener: (event: EventType) => void,
  ): void => {
    const eventListener = listener as EventListener
    target.addEventListener(type, eventListener)
    removers.push(() => target.removeEventListener(type, eventListener))
  }

  const stopBot = (message: string): void => {
    if (options.bot.isRunning()) options.bot.stop(message)
  }

  listen<PointerEvent>(fieldDialogue, 'pointerdown', (event) => {
    event.preventDefault()
    stopBot('Bot arrêté : dialogue repris manuellement.')
    options.dispatchPointer('confirm')
  })
  listen<PointerEvent>(battleMessage, 'pointerdown', (event) => {
    event.preventDefault()
    options.dispatchPointer('confirm')
  })

  for (const container of [battleCommands, battleMoves]) {
    const activation = createDelegatedButtonActivation(container, (target) => {
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      options.battle.writeCursor(buttons.indexOf(target))
      options.battle.renderCursor(container)
      target.focus({ preventScroll: true })
    }, () => options.dispatchPointer('confirm'))
    listen<PointerEvent>(container, 'pointermove', (event) => {
      if (event.pointerType === 'touch' || options.battle.isBagOpen() || options.battle.readInputProfile() !== 'mouse') return
      const target = event.target instanceof Element
        ? event.target.closest<HTMLButtonElement>('button:not(:disabled)')
        : null
      if (!target || !container.contains(target)) return
      const buttons = [...container.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
      const hoveredCursor = buttons.indexOf(target)
      if (hoveredCursor < 0 || hoveredCursor === options.battle.readCursor()) return
      options.battle.writeCursor(hoveredCursor)
      options.battle.renderCursor(container)
    })
    listen(container, 'pointerdown', activation.pointerDown)
    listen(container, 'click', activation.click)
  }

  const battleControlsFooter = battleScreen.querySelector<HTMLElement>('.battle-controls-footer')
  if (battleControlsFooter) {
    const activation = createDelegatedButtonActivation(
      battleControlsFooter,
      (button) => button.focus({ preventScroll: true }),
      (button) => options.dispatchPointer(button.dataset.battleControl as 'confirm' | 'cancel'),
    )
    listen(battleControlsFooter, 'pointerdown', activation.pointerDown)
    listen(battleControlsFooter, 'click', activation.click)
  }

  listen<PointerEvent>(battleEvolution, 'pointerdown', (event) => {
    event.preventDefault()
    options.dispatchPointer('confirm')
  })
  listen<PointerEvent>(runtimeCanvas, 'pointerdown', (event) => {
    if (options.field.readFlowState() !== 'bedroom' || event.button !== 0) return
    stopBot('Bot arrêté : terrain repris manuellement.')
    fieldPointerLongPress = false
    if (event.pointerType === 'touch' || event.pointerType === 'pen') {
      fieldPointerHoldTimer = scheduler.setTimeout(() => {
        fieldPointerHoldTimer = undefined
        fieldPointerLongPress = true
        options.dispatchPointer('menu')
      }, 480)
    }
  })
  listen<PointerEvent>(runtimeCanvas, 'pointerup', (event) => {
    if (options.field.readFlowState() !== 'bedroom' || event.button !== 0) return
    if (fieldPointerHoldTimer !== undefined) {
      scheduler.clearTimeout(fieldPointerHoldTimer)
      fieldPointerHoldTimer = undefined
    }
    if (fieldPointerLongPress) {
      fieldPointerLongPress = false
      return
    }
    options.dispatchPointer(options.field.isMainMenuOpen() ? 'cancel' : 'confirm')
  })
  listen<PointerEvent>(runtimeCanvas, 'pointercancel', () => {
    if (fieldPointerHoldTimer !== undefined) scheduler.clearTimeout(fieldPointerHoldTimer)
    fieldPointerHoldTimer = undefined
    fieldPointerLongPress = false
  })
  listen<MouseEvent>(runtimeCanvas, 'contextmenu', (event) => event.preventDefault())

  listen<SubmitEvent>(fieldNumber, 'submit', (event) => {
    event.preventDefault()
    stopBot('Bot arrêté : saisie reprise manuellement.')
    options.field.submitNumber(Number(fieldNumberInput.value))
  })
  const numberCancel = fieldNumber.querySelector<HTMLElement>('[data-number-cancel]')
  if (numberCancel) listen(numberCancel, 'click', () => options.field.submitNumber(undefined))

  listen<SubmitEvent>(fieldNickname, 'submit', (event) => {
    event.preventDefault()
    stopBot('Bot arrêté : saisie reprise manuellement.')
    options.field.submitNickname(fieldNicknameInput.value)
  })
  const nicknameCancel = fieldNickname.querySelector<HTMLElement>('[data-nickname-cancel]')
  if (nicknameCancel) listen(nicknameCancel, 'click', () => options.field.submitNickname(undefined))

  listen<PointerEvent>(screenCanvas, 'pointerdown', (event) => {
    stopBot('Bot arrêté : écran repris manuellement.')
    const renderState = options.intro.readRenderState()
    if (options.field.readFlowState() === 'intro' && renderState) {
      const action = getIntroPointerAction(screenCanvas, event, renderState)
      if (shouldHandleIntroPointerAction(renderState, action)) options.intro.advance(action)
      return
    }
    options.intro.advance()
  })
  listen<PointerEvent>(screenCanvas, 'pointermove', (event) => {
    const flow = options.field.readFlowState()
    if (flow === 'boot') {
      screenCanvas.style.cursor = canSkipOpeningCinematic(options.intro.readOpeningElapsedMs())
        ? 'pointer'
        : 'default'
      return
    }
    if (flow === 'title') {
      screenCanvas.style.cursor = 'pointer'
      return
    }
    const before = options.intro.readRenderState()
    if (flow !== 'intro' || !before) {
      screenCanvas.style.cursor = 'default'
      return
    }
    const action = getIntroPointerAction(screenCanvas, event, before)
    screenCanvas.style.cursor = action || before.mode === 'dialog' ? 'pointer' : 'default'
    if (action) options.intro.preview(action)
  })
  listen(screenCanvas, 'pointerleave', () => {
    screenCanvas.style.cursor = 'default'
  })

  return Object.freeze({
    dispose: () => {
      if (disposed) return
      disposed = true
      if (fieldPointerHoldTimer !== undefined) scheduler.clearTimeout(fieldPointerHoldTimer)
      fieldPointerHoldTimer = undefined
      fieldPointerLongPress = false
      for (const remove of removers.splice(0)) remove()
    },
  })
}
