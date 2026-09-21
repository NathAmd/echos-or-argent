import { describe, expect, it } from 'vitest'
import { splitIndoorSurfaceLayers } from './indoorSurfaceLayers'

describe('indoor surface depth layers', () => {
  it('splits one shared material into independent triangle depths while preserving attributes', () => {
    const positions = new Float32Array([
      0, 0, 2, 1, 0, 2, 0, 0, 3,
      0, 0, 8, 1, 0, 8, 0, 0, 9,
    ])
    const colors = new Float32Array(positions.length).fill(0.5)
    const uvs = new Float32Array(12).fill(0.25)
    const layers = splitIndoorSurfaceLayers(positions, colors, uvs)
    expect(layers.map((layer) => layer.depthKey)).toEqual([300, 900])
    expect(layers.map((layer) => layer.positions.length)).toEqual([9, 9])
    expect(layers.every((layer) => layer.colors?.length === 9 && layer.uvs?.length === 6)).toBe(true)
  })
})
