import { describe, expect, it } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import type { NitroGraphic } from '../../ndsTypes'
import {
  createAlphFieldUiHost,
  type AlphFieldUiRunnerPort,
  type AlphInscriptionFieldStep,
  type AlphPuzzleFieldStep,
} from './alphFieldUiHost'

type TestListener = EventListenerOrEventListenerObject

class TestClassList {
  private readonly values = new Set<string>()

  add(...tokens: string[]): void { tokens.forEach((token) => this.values.add(token)) }
  remove(...tokens: string[]): void { tokens.forEach((token) => this.values.delete(token)) }
  contains(token: string): boolean { return this.values.has(token) }
}

class TestElement {
  hidden = true
  textContent = ''
  className = ''
  type = ''
  tabIndex = 0
  readonly classList = new TestClassList()
  readonly dataset: Record<string, string | undefined> = {}
  readonly style: Record<string, string> = {}
  readonly attributes = new Map<string, string>()
  readonly queries = new Map<string, TestElement>()
  children: TestElement[] = []
  focusCount = 0
  rect = { left: 0, top: 0, width: 120, height: 120 }
  private readonly listeners = new Map<string, Set<TestListener>>()

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  dispatch(type: string, fields: Record<string, unknown> = {}): { defaultPrevented: boolean } {
    let defaultPrevented = false
    const event = {
      target: this,
      clientX: 0,
      clientY: 0,
      preventDefault: () => { defaultPrevented = true },
      ...fields,
    } as unknown as Event
    for (const listener of this.listeners.get(type) ?? []) {
      if (typeof listener === 'function') listener(event)
      else listener.handleEvent(event)
    }
    return { defaultPrevented }
  }

  listenerCount(type: string): number { return this.listeners.get(type)?.size ?? 0 }
  setAttribute(name: string, value: string): void { this.attributes.set(name, value) }
  append(...children: TestElement[]): void { this.children.push(...children) }
  replaceChildren(...children: Node[]): void { this.children = children as unknown as TestElement[] }
  querySelector<T extends Element>(selector: string): T | null { return (this.queries.get(selector) ?? null) as unknown as T | null }
  querySelectorAll<T extends Element>(selector: string): NodeListOf<T> {
    const matches = selector === '.field-alph-cell-cursor'
      ? this.children.filter(({ className }) => className === 'field-alph-cell-cursor')
      : []
    return matches as unknown as NodeListOf<T>
  }
  focus(): void { this.focusCount += 1 }
  getBoundingClientRect(): DOMRect { return this.rect as DOMRect }
}

const graphic: NitroGraphic = {
  width: 1,
  height: 1,
  pixels: new Uint8ClampedArray(4),
  graphicsOffset: 0,
  paletteOffset: 0,
  colorDepth: 4,
}

function digital(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'keyboard' }
}

function puzzleStep(tiles: AlphPuzzleFieldStep['tiles']): AlphPuzzleFieldStep {
  return {
    kind: 'alphPuzzle',
    puzzleIndex: 0,
    hint: 'KABUTO',
    tiles,
    graphics: Array.from({ length: 16 }, () => graphic),
    background: graphic,
  }
}

function solvedTiles(): AlphPuzzleFieldStep['tiles'] {
  return Array.from({ length: 16 }, (_, tileIndex) => ({
    tileIndex,
    x: tileIndex % 4 + 1,
    y: Math.floor(tileIndex / 4) + 1,
    rotation: 0,
    immovable: false,
  }))
}

