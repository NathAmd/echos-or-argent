import * as THREE from 'three'
import { hgssVBlankDurationMs } from '../../game/world/hgssWorldAnimationClock'
import type { NitroTexturePreview } from '../../ndsTypes'
import { getSpriteAlphaAnchorY, getSpriteWorldDimensions } from './spriteAlphaAnchor'

/**
 * Le remaster conserve la pose immobile decodee de la ROM. Il ne fabrique ni
 * cellule ni interpolation de texture : seule une respiration sub-pixel est
 * appliquee au billboard, autour de son point d'ancrage au sol.
 */
export const hgssActorIdleCycleVBlanks = 120
export const hgssActorIdleBlendVBlanks = 12
export const hgssActorIdleVerticalStretch = 0.006
export const hgssActorIdleHorizontalCompression = 0.003

type ActorIdleEntry = {
  baseWidth: number
  baseHeight: number
  idleStartedAt: number
  idle: boolean
  phaseOffset: number
}

export type ActorIdleScale = { x: number, y: number }

function positiveModulo(value: number, divisor: number): number {
  return ((value % divisor) + divisor) % divisor
}

export function sampleHgssActorIdleScale(elapsedMs: number, phaseOffset = 0): ActorIdleScale {
  const cycleMs = hgssActorIdleCycleVBlanks * hgssVBlankDurationMs
  const phase = positiveModulo(elapsedMs / cycleMs + phaseOffset, 1)
  const blend = Math.min(1, Math.max(0, elapsedMs) / (hgssActorIdleBlendVBlanks * hgssVBlankDurationMs))
  // Le fondu garantit la pose ROM exacte a l'entree en idle, meme avec le
  // dephasage des PNJ. Les pieds ne passent jamais sous leur contact au sol.
  const breath = (1 - Math.cos(phase * Math.PI * 2)) / 2 * blend
  return {
    x: 1 - breath * hgssActorIdleHorizontalCompression,
    y: 1 + breath * hgssActorIdleVerticalStretch,
  }
}

/**
 * Registre commun aux joueurs, followers et PNJ. Les dimensions de base sont
 * remplacees a chaque vraie cellule ROM, ce qui evite toute derive cumulative.
 */
export class HgssActorIdlePresentation {
  private readonly actors = new WeakMap<THREE.Sprite, ActorIdleEntry>()
  private nextPhase = 0

  setBaseScale(sprite: THREE.Sprite, width: number, height: number, now = performance.now()): void {
    let entry = this.actors.get(sprite)
    if (!entry) {
      entry = {
        baseWidth: width,
        baseHeight: height,
        idleStartedAt: now,
        idle: false,
        // Les PNJ charges ensemble ne respirent pas tous en synchronisation.
        // Le decalage ne change aucune donnee ou pose provenant de la ROM.
        phaseOffset: positiveModulo(this.nextPhase++ * 0.3819660112501051, 1),
      }
      this.actors.set(sprite, entry)
    } else {
      entry.baseWidth = width
      entry.baseHeight = height
    }
    sprite.scale.set(width, height, 1)
  }

  setRomFrame(sprite: THREE.Sprite, texture: NitroTexturePreview, nativeActorHeight: number): void {
    const dimensions = getSpriteWorldDimensions(texture, nativeActorHeight)
    this.setBaseScale(sprite, dimensions.width, dimensions.height)
    sprite.center.set(0.5, getSpriteAlphaAnchorY(texture))
  }

  sync(sprite: THREE.Sprite, now: number, idle: boolean): boolean {
    const entry = this.actors.get(sprite)
    if (!entry) return false
    if (!idle) {
      const changed = entry.idle || sprite.scale.x !== entry.baseWidth || sprite.scale.y !== entry.baseHeight
      entry.idle = false
      sprite.scale.set(entry.baseWidth, entry.baseHeight, 1)
      return changed
    }
    if (!entry.idle) {
      entry.idle = true
      entry.idleStartedAt = now
    }
    const sampled = sampleHgssActorIdleScale(now - entry.idleStartedAt, entry.phaseOffset)
    const width = entry.baseWidth * sampled.x
    const height = entry.baseHeight * sampled.y
    const changed = sprite.scale.x !== width || sprite.scale.y !== height
    sprite.scale.set(width, height, 1)
    return changed
  }

  syncWorldActors(
    now: number,
    player: THREE.Sprite,
    playerIdle: boolean,
    follower: THREE.Sprite,
    followerIdle: boolean,
    actors: Iterable<{ id: number, sprite: THREE.Sprite }>,
    activeMotionIds: Pick<ReadonlySet<number>, 'has'>,
  ): boolean {
    let changed = this.sync(player, now, playerIdle)
    changed = this.sync(follower, now, followerIdle) || changed
    for (const actor of actors) changed = this.sync(actor.sprite, now, !activeMotionIds.has(actor.id)) || changed
    return changed
  }

  unregister(sprite: THREE.Sprite): void {
    this.actors.delete(sprite)
  }
}
