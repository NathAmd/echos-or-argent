import { describe, expect, it } from 'vitest'
import { advanceHgssBridgeLayer, restoreHgssBridgeLayer } from './hgssBridgeLayer'

describe('HGSS raised bridge layer', () => {
  it('reproduces MapObject flag 28 across native bridge behaviors', () => {
    expect(advanceHgssBridgeLayer(false, 113)).toBe(false)
    expect(advanceHgssBridgeLayer(false, 115)).toBe(false)
    let active = advanceHgssBridgeLayer(false, 112)
    expect(active).toBe(true)
    for (const behavior of [113, 114, 115, 113]) {
      active = advanceHgssBridgeLayer(active, behavior)
      expect(active).toBe(true)
    }
    expect(advanceHgssBridgeLayer(active, 0)).toBe(false)
  })

  it('restores the unsaved layer from locomotion without a map exception', () => {
    for (const behavior of [112, 113, 114, 115]) {
      expect(restoreHgssBridgeLayer(behavior, 'walking')).toBe(true)
      expect(restoreHgssBridgeLayer(behavior, 'surfing')).toBe(false)
    }
    expect(restoreHgssBridgeLayer(21, 'walking')).toBe(false)
  })
})
