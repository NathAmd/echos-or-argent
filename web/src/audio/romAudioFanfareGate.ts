export type RomAudioFanfareGatePhase = 'idle' | 'starting' | 'playing' | 'grace'

export type RomAudioFanfareGateSession = {
  isCurrent: () => boolean
  markPlaying: () => boolean
  /** Conserve le gate BGM durant le delai natif, puis libere la lecture. */
  beginGrace: (releasePlayback: () => void) => boolean
  fail: () => void
}

export type RomAudioFanfareGate = {
  begin: () => RomAudioFanfareGateSession
  stop: () => void
  isPlaying: () => boolean
  getPhase: () => RomAudioFanfareGatePhase
}

type RomAudioFanfareGateOptions = {
  graceMilliseconds: number
  setMusicMuted: (muted: boolean) => void
  now?: () => number
}

/**
 * Possede le gate musical pendant tout le cycle d'une fanfare HGSS.
 *
 * Une session remplacee ne peut jamais demuter la suivante. La grace reste
 * observable par WaitFanfare, puis la BGM reprend seulement apres liberation
 * de la lecture native.
 */
export function createRomAudioFanfareGate(options: RomAudioFanfareGateOptions): RomAudioFanfareGate {
  const now = options.now ?? (() => performance.now())
  const graceMilliseconds = Math.max(0, options.graceMilliseconds)
  let revision = 0
  let phase: RomAudioFanfareGatePhase = 'idle'
  let graceDeadline = 0
  let graceTimer: ReturnType<typeof globalThis.setTimeout> | undefined
  let releaseGracePlayback: (() => void) | undefined

  const clearGrace = (): void => {
    if (graceTimer !== undefined) globalThis.clearTimeout(graceTimer)
    graceTimer = undefined
    graceDeadline = 0
    releaseGracePlayback = undefined
  }

  const finishGrace = (sessionRevision: number): void => {
    if (sessionRevision !== revision || phase !== 'grace') return
    if (graceTimer !== undefined) globalThis.clearTimeout(graceTimer)
    graceTimer = undefined
    graceDeadline = 0
    const release = releaseGracePlayback
    releaseGracePlayback = undefined
    phase = 'idle'
    release?.()
    options.setMusicMuted(false)
  }

  const stop = (): void => {
    revision += 1
    clearGrace()
    phase = 'idle'
    options.setMusicMuted(false)
  }

  return {
    begin() {
      const sessionRevision = ++revision
      clearGrace()
      phase = 'starting'
      options.setMusicMuted(true)
      const isCurrent = (): boolean => sessionRevision === revision
      return {
        isCurrent,
        markPlaying(): boolean {
          if (!isCurrent()) return false
          phase = 'playing'
          return true
        },
        beginGrace(releasePlayback): boolean {
          if (!isCurrent() || phase === 'idle') return false
          if (phase === 'grace') return true
          phase = 'grace'
          releaseGracePlayback = releasePlayback
          graceDeadline = now() + graceMilliseconds
          graceTimer = globalThis.setTimeout(
            () => finishGrace(sessionRevision),
            graceMilliseconds,
          )
          return true
        },
        fail(): void {
          if (!isCurrent()) return
          clearGrace()
          phase = 'idle'
          options.setMusicMuted(false)
        },
      }
    },
    stop,
    isPlaying(): boolean {
      if (phase === 'grace' && now() >= graceDeadline) finishGrace(revision)
      return phase !== 'idle'
    },
    getPhase: () => phase,
  }
}
