import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { hgssActorIdleCycleVBlanks, hgssActorIdleHorizontalCompression, hgssActorIdleVerticalStretch, HgssActorIdlePresentation, sampleHgssActorIdleScale } from './actorIdlePresentation'
import { hgssVBlankDurationMs } from '../../game/world/hgssWorldAnimationClock'

const texture = { id: 'actor', name: 'actor', width: 32, height: 32, pixels: new Uint8ClampedArray(32 * 32 * 4) }
texture.pixels[(31 * 32) * 4 + 3] = 255

describe('HGSS actor idle remaster presentation', () => {
  it('returns to the exact ROM pose at each cycle boundary', () => {
    const cycle = hgssActorIdleCycleVBlanks * hgssVBlankDurationMs
    expect(sampleHgssActorIdleScale(0)).toEqual({ x: 1, y: 1 })
    expect(sampleHgssActorIdleScale(cycle)).toEqual({ x: 1, y: 1 })
    expect(sampleHgssActorIdleScale(cycle / 2)).toEqual({
      x: 1 - hgssActorIdleHorizontalCompression,
      y: 1 + hgssActorIdleVerticalStretch,
    })
  })

  it('preserves the sprite ground anchor and position while breathing', () => {
    const sprite = new THREE.Sprite()
    sprite.center.set(0.5, 0.125)
    sprite.position.set(4, 2.08, 7)
    const presentation = new HgssActorIdlePresentation()
    presentation.setBaseScale(sprite, 1.55, 1.55, 100)
    const beforePosition = sprite.position.clone()
    const beforeCenter = sprite.center.clone()

    presentation.sync(sprite, 100, true)
    presentation.sync(sprite, 100 + hgssActorIdleCycleVBlanks * hgssVBlankDurationMs / 2, true)

    expect(sprite.position).toEqual(beforePosition)
    expect(sprite.center).toEqual(beforeCenter)
    expect(sprite.scale.x).toBeLessThan(1.55)
    expect(sprite.scale.y).toBeGreaterThan(1.55)
  })

  it('restores the latest decoded frame dimensions during movement without cumulative drift', () => {
    const sprite = new THREE.Sprite()
    const presentation = new HgssActorIdlePresentation()
    presentation.setBaseScale(sprite, 1.55, 1.55, 0)
    presentation.sync(sprite, 500, true)
    presentation.setBaseScale(sprite, 1.2, 1.8, 500)
    presentation.sync(sprite, 750, true)
    presentation.sync(sprite, 751, false)

    expect(sprite.scale.toArray()).toEqual([1.2, 1.8, 1])
  })

  it('enters a desynchronised NPC idle without jumping away from the ROM pose', () => {
    const presentation = new HgssActorIdlePresentation()
    const first = new THREE.Sprite()
    const second = new THREE.Sprite()
    presentation.setBaseScale(first, 1, 1, 0)
    presentation.setBaseScale(second, 2, 2, 0)

    presentation.sync(second, 500, true)

    expect(second.scale.toArray()).toEqual([2, 2, 1])
  })

  it('binds every decoded ROM frame to its alpha ground anchor and native scale', () => {
    const sprite = new THREE.Sprite()
    const presentation = new HgssActorIdlePresentation()
    presentation.setRomFrame(sprite, texture, 1.55)

    expect(sprite.scale.toArray()).toEqual([1.55, 1.55, 1])
    expect(sprite.center.toArray()).toEqual([0.5, 0])
  })

  it('updates player, follower, and every NPC through one allocation-free batch', () => {
    const presentation = new HgssActorIdlePresentation()
    const [player, follower, npc] = [new THREE.Sprite(), new THREE.Sprite(), new THREE.Sprite()]
    for (const sprite of [player, follower, npc]) presentation.setBaseScale(sprite, 1, 1, 0)
    const events = [{ id: 7, sprite: npc }]
    presentation.syncWorldActors(0, player, true, follower, false, events, new Set([7]))
    presentation.syncWorldActors(1_000, player, true, follower, false, events, new Set([7]))

    expect(player.scale.y).toBeGreaterThan(1)
    expect(follower.scale.toArray()).toEqual([1, 1, 1])
    expect(npc.scale.toArray()).toEqual([1, 1, 1])
  })
})
