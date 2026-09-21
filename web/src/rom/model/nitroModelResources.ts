import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NitroMaterialBinding, NitroNamedEntry, NitroTextureSet } from './internalTypes'
import { hasNitroMagic, readNitroDictionary } from './nitroResource'

export function readNitroNameList<T>(
  bytes: Uint8Array,
  view: DataView,
  memberOffset: number,
  listOffset: number,
  fileSize: number,
  elementReader: (elementOffset: number) => T,
): NitroNamedEntry<T>[] {
  return readNitroDictionary({ bytes, view, baseOffset: memberOffset, fileSize }, listOffset, elementReader)
}

function decodeNitroRgb15(color: number): [number, number, number] {
  return [
    (color & 0x1f) / 31,
    ((color >> 5) & 0x1f) / 31,
    ((color >> 10) & 0x1f) / 31,
  ]
}

export function readNitroMaterialBindings(
  bytes: Uint8Array,
  view: DataView,
  memberOffset: number,
  materialsOffset: number,
  fileSize: number,
): NitroMaterialBinding[] {
  if (materialsOffset + 8 > fileSize) return []
  const materials: NitroMaterialBinding[] = readNitroNameList(bytes, view, memberOffset, materialsOffset + 4, fileSize, (elementOffset) => readUint32(view, elementOffset))
    .map((entry) => {
      const material: NitroMaterialBinding = { name: entry.name }
      const materialOffset = materialsOffset + entry.value
      if (materialOffset + 16 <= fileSize) {
        const diffuseAmbient = readUint32(view, materialOffset + 4)
        const specularEmission = readUint32(view, materialOffset + 8)
        const polygonAttributes = readUint32(view, materialOffset + 12)
        const diffuse = decodeNitroRgb15(diffuseAmbient & 0x7fff)
        material.color = diffuse
        material.diffuseColor = diffuse
        material.setsVertexColor = (diffuseAmbient & 0x8000) !== 0
        material.ambientColor = decodeNitroRgb15((diffuseAmbient >>> 16) & 0x7fff)
        material.specularColor = decodeNitroRgb15(specularEmission & 0x7fff)
        material.emissionColor = decodeNitroRgb15((specularEmission >>> 16) & 0x7fff)
        material.alpha = ((polygonAttributes >>> 16) & 0x1f) / 31
        material.fogEnabled = (polygonAttributes & 0x8000) !== 0
      }
      if (materialOffset + 36 <= fileSize) {
        const textureWidth = readUint16(view, materialOffset + 32)
        const textureHeight = readUint16(view, materialOffset + 34)
        if (textureWidth > 0) material.textureWidth = textureWidth
        if (textureHeight > 0) material.textureHeight = textureHeight
      }
      return material
    })

  const applyPairings = (pairingOffset: number, property: 'textureName' | 'paletteName'): void => {
    const pairings = readNitroNameList(bytes, view, memberOffset, pairingOffset, fileSize, (elementOffset) => ({
      indicesOffset: materialsOffset + readUint16(view, elementOffset),
      count: view.getUint8(elementOffset + 2),
    }))
    for (const pairing of pairings) {
      if (pairing.value.indicesOffset + pairing.value.count > fileSize) continue
      for (let index = 0; index < pairing.value.count; index += 1) {
        const materialIndex = view.getUint8(pairing.value.indicesOffset + index)
        if (materials[materialIndex]) materials[materialIndex][property] = pairing.name
      }
    }
  }

  applyPairings(materialsOffset + readUint16(view, materialsOffset), 'textureName')
  applyPairings(materialsOffset + readUint16(view, materialsOffset + 2), 'paletteName')
  for (const material of materials) {
    if (material.textureName && !material.paletteName) material.paletteName = material.textureName
  }
  return materials
}

export function readNitroTextureSet(
  bytes: Uint8Array,
  view: DataView,
  memberOffset: number,
  textureSectionOffset: number,
  fileSize: number,
): NitroTextureSet | undefined {
  if (textureSectionOffset + 60 > fileSize || !hasNitroMagic(bytes, memberOffset + textureSectionOffset, 'TEX0')) return undefined
  const textureListOffset = textureSectionOffset + readUint16(view, textureSectionOffset + 14)
  const textureBlockOffset = textureSectionOffset + readUint32(view, textureSectionOffset + 20)
  const block1Length = readUint16(view, textureSectionOffset + 12) << 3
  const paletteListOffset = textureSectionOffset + readUint32(view, textureSectionOffset + 52)
  const paletteBlockOffset = textureSectionOffset + readUint32(view, textureSectionOffset + 56)
  const block4Length = readUint16(view, textureSectionOffset + 48) << 3
  if (
    textureListOffset >= fileSize
    || textureBlockOffset + block1Length > fileSize
    || paletteListOffset >= fileSize
    || paletteBlockOffset + block4Length > fileSize
  ) return undefined

  const block1Offset = memberOffset + textureBlockOffset
  const block4Offset = memberOffset + paletteBlockOffset
  const textures = readNitroNameList(bytes, view, memberOffset, textureListOffset, fileSize, (elementOffset) => {
    const imageParam = readUint32(view, elementOffset)
    return {
      width: 8 << ((imageParam >>> 20) & 7),
      height: 8 << ((imageParam >>> 23) & 7),
      format: (imageParam >>> 26) & 7,
      color0Transparent: (imageParam & (1 << 29)) !== 0,
      dataOffset: block1Offset + ((imageParam & 0xffff) << 3),
    }
  }).map(({ name, value }) => ({ name, ...value }))
  const palettes = readNitroNameList(bytes, view, memberOffset, paletteListOffset, fileSize, (elementOffset) => ({
    dataOffset: block4Offset + (readUint16(view, elementOffset) << 3),
  })).map(({ name, value }) => ({ name, ...value }))
  return { textures, palettes, block1Offset, block1Length, block4Offset, block4Length }
}
