import type { MapHeaderPreview } from '../../ndsTypes'

export const HGSS_MAP_HEADER_SIZE = 24
const HGSS_MAP_COUNT = 540

const openingSignature = [
  { mapId: 60, scripts: 842, scriptHeader: 615, messages: 542, events: 57 },
  { mapId: 61, scripts: 843, scriptHeader: 616, messages: 543, events: 58 },
  { mapId: 62, scripts: 844, scriptHeader: 617, messages: 544, events: 59 },
  { mapId: 63, scripts: 845, scriptHeader: 618, messages: 545, events: 60 },
  { mapId: 64, scripts: 846, scriptHeader: 619, messages: 546, events: 61 },
] as const

function readUint24(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16)
}

export function decompressBlz(source: Uint8Array): Uint8Array {
  if (source.byteLength < 8) throw new Error('Le binaire ARM9 est trop court pour contenir un pied BLZ.')
  const headerLength = source[source.byteLength - 5]
  const compressedLength = readUint24(source, source.byteLength - 8)
  const extraLength = new DataView(source.buffer, source.byteOffset, source.byteLength).getUint32(source.byteLength - 4, true)
  if (headerLength < 8 || headerLength > 11 || compressedLength < headerLength || compressedLength > source.byteLength || extraLength === 0) {
    throw new Error('Le binaire ARM9 ne contient pas un pied BLZ valide.')
  }

  const prefixLength = source.byteLength - compressedLength
  const output = new Uint8Array(source.byteLength + extraLength)
  output.set(source.subarray(0, prefixLength))
  let inputOffset = source.byteLength - headerLength
  let outputOffset = output.byteLength

  while (inputOffset > prefixLength) {
    const flags = source[--inputOffset]
    for (let mask = 0x80; mask !== 0 && inputOffset > prefixLength; mask >>= 1) {
      if ((flags & mask) === 0) {
        if (outputOffset <= prefixLength) throw new Error('Le flux BLZ ARM9 depasse sa taille de sortie.')
        output[--outputOffset] = source[--inputOffset]
        continue
      }
      if (inputOffset - 2 < prefixLength) throw new Error('Le flux BLZ ARM9 contient une reference tronquee.')
      const high = source[--inputOffset]
      const low = source[--inputOffset]
      const length = (high >> 4) + 3
      const displacement = ((high & 0x0f) << 8 | low) + 3
      for (let index = 0; index < length; index += 1) {
        outputOffset -= 1
        const sourceOffset = outputOffset + displacement
        if (outputOffset < prefixLength || sourceOffset >= output.byteLength) {
          throw new Error('Le flux BLZ ARM9 contient une reference hors limites.')
        }
        output[outputOffset] = output[sourceOffset]
      }
    }
  }
  if (inputOffset !== prefixLength || outputOffset !== prefixLength) {
    throw new Error('Le flux BLZ ARM9 ne remplit pas exactement la sortie annoncee.')
  }
  return output
}

export function decodeMapHeader(bytes: Uint8Array, tableOffset: number, mapId: number): MapHeaderPreview {
  const offset = tableOffset + mapId * HGSS_MAP_HEADER_SIZE
  if (!Number.isInteger(mapId) || mapId < 0 || mapId >= HGSS_MAP_COUNT || offset < 0 || offset + HGSS_MAP_HEADER_SIZE > bytes.byteLength) {
    throw new Error(`L'en-tete de carte ${mapId} est hors limites.`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, HGSS_MAP_HEADER_SIZE)
  const coordinates = view.getUint16(2, true)
  const location = view.getUint16(18, true)
  const attributes = view.getUint32(20, true)
  return {
    mapId,
    wildEncounterBank: view.getUint8(0),
    areaDataBank: view.getUint8(1),
    moveModelBank: coordinates & 0x0f,
    worldMapX: coordinates >> 4 & 0x3f,
    worldMapY: coordinates >> 10 & 0x3f,
    matrixId: view.getUint16(4, true),
    scriptsBank: view.getUint16(6, true),
    scriptHeaderBank: view.getUint16(8, true),
    msgBank: view.getUint16(10, true),
    dayMusicId: view.getUint16(12, true),
    nightMusicId: view.getUint16(14, true),
    eventsBank: view.getUint16(16, true),
    mapSection: location & 0xff,
    areaIcon: location >> 8 & 0x0f,
    momCallIntroParam: location >> 12 & 0x0f,
    region: attributes & 1,
    weather: attributes >> 1 & 0x7f,
    mapType: attributes >> 8 & 0x0f,
    cameraType: attributes >> 12 & 0x3f,
    followMode: attributes >> 18 & 0x03,
    battleBackground: attributes >> 20 & 0x1f,
    bikeAllowed: Boolean(attributes & 1 << 25),
    runningAllowed: Boolean(attributes & 1 << 26),
    escapeRopeAllowed: Boolean(attributes & 1 << 27),
    flyAllowed: Boolean(attributes & 1 << 28),
    outgoingCalls: Boolean(attributes & 1 << 29),
    incomingCalls: Boolean(attributes & 1 << 30),
    radioSignal: Boolean(attributes & 1 << 31),
  }
}

export function locateMapHeaderTable(arm9: Uint8Array): number {
  const tableLength = HGSS_MAP_COUNT * HGSS_MAP_HEADER_SIZE
  const matches: number[] = []
  for (let tableOffset = 0; tableOffset + tableLength <= arm9.byteLength; tableOffset += 4) {
    const matchesOpening = openingSignature.every(({ mapId, scripts, scriptHeader, messages, events }) => {
      const offset = tableOffset + mapId * HGSS_MAP_HEADER_SIZE
      const view = new DataView(arm9.buffer, arm9.byteOffset + offset, HGSS_MAP_HEADER_SIZE)
      return view.getUint16(6, true) === scripts
        && view.getUint16(8, true) === scriptHeader
        && view.getUint16(10, true) === messages
        && view.getUint16(16, true) === events
    })
    if (matchesOpening) matches.push(tableOffset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table MapHeader HGSS doit etre unique dans ARM9; ${matches.length} candidate(s) trouvee(s).`)
  }
  return matches[0]
}

export function readArm9FromRom(rom: Uint8Array): Uint8Array {
  if (rom.byteLength < 0x30) throw new Error('La ROM est trop courte pour contenir les informations ARM9.')
  const header = new DataView(rom.buffer, rom.byteOffset, 0x30)
  const arm9Offset = header.getUint32(0x20, true)
  const arm9Length = header.getUint32(0x2c, true)
  if (arm9Offset + arm9Length > rom.byteLength) throw new Error('Le binaire ARM9 annonce par la ROM est hors limites.')
  return decompressBlz(rom.subarray(arm9Offset, arm9Offset + arm9Length))
}

export function decodeRomMapHeaders(rom: Uint8Array): MapHeaderPreview[] {
  const arm9 = readArm9FromRom(rom)
  const tableOffset = locateMapHeaderTable(arm9)
  return Array.from({ length: HGSS_MAP_COUNT }, (_, mapId) => decodeMapHeader(arm9, tableOffset, mapId))
}