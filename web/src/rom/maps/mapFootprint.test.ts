import { describe, expect, it } from 'vitest'
import type { MapMatrixPreview } from '../../ndsTypes'
import { getMapMatrixFillerBoundaries, getMapMatrixFootprint, getMapMatrixLoadedCellIndices, getMapMatrixRenderableCellIndices, getMapMatrixRenderCellIndices, getMapMatrixRenderWindow, getMapMatrixTileBounds } from './mapFootprint'

function createMatrix(headers: number[], width: number, height: number, modelIds = headers.map((_, index) => index)): MapMatrixPreview {
  return {
    matrixIndex: 0,
    name: 'matrix',
    width,
    height,
    headers: new Uint16Array(headers),
    altitudes: new Uint8Array(headers.length),
    modelIds: new Uint16Array(modelIds),
  }
}

describe('map footprint helpers', () => {
  it('reuses immutable decoded matrix geometry across every render-frame query', () => {
    const matrix = createMatrix([0, 77, 77, 0], 2, 2)
    const cells = getMapMatrixFootprint(77, matrix)?.cells
    const footprint = getMapMatrixFootprint(77, matrix)

    expect(getMapMatrixFootprint(77, matrix)).toBe(footprint)
    expect(getMapMatrixFootprint(77, matrix)?.cells).toBe(cells)
  })

  it('uses the true top-left footprint origin even when the first occurrence is not the minimum x cell', () => {
    const matrix = createMatrix([
      0, 61, 0,
      61, 61, 0,
    ], 3, 2)

    expect(getMapMatrixFootprint(61, matrix)).toMatchObject({
      minCellX: 0,
      maxCellX: 1,
      minCellZ: 0,
      maxCellZ: 1,
      widthCells: 2,
      heightCells: 2,
    })
    expect(getMapMatrixTileBounds(61, matrix)).toEqual({ minX: 0, maxX: 64, minZ: 0, maxZ: 64 })
  })

  it('expands the render window around the full footprint instead of a single anchor cell', () => {
    const matrix = createMatrix([
      0, 0, 0, 0, 0,
      0, 61, 61, 0, 0,
      0, 0, 61, 0, 0,
      0, 0, 0, 0, 0,
    ], 5, 4)

    expect(getMapMatrixRenderWindow(61, matrix, 1, 1)).toMatchObject({
      minCellX: 0,
      maxCellX: 3,
      minCellZ: 0,
      maxCellZ: 3,
      footprint: { minCellX: 1, maxCellX: 2, minCellZ: 1, maxCellZ: 2 },
    })
  })

  it('preloads one neighboring ROM cell around the active footprint by default', () => {
    const matrix = createMatrix(Array.from({ length: 49 }, (_, index) => index), 7, 7)
    matrix.headers[24] = 61

    expect(getMapMatrixRenderWindow(61, matrix)).toMatchObject({
      minCellX: 2,
      maxCellX: 4,
      minCellZ: 2,
      maxCellZ: 4,
    })
  })

  it('keeps every predecoded render cell visible without a player-position threshold', () => {
    const matrix = createMatrix(Array.from({ length: 49 }, (_, index) => index), 7, 7)
    matrix.headers[24] = 61

    expect(getMapMatrixRenderCellIndices(61, matrix)).toEqual([
      16, 17, 18,
      23, 24, 25,
      30, 31, 32,
    ])
  })

  it('clips the stable render cells at matrix borders', () => {
    const matrix = createMatrix(Array.from({ length: 9 }, (_, index) => index), 3, 3)
    matrix.headers[0] = 61

    expect(getMapMatrixRenderCellIndices(61, matrix)).toEqual([0, 1, 3, 4])
  })

  it('does not render MAP_EVERYWHERE filler cells around a real map', () => {
    const matrix = createMatrix([
      0, 0, 0, 0,
      38, 74, 74, 37,
      0, 0, 0, 0,
    ], 4, 3, [208, 208, 208, 208, 37, 33, 34, 32, 208, 208, 208, 208])

    expect(getMapMatrixRenderableCellIndices(74, matrix)).toEqual([4, 5, 6, 7])
    expect(getMapMatrixFillerBoundaries(74, matrix)).toEqual({
      north: true,
      south: true,
      west: false,
      east: false,
    })
  })

  it('selects the same four-cell quadrant window as the HGSS MapLoadManager', () => {
    const matrix = createMatrix(Array.from({ length: 49 }, (_, index) => index), 7, 7)

    expect(getMapMatrixLoadedCellIndices(matrix, 3 * 32 + 15, 3 * 32 + 15)).toEqual([24, 23, 17, 16])
    expect(getMapMatrixLoadedCellIndices(matrix, 3 * 32 + 16, 3 * 32 + 15)).toEqual([24, 25, 17, 18])
    expect(getMapMatrixLoadedCellIndices(matrix, 3 * 32 + 15, 3 * 32 + 16)).toEqual([24, 23, 31, 30])
    expect(getMapMatrixLoadedCellIndices(matrix, 3 * 32 + 16, 3 * 32 + 16)).toEqual([24, 25, 31, 32])
  })

  it('clips the native four-cell window at matrix edges', () => {
    const matrix = createMatrix(Array.from({ length: 9 }, (_, index) => index), 3, 3)

    expect(getMapMatrixLoadedCellIndices(matrix, 0, 0)).toEqual([0])
    expect(getMapMatrixLoadedCellIndices(matrix, 2 * 32 + 31, 2 * 32 + 31)).toEqual([8])
  })

  it('converts native matrix altitudes to field-scene units', () => {
    const matrix = createMatrix([60, 60], 2, 1)
    matrix.altitudes = new Uint8Array([2, 5])

    expect(getMapMatrixFootprint(60, matrix)?.cells).toMatchObject([
      { index: 0, altitude: 16 },
      { index: 1, altitude: 40 },
    ])
  })

  it('treats every cell of a headerless dungeon matrix as one local map', () => {
    const matrix = createMatrix([0, 0, 0], 1, 3, [479, 480, 481])
    matrix.hasHeaders = false

    expect(getMapMatrixFootprint(99, matrix)).toMatchObject({
      minCellX: 0,
      maxCellX: 0,
      minCellZ: 0,
      maxCellZ: 2,
      widthCells: 1,
      heightCells: 3,
    })
    expect(getMapMatrixTileBounds(99, matrix)).toEqual({ minX: 0, maxX: 32, minZ: 0, maxZ: 96 })
  })
})
