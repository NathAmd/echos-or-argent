import { describe, expect, it } from 'vitest'
import type { MapEventPreview, MapMatrixPreview } from '../../ndsTypes'
import { collectConnectedMapIds, collectMatrixAdjacentMapIds } from './mapGraph'

function createMatrix(headers: number[], width: number, height: number): MapMatrixPreview {
  return {
    matrixIndex: 0,
    name: 'test-matrix',
    width,
    height,
    headers: new Uint16Array(headers),
    altitudes: new Uint8Array(headers.length),
    modelIds: new Uint16Array(headers.length),
  }
}

function createEvents(warpHeaders: number[]): MapEventPreview {
  return {
    backgroundEvents: 0,
    backgrounds: [],
    objects: [],
    warps: warpHeaders.map((header, index) => ({ x: index, z: index, header, anchor: 0 })),
    coordinateEvents: [],
  }
}

describe('mapGraph', () => {
  it('collects adjacent map ids from matrix neighbors without duplicates', () => {
    const matrix = createMatrix([
      10, 11, 12,
      10, 13, 14,
    ], 3, 2)

    expect(collectMatrixAdjacentMapIds(10, matrix, 540)).toEqual([11, 13])
  })

  it('merges matrix adjacency with warp destinations and ignores invalid references', () => {
    const matrix = createMatrix([
      20, 21,
      22, 23,
    ], 2, 2)
    const events = createEvents([23, 24, 20, -1, 999])

    expect(collectConnectedMapIds(20, matrix, events, 540)).toEqual([21, 22, 23, 24])
  })
})