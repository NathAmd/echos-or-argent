import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import {
  createFollowerTextureResolver,
  followerAnimationDataMemberIndex,
  followerAnimationFrameCount,
  getFollowerAnimationTextureNamesFromMember,
  selectFollowerPaletteName,
} from './followerTextureResources'

function createAnimationTable(
  thresholds: readonly number[] = [0, 20, 40, 60],
  textureIndexes: readonly number[] = [0, 1, 2, 3],
  paletteIndexes: readonly number[] = [0, 0, 0, 0],
): { bytes: Uint8Array, archive: RomFile } {
  const entryCount = thresholds.length
  const memberOffset = 8
  const memberSize = 4 + entryCount * 4
  const bytes = new Uint8Array(memberOffset + memberSize)
  const view = new DataView(bytes.buffer, memberOffset, memberSize)
  view.setUint32(0, entryCount, true)
  thresholds.forEach((threshold, index) => view.setUint16(4 + index * 2, threshold, true))
  const textureIndexesOffset = 4 + entryCount * 2
  textureIndexes.forEach((textureIndex, index) => view.setUint8(textureIndexesOffset + index, textureIndex))
  const paletteIndexesOffset = textureIndexesOffset + entryCount
  paletteIndexes.forEach((paletteIndex, index) => view.setUint8(paletteIndexesOffset + index, paletteIndex))

  const member: NarcMember = {
    index: followerAnimationDataMemberIndex,
    offset: memberOffset,
    size: memberSize,
    signature: '',
  }
  const archiveMembers: NarcMember[] = []
  archiveMembers[followerAnimationDataMemberIndex] = member
  return {
    bytes,
    archive: {
      id: 1,
      path: '/a/0/8/1',
      offset: memberOffset,
      size: memberSize,
      signature: 'NARC',
      archiveEntries: archiveMembers.length,
      archiveMembers,
    },
  }
}

describe('follower texture resources', () => {
  it('expands the native thresholds to twenty animation frames per direction', () => {
    const { bytes, archive } = createAnimationTable()
    const names = getFollowerAnimationTextureNamesFromMember(bytes, archive, ['north', 'south', 'west', 'east'])
    expect(Object.fromEntries(Object.entries(names).map(([direction, frames]) => [direction, {
      count: frames.length,
      names: [...new Set(frames)],
    }]))).toEqual({
      north: { count: followerAnimationFrameCount, names: ['north'] },
      south: { count: followerAnimationFrameCount, names: ['south'] },
      west: { count: followerAnimationFrameCount, names: ['west'] },
      east: { count: followerAnimationFrameCount, names: ['east'] },
    })
  })

  it('uses the normal palette when a shiny-specific palette is unavailable', () => {
    expect(selectFollowerPaletteName(['normal'], false)).toBe('normal')
    expect(selectFollowerPaletteName(['normal'], true)).toBe('normal')
    expect(selectFollowerPaletteName(['normal', 'shiny'], true)).toBe('shiny')
    expect(selectFollowerPaletteName([], true)).toBeUndefined()
  })

  it('preserves validation errors for malformed animation names and cadence', () => {
    const duplicateThreshold = createAnimationTable([0, 20, 20, 60])
    expect(() => getFollowerAnimationTextureNamesFromMember(
      duplicateThreshold.bytes,
      duplicateThreshold.archive,
      ['north', 'south', 'west', 'east'],
    )).toThrow('ne sont pas strictement croissants')

    const missingTexture = createAnimationTable([0, 20, 40, 60], [0, 1, 9, 3])
    expect(() => getFollowerAnimationTextureNamesFromMember(
      missingTexture.bytes,
      missingTexture.archive,
      ['north', 'south', 'west', 'east'],
    )).toThrow("L'image follower HGSS 40 reference la texture absente 9.")

    const secondaryPalette = createAnimationTable([0, 20, 40, 60], [0, 1, 2, 3], [1, 0, 0, 0])
    expect(() => getFollowerAnimationTextureNamesFromMember(
      secondaryPalette.bytes,
      secondaryPalette.archive,
      ['north', 'south', 'west', 'east'],
    )).toThrow("L'image follower HGSS 0 reference la palette inattendue 1.")
  })

  it('validates follower parameter indexes before reading archive members', () => {
    const { bytes, archive } = createAnimationTable()
    const resolve = createFollowerTextureResolver(bytes, archive, 3)!
    expect(() => resolve(-1)).toThrow("L'index graphique follower HGSS -1 est invalide.")
    expect(() => resolve(3)).toThrow("L'index graphique follower HGSS 3 est invalide.")
  })
})
