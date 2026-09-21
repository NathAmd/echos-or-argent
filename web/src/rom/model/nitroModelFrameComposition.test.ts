import { describe, expect, it } from 'vitest'
import type { NitroModelPreview } from '../../ndsTypes'
import { composeNitroModelAnimationFrames } from './nitroModelFrameComposition'

const model = (positions: number[]): NitroModelPreview => ({
  modelId: 1,
  vertexCount: positions.length / 3,
  triangleCount: 0,
  quadCount: 0,
  materialCount: 1,
  pieceCount: 1,
  surfaces: [{ materialIndex: 0, positions: new Float32Array(positions) }],
})

describe('Nitro model frame composition', () => {
  it('merges disjoint vertex components from animations bound to one render object', () => {
    const base = model([0, 0, 0, 1, 1, 1])
    const frames = composeNitroModelAnimationFrames(base, [[model([2, 0, 0, 1, 1, 1])], [model([0, 0, 0, 1, 3, 1])]])
    expect([...frames[0]!.surfaces![0]!.positions]).toEqual([2, 0, 0, 1, 3, 1])
    expect([...base.surfaces![0]!.positions]).toEqual([0, 0, 0, 1, 1, 1])
  })

  it('rejects conflicting tracks instead of depending on application order', () => {
    const base = model([0, 0, 0])
    expect(() => composeNitroModelAnimationFrames(base, [[model([1, 0, 0])], [model([2, 0, 0])]])).toThrow(/incompatible/)
  })

  it('composes material and pattern tracks as well as skeletal vertices', () => {
    const base = model([0, 0, 0])
    base.surfaces![0] = { ...base.surfaces![0]!, materialAlpha: 1, textureId: 'base' }
    const material = structuredClone(base)
    material.surfaces![0] = { ...material.surfaces![0]!, materialAlpha: .5 }
    const pattern = structuredClone(base)
    pattern.surfaces![0] = { ...pattern.surfaces![0]!, textureId: 'next' }
    const [frame] = composeNitroModelAnimationFrames(base, [[material], [pattern]])
    expect(frame?.surfaces?.[0]).toMatchObject({ materialAlpha: .5, textureId: 'next' })
  })
})
