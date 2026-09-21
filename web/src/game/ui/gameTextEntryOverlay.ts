import { mapKeyboardAction, type GameDigitalEvent } from '../../gameInput'

export type GameTextEntryMode = 'name' | 'account' | 'password' | 'text' | 'multiline' | 'number'

export type GameTextEntryRequest = {
  mode: GameTextEntryMode
  title: string
  label?: string
  placeholder?: string
  maxLength?: number
  min?: number
  max?: number
  step?: number
  cancellable?: boolean
  invalidMessage?: string
  read: () => string
  write: (value: string) => void
  submit: (value: string) => void
  cancel: () => void
  validate?: (value: string) => boolean
}

export type GameTextEntryFeedback = 'move' | 'write' | 'erase' | 'page' | 'submit' | 'cancel' | 'invalid'

export type GameTextEntryOverlayOptions = {
  onFeedback?: (feedback: GameTextEntryFeedback) => void
}

export type GameTextEntryOverlay = {
  open: (request: GameTextEntryRequest) => void
  close: () => void
  submitCurrent: () => boolean
  refresh: () => void
  isOpen: () => boolean
  handle: (event: GameDigitalEvent) => boolean
  handleKeyboard: (event: KeyboardEvent, pressed: boolean) => boolean
  destroy: () => void
}

export type GameTextEntryConstraints = Pick<GameTextEntryRequest, 'maxLength' | 'min' | 'max' | 'step'>
export type GameTextEntryDirection = 'left' | 'right' | 'up' | 'down'
export type GameTextEntryKeyKind = 'character' | 'space' | 'line-break' | 'backspace' | 'page' | 'submit'

export type GameTextEntryKey = Readonly<{
  id: string
  kind: GameTextEntryKeyKind
  label: string
  ariaLabel: string
  value?: string
}>

export type GameTextEntryKeyResult = Readonly<{
  value: string
  action: 'none' | 'write' | 'erase' | 'page' | 'submit'
}>

type InertSiblingSnapshot = {
  element: HTMLElement
  inert: boolean
  ariaHidden: string | null
}

type RootAccessibilitySnapshot = {
  inert: boolean
  ariaHidden: string | null
}

