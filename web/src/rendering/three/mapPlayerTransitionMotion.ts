import * as THREE from 'three'
import {
  PlayerTransitionMotionController,
  scalePlayerTransitionOffset,
  type PlayerTransitionMotion,
} from './playerTransitionMotion'

/** Lie le sampler HGSS au sprite sans jamais toucher aux coordonnées du monde. */
export class MapPlayerTransitionMotion {
  private readonly controller = new PlayerTransitionMotionController()
  private readonly sprite: THREE.Sprite
  private readonly now: () => number
  private readonly canPlay: () => boolean
  private readonly hasConflictingMotion: () => boolean
  private readonly usesWorldCoordinates: () => boolean
  private basePosition: THREE.Vector3 | undefined

  constructor(
    sprite: THREE.Sprite,
    now: () => number,
    canPlay: () => boolean,
    hasConflictingMotion: () => boolean,
    usesWorldCoordinates: () => boolean,
  ) {
    this.sprite = sprite
    this.now = now
    this.canPlay = canPlay
    this.hasConflictingMotion = hasConflictingMotion
    this.usesWorldCoordinates = usesWorldCoordinates
  }

  get isActive(): boolean { return this.controller.isActive }

  play(motion: PlayerTransitionMotion): Promise<void> {
    this.clear()
    if (!this.canPlay()) return Promise.resolve()
    if (this.hasConflictingMotion()) return Promise.reject(new Error('Une motion de transition joueur ne peut pas concurrencer un deplacement actif.'))
    this.basePosition = this.sprite.position.clone()
    return this.controller.play(motion, this.now())
  }

  update(now: number, frameDurationMs: number): void {
    const sample = this.controller.update(now, frameDurationMs)
    if (!sample || !this.basePosition) return
    this.sprite.position.copy(this.basePosition)
    this.sprite.position.y += scalePlayerTransitionOffset(sample.offsetYTiles, this.usesWorldCoordinates())
    if (!this.controller.isActive) this.basePosition = undefined
  }

  clear(): void {
    this.controller.cancel()
    if (this.basePosition) this.sprite.position.copy(this.basePosition)
    this.basePosition = undefined
  }
}
