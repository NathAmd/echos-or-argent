import { decodeAscii, readUint16, readUint32 } from '../../core/binaryReader'
import type { MapCollisionPlatePreview, MapEventPreview, MapMatrixPreview, MapTerrainPreview, NarcMember, RomFile } from '../../ndsTypes'
import { getMapMatrixFootprint } from './mapFootprint'

export function decodeMapMatrix(bytes: Uint8Array, member: NarcMember): MapMatrixPreview | undefined {
  if (member.size < 5) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const width = bytes[member.offset]
  const height = bytes[member.offset + 1]
  const hasHeaders = bytes[member.offset + 2] !== 0
  const hasAltitudes = bytes[member.offset + 3] !== 0
  const nameLength = bytes[member.offset + 4]
  const cellCount = width * height
  if (width === 0 || height === 0 || cellCount > 799 || nameLength > 16) return undefined

  let cursor = 5
  if (cursor + nameLength > member.size) return undefined
  const name = decodeAscii(bytes.slice(member.offset + cursor, member.offset + cursor + nameLength))
  cursor += nameLength
  const headers = new Uint16Array(cellCount)
  if (hasHeaders) {
    if (cursor + cellCount * 2 > member.size) return undefined
    for (let index = 0; index < cellCount; index += 1) headers[index] = readUint16(view, cursor + index * 2)
    cursor += cellCount * 2
  }
  const altitudes = new Uint8Array(cellCount)
  if (hasAltitudes) {
    if (cursor + cellCount > member.size) return undefined
    altitudes.set(bytes.slice(member.offset + cursor, member.offset + cursor + cellCount))
    cursor += cellCount
  }
  if (cursor + cellCount * 2 > member.size) return undefined
  const modelIds = new Uint16Array(cellCount)
  for (let index = 0; index < cellCount; index += 1) modelIds[index] = readUint16(view, cursor + index * 2)
  return { matrixIndex: member.index, name, width, height, hasHeaders, headers, altitudes, modelIds }
}

export function findMapMatrixForHeader(bytes: Uint8Array, archive: RomFile | undefined, mapHeader: number): MapMatrixPreview | undefined {
  if (!archive) return undefined
  for (const member of archive.archiveMembers) {
    const matrix = decodeMapMatrix(bytes, member)
    if (matrix?.hasHeaders && matrix.headers.includes(mapHeader)) return matrix
  }
  return undefined
}

export function decodeMapEvents(bytes: Uint8Array, member: NarcMember): MapEventPreview | undefined {
  const backgroundRecordSize = 20
  const objectRecordSize = 32
  const warpRecordSize = 12
  const coordinateRecordSize = 16
  if (member.size < 16) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  let cursor = 0
  const readCount = (): number | undefined => {
    if (cursor + 4 > member.size) return undefined
    const count = readUint32(view, cursor)
    cursor += 4
    return count
  }
  const backgroundEvents = readCount()
  if (backgroundEvents === undefined || cursor + backgroundEvents * backgroundRecordSize > member.size) return undefined
  const backgrounds = Array.from({ length: backgroundEvents }, (_, index) => {
    const offset = cursor + index * backgroundRecordSize
    return {
      scriptId: readUint16(view, offset),
      type: readUint16(view, offset + 2),
      x: view.getInt32(offset + 4, true),
      z: view.getInt32(offset + 8, true),
      y: view.getInt32(offset + 12, true),
      direction: readUint16(view, offset + 16),
    }
  })
  cursor += backgroundEvents * backgroundRecordSize
  const objectCount = readCount()
  if (objectCount === undefined || cursor + objectCount * objectRecordSize > member.size) return undefined
  const objects = Array.from({ length: objectCount }, (_, index) => {
    const offset = cursor + index * objectRecordSize
    return {
      id: readUint16(view, offset),
      spriteId: readUint16(view, offset + 2),
      movement: readUint16(view, offset + 4),
      type: readUint16(view, offset + 6),
      eventFlag: readUint16(view, offset + 8),
      scriptId: readUint16(view, offset + 10),
      facingDirection: readUint16(view, offset + 12),
      parameters: [
        readUint16(view, offset + 14),
        readUint16(view, offset + 16),
        readUint16(view, offset + 18),
      ] as const,
      xRange: view.getInt16(offset + 20, true),
      zRange: view.getInt16(offset + 22, true),
      x: readUint16(view, offset + 24),
      z: readUint16(view, offset + 26),
    }
  })
  cursor += objectCount * objectRecordSize
  const warpCount = readCount()
  if (warpCount === undefined || cursor + warpCount * warpRecordSize > member.size) return undefined
  const warps = Array.from({ length: warpCount }, (_, index) => {
    const offset = cursor + index * warpRecordSize
    return {
      x: readUint16(view, offset),
      z: readUint16(view, offset + 2),
      header: readUint16(view, offset + 4),
      anchor: readUint16(view, offset + 6),
    }
  })
  cursor += warpCount * warpRecordSize
  const coordinateEventCount = readCount()
  if (coordinateEventCount === undefined || cursor + coordinateEventCount * coordinateRecordSize !== member.size) return undefined
  const coordinateEvents = Array.from({ length: coordinateEventCount }, (_, index) => {
    const offset = cursor + index * coordinateRecordSize
    return {
      scriptId: readUint16(view, offset),
      x: view.getInt16(offset + 2, true),
      z: view.getInt16(offset + 4, true),
      width: readUint16(view, offset + 6),
      height: readUint16(view, offset + 8),
      y: readUint16(view, offset + 10),
      expectedValue: readUint16(view, offset + 12),
      variableId: readUint16(view, offset + 14),
    }
  })
  return { backgroundEvents, backgrounds, objects, warps, coordinateEvents }
}

