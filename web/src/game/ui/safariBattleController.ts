import type { GameDigitalAction } from '../../gameInput'
import {
  attemptHgssSafariBattleAction,
  type HgssSafariBattleContext,
  type HgssSafariBattleAction,
  type HgssSafariBattleOutcome,
  type HgssSafariBattleState,
} from '../safari/hgssSafariBattle'
import type { BattleActionPolicy, BattleActionVeto } from '../battle/battleActionPolicy'
import {
  createHgssSafariBattleIntroduction,
  hgssSafariBattleCommandMessages,
  resolveHgssSafariBattleTurnPresentation,
  type HgssSafariBattlePresentationEntry,
  type HgssSafariBattlePresentationNames,
  type HgssSafariBattleSceneCue,
} from '../safari/hgssSafariBattleFlow'
import { createHgssBattleMessagePrinterPages, hgssBattleMessagePrinterContinueControl, playHgssBattleMessagePrinterPage, type HgssBattleMessagePrinterControl, type HgssBattleMessagePrinterPage, type HgssBattleMessagePrinterPlayback } from '../battle/hgssBattleMessagePrinter'
import { moveBattleArcCursor } from '../battle/battleMenuNavigation'
import { hgssVBlankDurationMs, hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import { formatHgssRomMessage } from './romMessageFormatting'

export type SafariBattleElements = {
  screen: HTMLElement
  message: HTMLElement
  commands: HTMLElement
  moves: HTMLElement
}

export type SafariBattleCaughtSequence = {
  presentation: readonly HgssSafariBattlePresentationEntry[]
  onPresentationStart?: () => void
  afterPresentation?: () => Promise<readonly HgssSafariBattlePresentationEntry[]>
  afterAllPresentation?: () => void | Promise<void>
}

export type SafariBattleStartOptions = {
  state: HgssSafariBattleState
  context: HgssSafariBattleContext
  names: HgssSafariBattlePresentationNames
  messages: Readonly<Record<number, string | undefined>>
  actionPolicy?: BattleActionPolicy
  onStateChange: (state: HgssSafariBattleState) => void
  onActionVeto?: (veto: BattleActionVeto, action: HgssSafariBattleAction, state: HgssSafariBattleState) => void
  onAudio?: (entry: HgssSafariBattlePresentationEntry) => void
  onMessageControl?: (control: HgssBattleMessagePrinterControl) => void | Promise<void>
  onAnimation?: (animation: NonNullable<HgssSafariBattlePresentationEntry['animation']>, entry: HgssSafariBattlePresentationEntry) => void | Promise<void>
  onSceneCue?: (cue: HgssSafariBattleSceneCue, entry: HgssSafariBattlePresentationEntry) => void | Promise<void>
  onCaught?: (state: HgssSafariBattleState) => SafariBattleCaughtSequence
  onFinish: (outcome: HgssSafariBattleOutcome, state: HgssSafariBattleState) => void
  onPhaseChange?: (phase: 'message' | 'command') => void
  onFastForward?: () => boolean
  onPresentationReset?: () => void
  textDelayFrames?: 1 | 4 | 8
}

export type SafariBattleController = {
  start: (options: SafariBattleStartOptions) => void
  handle: (action: GameDigitalAction, pressed?: boolean) => boolean
  isActive: () => boolean
  getState: () => HgssSafariBattleState | undefined
  close: () => void
}

/** Safari commands occupy the exact same four arc slots as regular combat. */
export function moveHgssSafariCommandCursor(
  index: number,
  action: Extract<GameDigitalAction, 'left' | 'right' | 'up' | 'down'>,
  enabled: readonly boolean[] = [true, true, true, true],
): number {
  return moveBattleArcCursor(index, enabled, action)
}

const safariCommandLayoutSlots = {
  ball: 'fight',
  bait: 'bag',
  mud: 'party',
  run: 'run',
} as const satisfies Record<typeof hgssSafariBattleCommandMessages[number]['action'], 'fight' | 'bag' | 'party' | 'run'>

/**
 * Les commandes Safari gardent leur action native dans `data-safari-action`,
 * mais partagent les quatre emplacements de l'arc de combat global. Cela évite
 * qu'une nouvelle famille de commandes absolues se retrouve sans position CSS.
 */
export function resolveHgssSafariCommandLayoutSlot(
  action: typeof hgssSafariBattleCommandMessages[number]['action'],
): typeof safariCommandLayoutSlots[typeof action] {
  return safariCommandLayoutSlots[action]
}

function requireBattleMessage(messages: SafariBattleStartOptions['messages'], messageId: number): string {
  const message = messages[messageId]
  if (message === undefined) throw new Error(`Le message Safari ${messageId} de la banque de combat ROM est absent.`)
  return message
}

export function createSafariBattleController(elements: SafariBattleElements): SafariBattleController {
  type QueuedPresentation = { entry: HgssSafariBattlePresentationEntry, onStart?: () => void }
  let options: SafariBattleStartOptions | undefined
  let state: HgssSafariBattleState | undefined
  let queue: QueuedPresentation[] = []
  let currentEntry: HgssSafariBattlePresentationEntry | undefined
  let currentPages: readonly HgssBattleMessagePrinterPage[] = []
  let currentPageIndex = 0
  let currentPrinter: HgssBattleMessagePrinterPlayback | undefined
  let currentAnimation = Promise.resolve()
  let currentSceneBarrier = Promise.resolve()
  let inputLocked = false
  let waitingForPageInput = false
  let entryDelayStarted = false
  let unlockTimer: number | undefined
  let unlockTimerCallback: (() => void) | undefined
  let unlockRevision = 0
  let cursor = 0
  let finished = false
  let ballsCounter: HTMLElement | undefined
  let caughtContinuation: SafariBattleCaughtSequence['afterPresentation']
  let caughtCompletion: SafariBattleCaughtSequence['afterAllPresentation']

  const isPresentationRevisionCurrent = (
    revision: number,
    expectedOptions: SafariBattleStartOptions | undefined,
    entry?: HgssSafariBattlePresentationEntry,
  ): boolean => revision === unlockRevision && options === expectedOptions && state !== undefined
    && (entry === undefined || currentEntry === entry)

  const clearUnlockTimer = (): void => {
    unlockRevision += 1
    if (unlockTimer !== undefined) window.clearTimeout(unlockTimer)
    unlockTimer = undefined
    unlockTimerCallback = undefined
    inputLocked = false
    waitingForPageInput = false
    entryDelayStarted = false
    currentAnimation = Promise.resolve()
    currentSceneBarrier = Promise.resolve()
    currentPrinter?.close()
    currentPrinter = undefined
  }

  const scheduleUnlock = (callback: () => void, milliseconds: number): void => {
    unlockTimerCallback = callback
    unlockTimer = window.setTimeout(() => {
      unlockTimer = undefined
      unlockTimerCallback = undefined
      callback()
    }, milliseconds)
  }

  const finishUnlockTimer = (): boolean => {
    const callback = unlockTimerCallback
    if (!callback) return false
    if (unlockTimer !== undefined) window.clearTimeout(unlockTimer)
    unlockTimer = undefined
    unlockTimerCallback = undefined
    callback()
    return true
  }

  const selectCursor = (next: number, focus = true): void => {
    const buttons = [...elements.commands.querySelectorAll<HTMLButtonElement>('button')]
    if (buttons.length === 0) return
    const normalized = (next + buttons.length) % buttons.length
    cursor = buttons[normalized]?.disabled
      ? Math.max(0, buttons.findIndex((button) => !button.disabled))
      : normalized
    buttons.forEach((button, index) => {
      const current = !button.disabled && index === cursor
      button.tabIndex = current ? 0 : -1
      button.setAttribute('aria-current', String(current))
    })
    if (focus) buttons[cursor]?.focus({ preventScroll: true })
  }

  const syncCursorFromPresentation = (buttons: readonly HTMLButtonElement[]): void => {
    const selected = buttons.findIndex((button) => (
      !button.disabled && button.getAttribute('aria-current') === 'true'
    ))
    if (selected >= 0) cursor = selected
  }

  const renderBalls = (): Promise<void> => {
    if (!state || !options) return Promise.resolve()
    const entering = !ballsCounter
    ballsCounter ??= document.createElement('section')
    ballsCounter.className = 'battle-safari-balls'
    ballsCounter.setAttribute('aria-live', 'polite')
    const title = document.createElement('strong')
    title.textContent = requireBattleMessage(options.messages, 950)
    const count = document.createElement('span')
    count.textContent = formatHgssRomMessage(requireBattleMessage(options.messages, 951), [String(state.ballsRemaining)])
    ballsCounter.replaceChildren(title, count)
    elements.screen.querySelector('.battle-stage')?.append(ballsCounter)
    if (!entering || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return Promise.resolve()
    return new Promise((resolve) => window.setTimeout(resolve, hgssVBlanksToMilliseconds(18)))
  }

  const complete = (): void => {
    if (!state || !options || finished || state.outcome === 'active') return
    finished = true
    const { outcome } = state
    options.onFinish(outcome, state)
  }

  const renderCommands = (): void => {
    if (!state || !options || state.outcome !== 'active') {
      complete()
      return
    }
    currentEntry = undefined
    currentPages = []
    currentPageIndex = 0
    delete elements.screen.dataset.safariMessageAdvance
    delete elements.screen.dataset.safariMessagePageTransition
    const confirmHint = elements.screen.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
    if (confirmHint) confirmHint.hidden = false
    options.onPhaseChange?.('command')
    elements.message.hidden = true
    elements.moves.hidden = true
    elements.commands.replaceChildren(...hgssSafariBattleCommandMessages.map(({ action, messageId }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.battleCommand = resolveHgssSafariCommandLayoutSlot(action)
      button.dataset.safariAction = action
      button.textContent = requireBattleMessage(options!.messages, messageId)
      return button
    }))
    elements.commands.hidden = false
    selectCursor(cursor, false)
  }

  const finishCurrentEntry = async (revision: number): Promise<void> => {
    if (revision !== unlockRevision || !currentEntry) return
    if (unlockTimer !== undefined) window.clearTimeout(unlockTimer)
    unlockTimer = undefined
    unlockTimerCallback = undefined
    inputLocked = true
    const entry = currentEntry
    const entryOptions = options
    const deferredAnimation = entry.animationTiming === 'after-message'
      ? Promise.resolve().then(() => isPresentationRevisionCurrent(revision, entryOptions, entry)
        ? entry.animation && entryOptions?.onAnimation?.(entry.animation, entry)
        : undefined).catch(() => undefined)
      : currentAnimation
    await Promise.allSettled([deferredAnimation, currentSceneBarrier])
    if (!isPresentationRevisionCurrent(revision, entryOptions, entry)) return
    currentEntry = undefined
    inputLocked = false
    showNextEntry()
  }

  const beginEntryDelay = (revision: number): void => {
    if (revision !== unlockRevision || !currentEntry) return
    entryDelayStarted = true
    inputLocked = currentEntry.advance === 'automatic'
    elements.screen.dataset.safariMessageAdvance = currentEntry.advance
    const confirmHint = elements.screen.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
    if (confirmHint) confirmHint.hidden = currentEntry.advance === 'automatic'
    scheduleUnlock(() => { void finishCurrentEntry(revision) }, hgssVBlanksToMilliseconds(currentEntry.minimumFrames ?? 0))
  }

  /** `BtlCmd_Wait` ne passe au délai du script qu'au tick suivant. */
  const finishPrinter = (revision: number): void => {
    if (revision !== unlockRevision || !currentEntry) return
    inputLocked = true
    waitingForPageInput = false
    elements.screen.dataset.safariMessageAdvance = 'automatic'
    const confirmHint = elements.screen.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
    if (confirmHint) confirmHint.hidden = true
    scheduleUnlock(() => {
      if (revision !== unlockRevision || !currentEntry) return
      const entry = currentEntry
      const entryOptions = options
      currentSceneBarrier = Promise.resolve().then(() => {
        if (!isPresentationRevisionCurrent(revision, entryOptions, entry)) return
        return entry.sceneCues?.afterPrinter === 'safari-gauge'
          ? renderBalls()
          : entry.sceneCues?.afterPrinter && entryOptions?.onSceneCue?.(entry.sceneCues.afterPrinter, entry)
      }).catch(() => undefined)
      if (entry.sceneCues?.afterPrinterTiming === 'before-delay') {
        void currentSceneBarrier.catch(() => undefined).then(() => {
          if (!isPresentationRevisionCurrent(revision, entryOptions, entry)) return
          currentSceneBarrier = Promise.resolve()
          beginEntryDelay(revision)
        })
      } else beginEntryDelay(revision)
    }, hgssVBlankDurationMs)
  }

  const showCurrentPage = (revision: number): void => {
    if (revision !== unlockRevision || !currentEntry) return
    const entry = currentEntry
    const entryOptions = options
    const page = currentPages[currentPageIndex]
    if (!page) throw new Error(`La page ${currentPageIndex} du message Safari ${entry.messageId} est absente.`)
    currentPrinter?.close()
    elements.screen.dataset.safariMessagePageTransition = page.waitForInput ?? 'none'
    elements.screen.dataset.safariMessageAdvance = 'automatic'
    const confirmHint = elements.screen.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
    if (confirmHint) confirmHint.hidden = true
    inputLocked = true
    waitingForPageInput = false
    entryDelayStarted = false
    currentPrinter = playHgssBattleMessagePrinterPage(page, {
      delayFrames: entryOptions?.textDelayFrames ?? 4,
      onText: (text) => { if (isPresentationRevisionCurrent(revision, entryOptions, entry)) elements.message.textContent = text },
      onControl: (control) => isPresentationRevisionCurrent(revision, entryOptions, entry) ? entryOptions?.onMessageControl?.(control) : undefined,
      onComplete: () => {
        if (!isPresentationRevisionCurrent(revision, entryOptions, entry)) return
        currentPrinter = undefined
        if (page.waitForInput) {
          inputLocked = false
          waitingForPageInput = true
          elements.screen.dataset.safariMessageAdvance = 'input-required'
          if (confirmHint) confirmHint.hidden = false
        } else finishPrinter(revision)
      },
    })
  }

  const presentCurrentEntry = (revision: number, onStart?: () => void): void => {
    if (revision !== unlockRevision || !currentEntry) return
    unlockTimer = undefined
    const entry = currentEntry
    const entryOptions = options
    entryOptions?.onPhaseChange?.('message')
    const show = (): void => {
      if (!isPresentationRevisionCurrent(revision, entryOptions, entry)) return
      elements.message.hidden = false
      entryOptions?.onAudio?.(entry)
      elements.message.textContent = ''
      onStart?.()
      showCurrentPage(revision)
    }
    const cue = entry.sceneCues?.beforeMessage
    if (!cue || !entryOptions?.onSceneCue) show()
    else void Promise.resolve().then(() => isPresentationRevisionCurrent(revision, entryOptions, entry)
      ? entryOptions.onSceneCue?.(cue, entry)
      : undefined).catch(() => undefined).then(show)
  }

  const showNextEntry = (): void => {
    clearUnlockTimer()
    const queued = queue.shift()
    if (!queued) {
      currentEntry = undefined
      const continuation = caughtContinuation
      caughtContinuation = undefined
      if (continuation) {
        const revision = ++unlockRevision
        const continuationOptions = options
        inputLocked = true
        elements.commands.hidden = true
        elements.moves.hidden = true
        void Promise.resolve().then(() => isPresentationRevisionCurrent(revision, continuationOptions)
          ? continuation()
          : undefined).then(
          (entries) => {
            if (!entries || !isPresentationRevisionCurrent(revision, continuationOptions)) return
            inputLocked = false
            queue = entries.map((entry) => ({ entry }))
            showNextEntry()
          },
          () => {
            if (!isPresentationRevisionCurrent(revision, continuationOptions)) return
            inputLocked = false
            showNextEntry()
          },
        )
        return
      }
      const completion = caughtCompletion
      caughtCompletion = undefined
      if (completion) {
        const revision = ++unlockRevision
        const completionOptions = options
        inputLocked = true
        void Promise.resolve().then(() => isPresentationRevisionCurrent(revision, completionOptions)
          ? completion()
          : undefined).catch(() => undefined).then(() => {
          if (!isPresentationRevisionCurrent(revision, completionOptions)) return
          inputLocked = false
          renderCommands()
        })
        return
      }
      renderCommands()
      return
    }
    const { entry } = queued
    const entryOptions = options
    currentEntry = entry
    elements.commands.hidden = true
    elements.moves.hidden = true
    elements.message.hidden = true
    currentPages = createHgssBattleMessagePrinterPages(requireBattleMessage(entryOptions!.messages, entry.messageId), entry.values)
    currentPageIndex = 0
    entryOptions?.onPresentationReset?.()
    const revision = ++unlockRevision
    currentAnimation = entry.animationTiming === 'after-message'
      ? Promise.resolve()
      : Promise.resolve().then(() => isPresentationRevisionCurrent(revision, entryOptions, entry)
        ? entry.animation && entryOptions?.onAnimation?.(entry.animation, entry)
        : undefined).catch(() => undefined)
    inputLocked = true
    if ((entry.beforeFrames ?? 0) > 0) {
      scheduleUnlock(() => presentCurrentEntry(revision, queued.onStart), hgssVBlanksToMilliseconds(entry.beforeFrames!))
    } else presentCurrentEntry(revision, queued.onStart)
  }

  const performAction = (action: typeof hgssSafariBattleCommandMessages[number]['action']): void => {
    if (!state || !options || currentEntry || state.outcome !== 'active') return
    const attempt = attemptHgssSafariBattleAction(state, action, options.context, options.actionPolicy)
    if (!attempt.accepted) {
      options.onActionVeto?.(attempt.veto, attempt.action, attempt.state)
      return
    }
    const { turn } = attempt
    state = turn.state
    options.onStateChange(state)
    void renderBalls()
    queue = resolveHgssSafariBattleTurnPresentation(turn, options.names).map((entry) => ({ entry }))
    if (state.outcome === 'caught') {
      const caught = options.onCaught?.(state)
      if (caught) {
        queue.push(...caught.presentation.map((entry, index) => ({
          entry,
          onStart: index === 0 ? caught.onPresentationStart : undefined,
        })))
        caughtContinuation = caught.afterPresentation
        caughtCompletion = caught.afterAllPresentation
      }
    }
    showNextEntry()
  }

  const close = (): void => {
    clearUnlockTimer()
    options = undefined
    state = undefined
    queue = []
    currentEntry = undefined
    currentPages = []
    currentPageIndex = 0
    caughtContinuation = undefined
    caughtCompletion = undefined
    finished = false
    ballsCounter?.remove()
    ballsCounter = undefined
    elements.screen.classList.remove('is-safari-battle')
    delete elements.screen.dataset.battleKind
    delete elements.screen.dataset.safariMessageAdvance
    delete elements.screen.dataset.safariMessagePageTransition
    const confirmHint = elements.screen.querySelector<HTMLButtonElement>('[data-battle-control="confirm"]')
    if (confirmHint) confirmHint.hidden = false
  }

  return {
    start(nextOptions) {
      close()
      options = nextOptions
      state = nextOptions.state
      finished = false
      cursor = 0
      elements.screen.classList.add('is-safari-battle')
      elements.screen.dataset.battleKind = 'safari'
      queue = createHgssSafariBattleIntroduction(nextOptions.names).map((entry) => ({ entry }))
      elements.screen.hidden = false
      showNextEntry()
    },
    handle(action, pressed = true) {
      if (!options || !state) return false
      if (inputLocked && !currentEntry) return true
      if (currentEntry) {
        const printerButton = action === 'confirm' || action === 'cancel'
        // WaitButton utilise le masque DS A/B/X/Y. Y partage désormais
        // l'action Menu avec les accès de secours Start/Select du Steam Deck.
        const timedWaitButton = printerButton || action === 'secondary' || action === 'tertiary' || action === 'menu'
        if (currentPrinter?.isPrinting() && printerButton) { if (pressed) options.onFastForward?.(); currentPrinter.setFastForward(pressed); return true }
        if (!pressed) return true
        if (printerButton && inputLocked) {
          const accelerated = options.onFastForward?.() ?? false
          if (finishUnlockTimer() || accelerated) return true
        }
        if (!inputLocked) {
          if (waitingForPageInput && printerButton) {
            void options.onMessageControl?.(hgssBattleMessagePrinterContinueControl)
            waitingForPageInput = false
            if (currentPageIndex + 1 < currentPages.length) {
              currentPageIndex += 1
              showCurrentPage(++unlockRevision)
            } else finishPrinter(unlockRevision)
          } else if (entryDelayStarted && timedWaitButton && currentEntry.advance === 'input-or-timeout') {
            options.onFastForward?.()
            void finishCurrentEntry(unlockRevision)
          }
        }
        return true
      }
      // Le routeur émet aussi le relâchement physique. Une commande de combat
      // DS ne déplace/valide le curseur que sur le front d'appui.
      if (!pressed) return true
      if (action === 'left' || action === 'right' || action === 'up' || action === 'down') {
        const buttons = [...elements.commands.querySelectorAll<HTMLButtonElement>('button')]
        syncCursorFromPresentation(buttons)
        selectCursor(moveHgssSafariCommandCursor(cursor, action, buttons.map((button) => !button.disabled)))
        return true
      }
      if (action === 'confirm') {
        const buttons = [...elements.commands.querySelectorAll<HTMLButtonElement>('button')]
        syncCursorFromPresentation(buttons)
        const actionValue = buttons[cursor]?.dataset.safariAction
        if (actionValue === 'ball' || actionValue === 'bait' || actionValue === 'mud' || actionValue === 'run') performAction(actionValue)
        return true
      }
      return true
    },
    isActive: () => options !== undefined && state !== undefined,
    getState: () => state,
    close,
  }
}
