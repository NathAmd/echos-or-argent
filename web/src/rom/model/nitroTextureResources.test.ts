import { describe, expect, it } from 'vitest'
import type { NarcMember } from '../../ndsTypes'
import { findNitroTextureSection, getNitroTextureResourceNamesFromMember } from './nitroTextureResources'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  bytes.set([...magic].map((character) => character.charCodeAt(0)), offset)
}

function fixture(): { bytes: Uint8Array, member: NarcMember } {
  const bytes = new Uint8Array(128)
  const member: NarcMember = { index: 0, offset: 8, size: 96, signature: 'BTX0' }
  const view = new DataView(bytes.buffer, member.offset, member.size)
  writeMagic(bytes, member.offset, 'BTX0')
  view.setUint32(8, member.size, true)
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  view.setUint32(16, 32, true)
  writeMagic(bytes, member.offset + 32, 'TEX0')
  return { bytes, member }
}

describe('Nitro texture resources', () => {
  it('finds a TEX0 section relative to an archive member', () => {
    const { bytes, member } = fixture()
    expect(findNitroTextureSection(bytes, member)?.textureSectionOffset).toBe(32)
  })

  it('rejects a container whose declared size escapes the member', () => {
    const { bytes, member } = fixture()
    new DataView(bytes.buffer, member.offset, member.size).setUint32(8, member.size + 1, true)
    expect(findNitroTextureSection(bytes, member)).toBeUndefined()
  })

  it('returns empty names for a missing archive member', () => {
    const { bytes, member } = fixture()
    expect(getNitroTextureResourceNamesFromMember(bytes, {
      id: 0,
      path: '/fixture',
      offset: member.offset,
      size: member.size,
      signature: 'NARC',
      archiveEntries: 1,
      archiveMembers: [member],
    }, 3)).toEqual({
      textureNames: [],
      paletteNames: [],
    })
  })
})
