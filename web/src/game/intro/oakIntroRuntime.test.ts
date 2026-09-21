import { describe, expect, it, vi } from 'vitest'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import type { GameScreenRuntime } from '../../gameScreenRuntime'
import type { PlayerProfile } from '../../playerProfile'
import type { RomInventory } from '../../ndsTypes'
import type { GameTextEntryRequest } from '../ui/gameTextEntryOverlay'
import {
  createOakIntroRuntime,
  type OakIntroRuntime,
  type OakIntroScheduler,
} from './oakIntroRuntime'
import type { IntroRenderState } from './introTypes'

const introMessages = Object.fromEntries(
  Array.from({ length: 62 }, (_, index) => [index + 1, `Message ROM ${index + 1}`]),
)

class TestScheduler implements OakIntroScheduler {
  private clock = 0
  private nextHandle = 1
  private readonly timers = new Map<number, { at: number, callback: () => void }>()
  private readonly frames = new Map<number, FrameRequestCallback>()

  now = (): number => this.clock

  setTimeout = (callback: () => void, delayMs: number): number => {
    const handle = this.nextHandle++
    this.timers.set(handle, { at: this.clock + delayMs, callback })
    return handle
  }

  clearTimeout = (handle: number): void => { this.timers.delete(handle) }

  requestAnimationFrame = (callback: FrameRequestCallback): number => {
    const handle = this.nextHandle++
    this.frames.set(handle, callback)
    return handle
  }

  cancelAnimationFrame = (handle: number): void => { this.frames.delete(handle) }

  advance(milliseconds: number): void {
    const target = this.clock + milliseconds
    for (;;) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= target)
        .sort((left, right) => left[1].at - right[1].at || left[0] - right[0])[0]
      if (!next) break
      const [handle, timer] = next
      this.timers.delete(handle)
      this.clock = timer.at
      timer.callback()
    }
    this.clock = target
  }

  runFrame(milliseconds = 16): void {
    this.clock += milliseconds
    const callbacks = [...this.frames.values()]
    this.frames.clear()
    for (const callback of callbacks) callback(this.clock)
  }

  runFrames(count: number, milliseconds = 16): void {
    for (let index = 0; index < count; index += 1) this.runFrame(milliseconds)
  }

  pending(): number {
    return this.timers.size + this.frames.size
  }

  hasPendingFrame(): boolean {
    return this.frames.size > 0
  }
}

class TestTextEntry {
  request: GameTextEntryRequest | undefined
  readonly open = vi.fn((request: GameTextEntryRequest): void => {
    if (this.request) throw new Error('Une saisie est déjà ouverte.')
    this.request = request
  })
  readonly close = vi.fn((): void => {
    const request = this.request
    this.request = undefined
    request?.cancel()
  })
  readonly refresh = vi.fn()
  readonly isOpen = (): boolean => this.request !== undefined

  submit(value: string): void {
    const request = this.request
    if (!request) throw new Error('Saisie absente.')
    this.request = undefined
    request.submit(value)
  }
}

function inventory(): RomInventory {
  return { introMessages } as unknown as RomInventory
}

function audioRuntime() {
  return {
    playMusicByName: vi.fn(async () => 1),
    fadeMusic: vi.fn(async () => undefined),
    playCry: vi.fn(async () => undefined),
  } satisfies Pick<RomAudioRuntime, 'playMusicByName' | 'fadeMusic' | 'playCry'>
}

function fixture() {
  const scheduler = new TestScheduler()
  const textEntry = new TestTextEntry()
  const screen = {
    setMode: vi.fn(),
    showCanvas: vi.fn(),
    drawIntro: vi.fn(),
    drawIntroShrink: vi.fn(),
    completeIntroTextAnimation: vi.fn(() => false),
    canAdvanceIntro: vi.fn(() => true),
  } satisfies Pick<GameScreenRuntime,
    'setMode'
    | 'showCanvas'
    | 'drawIntro'
    | 'drawIntroShrink'
    | 'completeIntroTextAnimation'
    | 'canAdvanceIntro'>
  const fade = { style: { backgroundColor: '', transition: '', opacity: '' } } as unknown as HTMLElement
  const state: {
    inventory: RomInventory | undefined
    audio: ReturnType<typeof audioRuntime> | undefined
    profile: PlayerProfile
  } = {
    inventory: inventory(),
    audio: audioRuntime(),
    profile: { gender: 'male', name: '' },
  }
  const beforeStart = vi.fn()
  const applyPlayerSkin = vi.fn()
  const onComplete = vi.fn()
  const reportStatus = vi.fn()
  const runtime = createOakIntroRuntime({
    screen,
    fade,
    textEntry,
    getInventory: () => state.inventory,
    getAudio: () => state.audio,
    getProfile: () => state.profile,
    beforeStart,
    applyPlayerSkin,
    onComplete,
    reportStatus,
    scheduler,
  })
  return {
    runtime,
    scheduler,
    textEntry,
    screen,
    fade,
    state,
    beforeStart,
    applyPlayerSkin,
    onComplete,
    reportStatus,
  }
}

