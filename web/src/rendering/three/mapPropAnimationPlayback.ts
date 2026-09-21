export type MapPropPlaybackTrack<TTarget, TFrame, TTransition> = {
  target: TTarget
  frames: readonly TFrame[]
  transition?: TTransition
}

export type MapPropPlaybackOptions = {
  startedAt: number
  durationMs: number
  frameDurationMs: number
  interpolate: boolean
}

export type MapPropPlaybackAdapter<TTarget, TFrame, TTransition> = {
  applyFrame: (target: TTarget, frame: TFrame) => void
  captureTransition: (target: TTarget) => TTransition
  applyTransition: (target: TTarget, transition: TTransition, frame: TFrame, progress: number) => void
  minimumDurationMs: number
}

type ActivePlayback<TTarget, TFrame, TTransition> = {
  tracks: Array<MapPropPlaybackTrack<TTarget, TFrame, TTransition>>
  options: MapPropPlaybackOptions
  resolve: () => void
}

/**
 * Lecteur commun des transitions et pistes discrètes MapProp. Il possède les
 * conflits de cible et la durée, mais ne connaît ni Three ni le format Nitro.
 */
export class MapPropAnimationPlayback<TTarget, TFrame, TTransition> {
  private readonly adapter: MapPropPlaybackAdapter<TTarget, TFrame, TTransition>
  private readonly active = new Set<ActivePlayback<TTarget, TFrame, TTransition>>()

  constructor(adapter: MapPropPlaybackAdapter<TTarget, TFrame, TTransition>) {
    this.adapter = adapter
  }

  play(
    tracks: readonly MapPropPlaybackTrack<TTarget, TFrame, TTransition>[],
    options: MapPropPlaybackOptions,
  ): Promise<void> {
    const completeTracks = tracks.filter((track) => track.frames.length > 0)
    if (completeTracks.length === 0) return Promise.resolve()
    this.releaseTargets(new Set(completeTracks.map(({ target }) => target)))
    const preparedTracks = completeTracks.map((track) => ({
      ...track,
      transition: options.interpolate ? this.adapter.captureTransition(track.target) : undefined,
    }))
    if (!options.interpolate) {
      for (const track of preparedTracks) this.adapter.applyFrame(track.target, track.frames[0]!)
    }
    return new Promise((resolve) => this.active.add({
      tracks: preparedTracks,
      options: {
        ...options,
        durationMs: Math.max(this.adapter.minimumDurationMs, options.durationMs),
        frameDurationMs: Math.max(Number.EPSILON, options.frameDurationMs),
      },
      resolve,
    }))
  }

  update(now: number): void {
    for (const playback of [...this.active]) {
      const { options } = playback
      const elapsed = Math.max(0, now - options.startedAt)
      const progress = Math.min(1, elapsed / options.durationMs)
      for (const track of playback.tracks) {
        if (options.interpolate && track.transition !== undefined) {
          this.adapter.applyTransition(track.target, track.transition, track.frames.at(-1)!, progress)
        } else {
          const frameIndex = Math.min(track.frames.length - 1, Math.floor(elapsed / options.frameDurationMs))
          this.adapter.applyFrame(track.target, track.frames[frameIndex]!)
        }
      }
      if (progress < 1) continue
      for (const track of playback.tracks) this.adapter.applyFrame(track.target, track.frames.at(-1)!)
      this.active.delete(playback)
      playback.resolve()
    }
  }

  releaseTargets(targets: ReadonlySet<TTarget>): void {
    for (const playback of [...this.active]) {
      if (!playback.tracks.some(({ target }) => targets.has(target))) continue
      this.active.delete(playback)
      playback.resolve()
    }
  }

  clear(): void {
    for (const playback of this.active) playback.resolve()
    this.active.clear()
  }
}
