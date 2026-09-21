import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import { clearBattleCssAnimations } from './battleCssAnimation'

export type BattleEntryTransitionStyle =
  | 'wild-radial'
  | 'wild-diagonal'
  | 'water-wave'
  | 'cave-iris'
  | 'trainer-bars'
  | 'double-shutter'

export type BattleEntryTransitionRequest = Readonly<{
  kind: 'wild' | 'trainer' | 'double'
  terrain: 'field' | 'water' | 'cave'
  variantSeed?: number
}>

export type BattleEntryTransitionCallbacks = Readonly<{
  onCovered: () => void
  onComplete?: () => void
}>

export type BattleEntryTransitionControllerOptions = Readonly<{
  host: HTMLElement
  createOverlay: () => HTMLElement
  schedule: (callback: () => void, delayMs: number) => number
  clearSchedule: (handle: number) => void
  reducedMotion: () => boolean
}>

export type BattleEntryTransitionController = {
  play: (request: BattleEntryTransitionRequest, callbacks: BattleEntryTransitionCallbacks) => void
  cancel: () => void
  isActive: () => boolean
  dispose: () => void
}

export type BattleEntrySceneTransitionRequest = Readonly<{
  kind: BattleEntryTransitionRequest['kind']
  backgroundId: number
  variantSeed?: number
}>

export type BattleEntrySceneTransitionController = {
  play: (request: BattleEntrySceneTransitionRequest) => void
  cancel: () => void
  isActive: () => boolean
  dispose: () => void
}

export type BattleEntrySceneTransitionOptions = BattleEntryTransitionControllerOptions & Readonly<{
  screen: HTMLElement
}>

export const battleEntryCoverFrames = 16
export const battleEntryRevealFrames = 26

export function resolveBattleEntryTerrain(backgroundId: number): BattleEntryTransitionRequest['terrain'] {
  if (backgroundId === 1) return 'water'
  if (backgroundId >= 9 && backgroundId <= 11) return 'cave'
  return 'field'
}

export function resolveBattleEntryTransitionStyle(
  request: BattleEntryTransitionRequest,
): BattleEntryTransitionStyle {
  if (request.kind === 'double') return 'double-shutter'
  if (request.kind === 'trainer') return 'trainer-bars'
  if (request.terrain === 'water') return 'water-wave'
  if (request.terrain === 'cave') return 'cave-iris'
  return ((request.variantSeed ?? 0) & 1) === 0 ? 'wild-radial' : 'wild-diagonal'
}

/**
 * Possède le volet noir entre le monde et la scène de combat. Le monde reste
 * visible pendant la fermeture, `onCovered` échange les scènes sous un écran
 * totalement noir, puis la seconde moitié révèle le combat.
 */
export function createBattleEntryTransitionController(
  options: BattleEntryTransitionControllerOptions,
): BattleEntryTransitionController {
  const overlay = options.createOverlay()
  overlay.className = 'battle-entry-transition'
  overlay.hidden = true
  overlay.setAttribute('aria-hidden', 'true')
  options.host.append(overlay)
  let generation = 0
  let scheduledHandle: number | undefined

  const resetOverlay = (): void => {
    // Les pseudo-elements des volets trainer/double possèdent leurs propres
    // lecteurs CSS. Les annuler évite qu'un ancien reveal rempli (`both`) soit
    // réutilisé lors de la rencontre suivante.
    clearBattleCssAnimations(overlay)
    overlay.hidden = true
    delete overlay.dataset.phase
    delete overlay.dataset.transition
    overlay.style.removeProperty('--battle-entry-cover-duration')
    overlay.style.removeProperty('--battle-entry-reveal-duration')
  }

  const cancel = (): void => {
    generation += 1
    if (scheduledHandle !== undefined) options.clearSchedule(scheduledHandle)
    scheduledHandle = undefined
    resetOverlay()
  }

  const play = (
    request: BattleEntryTransitionRequest,
    callbacks: BattleEntryTransitionCallbacks,
  ): void => {
    cancel()
    const runGeneration = generation
    if (options.reducedMotion()) {
      callbacks.onCovered()
      if (generation === runGeneration) callbacks.onComplete?.()
      return
    }

    const coverDurationMs = hgssVBlanksToMilliseconds(battleEntryCoverFrames)
    const revealDurationMs = hgssVBlanksToMilliseconds(battleEntryRevealFrames)
    overlay.dataset.transition = resolveBattleEntryTransitionStyle(request)
    overlay.dataset.phase = 'covering'
    overlay.style.setProperty('--battle-entry-cover-duration', `${coverDurationMs}ms`)
    overlay.style.setProperty('--battle-entry-reveal-duration', `${revealDurationMs}ms`)
    overlay.hidden = false

    scheduledHandle = options.schedule(() => {
      if (generation !== runGeneration) return
      scheduledHandle = undefined
      overlay.dataset.phase = 'revealing'
      try {
        callbacks.onCovered()
      } catch (error) {
        cancel()
        throw error
      }
      if (generation !== runGeneration) return
      scheduledHandle = options.schedule(() => {
        if (generation !== runGeneration) return
        scheduledHandle = undefined
        resetOverlay()
        callbacks.onComplete?.()
      }, revealDurationMs)
    }, coverDurationMs)
  }

  return {
    play,
    cancel,
    isActive: () => !overlay.hidden,
    dispose() {
      cancel()
      overlay.remove()
    },
  }
}

/**
 * Adaptateur propriétaire du changement de scène. Le bootstrap ne manipule
 * plus lui-même la visibilité ou les datasets transitoires du combat.
 */
export function createBattleEntrySceneTransitionController(
  options: BattleEntrySceneTransitionOptions,
): BattleEntrySceneTransitionController {
  const controller = createBattleEntryTransitionController(options)
  const clearSceneOverlayState = (): void => { delete options.screen.dataset.entryOverlay }

  return {
    play({ kind, backgroundId, variantSeed }) {
      clearSceneOverlayState()
      const terrain = resolveBattleEntryTerrain(backgroundId)
      options.screen.dataset.terrain = terrain
      options.screen.hidden = true
      controller.play({ kind, terrain, variantSeed }, {
        onCovered: () => {
          options.screen.dataset.entryOverlay = 'active'
          options.screen.dataset.presentation = 'entering'
          options.screen.hidden = false
        },
        // Le rideau historique reste neutralisé jusqu'au passage effectif en
        // introduction ; sinon il redémarre entre la fin du volet et le timer
        // de lancement, ce qui produit un second flash noir.
        onComplete: () => {
          if (options.screen.dataset.presentation === 'entering') options.screen.dataset.entryOverlay = 'complete'
          else clearSceneOverlayState()
        },
      })
    },
    cancel() {
      controller.cancel()
      clearSceneOverlayState()
    },
    isActive: controller.isActive,
    dispose() {
      controller.dispose()
      clearSceneOverlayState()
    },
  }
}
