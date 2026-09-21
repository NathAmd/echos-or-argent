import { describe, expect, it } from 'vitest'
import type { RomFile } from '../../ndsTypes'
import {
  decodeHgssSafariUiAssets,
  HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH,
  HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH,
} from './safariUiAssets'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  for (let index = 0; index < magic.length; index += 1) bytes[offset + index] = magic.charCodeAt(index)
}

function createPalette(): Uint8Array {
  const bytes = new Uint8Array(72)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RLCN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'TTLP')
  view.setUint32(20, 56, true)
  view.setUint32(32, 32, true)
  view.setUint32(36, 16, true)
  view.setUint16(42, 0x001f, true)
  return bytes
}

function createCharacter(): Uint8Array {
  const bytes = new Uint8Array(80)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RGCN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'RAHC')
  view.setUint32(20, 64, true)
  view.setUint16(24, 1, true)
  view.setUint16(26, 1, true)
  view.setUint32(28, 3, true)
  view.setUint32(40, 32, true)
  bytes[48] = 0x10
  return bytes
}

function createScreen(): Uint8Array {
  const bytes = new Uint8Array(38)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RCSN')
  view.setUint16(12, 16, true)
  writeMagic(bytes, 16, 'NRCS')
  view.setUint32(20, 22, true)
  view.setUint16(24, 8, true)
  view.setUint16(26, 8, true)
  view.setUint32(32, 2, true)
  view.setUint16(36, 0, true)
  return bytes
}

function createCell(): Uint8Array {
  const bytes = new Uint8Array(62)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RECN')
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  writeMagic(bytes, 16, 'KBEC')
  view.setUint32(20, 46, true)
  view.setUint16(24, 1, true)
  view.setUint16(48, 1, true)
  view.setUint32(52, 0, true)
  return bytes
}

function createAnimation(cellIndex = 0): Uint8Array {
  const bytes = new Uint8Array(88)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RNAN')
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  writeMagic(bytes, 16, 'KNBA')
  view.setUint32(20, 72, true)
  view.setUint16(24, 1, true)
  view.setUint16(26, 1, true)
  view.setUint32(28, 24, true)
  view.setUint32(32, 40, true)
  view.setUint32(36, 48, true)
  view.setUint16(48, 1, true)
  view.setUint16(50, 0, true)
  view.setUint16(52, 0, true)
  view.setUint16(54, 0, true)
  view.setUint32(56, 1, true)
  view.setUint32(60, 0, true)
  view.setUint32(64, 0, true)
  view.setUint16(68, 3, true)
  view.setUint16(72, cellIndex, true)
  return bytes
}

function createCustomizerPayloads(): Uint8Array[] {
  return [
    createPalette(), createCharacter(), createScreen(), createScreen(), createScreen(),
    createPalette(), createCharacter(), createScreen(), createScreen(), createScreen(), createScreen(),
    createPalette(), createCharacter(), createCell(), createAnimation(),
    createPalette(), createCell(), createAnimation(),
    ...Array.from({ length: 12 }, createCharacter),
  ]
}

function createDecoratorPayloads(): Uint8Array[] {
  return [
    createPalette(), createCharacter(), createScreen(), createScreen(),
    createPalette(), createCharacter(), createScreen(), createScreen(), createScreen(),
    createPalette(), createCharacter(), createCell(), createAnimation(),
  ]
}

function appendArchive(path: string, payloads: readonly Uint8Array[], startOffset: number): { archive: RomFile, endOffset: number } {
  let offset = startOffset
  const archiveMembers = payloads.map((payload, index) => {
    const member = {
      index,
      offset,
      size: payload.byteLength,
      signature: String.fromCharCode(...payload.subarray(0, 4)),
    }
    offset += payload.byteLength
    return member
  })
  return {
    archive: {
      id: startOffset,
      path,
      offset: startOffset,
      size: offset - startOffset,
      signature: 'N A R C',
      archiveEntries: payloads.length,
      archiveMembers,
    },
    endOffset: offset,
  }
}

function createFixture(): { rom: Uint8Array, files: RomFile[] } {
  const customizerPayloads = createCustomizerPayloads()
  const decoratorPayloads = createDecoratorPayloads()
  const customizer = appendArchive(HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH, customizerPayloads, 0)
  const decorator = appendArchive(HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH, decoratorPayloads, customizer.endOffset)
  const rom = new Uint8Array(decorator.endOffset)
  customizerPayloads.forEach((payload, index) => rom.set(payload, customizer.archive.archiveMembers[index]!.offset))
  decoratorPayloads.forEach((payload, index) => rom.set(payload, decorator.archive.archiveMembers[index]!.offset))
  return { rom, files: [customizer.archive, decorator.archive] }
}

