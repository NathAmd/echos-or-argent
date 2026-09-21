import { decompressBlz } from './maps/mapHeaders'

const overlayEntrySize = 32

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0, true)
}

export function readArm9OverlayFromRom(rom: Uint8Array, overlayId: number): Uint8Array {
  if (rom.byteLength < 0x58) throw new Error('La ROM est trop courte pour contenir les tables ARM9.')
  const overlayTableOffset = readUint32(rom, 0x50)
  const overlayTableSize = readUint32(rom, 0x54)
  const fatOffset = readUint32(rom, 0x48)
  if (overlayTableSize === 0 || overlayTableSize % overlayEntrySize !== 0 || overlayTableOffset + overlayTableSize > rom.byteLength) {
    throw new Error('La table des overlays ARM9 est invalide.')
  }

  let fileId: number | undefined
  for (let offset = overlayTableOffset; offset < overlayTableOffset + overlayTableSize; offset += overlayEntrySize) {
    if (readUint32(rom, offset) === overlayId) {
      fileId = readUint32(rom, offset + 24)
      break
    }
  }
  if (fileId === undefined) throw new Error(`L'overlay ARM9 ${overlayId} est absent de la ROM.`)

  const fatEntryOffset = fatOffset + fileId * 8
  if (fatEntryOffset + 8 > rom.byteLength) throw new Error(`L'entree FAT de l'overlay ARM9 ${overlayId} est hors limites.`)
  const fileOffset = readUint32(rom, fatEntryOffset)
  const fileEnd = readUint32(rom, fatEntryOffset + 4)
  if (fileEnd <= fileOffset || fileEnd > rom.byteLength) throw new Error(`Le fichier de l'overlay ARM9 ${overlayId} est hors limites.`)
  return decompressBlz(rom.subarray(fileOffset, fileEnd))
}
