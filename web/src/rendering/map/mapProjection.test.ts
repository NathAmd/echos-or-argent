import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { projectMapPosition, unprojectMapTile } from './mapProjection'

describe('map projection', () => {
  it('keeps field actors in tile coordinates for any map embedded in a multi-cell world matrix', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, 10, 7).toArray()).toEqual([10.5, 0.08, 7.5])
  })

  it('places field actors on sampled exterior ground height when scene geometry is available', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
      model: {
        modelId: 0,
        vertexCount: 6,
        triangleCount: 2,
        quadCount: 0,
        materialCount: 1,
        pieceCount: 1,
        surfaces: [{
          materialIndex: 0,
          positions: new Float32Array([
            10, 1, 7,
            11, 1, 7,
            10, 1, 8,
            11, 1, 7,
            11, 1, 8,
            10, 1, 8,
          ]),
        }],
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, 10, 7).toArray()).toEqual([10.5, 1.08, 7.5])
  })

  it('uses the highest walkable exterior surface when multiple stacked layers overlap a tile', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
      model: {
        modelId: 0,
        vertexCount: 12,
        triangleCount: 4,
        quadCount: 0,
        materialCount: 2,
        pieceCount: 2,
        surfaces: [{
          materialIndex: 0,
          positions: new Float32Array([
            10, 1, 7,
            11, 1, 7,
            10, 1, 8,
            11, 1, 7,
            11, 1, 8,
            10, 1, 8,
          ]),
        }, {
          materialIndex: 1,
          positions: new Float32Array([
            10, 3, 7,
            11, 3, 7,
            10, 3, 8,
            11, 3, 7,
            11, 3, 8,
            10, 3, 8,
          ]),
        }],
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, 10, 7).toArray()).toEqual([10.5, 3.08, 7.5])
  })

  it('uses the exterior surface closest to the reference height when a tile contains multiple layers', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
      model: {
        modelId: 0,
        vertexCount: 18,
        triangleCount: 6,
        quadCount: 0,
        materialCount: 3,
        pieceCount: 3,
        surfaces: [{
          materialIndex: 0,
          positions: new Float32Array([
            10, 1, 7,
            11, 1, 7,
            10, 1, 8,
            11, 1, 7,
            11, 1, 8,
            10, 1, 8,
          ]),
        }, {
          materialIndex: 1,
          positions: new Float32Array([
            10, 3, 7,
            11, 3, 7,
            10, 3, 8,
            11, 3, 7,
            11, 3, 8,
            10, 3, 8,
          ]),
        }, {
          materialIndex: 2,
          positions: new Float32Array([
            10, 1.125, 7,
            11, 1.125, 7,
            10, 1.125, 8,
            11, 1.125, 7,
            11, 1.125, 8,
            10, 1.125, 8,
          ]),
        }],
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, 10, 7, 0.08, 1).toArray()).toEqual([10.5, 1.08, 7.5])
  })

  it('keeps a resolved adjacent-cell height outside the active terrain footprint', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([3, 5]),
        modelIds: new Uint16Array([0, 1]),
      },
      terrain: {
        modelId: 1,
        width: 32,
        height: 32,
        attributes: new Uint16Array(32 * 32),
        collisionPlates: [{ minX: 0, maxX: 32, minZ: 0, maxZ: 32, normalX: 0, normalY: 1, normalZ: 0, distance: 40 }],
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, -1, 7, 0.08, 24).toArray()).toEqual([-0.5, 24.08, 7.5])
  })

  it('converts an indoor ROM collision-plane height to Nitro scene units', () => {
    const map = {
      id: 97,
      matrix: {
        matrixIndex: 102,
        name: 'R31R0101',
        width: 1,
        height: 1,
        headers: new Uint16Array([97]),
        altitudes: new Uint8Array([0]),
        modelIds: new Uint16Array([243]),
      },
      terrain: {
        modelId: 243,
        width: 32,
        height: 32,
        attributes: new Uint16Array(32 * 32),
        collisionPlates: [{
          minX: -15,
          maxX: -5,
          minZ: -14,
          maxZ: -4,
          normalX: 0,
          normalY: 1,
          normalZ: 0,
          distance: 1,
        }],
      },
    } as OpeningMapPreview

    expect(projectMapPosition(undefined, map, 5, 7).toArray()).toEqual([-168, 16.08, -136])
    expect(unprojectMapTile(map, { x: -168, z: -136 })).toEqual({ x: 5, z: 7 })
  })

  it('inverts exterior world-matrix coordinates in constant time', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 0,
        name: 'world-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
    } as OpeningMapPreview
    expect(unprojectMapTile(map, { x: 10.5, z: 7.5 })).toEqual({ x: 10, z: 7 })
  })
})
