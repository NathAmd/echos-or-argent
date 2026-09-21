import { describe, expect, it } from 'vitest'
import { resolveGameRenderPixelRatio } from './renderResolution'

describe('game render resolution', () => {
  it('keeps native density on ordinary 1x displays', () => {
    expect(resolveGameRenderPixelRatio(1280, 720, 1)).toBe(1)
  })

  it('caps small Retina displays at 2x', () => {
    expect(resolveGameRenderPixelRatio(390, 844, 3)).toBe(2)
  })

  it('honours the shared pixel budget on large Retina displays', () => {
    const ratio = resolveGameRenderPixelRatio(1440, 900, 2)
    expect(ratio).toBeCloseTo(Math.sqrt(3_200_000 / (1440 * 900)))
    expect(1440 * 900 * ratio * ratio).toBeCloseTo(3_200_000)
  })

  it('retains a readable floor on very large canvases', () => {
    expect(resolveGameRenderPixelRatio(7680, 4320, 2)).toBe(0.75)
  })
})
