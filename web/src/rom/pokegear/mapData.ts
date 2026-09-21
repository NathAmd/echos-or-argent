import { readArm9OverlayFromRom } from '../arm9Overlay'

export const hgssPokegearMapLocationCount = 100
export const hgssPokegearFlypointCount = 27

export type HgssPokegearMapLocation = {
  mapId: number
  x: number
  y: number
  width: number
  height: number
  objectOffsetX: number
  objectOffsetY: number
  flavorMessageId: number
  tilemapBlockId: number
  tilemapSourceX: number
  tilemapSourceY: number
  tilemapWidth: number
  tilemapHeight: number
}

export type HgssPokegearFlypoint = {
  nameMapId: number
  warpMapId: number
  flagIndex: number
  markerPalette: number
  x: number
  y: number
  tilemapSourceX: number
  tilemapSourceY: number
  width: number
  height: number
  tilemapWidth: number
  tilemapHeight: number
  tilemapDestinationX: number
  tilemapDestinationY: number
}

export type HgssPokegearMapData = {
  locations: HgssPokegearMapLocation[]
  flypoints: HgssPokegearFlypoint[]
}

const locationRecordSize = 16
const flypointRecordSize = 14

// Premiers enregistrements complets de sLocationSpecs et
// gMapFlypointParams. Les signatures servent uniquement a localiser les
// tables; toutes les valeurs exposees sont ensuite relues dans l'overlay 101
// de la ROM chargee.
const locationTableSignature = new Uint8Array([
  0x09, 0x02, 19, 2, 0x33, 0xc0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0x33, 0x01, 24, 16, 0x33, 0xc0, 69, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  120, 0, 21, 6, 0x11, 0, 55, 0, 0, 0, 0, 0, 5, 40, 1, 1,
])

const flypointTableSignature = new Uint8Array([
  49, 0, 49, 0, 0, 0, 32, 11, 0, 20, 0x11, 0x33, 0x11, 0,
  50, 0, 50, 0, 1, 1, 31, 7, 5, 20, 0x22, 0x44, 0x11, 0,
  51, 0, 51, 0, 2, 2, 32, 2, 10, 20, 0x22, 0x44, 0x11, 0,
])

function locateUniqueTable(bytes: Uint8Array, signature: Uint8Array, label: string): number {
  const matches: number[] = []
  outer: for (let offset = 0; offset <= bytes.byteLength - signature.byteLength; offset += 1) {
    for (let index = 0; index < signature.byteLength; index += 1) {
      if (bytes[offset + index] !== signature[index]) continue outer
    }
    matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ${label} du Pokematos doit etre unique dans l'overlay 101; ${matches.length} candidate(s) trouvee(s).`)
  }
  return matches[0]!
}

function assertTableRange(offset: number, count: number, recordSize: number, byteLength: number, label: string): void {
  if (offset < 0 || offset + count * recordSize > byteLength) {
    throw new Error(`La table ${label} du Pokematos depasse l'overlay 101.`)
  }
}

export function decodeHgssPokegearMapDataFromOverlay(overlay: Uint8Array): HgssPokegearMapData {
  const locationOffset = locateUniqueTable(overlay, locationTableSignature, 'des lieux')
  const flypointOffset = locateUniqueTable(overlay, flypointTableSignature, 'des points de Vol')
  assertTableRange(locationOffset, hgssPokegearMapLocationCount, locationRecordSize, overlay.byteLength, 'des lieux')
  assertTableRange(flypointOffset, hgssPokegearFlypointCount, flypointRecordSize, overlay.byteLength, 'des points de Vol')
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)

  const locations = Array.from({ length: hgssPokegearMapLocationCount }, (_, index): HgssPokegearMapLocation => {
    const offset = locationOffset + index * locationRecordSize
    const dimensions = view.getUint16(offset + 4, true)
    return {
      mapId: view.getUint16(offset, true),
      x: view.getUint8(offset + 2),
      y: view.getUint8(offset + 3),
      width: dimensions & 0xf,
      height: dimensions >>> 4 & 0xf,
      objectOffsetX: dimensions >>> 8 & 0xf,
      objectOffsetY: dimensions >>> 12 & 0xf,
      flavorMessageId: view.getUint8(offset + 6),
      tilemapBlockId: view.getUint8(offset + 7),
      tilemapSourceX: view.getUint8(offset + 12),
      tilemapSourceY: view.getUint8(offset + 13),
      tilemapWidth: view.getUint8(offset + 14),
      tilemapHeight: view.getUint8(offset + 15),
    }
  })

  const flypoints = Array.from({ length: hgssPokegearFlypointCount }, (_, index): HgssPokegearFlypoint => {
    const offset = flypointOffset + index * flypointRecordSize
    const size = view.getUint8(offset + 10)
    const tilemapSize = view.getUint8(offset + 11)
    const tilemapDestination = view.getUint8(offset + 12)
    return {
      nameMapId: view.getUint16(offset, true),
      warpMapId: view.getUint16(offset + 2, true),
      flagIndex: view.getUint8(offset + 4),
      markerPalette: view.getUint8(offset + 5),
      x: view.getUint8(offset + 6),
      y: view.getUint8(offset + 7),
      tilemapSourceX: view.getUint8(offset + 8),
      tilemapSourceY: view.getUint8(offset + 9),
      width: size & 0xf,
      height: size >>> 4,
      tilemapWidth: tilemapSize & 0xf,
      tilemapHeight: tilemapSize >>> 4,
      tilemapDestinationX: tilemapDestination & 0xf,
      tilemapDestinationY: tilemapDestination >>> 4,
    }
  })

  if (locations.some(({ width, height }) => width === 0 || height === 0)) {
    throw new Error('La table des lieux du Pokematos contient une zone vide.')
  }
  if (flypoints.some(({ width, height, flagIndex }) => width === 0 || height === 0 || flagIndex > 37)) {
    throw new Error('La table des points de Vol du Pokematos contient une entree invalide.')
  }
  return { locations, flypoints }
}

export function decodeHgssPokegearMapData(rom: Uint8Array): HgssPokegearMapData {
  return decodeHgssPokegearMapDataFromOverlay(readArm9OverlayFromRom(rom, 101))
}
