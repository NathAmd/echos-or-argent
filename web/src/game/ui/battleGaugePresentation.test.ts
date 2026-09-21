import { describe, expect, it } from 'vitest'
import { resolveBattleGaugeAnimationTiming, resolveBattleGaugeTarget, sampleSteppedBattleGauge } from './battleGaugePresentation'

describe('battle gauge presentation', () => {
  it('clamps damage and healing without overshooting the real bounds', () => {
    expect(resolveBattleGaugeTarget(38, 60, -12)).toBe(26)
    expect(resolveBattleGaugeTarget(8, 60, -30)).toBe(0)
    expect(resolveBattleGaugeTarget(52, 60, 20)).toBe(60)
  })

  it('finishes every stepped animation on the exact target value', () => {
    expect(sampleSteppedBattleGauge(50, 17, .5)).toBeGreaterThanOrEqual(17)
    expect(sampleSteppedBattleGauge(50, 17, 1)).toBe(17)
    expect(sampleSteppedBattleGauge(17, 42, 1)).toBe(42)
  })

  it('adapte la durée et le nombre de pas à la distance réelle', () => {
    expect(resolveBattleGaugeAnimationTiming(60, 57, 60)).toEqual({ duration: 201, steps: 3 })
    expect(resolveBattleGaugeAnimationTiming(60, 0, 60)).toEqual({ duration: 600, steps: 36 })
    expect(resolveBattleGaugeAnimationTiming(60, 0, 60, true)).toEqual({ duration: 0, steps: 1 })
  })
})