function createFixture() {
  const root = new TestElement()
  const board = new TestElement()
  const hint = new TestElement()
  const inscription = new TestElement()
  const inscriptionVisual = new TestElement()
  const inscriptionWord = new TestElement()
  const title = new TestElement()
  const quit = new TestElement()
  root.queries.set('header span', title)
  root.queries.set('[data-alph-puzzle-quit]', quit)
  const calls: string[] = []
  const manual: string[] = []
  const confirmations: Array<() => void> = []
  const delays: number[] = []
  const timers = new Map<number, () => void>()
  const timerHistory = new Map<number, () => void>()
  let nextTimer = 1
  let runnerAvailable = true
  let audioError: unknown
  const runner: AlphFieldUiRunnerPort = {
    finishPuzzle: (solved) => { calls.push(`finish:${String(solved)}`) },
    closeInscription: () => { calls.push('close-inscription') },
    resume: () => { calls.push(`resume:${root.hidden && inscription.hidden ? 'closed' : 'open'}`) },
  }
  const host = createAlphFieldUiHost({
    root: root as unknown as HTMLElement,
    board: board as unknown as HTMLElement,
    hint: hint as unknown as HTMLElement,
    inscription: inscription as unknown as HTMLElement,
    inscriptionVisual: inscriptionVisual as unknown as HTMLElement,
    inscriptionWord: inscriptionWord as unknown as HTMLElement,
  }, {
    getGraphicCanvas: () => new TestElement() as unknown as HTMLCanvasElement,
    getMapLabel: () => 'Ruines d’Alpha',
    getQuitMessage: () => 'Quitter ?',
    requestConfirmation: (message, onConfirm) => { calls.push(`confirm:${message}`); confirmations.push(onConfirm) },
    prefersReducedMotion: () => false,
    getAudio: () => ({
      playSoundEffect: (sequenceId) => {
        calls.push(`sound:${sequenceId}`)
        return audioError === undefined ? Promise.resolve() : Promise.reject(audioError)
      },
    }),
    reportError: (message) => { calls.push(`error:${message}`) },
    readRunner: () => runnerAvailable ? runner : undefined,
    onManualInteraction: (kind) => { manual.push(kind) },
    createElement: () => new TestElement() as unknown as HTMLElement,
    scheduler: {
      setTimeout: (callback, delay) => {
        const id = nextTimer
        nextTimer += 1
        delays.push(delay)
        timers.set(id, callback)
        timerHistory.set(id, callback)
        return id
      },
      clearTimeout: (id) => { timers.delete(id) },
    },
  })
  return {
    root, board, hint, inscription, inscriptionVisual, inscriptionWord, title, quit,
    host, calls, manual, confirmations, delays, timers, timerHistory,
    setRunnerAvailable: (available: boolean) => { runnerAvailable = available },
    setAudioError: (error: unknown) => { audioError = error },
  }
}

