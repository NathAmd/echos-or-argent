import { describe, expect, it } from 'vitest'
import type { NitroSurfacePreview } from '../../ndsTypes'
import { resolveNitroSurfaceMaterialColor } from './nitroSurfaceMaterialColor'

function surface(overrides: Partial<NitroSurfacePreview> = {}): NitroSurfacePreview {
  return {
    materialIndex: 0,
    materialColor: [0.8, 0.7, 0.6],
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
    ...overrides,
  }
}

describe('Nitro surface material color', () => {
  it('does not multiply an explicit GX vertex channel by diffuse a second time', () => {
    const decoded = surface({
      materialColor: [0, 0, 0],
      materialAmbientColor: [1, 1, 1],
      colors: new Float32Array([0.6, 0.5, 0.4, 0.6, 0.5, 0.4, 0.6, 0.5, 0.4]),
    })

    expect(resolveNitroSurfaceMaterialColor(decoded)).toEqual([1, 1, 1])
  })

  it('keeps a non-black diffuse color for NORMAL-only geometry', () => {
    expect(resolveNitroSurfaceMaterialColor(surface())).toEqual([0.8, 0.7, 0.6])
  })

  it('uses native ambient or emission light when NORMAL-only diffuse is black', () => {
    expect(resolveNitroSurfaceMaterialColor(surface({
      materialColor: [0, 0, 0],
      materialAmbientColor: [0.25, 0.5, 0.75],
      materialEmissionColor: [0.5, 0.25, 0],
    }))).toEqual([0.5, 0.5, 0.75])
  })

  it('preserves a genuinely black unlit surface', () => {
    expect(resolveNitroSurfaceMaterialColor(surface({
      materialColor: [0, 0, 0],
      materialAmbientColor: [0, 0, 0],
      materialEmissionColor: [0, 0, 0],
    }))).toEqual([0, 0, 0])
  })

  it('uses the base channels while applying a partial animation frame', () => {
    const base = surface({ materialColor: [0, 0, 0], materialAmbientColor: [0.2, 0.4, 0.6] })
    const frame = surface({ materialColor: undefined, materialAmbientColor: undefined })
    expect(resolveNitroSurfaceMaterialColor(frame, base, false)).toEqual([0.2, 0.4, 0.6])
  })
})
