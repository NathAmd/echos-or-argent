import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { getFieldMoveAvailability, getForcedSlideDirection, getLedgeDirection, getMetatileBehavior, getPlayerAvatarSpriteId, getPlayerMovementDurationFrames, isIceMetatile, isLadderMetatile, isSurfableMetatile, isWaterfallMetatile, isWhirlpoolMetatile } from './hgssPlayerMovement'

describe('HGSS player movement constants', () => {
  it('decodes the native low-byte metatile behaviors', () => {
    expect(getMetatileBehavior(0x8010)).toBe(16)
    expect(isSurfableMetatile(0x8010)).toBe(true)
    expect(isWaterfallMetatile(0x8013)).toBe(true)
    expect(isWhirlpoolMetatile(0x8011)).toBe(true)
    expect(getLedgeDirection(56)).toBe('east')
    expect(getLedgeDirection(59)).toBe('south')
    expect(getForcedSlideDirection(66)).toBe('north')
    expect(isIceMetatile(32)).toBe(true)
    expect(isLadderMetatile(62)).toBe(true)
  })

  it('keeps native avatar graphics and movement timings distinct', () => {
    expect(getPlayerAvatarSpriteId('male', 'cycling')).toBe(21)
    expect(getPlayerAvatarSpriteId('female', 'surfing')).toBe(179)
    expect(getPlayerMovementDurationFrames('walk')).toBe(8)
    expect(getPlayerMovementDurationFrames('run')).toBe(4)
    expect(getPlayerMovementDurationFrames('ledge-jump')).toBe(16)
  })

  it('requires both the native badge flag and a valid Cascade user', () => {
    const waterfallUser = {
      isEgg: false,
      currentHp: 1,
      moves: [{ moveId: 127 }],
    } as CanonicalPokemon

    expect(getFieldMoveAvailability('waterfall', new Set(), [waterfallUser])).toEqual({ available: false, reason: 'badge' })
    expect(getFieldMoveAvailability('waterfall', new Set([7]), [])).toEqual({ available: false, reason: 'party' })
    expect(getFieldMoveAvailability('waterfall', new Set([7]), [waterfallUser])).toEqual({ available: true, partySlot: 0 })
  })
})
