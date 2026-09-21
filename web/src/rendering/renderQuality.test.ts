import { describe, expect, it } from 'vitest'
import { resolveGameRenderQualityProfile } from './renderQuality'

describe('game render quality', () => {
  it('uses the balanced profile by default', () => {
    expect(resolveGameRenderQualityProfile()).toEqual({
      antialias: true,
      pixelBudget: 3_200_000,
      shadowMapSize: 1024,
      shadows: true,
    })
  })

  it('can trade visual effects for fill-rate without changing game timing', () => {
    expect(resolveGameRenderQualityProfile('performance')).toEqual({
      antialias: false,
      pixelBudget: 1_800_000,
      shadowMapSize: 512,
      shadows: false,
    })
  })

  it('keeps the previous shadow resolution available in quality mode', () => {
    expect(resolveGameRenderQualityProfile('quality').shadowMapSize).toBe(2048)
  })
})