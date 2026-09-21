import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleThrowSpriteAsset } from '../../rom/battle/battleThrowSprites'
import { createNitroCellSprite, resolveNitroCellSpriteTimeline } from '../ui/nitroCellSpritePresentation'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'

const nativeBattleWidth = 256
const nativeBattleHeight = 192

export type HgssBattleThrowTiming = {
  impactFrame: number
  completionFrame: number
}

/**
 * `ManagedSprite_GetAnimationFrame` expose le compteur de frame de la
 * séquence (pas son index de cellule) : le script joue le son à 3, observe 4,
 * puis conserve l'OBJ huit VBlank avant de le libérer.
 */
export function resolveHgssBattleThrowTiming(asset: HgssBattleThrowSpriteAsset): HgssBattleThrowTiming {
  if (!resolveNitroCellSpriteTimeline(asset, asset.sequenceIndex)) {
    throw new Error(`La timeline du projectile Safari HGSS ${asset.kind} est absente.`)
  }
  return { impactFrame: 3, completionFrame: 12 }
}

export async function playHgssBattleThrowSprite(options: {
  stage: HTMLElement
  asset: HgssBattleThrowSpriteAsset
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  playImpactSound?: () => void | Promise<void>
  reducedMotion?: boolean
  signal?: AbortSignal
}): Promise<void> {
  const { stage, asset } = options
  const timeline = resolveNitroCellSpriteTimeline(asset, asset.sequenceIndex)
  if (!timeline) throw new Error(`La timeline du projectile Safari HGSS ${asset.kind} est absente.`)
  const projectile = createNitroCellSprite(asset, asset.sequenceIndex, options.createGraphic, 'battle-throw-projectile')
  projectile.dataset.throwKind = asset.kind
  Object.assign(projectile.style, {
    position: 'absolute',
    zIndex: '10',
    left: `${(asset.nativeOrigin[0] + timeline.originX) * 100 / nativeBattleWidth}%`,
    top: `${(asset.nativeOrigin[1] + timeline.originY) * 100 / nativeBattleHeight}%`,
    width: `${timeline.width * 100 / nativeBattleWidth}%`,
    height: `${timeline.height * 100 / nativeBattleHeight}%`,
    pointerEvents: 'none',
    overflow: 'visible',
  })
  stage.append(projectile)
  const timing = resolveHgssBattleThrowTiming(asset)
  const reducedMotion = options.reducedMotion
    ?? (typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches)
  const waitFrames = (frames: number): Promise<void> => {
    if (options.signal?.aborted) return Promise.reject(new DOMException('Lancer remplacé.', 'AbortError'))
    if (reducedMotion || frames <= 0) return Promise.resolve()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { options.signal?.removeEventListener('abort', abort); resolve() }, hgssVBlanksToMilliseconds(frames))
      const abort = () => { clearTimeout(timer); reject(new DOMException('Lancer remplacé.', 'AbortError')) }
      options.signal?.addEventListener('abort', abort, { once: true })
    })
  }
  const waitForAbortable = <T>(promise: Promise<T>): Promise<T> => {
    const signal = options.signal
    if (!signal) return promise
    if (signal.aborted) return Promise.reject(new DOMException('Lancer remplacé.', 'AbortError'))
    return new Promise((resolve, reject) => {
      const abort = () => reject(new DOMException('Lancer remplacé.', 'AbortError'))
      signal.addEventListener('abort', abort, { once: true })
      void promise.then(
        (value) => { signal.removeEventListener('abort', abort); resolve(value) },
        (error) => { signal.removeEventListener('abort', abort); reject(error) },
      )
    })
  }
  try {
    await waitFrames(timing.impactFrame)
    await waitForAbortable(Promise.resolve().then(() => options.signal?.aborted ? undefined : options.playImpactSound?.()))
    await waitFrames(timing.completionFrame - timing.impactFrame)
  } finally {
    projectile.remove()
  }
}
