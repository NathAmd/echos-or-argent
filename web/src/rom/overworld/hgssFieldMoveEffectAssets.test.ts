import { describe, expect, it, vi } from 'vitest'
import type { NitroModelPreview, RomInventory } from '../../ndsTypes'
import { resolveHgssFieldMoveEffectAsset } from './hgssFieldMoveEffectAssets'

function model(position = 0): NitroModelPreview {
  const positions = new Float32Array([position, 0, 0, 1, 0, 0, 0, 0, 1])
  return {
    modelId: 3,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    positions,
    surfaces: [{ materialIndex: 0, materialColor: [1, 1, 1], positions }],
  }
}

describe('résolution Nitro des effets terrain HGSS', () => {
  it('compose toutes les pistes du profil dans leur ordre ROM', () => {
    const base = model()
    const modelResolver = vi.fn(() => base) as RomInventory['gymOverlayModelResolver']
    const animationResolver = vi.fn((_archive: string, _model: number, member: number) => ({
      frameCount: 45,
      frames: Array.from({ length: 45 }, (_, frame) => model(member === 0 ? frame : 0)),
    }))

    const asset = resolveHgssFieldMoveEffectAsset(0, modelResolver, animationResolver)

    expect(modelResolver).toHaveBeenCalledWith('/a/1/3/4', 3)
    expect(animationResolver.mock.calls.map((call) => call[2])).toEqual([0, 1, 2])
    expect(asset.frames).toHaveLength(45)
    expect(asset.frames[44]?.surfaces?.[0]?.positions[0]).toBe(44)
  })

  it('refuse une ressource ou une durée qui ne correspond pas au profil natif', () => {
    const base = model()
    const modelResolver = vi.fn(() => base) as RomInventory['gymOverlayModelResolver']
    const shortAnimation = vi.fn(() => ({ frameCount: 44, frames: Array.from({ length: 44 }, () => base) })) as RomInventory['gymOverlayAnimationResolver']

    expect(() => resolveHgssFieldMoveEffectAsset(0, undefined, undefined)).toThrow('résolveurs Nitro')
    expect(() => resolveHgssFieldMoveEffectAsset(0, vi.fn(), vi.fn())).toThrow('modèle Nitro')
    expect(() => resolveHgssFieldMoveEffectAsset(0, modelResolver, shortAnimation)).toThrow('45 frames natives')
  })
})
