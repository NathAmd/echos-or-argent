import { describe, expect, it } from 'vitest'
import type { NitroAnimationPreview, RomFile } from '../../ndsTypes'
import { decodeNitroAnimationPreview } from './nitroAnimationPreview'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  bytes.set([...magic].map((character) => character.charCodeAt(0)), offset)
}

function createPreviewFixture(
  kind: NitroAnimationPreview['kind'],
  frameCount: number,
  trackCount: number,
): { bytes: Uint8Array, archive: RomFile } {
  const memberOffset = 8
  const memberSize = 160
  const bytes = new Uint8Array(memberOffset + memberSize)
  const payload = bytes.subarray(memberOffset)
  const view = new DataView(bytes.buffer, bytes.byteOffset + memberOffset, memberSize)
  writeMagic(payload, 0, `${kind}0`)
  view.setUint32(8, memberSize, true)
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  view.setUint32(16, 20, true)
  writeMagic(payload, 20, 'TEST')

  const dictionaryOffset = 28
  const valueSize = 4
  const dictionarySize = 20 + valueSize + 16
  view.setUint8(dictionaryOffset + 1, 1)
  view.setUint16(dictionaryOffset + 2, dictionarySize, true)
  view.setUint16(dictionaryOffset + 16, valueSize, true)
  const valueOffset = dictionaryOffset + 20
  const animationOffset = 80
  view.setUint32(valueOffset, animationOffset - 20, true)
  writeMagic(payload, valueOffset + valueSize, 'native')
  view.setUint16(animationOffset + 4, frameCount, true)
  if (kind === 'BCA') view.setUint16(animationOffset + 6, trackCount, true)
  else view.setUint8(animationOffset + 6, trackCount)

  const member = { index: 0, offset: memberOffset, size: memberSize, signature: `${kind}0` }
  return {
    bytes,
    archive: {
      id: 1,
      path: `/fixture/${kind.toLowerCase()}.narc`,
      offset: memberOffset,
      size: memberSize,
      signature: 'NARC',
      archiveEntries: 1,
      archiveMembers: [member],
    },
  }
}

describe('Nitro animation preview', () => {
  it('reads the shared metadata and the 16-bit BCA track count', () => {
    const { bytes, archive } = createPreviewFixture('BCA', 48, 300)
    expect(decodeNitroAnimationPreview(bytes, archive, 0, 'BCA')).toEqual({
      kind: 'BCA',
      sourcePath: '/fixture/bca.narc',
      sourceMemberIndex: 0,
      name: 'native',
      frameCount: 48,
      trackCount: 300,
    })
  })

  it('reads the byte-sized track count used by material and pattern resources', () => {
    const { bytes, archive } = createPreviewFixture('BTP', 8, 2)
    expect(decodeNitroAnimationPreview(bytes, archive, 0, 'BTP')).toMatchObject({
      kind: 'BTP',
      frameCount: 8,
      trackCount: 2,
    })
  })

  it('rejects the wrong kind and invalid frame counts', () => {
    const { bytes, archive } = createPreviewFixture('BTA', 0, 1)
    expect(decodeNitroAnimationPreview(bytes, archive, 0, 'BMA')).toBeUndefined()
    expect(decodeNitroAnimationPreview(bytes, archive, 0, 'BTA')).toBeUndefined()
    new DataView(bytes.buffer, bytes.byteOffset + archive.archiveMembers[0]!.offset).setUint16(84, 4097, true)
    expect(decodeNitroAnimationPreview(bytes, archive, 0, 'BTA')).toBeUndefined()
  })
})
