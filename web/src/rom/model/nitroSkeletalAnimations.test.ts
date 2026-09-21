import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import { decodeNitroSkeletalAnimationFrame } from './nitroSkeletalAnimations'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  bytes.set([...magic].map((character) => character.charCodeAt(0)), offset)
}

function writeDictionary(bytes: Uint8Array, view: DataView, offset: number, name: string): number {
  const valueSize = 4
  const size = 20 + valueSize + 16
  view.setUint8(offset + 1, 1)
  view.setUint16(offset + 2, size, true)
  view.setUint16(offset + 16, valueSize, true)
  writeMagic(bytes, offset + 20 + valueSize, name)
  return offset + 20
}

function createSkeletalFixture(): { bytes: Uint8Array, archive: RomFile, member: NarcMember } {
  const memberOffset = 12
  const memberSize = 256
  const bytes = new Uint8Array(memberOffset + memberSize)
  const payload = bytes.subarray(memberOffset)
  const view = new DataView(bytes.buffer, bytes.byteOffset + memberOffset, memberSize)

  writeMagic(payload, 0, 'BCA0')
  view.setUint32(8, memberSize, true)
  view.setUint32(16, 20, true)
  writeMagic(payload, 20, 'JNT0')
  const dictionaryValue = writeDictionary(payload, view, 28, 'walk')
  const animationOffset = 80
  view.setUint32(dictionaryValue, animationOffset - 20, true)

  view.setUint16(animationOffset + 4, 4, true)
  view.setUint16(animationOffset + 6, 1, true)
  view.setUint16(animationOffset + 20, 40, true)
  const trackOffset = animationOffset + 40
  // Translation active: X sampled, Y/Z constants. Rotation and scale are identities.
  view.setUint16(trackOffset, 0x270, true)
  view.setUint8(trackOffset + 3, 2)
  view.setUint32(trackOffset + 4, 4 << 16, true)
  view.setUint32(trackOffset + 8, 100, true)
  view.setInt32(trackOffset + 12, 2 * 4096, true)
  view.setInt32(trackOffset + 16, -4096, true)
  for (let frame = 0; frame < 4; frame += 1) {
    view.setInt32(animationOffset + 100 + frame * 4, frame * 4096, true)
  }

  const member: NarcMember = { index: 0, offset: memberOffset, size: memberSize, signature: 'BCA0' }
  const archive: RomFile = {
    id: 1,
    path: '/fixture/skeletal.narc',
    offset: memberOffset,
    size: memberSize,
    signature: 'NARC',
    archiveEntries: 1,
    archiveMembers: [member],
  }
  return { bytes, archive, member }
}

describe('Nitro skeletal animations', () => {
  it('samples native BCA frames without accelerating the track', () => {
    const { bytes, archive } = createSkeletalFixture()
    const positions = [0, 1, 2, 3].map((frame) => {
      const matrix = decodeNitroSkeletalAnimationFrame(bytes, archive, 0, frame)?.[2]
      return matrix ? [matrix[12], matrix[13], matrix[14]] : undefined
    })

    expect(positions).toEqual([
      [0, 2, -1],
      [1, 2, -1],
      [2, 2, -1],
      [3, 2, -1],
    ])
  })

  it('loops positive and negative frame indices on the declared frame count', () => {
    const { bytes, archive } = createSkeletalFixture()
    expect(decodeNitroSkeletalAnimationFrame(bytes, archive, 0, 5)?.[2]?.[12]).toBe(1)
    expect(decodeNitroSkeletalAnimationFrame(bytes, archive, 0, -1)?.[2]?.[12]).toBe(3)
  })

  it('rejects missing, truncated, and invalid BCA resources', () => {
    const { bytes, archive, member } = createSkeletalFixture()
    expect(decodeNitroSkeletalAnimationFrame(bytes, undefined, 0, 0)).toBeUndefined()
    archive.archiveMembers[0] = { ...member, size: 16 }
    expect(decodeNitroSkeletalAnimationFrame(bytes, archive, 0, 0)).toBeUndefined()
    archive.archiveMembers[0] = member
    bytes[member.offset] = 0
    expect(decodeNitroSkeletalAnimationFrame(bytes, archive, 0, 0)).toBeUndefined()
  })
})
