import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { mapKeyboardAction, shouldPreventGameplayBrowserDefault, type GameDigitalEvent } from '../../gameInput'
import {
  createBrowserMultiplayerRuntime,
  type BrowserMultiplayerRuntime,
  type BrowserMultiplayerRuntimeOptions,
} from './browserMultiplayerRuntime'
import {
  createHgssBrowserMultiplayerGameAdapter,
  type HgssBrowserMultiplayerGameContext,
} from './hgssBrowserMultiplayerGameAdapter'
import {
  createHgssP2pTradePartyPicker,
  type HgssP2pTradePartyPicker,
} from './hgssP2pTradePartyPicker'
import type { MultiplayerUiPresentationEvent } from '../ui/multiplayerUiShell'
import type { GameTextEntryOverlay } from '../ui/gameTextEntryOverlay'
import { createModalFocusBoundary } from '../ui/modalFocusBoundary'
import type { BrowserMultiplayerCampaignPort } from './browserMultiplayerCampaignPort'
import { resolveMultiplayerRomLabels } from '../ui/multiplayerRomLabels'

export const hgssMultiplayerUiSoundEffects = Object.freeze({
  select: 1500,
  cursor: 1509,
  page: 1505,
  yesNo: 1508,
  unavailable: 1523,
  exchange: 1692,
})

export type HgssBrowserMultiplayerHostOptions = Readonly<{
  panel: HTMLElement
  /** Conserve le lanceur flottant pour les intégrateurs qui n'ont pas de menu burger. */
  showLauncher?: boolean
  readContext: () => HgssBrowserMultiplayerGameContext | undefined
  /** Retourne la raison présentable qui interdit actuellement l'ouverture. */
  getOpenBlocker?: () => string | undefined
  persistState: (state: FieldScriptState) => Promise<void> | void
  publishState: (state: FieldScriptState) => void
  reportStatus?: (message: string) => void
  /** Séquences déjà décodées depuis la ROM HGSS. */
  playSoundEffect?: (sequenceId: number) => Promise<unknown> | void
  onOpen?: () => void
  onClose?: () => void
  /** Saisie partagée par le titre, le terrain et le multijoueur. */
  textEntry: GameTextEntryOverlay
  /** Tranche campagne applicative concrète; son absence garde Coop masquée. */
  campaign?: BrowserMultiplayerCampaignPort
  runtimeOptions?: Omit<BrowserMultiplayerRuntimeOptions, 'root' | 'game'>
  runtimeFactory?: typeof createBrowserMultiplayerRuntime
}>

export type HgssBrowserMultiplayerHost = Readonly<{
  open: () => void
  close: () => void
  isOpen: () => boolean
  handleDigitalEvent: (event: GameDigitalEvent) => boolean
  /** Draine et détache le réseau sans détruire la coque restaurable par le bfcache. */
  prepareForPageRelease: () => Promise<void>
  destroy: () => Promise<void>
}>

function requireContext(
  readContext: HgssBrowserMultiplayerHostOptions['readContext'],
): HgssBrowserMultiplayerGameContext {
  const context = readContext()
  if (!context?.state.pokemonRuntime) {
    throw new Error('Chargez une ROM et ouvrez une partie avant le multijoueur.')
  }
  return context
}

function createButton(document: Document, label: string, className: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = className
  button.textContent = label
  return button
}

const multiplayerDigitalControlSelector = 'button, input, select, textarea, a[href]'

function isDigitalControlAvailable(control: HTMLElement, boundary: HTMLElement): boolean {
  const candidate = control as HTMLElement & { disabled?: boolean; inert?: boolean; type?: string }
  if (candidate.disabled || candidate.hidden || candidate.inert || candidate.type === 'hidden'
    || candidate.getAttribute('aria-disabled') === 'true') return false
  for (let ancestor = control.parentElement; ancestor && ancestor !== boundary; ancestor = ancestor.parentElement) {
    if (ancestor.hidden || ancestor.inert || ancestor.getAttribute('aria-hidden') === 'true') return false
  }
  return true
}

function getMultiplayerDigitalControls(root: HTMLElement): HTMLElement[] {
  return [...root.querySelectorAll<HTMLElement>(multiplayerDigitalControlSelector)]
    .filter((control) => isDigitalControlAvailable(control, root))
}