describe('HGSS Safari UI assets', () => {
  it('decodes the two native background groups and shared customizer object resources', () => {
    const { rom, files } = createFixture()
    const assets = decodeHgssSafariUiAssets(rom, files)

    expect(assets.customizer.backgroundGroups.map((group) => ({
      character: group.characterMemberId,
      palette: group.paletteMemberId,
      screens: group.layers.map(({ screenMemberId }) => screenMemberId),
    }))).toEqual([
      { character: 1, palette: 0, screens: [2, 3, 4] },
      { character: 6, palette: 5, screens: [7, 8, 9, 10] },
    ])
    expect(assets.customizer.backgroundGroups[0]!.layers[0]!.graphic).toMatchObject({ width: 8, height: 8, colorDepth: 4 })
    expect(assets.customizer.objectSprites).toMatchObject({
      characterMemberId: 12,
      paletteMemberId: 11,
      cellMemberId: 13,
      animationMemberId: 14,
    })
    expect(assets.customizer.objectSprites.cells).toHaveLength(1)
    expect(assets.customizer.objectSprites.frames[0]).toMatchObject({ width: 8, height: 8 })
    expect(assets.customizer.objectSprites.animation.sequences[0]!.frames[0]).toMatchObject({ cellIndex: 0, durationFrames: 3 })
  })

  it('maps area IDs 0..11 exactly to customizer character members 18..29', () => {
    const { rom, files } = createFixture()
    const previews = decodeHgssSafariUiAssets(rom, files).customizer.areaPreviews

    expect(previews.map(({ areaId, characterMemberId }) => ({ areaId, characterMemberId }))).toEqual(
      Array.from({ length: 12 }, (_, areaId) => ({ areaId, characterMemberId: areaId + 18 })),
    )
    expect(previews.every(({ paletteMemberId, cellMemberId, animationMemberId }) => (
      paletteMemberId === 15 && cellMemberId === 16 && animationMemberId === 17
    ))).toBe(true)
  })

  it('decodes the decorator background and animated object resource groups', () => {
    const { rom, files } = createFixture()
    const decorator = decodeHgssSafariUiAssets(rom, files).decorator

    expect(decorator.backgroundGroups.map((group) => ({
      character: group.characterMemberId,
      palette: group.paletteMemberId,
      screens: group.layers.map(({ screenMemberId }) => screenMemberId),
    }))).toEqual([
      { character: 1, palette: 0, screens: [2, 3] },
      { character: 5, palette: 4, screens: [6, 7, 8] },
    ])
    expect(decorator.objectSprites).toMatchObject({
      characterMemberId: 10,
      paletteMemberId: 9,
      cellMemberId: 11,
      animationMemberId: 12,
    })
    expect(decorator.objectSprites.frames).toHaveLength(1)
  })

  it('rejects missing, incomplete, non-contiguous and invalid Nitro resources', () => {
    const { rom, files } = createFixture()
    expect(() => decodeHgssSafariUiAssets(rom, [])).toThrow(HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH)
    expect(() => decodeHgssSafariUiAssets(rom, [{ ...files[0]!, archiveMembers: files[0]!.archiveMembers.slice(0, 29) }, files[1]!])).toThrow('29 membres')

    const nonContiguous = files[0]!.archiveMembers.map((member) => ({ ...member }))
    nonContiguous[4]!.index = 5
    expect(() => decodeHgssSafariUiAssets(rom, [{ ...files[0]!, archiveMembers: nonContiguous }, files[1]!])).toThrow('contigue')

    const invalidPaletteRom = rom.slice()
    invalidPaletteRom.fill(0, files[0]!.archiveMembers[0]!.offset, files[0]!.archiveMembers[0]!.offset + 4)
    expect(() => decodeHgssSafariUiAssets(invalidPaletteRom, files)).toThrow('palette')

    const invalidAnimationRom = rom.slice()
    const animationOffset = files[0]!.archiveMembers[14]!.offset
    new DataView(invalidAnimationRom.buffer).setUint16(animationOffset + 72, 4, true)
    expect(() => decodeHgssSafariUiAssets(invalidAnimationRom, files)).toThrow('cellule absente 4')
  })
})
