import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'

export type PokegearFlyTransitionPhase =
  | 'idle'
  | 'starting'
  | 'departure'
  | 'conceal'
  | 'teleport'
  | 'arrival'
  | 'cleanup'

export const pokegearFlyTransitionFrames = {
  departure: 30,
  conceal: 8,
  arrival: 30,
} as const

export type PokegearFlyTransitionElements = {
  root: HTMLElement
  scene: HTMLElement
  carrier: HTMLElement
  carrierAsset: HTMLElement
  veil: HTMLElement
}

export type PokegearFlyTransitionRequest = {
  carrier?: HTMLElement
  reducedMotion?: boolean
  captureScene: () => HTMLElement
  onStart?: () => void | Promise<void>
  teleport: () => void | Promise<void>
}

export type PokegearFlyTransitionResult =
  | { status: 'completed', teleported: true }
  | { status: 'cancelled', teleported: boolean }
  | { status: 'failed', teleported: boolean, error: unknown }

export type PokegearFlyTransitionController = {
  play: (request: PokegearFlyTransitionRequest) => Promise<PokegearFlyTransitionResult>
  cancel: () => void
  dispose: () => void
  getPhase: () => PokegearFlyTransitionPhase
  isActive: () => boolean
}

export type PokegearFlyTransitionOptions = {
  onPhaseChange?: (phase: PokegearFlyTransitionPhase) => void
}

const cancelledRun = Symbol('pokegear-fly-transition-cancelled')

/**
 * Possède l'intégralité de la présentation de Vol. Le monde ne change que
 * pendant la phase `teleport`, quand l'écran est totalement masqué.
 */
export function createPokegearFlyTransitionController(
  elements: PokegearFlyTransitionElements,
  options: PokegearFlyTransitionOptions = {},
): PokegearFlyTransitionController {
  let phase: PokegearFlyTransitionPhase = 'idle'
  let generation = 0
  let activeRun: number | undefined
  const animations = new Set<Animation>()

  const setPhase = (next: PokegearFlyTransitionPhase) => {
    phase = next
    if (next === 'idle') delete elements.root.dataset.phase
    else elements.root.dataset.phase = next
    options.onPhaseChange?.(next)
  }

  const resetPresentation = () => {
    for (const animation of animations) animation.cancel()
    animations.clear()
    elements.scene.replaceChildren()
    elements.carrierAsset.replaceChildren()
    elements.root.removeAttribute('style')
    elements.scene.removeAttribute('style')
    elements.carrier.removeAttribute('style')
    elements.carrierAsset.removeAttribute('style')
    elements.veil.removeAttribute('style')
    delete elements.root.dataset.phase
    elements.root.hidden = true
    elements.root.setAttribute('aria-hidden', 'true')
  }

  const finishPresentation = () => {
    setPhase('cleanup')
    resetPresentation()
    setPhase('idle')
  }

  const ensureCurrent = (run: number) => {
    if (activeRun !== run) throw cancelledRun
  }

  const animate = async (
    run: number,
    element: HTMLElement,
    keyframes: Keyframe[],
    frames: number,
    reducedMotion: boolean,
    easing = 'linear',
  ) => {
    ensureCurrent(run)
    if (reducedMotion || frames <= 0) return
    const animation = element.animate(keyframes, {
      duration: hgssVBlanksToMilliseconds(frames),
      easing,
      fill: 'both',
    })
    animations.add(animation)
    try {
      await animation.finished
    } catch {
      // Une animation Web peut être annulée par le navigateur pendant un
      // changement de layout. Le cycle métier continue tant que ce run reste
      // propriétaire de la présentation.
    }
    ensureCurrent(run)
  }

  const cancel = () => {
    if (activeRun === undefined) return
    generation += 1
    activeRun = undefined
    finishPresentation()
  }

  const play = async (request: PokegearFlyTransitionRequest): Promise<PokegearFlyTransitionResult> => {
    cancel()
    const run = ++generation
    activeRun = run
    let teleported = false
    const reducedMotion = request.reducedMotion === true

    try {
      resetPresentation()
      elements.root.hidden = false
      elements.root.setAttribute('aria-hidden', 'false')
      setPhase('starting')
      await request.onStart?.()
      ensureCurrent(run)
      elements.scene.replaceChildren(request.captureScene())
      if (request.carrier) elements.carrierAsset.replaceChildren(request.carrier)

      setPhase('departure')
      await Promise.all([
        animate(run, elements.scene, [
          { transform: 'scale(1)', filter: 'brightness(1)' },
          { transform: 'scale(1.08)', filter: 'brightness(1.35)' },
        ], pokegearFlyTransitionFrames.departure, reducedMotion, 'steps(10, end)'),
        animate(run, elements.carrier, [
          { transform: 'translate(-50%, 28vh) scale(.72)', opacity: 0 },
          { transform: 'translate(-50%, 8vh) scale(.88)', opacity: 1, offset: .22 },
          { transform: 'translate(-50%, -68vh) scale(1.16)', opacity: 1 },
        ], pokegearFlyTransitionFrames.departure, reducedMotion, 'cubic-bezier(.5,0,.65,1)'),
      ])

      setPhase('conceal')
      await animate(run, elements.veil, [
        { opacity: 0 },
        { opacity: 1 },
      ], pokegearFlyTransitionFrames.conceal, reducedMotion, 'steps(4, end)')

      setPhase('teleport')
      await request.teleport()
      teleported = true
      ensureCurrent(run)
      elements.scene.replaceChildren(request.captureScene())

      setPhase('arrival')
      await Promise.all([
        animate(run, elements.scene, [
          { transform: 'scale(1.08)', filter: 'brightness(1.3)' },
          { transform: 'scale(1)', filter: 'brightness(1)' },
        ], pokegearFlyTransitionFrames.arrival, reducedMotion, 'steps(10, end)'),
        animate(run, elements.veil, [
          { opacity: 1 },
          { opacity: 0 },
        ], pokegearFlyTransitionFrames.arrival, reducedMotion, 'steps(8, end)'),
        animate(run, elements.carrier, [
          { transform: 'translate(-50%, -68vh) scale(1.16)', opacity: 1 },
          { transform: 'translate(-50%, 5vh) scale(.88)', opacity: 1, offset: .7 },
          { transform: 'translate(-50%, 34vh) scale(.7)', opacity: 0 },
        ], pokegearFlyTransitionFrames.arrival, reducedMotion, 'cubic-bezier(.25,.75,.5,1)'),
      ])
      ensureCurrent(run)
      activeRun = undefined
      finishPresentation()
      return { status: 'completed', teleported: true }
    } catch (error) {
      if (error === cancelledRun || activeRun !== run) {
        return { status: 'cancelled', teleported }
      }
      activeRun = undefined
      finishPresentation()
      return { status: 'failed', teleported, error }
    }
  }

  resetPresentation()
  return {
    play,
    cancel,
    dispose: () => {
      if (activeRun !== undefined) cancel()
      else resetPresentation()
    },
    getPhase: () => phase,
    isActive: () => activeRun !== undefined,
  }
}
