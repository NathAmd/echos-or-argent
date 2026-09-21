import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import { decodeFieldMapTerrain, decodeMapEvents, decodeMapMatrix, decodeMapTerrain, findMapMatrixForHeader } from './mapData'

function member(size: number, index = 0, offset = 0): NarcMember {
  return { index, offset, size, signature: '' }
}

describe('map data decoders', () => {
  it('decodes matrix dimensions, headers, altitudes, and model ids', () => {
    const bytes = new Uint8Array(18)
    const view = new DataView(bytes.buffer)
    bytes.set([2, 1, 1, 1, 3, 77, 65, 80], 0)
    view.setUint16(8, 60, true)
    view.setUint16(10, 63, true)
    bytes.set([4, 5], 12)
    view.setUint16(14, 8, true)
    view.setUint16(16, 9, true)

    expect(decodeMapMatrix(bytes, member(bytes.length, 7))).toEqual({
      matrixIndex: 7,
      name: 'MAP',
      width: 2,
      height: 1,
      hasHeaders: true,
      headers: new Uint16Array([60, 63]),
      altitudes: new Uint8Array([4, 5]),
      modelIds: new Uint16Array([8, 9]),
    })

    const archive = { archiveMembers: [member(bytes.length, 7)] } as RomFile
    expect(findMapMatrixForHeader(bytes, archive, 63)?.matrixIndex).toBe(7)
    expect(findMapMatrixForHeader(bytes, archive, 64)).toBeUndefined()
  })

  it('preserves headerless local matrices and stitches all of their terrain cells', () => {
    const memberSize = 0x14 + 32 * 32 * 2
    const matrixBytes = new Uint8Array(5 + 3 * 2)
    const matrixView = new DataView(matrixBytes.buffer)
    matrixBytes.set([1, 3, 0, 0, 0], 0)
    matrixView.setUint16(5, 0, true)
    matrixView.setUint16(7, 1, true)
    matrixView.setUint16(9, 2, true)
    const matrix = decodeMapMatrix(matrixBytes, member(matrixBytes.length, 42))
    expect(matrix).toMatchObject({ hasHeaders: false, width: 1, height: 3 })

    const bytes = new Uint8Array(memberSize * 3)
    const view = new DataView(bytes.buffer)
    for (let index = 0; index < 3; index += 1) {
      const offset = index * memberSize
      view.setUint32(offset, 32 * 32 * 2, true)
      view.setUint16(offset + 16, 0x1234, true)
      view.setUint16(offset + 0x14, 0x1000 + index, true)
    }
    const archive = {
      archiveMembers: Array.from({ length: 3 }, (_, index) => member(memberSize, index, index * memberSize)),
    } as RomFile
    const terrain = decodeFieldMapTerrain(bytes, archive, matrix!, 99)
    expect(terrain).toMatchObject({ width: 32, height: 96 })
    expect(terrain?.attributes[0]).toBe(0x1000)
    expect(terrain?.attributes[32 * 32]).toBe(0x1001)
    expect(terrain?.attributes[64 * 32]).toBe(0x1002)
  })

  it('decodes object and warp records with strict section bounds', () => {
    const bytes = new Uint8Array(60)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0, true)
    view.setUint32(4, 1, true)
    view.setUint16(8, 3, true)
    view.setUint16(10, 42, true)
    view.setUint16(12, 17, true)
    view.setUint16(14, 2, true)
    view.setUint16(16, 0x2a9, true)
    view.setUint16(18, 99, true)
    view.setUint16(20, 3, true)
    view.setUint16(22, 6, true)
    view.setUint16(24, 7, true)
    view.setUint16(26, 8, true)
    view.setUint16(32, 12, true)
    view.setUint16(34, 15, true)
    view.setUint32(40, 1, true)
    view.setUint16(44, 6, true)
    view.setUint16(46, 7, true)
    view.setUint16(48, 63, true)
    view.setUint16(50, 2, true)
    view.setUint32(56, 0, true)

    expect(decodeMapEvents(bytes, member(bytes.length))).toEqual({
      backgroundEvents: 0,
      backgrounds: [],
      objects: [{ id: 3, spriteId: 42, movement: 17, type: 2, eventFlag: 0x2a9, scriptId: 99, facingDirection: 3, parameters: [6, 7, 8], xRange: 0, zRange: 0, x: 12, z: 15 }],
      warps: [{ x: 6, z: 7, header: 63, anchor: 2 }],
      coordinateEvents: [],
    })
    expect(decodeMapEvents(bytes.subarray(0, 59), member(59))).toBeUndefined()
  })

  it('decodes background script interactions', () => {
    const bytes = new Uint8Array(36)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 1, true)
    view.setUint16(4, 2, true)
    view.setUint16(6, 3, true)
    view.setInt32(8, 8, true)
    view.setInt32(12, 4, true)
    view.setInt32(16, -16, true)
    view.setUint16(20, 4, true)

    expect(decodeMapEvents(bytes, member(bytes.length))).toEqual({
      backgroundEvents: 1,
      backgrounds: [{ scriptId: 2, type: 3, x: 8, z: 4, y: -16, direction: 4 }],
      objects: [],
      warps: [],
      coordinateEvents: [],
    })
  })

  it('decodes coordinate events with signed coordinates and variable gating', () => {
    const bytes = new Uint8Array(32)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 0, true)
    view.setUint32(4, 0, true)
    view.setUint32(8, 0, true)
    view.setUint32(12, 1, true)
    view.setUint16(16, 77, true)
    view.setInt16(18, -2, true)
    view.setInt16(20, 9, true)
    view.setUint16(22, 3, true)
    view.setUint16(24, 2, true)
    view.setUint16(26, 1, true)
    view.setUint16(28, 5, true)
    view.setUint16(30, 0x40ce, true)

    expect(decodeMapEvents(bytes, member(bytes.length))).toEqual({
      backgroundEvents: 0,
      backgrounds: [],
      objects: [],
      warps: [],
      coordinateEvents: [{ scriptId: 77, x: -2, z: 9, width: 3, height: 2, y: 1, expectedValue: 5, variableId: 0x40ce }],
    })
  })

  it('reads the fixed 32 by 32 terrain attribute grid', () => {
    const bytes = new Uint8Array(0x14 + 32 * 32 * 2)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 32 * 32 * 2, true)
    view.setUint16(16, 0x1234, true)
    view.setUint16(18, 0, true)
    view.setUint16(0x14, 0x8000, true)
    view.setUint16(bytes.length - 2, 0x1234, true)
    const archive = { archiveMembers: [member(bytes.length)] } as RomFile

    const terrain = decodeMapTerrain(bytes, archive, 0)
    expect(terrain).toMatchObject({ modelId: 0, width: 32, height: 32 })
    expect(terrain?.attributes[0]).toBe(0x8000)
    expect(terrain?.attributes[1023]).toBe(0x1234)
  })

  it('stitches field terrain across all cells occupied by the same map id', () => {
    const memberSize = 0x14 + 32 * 32 * 2
    const bytes = new Uint8Array(memberSize * 2)
    const view = new DataView(bytes.buffer)
    for (const offset of [0, memberSize]) {
      view.setUint32(offset, 32 * 32 * 2, true)
      view.setUint16(offset + 16, 0x1234, true)
      view.setUint16(offset + 18, 0, true)
    }
    view.setUint16(0x14, 0x1111, true)
    view.setUint16(memberSize + 0x14, 0x2222, true)
    view.setUint16(memberSize + 0x14 + ((31 * 32 + 31) * 2), 0x3333, true)
    const archive = { archiveMembers: [member(memberSize, 0, 0), member(memberSize, 1, memberSize)] } as RomFile
    const matrix = {
      matrixIndex: 0,
      name: 'field',
      width: 2,
      height: 1,
      headers: new Uint16Array([61, 61]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 1]),
    }

    const terrain = decodeFieldMapTerrain(bytes, archive, matrix, 61)
    expect(terrain).toMatchObject({ modelId: 0, width: 64, height: 32 })
    expect(terrain?.attributes[0]).toBe(0x1111)
    expect(terrain?.attributes[32]).toBe(0x2222)
    expect(terrain?.attributes[31 * 64 + 63]).toBe(0x3333)
  })

  it('applies the native matrix altitude to stitched BDHC collision planes', () => {
    const permissionSize = 32 * 32 * 2
    const bdhcSize = 0x10 + 16 + 12 + 4 + 8
    const bytes = new Uint8Array(0x14 + permissionSize + bdhcSize)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, permissionSize, true)
    view.setUint32(12, bdhcSize, true)
    view.setUint16(16, 0x1234, true)
    const bdhc = 0x14 + permissionSize
    bytes.set([0x42, 0x44, 0x48, 0x43], bdhc)
    view.setUint16(bdhc + 4, 2, true)
    view.setUint16(bdhc + 6, 1, true)
    view.setUint16(bdhc + 8, 1, true)
    view.setUint16(bdhc + 10, 1, true)
    const coordinates = bdhc + 0x10
    view.setInt16(coordinates + 2, -16, true)
    view.setInt16(coordinates + 6, -16, true)
    view.setInt16(coordinates + 8 + 2, 16, true)
    view.setInt16(coordinates + 8 + 6, 16, true)
    const slopes = coordinates + 16
    view.setInt32(slopes + 4, 4096, true)
    const plates = slopes + 12 + 4
    view.setUint16(plates, 0, true)
    view.setUint16(plates + 2, 1, true)
    view.setUint16(plates + 4, 0, true)
    view.setUint16(plates + 6, 0, true)
    const archive = { archiveMembers: [member(bytes.length)] } as RomFile
    const matrix = {
      matrixIndex: 0,
      name: 'raised-field',
      width: 1,
      height: 1,
      headers: new Uint16Array([61]),
      altitudes: new Uint8Array([5]),
      modelIds: new Uint16Array([0]),
    }

    expect(decodeFieldMapTerrain(bytes, archive, matrix, 61)?.collisionPlates).toMatchObject([
      { normalY: 1, distance: 40 },
    ])
  })
})
