/** Fréquence logique commune aux compteurs natifs HGSS. */
export const hgssVBlankRate = 60
export const hgssVBlankDurationMs = 1000 / hgssVBlankRate

export type HgssVBlankClock = {
  sample: (nowMs: number) => number
  resynchronize: (nowMs: number) => void
}

export type HgssAnimationClock = {
  sample: (nowMs: number) => number
  pause: (nowMs: number) => void
  resume: (nowMs: number) => void
  resynchronize: (nowMs: number) => void
}

type MonotonicTimestampSample = {
  elapsedMs: number
  timestampMs: number | undefined
}

/**
 * Ignore un echantillon ancien sans reculer l'ancre temporelle. La boucle de
 * jeu transmet le timestamp pris au debut de la frame, tandis que certains
 * setters peuvent avoir deja echantillonne `performance.now()` plus tard dans
 * cette meme frame. Rebaser l'ancre sur l'ancien timestamp recompterait alors
 * ce delta au prochain rendu et accelererait toutes les animations partagees.
 */
function sampleMonotonicTimestamp(previousMs: number | undefined, nowMs: number): MonotonicTimestampSample {
  if (!Number.isFinite(nowMs)) return { elapsedMs: 0, timestampMs: previousMs }
  if (previousMs === undefined) return { elapsedMs: 0, timestampMs: nowMs }
  if (nowMs <= previousMs) return { elapsedMs: 0, timestampMs: previousMs }
  return { elapsedMs: nowMs - previousMs, timestampMs: nowMs }
}

/**
 * Convertit une durée ROM exprimée en VBlank. Les animations Nitro décodées
 * (BCA/BTA/BMA/BTP, NANR et fldtanime) utilisent toutes cette unité native.
 */
export function hgssVBlanksToMilliseconds(vblanks: number): number {
  return Math.max(0, vblanks) * hgssVBlankDurationMs
}

export function hgssVBlanksToSeconds(vblanks: number): number {
  return Math.max(0, vblanks) / hgssVBlankRate
}

export function hgssMillisecondsToVBlanks(milliseconds: number): number {
  return Math.max(0, milliseconds) / hgssVBlankDurationMs
}

export function sampleHgssVBlankFrame(nowMs: number, startedAtMs: number): number {
  return Math.floor(hgssMillisecondsToVBlanks(nowMs - startedAtMs) + 1e-9)
}

export type BoundedFixedStepSample = {
  steps: number
  remainderMs: number
}

/**
 * Avance un simulateur à pas fixe sans rejouer une longue dette entre deux
 * peintures. Le reliquat sub-frame est conservé; les pas excédentaires sont
 * abandonnés pour éviter une rafale visuelle après un gel du navigateur.
 */
export function sampleBoundedFixedSteps(
  accumulatedMs: number,
  elapsedMs: number,
  stepDurationMs: number,
  maximumSteps: number,
): BoundedFixedStepSample {
  const duration = Math.max(Number.EPSILON, stepDurationMs)
  const maximum = Math.max(0, Math.floor(maximumSteps))
  const total = Math.max(0, accumulatedMs) + Math.max(0, elapsedMs)
  const availableSteps = Math.floor(total / duration + 1e-9)
  const steps = Math.min(maximum, availableSteps)
  const remaining = total - steps * duration
  return {
    steps,
    remainderMs: availableSteps > maximum ? remaining % duration : remaining,
  }
}

/** Horloge VBlank stable, indépendante du taux de rafraîchissement de l'écran. */
export function createHgssVBlankClock(initialCounter = 0): HgssVBlankClock {
  let counter = initialCounter >>> 0
  let previousNow: number | undefined
  let remainderMs = 0
  return {
    sample(nowMs) {
      const sample = sampleMonotonicTimestamp(previousNow, nowMs)
      previousNow = sample.timestampMs
      remainderMs += sample.elapsedMs
      const elapsedVBlanks = Math.floor(remainderMs / hgssVBlankDurationMs + 1e-9)
      if (elapsedVBlanks > 0) {
        counter = (counter + elapsedVBlanks) >>> 0
        remainderMs -= elapsedVBlanks * hgssVBlankDurationMs
      }
      return counter
    },
    resynchronize(nowMs) {
      previousNow = Number.isFinite(nowMs) ? nowMs : undefined
      remainderMs = 0
    },
  }
}

/**
 * Temps monotone d'animation qui ignore les périodes où le rendu est suspendu.
 * Sa valeur ne dépend pas de `requestAnimationFrame`; seuls les deltas réels
 * échantillonnés sont accumulés.
 */
export function createHgssAnimationClock(initialTimeMs = 0): HgssAnimationClock {
  let animationTimeMs = Math.max(0, initialTimeMs)
  let previousNow: number | undefined
  let paused = false
  const advanceTo = (nowMs: number): void => {
    const sample = sampleMonotonicTimestamp(previousNow, nowMs)
    if (!paused) animationTimeMs += sample.elapsedMs
    previousNow = sample.timestampMs
  }
  return {
    sample(nowMs) {
      advanceTo(nowMs)
      return animationTimeMs
    },
    pause(nowMs) {
      advanceTo(nowMs)
      paused = true
    },
    resume(nowMs) {
      previousNow = Number.isFinite(nowMs) ? nowMs : undefined
      paused = false
    },
    resynchronize(nowMs) {
      previousNow = Number.isFinite(nowMs) ? nowMs : undefined
    },
  }
}
