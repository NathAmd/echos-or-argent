import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'

export const hgssFieldPoisonEffectSoundId = 1551
export const hgssFieldPoisonEffectFrames = 6

export const hgssFieldPoisonKeyframes: readonly Keyframe[] = [
  { transform: 'translateX(0)' },
  { transform: 'translateX(-1px)' },
  { transform: 'translateX(2px)' },
  { transform: 'translateX(-3px)' },
  { transform: 'translateX(2px)' },
  { transform: 'translateX(-1px)' },
  { transform: 'translateX(0)' },
]

/** Reproduit les six phases d'offset horizontal de FieldSystem_DoPoisonEffect. */
export function playHgssFieldPoisonPresentation(
  surfaces: readonly HTMLElement[],
  playSoundEffect: (sequenceId: number) => void,
): Promise<void> {
  playSoundEffect(hgssFieldPoisonEffectSoundId)
  const options: KeyframeAnimationOptions = {
    duration: hgssVBlanksToMilliseconds(hgssFieldPoisonEffectFrames),
    easing: `steps(${hgssFieldPoisonEffectFrames}, end)`,
  }
  const animations = surfaces.map((surface) => surface.animate([...hgssFieldPoisonKeyframes], options))
  return Promise.allSettled(animations.map(({ finished }) => finished)).then(() => undefined)
}
