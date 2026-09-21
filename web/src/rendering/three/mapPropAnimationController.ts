import type { HgssFieldVisualTime } from '../../game/time/hgssRtc'
import { sampleHgssVBlankFrame } from '../../game/time/hgssFrameTiming'
import type { NitroModelPreview } from '../../ndsTypes'
import { resolveMapPropAnimationLoadMode, type MapPropAnimationMetadata } from '../../rom/model/mapPropAnimationMetadata'
import { composeNitroModelAnimationFrames } from '../../rom/model/nitroModelFrameComposition'

type AnimationSource<T extends object> = {
  base: NitroModelPreview
  tracks: readonly (readonly NitroModelPreview[])[]
  mode: 'automatic' | 'deferred-attachment' | 'time-of-day'
  bicycleSlope: boolean
  targets: Set<T>
  deferredTrackIndexes: Map<T, readonly number[]>
  startedAt: number
  frames: Map<string, NitroModelPreview>
  lastFrameKey: Map<T, string>
}

function sameTracks(
  left: readonly (readonly NitroModelPreview[])[],
  right: readonly (readonly NitroModelPreview[])[],
): boolean {
  return left.length === right.length && left.every((track, index) => track === right[index])
}

/**
 * Partage et synchronise les animations automatiques de MapProps comme le
 * gestionnaire de terrain HGSS. Les animations chargees mais non attachees
 * restent synchronisees sur la meme horloge, puis sont reliees aux objets par
 * les commandes de scenario qui les selectionnent.
 */
export class MapPropAnimationController<T extends object> {
  private readonly sources: AnimationSource<T>[] = []
  private readonly sourceByTarget = new Map<T, AnimationSource<T>>()
  private visualTime: HgssFieldVisualTime = 0

  register(
    target: T,
    base: NitroModelPreview,
    metadata: MapPropAnimationMetadata,
    tracks: readonly (readonly NitroModelPreview[])[],
    now = performance.now(),
  ): boolean {
    this.unregister(target)
    const mode = resolveMapPropAnimationLoadMode(metadata)
    if ((mode !== 'automatic' && mode !== 'deferred-attachment' && mode !== 'time-of-day') || tracks.some((track) => track.length === 0)) return false
    if (tracks.length !== metadata.animationArchiveIds.length || (mode === 'time-of-day' && tracks.length < 4)) return false
    let source = this.sources.find((candidate) => candidate.base === base
      && candidate.mode === mode
      && candidate.bicycleSlope === metadata.isBicycleSlope
      && sameTracks(candidate.tracks, tracks))
    if (!source) {
      source = {
        base,
        tracks,
        mode,
        bicycleSlope: metadata.isBicycleSlope,
        targets: new Set(),
        deferredTrackIndexes: new Map(),
        startedAt: now,
        frames: new Map(),
        lastFrameKey: new Map(),
      }
      this.sources.push(source)
    }
    source.targets.add(target)
    if (mode === 'deferred-attachment') source.deferredTrackIndexes.set(target, [])
    source.lastFrameKey.delete(target)
    this.sourceByTarget.set(target, source)
    return true
  }

  setDeferredTracks(target: T, indexes: readonly number[]): boolean {
    const source = this.sourceByTarget.get(target)
    if (!source || source.mode !== 'deferred-attachment') return false
    const uniqueIndexes = [...new Set(indexes)]
    if (uniqueIndexes.some((index) => !Number.isInteger(index) || index < 0 || index >= source.tracks.length)) return false
    source.deferredTrackIndexes.set(target, uniqueIndexes)
    source.lastFrameKey.delete(target)
    return true
  }

  unregister(target: T): void {
    const source = this.sourceByTarget.get(target)
    if (!source) return
    this.sourceByTarget.delete(target)
    source.targets.delete(target)
    source.deferredTrackIndexes.delete(target)
    source.lastFrameKey.delete(target)
    if (source.targets.size > 0) return
    const index = this.sources.indexOf(source)
    if (index >= 0) this.sources.splice(index, 1)
  }

  clear(): void {
    this.sources.length = 0
    this.sourceByTarget.clear()
  }

  setVisualTime(visualTime: HgssFieldVisualTime): void {
    if (visualTime === this.visualTime) return
    this.visualTime = visualTime
    for (const source of this.sources) if (source.mode === 'time-of-day') source.lastFrameKey.clear()
  }

  update(now: number, applyFrame: (target: T, frame: NitroModelPreview) => void): void {
    for (const source of this.sources) {
      const elapsedFrame = source.bicycleSlope ? 0 : sampleHgssVBlankFrame(now, source.startedAt)
      for (const target of source.targets) {
        const trackIndexes = source.mode === 'time-of-day'
          ? [this.visualTime]
          : source.mode === 'deferred-attachment'
            ? source.deferredTrackIndexes.get(target) ?? []
            : source.tracks.map((_, index) => index)
        if (trackIndexes.length === 0) continue
        const selectedTracks = trackIndexes.map((index) => source.tracks[index]!)
        const frameIndexes = selectedTracks.map((track) => elapsedFrame % track.length)
        const key = `${trackIndexes.join(',')}:${frameIndexes.join(',')}`
        if (source.lastFrameKey.get(target) === key) continue
        let frame = source.frames.get(key)
        if (!frame) {
          frame = selectedTracks.length === 1
            ? selectedTracks[0]![frameIndexes[0]!]!
            : composeNitroModelAnimationFrames(source.base, selectedTracks.map((track, index) => [track[frameIndexes[index]!]!]))[0]
          if (!frame) continue
          source.frames.set(key, frame)
        }
        applyFrame(target, frame)
        source.lastFrameKey.set(target, key)
      }
    }
  }
}

export function releaseConflictingMapPropAnimations<T, TAnimation extends { resolve: () => void }>(
  active: Set<TAnimation>,
  nextTargets: ReadonlySet<T>,
  targetsOf: (animation: TAnimation) => Iterable<T>,
): void {
  for (const animation of [...active]) {
    if (![...targetsOf(animation)].some((target) => nextTargets.has(target))) continue
    active.delete(animation)
    animation.resolve()
  }
}
