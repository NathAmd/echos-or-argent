import { hgssVBlankDurationMs } from '../time/hgssFrameTiming'

export {
  createHgssAnimationClock,
  createHgssVBlankClock,
  hgssMillisecondsToVBlanks,
  hgssVBlankDurationMs,
  hgssVBlankRate,
  hgssVBlanksToMilliseconds,
  hgssVBlanksToSeconds,
  sampleBoundedFixedSteps,
  sampleHgssVBlankFrame,
} from '../time/hgssFrameTiming'

/** Répartit toutes les cellules d'un acteur sur la durée complète de son pas. */
export function sampleHgssActorSpriteFrame(
  now: number,
  startedAt: number,
  frameCount: number,
  cycleDurationMs: number,
): number {
  const count = Math.max(1, Math.floor(frameCount))
  const frameDurationMs = Math.max(hgssVBlankDurationMs, cycleDurationMs / count)
  return Math.floor(Math.max(0, now - startedAt) / frameDurationMs) % count
}
