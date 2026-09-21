import { describe, expect, it, vi } from 'vitest'
import type { NitroModelPreview, OpeningMapPreview } from '../../ndsTypes'
import { resolveHgssGymPropPresentations } from './hgssGymPropAnimations'

const model = (id: number, value: number): NitroModelPreview => ({ modelId: id, vertexCount: 1, triangleCount: 0, quadCount: 0, materialCount: 1, pieceCount: 1, surfaces: [{ materialIndex: 0, positions: new Float32Array([value, 0, 0]) }] })
const map = { id: 139, label: 'Irisia', header: { areaDataBank: 33 } } as OpeningMapPreview

describe('global HGSS gym prop animations', () => {
  it('resolves owner animation tracks against their target render model', () => {
    const result = resolveHgssGymPropPresentations(
      map,
      [{ targetModelId: 173, animationModelId: 174 }],
      true,
      vi.fn(() => model(173, 0)),
      vi.fn((_target, _area, archive) => ({ frameCount: 1, frames: [model(173, archive - 145)] })),
      vi.fn(() => ({ hasAnimations: true, flags: 2, isBicycleSlope: false, controlValue: 0, classId: 0, animationArchiveIds: [146] })),
    )
    expect([...result[0]!.frames![0]!.surfaces![0]!.positions]).toEqual([1, 0, 0])
  })

  it('returns the untouched ROM base when animations are detached', () => {
    const result = resolveHgssGymPropPresentations(map, [{ targetModelId: 199, animationModelId: 199 }], false, vi.fn(() => model(199, 0)), undefined, undefined)
    expect(result).toMatchObject([{ modelId: 199 }])
    expect(result[0]!.frames).toBeUndefined()
  })
})
