export type RomAudioPlaybackCompletion = {
  /** Résout à la vraie fin de toutes les sources, ou lors d'un arrêt explicite. */
  finished: Promise<void>
  markSourceEnded: () => void
  finish: () => void
}

/**
 * Agrège les événements `ended` Web Audio. Le délai monotone n'est qu'un
 * garde-fou pour les navigateurs qui suspendent AudioContext et n'émettent
 * alors plus les événements attendus.
 */
export function createRomAudioPlaybackCompletion(
  sourceCount: number,
  fallbackDelayMs: number,
  minimumDelayMs = 0,
): RomAudioPlaybackCompletion {
  let remainingSources = Math.max(0, Math.trunc(sourceCount))
  let settled = false
  let minimumElapsed = minimumDelayMs <= 0
  let resolveFinished!: () => void
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve })
  const fallbackTimer = globalThis.setTimeout(
    () => finish(),
    Math.max(0, Number.isFinite(fallbackDelayMs) ? fallbackDelayMs : 0),
  )
  const minimumTimer = minimumElapsed
    ? undefined
    : globalThis.setTimeout(() => {
        minimumElapsed = true
        finishIfComplete()
      }, Math.max(0, Number.isFinite(minimumDelayMs) ? minimumDelayMs : 0))
  const finish = (): void => {
    if (settled) return
    settled = true
    globalThis.clearTimeout(fallbackTimer)
    if (minimumTimer !== undefined) globalThis.clearTimeout(minimumTimer)
    resolveFinished()
  }
  const finishIfComplete = (): void => {
    if (remainingSources === 0 && minimumElapsed) finish()
  }
  const markSourceEnded = (): void => {
    if (settled || remainingSources === 0) return
    remainingSources -= 1
    finishIfComplete()
  }
  if (remainingSources === 0) queueMicrotask(finishIfComplete)
  return { finished, markSourceEnded, finish }
}
