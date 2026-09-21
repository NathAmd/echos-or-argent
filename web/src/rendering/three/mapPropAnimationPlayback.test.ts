import { describe, expect, it, vi } from 'vitest'
import { MapPropAnimationPlayback } from './mapPropAnimationPlayback'

describe('MapProp animation playback', () => {
  it('samples discrete frames and preserves the final pose for completion', async () => {
    const applyFrame = vi.fn()
    const playback = new MapPropAnimationPlayback<string, string, number>({
      applyFrame,
      captureTransition: () => 0,
      applyTransition: vi.fn(),
      minimumDurationMs: 10,
    })
    const completion = playback.play([{ target: 'door', frames: ['closed', 'middle', 'open'] }], {
      startedAt: 100,
      durationMs: 30,
      frameDurationMs: 10,
      interpolate: false,
    })
    playback.update(109)
    playback.update(110)
    playback.update(130)
    await completion
    expect(applyFrame.mock.calls).toEqual([
      ['door', 'closed'],
      ['door', 'closed'],
      ['door', 'middle'],
      ['door', 'open'],
      ['door', 'open'],
    ])
  })

  it('captures and applies a continuous transition', () => {
    const applyTransition = vi.fn()
    const playback = new MapPropAnimationPlayback<string, number, number>({
      applyFrame: vi.fn(),
      captureTransition: () => 4,
      applyTransition,
      minimumDurationMs: 1,
    })
    void playback.play([{ target: 'lift', frames: [8] }], {
      startedAt: 0,
      durationMs: 100,
      frameDurationMs: 10,
      interpolate: true,
    })
    playback.update(50)
    expect(applyTransition).toHaveBeenCalledWith('lift', 4, 8, 0.5)
  })

  it('resolves a previous playback when a new one owns the same target', async () => {
    const playback = new MapPropAnimationPlayback<string, number, number>({
      applyFrame: vi.fn(),
      captureTransition: () => 0,
      applyTransition: vi.fn(),
      minimumDurationMs: 1,
    })
    const replaced = playback.play([{ target: 'prop', frames: [1] }], { startedAt: 0, durationMs: 100, frameDurationMs: 10, interpolate: false })
    void playback.play([{ target: 'prop', frames: [2] }], { startedAt: 1, durationMs: 100, frameDurationMs: 10, interpolate: false })
    await expect(replaced).resolves.toBeUndefined()
  })

  it('releases only playbacks that own an explicitly invalidated target', async () => {
    const playback = new MapPropAnimationPlayback<string, number, number>({
      applyFrame: vi.fn(),
      captureTransition: () => 0,
      applyTransition: vi.fn(),
      minimumDurationMs: 1,
    })
    const released = playback.play([{ target: 'door', frames: [1] }], { startedAt: 0, durationMs: 100, frameDurationMs: 10, interpolate: false })
    const preserved = playback.play([{ target: 'lift', frames: [1] }], { startedAt: 0, durationMs: 100, frameDurationMs: 10, interpolate: false })

    playback.releaseTargets(new Set(['door']))
    await expect(released).resolves.toBeUndefined()
    let preservedResolved = false
    void preserved.then(() => { preservedResolved = true })
    await Promise.resolve()
    expect(preservedResolved).toBe(false)
    playback.clear()
    await expect(preserved).resolves.toBeUndefined()
  })
})
