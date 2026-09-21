import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import { decodeNitroModel, decodeNitroModelMember } from './nitroModelDecoder'
import { nitroTranslationMatrix } from './nitroMatrix'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  bytes.set([...magic].map((character) => character.charCodeAt(0)), offset)
}

function packedVertex(x: number, y: number, z: number): number {
  return ((Math.round(x * 64) & 0x3ff)
    | ((Math.round(y * 64) & 0x3ff) << 10)
    | ((Math.round(z * 64) & 0x3ff) << 20)) >>> 0
}

function createModelFixture(): { bytes: Uint8Array, member: NarcMember, archive: RomFile } {
  const memberOffset = 16
  const memberSize = 512
  const bytes = new Uint8Array(memberOffset + memberSize)
  const payload = bytes.subarray(memberOffset)
  const view = new DataView(bytes.buffer, bytes.byteOffset + memberOffset, memberSize)

  writeMagic(payload, 0, 'BMD0')
  view.setUint32(8, memberSize, true)
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  view.setUint32(16, 32, true)

  const modelSection = 32
  writeMagic(payload, modelSection, 'MDL0')
  const modelInfo = modelSection + 8
  view.setUint8(modelInfo + 1, 1)
  view.setUint32(modelInfo + 20, 64, true)

  const model = modelSection + 64
  view.setUint32(model + 4, 100, true)
  view.setUint32(model + 8, 80, true)
  view.setUint32(model + 12, 112, true)
  view.setUint8(model + 25, 1)
  view.setInt32(model + 28, 4096, true)
  view.setInt32(model + 32, 4096, true)
  view.setUint16(model + 36, 3, true)
  view.setUint16(model + 40, 1, true)

  const renderCommands = model + 100
  // Le billboard BB se trouve entre le nœud et sa shape dans les modèles
  // d'Éclate-Roc. Son octet de nœud doit être consommé avant SHP.
  payload.set([0x06, 0, 0, 0, 0x07, 0, 0x05, 0, 0x01], renderCommands)

  const piecesInfo = model + 112
  view.setUint8(piecesInfo + 1, 1)
  view.setUint32(piecesInfo + 20, 40, true)
  const piece = piecesInfo + 40
  view.setUint32(piece + 8, 16, true)
  view.setUint32(piece + 12, 24, true)

  const displayList = piece + 16
  view.setUint32(displayList, 0x24242440, true)
  view.setUint32(displayList + 4, 0, true)
  view.setUint32(displayList + 8, packedVertex(0, 0, 0), true)
  view.setUint32(displayList + 12, packedVertex(1, 0, 0), true)
  view.setUint32(displayList + 16, packedVertex(0, 1, 0), true)
  view.setUint32(displayList + 20, 0x00000041, true)

  const member: NarcMember = { index: 0, offset: memberOffset, size: memberSize, signature: 'BMD0' }
  const archive: RomFile = {
    id: 1,
    path: '/fixture/model.narc',
    offset: memberOffset,
    size: memberSize,
    signature: 'NARC',
    archiveEntries: 1,
    archiveMembers: [member],
  }
  return { bytes, member, archive }
}

describe('Nitro model decoder', () => {
  it('decodes a BMD member through both positional entry points', () => {
    const { bytes, member, archive } = createModelFixture()
    const direct = decodeNitroModelMember(bytes, member, 7)
    const archived = decodeNitroModel(bytes, archive, 0)

    expect(direct).toMatchObject({
      modelId: 7,
      vertexCount: 3,
      triangleCount: 1,
      quadCount: 0,
      materialCount: 0,
      pieceCount: 1,
    })
    expect([...direct!.positions!]).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0])
    expect([...archived!.positions!]).toEqual([...direct!.positions!])
  })

  it('keeps the positional bone-matrix override behavior', () => {
    const { bytes, member } = createModelFixture()
    const model = decodeNitroModelMember(bytes, member, 0, false, [nitroTranslationMatrix(2, 0, 0)], false)
    expect([...model!.positions!]).toEqual([2, 0, 0, 3, 0, 0, 2, 1, 0])
  })

  it('rejects missing, truncated, and non-BMD members', () => {
    const { bytes, member } = createModelFixture()
    expect(decodeNitroModelMember(bytes, undefined, 0)).toBeUndefined()
    expect(decodeNitroModelMember(bytes, { ...member, size: 16 }, 0)).toBeUndefined()
    bytes[member.offset] = 0
    expect(decodeNitroModelMember(bytes, member, 0)).toBeUndefined()
  })
})
