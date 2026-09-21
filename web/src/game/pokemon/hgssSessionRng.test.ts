import { describe, expect, it } from 'vitest'
import {
  createHgssMersenneTwister,
  createHgssSessionRng,
  deriveHgssRtcSeed,
  restoreHgssSessionRng,
  snapshotHgssSessionRng,
} from './hgssSessionRng'

describe('HGSS session RNG', () => {
  it('matches the reference MT19937 outputs used by MTRandom', () => {
    const rng = createHgssMersenneTwister(5489)

    expect(Array.from({ length: 10 }, () => rng.nextU32())).toEqual([
      3499211612,
      581869302,
      3890346734,
      3586334585,
      545404204,
      4161255391,
      3922919429,
      949333985,
      2715962298,
      1323567403,
    ])
  })

  it('reproduces RngSeedFromRTC with the local DS date fields and VBlank counter', () => {
    const date = new Date(2026, 7, 12, 14, 35, 27)

    expect(deriveHgssRtcSeed(date, 0x1234)).toBe(0x9e0e124e)
  })

  it('initializes the MT and LC streams from the same seed without sharing state', () => {
    const session = createHgssSessionRng(0)

    expect(session.mt.nextU32()).toBe(2357136044)
    expect(session.lc.nextU16()).toBe(0)
    expect(session.lc.getSeed()).toBe(0x6073)
  })

  it('restores both streams at their exact positions from a JSON snapshot', () => {
    const session = createHgssSessionRng(5489)
    Array.from({ length: 700 }, () => session.mt.nextU32())
    Array.from({ length: 9 }, () => session.lc.nextU16())
    const restored = restoreHgssSessionRng(JSON.parse(JSON.stringify(snapshotHgssSessionRng(session))))

    expect(Array.from({ length: 32 }, () => restored.mt.nextU32())).toEqual(Array.from({ length: 32 }, () => session.mt.nextU32()))
    expect(Array.from({ length: 32 }, () => restored.lc.nextU16())).toEqual(Array.from({ length: 32 }, () => session.lc.nextU16()))
  })
})