describe('host terrain des Ruines d’Alpha', () => {
  it('rend les ressources ROM et partage la navigation entre clavier et pointeur sans double activation', () => {
    const fixture = createFixture()
    fixture.host.openPuzzle(puzzleStep([{
      tileIndex: 0,
      x: 2,
      y: 2,
      rotation: 0,
      immovable: false,
    }]))

    expect(fixture.root.hidden).toBe(false)
    expect(fixture.title.textContent).toBe('Ruines d’Alpha')
    expect(fixture.hint.textContent).toBe('KABUTO')
    expect(fixture.board.children).toHaveLength(38)
    expect(fixture.board.attributes.get('aria-label')).toBe('KABUTO')

    fixture.board.dispatch('pointerdown', { clientX: 50, clientY: 50 })
    fixture.board.dispatch('click')
    expect(fixture.manual).toEqual(['puzzle'])
    expect(fixture.host.getSnapshot()).toMatchObject({ cursor: { x: 2, y: 2 }, selectedTile: 0 })
    expect(fixture.host.getSnapshot().tiles[0]?.rotation).toBe(0)

    fixture.host.handleDigital(digital('confirm'))
    expect(fixture.host.getSnapshot().tiles[0]?.rotation).toBe(1)
    fixture.host.handleDigital(digital('right'))
    fixture.host.handleDigital(digital('confirm'))
    expect(fixture.host.getSnapshot()).toMatchObject({ cursor: { x: 3, y: 2 }, selectedTile: undefined })
    expect(fixture.host.getSnapshot().tiles[0]).toMatchObject({ x: 3, y: 2, rotation: 1 })
  })

  it('résout via automation, attend la transition et invalide un ancien timer au reset', () => {
    const fixture = createFixture()
    const tiles = solvedTiles()
    tiles[0] = { ...tiles[0]!, x: 0, y: 1, rotation: 3 }
    fixture.host.openPuzzle(puzzleStep(tiles))

    expect(fixture.host.solveForAutomation()).toBe(true)
    expect(fixture.root.classList.contains('is-solved')).toBe(true)
    expect(fixture.delays).toEqual([700])
    fixture.timers.get(1)?.()
    expect(fixture.calls).toEqual(['finish:true', 'resume:closed'])
    expect(fixture.host.getSnapshot().mode).toBe('closed')

    fixture.host.openPuzzle(puzzleStep(tiles))
    fixture.host.solveForAutomation()
    const staleTimer = fixture.timerHistory.get(2)
    fixture.host.reset()
    staleTimer?.()
    expect(fixture.calls).toEqual(['finish:true', 'resume:closed'])
  })

  it('confirme l’abandon avec le message ROM et ignore une confirmation devenue périmée', () => {
    const fixture = createFixture()
    const step = puzzleStep([{ tileIndex: 0, x: 2, y: 2, rotation: 0, immovable: false }])
    fixture.host.openPuzzle(step)
    expect(fixture.host.handleDigital(digital('cancel'))).toBe(true)
    expect(fixture.calls).toEqual(['confirm:Quitter ?'])
    const staleConfirmation = fixture.confirmations[0]

    fixture.host.reset()
    staleConfirmation?.()
    expect(fixture.calls).toEqual(['confirm:Quitter ?'])

    fixture.host.openPuzzle(step)
    fixture.quit.dispatch('click')
    fixture.confirmations[1]?.()
    expect(fixture.calls).toEqual(['confirm:Quitter ?', 'confirm:Quitter ?', 'finish:false', 'resume:closed'])
  })

  it('ouvre et ferme une inscription avec le son ROM et rapporte une erreur audio active', async () => {
    const fixture = createFixture()
    const step: AlphInscriptionFieldStep = { kind: 'alphHiddenRoom', roomIndex: 2, word: 'EAU', background: graphic }
    fixture.host.openInscription(step)
    expect(fixture.host.getSnapshot().mode).toBe('inscription')
    expect(fixture.inscriptionWord.textContent).toBe('EAU')
    expect(fixture.calls).toEqual(['sound:1500'])
    expect(fixture.host.handleDigital(digital('left'))).toBe(true)
    expect(fixture.host.handleDigital(digital('confirm'))).toBe(true)
    expect(fixture.calls).toEqual(['sound:1500', 'close-inscription', 'sound:1500', 'resume:closed'])

    fixture.setAudioError('indisponible')
    fixture.host.openInscription(step)
    await Promise.resolve()
    expect(fixture.calls.at(-1)).toBe('error:Le son ROM des Ruines d’Alpha est indisponible.')
  })

  it('détache tous les listeners et invalide la vue à la destruction', () => {
    const fixture = createFixture()
    const step: AlphInscriptionFieldStep = { kind: 'alphHiddenRoom', roomIndex: 0, word: 'SORTIE', background: graphic }
    fixture.host.openInscription(step)
    const pointer = fixture.inscription.dispatch('pointerdown')
    expect(pointer.defaultPrevented).toBe(true)
    expect(fixture.manual).toEqual(['inscription'])

    fixture.host.openPuzzle(puzzleStep([{ tileIndex: 0, x: 2, y: 2, rotation: 0, immovable: false }]))
    expect(fixture.board.listenerCount('pointerdown')).toBe(1)
    fixture.host.destroy()
    expect(fixture.board.listenerCount('pointerdown')).toBe(0)
    expect(fixture.board.listenerCount('click')).toBe(0)
    expect(fixture.quit.listenerCount('click')).toBe(0)
    expect(fixture.inscription.listenerCount('pointerdown')).toBe(0)
    expect(fixture.host.getSnapshot().mode).toBe('closed')

    fixture.setRunnerAvailable(false)
    fixture.host.openPuzzle(puzzleStep([]))
    expect(fixture.host.getSnapshot().mode).toBe('closed')
  })
})