const modes = new Set<GameTextEntryMode>(['name', 'account', 'password', 'text', 'multiline', 'number'])
const lowerAlphabet = [...'abcdefghijklmnopqrstuvwxyz']
const upperAlphabet = [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ']
const digits = [...'0123456789']
const textSymbols = [..."0123456789.,!?@#$%&*+-_=:/\\()[]{}'\""]
const accountSymbols = [...'0123456789@._-']
const defaultMaxLengths: Readonly<Record<GameTextEntryMode, number>> = {
  name: 10,
  account: 32,
  password: 128,
  text: 256,
  multiline: 2000,
  number: 16,
}

const maximumMaxLengths: Readonly<Record<GameTextEntryMode, number>> = {
  name: 1024,
  account: 1024,
  password: 1024,
  text: 1024,
  multiline: 2000,
  number: 1024,
}

let nextOverlayId = 0

function getMaxLength(mode: GameTextEntryMode, constraints: GameTextEntryConstraints): number {
  const requested = constraints.maxLength
  return requested === undefined
    ? defaultMaxLengths[mode]
    : Math.max(0, Math.min(maximumMaxLengths[mode], Math.floor(requested)))
}

function withoutLineControls(value: string, preserveLineBreaks: boolean): string {
  const normalizedLineEndings = preserveLineBreaks
    ? value.replace(/\r\n?|\u2028|\u2029/g, '\n')
    : value
  return [...normalizedLineEndings].filter((character) => {
    if (preserveLineBreaks && character === '\n') return true
    const code = character.charCodeAt(0)
    return code >= 32 && code !== 127
  }).join('')
}

function allowsNegative(constraints: GameTextEntryConstraints): boolean {
  return constraints.min === undefined || constraints.min < 0
}

function truncateValue(value: string, maxLength: number): string {
  return [...value].slice(0, maxLength).join('')
}

function normalizeNumber(value: string, negativeAllowed: boolean): string {
  const negative = negativeAllowed && value.trimStart().startsWith('-')
  let decimal = false
  let result = negative ? '-' : ''
  for (const character of value) {
    if (/\d/.test(character)) result += character
    else if ((character === '.' || character === ',') && !decimal) {
      result += '.'
      decimal = true
    }
  }
  return result
}

/** Normalise every write, including pasted or autofilled values. */
export function normalizeGameTextEntryValue(
  mode: GameTextEntryMode,
  value: string,
  constraints: GameTextEntryConstraints = {},
): string {
  const maxLength = getMaxLength(mode, constraints)
  let normalized = withoutLineControls(value, mode === 'multiline')
  if (mode === 'name') normalized = normalized.toUpperCase().replace(/[^A-Z0-9 -]/g, '')
  else if (mode === 'account') normalized = normalized.replace(/[^A-Za-z0-9@._-]/g, '')
  else if (mode === 'number') normalized = normalizeNumber(normalized, allowsNegative(constraints))
  return truncateValue(normalized, maxLength)
}

/** Applies numeric bounds and step only when the value is submitted. */
export function finalizeGameTextEntryValue(
  mode: GameTextEntryMode,
  value: string,
  constraints: GameTextEntryConstraints = {},
): string {
  const normalized = normalizeGameTextEntryValue(mode, value, constraints)
  if (mode !== 'number' || normalized === '' || normalized === '-') return normalized
  let number = Number(normalized)
  if (!Number.isFinite(number)) return normalized
  if (constraints.min !== undefined) number = Math.max(constraints.min, number)
  if (constraints.max !== undefined) number = Math.min(constraints.max, number)
  if (constraints.step !== undefined) {
    const origin = constraints.min ?? 0
    number = origin + Math.round((number - origin) / constraints.step) * constraints.step
    if (constraints.min !== undefined) number = Math.max(constraints.min, number)
    if (constraints.max !== undefined) number = Math.min(constraints.max, number)
    number = Number(number.toFixed(12))
  }
  return normalizeGameTextEntryValue(mode, String(number), constraints)
}

function getKeyboardPages(mode: GameTextEntryMode): readonly (readonly string[])[] {
  if (mode === 'name') return [[...upperAlphabet, ...digits, '-']]
  if (mode === 'account') return [
    [...lowerAlphabet, ...accountSymbols],
    [...upperAlphabet, ...accountSymbols],
  ]
  if (mode === 'number') return []
  return [lowerAlphabet, upperAlphabet, textSymbols]
}

function pageKeyLabel(page: number, pageCount: number): string {
  const nextPage = (page + 1) % pageCount
  if (nextPage === 0) return 'abc'
  if (nextPage === 1) return 'ABC'
  return '#+='
}

/** Creates the same virtual-key model for DOM, canvas, tests, and automation. */
export function createGameTextEntryKeys(
  mode: GameTextEntryMode,
  page = 0,
  constraints: GameTextEntryConstraints = {},
): readonly GameTextEntryKey[] {
  if (mode === 'number') {
    const characters = [...'123456789', ...(allowsNegative(constraints) ? ['-'] : []), '.', '0']
    return [
      ...characters.map((value, index): GameTextEntryKey => ({
        id: `character-${index}`,
        kind: 'character',
        label: value,
        ariaLabel: value === '-' ? 'Moins' : value,
        value,
      })),
      { id: 'backspace', kind: 'backspace', label: '⌫', ariaLabel: 'Effacer' },
      { id: 'submit', kind: 'submit', label: 'OK', ariaLabel: 'Terminer la saisie' },
    ]
  }
  const pages = getKeyboardPages(mode)
  const currentPage = ((page % pages.length) + pages.length) % pages.length
  const characters = pages[currentPage] ?? []
  const keys: GameTextEntryKey[] = characters.map((value, index) => ({
    id: `character-${index}`,
    kind: 'character',
    label: value,
    ariaLabel: value,
    value,
  }))
  if (mode === 'name' || mode === 'password' || mode === 'text' || mode === 'multiline') {
    keys.push({ id: 'space', kind: 'space', label: '␠', ariaLabel: 'Espace', value: ' ' })
  }
  if (mode === 'multiline') {
    keys.push({ id: 'line-break', kind: 'line-break', label: '↵', ariaLabel: 'Nouvelle ligne', value: '\n' })
  }
  keys.push({ id: 'backspace', kind: 'backspace', label: '⌫', ariaLabel: 'Effacer' })
  if (pages.length > 1) {
    keys.push({ id: 'page', kind: 'page', label: pageKeyLabel(currentPage, pages.length), ariaLabel: 'Changer de clavier' })
  }
  keys.push({ id: 'submit', kind: 'submit', label: 'OK', ariaLabel: 'Terminer la saisie' })
  return keys
}

export function moveGameTextEntryCursor(
  cursor: number,
  direction: GameTextEntryDirection,
  keyCount: number,
  columns: number,
): number {
  if (!Number.isInteger(keyCount) || keyCount <= 0) throw new Error(`Nombre de touches invalide : ${keyCount}.`)
  if (!Number.isInteger(columns) || columns <= 0) throw new Error(`Nombre de colonnes invalide : ${columns}.`)
  const safeCursor = Math.max(0, Math.min(keyCount - 1, Math.floor(cursor)))
  if (direction === 'left') return (safeCursor + keyCount - 1) % keyCount
  if (direction === 'right') return (safeCursor + 1) % keyCount
  const rows = Math.ceil(keyCount / columns)
  const row = Math.floor(safeCursor / columns)
  const column = safeCursor % columns
  const nextRow = direction === 'up' ? (row + rows - 1) % rows : (row + 1) % rows
  return Math.min(nextRow * columns + column, keyCount - 1)
}

export function applyGameTextEntryKey(
  mode: GameTextEntryMode,
  value: string,
  key: GameTextEntryKey,
  constraints: GameTextEntryConstraints = {},
): GameTextEntryKeyResult {
  if (key.kind === 'submit') return { value, action: 'submit' }
  if (key.kind === 'page') return { value, action: 'page' }
  if (key.kind === 'backspace') {
    const next = [...value].slice(0, -1).join('')
    return { value: next, action: next === value ? 'none' : 'erase' }
  }
  const next = normalizeGameTextEntryValue(mode, value + (key.value ?? ''), constraints)
  return { value: next, action: next === value ? 'none' : 'write' }
}

function assertValidRequest(request: GameTextEntryRequest): void {
  if (!modes.has(request.mode)) throw new Error(`Mode de saisie inconnu : ${String(request.mode)}.`)
  if (request.title.trim() === '') throw new Error('Une saisie doit avoir un titre accessible.')
  if (request.maxLength !== undefined && (!Number.isFinite(request.maxLength) || request.maxLength < 0)) {
    throw new Error(`Longueur maximale invalide : ${request.maxLength}.`)
  }
  if (request.min !== undefined && !Number.isFinite(request.min)) throw new Error(`Minimum invalide : ${request.min}.`)
  if (request.max !== undefined && !Number.isFinite(request.max)) throw new Error(`Maximum invalide : ${request.max}.`)
  if (request.min !== undefined && request.max !== undefined && request.min > request.max) {
    throw new Error(`Bornes numériques inversées : ${request.min} > ${request.max}.`)
  }
  if (request.step !== undefined && (!Number.isFinite(request.step) || request.step <= 0)) {
    throw new Error(`Pas numérique invalide : ${request.step}.`)
  }
}

function getGridColumns(mode: GameTextEntryMode, width: number): number {
  if (mode === 'number') return 3
  if (width <= 520) return 5
  if (width <= 760) return 7
  return 10
}

function isHTMLElementWithFocus(value: Element | null): value is HTMLElement {
  return value !== null && typeof (value as HTMLElement).focus === 'function'
}

/**
 * Owns one reusable text-entry surface. Consumers only provide state ports;
 * the overlay owns modality, focus, validation, and its virtual keyboard.
 */
export function createGameTextEntryOverlay(
  host: HTMLElement,
  options: GameTextEntryOverlayOptions = {},
): GameTextEntryOverlay {
  const ownerDocument = host.ownerDocument
  const ownerWindow = ownerDocument.defaultView
  const overlayId = `game-text-entry-${++nextOverlayId}`
  const root = ownerDocument.createElement('section')
  root.className = 'game-text-entry-overlay'
  root.hidden = true
  root.setAttribute('role', 'dialog')
  root.setAttribute('aria-modal', 'true')
  root.setAttribute('aria-labelledby', `${overlayId}-title`)

  const surface = ownerDocument.createElement('form')
  surface.className = 'game-text-entry-surface'
  surface.noValidate = true
  const header = ownerDocument.createElement('header')
  header.className = 'game-text-entry-header'
  const title = ownerDocument.createElement('h2')
  title.id = `${overlayId}-title`
  const label = ownerDocument.createElement('label')
  label.className = 'game-text-entry-label'
  label.htmlFor = `${overlayId}-input`
  const inputRail = ownerDocument.createElement('div')
  inputRail.className = 'game-text-entry-input-rail'
  const input = ownerDocument.createElement('input')
  input.id = `${overlayId}-input`
  input.className = 'game-text-entry-input'
  const textarea = ownerDocument.createElement('textarea')
  textarea.id = `${overlayId}-textarea`
  textarea.className = 'game-text-entry-input game-text-entry-textarea'
  textarea.rows = 4
  textarea.wrap = 'soft'
  textarea.hidden = true
  textarea.setAttribute('aria-multiline', 'true')
  const counter = ownerDocument.createElement('output')
  counter.className = 'game-text-entry-counter'
  counter.setAttribute('aria-live', 'off')
  inputRail.append(input, textarea, counter)
  header.append(title, label, inputRail)
  const keyboard = ownerDocument.createElement('nav')
  keyboard.className = 'game-text-entry-keyboard'
  keyboard.setAttribute('aria-label', 'Clavier virtuel')
  const footer = ownerDocument.createElement('footer')
  footer.className = 'game-text-entry-footer'
  const cancelButton = ownerDocument.createElement('button')
  cancelButton.type = 'button'
  cancelButton.className = 'game-text-entry-cancel'
  cancelButton.textContent = 'Retour'
  cancelButton.setAttribute('aria-label', 'Annuler la saisie')
  const cancelHint = ownerDocument.createElement('span')
  cancelHint.className = 'game-text-entry-hint'
  cancelHint.textContent = 'B'
  cancelHint.setAttribute('aria-hidden', 'true')
  cancelButton.prepend(cancelHint)
  const status = ownerDocument.createElement('p')
  status.className = 'game-text-entry-status'
  status.hidden = true
  status.setAttribute('role', 'status')
  status.setAttribute('aria-live', 'assertive')
  footer.append(cancelButton, status)
  surface.append(header, keyboard, footer)
  root.append(surface)
  host.append(root)

  let active: GameTextEntryRequest | undefined
  let value = ''
  let page = 0
  let cursor = 0
  let columns = 10
  let editor: HTMLInputElement | HTMLTextAreaElement = input
  let keys: readonly GameTextEntryKey[] = []
  let keyButtons: HTMLButtonElement[] = []
  let returnFocus: HTMLElement | undefined
  let inertSiblings: InertSiblingSnapshot[] = []
  let rootAccessibility: RootAccessibilitySnapshot | undefined
  let destroyed = false

  const emitFeedback = (feedback: GameTextEntryFeedback): void => {
    try { options.onFeedback?.(feedback) }
    catch { /* Le son ou les vibrations ne doivent jamais interrompre la saisie. */ }
  }

  const getAvailableWidth = (): number => {
    const hostWidth = host.clientWidth > 0 ? host.clientWidth : Number.POSITIVE_INFINITY
    const viewportWidth = ownerWindow?.innerWidth ?? 1024
    return Math.min(hostWidth, viewportWidth)
  }

  const isValid = (candidate = value): boolean => {
    if (!active) return false
    if (active.mode === 'number' && (candidate === '' || candidate === '-' || !Number.isFinite(Number(candidate)))) return false
    return active.validate?.(candidate) ?? true
  }

  const syncCursor = (focus: boolean): void => {
    cursor = Math.max(0, Math.min(keys.length - 1, cursor))
    keyButtons.forEach((button, index) => {
      const selected = index === cursor
      button.tabIndex = selected ? 0 : -1
      button.setAttribute('aria-current', String(selected))
    })
    if (focus) keyButtons[cursor]?.focus({ preventScroll: true })
  }

  const syncValue = (): void => {
    if (!active) return
    editor.value = value
    counter.value = `${[...value].length}/${getMaxLength(active.mode, active)}`
    counter.textContent = counter.value
    editor.removeAttribute('aria-invalid')
    delete root.dataset.invalid
    status.hidden = true
    status.textContent = ''
    keyButtons.forEach((button, index) => {
      button.disabled = keys[index]?.kind === 'submit' && !isValid()
    })
  }

  const writeValue = (nextValue: string, feedback?: 'write' | 'erase'): boolean => {
    if (!active) return false
    const next = normalizeGameTextEntryValue(active.mode, nextValue, active)
    if (next === value) {
      editor.value = value
      return false
    }
    value = next
    active.write(value)
    syncValue()
    if (feedback) emitFeedback(feedback)
    return true
  }

  const renderKeyboard = (focus: boolean): void => {
    if (!active) return
    columns = getGridColumns(active.mode, getAvailableWidth())
    keys = createGameTextEntryKeys(active.mode, page, active)
    cursor = Math.max(0, Math.min(keys.length - 1, cursor))
    keyboard.dataset.columns = String(columns)
    keyboard.dataset.mode = active.mode
    keyButtons = keys.map((key, index) => {
      const button = ownerDocument.createElement('button')
      button.type = 'button'
      button.className = 'game-text-entry-key'
      button.dataset.gameTextEntryKeyIndex = String(index)
      button.dataset.keyKind = key.kind
      button.textContent = key.label
      button.setAttribute('aria-label', key.ariaLabel)
      return button
    })
    keyboard.replaceChildren(...keyButtons)
    syncCursor(focus)
    syncValue()
  }

  const restoreEnvironment = (): void => {
    const siblings = inertSiblings
    inertSiblings = []
    siblings.forEach(({ element, inert, ariaHidden }) => {
      element.inert = inert
      if (ariaHidden === null) element.removeAttribute('aria-hidden')
      else element.setAttribute('aria-hidden', ariaHidden)
    })
    const target = returnFocus
    returnFocus = undefined
    if (target?.isConnected) target.focus({ preventScroll: true })
  }

  const restoreRootAccessibility = (): void => {
    const snapshot = rootAccessibility
    rootAccessibility = undefined
    if (!snapshot) return
    root.inert = snapshot.inert
    if (snapshot.ariaHidden === null) root.removeAttribute('aria-hidden')
    else root.setAttribute('aria-hidden', snapshot.ariaHidden)
  }

  const hide = (): GameTextEntryRequest | undefined => {
    const request = active
    if (!request) return undefined
    active = undefined
    root.hidden = true
    root.removeAttribute('data-mode')
    delete root.dataset.invalid
    input.removeAttribute('aria-invalid')
    textarea.removeAttribute('aria-invalid')
    input.value = ''
    textarea.value = ''
    value = ''
    page = 0
    cursor = 0
    keys = []
    keyButtons = []
    keyboard.replaceChildren()
    status.textContent = ''
    status.hidden = true
    restoreEnvironment()
    restoreRootAccessibility()
    return request
  }

  const cancel = (force = false): void => {
    if (!active || (!force && active.cancellable === false)) return
    emitFeedback('cancel')
    const request = hide()
    request?.cancel()
  }

  const submit = (): void => {
    if (!active) return
    const finalValue = finalizeGameTextEntryValue(active.mode, value, active)
    if (finalValue !== value) {
      value = finalValue
      active.write(value)
      syncValue()
    }
    if (!isValid(finalValue)) {
      root.dataset.invalid = 'true'
      editor.setAttribute('aria-invalid', 'true')
      status.textContent = active.invalidMessage ?? 'Saisie invalide.'
      status.hidden = false
      emitFeedback('invalid')
      editor.focus({ preventScroll: true })
      return
    }
    emitFeedback('submit')
    const request = hide()
    request?.submit(finalValue)
  }

  const changePage = (delta: number): void => {
    if (!active) return
    const pageCount = getKeyboardPages(active.mode).length
    if (pageCount <= 1) return
    page = (page + delta + pageCount) % pageCount
    cursor = 0
    emitFeedback('page')
    renderKeyboard(true)
  }

  const applyKey = (key: GameTextEntryKey | undefined): void => {
    if (!active || !key) return
    const result = applyGameTextEntryKey(active.mode, value, key, active)
    if (result.action === 'submit') submit()
    else if (result.action === 'page') changePage(1)
    else if (result.action === 'write' || result.action === 'erase') writeValue(result.value, result.action)
  }

  const handle = (event: GameDigitalEvent): boolean => {
    if (!active) return false
    if (!event.pressed) return true
    if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down') {
      cursor = moveGameTextEntryCursor(cursor, event.action, keys.length, columns)
      emitFeedback('move')
      syncCursor(true)
      return true
    }
    if (event.action === 'page-previous') { changePage(-1); return true }
    if (event.action === 'page-next' || event.action === 'tertiary') { changePage(1); return true }
    if (event.action === 'secondary') {
      const backspace = keys.find((key) => key.kind === 'backspace')
      applyKey(backspace)
      return true
    }
    if (event.action === 'confirm') {
      if (event.source === 'keyboard' && event.inputId === 'Enter') submit()
      else applyKey(keys[cursor])
      return true
    }
    if (event.action === 'cancel') {
      if (event.source === 'keyboard' && event.inputId === 'Backspace') {
        const backspace = keys.find((key) => key.kind === 'backspace')
        applyKey(backspace)
      } else cancel()
      return true
    }
    if (event.action === 'menu') { cancel(); return true }
    return true
  }

  const handleKeyboard = (event: KeyboardEvent, pressed: boolean): boolean => {
    if (!active) return false
    const editorIsTarget = event.target === editor
    if (active.mode === 'multiline' && editorIsTarget) {
      if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
        event.preventDefault()
        if (pressed && !event.repeat) submit()
        return true
      }
      if (event.key !== 'Escape') return false
    }
    if (event.key === 'Shift' || (editorIsTarget && (event.key.length === 1 || event.key === 'Backspace'))) return false
    if (pressed && !editorIsTarget && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
      event.preventDefault()
      writeValue(value + event.key, 'write')
      return true
    }
    const action = mapKeyboardAction(event)
    if (!action) return false
    event.preventDefault()
    if (pressed && (!event.repeat || ['up', 'down', 'left', 'right', 'page-previous', 'page-next'].includes(action))) {
      handle({ action, pressed: true, source: 'keyboard', inputId: event.key })
    }
    return true
  }

  const open = (request: GameTextEntryRequest): void => {
    if (destroyed) throw new Error('Le clavier central a été détruit.')
    if (active) throw new Error('Une saisie centrale est déjà ouverte.')
    assertValidRequest(request)
    const initialRawValue = request.read()
    const initialValue = normalizeGameTextEntryValue(request.mode, initialRawValue, request)
    const previousActiveElement = ownerDocument.activeElement
    returnFocus = isHTMLElementWithFocus(previousActiveElement) && !root.contains(previousActiveElement)
      ? previousActiveElement
      : undefined
    inertSiblings = []
    for (const sibling of host.children) {
      if (sibling === root || !('inert' in sibling)) continue
      const element = sibling as HTMLElement
      inertSiblings.push({ element, inert: element.inert, ariaHidden: element.getAttribute('aria-hidden') })
      element.inert = true
      element.setAttribute('aria-hidden', 'true')
    }
    active = request
    rootAccessibility = { inert: root.inert, ariaHidden: root.getAttribute('aria-hidden') }
    root.inert = false
    root.removeAttribute('aria-hidden')
    value = initialValue
    page = 0
    cursor = 0
    title.textContent = request.title
    label.textContent = request.label ?? ''
    label.hidden = !request.label
    const multiline = request.mode === 'multiline'
    editor = multiline ? textarea : input
    input.hidden = multiline
    textarea.hidden = !multiline
    input.name = multiline ? '' : request.mode === 'account' ? 'username' : request.mode === 'password' ? 'password' : request.mode
    textarea.name = multiline ? 'multiline' : ''
    label.htmlFor = editor.id
    input.type = request.mode === 'password' ? 'password' : 'text'
    editor.placeholder = request.placeholder ?? ''
    editor.maxLength = getMaxLength(request.mode, request)
    editor.inputMode = 'none'
    editor.enterKeyHint = multiline ? 'enter' : 'done'
    editor.autocomplete = request.mode === 'account' ? 'username' : request.mode === 'password' ? 'current-password' : 'off'
    editor.autocapitalize = request.mode === 'name' ? 'characters' : 'none'
    editor.spellcheck = request.mode === 'text' || multiline
    editor.setAttribute('aria-label', request.label ?? request.title)
    editor.setAttribute('autocorrect', 'off')
    root.dataset.mode = request.mode
    cancelButton.hidden = request.cancellable === false
    cancelButton.disabled = request.cancellable === false
    root.hidden = false
    if (initialValue !== initialRawValue) request.write(initialValue)
    renderKeyboard(false)
    editor.focus({ preventScroll: true })
  }

  const refresh = (): void => {
    if (!active) return
    const nextRawValue = active.read()
    const nextValue = normalizeGameTextEntryValue(active.mode, nextRawValue, active)
    value = nextValue
    if (nextValue !== nextRawValue) active.write(nextValue)
    syncValue()
  }

  const handleInput = (): void => { writeValue(editor.value, 'write') }
  const handleSubmit = (event: SubmitEvent): void => { event.preventDefault(); submit() }
  const handleRootKeyDown = (event: KeyboardEvent): void => {
    handleKeyboard(event, true)
    event.stopPropagation()
  }
  const stopGameInput = (event: Event): void => { event.stopPropagation() }
  const handleClick = (event: MouseEvent): void => {
    event.stopPropagation()
    const target = event.target as { closest?: (selector: string) => Element | null } | null
    const button = target?.closest?.('button') as HTMLButtonElement | null
    if (!button || !root.contains(button) || button.disabled) return
    if (button === cancelButton) { cancel(); return }
    const index = Number.parseInt(button.dataset.gameTextEntryKeyIndex ?? '', 10)
    if (!Number.isInteger(index) || index < 0 || index >= keys.length) return
    cursor = index
    syncCursor(false)
    applyKey(keys[index])
  }
  const handleFocus = (event: FocusEvent): void => {
    const target = event.target as HTMLButtonElement | null
    const index = Number.parseInt(target?.dataset?.gameTextEntryKeyIndex ?? '', 10)
    if (!Number.isInteger(index) || index < 0 || index >= keys.length) return
    cursor = index
    syncCursor(false)
  }
  const handleResize = (): void => {
    if (!active) return
    const nextColumns = getGridColumns(active.mode, getAvailableWidth())
    if (nextColumns !== columns) renderKeyboard(ownerDocument.activeElement !== editor)
  }

  input.addEventListener('input', handleInput)
  textarea.addEventListener('input', handleInput)
  surface.addEventListener('submit', handleSubmit)
  root.addEventListener('keydown', handleRootKeyDown, true)
  root.addEventListener('keyup', stopGameInput)
  root.addEventListener('pointerdown', stopGameInput)
  root.addEventListener('click', handleClick)
  root.addEventListener('focusin', handleFocus)
  ownerWindow?.addEventListener('resize', handleResize)
  const rootAccessibilityObserver = ownerWindow
    ? new ownerWindow.MutationObserver(() => {
        if (!active) return
        root.inert = false
        root.removeAttribute('aria-hidden')
      })
    : undefined
  rootAccessibilityObserver?.observe(root, { attributes: true, attributeFilter: ['inert', 'aria-hidden'] })

  return Object.freeze({
    open,
    close: () => { cancel(true) },
    submitCurrent: () => {
      const request = active
      if (!request) return false
      submit()
      return active !== request
    },
    refresh,
    isOpen: () => active !== undefined,
    handle,
    handleKeyboard,
    destroy() {
      if (destroyed) return
      destroyed = true
      if (active) hide()
      input.removeEventListener('input', handleInput)
      textarea.removeEventListener('input', handleInput)
      surface.removeEventListener('submit', handleSubmit)
      root.removeEventListener('keydown', handleRootKeyDown, true)
      root.removeEventListener('keyup', stopGameInput)
      root.removeEventListener('pointerdown', stopGameInput)
      root.removeEventListener('click', handleClick)
      root.removeEventListener('focusin', handleFocus)
      ownerWindow?.removeEventListener('resize', handleResize)
      rootAccessibilityObserver?.disconnect()
      root.remove()
    },
  })
}