export function decodeMapTerrain(bytes: Uint8Array, archive: RomFile | undefined, modelId: number): MapTerrainPreview | undefined {
  const width = 32
  const height = 32
  const attributeCount = width * height
  const member = archive?.archiveMembers[modelId]
  if (!member || member.size < 0x14) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const permissionSize = readUint32(view, 0)
  const buildingSize = readUint32(view, 4)
  const modelSize = readUint32(view, 8)
  const bdhcSize = readUint32(view, 12)
  // HGSS place une section BGS variable juste apres les quatre tailles. Sa
  // longueur exclut son en-tete de quatre octets (signature 0x1234 + taille).
  // Les permissions ne commencent donc pas toujours a 0x14.
  if (readUint16(view, 16) !== 0x1234) return undefined
  const bgsDataLength = readUint16(view, 18)
  const terrainOffset = 0x14 + bgsDataLength
  const modelOffset = terrainOffset + permissionSize + buildingSize
  const bdhcOffset = modelOffset + modelSize
  if (
    permissionSize < attributeCount * 2
    || terrainOffset + permissionSize > member.size
    || bdhcOffset + bdhcSize > member.size
  ) return undefined
  const attributes = new Uint16Array(attributeCount)
  for (let index = 0; index < attributeCount; index += 1) attributes[index] = readUint16(view, terrainOffset + index * 2)
  const collisionPlates = decodeHgssBdhc(view, bdhcOffset, bdhcSize)
  return { modelId, width, height, attributes, collisionPlates }
}

