export type RomAudioExclusiveChannel<T> = {
  /** Remplace la lecture courante et n'installe que la derniere demande. */
  replace: (start: () => Promise<T>) => Promise<T | undefined>
  /** Invalide aussi une lecture encore en cours d'initialisation. */
  stop: () => void
  peek: () => T | undefined
  releaseIfCurrent: (playback: T) => boolean
}

/**
 * Arbitre un canal Web Audio exclusif (musique, fanfare ou cri).
 *
 * `AudioContext.resume()` rend le demarrage asynchrone : sans revision, une
 * ancienne demande peut terminer apres sa remplacante et reprendre le canal.
 * Le proprietaire perdant est toujours libere, y compris apres un `stop()`.
 */
export function createRomAudioExclusiveChannel<T>(
  release: (playback: T) => void,
): RomAudioExclusiveChannel<T> {
  let revision = 0
  let current: T | undefined

  const releaseCurrent = (): void => {
    if (current === undefined) return
    const playback = current
    current = undefined
    release(playback)
  }

  return {
    async replace(start): Promise<T | undefined> {
      const requestRevision = ++revision
      releaseCurrent()
      let playback: T
      try {
        playback = await start()
      } catch (error) {
        // Une erreur provenant d'une demande deja remplacee ne doit pas faire
        // echouer le nouveau flux qui possede maintenant le canal.
        if (requestRevision !== revision) return undefined
        throw error
      }
      if (requestRevision !== revision) {
        release(playback)
        return undefined
      }
      current = playback
      return playback
    },
    stop(): void {
      revision += 1
      releaseCurrent()
    },
    peek: () => current,
    releaseIfCurrent(playback): boolean {
      if (current !== playback) return false
      current = undefined
      release(playback)
      return true
    },
  }
}
