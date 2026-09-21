import type { NitroGraphic } from '../../ndsTypes'
import { findMagic, hasMagic, readUint16, readUint32 } from '../../core/binaryReader'

export type NitroIndexedGraphic = {
  width: number
  height: number
  bitsPerPixel: 4 | 8
  tileCount: number
  tilesPerRow: number
  indices: Uint8Array
  palette: Uint16Array
  graphicsOffset: number
  paletteOffset: number
}

export function readNitroPalette(bytes: Uint8Array, offset: number): Uint16Array | undefined {
  if (!hasMagic(bytes, offset, 'RLCN') || offset + 0x28 > bytes.byteLength) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, bytes.byteLength - offset)
  const headerSize = readUint16(view, 12)
  const blockOffset = headerSize
  if (headerSize < 16 || !hasMagic(bytes, offset + blockOffset, 'TTLP')) return undefined
  const blockSize = readUint32(view, blockOffset + 4)
  const declaredPaletteSize = readUint32(view, blockOffset + 16)
  const colorOffset = readUint32(view, blockOffset + 20)
  const paletteStart = offset + blockOffset + 8 + colorOffset
  const availablePaletteSize = offset + blockOffset + blockSize - paletteStart
  // Certains NCLR officiels stockent 0x200 - taille dans ce champ. Nitro/GF
  // considère alors la taille du bloc TTLP comme autoritaire (cas des wepltt HGSS).
  const paletteSize = declaredPaletteSize === availablePaletteSize
    ? declaredPaletteSize
    : 0x200 - declaredPaletteSize === availablePaletteSize
      ? availablePaletteSize
      : declaredPaletteSize
  const colorCount = Math.floor(paletteSize / 2)
  const paletteEnd = paletteStart + colorCount * 2
  if (colorCount === 0 || blockSize < 0x18 || availablePaletteSize < 0 || paletteEnd > offset + blockOffset + blockSize || paletteEnd > bytes.byteLength) return undefined
  const palette = new Uint16Array(colorCount)
  const paletteView = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  for (let index = 0; index < colorCount; index += 1) {
    palette[index] = paletteView.getUint16(paletteStart + index * 2, true)
  }
  return palette
}

export function readNitroIndexedGraphic(bytes: Uint8Array, graphicsOffset: number, paletteOffset: number, forcedTilesPerRow?: number): NitroIndexedGraphic | undefined {
  if (!hasMagic(bytes, graphicsOffset, 'RGCN') || graphicsOffset + 0x30 > bytes.byteLength) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + graphicsOffset, bytes.byteLength - graphicsOffset)
  const headerSize = readUint16(view, 12)
  const blockOffset = headerSize
  if (headerSize < 16 || !hasMagic(bytes, graphicsOffset + blockOffset, 'RAHC')) return undefined
  const tilesY = readUint16(view, blockOffset + 8)
  const tilesX = readUint16(view, blockOffset + 10)
  const depth = readUint32(view, blockOffset + 12)
  const pixelDataSize = readUint32(view, blockOffset + 24)
  const pixelDataOffset = graphicsOffset + blockOffset + 32
  const bitsPerPixel = depth === 3 ? 4 : depth === 4 ? 8 : undefined
  if (!bitsPerPixel) return undefined
  const bytesPerTile = bitsPerPixel === 4 ? 32 : 64
  if (pixelDataSize === 0 || pixelDataSize % bytesPerTile !== 0 || pixelDataOffset + pixelDataSize > bytes.byteLength) return undefined

  const palette = readNitroPalette(bytes, paletteOffset)
  // Certaines palettes 8 bpp officielles HGSS omettent les entrées hautes
  // inutilisées (p. ex. 240 couleurs pour le panneau Carte). Nitro ne
  // requiert pas 256 couleurs lorsque les indices de la ressource restent
  // dans la plage effectivement chargée.
  if (!palette || palette.length < (bitsPerPixel === 4 ? 16 : 1)) return undefined
  const tileCount = pixelDataSize / bytesPerTile
  if (forcedTilesPerRow !== undefined && (!Number.isInteger(forcedTilesPerRow) || forcedTilesPerRow <= 0)) return undefined
  const tilesPerRow = forcedTilesPerRow ?? (tilesX === 0xffff ? Math.ceil(Math.sqrt(tileCount)) : tilesX)
  const tileRows = forcedTilesPerRow !== undefined || tilesY === 0xffff ? Math.ceil(tileCount / tilesPerRow) : tilesY
  if (tilesPerRow === 0 || tileRows === 0 || tilesPerRow * tileRows < tileCount) return undefined

  const width = tilesPerRow * 8
  const height = tileRows * 8
  const indices = new Uint8Array(width * height)
  for (let tile = 0; tile < tileCount; tile += 1) {
    const tileX = (tile % tilesPerRow) * 8
    const tileY = Math.floor(tile / tilesPerRow) * 8
    for (let pixel = 0; pixel < 64; pixel += 1) {
      const packed = bytes[pixelDataOffset + tile * bytesPerTile + (bitsPerPixel === 4 ? Math.floor(pixel / 2) : pixel)]
      const colorIndex = bitsPerPixel === 4 ? (pixel % 2 === 0 ? packed & 0x0f : packed >> 4) : packed
      indices[(tileY + Math.floor(pixel / 8)) * width + tileX + (pixel % 8)] = colorIndex
    }
  }
  return { width, height, bitsPerPixel, tileCount, tilesPerRow, indices, palette, graphicsOffset, paletteOffset }
}

