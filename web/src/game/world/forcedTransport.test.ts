import { describe, expect, it } from 'vitest'
import {
  getForcedTransportRouteDistance,
  hgssAzaleaTransportTiming,
  sampleForcedTransportRoute,
  sampleForcedTransportTimeline,
} from './forcedTransport'

describe('forced transport timeline', () => {
  it('samples every segment of a diagonal route by travelled distance', () => {
    const route = [{ x: 0, z: 0 }, { x: 0, z: 2 }, { x: 3, z: 6 }]
    expect(getForcedTransportRouteDistance(route)).toBe(7)
    expect(sampleForcedTransportRoute(route, 1)).toEqual({ x: 0, z: 1 })
    expect(sampleForcedTransportRoute(route, 4.5)).toEqual({ x: 1.5, z: 4 })
    expect(sampleForcedTransportRoute(route, 99)).toEqual({ x: 3, z: 6 })
  })

  it('preserves the native mount, preparation, travel, shake, wait and dismount phases', () => {
    const frame = 10
    const travel = 100
    expect(sampleForcedTransportTimeline(0, travel, frame, hgssAzaleaTransportTiming).phase).toBe('mount')
    expect(sampleForcedTransportTimeline(80, travel, frame, hgssAzaleaTransportTiming).phase).toBe('prepare')
    expect(sampleForcedTransportTimeline(130, travel, frame, hgssAzaleaTransportTiming).phase).toBe('travel')
    expect(sampleForcedTransportTimeline(230, travel, frame, hgssAzaleaTransportTiming).phase).toBe('shake')
    expect(sampleForcedTransportTimeline(310, travel, frame, hgssAzaleaTransportTiming).phase).toBe('terminalWait')
    expect(sampleForcedTransportTimeline(400, travel, frame, hgssAzaleaTransportTiming).phase).toBe('dismount')
    expect(sampleForcedTransportTimeline(480, travel, frame, hgssAzaleaTransportTiming).phase).toBe('complete')
  })
})
