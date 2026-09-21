import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { startRomCry } from '../../audio/romAudioPresentation'
import type { GameDigitalAction } from '../../gameInput'
import { getOakMarillTiming, type GameScreenRuntime } from '../../gameScreenRuntime'
import { handleIntroDigitalInput, type IntroInputCallbacks } from '../../input/introInput'
import type { IntroPointerAction } from '../../introControls'
import { createOakIntroFlow, type OakIntroFlow } from '../../oakIntroFlow'
import type { PlayerProfile } from '../../playerProfile'
import type { RomInventory } from '../../ndsTypes'
import type { GameTextEntryOverlay } from '../ui/gameTextEntryOverlay'
import type { IntroRenderState } from './introTypes'

export type OakIntroRuntimePhase = 'idle' | 'running' | 'transitioning' | 'disposed'

export type OakIntroRuntimeSnapshot = Readonly<{
  phase: OakIntroRuntimePhase
  renderState?: IntroRenderState
}>

export type OakIntroScheduler = Readonly<{
  now: () => number
  setTimeout: (callback: () => void, delayMs: number) => number
  clearTimeout: (handle: number) => void
  requestAnimationFrame: (callback: FrameRequestCallback) => number
  cancelAnimationFrame: (handle: number) => void
}>

type OakIntroScreen = Pick<GameScreenRuntime,
  'setMode'
  | 'showCanvas'
  | 'drawIntro'
  | 'drawIntroShrink'
  | 'completeIntroTextAnimation'
  | 'canAdvanceIntro'>

type OakIntroTextEntry = Pick<GameTextEntryOverlay, 'open' | 'close' | 'refresh' | 'isOpen'>
type OakIntroAudio = Pick<RomAudioRuntime, 'playMusicByName' | 'fadeMusic' | 'playCry'>

export type OakIntroRuntimeOptions = Readonly<{
  screen: OakIntroScreen
  fade: HTMLElement
  textEntry: OakIntroTextEntry
  getInventory: () => RomInventory | undefined
  getAudio: () => OakIntroAudio | undefined
  getProfile: () => PlayerProfile
  beforeStart: () => void
  applyPlayerSkin: () => void
  onComplete: () => void
  reportStatus: (message: string) => void
  scheduler?: OakIntroScheduler
}>

export type OakIntroRuntime = Readonly<{
  start: () => boolean
  cancel: () => void
  dispose: () => void
  isActive: () => boolean
  getSnapshot: () => OakIntroRuntimeSnapshot
  draw: (force?: boolean) => boolean
  redraw: () => boolean
  advance: (action?: IntroPointerAction) => boolean
  preview: (action: IntroPointerAction) => boolean
  handleDigital: (action: GameDigitalAction) => boolean
  submitAutomatedName: (value: string) => boolean
}>

const introStatus = 'ROM chargee : introduction Oak en cours. Continuez avec Entree / Espace ou un clic dans l’ecran.'

function browserScheduler(): OakIntroScheduler {
  return {
    now: () => performance.now(),
    setTimeout: (callback, delayMs) => window.setTimeout(callback, delayMs),
    clearTimeout: (handle) => window.clearTimeout(handle),
    requestAnimationFrame: (callback) => window.requestAnimationFrame(callback),
    cancelAnimationFrame: (handle) => window.cancelAnimationFrame(handle),
  }
}