export function nitroColorToRgba(color: number, alpha: number, pixels: Uint8ClampedArray, destination: number): void {
  pixels[destination] = Math.round((color & 0x1f) * 255 / 31)
  pixels[destination + 1] = Math.round(((color >> 5) & 0x1f) * 255 / 31)
  pixels[destination + 2] = Math.round(((color >> 10) & 0x1f) * 255 / 31)
  pixels[destination + 3] = alpha
}

export function decodeNitroGraphic(bytes: Uint8Array, graphicsOffset: number, paletteOffset: number, color0Transparent = true): NitroGraphic | undefined {
  const indexed = readNitroIndexedGraphic(bytes, graphicsOffset, paletteOffset)
  if (!indexed) return undefined
  const pixels = new Uint8ClampedArray(indexed.width * indexed.height * 4)
  for (let index = 0; index < indexed.indices.length; index += 1) {
    const colorIndex = indexed.indices[index]
    const color = indexed.palette[colorIndex]
    if (color !== undefined) nitroColorToRgba(color, color0Transparent && colorIndex === 0 ? 0 : 255, pixels, index * 4)
  }
  return { width: indexed.width, height: indexed.height, pixels, graphicsOffset, paletteOffset, colorDepth: indexed.bitsPerPixel }
}

export function findGraphicPreview(bytes: Uint8Array): NitroGraphic | undefined {
  let graphicsOffset = findMagic(bytes, 'RGCN')
  while (graphicsOffset >= 0) {
    const paletteOffset = findMagic(bytes, 'RLCN', graphicsOffset + 16, Math.min(bytes.byteLength, graphicsOffset + 0x10000))
    if (paletteOffset >= 0) {
      const graphic = decodeNitroGraphic(bytes, graphicsOffset, paletteOffset)
      if (graphic) return graphic
    }
    graphicsOffset = findMagic(bytes, 'RGCN', graphicsOffset + 4)
  }
  return undefined
}

function hasCompleteGraphicPayload(payload: Uint8Array): boolean {
  if (!hasMagic(payload, 0, 'RGCN') || payload.byteLength < 0x30) return false
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const blockOffset = readUint16(view, 12)
  if (blockOffset < 16 || blockOffset + 32 > payload.byteLength || !hasMagic(payload, blockOffset, 'RAHC')) return false
  return blockOffset + 32 + readUint32(view, blockOffset + 24) <= payload.byteLength
}

export function readNitroIndexedGraphicPayload(graphicPayload: Uint8Array, palettePayload: Uint8Array, forcedTilesPerRow?: number): NitroIndexedGraphic | undefined {
  if (!hasCompleteGraphicPayload(graphicPayload) || !readNitroPalette(palettePayload, 0)) return undefined
  const combined = new Uint8Array(graphicPayload.byteLength + palettePayload.byteLength)
  combined.set(graphicPayload, 0)
  combined.set(palettePayload, graphicPayload.byteLength)
  return readNitroIndexedGraphic(combined, 0, graphicPayload.byteLength, forcedTilesPerRow)
}

