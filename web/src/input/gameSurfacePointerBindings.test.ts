import { describe, expect, it, vi } from 'vitest'
import {
  installGameSurfacePointerBindings,
  type GameSurfaceFlowState,
  type GameSurfacePointerElements,
  type GameSurfacePointerScheduler,
} from './gameSurfacePointerBindings'

type RegisteredListener = EventListenerOrEventListenerObject

class TestElement {
  readonly dataset: Record<string, string | undefined> = {}
  readonly style = { cursor: '' }
  value = ''
  private readonly listeners = new Map<string, RegisteredListener[]>()
  private readonly queryResults = new Map<string, TestElement>()
  private queryAllResults: TestElement[] = []

  addEventListener(type: string, listener: RegisteredListener): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: RegisteredListener): void {
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter((candidate) => candidate !== listener))
  }

  dispatch(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) {
      if (typeof listener === 'function') listener.call(this, event)
      else listener.handleEvent(event)
    }
  }

  querySelector<T extends Element>(selector: string): T | null {
    return (this.queryResults.get(selector) ?? null) as T | null
  }

  querySelectorAll<T extends Element>(selector: string): NodeListOf<T> {
    void selector
    return this.queryAllResults as unknown as NodeListOf<T>
  }

  contains(candidate: unknown): boolean {
    return candidate === this || this.queryAllResults.includes(candidate as TestElement)
  }

  focus(options?: FocusOptions): void { void options }
}

class TestScheduler implements GameSurfacePointerScheduler {
  private nextHandle = 1
  private readonly callbacks = new Map<number, () => void>()
  readonly delays: number[] = []
  readonly cleared: number[] = []

  setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++
    this.callbacks.set(handle, callback)
    this.delays.push(delayMs)
    return handle
  }

  clearTimeout = (handle: number): void => {
    this.cleared.push(handle)
    this.callbacks.delete(handle)
  }

  runAll(): void {
    const callbacks = [...this.callbacks.values()]
    this.callbacks.clear()
    for (const callback of callbacks) callback()
  }
}

function pointerEvent(overrides: Partial<PointerEvent> = {}): PointerEvent {
  return {
    button: 0,
    pointerType: 'mouse',
    preventDefault: vi.fn(),
    ...overrides,
  } as unknown as PointerEvent
}

function createElements(): { raw: Record<keyof GameSurfacePointerElements, TestElement>, elements: GameSurfacePointerElements } {
  const raw = {
    fieldDialogue: new TestElement(),
    battleMessage: new TestElement(),
    battleCommands: new TestElement(),
    battleMoves: new TestElement(),
    battleScreen: new TestElement(),
    battleEvolution: new TestElement(),
    runtimeCanvas: new TestElement(),
    fieldNumber: new TestElement(),
    fieldNumberInput: new TestElement(),
    fieldNickname: new TestElement(),
    fieldNicknameInput: new TestElement(),
    screenCanvas: new TestElement(),
  }
  return { raw, elements: raw as unknown as GameSurfacePointerElements }
}

function createFixture() {
  const { raw, elements } = createElements()
  const scheduler = new TestScheduler()
  const dispatchPointer = vi.fn()
  const stopBot = vi.fn()
  let botRunning = false
  let flow: GameSurfaceFlowState = 'bedroom'
  let menuOpen = false
  let battleCursor = 0
  const bindings = installGameSurfacePointerBindings({
    elements,
    dispatchPointer,
    bot: {
      isRunning: () => botRunning,
      stop: stopBot,
    },
    battle: {
      readCursor: () => battleCursor,
      writeCursor: (cursor) => { battleCursor = cursor },
      renderCursor: vi.fn(),
      isBagOpen: () => false,
      readInputProfile: () => 'mouse',
    },
    field: {
      readFlowState: () => flow,
      isMainMenuOpen: () => menuOpen,
      submitNumber: vi.fn(),
      submitNickname: vi.fn(),
    },
    intro: {
      readRenderState: () => undefined,
      readOpeningElapsedMs: () => 0,
      advance: vi.fn(),
      preview: vi.fn(),
    },
    scheduler,
  })
  return {
    raw,
    scheduler,
    dispatchPointer,
    stopBot,
    bindings,
    setBotRunning: (running: boolean) => { botRunning = running },
    setFlow: (state: GameSurfaceFlowState) => { flow = state },
    setMenuOpen: (open: boolean) => { menuOpen = open },
  }
}

describe('game surface pointer bindings', () => {
  it('active le dialogue une seule fois et arrête le bot avant de confirmer', () => {
    const fixture = createFixture()
    fixture.setBotRunning(true)
    const event = pointerEvent()

    fixture.raw.fieldDialogue.dispatch('pointerdown', event)

    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(fixture.stopBot).toHaveBeenCalledWith('Bot arrêté : dialogue repris manuellement.')
    expect(fixture.dispatchPointer).toHaveBeenCalledOnce()
    expect(fixture.dispatchPointer).toHaveBeenCalledWith('confirm')
  })

  it('transforme un appui tactile long en Menu sans confirmer au relâchement', () => {
    const fixture = createFixture()

    fixture.raw.runtimeCanvas.dispatch('pointerdown', pointerEvent({ pointerType: 'touch' }))
    expect(fixture.scheduler.delays).toEqual([480])

    fixture.scheduler.runAll()
    fixture.raw.runtimeCanvas.dispatch('pointerup', pointerEvent({ pointerType: 'touch' }))

    expect(fixture.dispatchPointer).toHaveBeenCalledTimes(1)
    expect(fixture.dispatchPointer).toHaveBeenCalledWith('menu')
  })

  it('annule le timer au pointercancel et route un tap court vers Retour si le menu est ouvert', () => {
    const fixture = createFixture()
    fixture.raw.runtimeCanvas.dispatch('pointerdown', pointerEvent({ pointerType: 'pen' }))
    fixture.raw.runtimeCanvas.dispatch('pointercancel', pointerEvent({ pointerType: 'pen' }))
    fixture.scheduler.runAll()
    expect(fixture.dispatchPointer).not.toHaveBeenCalled()
    expect(fixture.scheduler.cleared).toEqual([1])

    fixture.setMenuOpen(true)
    fixture.raw.runtimeCanvas.dispatch('pointerdown', pointerEvent({ pointerType: 'touch' }))
    fixture.raw.runtimeCanvas.dispatch('pointerup', pointerEvent({ pointerType: 'touch' }))

    expect(fixture.dispatchPointer).toHaveBeenCalledOnce()
    expect(fixture.dispatchPointer).toHaveBeenCalledWith('cancel')
  })

  it('dispose tous les listeners et le long appui encore armé', () => {
    const fixture = createFixture()
    fixture.raw.runtimeCanvas.dispatch('pointerdown', pointerEvent({ pointerType: 'touch' }))

    fixture.bindings.dispose()
    fixture.bindings.dispose()
    fixture.scheduler.runAll()
    fixture.raw.fieldDialogue.dispatch('pointerdown', pointerEvent())

    expect(fixture.scheduler.cleared).toEqual([1])
    expect(fixture.dispatchPointer).not.toHaveBeenCalled()
  })
})