/** Owns the stateful Oak presentation while exposing only application ports. */
export function createOakIntroRuntime(options: OakIntroRuntimeOptions): OakIntroRuntime {
  const scheduler = options.scheduler ?? browserScheduler()
  let phase: OakIntroRuntimePhase = 'idle'
  let flow: OakIntroFlow | undefined
  let runInventory: RomInventory | undefined
  let revision = 0
  let ownsNameEntry = false
  const timeoutHandles = new Set<number>()
  const animationFrameHandles = new Set<number>()

  const isRevisionCurrent = (expectedRevision: number): boolean => (
    phase !== 'disposed'
    && revision === expectedRevision
    && runInventory !== undefined
    && options.getInventory() === runInventory
  )

  const scheduleTimeout = (expectedRevision: number, callback: () => void, delayMs: number): number => {
    let handle = 0
    handle = scheduler.setTimeout(() => {
      timeoutHandles.delete(handle)
      if (isRevisionCurrent(expectedRevision)) callback()
    }, delayMs)
    timeoutHandles.add(handle)
    return handle
  }

  const scheduleFrame = (expectedRevision: number, callback: FrameRequestCallback): number => {
    let handle = 0
    handle = scheduler.requestAnimationFrame((now) => {
      animationFrameHandles.delete(handle)
      if (isRevisionCurrent(expectedRevision)) callback(now)
    })
    animationFrameHandles.add(handle)
    return handle
  }

  const clearScheduledWork = (): void => {
    for (const handle of timeoutHandles) scheduler.clearTimeout(handle)
    for (const handle of animationFrameHandles) scheduler.cancelAnimationFrame(handle)
    timeoutHandles.clear()
    animationFrameHandles.clear()
  }

  const closeOwnedNameEntry = (): void => {
    if (!ownsNameEntry) return
    ownsNameEntry = false
    if (options.textEntry.isOpen()) options.textEntry.close()
  }

  const resetFade = (): void => {
    options.fade.style.backgroundColor = '#000'
    options.fade.style.transition = 'none'
    options.fade.style.opacity = '0'
  }

  const invalidate = (nextPhase: OakIntroRuntimePhase, resetPresentation: boolean): void => {
    revision += 1
    clearScheduledWork()
    closeOwnedNameEntry()
    flow = undefined
    runInventory = undefined
    phase = nextPhase
    if (resetPresentation) resetFade()
  }

  const currentRunning = (): { flow: OakIntroFlow, inventory: RomInventory, revision: number } | undefined => {
    const inventory = options.getInventory()
    if (phase !== 'running' || !flow || !runInventory || inventory !== runInventory) return undefined
    return { flow, inventory, revision }
  }

  const syncProfile = (): void => {
    const active = currentRunning()
    if (!active) return
    const renderState = active.flow.getRenderState()
    const profile = options.getProfile()
    if (renderState.selectedGender) profile.gender = renderState.selectedGender
    if (renderState.playerName !== undefined) profile.name = renderState.playerName
    options.applyPlayerSkin()
  }

  const draw = (force = false): boolean => {
    const active = currentRunning()
    if (!active) return false
    options.screen.drawIntro(active.inventory, active.flow.getRenderState(), force)
    return true
  }

  const redraw = (): boolean => {
    const active = currentRunning()
    if (!active) return false
    syncProfile()
    options.screen.drawIntro(active.inventory, active.flow.getRenderState(), true)
    if (options.textEntry.isOpen()) options.textEntry.refresh()
    return true
  }

  const syncNameTextEntry = (): void => {
    const active = currentRunning()
    const intro = active?.flow.getRenderState()
    if (!active || intro?.mode !== 'name-input' || !intro.nameInput) {
      closeOwnedNameEntry()
      return
    }
    if (options.textEntry.isOpen()) {
      options.textEntry.refresh()
      return
    }
    const ownerFlow = active.flow
    ownsNameEntry = true
    try {
      options.textEntry.open({
        mode: 'name',
        title: intro.text || 'Votre nom',
        maxLength: intro.nameInput.maxLength,
        cancellable: false,
        invalidMessage: 'Entrez un nom.',
        validate: (value) => value.trim().length > 0,
        read: () => ownerFlow.getRenderState().playerName ?? '',
        write: (value) => {
          if (currentRunning()?.flow !== ownerFlow) return
          ownerFlow.setPlayerName(value)
          redraw()
        },
        submit: (value) => {
          ownsNameEntry = false
          if (currentRunning()?.flow !== ownerFlow) return
          ownerFlow.setPlayerName(value)
          advance(undefined, true)
        },
        cancel: () => { ownsNameEntry = false },
      })
    } catch (error) {
      ownsNameEntry = false
      throw error
    }
  }

  const moveGenderCursor = (direction: -1 | 1): boolean => {
    const active = currentRunning()
    if (!active || !active.flow.getRenderState().showGenderSelect) return false
    active.flow.moveGenderCursor(direction)
    redraw()
    return true
  }

  const inputCallbacks = (): IntroInputCallbacks => ({
    advance: () => { advance() },
    redraw: () => { redraw() },
    moveGenderCursor: (direction) => { moveGenderCursor(direction) },
  })

  const beginMusicContinuation = (active: { flow: OakIntroFlow, revision: number }): void => {
    const audio = options.getAudio()
    if (!audio) return
    void (async () => {
      try { await audio.fadeMusic(0, 6) }
      catch { /* Audio may still await its first user gesture. */ }
      const current = currentRunning()
      if (!current || current.revision !== active.revision || current.flow !== active.flow || options.getAudio() !== audio) return
      await audio.playMusicByName(['SEQ_GS_STARTING2'])
    })().catch(() => undefined)
  }

  const beginCompletionTransition = (): void => {
    const active = currentRunning()
    if (!active) return
    const expectedRevision = active.revision
    const inventory = active.inventory
    const gender = options.getProfile().gender
    flow = undefined
    closeOwnedNameEntry()
    phase = 'transitioning'
    options.fade.style.backgroundColor = '#000'
    options.fade.style.transition = 'opacity 100ms steps(6, end)'
    options.fade.style.opacity = '1'
    scheduleTimeout(expectedRevision, () => {
      const shrinkStartedAt = scheduler.now()
      options.screen.drawIntroShrink(inventory, gender, 0)
      options.fade.style.transition = 'opacity 100ms steps(6, end)'
      options.fade.style.opacity = '0'
      const animateShrink: FrameRequestCallback = (now) => {
        const elapsedMs = now - shrinkStartedAt
        options.screen.drawIntroShrink(inventory, gender, elapsedMs)
        if (elapsedMs < 1_200) {
          scheduleFrame(expectedRevision, animateShrink)
          return
        }
        options.fade.style.transition = 'opacity 100ms steps(6, end)'
        options.fade.style.opacity = '1'
        scheduleTimeout(expectedRevision, () => {
          phase = 'idle'
          options.onComplete()
          if (!isRevisionCurrent(expectedRevision)) return
          options.fade.style.backgroundColor = '#000'
          options.fade.style.transition = 'none'
          options.fade.style.opacity = '1'
          scheduleFrame(expectedRevision, () => {
            options.fade.style.transition = 'opacity 420ms steps(6, end)'
            options.fade.style.opacity = '0'
          })
        }, 110)
      }
      scheduleFrame(expectedRevision, () => { scheduleFrame(expectedRevision, animateShrink) })
    }, 110)
  }

  function advance(action?: IntroPointerAction, nameEntrySubmitted = false): boolean {
    const active = currentRunning()
    if (!active) return false
    if (!options.screen.canAdvanceIntro(active.inventory, active.flow.getRenderState())) return true
    if (!nameEntrySubmitted && (!action || action.kind === 'choice') && options.screen.completeIntroTextAnimation()) {
      options.screen.drawIntro(active.inventory, active.flow.getRenderState(), true)
      return true
    }
    const previousIntroState = active.flow.getRenderState()
    const result = action?.kind === 'gender'
      ? active.flow.chooseGender(action.gender)
      : action?.kind === 'choice'
        ? active.flow.chooseCurrentSelection(action.index)
        : active.flow.advance()
    const nextIntroState = active.flow.getRenderState()
    if (previousIntroState.messageId !== undefined
      && previousIntroState.messageId >= 1
      && previousIntroState.messageId <= 5
      && nextIntroState.messageId === 6) {
      beginMusicContinuation(active)
    }
    if (previousIntroState.messageId === 34 && nextIntroState.messageId === 35) {
      const { cryAtMs } = getOakMarillTiming(active.inventory)
      scheduleTimeout(active.revision, () => {
        const current = currentRunning()
        if (current?.flow.getRenderState().messageId === 35) startRomCry(options.getAudio(), 183)
      }, cryAtMs)
    }
    if (result === 'complete') {
      syncProfile()
      beginCompletionTransition()
      return true
    }
    syncProfile()
    options.screen.drawIntro(active.inventory, active.flow.getRenderState(), true)
    syncNameTextEntry()
    options.reportStatus(introStatus)
    return true
  }

  const preview = (action: IntroPointerAction): boolean => {
    const active = currentRunning()
    if (!active) return false
    const before = active.flow.getRenderState()
    if (action.kind === 'gender' && before.selectedGender !== action.gender) active.flow.setGenderCursor(action.gender)
    else if (action.kind === 'choice' && before.selectedChoice !== action.index) active.flow.setChoiceCursor(action.index)
    else return false
    redraw()
    return true
  }

  const start = (): boolean => {
    if (phase === 'disposed' || !options.getInventory()) return false
    invalidate('idle', true)
    const startRevision = revision
    options.beforeStart()
    const inventory = options.getInventory()
    if (!inventory || revision !== startRevision) return false
    runInventory = inventory
    flow = createOakIntroFlow(inventory.introMessages)
    phase = 'running'
    const expectedRevision = revision
    syncProfile()
    options.screen.setMode('story')
    options.screen.showCanvas(true)
    void options.getAudio()?.playMusicByName(['SEQ_GS_STARTING']).catch(() => undefined)
    options.reportStatus(introStatus)
    options.fade.style.backgroundColor = '#000'
    options.fade.style.transition = 'none'
    options.fade.style.opacity = '1'
    options.screen.drawIntro(inventory, flow.getRenderState(), true)
    syncNameTextEntry()
    scheduleFrame(expectedRevision, () => {
      options.fade.style.transition = 'opacity 420ms steps(6, end)'
      options.fade.style.opacity = '0'
    })
    return true
  }

  const cancel = (): void => {
    if (phase === 'disposed') return
    invalidate('idle', true)
  }

  const dispose = (): void => {
    if (phase === 'disposed') return
    invalidate('disposed', true)
  }

  const getSnapshot = (): OakIntroRuntimeSnapshot => {
    const renderState = phase === 'running' ? flow?.getRenderState() : undefined
    return renderState ? { phase, renderState } : { phase }
  }

  const handleDigital = (action: GameDigitalAction): boolean => {
    const active = currentRunning()
    return active ? handleIntroDigitalInput(action, active.flow, inputCallbacks()) : false
  }

  const submitAutomatedName = (value: string): boolean => {
    const active = currentRunning()
    if (!active || active.flow.getRenderState().mode !== 'name-input') return false
    active.flow.setPlayerName(value)
    closeOwnedNameEntry()
    return advance(undefined, true)
  }

  return {
    start,
    cancel,
    dispose,
    isActive: () => phase === 'running' || phase === 'transitioning',
    getSnapshot,
    draw,
    redraw,
    advance,
    preview,
    handleDigital,
    submitAutomatedName,
  }
}
