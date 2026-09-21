import type { GameDigitalEvent } from '../../gameInput'
import type { FieldScriptStep } from '../scripts/fieldScriptProtocol'
import { createFieldControlActivation, moveSpatialGridCursor, syncRovingControlSelection } from './fieldControlInteraction'

export type FieldEasyChatStep = Extract<FieldScriptStep, { kind: 'easyChat' }>
export type FieldEasyChatSelection = number | readonly number[] | undefined

export type FieldEasyChatRunnerPort = Readonly<{
  submit: (selection: FieldEasyChatSelection) => void
  resume: () => void
}>

export type FieldEasyChatHost = Readonly<{
  open: (step: FieldEasyChatStep) => void
  reset: () => void
  cancel: () => void
  isOpen: () => boolean
  handleDigital: (event: GameDigitalEvent) => boolean
  destroy: () => void
}>

export function createFieldEasyChatHost(elements: Readonly<{
  root: HTMLElement
  categories: HTMLElement
  words: HTMLElement
}>, ports: Readonly<{
  createButton: () => HTMLButtonElement
  isPointerInput: () => boolean
  readGridTemplateColumns: () => string
  readRunner: () => FieldEasyChatRunnerPort | undefined
}>): FieldEasyChatHost {
  let categoryCursor = 0
  let wordCursor = 0
  let wordIds: number[] = []
  let requiredWords = 1
  let selectedWords: number[] = []

  const isOpen = (): boolean => !elements.root.hidden

  const renderSelection = (focusWord = false): void => {
    syncRovingControlSelection([...elements.categories.querySelectorAll<HTMLButtonElement>('button')], categoryCursor, 'aria-current')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
    syncRovingControlSelection([...elements.words.querySelectorAll<HTMLButtonElement>('button')], wordCursor, 'aria-selected', focusWord)
      ?.scrollIntoView({ block: 'nearest' })
  }

  const reset = (): void => {
    elements.root.hidden = true
    elements.categories.replaceChildren()
    elements.words.replaceChildren()
    categoryCursor = 0
    wordCursor = 0
    wordIds = []
    requiredWords = 1
    selectedWords = []
  }

  const submit = (selection: FieldEasyChatSelection): boolean => {
    const runner = ports.readRunner()
    if (!runner) return false
    runner.submit(selection)
    reset()
    runner.resume()
    return true
  }

  const open = (step: FieldEasyChatStep): void => {
    categoryCursor = 0
    wordCursor = 0
    requiredWords = Math.max(1, step.wordCount ?? 1)
    selectedWords = []
    const instruction = elements.root.querySelector<HTMLElement>('header strong')
    const updateInstruction = (): void => {
      if (!instruction) return
      const categoryName = step.catalog.categories[categoryCursor]?.name ?? ''
      instruction.textContent = requiredWords === 1
        ? categoryName
        : `${categoryName} · ${selectedWords.length}/${requiredWords}`
    }
    const selectWord = (wordId: number): void => {
      if (requiredWords === 1) {
        submit(wordId)
        return
      }
      selectedWords.push(wordId)
      updateInstruction()
      if (selectedWords.length >= requiredWords) submit([...selectedWords])
    }
    const wordActivation = createFieldControlActivation(
      (index: number) => { wordCursor = index; renderSelection(true) },
      (index) => { const wordId = wordIds[index]; if (wordId !== undefined) selectWord(wordId) },
    )
    const selectCategory = (categoryIndex: number, focusWord = false): void => {
      categoryCursor = categoryIndex
      const category = step.catalog.categories[categoryIndex]
      wordIds = category?.words.filter((word) => word.text.length > 0).map((word) => word.wordId) ?? []
      wordCursor = 0
      elements.words.replaceChildren(...wordIds.map((wordId, index) => {
        const button = ports.createButton()
        button.type = 'button'
        button.textContent = step.catalog.words[wordId]?.text ?? ''
        button.addEventListener('pointerdown', () => wordActivation.pointerDown(index))
        button.addEventListener('click', () => wordActivation.click(index))
        button.addEventListener('pointerenter', () => {
          if (!ports.isPointerInput()) return
          wordCursor = index
          renderSelection()
        })
        return button
      }))
      updateInstruction()
      renderSelection(focusWord)
    }
    elements.categories.replaceChildren(...step.catalog.categories.map((category, index) => {
      const button = ports.createButton()
      button.type = 'button'
      button.textContent = category.name
      button.addEventListener('click', () => selectCategory(index, true))
      return button
    }))
    selectCategory(0)
    updateInstruction()
    elements.root.hidden = false
    renderSelection(true)
  }

  const move = (action: 'left' | 'right' | 'up' | 'down' | 'page-previous' | 'page-next'): void => {
    if (action === 'page-previous' || action === 'page-next') {
      const count = elements.categories.childElementCount
      if (count === 0) return
      const direction = action === 'page-previous' ? -1 : 1
      const next = (categoryCursor + direction + count) % count
      elements.categories.querySelectorAll<HTMLButtonElement>('button')[next]?.click()
      return
    }
    if (wordIds.length === 0) return
    const tracks = ports.readGridTemplateColumns().trim().split(/\s+/)
    wordCursor = moveSpatialGridCursor(wordCursor, wordIds.length, tracks[0] === 'none' ? 1 : tracks.length, action)
    renderSelection(true)
  }

  const handleDigital = (event: GameDigitalEvent): boolean => {
    if (!isOpen() || !event.pressed) return false
    if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down' || event.action === 'page-previous' || event.action === 'page-next') move(event.action)
    else if (event.action === 'confirm') elements.words.querySelectorAll<HTMLButtonElement>('button')[wordCursor]?.click()
    else if (event.action === 'cancel' || event.action === 'menu') submit(undefined)
    return true
  }

  const cancelButton = elements.root.querySelector<HTMLElement>('[data-easy-chat-cancel]')
  const handleCancelClick = (): void => { submit(undefined) }
  cancelButton?.addEventListener('click', handleCancelClick)

  return Object.freeze({
    open,
    reset,
    cancel: handleCancelClick,
    isOpen,
    handleDigital,
    destroy: () => {
      cancelButton?.removeEventListener('click', handleCancelClick)
      reset()
    },
  })
}
