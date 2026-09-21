import { describe, expect, it } from 'vitest'
import type { NitroRenderState, NitroSurfaceAccumulator } from './internalTypes'
import { decodeNitroVertices, selectNitroMaterial } from './nitroGeometryCommands'
import { identityNitroMatrix } from './nitroMatrix'

function createState(): NitroRenderState {
  return {
    currentMatrix: identityNitroMatrix(),
    matrixStack: Array.from({ length: 32 }, () => identityNitroMatrix()),
    currentColor: [1, 1, 1],
    currentMaterialIndex: 0,
    currentTexcoord: [0, 0],
  }
}

function packedVertex(x: number, y: number, z: number): number {
  return ((Math.round(x * 64) & 0x3ff) | ((Math.round(y * 64) & 0x3ff) << 10) | ((Math.round(z * 64) & 0x3ff) << 20)) >>> 0
}

describe('Nitro geometry commands', () => {
  it('restores the GX vertex color when DIF_AMB requests it on material bind', () => {
    const state = createState()
    state.currentColor = [0, 0, 0]

    selectNitroMaterial(state, 1, [
      { name: 'shadow', diffuseColor: [0, 0, 0] },
      { name: 'building', diffuseColor: [0.8, 0.7, 0.6], setsVertexColor: true },
    ])

    expect(state.currentMaterialIndex).toBe(1)
    expect(state.currentColor).toEqual([0.8, 0.7, 0.6])
  })

  it('preserves the preceding GX color when DIF_AMB does not request a reload', () => {
    const state = createState()
    state.currentColor = [0.25, 0.5, 0.75]

    selectNitroMaterial(state, 0, [{ name: 'detail', diffuseColor: [1, 1, 1], setsVertexColor: false }])

    expect(state.currentColor).toEqual([0.25, 0.5, 0.75])
  })

  it('emits a triangle from a packed VTX_10 command group', () => {
    const bytes = new Uint8Array(24)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x24242440, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, packedVertex(0, 0, 0), true)
    view.setUint32(12, packedVertex(1, 0, 0), true)
    view.setUint32(16, packedVertex(0, 1, 0), true)
    view.setUint32(20, 0x00000041, true)
    const surfaces = new Map<number, NitroSurfaceAccumulator>()

    expect(decodeNitroVertices(view, 0, bytes.length, createState(), surfaces, [])).toEqual({ usesVertexColors: false })
    expect(surfaces.get(0)).toMatchObject({
      positions: [0, 0, 0, 1, 0, 0, 0, 1, 0],
      colors: [1, 1, 1, 1, 1, 1, 1, 1, 1],
      uvs: [0, 0, 0, 0, 0, 0],
      usesVertexColors: false,
      usesUvs: false,
    })
  })

  it('applies vertex colors and material-normalized UVs', () => {
    const bytes = new Uint8Array(32)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x24222040, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0x001f, true)
    view.setUint32(12, (48 << 16) | 32, true)
    view.setUint32(16, packedVertex(0, 0, 0), true)
    view.setUint32(20, 0x00412424, true)
    view.setUint32(24, packedVertex(1, 0, 0), true)
    view.setUint32(28, packedVertex(0, 1, 0), true)
    const surfaces = new Map<number, NitroSurfaceAccumulator>()

    expect(decodeNitroVertices(view, 0, bytes.length, createState(), surfaces, [{ name: 'material', textureWidth: 2, textureHeight: 3 }])).toEqual({ usesVertexColors: true })
    expect(surfaces.get(0)).toMatchObject({
      colors: [1, 0, 0, 1, 0, 0, 1, 0, 0],
      uvs: [1, 1, 1, 1, 1, 1],
      usesVertexColors: true,
      usesUvs: true,
    })
  })

  it('clears a stale explicit color when a NORMAL command returns to GX lighting', () => {
    const bytes = new Uint8Array(32)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0x21242040, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, packedVertex(0, 0, 0), true)
    view.setUint32(16, 0, true)
    view.setUint32(20, 0x00412424, true)
    view.setUint32(24, packedVertex(1, 0, 0), true)
    view.setUint32(28, packedVertex(0, 1, 0), true)
    const surfaces = new Map<number, NitroSurfaceAccumulator>()

    expect(decodeNitroVertices(view, 0, bytes.length, createState(), surfaces, [])).toEqual({ usesVertexColors: true })
    expect(surfaces.get(0)?.colors).toEqual([
      0, 0, 0,
      1, 1, 1,
      1, 1, 1,
    ])
  })

  it('stops safely on unsupported or incomplete commands', () => {
    const unsupported = new DataView(new Uint32Array([0xff]).buffer)
    const surfaces = new Map<number, NitroSurfaceAccumulator>()
    expect(decodeNitroVertices(unsupported, 0, 4, createState(), surfaces, [])).toEqual({ usesVertexColors: false })
    expect(surfaces.size).toBe(0)
  })
})
