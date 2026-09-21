import { describe, expect, it } from 'vitest'
import type { RomInventory } from './ndsTypes'
import { createTitleAnimationState } from './titleAnimation'

describe('title animation ROM requirements', () => {
  it('rejects an absent animation instead of inventing a frame count', () => {
    expect(() => createTitleAnimationState({} as RomInventory, 0)).toThrow('animation ROM du Pokemon legendaire')
  })
})