export function decodeNitroGraphicPayload(graphicPayload: Uint8Array, palettePayload: Uint8Array, color0Transparent = true, paletteBank = 0, forcedTilesPerRow?: number): NitroGraphic | undefined {
  const indexed = readNitroIndexedGraphicPayload(graphicPayload, palettePayload, forcedTilesPerRow)
  if (!indexed) return undefined
  if (!Number.isInteger(paletteBank) || paletteBank < 0 || (indexed.bitsPerPixel === 4 && (paletteBank + 1) * 16 > indexed.palette.length)) return undefined
  const pixels = new Uint8ClampedArray(indexed.width * indexed.height * 4)
  for (let index = 0; index < indexed.indices.length; index += 1) {
    const colorIndex = indexed.indices[index]
    const paletteIndex = indexed.bitsPerPixel === 4 ? paletteBank * 16 + colorIndex : colorIndex
    const color = indexed.palette[paletteIndex]
    if (color !== undefined) nitroColorToRgba(color, color0Transparent && colorIndex === 0 ? 0 : 255, pixels, index * 4)
  }
  return { width: indexed.width, height: indexed.height, pixels, graphicsOffset: 0, paletteOffset: graphicPayload.byteLength, colorDepth: indexed.bitsPerPixel }
}

export function decodeNitroTilemapGraphicPayload(graphicPayload: Uint8Array, palettePayload: Uint8Array, screenPayload: Uint8Array, color0Transparent = true, forcedPaletteBank?: number): NitroGraphic | undefined {
  if (!hasMagic(screenPayload, 0, 'RCSN') || screenPayload.byteLength < 0x24) return undefined
  const view = new DataView(screenPayload.buffer, screenPayload.byteOffset, screenPayload.byteLength)
  const blockOffset = readUint16(view, 12)
  if (blockOffset < 16 || !hasMagic(screenPayload, blockOffset, 'NRCS')) return undefined
  const blockSize = readUint32(view, blockOffset + 4)
  const width = readUint16(view, blockOffset + 8)
  const height = readUint16(view, blockOffset + 10)
  const dataSize = readUint32(view, blockOffset + 16)
  const mapOffset = blockOffset + 20
  if (width === 0 || height === 0 || width % 8 !== 0 || height % 8 !== 0 || blockOffset + blockSize > screenPayload.byteLength || mapOffset + dataSize > blockOffset + blockSize || dataSize < (width / 8) * (height / 8) * 2) return undefined

  const tileSheet = readNitroIndexedGraphicPayload(graphicPayload, palettePayload)
  if (!tileSheet) return undefined
  const output = new Uint8ClampedArray(width * height * 4)
  const tilesX = width / 8
  const tilesY = height / 8
  for (let tileY = 0; tileY < tilesY; tileY += 1) {
    for (let tileX = 0; tileX < tilesX; tileX += 1) {
      const entry = readUint16(view, mapOffset + (tileY * tilesX + tileX) * 2)
      const tileIndex = entry & 0x03ff
      if (tileIndex >= tileSheet.tileCount) continue
      const flipX = (entry & 0x0400) !== 0
      const flipY = (entry & 0x0800) !== 0
      const paletteBank = forcedPaletteBank ?? ((entry >> 12) & 0x0f)
      const sourceTileX = (tileIndex % Math.max(1, tileSheet.tilesPerRow)) * 8
      const sourceTileY = Math.floor(tileIndex / Math.max(1, tileSheet.tilesPerRow)) * 8
      for (let pixelY = 0; pixelY < 8; pixelY += 1) {
        for (let pixelX = 0; pixelX < 8; pixelX += 1) {
          const sampleX = sourceTileX + (flipX ? 7 - pixelX : pixelX)
          const sampleY = sourceTileY + (flipY ? 7 - pixelY : pixelY)
          const colorIndex = tileSheet.indices[sampleY * tileSheet.width + sampleX]
          const paletteIndex = tileSheet.bitsPerPixel === 4 ? paletteBank * 16 + colorIndex : colorIndex
          const color = tileSheet.palette[paletteIndex] ?? tileSheet.palette[colorIndex]
          if (color !== undefined) nitroColorToRgba(color, color0Transparent && colorIndex === 0 ? 0 : 255, output, ((tileY * 8 + pixelY) * width + tileX * 8 + pixelX) * 4)
        }
      }
    }
  }
  return { width, height, pixels: output, graphicsOffset: 0, paletteOffset: graphicPayload.byteLength, colorDepth: tileSheet.bitsPerPixel }
}
