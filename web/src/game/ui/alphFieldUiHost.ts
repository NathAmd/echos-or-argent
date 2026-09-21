import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import type { GameDigitalEvent } from '../../gameInput'
import type { NitroGraphic } from '../../ndsTypes'
import { canPlaceHgssAlphPuzzleTile, isHgssAlphPuzzleComplete, type HgssAlphPuzzleTile } from '../alph/hgssAlphPuzzle'
import type { FieldScriptStep } from '../scripts/fieldScriptProtocol'
import { createFieldControlActivation } from './fieldControlInteraction'

export type AlphPuzzleFieldStep = Extract<FieldScriptStep, { kind: 'alphPuzzle' }>
export type AlphInscriptionFieldStep = Extract<FieldScriptStep, { kind: 'alphHiddenRoom' }>

export type AlphFieldUiRunnerPort = Readonly<{
  finishPuzzle: (solved: boolean) => void
  closeInscription: () => void
  resume: () => void
}>

export type AlphFieldUiSnapshot = Readonly<{
  mode: 'closed' | 'puzzle' | 'inscription'
  cursor: Readonly<{ x: number, y: number }>
  selectedTile: number | undefined
  tiles: readonly Readonly<HgssAlphPuzzleTile>[]
  completionPending: boolean
}>

export type AlphFieldUiHost = Readonly<{
  openPuzzle: (step: AlphPuzzleFieldStep) => void
  openInscription: (step: AlphInscriptionFieldStep) => void
  closeInscription: () => boolean
  handleDigital: (event: GameDigitalEvent) => boolean
  reset: () => void
  destroy: () => void
  isOpen: () => boolean
  isPuzzleOpen: () => boolean
  isInscriptionOpen: () => boolean
  solveForAutomation: () => boolean
  getSnapshot: () => AlphFieldUiSnapshot
}>

type AlphFieldUiElements = Readonly<{
  root: HTMLElement
  board: HTMLElement
  hint: HTMLElement
  inscription: HTMLElement
  inscriptionVisual: HTMLElement
  inscriptionWord: HTMLElement
}>

type AlphFieldUiPorts = Readonly<{
  getGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  getMapLabel: () => string
  getQuitMessage: () => string
  requestConfirmation: (message: string, onConfirm: () => void) => void
  prefersReducedMotion: () => boolean
  getAudio: () => Pick<RomAudioRuntime, 'playSoundEffect'> | undefined
  reportError: (message: string) => void
  readRunner: () => AlphFieldUiRunnerPort | undefined
  onManualInteraction?: (kind: 'puzzle' | 'inscription') => void
  createElement?: (tagName: 'span' | 'button') => HTMLElement
  scheduler?: Readonly<{
    setTimeout: (callback: () => void, delayMs: number) => number
    clearTimeout: (timer: number) => void
  }>
}>