function renderState(runtime: OakIntroRuntime): IntroRenderState {
  const state = runtime.getSnapshot().renderState
  if (!state) throw new Error('État de rendu Oak absent.')
  return state
}

function reachMode(runtime: OakIntroRuntime, mode: IntroRenderState['mode']): IntroRenderState {
  for (let step = 0; step < 100; step += 1) {
    const current = renderState(runtime)
    if (current.mode === mode) return current
    if (current.mode === 'tutorial-choice') runtime.advance({ kind: 'choice', index: 2 })
    else if (current.mode === 'gender-select') runtime.advance({ kind: 'gender', gender: 'female' })
    else if (current.mode === 'gender-confirm') runtime.advance({ kind: 'choice', index: 0 })
    else runtime.advance()
  }
  throw new Error(`Mode Oak ${mode} non atteint.`)
}

function beginCompletion(context: ReturnType<typeof fixture>): void {
  reachMode(context.runtime, 'name-input')
  context.textEntry.submit('LYRA')
  expect(renderState(context.runtime).mode).toBe('name-confirm')
  context.runtime.advance({ kind: 'choice', index: 0 })
  for (let step = 0; step < 20 && context.runtime.getSnapshot().phase === 'running'; step += 1) {
    context.runtime.advance()
  }
  expect(context.runtime.getSnapshot().phase).toBe('transitioning')
}

