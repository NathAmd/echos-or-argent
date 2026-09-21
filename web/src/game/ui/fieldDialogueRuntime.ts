import type { GameDigitalAction } from '../../gameInput'
import type { FieldScriptClearWaitOptions } from '../scripts/fieldScriptExecutionState'
import { getAcknowledgedDialogWaitAction, type FieldScriptWaitKind } from './fieldDialogWait'
import { splitHgssDialogPages } from './hgssDialogPages'

export type FieldDialogueRuntimeElements = Readonly<{
  root: HTMLElement
  speaker: HTMLElement
  text: HTMLElement
}>

export type FieldDialogueExecutionPort = Readonly<{
  setRunner: (runner: undefined) => void
  beginWait: (wait: 'input') => void
  clearWait: (options?: FieldScriptClearWaitOptions) => void
  getWait: () => FieldScriptWaitKind | undefined
  resumeInput: (action: GameDigitalAction) => boolean
}>

export type FieldDialogueRuntimePorts = Readonly<{
  execution: FieldDialogueExecutionPort
  advance: () => void
  clearMovement: () => void
  getMaxColumns: () => number
  consumeFinalConfirmation?: () => boolean
  onPhoneClosed?: () => void
}>

export type FieldDialogueShowOptions = Readonly<{
  speaker?: string
}>

export type FieldDialogueSnapshot = Readonly<{
  visible: boolean
  fullText: string
  pages: readonly string[]
  pageIndex: number
  complete: true
  acknowledged: boolean
  phoneActive: boolean
}>

export type FieldDialogueRuntime = Readonly<{
  setSpeaker: (name: string | undefined) => void
  showPage: (index: number) => void
  showMessages: (messages: string | readonly string[], options?: FieldDialogueShowOptions) => void
  openPhone: (speaker: string, messages: readonly string[], onComplete?: () => void) => void
  confirm: () => boolean
  completeText: () => false
  resumeInputWait: (action: GameDigitalAction) => boolean
  skipAcknowledgedWait: () => boolean
  dismiss: () => boolean
  hide: () => void
  reset: () => void
  getSnapshot: () => FieldDialogueSnapshot
  isAcknowledged: () => boolean
  setAcknowledged: (acknowledged: boolean) => void
  isPhoneActive: () => boolean
  setPhoneActive: (active: boolean, onComplete?: () => void) => void
}>

/**
 * Owns the state and input lifecycle of the field dialogue window.
 *
 * Field text is deliberately presented atomically in the single-screen UI:
 * the first confirmation always advances the message instead of completing a
 * hidden typewriter animation.
 */
export function createFieldDialogueRuntime(
  elements: FieldDialogueRuntimeElements,
  ports: FieldDialogueRuntimePorts,
): FieldDialogueRuntime {
  let fullText = ''
  let pages: string[] = []
  let pageIndex = 0
  let acknowledged = false
  let phoneActive = false
  let phoneComplete: (() => void) | undefined

  const setSpeaker = (name: string | undefined): void => {
    elements.speaker.textContent = name ?? ''
    elements.speaker.hidden = !name
    elements.root.classList.toggle('has-speaker', Boolean(name))
  }

  const showPage = (index: number): void => {
    pageIndex = Math.max(0, Math.min(pages.length - 1, index))
    fullText = pages[pageIndex] ?? ''
    acknowledged = false
    elements.text.textContent = fullText
    elements.root.hidden = false
    elements.root.classList.add('is-interactive')
  }

  const showMessages = (
    messages: string | readonly string[],
    options: FieldDialogueShowOptions = {},
  ): void => {
    const source = typeof messages === 'string' ? [messages] : messages
    pages = source.flatMap((message) => splitHgssDialogPages(message, {
      maxColumns: ports.getMaxColumns(),
    }))
    if (pages.length === 0) pages = ['']
    if (Object.hasOwn(options, 'speaker')) setSpeaker(options.speaker)
    showPage(0)
  }

  const setPhoneActive = (active: boolean, onComplete?: () => void): void => {
    phoneActive = active
    phoneComplete = active ? onComplete : undefined
    elements.root.classList.toggle('field-dialogue-phone', active)
  }

  const hide = (): void => {
    elements.root.hidden = true
    elements.root.classList.remove('is-interactive')
    elements.text.textContent = ''
    fullText = ''
    pages = []
    pageIndex = 0
    acknowledged = false
    setSpeaker(undefined)
  }

  const openPhone = (speaker: string, messages: readonly string[], onComplete?: () => void): void => {
    ports.clearMovement()
    setSpeaker(speaker)
    setPhoneActive(true, onComplete)
    showMessages(messages)
    ports.execution.beginWait('input')
  }

  const completeText = (): false => false

  const confirm = (): boolean => {
    if (elements.root.hidden) return false
    if (pageIndex + 1 < pages.length) {
      showPage(pageIndex + 1)
      return true
    }
    if (ports.consumeFinalConfirmation?.()) return true
    if (phoneActive) {
      const onComplete = phoneComplete
      setPhoneActive(false)
      hide()
      ports.execution.clearWait()
      ports.onPhoneClosed?.()
      if (onComplete) onComplete()
      else ports.advance()
      return true
    }
    ports.execution.clearWait()
    acknowledged = true
    ports.advance()
    return true
  }

  const resumeInputWait = (action: GameDigitalAction): boolean => {
    if (!ports.execution.resumeInput(action)) return false
    acknowledged = false
    ports.advance()
    return true
  }

  const dismiss = (): boolean => {
    if (!acknowledged || elements.root.hidden) return false
    hide()
    return true
  }

  const skipAcknowledgedWait = (): boolean => {
    const wait = ports.execution.getWait()
    if (!acknowledged || elements.root.hidden || !wait) return false
    const action = getAcknowledgedDialogWaitAction(wait)
    if (action === 'advance') {
      ports.execution.clearWait({ invalidateAsync: true, clearSoundEffect: true })
      ports.advance()
      return true
    }
    if (action === 'dismiss') return dismiss()
    return false
  }

  const reset = (): void => {
    ports.execution.setRunner(undefined)
    ports.execution.clearWait({
      invalidateAsync: true,
      clearAcceptedInputs: true,
      clearSoundEffect: true,
    })
    setPhoneActive(false)
    hide()
    elements.root.classList.remove('has-waiting-icon')
  }

  const getSnapshot = (): FieldDialogueSnapshot => Object.freeze({
    visible: !elements.root.hidden,
    fullText,
    pages: Object.freeze([...pages]),
    pageIndex,
    complete: true,
    acknowledged,
    phoneActive,
  })

  return Object.freeze({
    setSpeaker,
    showPage,
    showMessages,
    openPhone,
    confirm,
    completeText,
    resumeInputWait,
    skipAcknowledgedWait,
    dismiss,
    hide,
    reset,
    getSnapshot,
    isAcknowledged: () => acknowledged,
    setAcknowledged: (nextAcknowledged) => { acknowledged = nextAcknowledged },
    isPhoneActive: () => phoneActive,
    setPhoneActive,
  })
}