export function createAlphFieldUiHost(elements: AlphFieldUiElements, ports: AlphFieldUiPorts): AlphFieldUiHost {
  const scheduler = ports.scheduler ?? {
    setTimeout: (callback: () => void, delayMs: number) => window.setTimeout(callback, delayMs),
    clearTimeout: (timer: number) => window.clearTimeout(timer),
  }
  const createElement = ports.createElement ?? ((tagName: 'span' | 'button') => document.createElement(tagName))
  let activePuzzle: AlphPuzzleFieldStep | undefined
  let tiles: HgssAlphPuzzleTile[] = []
  let selectedTile: number | undefined
  let cursor = { x: 1, y: 1 }
  let completionTimer: number | undefined
  let generation = 0
  let destroyed = false

  const isPuzzleOpen = (): boolean => !elements.root.hidden
  const isInscriptionOpen = (): boolean => !elements.inscription.hidden
  const isOpen = (): boolean => isPuzzleOpen() || isInscriptionOpen()

  const clearCompletionTimer = (): void => {
    if (completionTimer !== undefined) scheduler.clearTimeout(completionTimer)
    completionTimer = undefined
  }

  const clearPuzzle = (): void => {
    clearCompletionTimer()
    activePuzzle = undefined
    tiles = []
    selectedTile = undefined
    elements.root.classList.remove('is-solved')
    elements.root.hidden = true
    elements.board.replaceChildren()
  }

  const clearInscription = (): void => {
    elements.inscription.hidden = true
    elements.inscriptionVisual.replaceChildren()
    elements.inscriptionWord.textContent = ''
  }

  const reset = (): void => {
    generation += 1
    clearPuzzle()
    clearInscription()
  }

  const renderPuzzle = (): void => {
    const step = activePuzzle
    if (!step) {
      elements.board.replaceChildren()
      return
    }
    const children: HTMLElement[] = []
    if (step.background) {
      const background = ports.getGraphicCanvas(step.background)
      background.setAttribute('aria-hidden', 'true')
      children.push(background)
    }
    for (let y = 0; y < 6; y += 1) {
      for (let x = 0; x < 6; x += 1) {
        const cell = createElement('span')
        cell.className = 'field-alph-cell-cursor'
        cell.style.gridColumn = String(x + 1)
        cell.style.gridRow = String(y + 1)
        cell.dataset.active = String(cursor.x === x && cursor.y === y)
        cell.dataset.invalid = String((x === 0 || x === 5) && (y === 0 || y === 5))
        cell.setAttribute('role', 'gridcell')
        children.push(cell)
      }
    }
    for (const tile of tiles) {
      const button = createElement('button') as HTMLButtonElement
      button.type = 'button'
      button.className = 'field-alph-tile'
      button.tabIndex = -1
      button.dataset.tileIndex = String(tile.tileIndex)
      button.dataset.selected = String(selectedTile === tile.tileIndex)
      button.dataset.immovable = String(tile.immovable)
      button.style.gridColumn = String(tile.x + 1)
      button.style.gridRow = String(tile.y + 1)
      button.setAttribute('aria-label', String(tile.tileIndex + 1))
      const graphic = step.graphics[tile.tileIndex]
      if (!graphic) throw new Error(`Le fragment ROM ${tile.tileIndex + 1} du puzzle d’Alpha est absent.`)
      const canvas = ports.getGraphicCanvas(graphic)
      canvas.style.transform = `rotate(${tile.rotation * 90}deg)`
      canvas.setAttribute('aria-hidden', 'true')
      button.append(canvas)
      children.push(button)
    }
    elements.board.replaceChildren(...children)
  }

  const syncCursor = (): void => {
    for (const [index, cell] of [...elements.board.querySelectorAll<HTMLElement>('.field-alph-cell-cursor')].entries()) {
      cell.dataset.active = String(index % 6 === cursor.x && Math.floor(index / 6) === cursor.y)
    }
  }

  const finishPuzzle = (solved: boolean): boolean => {
    const runner = ports.readRunner()
    if (!runner || !activePuzzle) return false
    generation += 1
    clearCompletionTimer()
    runner.finishPuzzle(solved)
    clearPuzzle()
    runner.resume()
    return true
  }

  const completePuzzleIfSolved = (): boolean => {
    if (!isHgssAlphPuzzleComplete(tiles) || completionTimer !== undefined) return false
    selectedTile = undefined
    elements.root.classList.add('is-solved')
    renderPuzzle()
    const expectedGeneration = generation
    completionTimer = scheduler.setTimeout(() => {
      if (destroyed || generation !== expectedGeneration) return
      finishPuzzle(true)
    }, ports.prefersReducedMotion() ? 0 : 700)
    return true
  }

  const activatePuzzleCell = (): void => {
    if (!activePuzzle || completionTimer !== undefined) return
    const tileAtCursor = tiles.find((tile) => tile.x === cursor.x && tile.y === cursor.y)
    if (selectedTile === undefined) {
      if (tileAtCursor && !tileAtCursor.immovable) selectedTile = tileAtCursor.tileIndex
      renderPuzzle()
      return
    }
    const selected = tiles.find((tile) => tile.tileIndex === selectedTile)
    if (!selected) return
    if (tileAtCursor?.tileIndex === selected.tileIndex) {
      selected.rotation = (selected.rotation + 1) % 4
      renderPuzzle()
      completePuzzleIfSolved()
      return
    }
    if (!canPlaceHgssAlphPuzzleTile(tiles, selected.tileIndex, cursor.x, cursor.y)) return
    selected.x = cursor.x
    selected.y = cursor.y
    selectedTile = undefined
    renderPuzzle()
    completePuzzleIfSolved()
  }

  const focusPuzzleCell = (nextCursor: { x: number, y: number }): void => {
    cursor = nextCursor
    syncCursor()
    elements.board.focus({ preventScroll: true })
  }
  const puzzleActivation = createFieldControlActivation(focusPuzzleCell, activatePuzzleCell)

  const movePuzzleCursor = (action: 'left' | 'right' | 'up' | 'down'): void => {
    if (action === 'left') cursor.x = Math.max(0, cursor.x - 1)
    else if (action === 'right') cursor.x = Math.min(5, cursor.x + 1)
    else if (action === 'up') cursor.y = Math.max(0, cursor.y - 1)
    else cursor.y = Math.min(5, cursor.y + 1)
    syncCursor()
  }

  const requestPuzzleQuit = (): void => {
    if (!activePuzzle || completionTimer !== undefined) return
    const expectedGeneration = generation
    ports.requestConfirmation(ports.getQuitMessage(), () => {
      if (destroyed || generation !== expectedGeneration || !isPuzzleOpen()) return
      finishPuzzle(false)
    })
  }

  const playInscriptionSound = (): void => {
    const expectedGeneration = generation
    void ports.getAudio()?.playSoundEffect(0x5dc).catch((error: unknown) => {
      if (destroyed || generation !== expectedGeneration) return
      ports.reportError(error instanceof Error ? error.message : 'Le son ROM des Ruines d’Alpha est indisponible.')
    })
  }

  const openPuzzle = (step: AlphPuzzleFieldStep): void => {
    if (destroyed) return
    generation += 1
    clearCompletionTimer()
    clearInscription()
    activePuzzle = step
    tiles = step.tiles.map((tile) => ({ ...tile }))
    selectedTile = undefined
    const firstMovable = tiles.find((tile) => !tile.immovable)
    cursor = firstMovable ? { x: firstMovable.x, y: firstMovable.y } : { x: 1, y: 1 }
    elements.hint.textContent = step.hint
    const mapLabel = ports.getMapLabel()
    const title = elements.root.querySelector<HTMLElement>('header span')
    if (title) title.textContent = mapLabel
    if (mapLabel) elements.root.setAttribute('aria-label', mapLabel)
    if (step.hint) elements.board.setAttribute('aria-label', step.hint)
    elements.root.classList.remove('is-solved')
    renderPuzzle()
    elements.root.hidden = false
  }

  const openInscription = (step: AlphInscriptionFieldStep): void => {
    if (destroyed) return
    generation += 1
    clearPuzzle()
    const background = ports.getGraphicCanvas(step.background)
    background.setAttribute('aria-hidden', 'true')
    elements.inscriptionVisual.replaceChildren(background)
    elements.inscriptionWord.textContent = step.word
    elements.inscription.hidden = false
    playInscriptionSound()
  }

  const closeInscription = (): boolean => {
    const runner = ports.readRunner()
    if (!runner || elements.inscription.hidden) return false
    generation += 1
    runner.closeInscription()
    clearInscription()
    playInscriptionSound()
    runner.resume()
    return true
  }

  const handleDigital = (event: GameDigitalEvent): boolean => {
    if (!event.pressed) return false
    if (isInscriptionOpen()) {
      if (event.action === 'confirm' || event.action === 'cancel' || event.action === 'menu') closeInscription()
      return true
    }
    if (!isPuzzleOpen()) return false
    if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down') movePuzzleCursor(event.action)
    else if (event.action === 'confirm') puzzleActivation.click(cursor)
    else if (event.action === 'cancel' || event.action === 'menu') requestPuzzleQuit()
    return true
  }

  const solveForAutomation = (): boolean => {
    if (!activePuzzle || completionTimer !== undefined) return false
    for (const tile of tiles) {
      tile.x = tile.tileIndex % 4 + 1
      tile.y = Math.floor(tile.tileIndex / 4) + 1
      tile.rotation = 0
    }
    return completePuzzleIfSolved()
  }

  const handleBoardPointerDown = (event: PointerEvent): void => {
    ports.onManualInteraction?.('puzzle')
    const bounds = elements.board.getBoundingClientRect()
    if (bounds.width <= 0 || bounds.height <= 0) return
    puzzleActivation.pointerDown({
      x: Math.max(0, Math.min(5, Math.floor((event.clientX - bounds.left) / bounds.width * 6))),
      y: Math.max(0, Math.min(5, Math.floor((event.clientY - bounds.top) / bounds.height * 6))),
    })
  }
  const handleBoardClick = (): void => { puzzleActivation.click(cursor) }
  const handleQuitClick = (): void => { requestPuzzleQuit() }
  const handleInscriptionPointerDown = (event: PointerEvent): void => {
    event.preventDefault()
    ports.onManualInteraction?.('inscription')
    closeInscription()
  }

  const quitButton = elements.root.querySelector<HTMLElement>('[data-alph-puzzle-quit]')
  elements.board.addEventListener('pointerdown', handleBoardPointerDown)
  elements.board.addEventListener('click', handleBoardClick)
  quitButton?.addEventListener('click', handleQuitClick)
  elements.inscription.addEventListener('pointerdown', handleInscriptionPointerDown)

  const getSnapshot = (): AlphFieldUiSnapshot => ({
    mode: isPuzzleOpen() ? 'puzzle' : isInscriptionOpen() ? 'inscription' : 'closed',
    cursor: { ...cursor },
    selectedTile,
    tiles: tiles.map((tile) => ({ ...tile })),
    completionPending: completionTimer !== undefined,
  })

  return Object.freeze({
    openPuzzle,
    openInscription,
    closeInscription,
    handleDigital,
    reset,
    destroy: () => {
      if (destroyed) return
      elements.board.removeEventListener('pointerdown', handleBoardPointerDown)
      elements.board.removeEventListener('click', handleBoardClick)
      quitButton?.removeEventListener('click', handleQuitClick)
      elements.inscription.removeEventListener('pointerdown', handleInscriptionPointerDown)
      reset()
      destroyed = true
    },
    isOpen,
    isPuzzleOpen,
    isInscriptionOpen,
    solveForAutomation,
    getSnapshot,
  })
}
