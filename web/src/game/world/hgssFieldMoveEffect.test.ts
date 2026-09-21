import { describe, expect, it } from 'vitest'
import {
  hgssFieldMoveEffectAnimationFrames,
  hgssFieldMoveEffectCompletionFrames,
  resolveHgssFieldMoveDirectionOffset,
  resolveHgssFieldMoveEffectProfile,
  sampleHgssFieldMoveEffect,
} from './hgssFieldMoveEffect'

describe('effets natifs des capacités terrain HGSS', () => {
  it('conserve les six dispatchs, ressources et sons de ScrCmd_560', () => {
    expect(Array.from({ length: 6 }, (_, mode) => resolveHgssFieldMoveEffectProfile(mode))).toEqual([
      expect.objectContaining({ kind: 'cut', target: 'player', modelMember: 3, animationMembers: [0, 1, 2], soundSequenceId: 1610 }),
      expect.objectContaining({ kind: 'rockSmash', target: 'player', modelMember: 8, animationMembers: [4, 5, 6, 7], soundSequenceId: 1609 }),
      expect.objectContaining({ kind: 'rockSmash', target: 'follower', modelMember: 8, animationMembers: [4, 5, 6, 7], soundSequenceId: 1609 }),
      expect.objectContaining({ kind: 'cut', target: 'follower', modelMember: 3, animationMembers: [0, 1, 2], soundSequenceId: 1610 }),
      expect.objectContaining({ kind: 'headbutt', target: 'player', modelMember: 19, animationMembers: [17, 18], soundSequenceId: 2302 }),
      expect.objectContaining({ kind: 'headbutt', target: 'follower', modelMember: 19, animationMembers: [17, 18], soundSequenceId: 2302 }),
    ])
    expect(resolveHgssFieldMoveEffectProfile(0).archivePath).toBe('/a/1/3/4')
    expect(() => resolveHgssFieldMoveEffectProfile(6)).toThrow('Effet terrain HGSS 6 invalide')
  })

  it('place l’effet une case devant son acteur dans les quatre directions', () => {
    expect(resolveHgssFieldMoveDirectionOffset('north', 16)).toEqual({ x: 0, z: -16 })
    expect(resolveHgssFieldMoveDirectionOffset('south', 16)).toEqual({ x: 0, z: 16 })
    expect(resolveHgssFieldMoveDirectionOffset('west', 1)).toEqual({ x: -1, z: 0 })
    expect(resolveHgssFieldMoveDirectionOffset('east', 1)).toEqual({ x: 1, z: 0 })
  })

  it('garde 45 frames visuelles, deux passes superviseur et les pulses Headbutt exacts', () => {
    expect(hgssFieldMoveEffectAnimationFrames).toBe(45)
    expect(hgssFieldMoveEffectCompletionFrames).toBe(47)
    expect(Array.from({ length: 48 }, (_, frame) => sampleHgssFieldMoveEffect(4, frame).cameraPulse)
      .flatMap((active, frame) => active ? [frame] : [])).toEqual([1, 2, 5, 6])
    expect(sampleHgssFieldMoveEffect(0, 44)).toMatchObject({ animationFrame: 44, visible: true, complete: false })
    expect(sampleHgssFieldMoveEffect(0, 45)).toMatchObject({ animationFrame: 44, visible: false, complete: false })
    expect(sampleHgssFieldMoveEffect(0, 46)).toMatchObject({ visible: false, complete: false })
    expect(sampleHgssFieldMoveEffect(0, 47)).toMatchObject({ visible: false, complete: true })
    expect(sampleHgssFieldMoveEffect(0, 1).cameraPulse).toBe(false)
  })
})
