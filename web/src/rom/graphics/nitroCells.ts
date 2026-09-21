import type { NitroGraphic } from '../../ndsTypes'
import { hasMagic, readUint16, readUint32 } from '../../core/binaryReader'
import { nitroColorToRgba, readNitroIndexedGraphicPayload, type NitroIndexedGraphic } from './nitro2d'

export type NitroCellOam = {
  x: number
  y: number
  widthTiles: number
  heightTiles: number
  tileIndex: number
  paletteBank: number
  flipX: boolean
  flipY: boolean
}

export type NitroCell = {
  minX: number
  minY: number
  maxX: number
  maxY: number
  width: number
  height: number
  mappingType: number
  oams: NitroCellOam[]
}

function signExtend(value: number, bits: number): number {
  const sign = 1 << (bits - 1)
  return (value & sign) !== 0 ? value - (1 << bits) : value
}

function getOamTileDimensions(shape: number, size: number): { widthTiles: number, heightTiles: number } | undefined {
  if (size < 0 || size > 3) return undefined
  if (shape === 0) {
    const dimension = 1 << size
    return { widthTiles: dimension, heightTiles: dimension }
  }
  if (shape === 1) return [{ widthTiles: 2, heightTiles: 1 }, { widthTiles: 4, heightTiles: 1 }, { widthTiles: 4, heightTiles: 2 }, { widthTiles: 8, heightTiles: 4 }][size]
  if (shape === 2) return [{ widthTiles: 1, heightTiles: 2 }, { widthTiles: 1, heightTiles: 4 }, { widthTiles: 2, heightTiles: 4 }, { widthTiles: 4, heightTiles: 8 }][size]
  return undefined
}

export function readNitroCells(payload: Uint8Array): NitroCell[] | undefined {
  if (!hasMagic(payload, 0, 'RECN') || payload.byteLength < 0x20) return undefined
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const headerSize = readUint16(view, 12)
  const blockCount = readUint16(view, 14)
  if (headerSize < 16 || headerSize >= payload.byteLength || blockCount <= 0) return undefined
  let cursor = headerSize
  for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
    if (cursor + 8 > payload.byteLength) return undefined
    const blockSize = readUint32(view, cursor + 4)
    if (blockSize < 0x20 || cursor + blockSize > payload.byteLength) return undefined
    if (!hasMagic(payload, cursor, 'KBEC')) {
      cursor += blockSize
      continue
    }
    const cellCount = readUint16(view, cursor + 0x08)
    const extended = payload[cursor + 0x0a] === 1
    const mappingType = payload[cursor + 0x10]
    const cellSize = extended ? 0x10 : 0x08
    const descriptorOffset = cursor + 0x20
    const oamBaseOffset = descriptorOffset + cellCount * cellSize
    if (cellCount === 0 || oamBaseOffset > cursor + blockSize) return undefined
    const cells: NitroCell[] = []
    let sequentialOamOffset = oamBaseOffset
    for (let cellIndex = 0; cellIndex < cellCount; cellIndex += 1) {
      const descriptor = descriptorOffset + cellIndex * cellSize
      if (descriptor + cellSize > cursor + blockSize) return undefined
      const oamCount = readUint16(view, descriptor)
      const cellAttributes = readUint16(view, descriptor + 2)
      const declaredOamStart = oamBaseOffset + readUint32(view, descriptor + 4)
      const oamStart = declaredOamStart + oamCount * 6 <= cursor + blockSize ? declaredOamStart : sequentialOamOffset
      if (oamStart + oamCount * 6 > cursor + blockSize) return undefined
      sequentialOamOffset = oamStart + oamCount * 6
      const oams: NitroCellOam[] = []
      let minX = Infinity
      let minY = Infinity
      let maxX = -Infinity
      let maxY = -Infinity
      for (let oamIndex = 0; oamIndex < oamCount; oamIndex += 1) {
        const oamOffset = oamStart + oamIndex * 6
        const attr0 = readUint16(view, oamOffset)
        const attr1 = readUint16(view, oamOffset + 2)
        const attr2 = readUint16(view, oamOffset + 4)
        const dimensions = getOamTileDimensions((attr0 >> 14) & 0x03, (attr1 >> 14) & 0x03)
        if (!dimensions) continue
        const x = signExtend(attr1 & 0x01ff, 9)
        const y = signExtend(attr0 & 0x00ff, 8)
        const rotationEnabled = (attr0 & 0x0100) !== 0
        oams.push({ x, y, ...dimensions, tileIndex: attr2 & 0x03ff, paletteBank: (attr2 >> 12) & 0x0f, flipX: !rotationEnabled && (attr1 & 0x1000) !== 0, flipY: !rotationEnabled && (attr1 & 0x2000) !== 0 })
        minX = Math.min(minX, x)
        minY = Math.min(minY, y)
        maxX = Math.max(maxX, x + dimensions.widthTiles * 8 - 1)
        maxY = Math.max(maxY, y + dimensions.heightTiles * 8 - 1)
      }
      if (extended && (cellAttributes & 0x0800) !== 0) {
        maxX = view.getInt16(descriptor + 8, true)
        maxY = view.getInt16(descriptor + 10, true)
        minX = view.getInt16(descriptor + 12, true)
        minY = view.getInt16(descriptor + 14, true)
      }
      // Une cellule vide est un frame NANR valide (effet momentanément caché).
      // Elle doit rester dans le tableau pour ne pas décaler tous les indices suivants.
      if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(maxX) || !Number.isFinite(maxY)) {
        minX = minY = maxX = maxY = 0
      }
      cells.push({ minX, minY, maxX, maxY, width: Math.max(1, maxX - minX + 1), height: Math.max(1, maxY - minY + 1), mappingType, oams })
    }
    return cells
  }
  return undefined
}

