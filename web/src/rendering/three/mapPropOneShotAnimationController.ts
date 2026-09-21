import { sampleHgssVBlankFrame } from '../../game/time/hgssFrameTiming'

export type MapPropOneShotAnimationDefinition<TTarget, TFrame> = {
  tag: number
  modelId: number
  targets: readonly TTarget[]
  tracks: readonly (readonly TFrame[])[]
  loopCount: number
  reversed: boolean
}

type LoadedMapPropOneShotAnimation<TTarget, TFrame> = MapPropOneShotAnimationDefinition<TTarget, TFrame> & {
  selectedTrack?: number
  startedAt: number
  finished: boolean
  waiters: Set<() => void>
}

export type MapPropOneShotAnimationSample = {
  frameIndex: number
  finished: boolean
}

/**
 * Reproduit l'avancement VBlank de MapPropAnimation_AdvanceFrame. Une piste
 * commence deja sur sa premiere pose ; le premier VBlank l'avance donc vers
 * la pose suivante. La derniere pose du dernier tour reste affichee.
 */
export function sampleMapPropOneShotAnimation(
  frameCount: number,
  loopCount: number,
  reversed: boolean,
  elapsedFrames: number,
): MapPropOneShotAnimationSample {
  const count = Math.max(1, Math.floor(frameCount))
  const loops = Math.max(1, Math.floor(loopCount))
  const elapsed = Math.max(0, Math.floor(elapsedFrames))
  const completedStep = count * loops
  const lastStep = completedStep - 1
  const step = Math.min(elapsed, lastStep)
  return {
    frameIndex: reversed ? count - 1 - (step % count) : step % count,
    finished: elapsed >= completedStep,
  }
}

/**
 * Gestionnaire global des animations MapProp chargees a la demande par les
 * scripts HGSS. Il conserve les tags natifs, les pistes en pause au chargement,
 * les boucles et le sens de lecture sans connaitre le type de rendu.
 */
export class MapPropOneShotAnimationController<TTarget, TFrame> {
  private readonly loaded = new Map<number, LoadedMapPropOneShotAnimation<TTarget, TFrame>>()

  load(definition: MapPropOneShotAnimationDefinition<TTarget, TFrame>): void {
    if (definition.tag === 0) throw new Error("Le tag ROM zero est invalide pour une animation MapProp.")
    if (this.loaded.has(definition.tag)) throw new Error(`L'animation MapProp ROM ${definition.tag} est deja chargee.`)
    if (definition.targets.length === 0) throw new Error(`L'animation MapProp ROM ${definition.tag} n'a aucune cible.`)
    if (definition.tracks.length === 0 || definition.tracks.some((track) => track.length === 0)) {
      throw new Error(`L'animation MapProp ROM ${definition.tag} ne contient aucune piste complete.`)
    }
    this.loaded.set(definition.tag, {
      ...definition,
      targets: [...definition.targets],
      tracks: definition.tracks.map((track) => [...track]),
      loopCount: Math.max(1, Math.floor(definition.loopCount)),
      startedAt: 0,
      finished: false,
      waiters: new Set(),
    })
  }

  play(tag: number, trackIndex: number, now = performance.now()): void {
    const animation = this.require(tag)
    if (!animation.tracks[trackIndex]) throw new Error(`La piste MapProp ROM ${tag}:${trackIndex} est absente.`)
    this.resolveWaiters(animation)
    animation.selectedTrack = trackIndex
    animation.startedAt = now
    animation.finished = false
  }

  wait(tag: number): Promise<void> {
    const animation = this.require(tag)
    if (animation.selectedTrack === undefined) throw new Error(`L'animation MapProp ROM ${tag} n'a pas ete lancee.`)
    if (animation.finished) return Promise.resolve()
    return new Promise((resolve) => animation.waiters.add(resolve))
  }

  unload(tag: number, reset: (target: TTarget) => void): void {
    const animation = this.require(tag)
    this.resolveWaiters(animation)
    for (const target of animation.targets) reset(target)
    this.loaded.delete(tag)
  }

  clear(reset: (target: TTarget) => void): void {
    for (const animation of this.loaded.values()) {
      this.resolveWaiters(animation)
      for (const target of animation.targets) reset(target)
    }
    this.loaded.clear()
  }

  update(now: number, apply: (target: TTarget, frame: TFrame) => void): void {
    for (const animation of this.loaded.values()) {
      if (animation.selectedTrack === undefined || animation.finished) continue
      const track = animation.tracks[animation.selectedTrack]!
      const elapsedFrames = sampleHgssVBlankFrame(now, animation.startedAt)
      const sample = sampleMapPropOneShotAnimation(track.length, animation.loopCount, animation.reversed, elapsedFrames)
      const frame = track[sample.frameIndex]!
      for (const target of animation.targets) apply(target, frame)
      if (!sample.finished) continue
      animation.finished = true
      this.resolveWaiters(animation)
    }
  }

  private require(tag: number): LoadedMapPropOneShotAnimation<TTarget, TFrame> {
    const animation = this.loaded.get(tag)
    if (!animation) throw new Error(`Le tag MapProp ROM ${tag} n'est pas charge.`)
    return animation
  }

  private resolveWaiters(animation: LoadedMapPropOneShotAnimation<TTarget, TFrame>): void {
    for (const resolve of animation.waiters) resolve()
    animation.waiters.clear()
  }
}
