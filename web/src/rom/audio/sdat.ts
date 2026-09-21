export type SdatFile = { offset: number, size: number }
export type SdatSequence = {
  fileId: number
  bankId: number
  volume: number
  channelPriority: number
  playerPriority: number
  /** Nitro sequence player declared by the SDAT (BGM, fanfare or one of four SE channels). */
  playerId: number
}
export type SdatBank = { fileId: number, waveArchiveIds: number[] }
export type SdatWaveArchive = { fileId: number }

export type SdatArchive = {
  bytes: Uint8Array
  files: SdatFile[]
  sequences: Array<SdatSequence | undefined>
  sequenceNames: Array<string | undefined>
  banks: Array<SdatBank | undefined>
  waveArchives: Array<SdatWaveArchive | undefined>
}

function readAsciiTerminated(bytes: Uint8Array, offset: number): string | undefined {
  if (offset <= 0 || offset >= bytes.byteLength) return undefined
  let end = offset
  while (end < bytes.byteLength && bytes[end] !== 0) end += 1
  const value = String.fromCharCode(...bytes.subarray(offset, end))
  return value || undefined
}

function readSequenceNames(bytes: Uint8Array, view: DataView): Array<string | undefined> {
  const symbOffset = view.getUint32(0x10, true)
  const symbSize = view.getUint32(0x14, true)
  if (symbOffset === 0 || symbSize < 12 || symbOffset + symbSize > bytes.byteLength) return []
  if (String.fromCharCode(...bytes.subarray(symbOffset, symbOffset + 4)) !== 'SYMB') return []
  const recordRelativeOffset = view.getUint32(symbOffset + 8, true)
  if (recordRelativeOffset === 0) return []
  const recordOffset = symbOffset + recordRelativeOffset
  if (recordOffset + 4 > symbOffset + symbSize) return []
  const count = view.getUint32(recordOffset, true)
  if (recordOffset + 4 + count * 4 > symbOffset + symbSize) return []
  return Array.from({ length: count }, (_, index) => {
    const relativeOffset = view.getUint32(recordOffset + 4 + index * 4, true)
    return relativeOffset === 0 ? undefined : readAsciiTerminated(bytes, symbOffset + relativeOffset)
  })
}

function requireRange(bytes: Uint8Array, offset: number, size: number, label: string): void {
  if (offset < 0 || size < 0 || offset + size > bytes.byteLength) throw new Error(`${label} depasse les limites du SDAT.`)
}

function requireMagic(bytes: Uint8Array, offset: number, magic: string): void {
  requireRange(bytes, offset, magic.length, magic)
  const value = String.fromCharCode(...bytes.subarray(offset, offset + magic.length))
  if (value !== magic) throw new Error(`Bloc SDAT ${magic} attendu a l’offset ${offset}, trouve ${JSON.stringify(value)}.`)
}

function readInfoTable<T>(bytes: Uint8Array, view: DataView, infoOffset: number, tableIndex: number, readEntry: (offset: number) => T): Array<T | undefined> {
  const tableRelativeOffset = view.getUint32(infoOffset + 8 + tableIndex * 4, true)
  if (tableRelativeOffset === 0) return []
  const tableOffset = infoOffset + tableRelativeOffset
  requireRange(bytes, tableOffset, 4, `Table INFO ${tableIndex}`)
  const count = view.getUint32(tableOffset, true)
  requireRange(bytes, tableOffset + 4, count * 4, `References INFO ${tableIndex}`)
  return Array.from({ length: count }, (_, index) => {
    const entryRelativeOffset = view.getUint32(tableOffset + 4 + index * 4, true)
    return entryRelativeOffset === 0 ? undefined : readEntry(infoOffset + entryRelativeOffset)
  })
}

export function decodeSdat(bytes: Uint8Array): SdatArchive {
  requireRange(bytes, 0, 0x30, 'En-tete SDAT')
  requireMagic(bytes, 0, 'SDAT')
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const declaredSize = view.getUint32(8, true)
  if (declaredSize !== bytes.byteLength) throw new Error(`Le SDAT annonce ${declaredSize} octets au lieu de ${bytes.byteLength}.`)
  const infoOffset = view.getUint32(0x18, true)
  const infoSize = view.getUint32(0x1c, true)
  const fatOffset = view.getUint32(0x20, true)
  const fatSize = view.getUint32(0x24, true)
  requireRange(bytes, infoOffset, infoSize, 'Bloc INFO')
  requireRange(bytes, fatOffset, fatSize, 'Bloc FAT')
  requireMagic(bytes, infoOffset, 'INFO')
  requireMagic(bytes, fatOffset, 'FAT ')

  const fileCount = view.getUint32(fatOffset + 8, true)
  requireRange(bytes, fatOffset + 12, fileCount * 16, 'Entrees FAT')
  const files = Array.from({ length: fileCount }, (_, index): SdatFile => {
    const entryOffset = fatOffset + 12 + index * 16
    const offset = view.getUint32(entryOffset, true)
    const size = view.getUint32(entryOffset + 4, true)
    requireRange(bytes, offset, size, `Fichier SDAT ${index}`)
    return { offset, size }
  })

  const sequences = readInfoTable(bytes, view, infoOffset, 0, (offset): SdatSequence => {
    requireRange(bytes, offset, 10, 'Entree sequence')
    return {
      fileId: view.getUint16(offset, true),
      bankId: view.getUint16(offset + 4, true),
      volume: view.getUint8(offset + 6),
      channelPriority: view.getUint8(offset + 7),
      playerPriority: view.getUint8(offset + 8),
      playerId: view.getUint8(offset + 9),
    }
  })
  const sequenceNames = readSequenceNames(bytes, view)
  const banks = readInfoTable(bytes, view, infoOffset, 2, (offset): SdatBank => {
    requireRange(bytes, offset, 12, 'Entree banque')
    const waveArchiveIds = Array.from({ length: 4 }, (_, index) => view.getUint16(offset + 4 + index * 2, true)).filter((id) => id !== 0xffff)
    return { fileId: view.getUint16(offset, true), waveArchiveIds }
  })
  const waveArchives = readInfoTable(bytes, view, infoOffset, 3, (offset): SdatWaveArchive => {
    requireRange(bytes, offset, 2, 'Entree wave archive')
    return { fileId: view.getUint16(offset, true) }
  })

  return { bytes, files, sequences, sequenceNames, banks, waveArchives }
}

export function readSdatFile(archive: SdatArchive, fileId: number, magic: string): Uint8Array {
  const file = archive.files[fileId]
  if (!file) throw new Error(`Le fichier SDAT ${fileId} est absent.`)
  requireMagic(archive.bytes, file.offset, magic)
  return archive.bytes.subarray(file.offset, file.offset + file.size)
}
