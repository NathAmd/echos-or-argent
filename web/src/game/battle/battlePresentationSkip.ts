import { hgssVBlankDurationMs } from '../time/hgssFrameTiming'

export type BattlePresentationSkipRegistry = {
  register: (skip: () => void) => () => void
  request: () => boolean
  reset: () => void
  clear: () => void
}

export type BattlePresentationLease = {
  signal: AbortSignal
  waitFrames: (frames: number) => Promise<void>
  close: () => void
}

/**
 * Point unique d'accélération des présentations de combat. Chaque lecteur
 * conserve sa fin déterministe, mais un appui peut supprimer ses attentes.
 */
export function createBattlePresentationSkipRegistry(): BattlePresentationSkipRegistry {
  const handlers = new Set<() => void>()
  let requested = false
  return {
    register(skip) {
      handlers.add(skip)
      if (requested) skip()
      return () => handlers.delete(skip)
    },
    request() {
      requested = true
      const active = [...handlers]
      active.forEach((skip) => skip())
      return active.length > 0
    },
    reset() { requested = false },
    clear() {
      // Une nouvelle scène réutilise les mêmes nœuds DOM. Les lecteurs encore
      // inscrits doivent être réellement interrompus avant d'être oubliés.
      for (const skip of [...handlers]) skip()
      requested = false
      handlers.clear()
    },
  }
}

/** Un lease accélère aussi toutes les attentes créées après l'appui initial. */
export function createBattlePresentationLease(
  registry: BattlePresentationSkipRegistry,
  frameDuration = hgssVBlankDurationMs,
): BattlePresentationLease {
  const controller = new AbortController()
  const pending = new Set<() => void>()
  let closed = false
  const skip = (): void => {
    if (!controller.signal.aborted) controller.abort()
    for (const finish of [...pending]) finish()
  }
  const unregister = registry.register(skip)
  return {
    signal: controller.signal,
    waitFrames(frames) {
      if (closed || controller.signal.aborted || frames <= 0) return Promise.resolve()
      return new Promise<void>((resolve) => {
        const finish = () => {
          globalThis.clearTimeout(timer)
          pending.delete(finish)
          resolve()
        }
        const timer = globalThis.setTimeout(finish, Math.max(0, frames) * frameDuration)
        pending.add(finish)
      })
    },
    close() {
      if (closed) return
      closed = true
      unregister()
      for (const finish of [...pending]) finish()
    },
  }
}
