import { describe, expect, it, vi } from 'vitest'
import { hgssVBlankDurationMs } from '../../game/time/hgssFrameTiming'
import { MapPropOneShotAnimationController, sampleMapPropOneShotAnimation } from './mapPropOneShotAnimationController'

describe('native HGSS one-shot MapProp animations', () => {
  it('samples decoded ROM poses and holds the final frame', () => {
    expect(sampleMapPropOneShotAnimation(4, 1, false, 0)).toEqual({ frameIndex: 0, finished: false })
    expect(sampleMapPropOneShotAnimation(4, 1, false, 2)).toEqual({ frameIndex: 2, finished: false })
    expect(sampleMapPropOneShotAnimation(4, 1, false, 3)).toEqual({ frameIndex: 3, finished: false })
    expect(sampleMapPropOneShotAnimation(4, 1, false, 4)).toEqual({ frameIndex: 3, finished: true })
    expect(sampleMapPropOneShotAnimation(4, 1, false, 20)).toEqual({ frameIndex: 3, finished: true })
  })

  it('preserves reverse playback and the native loop count', () => {
    expect(sampleMapPropOneShotAnimation(3, 2, true, 0)).toEqual({ frameIndex: 2, finished: false })
    expect(sampleMapPropOneShotAnimation(3, 2, true, 3)).toEqual({ frameIndex: 2, finished: false })
    expect(sampleMapPropOneShotAnimation(3, 2, true, 5)).toEqual({ frameIndex: 0, finished: false })
    expect(sampleMapPropOneShotAnimation(3, 2, true, 6)).toEqual({ frameIndex: 0, finished: true })
  })

  it('loads, plays, waits and unloads scripts by their native tag', async () => {
    const controller = new MapPropOneShotAnimationController<object, string>()
    const target = {}
    const apply = vi.fn()
    const reset = vi.fn()
    controller.load({ tag: 90, modelId: 33, targets: [target], tracks: [['a', 'b', 'c']], loopCount: 1, reversed: false })
    controller.play(90, 0, 100)
    const completed = controller.wait(90)
    controller.update(100 + 2 * hgssVBlankDurationMs, apply)
    let settled = false
    void completed.then(() => { settled = true })
    await Promise.resolve()
    expect(settled).toBe(false)
    controller.update(100 + 3 * hgssVBlankDurationMs, apply)
    await completed
    expect(apply).toHaveBeenLastCalledWith(target, 'c')
    controller.unload(90, reset)
    expect(reset).toHaveBeenCalledWith(target)
  })

  it('rejects missing resources instead of silently inventing a fallback', () => {
    const controller = new MapPropOneShotAnimationController<object, string>()
    expect(() => controller.load({ tag: 0, modelId: 33, targets: [{}], tracks: [['a']], loopCount: 1, reversed: false })).toThrow('tag ROM zero')
    expect(() => controller.load({ tag: 1, modelId: 33, targets: [], tracks: [['a']], loopCount: 1, reversed: false })).toThrow('aucune cible')
    expect(() => controller.load({ tag: 1, modelId: 33, targets: [{}], tracks: [[]], loopCount: 1, reversed: false })).toThrow('piste complete')
  })
})
