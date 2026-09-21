import type { NitroTexturePreview } from '../../ndsTypes'
import type { NitroMaterialBinding, NitroPaletteSource, NitroTextureSet, NitroTextureSource } from './internalTypes'

export function resolveNitroPaletteName(textureName: string, paletteName: string | undefined, palettes: Map<string, NitroPaletteSource>): string | undefined {
  const candidates = [paletteName, paletteName ? `${paletteName}_pl` : undefined, paletteName ? `${paletteName}0` : undefined, textureName, `${textureName}_pl`, `${textureName}0`]
    .filter((candidate): candidate is string => Boolean(candidate))
  for (const candidate of candidates) {
    if (palettes.has(candidate)) return candidate
  }
  return palettes.size === 1 ? palettes.keys().next().value : undefined
}

export function decodeNitroTexture(
  bytes: Uint8Array,
  textureSet: NitroTextureSet,
  texture: NitroTextureSource,
  palette: NitroPaletteSource | undefined,
): NitroTexturePreview | undefined {
  const textureBlockEnd = textureSet.block1Offset + textureSet.block1Length
  const paletteBlockEnd = textureSet.block4Offset + textureSet.block4Length
  if (textureBlockEnd > bytes.byteLength || texture.dataOffset < textureSet.block1Offset || texture.dataOffset >= textureBlockEnd) return undefined
  const pixelCount = texture.width * texture.height
  if (!Number.isSafeInteger(pixelCount) || pixelCount <= 0) return undefined
  const pixels = new Uint8ClampedArray(pixelCount * 4)
  const writePalettePixel = (destination: number, color: number, alpha: number): void => {
    pixels[destination] = Math.round((color & 0x1f) * 255 / 31)
    pixels[destination + 1] = Math.round(((color >> 5) & 0x1f) * 255 / 31)
    pixels[destination + 2] = Math.round(((color >> 10) & 0x1f) * 255 / 31)
    pixels[destination + 3] = alpha
  }
  const readPalette = (colorCount: number): Uint16Array | undefined => {
    if (!palette || paletteBlockEnd > bytes.byteLength || palette.dataOffset < textureSet.block4Offset || palette.dataOffset >= paletteBlockEnd) return undefined
    const finalColorCount = Math.min(colorCount, Math.floor((paletteBlockEnd - palette.dataOffset) / 2))
    if (finalColorCount <= 0 || palette.dataOffset + finalColorCount * 2 > bytes.byteLength) return undefined
    const colors = new Uint16Array(finalColorCount)
    const view = new DataView(bytes.buffer, bytes.byteOffset + palette.dataOffset, finalColorCount * 2)
    for (let index = 0; index < finalColorCount; index += 1) colors[index] = view.getUint16(index * 2, true)
    return colors
  }
  const decodeIndexed = (paletteSize: number, byteLength: number, colorIndexAt: (pixel: number) => number, alphaAt: (pixel: number, colorIndex: number) => number): boolean => {
    const colors = readPalette(paletteSize)
    if (!colors || texture.dataOffset + byteLength > textureBlockEnd) return false
    for (let pixel = 0; pixel < pixelCount; pixel += 1) {
      const colorIndex = colorIndexAt(pixel)
      writePalettePixel(pixel * 4, colors[Math.min(colorIndex, colors.length - 1)], alphaAt(pixel, colorIndex))
    }
    return true
  }

  let decoded = false
  if (texture.format === 1) {
    decoded = decodeIndexed(32, pixelCount, (pixel) => bytes[texture.dataOffset + pixel] & 0x1f, (pixel) => Math.round(((bytes[texture.dataOffset + pixel] >>> 5) & 0x07) * 255 / 7))
  } else if (texture.format === 2) {
    decoded = decodeIndexed(4, Math.ceil(pixelCount / 4), (pixel) => (bytes[texture.dataOffset + (pixel >> 2)] >> ((pixel & 3) * 2)) & 0x03, (_pixel, colorIndex) => colorIndex === 0 && texture.color0Transparent ? 0 : 255)
  } else if (texture.format === 3) {
    decoded = decodeIndexed(16, Math.ceil(pixelCount / 2), (pixel) => {
      const packed = bytes[texture.dataOffset + (pixel >> 1)]
      return (pixel & 1) === 0 ? packed & 0x0f : packed >> 4
    }, (_pixel, colorIndex) => colorIndex === 0 && texture.color0Transparent ? 0 : 255)
  } else if (texture.format === 4) {
    decoded = decodeIndexed(256, pixelCount, (pixel) => bytes[texture.dataOffset + pixel], (_pixel, colorIndex) => colorIndex === 0 && texture.color0Transparent ? 0 : 255)
  } else if (texture.format === 6) {
    decoded = decodeIndexed(8, pixelCount, (pixel) => bytes[texture.dataOffset + pixel] & 0x07, (pixel) => Math.round(((bytes[texture.dataOffset + pixel] >>> 3) & 0x1f) * 255 / 31))
  } else if (texture.format === 7) {
    const byteLength = pixelCount * 2
    if (texture.dataOffset + byteLength <= textureBlockEnd) {
      for (let pixel = 0; pixel < pixelCount; pixel += 1) {
        const offset = texture.dataOffset + pixel * 2
        const color = bytes[offset] | (bytes[offset + 1] << 8)
        writePalettePixel(pixel * 4, color & 0x7fff, (color & 0x8000) !== 0 ? 255 : 0)
      }
      decoded = true
    }
  }
  if (!decoded) return undefined
  return { id: `${texture.name}:${palette?.name ?? ''}`, name: texture.name, paletteName: palette?.name, width: texture.width, height: texture.height, pixels }
}

export function decodeNitroModelTextures(
  bytes: Uint8Array,
  textureSet: NitroTextureSet,
  materials: NitroMaterialBinding[],
  resolvedPalettes: Map<number, string | undefined>,
  includeUnboundTextures = false,
): NitroTexturePreview[] {
  const texturesByName = new Map(textureSet.textures.map((texture) => [texture.name, texture]))
  const palettesByName = new Map(textureSet.palettes.map((palette) => [palette.name, palette]))
  const decoded = new Map<string, NitroTexturePreview>()
  const decodedTextureNames = new Set<string>()
  materials.forEach((material, materialIndex) => {
    if (!material.textureName) return
    const texture = texturesByName.get(material.textureName)
    if (!texture) return
    const paletteName = resolvedPalettes.get(materialIndex)
    const preview = decodeNitroTexture(bytes, textureSet, texture, paletteName ? palettesByName.get(paletteName) : undefined)
    if (preview) {
      decoded.set(preview.id, preview)
      decodedTextureNames.add(texture.name)
    }
  })
  if (includeUnboundTextures) {
    for (const texture of textureSet.textures) {
      if (decodedTextureNames.has(texture.name)) continue
      const paletteName = resolveNitroPaletteName(texture.name, undefined, palettesByName)
      const preview = decodeNitroTexture(bytes, textureSet, texture, paletteName ? palettesByName.get(paletteName) : undefined)
      if (!preview) continue
      decoded.set(preview.id, preview)
      decodedTextureNames.add(texture.name)
    }
  }
  return [...decoded.values()]
}