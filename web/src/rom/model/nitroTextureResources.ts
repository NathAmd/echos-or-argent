import type { NarcMember, NitroTexturePreview, RomFile } from '../../ndsTypes'
import { readUint16, readUint32 } from '../../core/binaryReader'
import { readNitroTextureSet } from './nitroModelResources'
import { hasNitroMagic } from './nitroResource'
import { decodeNitroTexture, resolveNitroPaletteName } from './nitroTextureDecoder'

export type NitroTextureSection = { view: DataView, fileSize: number, textureSectionOffset: number }

export function findNitroTextureSection(bytes: Uint8Array, member: NarcMember): NitroTextureSection | undefined {
  if (member.size < 0x20 || (!hasNitroMagic(bytes, member.offset, 'BTX0') && !hasNitroMagic(bytes, member.offset, 'BMD0'))) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const fileSize = readUint32(view, 8)
  const headerSize = readUint16(view, 12)
  const sectionCount = readUint16(view, 14)
  if (fileSize > member.size || headerSize !== 16 || sectionCount === 0 || 16 + sectionCount * 4 > fileSize) return undefined
  for (let section = 0; section < sectionCount; section += 1) {
    const sectionOffset = readUint32(view, 16 + section * 4)
    if (sectionOffset + 8 <= fileSize && hasNitroMagic(bytes, member.offset + sectionOffset, 'TEX0')) {
      return { view, fileSize, textureSectionOffset: sectionOffset }
    }
  }
  return undefined
}

function decodeTexturePreview(
  bytes: Uint8Array,
  archive: RomFile,
  memberIndex: number,
  textureName: string | undefined,
  paletteHint: string | undefined,
  fallbackToFirst: boolean,
): NitroTexturePreview | undefined {
  const member = archive.archiveMembers[memberIndex]
  if (!member) return undefined
  const section = findNitroTextureSection(bytes, member)
  if (!section) return undefined
  const textureSet = readNitroTextureSet(bytes, section.view, member.offset, section.textureSectionOffset, section.fileSize)
  if (!textureSet) return undefined
  const texture = textureSet.textures.find((candidate) => candidate.name === textureName)
    ?? (fallbackToFirst ? textureSet.textures[0] : undefined)
  if (!texture) return undefined
  const palettesByName = new Map(textureSet.palettes.map((palette) => [palette.name, palette]))
  const paletteName = resolveNitroPaletteName(texture.name, paletteHint, palettesByName)
  const preview = decodeNitroTexture(bytes, textureSet, texture, paletteName ? palettesByName.get(paletteName) : undefined)
  return preview ? {
    ...preview,
    id: `${archive.path}#${memberIndex}:${preview.id}`,
    sourcePath: archive.path,
    sourceMemberIndex: memberIndex,
  } : undefined
}

export function decodeNitroTextureMember(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number,
  preferredTextureName: string,
): NitroTexturePreview | undefined {
  return archive ? decodeTexturePreview(bytes, archive, memberIndex, preferredTextureName, preferredTextureName.replace(/\.\d+$/, ''), true) : undefined
}

export function decodeNitroTextureByNameFromMember(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number,
  textureName: string,
  paletteHint?: string,
): NitroTexturePreview | undefined {
  return archive ? decodeTexturePreview(bytes, archive, memberIndex, textureName, paletteHint, false) : undefined
}

export function getNitroTextureResourceNamesFromMember(
  bytes: Uint8Array,
  archive: RomFile,
  memberIndex: number,
): { textureNames: string[], paletteNames: string[] } {
  const member = archive.archiveMembers[memberIndex]
  if (!member) return { textureNames: [], paletteNames: [] }
  const section = findNitroTextureSection(bytes, member)
  if (!section) return { textureNames: [], paletteNames: [] }
  const textureSet = readNitroTextureSet(bytes, section.view, member.offset, section.textureSectionOffset, section.fileSize)
  return {
    textureNames: textureSet?.textures.map(({ name }) => name) ?? [],
    paletteNames: textureSet?.palettes.map(({ name }) => name) ?? [],
  }
}

export function findNitroTextureByNameInArchive(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  textureName: string,
  paletteHint?: string,
): NitroTexturePreview | undefined {
  if (!archive) return undefined
  for (const member of archive.archiveMembers) {
    const texture = decodeNitroTextureByNameFromMember(bytes, archive, member.index, textureName, paletteHint)
    if (texture) return texture
  }
  return undefined
}

export function decodeNitroTextureMemberSet(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number | undefined,
): NitroTexturePreview[] {
  if (memberIndex === undefined || !archive) return []
  const member = archive.archiveMembers[memberIndex]
  if (!member) return []
  const section = findNitroTextureSection(bytes, member)
  if (!section) return []
  const textureSet = readNitroTextureSet(bytes, section.view, member.offset, section.textureSectionOffset, section.fileSize)
  if (!textureSet) return []
  const palettesByName = new Map(textureSet.palettes.map((palette) => [palette.name, palette]))
  return textureSet.textures.flatMap((texture) => {
    const paletteName = resolveNitroPaletteName(texture.name, undefined, palettesByName)
    const preview = decodeNitroTexture(bytes, textureSet, texture, paletteName ? palettesByName.get(paletteName) : undefined)
    return preview ? [{
      ...preview,
      id: `${archive.path}#${memberIndex}:${preview.id}`,
      sourcePath: archive.path,
      sourceMemberIndex: memberIndex,
    }] : []
  })
}