function moveMultiplayerControl(
  controls: readonly HTMLElement[],
  activeIndex: number,
  action: 'up' | 'down' | 'left' | 'right' | 'page-previous' | 'page-next',
): HTMLElement | undefined {
  if (controls.length === 0) return undefined
  const forward = action === 'down' || action === 'right' || action === 'page-next'
  if (activeIndex < 0) return controls[forward ? 0 : controls.length - 1]
  const origin = controls[activeIndex]
  const originRect = origin?.getBoundingClientRect?.()
  if (!origin || !originRect || originRect.width === 0 && originRect.height === 0) {
    return controls[(activeIndex + (forward ? 1 : -1) + controls.length) % controls.length]
  }
  const horizontal = action === 'left' || action === 'right' || action === 'page-previous' || action === 'page-next'
  const direction = forward ? 1 : -1
  const originPrimary = horizontal ? originRect.left + originRect.width / 2 : originRect.top + originRect.height / 2
  const originSecondary = horizontal ? originRect.top + originRect.height / 2 : originRect.left + originRect.width / 2
  let best: { control: HTMLElement, score: number } | undefined
  controls.forEach((control, index) => {
    if (index === activeIndex) return
    const rect = control.getBoundingClientRect()
    const primary = horizontal ? rect.left + rect.width / 2 : rect.top + rect.height / 2
    const secondary = horizontal ? rect.top + rect.height / 2 : rect.left + rect.width / 2
    const primaryDistance = (primary - originPrimary) * direction
    if (primaryDistance <= 1) return
    const secondaryDistance = Math.abs(secondary - originSecondary)
    const score = primaryDistance * 1000 + secondaryDistance * 8 + Math.hypot(primaryDistance, secondaryDistance)
    if (!best || score < best.score) best = { control, score }
  })
  return best?.control ?? controls[(activeIndex + (forward ? 1 : -1) + controls.length) % controls.length]
}

/**
 * Coque autonome du produit en ligne. Main ne lui fournit que l'état local,
 * la persistance atomique et les ressources déjà décodées depuis la ROM.
 */