function sampleIndexedTile(graphic: NitroIndexedGraphic, tileIndex: number, pixelX: number, pixelY: number): number | undefined {
  if (tileIndex < 0 || tileIndex >= graphic.tileCount || pixelX < 0 || pixelX >= 8 || pixelY < 0 || pixelY >= 8) return undefined
  const sourceX = (tileIndex % graphic.tilesPerRow) * 8 + pixelX
  const sourceY = Math.floor(tileIndex / graphic.tilesPerRow) * 8 + pixelY
  if (sourceX >= graphic.width || sourceY >= graphic.height) return undefined
  return graphic.indices[sourceY * graphic.width + sourceX]
}

export function decodeNitroCellGraphicPayload(graphicPayload: Uint8Array, palettePayload: Uint8Array, cellPayload: Uint8Array, frameIndex = 0, color0Transparent = true): NitroGraphic | undefined {
  const indexed = readNitroIndexedGraphicPayload(graphicPayload, palettePayload)
  const cell = readNitroCells(cellPayload)?.[frameIndex]
  if (!indexed || !cell) return undefined
  const output = new Uint8ClampedArray(cell.width * cell.height * 4)
  const bytesPerTile = indexed.bitsPerPixel === 4 ? 32 : 64
  const mappingByteFactor = [32, 64, 128, 256][cell.mappingType] ?? 32
  const colorDepthFactor = indexed.bitsPerPixel === 8 ? 2 : 1
  for (const oam of cell.oams) {
    const oamWidth = oam.widthTiles * 8
    const oamHeight = oam.heightTiles * 8
    const tileBase = Math.floor((oam.tileIndex * mappingByteFactor * colorDepthFactor) / bytesPerTile)
    for (let destinationY = 0; destinationY < oamHeight; destinationY += 1) {
      const localY = oam.flipY ? oamHeight - 1 - destinationY : destinationY
      const targetY = oam.y - cell.minY + destinationY
      if (targetY < 0 || targetY >= cell.height) continue
      for (let destinationX = 0; destinationX < oamWidth; destinationX += 1) {
        const localX = oam.flipX ? oamWidth - 1 - destinationX : destinationX
        const targetX = oam.x - cell.minX + destinationX
        if (targetX < 0 || targetX >= cell.width) continue
        const sourceTile = tileBase + Math.floor(localY / 8) * oam.widthTiles + Math.floor(localX / 8)
        const colorIndex = sampleIndexedTile(indexed, sourceTile, localX % 8, localY % 8)
        if (colorIndex === undefined || (color0Transparent && colorIndex === 0)) continue
        const paletteIndex = indexed.bitsPerPixel === 4 ? oam.paletteBank * 16 + colorIndex : colorIndex
        const color = indexed.palette[paletteIndex] ?? indexed.palette[colorIndex]
        if (color !== undefined) nitroColorToRgba(color, 255, output, (targetY * cell.width + targetX) * 4)
      }
    }
  }
  return { width: cell.width, height: cell.height, pixels: output, graphicsOffset: 0, paletteOffset: graphicPayload.byteLength, colorDepth: indexed.bitsPerPixel }
}
