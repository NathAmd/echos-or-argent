import { describe, expect, it } from 'vitest'
import { interpolateNitroInteger, sampleNitroInteger, selectNitroSample } from './nitroAnimationSampling'

describe('Nitro compressed animation sampling', () => {
  it('selects native step-1 samples directly', () => {
    expect(selectNitroSample(7, 0, 0)).toEqual({ index: 7 })
  })

  it('interpolates step-2 and step-4 samples with Nitro integer weights', () => {
    expect(sampleNitroInteger(selectNitroSample(1, 0x40000000, 4), (index) => [0, 20][index])).toBe(10)
    expect([1, 2, 3].map((frame) => sampleNitroInteger(
      selectNitroSample(frame, 0x80000000, 4),
      (index) => [0, 20][index],
    ))).toEqual([5, 10, 15])
    expect(interpolateNitroInteger(-20, 0, 1)).toBe(-15)
  })

  it('uses the uncompressed tail after the last interpolated frame', () => {
    expect([5, 6, 7, 8].map((frame) => selectNitroSample(frame, 0x80000000, 4)))
      .toEqual([{ index: 2 }, { index: 3 }, { index: 4 }, { index: 5 }])
    expect([5, 6, 7, 8].map((frame) => selectNitroSample(frame, 0x40000000, 4)))
      .toEqual([{ index: 3 }, { index: 4 }, { index: 5 }, { index: 6 }])
  })

  it('normalizes fractional and negative frame requests before sampling', () => {
    expect(selectNitroSample(-1, 0, 0)).toEqual({ index: 0 })
    expect(selectNitroSample(3.9, 0x80000000, 4)).toEqual({ from: 0, to: 1, toParts: 3 })
  })
})