export function createHgssBrowserMultiplayerHost(
  options: HgssBrowserMultiplayerHostOptions,
): HgssBrowserMultiplayerHost {
  const { panel } = options
  const document = panel.ownerDocument
  const showLauncher = options.showLauncher !== false
  const launcher = createButton(document, 'En ligne', 'multiplayer-launcher')
  launcher.setAttribute('aria-haspopup', 'dialog')
  launcher.setAttribute('aria-expanded', 'false')
  const overlay = document.createElement('section')
  overlay.className = 'multiplayer-overlay'
  overlay.hidden = true
  overlay.tabIndex = -1
  overlay.setAttribute('role', 'dialog')
  overlay.setAttribute('aria-modal', 'true')
  overlay.setAttribute('aria-labelledby', 'multiplayer-overlay-title')
  const frame = document.createElement('div')
  frame.className = 'multiplayer-overlay-frame'
  const header = document.createElement('header')
  header.className = 'multiplayer-overlay-header'
  const title = document.createElement('h2')
  title.id = 'multiplayer-overlay-title'
  title.textContent = 'Multijoueur'
  const closeButton = createButton(document, 'Fermer', 'multiplayer-overlay-close')
  const shellRoot = document.createElement('div')
  shellRoot.className = 'multiplayer-overlay-content'
  const pickerRoot = document.createElement('div')
  pickerRoot.hidden = true
  header.append(title, closeButton)
  frame.append(header, shellRoot)
  overlay.append(frame, pickerRoot)
  if (showLauncher) panel.append(launcher)
  panel.append(overlay)

  let runtime: BrowserMultiplayerRuntime | undefined
  let picker: HgssP2pTradePartyPicker | undefined
  let pageReleaseOperation: Promise<void> | undefined
  let destroyed = false
  let textEntryInputKind: string | undefined
  const focusBoundary = createModalFocusBoundary({
    host: panel,
    root: overlay,
    getFocusableElements: () => getMultiplayerDigitalControls(pickerRoot.hidden ? overlay : pickerRoot),
  })

  const playSound = (sequenceId: number): void => {
    try { void Promise.resolve(options.playSoundEffect?.(sequenceId)).catch(() => undefined) }
    catch { /* Le feedback audio ne doit jamais interrompre l'interface. */ }
  }
  const present = (event: MultiplayerUiPresentationEvent): void => {
    const sequenceId = event.kind === 'trade-committing'
      ? hgssMultiplayerUiSoundEffects.exchange
      : event.kind === 'trade-committed' || event.kind === 'connected' || event.kind === 'session-ready'
        ? hgssMultiplayerUiSoundEffects.select
        : event.kind === 'error'
          ? hgssMultiplayerUiSoundEffects.unavailable
          : hgssMultiplayerUiSoundEffects.yesNo
    playSound(sequenceId)
  }
  const textEntry = options.textEntry

  const syncSharedTextEntryInputs = (): void => {
    for (const input of shellRoot.querySelectorAll<HTMLInputElement>('[data-multiplayer-input]')) {
      input.readOnly = true
      input.inputMode = 'none'
      input.setAttribute('aria-haspopup', 'dialog')
    }
  }
  const sharedTextEntryInputObserver = document.defaultView
    ? new document.defaultView.MutationObserver(syncSharedTextEntryInputs)
    : undefined
  sharedTextEntryInputObserver?.observe(shellRoot, { childList: true, subtree: true })

  const readTextEntryInput = (kind = textEntryInputKind): HTMLInputElement | undefined => kind
    ? shellRoot.querySelector<HTMLInputElement>(`[data-multiplayer-input="${kind}"]`) ?? undefined
    : undefined

  const finishTextEntry = (kind: string, value?: string): void => {
    const input = readTextEntryInput(kind)
    if (input && value !== undefined) {
      input.value = value
      input.dispatchEvent(new Event('input', { bubbles: true }))
    }
    textEntryInputKind = undefined
    input?.focus({ preventScroll: true })
  }

  const openTextEntry = (input: HTMLInputElement): boolean => {
    const kind = input.dataset.multiplayerInput
    if (!kind || textEntry.isOpen()) return false
    input.readOnly = true
    textEntryInputKind = kind
    const resolveInput = () => readTextEntryInput(kind)
    const write = (value: string): void => {
      const current = resolveInput()
      if (!current) return
      current.value = value
      current.dispatchEvent(new Event('input', { bubbles: true }))
    }
    textEntry.open({
      // Afficher/Masquer change volontairement `type`; l'identité fonctionnelle
      // du champ reste la seule source fiable pour choisir son clavier.
      mode: kind.endsWith('-password') ? 'password' : 'account',
      title: input.placeholder || input.getAttribute('aria-label') || 'Saisie',
      maxLength: input.maxLength > 0 ? input.maxLength : undefined,
      cancellable: true,
      read: () => resolveInput()?.value ?? '',
      write,
      submit: (value) => { finishTextEntry(kind, value) },
      cancel: () => { finishTextEntry(kind) },
    })
    return true
  }

  const tradeIsLocked = (): boolean => {
    const trade = runtime?.getSnapshot().trade
    return trade !== undefined && trade.status !== 'closed' && trade.locked === true
  }

  const ensureRuntime = (): BrowserMultiplayerRuntime => {
    if (runtime) return runtime
    const context = requireContext(options.readContext)
    const uiLabels = resolveMultiplayerRomLabels(context.uiMessageBanks)
    closeButton.textContent = uiLabels.close
    const adapter = createHgssBrowserMultiplayerGameAdapter({
      readContext: options.readContext,
      choosePokemon: (currentPokemonId?: PokemonInstanceId) => {
        if (!picker) throw new Error("Le sélecteur d'équipe multijoueur n'est pas prêt.")
        return picker.choose(currentPokemonId)
      },
      cancelPokemon: () => { picker?.cancel() },
      persistState: options.persistState,
      publishState: options.publishState,
      reportStatus: options.reportStatus,
    })
    picker = createHgssP2pTradePartyPicker({
      root: pickerRoot,
      readParty: () => requireContext(options.readContext).state.party.members,
      getHeldItemName: (itemId) => requireContext(options.readContext).itemCatalog?.items[itemId]?.name,
      createPokemonVisual: (pokemon) => requireContext(options.readContext).createPokemonVisual?.({
        speciesId: pokemon.speciesId,
        form: pokemon.form,
        isEgg: pokemon.isEgg,
        shiny: pokemon.shiny,
        gender: pokemon.gender,
      }),
      isPokemonReserved: adapter.escrow.isPokemonReserved,
    })
    const runtimeOptions = options.runtimeOptions
    runtime = (options.runtimeFactory ?? createBrowserMultiplayerRuntime)({
      root: shellRoot,
      game: options.campaign
        ? Object.freeze({ ...adapter.game, campaign: options.campaign })
        : adapter.game,
      ...runtimeOptions,
      uiLabels,
      uiPresentation: (event) => {
        runtimeOptions?.uiPresentation?.(event)
        present(event)
      },
    })
    return runtime
  }

  const hide = (): void => {
    if (overlay.hidden) return
    picker?.cancel()
    if (textEntryInputKind && textEntry.isOpen()) textEntry.close()
    overlay.hidden = true
    launcher.setAttribute('aria-expanded', 'false')
    focusBoundary.restore()
    options.onClose?.()
  }

  const close = (): void => {
    if (tradeIsLocked()) {
      options.reportStatus?.("L'échange est en cours de sécurisation. Attendez sa confirmation avant de fermer le multijoueur.")
      return
    }
    playSound(hgssMultiplayerUiSoundEffects.page)
    hide()
  }

  const open = (): void => {
    if (destroyed || !overlay.hidden) return
    const blocker = options.getOpenBlocker?.()
    if (blocker) {
      options.reportStatus?.(blocker)
      return
    }
    try {
      const activeRuntime = ensureRuntime()
      syncSharedTextEntryInputs()
      focusBoundary.activate()
      overlay.hidden = false
      options.onOpen?.()
      playSound(hgssMultiplayerUiSoundEffects.page)
      launcher.setAttribute('aria-expanded', 'true')
      const connected = activeRuntime.getSnapshot().connection.status === 'connected'
      const initialFocus = connected
        ? shellRoot.querySelector<HTMLElement>('[data-multiplayer-global-target="play"]')
          ?? shellRoot.querySelector<HTMLElement>('[data-multiplayer-hub-shortcut="pvp"]')
          ?? shellRoot.querySelector<HTMLElement>('[data-multiplayer-input="friend-id"]')
          ?? shellRoot.querySelector<HTMLElement>('[data-multiplayer-action="refresh-social"]')
        : shellRoot.querySelector<HTMLElement>('[data-multiplayer-input="login-username"]')
          ?? shellRoot.querySelector<HTMLElement>('[data-multiplayer-action="retry-connection"]')
          ?? shellRoot.querySelector<HTMLElement>('[data-multiplayer-action="logout"]')
      ;(initialFocus ?? closeButton).focus({ preventScroll: true })
    } catch (value) {
      overlay.hidden = true
      focusBoundary.restore()
      options.reportStatus?.(value instanceof Error ? value.message : 'Le multijoueur ne peut pas être ouvert.')
    }
  }

  const handleDigitalEvent = (event: GameDigitalEvent): boolean => {
    if (overlay.hidden) return false
    if (textEntryInputKind && textEntry.isOpen()) return textEntry.handle(event)
    if (!event.pressed) return true
    if (event.action === 'cancel' || event.action === 'menu') {
      if (!pickerRoot.hidden) {
        playSound(hgssMultiplayerUiSoundEffects.page)
        picker?.cancel()
      } else if (shellRoot.dataset.multiplayerCurrentScreen
        && shellRoot.dataset.multiplayerCurrentScreen !== 'home'
        && shellRoot.dataset.multiplayerCurrentScreen !== 'auth') {
        shellRoot.querySelector<HTMLButtonElement>('[data-multiplayer-action="back-global-menu"]')?.click()
      } else close()
      return true
    }
    const boundary = pickerRoot.hidden ? overlay : pickerRoot
    const controls = getMultiplayerDigitalControls(boundary)
    if (controls.length === 0) return true
    const activeIndex = controls.indexOf(document.activeElement as HTMLElement)
    if (event.action === 'up' || event.action === 'left' || event.action === 'page-previous'
      || event.action === 'down' || event.action === 'right' || event.action === 'page-next') {
      const next = moveMultiplayerControl(controls, activeIndex, event.action)
      if (next && next !== controls[activeIndex]) playSound(hgssMultiplayerUiSoundEffects.cursor)
      next?.focus({ preventScroll: true })
      return true
    }
    if (event.action === 'confirm') {
      const active = controls[activeIndex]
      if (active?.tagName.toLowerCase() === 'input') {
        if (openTextEntry(active as HTMLInputElement)) playSound(hgssMultiplayerUiSoundEffects.select)
      }
      else if (active && !['input', 'textarea', 'select'].includes(active.tagName.toLowerCase())) active.click()
      else (active ?? controls[0])?.focus({ preventScroll: true })
      return true
    }
    return true
  }

  const stopGameInput = (event: Event): void => {
    if (overlay.hidden) return
    event.stopPropagation()
  }
  const isSharedTextEntryTarget = (target: EventTarget | null): boolean => {
    const candidate = target as { closest?: (selector: string) => Element | null } | null
    const input = candidate?.closest?.('[data-multiplayer-input]')
    return input !== null && input !== undefined && shellRoot.contains(input)
  }
  const handleOverlayKey = (event: KeyboardEvent): void => {
    if (overlay.hidden) return
    if (focusBoundary.handleTab(event)) return
    const action = mapKeyboardAction(event)
    // Ces champs sont des lanceurs readonly du clavier central, pas des zones
    // d'édition natives : Entrée, les directions et Retour restent numériques.
    if (action && (isSharedTextEntryTarget(event.target) || shouldPreventGameplayBrowserDefault(event))) {
      event.preventDefault()
      if (!event.repeat || !['confirm', 'cancel', 'menu'].includes(action)) {
        handleDigitalEvent({ action, pressed: true, source: 'keyboard', inputId: event.key })
      }
    }
    event.stopPropagation()
  }
  const handleBackdrop = (event: MouseEvent): void => {
    if (event.target === overlay) close()
  }
  const handleInputPointer = (event: PointerEvent): void => {
    const input = (event.target as Element | null)?.closest('[data-multiplayer-input]') as HTMLInputElement | null
    if (!input || !shellRoot.contains(input)) return
    event.preventDefault()
    if (openTextEntry(input)) playSound(hgssMultiplayerUiSoundEffects.select)
  }
  const handleInputClick = (event: MouseEvent): void => {
    const input = (event.target as Element | null)?.closest('[data-multiplayer-input]') as HTMLInputElement | null
    if (!input || !shellRoot.contains(input)) return
    event.preventDefault()
    if (openTextEntry(input)) playSound(hgssMultiplayerUiSoundEffects.select)
  }
  const handleControlClick = (event: Event): void => {
    const control = (event.target as Element | null)?.closest('button') as HTMLButtonElement | null
    if (!control || !shellRoot.contains(control) || control.disabled) return
    const action = control.dataset.multiplayerAction
    playSound(action === 'back-global-menu' || action === 'open-global-screen'
      ? hgssMultiplayerUiSoundEffects.page
      : hgssMultiplayerUiSoundEffects.select)
  }
  launcher.addEventListener('click', open)
  closeButton.addEventListener('click', close)
  overlay.addEventListener('keydown', handleOverlayKey, true)
  overlay.addEventListener('keyup', stopGameInput)
  overlay.addEventListener('pointerdown', stopGameInput)
  shellRoot.addEventListener('pointerdown', handleInputPointer)
  shellRoot.addEventListener('click', handleInputClick)
  overlay.addEventListener('click', handleBackdrop)
  overlay.addEventListener('click', handleControlClick, true)

  const prepareForPageRelease = (): Promise<void> => {
    if (pageReleaseOperation) return pageReleaseOperation
    if (!overlay.hidden) hide()
    const activeRuntime = runtime
    const operation = Promise.resolve(activeRuntime?.prepareForPageRelease()).finally(() => {
      if (pageReleaseOperation === operation) pageReleaseOperation = undefined
    })
    pageReleaseOperation = operation
    return operation
  }

  return Object.freeze({
    open,
    close,
    isOpen: () => !overlay.hidden,
    handleDigitalEvent,
    prepareForPageRelease,
    async destroy() {
      if (destroyed) return
      destroyed = true
      await pageReleaseOperation?.catch(() => undefined)
      if (!overlay.hidden) hide()
      launcher.removeEventListener('click', open)
      closeButton.removeEventListener('click', close)
      overlay.removeEventListener('keydown', handleOverlayKey, true)
      overlay.removeEventListener('keyup', stopGameInput)
      overlay.removeEventListener('pointerdown', stopGameInput)
      shellRoot.removeEventListener('pointerdown', handleInputPointer)
      shellRoot.removeEventListener('click', handleInputClick)
      overlay.removeEventListener('click', handleBackdrop)
      overlay.removeEventListener('click', handleControlClick, true)
      picker?.destroy()
      picker = undefined
      await runtime?.destroy()
      runtime = undefined
      sharedTextEntryInputObserver?.disconnect()
      launcher.remove()
      overlay.remove()
    },
  })
}
