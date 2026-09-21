import { describe, expect, it, vi } from 'vitest'
import type { NitroModelPreview } from '../../ndsTypes'
import type { MapPropAnimationMetadata } from '../../rom/model/mapPropAnimationMetadata'
import { hgssVBlankDurationMs } from '../../game/time/hgssFrameTiming'
import { MapPropAnimationController, releaseConflictingMapPropAnimations } from './mapPropAnimationController'

const model = (position: number, uv = 0): NitroModelPreview => ({
  modelId: 1,
  vertexCount: 1,
  triangleCount: 0,
  quadCount: 0,
  materialCount: 1,
  pieceCount: 1,
  surfaces: [{ materialIndex: 0, positions: new Float32Array([position, 0, 0]), uvs: new Float32Array([uv, 0]) }],
})
const metadata = (flags: number, count: number, bicycleSlope = false): MapPropAnimationMetadata => ({
  hasAnimations: true,
  flags,
  isBicycleSlope: bicycleSlope,
  controlValue: 0,
  classId: 0,
  animationArchiveIds: Array.from({ length: count }, (_, index) => index),
})

describe('global MapProp animation controller', () => {
  it('loops every automatic ROM track in sync and composes disjoint changes', () => {
    const controller = new MapPropAnimationController<object>()
    const first = {}, second = {}, base = model(0, 0)
    const positionTrack = [model(0, 0), model(1, 0)]
    const textureTrack = [model(0, 0), model(0, 1)]
    expect(controller.register(first, base, metadata(0, 2), [positionTrack, textureTrack], 0)).toBe(true)
    expect(controller.register(second, base, metadata(0, 2), [positionTrack, textureTrack], 0)).toBe(true)
    const applied = new Map<object, NitroModelPreview>()
    controller.update(hgssVBlankDurationMs / 2, (target, frame) => applied.set(target, frame))
    expect([...applied.get(first)!.surfaces![0]!.positions]).toEqual([0, 0, 0])
    controller.update(hgssVBlankDurationMs, (target, frame) => applied.set(target, frame))
    expect([...applied.get(first)!.surfaces![0]!.positions]).toEqual([1, 0, 0])
    expect([...applied.get(second)!.surfaces![0]!.uvs!]).toEqual([1, 0])
    controller.update(2 * hgssVBlankDurationMs, (target, frame) => applied.set(target, frame))
    expect([...applied.get(first)!.surfaces![0]!.positions]).toEqual([0, 0, 0])
  })

  it('selects and changes the native four-part time-of-day track', () => {
    const controller = new MapPropAnimationController<object>()
    const target = {}
    controller.register(target, model(0), metadata(8, 4), [[model(1)], [model(2)], [model(3)], [model(4)]], 0)
    const apply = vi.fn()
    controller.update(0, apply)
    expect(apply.mock.calls.at(-1)?.[1].surfaces[0].positions[0]).toBe(1)
    controller.setVisualTime(3)
    controller.update(0, apply)
    expect(apply.mock.calls.at(-1)?.[1].surfaces[0].positions[0]).toBe(4)
  })

  it('keeps deferred tracks detached until the ROM script selects them', () => {
    const controller = new MapPropAnimationController<object>()
    const first = {}, second = {}
    const tracks = [[model(1), model(2)], [model(3), model(4)]]
    expect(controller.register(first, model(0), metadata(2, 2), tracks, 0)).toBe(true)
    expect(controller.register(second, model(0), metadata(2, 2), tracks, 0)).toBe(true)
    const apply = vi.fn()
    controller.update(hgssVBlankDurationMs, apply)
    expect(apply).not.toHaveBeenCalled()

    expect(controller.setDeferredTracks(first, [0])).toBe(true)
    expect(controller.setDeferredTracks(second, [1])).toBe(true)
    controller.update(hgssVBlankDurationMs, apply)
    expect(apply.mock.calls.find(([target]) => target === first)?.[1].surfaces[0].positions[0]).toBe(2)
    expect(apply.mock.calls.find(([target]) => target === second)?.[1].surfaces[0].positions[0]).toBe(4)
  })

  it('leaves one-shot tracks alone and keeps bicycle slopes paused', () => {
    const controller = new MapPropAnimationController<object>()
    expect(controller.register({}, model(0), metadata(3, 1), [[model(1)]], 0)).toBe(false)
    const slope = {}
    expect(controller.register(slope, model(0), metadata(0, 1, true), [[model(2), model(3)]], 0)).toBe(true)
    const apply = vi.fn()
    controller.update(5000, apply)
    expect(apply.mock.calls.at(-1)?.[1].surfaces[0].positions[0]).toBe(2)
  })

  it('only releases a triggered animation when the next action touches the same prop', () => {
    const first = {}, second = {}, third = {}
    const resolveFirst = vi.fn(), resolveSecond = vi.fn()
    const active = new Set([
      { targets: [first, second], resolve: resolveFirst },
      { targets: [third], resolve: resolveSecond },
    ])
    releaseConflictingMapPropAnimations(active, new Set([second]), ({ targets }) => targets)
    expect(resolveFirst).toHaveBeenCalledOnce()
    expect(resolveSecond).not.toHaveBeenCalled()
    expect([...active].map(({ targets }) => targets)).toEqual([[third]])
  })
})