describe('createOakIntroRuntime', () => {
  it('starts the ROM presentation and reads the current host bindings', () => {
    const context = fixture()

    expect(context.runtime.start()).toBe(true)

    expect(context.beforeStart).toHaveBeenCalledOnce()
    expect(context.runtime.getSnapshot()).toMatchObject({
      phase: 'running',
      renderState: { mode: 'dialog', messageId: 7 },
    })
    expect(context.screen.setMode).toHaveBeenCalledWith('story')
    expect(context.screen.showCanvas).toHaveBeenCalledWith(true)
    expect(context.screen.drawIntro).toHaveBeenCalledOnce()
    expect(context.state.audio?.playMusicByName).toHaveBeenCalledWith(['SEQ_GS_STARTING'])
    expect(context.fade.style).toMatchObject({ backgroundColor: '#000', transition: 'none', opacity: '1' })

    context.scheduler.runFrame()
    expect(context.fade.style).toMatchObject({ transition: 'opacity 420ms steps(6, end)', opacity: '0' })
  })

  it('routes digital input and pointer previews without exposing OakIntroFlow', () => {
    const context = fixture()
    expect(context.runtime.handleDigital('confirm')).toBe(false)
    context.runtime.start()

    expect(context.runtime.handleDigital('confirm')).toBe(true)
    expect(renderState(context.runtime)).toMatchObject({ mode: 'tutorial-choice', selectedChoice: 0 })
    expect(context.runtime.handleDigital('down')).toBe(true)
    expect(renderState(context.runtime).selectedChoice).toBe(1)
    expect(context.runtime.preview({ kind: 'choice', index: 2 })).toBe(true)
    expect(renderState(context.runtime).selectedChoice).toBe(2)
    expect(context.runtime.handleDigital('confirm')).toBe(true)
    expect(renderState(context.runtime).mode).toBe('dialog')
  })

  it('owns the central name entry and updates the latest profile object', () => {
    const context = fixture()
    context.runtime.start()
    context.state.profile = { gender: 'male', name: 'STALE' }

    const nameState = reachMode(context.runtime, 'name-input')
    expect(context.textEntry.request).toMatchObject({
      mode: 'name',
      title: nameState.text,
      maxLength: nameState.nameInput?.maxLength,
      cancellable: false,
    })
    expect(nameState.nameInput).toEqual({ value: '', maxLength: 7 })
    expect(context.runtime.handleDigital('confirm')).toBe(true)
    expect(renderState(context.runtime).mode).toBe('name-input')

    context.textEntry.request?.write('lyra!')
    expect(context.textEntry.request?.read()).toBe('LYRA')
    expect(context.state.profile).toMatchObject({ gender: 'female', name: 'LYRA' })
    context.screen.completeIntroTextAnimation.mockClear()
    context.screen.completeIntroTextAnimation.mockReturnValueOnce(true)
    context.textEntry.submit('LYRA')

    expect(context.screen.completeIntroTextAnimation).not.toHaveBeenCalled()
    expect(context.runtime.getSnapshot()).toMatchObject({
      phase: 'running',
      renderState: { mode: 'name-confirm', playerName: 'LYRA' },
    })
    expect(context.textEntry.isOpen()).toBe(false)
  })

  it('closes its name entry when the automated intro reaches the field', () => {
    const context = fixture()
    context.runtime.start()

    for (let step = 0; step < 100 && context.runtime.getSnapshot().phase === 'running'; step += 1) {
      const current = renderState(context.runtime)
      if (current.mode === 'tutorial-choice') context.runtime.advance({ kind: 'choice', index: 2 })
      else if (current.mode === 'name-input') context.runtime.submitAutomatedName(current.playerName || 'B')
      else context.runtime.advance()
    }

    expect(context.runtime.getSnapshot().phase).toBe('transitioning')
    expect(context.textEntry.isOpen()).toBe(false)
  })

  it('plays the complete shrink timing before handing control to the field', () => {
    const context = fixture()
    context.runtime.start()
    context.scheduler.runFrame()
    beginCompletion(context)

    expect(context.fade.style.opacity).toBe('1')
    context.scheduler.advance(109)
    expect(context.screen.drawIntroShrink).not.toHaveBeenCalled()
    context.scheduler.advance(1)
    expect(context.screen.drawIntroShrink).toHaveBeenCalledWith(context.state.inventory, 'female', 0)

    for (let frame = 0; frame < 100 && context.scheduler.hasPendingFrame(); frame += 1) {
      context.scheduler.runFrame()
    }
    expect(context.scheduler.hasPendingFrame()).toBe(false)
    expect(context.fade.style.opacity).toBe('1')
    expect(context.onComplete).not.toHaveBeenCalled()
    context.scheduler.advance(109)
    expect(context.onComplete).not.toHaveBeenCalled()
    context.scheduler.advance(1)

    expect(context.onComplete).toHaveBeenCalledOnce()
    expect(context.runtime.getSnapshot().phase).toBe('idle')
    expect(context.fade.style.opacity).toBe('1')
    context.scheduler.runFrame()
    expect(context.fade.style).toMatchObject({ transition: 'opacity 420ms steps(6, end)', opacity: '0' })
  })

  it('invalidates timers, RAF and owned text entry on cancel or dispose', () => {
    const context = fixture()
    context.runtime.start()
    beginCompletion(context)
    expect(context.scheduler.pending()).toBeGreaterThan(0)

    context.runtime.cancel()
    expect(context.runtime.getSnapshot().phase).toBe('idle')
    expect(context.scheduler.pending()).toBe(0)
    expect(context.fade.style.opacity).toBe('0')
    context.scheduler.advance(5_000)
    context.scheduler.runFrames(100)
    expect(context.onComplete).not.toHaveBeenCalled()
    expect(context.screen.drawIntroShrink).not.toHaveBeenCalled()

    context.runtime.dispose()
    expect(context.runtime.getSnapshot().phase).toBe('disposed')
    expect(context.runtime.start()).toBe(false)
  })

  it('does not continue an asynchronous music handoff through a stale audio getter', async () => {
    const context = fixture()
    const pendingFade = new Promise<void>((resolve) => {
      context.state.audio!.fadeMusic.mockImplementationOnce(async () => { resolve() })
    })
    context.runtime.start()
    context.runtime.advance()
    context.runtime.advance({ kind: 'choice', index: 2 })
    context.runtime.advance()
    expect(context.state.audio?.fadeMusic).toHaveBeenCalledWith(0, 6)
    const previousAudio = context.state.audio!
    context.state.audio = audioRuntime()

    await pendingFade
    await Promise.resolve()
    await Promise.resolve()

    expect(previousAudio.playMusicByName).not.toHaveBeenCalledWith(['SEQ_GS_STARTING2'])
    expect(context.state.audio.playMusicByName).not.toHaveBeenCalled()
  })
})
