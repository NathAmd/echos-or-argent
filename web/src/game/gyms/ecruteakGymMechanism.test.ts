import { describe, expect, it } from 'vitest'
import { ecruteakGymCandleObjectIds, ecruteakGymPresentation, getEcruteakGymCandleIndex, isEcruteakGymCandleExtinguished } from './ecruteakGymMechanism'

describe('Ecruteak Gym native candles', () => {
  it('maps the four trainer objects to the four saved candle bytes', () => {
    const data = new Uint8Array([0, 1, 0, 1])
    expect(ecruteakGymCandleObjectIds).toEqual([2, 3, 4, 5])
    expect(ecruteakGymCandleObjectIds.map((id) => getEcruteakGymCandleIndex(id))).toEqual([0, 1, 2, 3])
    expect(ecruteakGymCandleObjectIds.map((id) => isEcruteakGymCandleExtinguished(data, id))).toEqual([false, true, false, true])
  })

  it('keeps the decoded model, fog range and four native shrink steps', () => {
    expect(ecruteakGymPresentation.modelId).toBe(128)
    expect(ecruteakGymPresentation).toMatchObject({ fogSlope: 0x20, fogOffset: 0, fogColorAlpha: 31, fogDensity: 0xff })
    expect(ecruteakGymPresentation.extinguishDelayFrames).toBe(31)
    expect(ecruteakGymPresentation.extinguishScales).toEqual([.5, 1 / 3, .25, .25])
    expect(ecruteakGymPresentation.transformedTrainerSpriteId).toBe(250)
  })
})