export function decodeHgssBdhc(view: DataView, offset: number, size: number): MapCollisionPlatePreview[] | undefined {
  if (size < 0x10 || offset < 0 || offset + size > view.byteLength) return undefined
  const magic = String.fromCharCode(
    view.getUint8(offset), view.getUint8(offset + 1), view.getUint8(offset + 2), view.getUint8(offset + 3),
  )
  if (magic !== 'BDHC') return undefined
  const coordinateCount = readUint16(view, offset + 4)
  const slopeCount = readUint16(view, offset + 6)
  const heightCount = readUint16(view, offset + 8)
  const plateCount = readUint16(view, offset + 10)
  const stripeCount = readUint16(view, offset + 12)
  const plateIndexCount = readUint16(view, offset + 14)
  const coordinatesOffset = offset + 0x10
  const slopesOffset = coordinatesOffset + coordinateCount * 8
  const heightsOffset = slopesOffset + slopeCount * 12
  const platesOffset = heightsOffset + heightCount * 4
  const stripesOffset = platesOffset + plateCount * 8
  const indicesOffset = stripesOffset + stripeCount * 8
  if (indicesOffset + plateIndexCount * 2 > offset + size) return undefined

  const coordinates = Array.from({ length: coordinateCount }, (_, index) => ({
    x: view.getInt16(coordinatesOffset + index * 8 + 2, true),
    z: view.getInt16(coordinatesOffset + index * 8 + 6, true),
  }))
  const slopes = Array.from({ length: slopeCount }, (_, index) => ({
    x: view.getInt32(slopesOffset + index * 12, true) / 4096,
    y: view.getInt32(slopesOffset + index * 12 + 4, true) / 4096,
    z: view.getInt32(slopesOffset + index * 12 + 8, true) / 4096,
  }))
  const heights = Array.from({ length: heightCount }, (_, index) => {
    const entry = heightsOffset + index * 4
    return -view.getInt16(entry + 2, true) - view.getUint16(entry, true) / 0x10000
  })
  const plates: MapCollisionPlatePreview[] = []
  for (let index = 0; index < plateCount; index += 1) {
    const entry = platesOffset + index * 8
    const first = coordinates[readUint16(view, entry)]
    const second = coordinates[readUint16(view, entry + 2)]
    const normal = slopes[readUint16(view, entry + 4)]
    const distance = heights[readUint16(view, entry + 6)]
    if (!first || !second || !normal || distance === undefined) continue
    plates.push({
      minX: Math.min(first.x, second.x),
      maxX: Math.max(first.x, second.x),
      minZ: Math.min(first.z, second.z),
      maxZ: Math.max(first.z, second.z),
      normalX: normal.x,
      normalY: normal.y,
      normalZ: normal.z,
      distance,
    })
  }
  return plates.length > 0 ? plates : undefined
}

export function decodeFieldMapTerrain(bytes: Uint8Array, archive: RomFile | undefined, matrix: MapMatrixPreview, mapId: number): MapTerrainPreview | undefined {
  const footprint = getMapMatrixFootprint(mapId, matrix)
  if (!footprint) return undefined

  const cellWidth = 32
  const cellHeight = 32
  const width = footprint.widthCells * cellWidth
  const height = footprint.heightCells * cellHeight
  const attributes = new Uint16Array(width * height)
  const collisionPlates: MapCollisionPlatePreview[] = []
  const centeredLocalMatrix = matrix.hasHeaders === false
  attributes.fill(0x8000)
  let hasTerrain = false

  for (const cell of footprint.cells) {
    if (cell.modelId === 0xffff) continue
    const terrain = decodeMapTerrain(bytes, archive, cell.modelId)
    if (!terrain) continue
    hasTerrain = true
    const offsetX = (cell.x - footprint.minCellX) * cellWidth
    const offsetZ = (cell.z - footprint.minCellZ) * cellHeight
    const offsetY = cell.altitude
    for (let row = 0; row < terrain.height; row += 1) {
      const sourceOffset = row * terrain.width
      const targetOffset = (offsetZ + row) * width + offsetX
      attributes.set(terrain.attributes.subarray(sourceOffset, sourceOffset + terrain.width), targetOffset)
    }
    for (const plate of terrain.collisionPlates ?? []) {
      const translateX = offsetX + cellWidth / 2 - (centeredLocalMatrix ? width / 2 : 0)
      const translateZ = offsetZ + cellHeight / 2 - (centeredLocalMatrix ? height / 2 : 0)
      // Les BDHC locales sont ensuite converties en unités Nitro (x16), alors
      // que les BDHC monde restent en unités de case. L'altitude matrice est
      // déjà exprimée en unités Nitro.
      const collisionAltitude = centeredLocalMatrix ? offsetY / 16 : offsetY
      collisionPlates.push({
        ...plate,
        minX: plate.minX + translateX,
        maxX: plate.maxX + translateX,
        minZ: plate.minZ + translateZ,
        maxZ: plate.maxZ + translateZ,
        distance: plate.distance
          + plate.normalX * translateX
          + plate.normalY * collisionAltitude
          + plate.normalZ * translateZ,
      })
    }
  }

  if (!hasTerrain) return undefined
  return {
    modelId: footprint.cells[0].modelId,
    width,
    height,
    attributes,
    collisionPlates: collisionPlates.length > 0 ? collisionPlates : undefined,
  }
}
