import { describe, expect, it } from 'vitest'
import type { NitroSurfacePreview } from '../../ndsTypes'
import { isLegacyPropShadowSurface } from './legacyPropShadows'

const surface = (names: Partial<Pick<NitroSurfacePreview, 'materialName' | 'textureName' | 'paletteName'>>): NitroSurfacePreview => ({
  materialIndex: 0,
  positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
  ...names,
})

describe('legacy HGSS prop shadows', () => {
  it.each([
    { materialName: 'shade' },
    { materialName: 'plant01_shade' },
    { textureName: 'h_kage' },
    { textureName: 'tree_kage' },
    { paletteName: 'as_kage_pl' },
    { materialName: 'pasted___kage' },
  ])('recognizes ROM shadow naming in $materialName$textureName$paletteName', (names) => {
    expect(isLegacyPropShadowSurface(surface(names))).toBe(true)
  })

  it.each([
    { materialName: 'toukage', textureName: 'as_mado' },
    { materialName: 'lambert3', textureName: 'bender' },
    { materialName: 'plant01', textureName: 'tree' },
  ])('keeps similarly named non-shadow surfaces', (names) => {
    expect(isLegacyPropShadowSurface(surface(names))).toBe(false)
  })
})
