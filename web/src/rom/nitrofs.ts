import { decodeAscii, readUint16, readUint32 } from '../core/binaryReader'

const directoryEntrySize = 8

export function parseNitroFileNames(fnt: Uint8Array, directoryCount: number, fileCount: number): Map<number, string> {
  const view = new DataView(fnt.buffer, fnt.byteOffset, fnt.byteLength)
  const names = new Map<number, string>()

  const visitDirectory = (directoryIndex: number, parentPath: string): void => {
    if (directoryIndex < 0 || directoryIndex >= directoryCount) {
      throw new Error('La table de repertoires NitroFS contient une reference invalide.')
    }

    const entryOffset = directoryIndex * directoryEntrySize
    const subtableOffset = readUint32(view, entryOffset)
    let fileId = readUint16(view, entryOffset + 4)
    if (subtableOffset >= fnt.byteLength) {
      throw new Error('La table des noms NitroFS contient un offset invalide.')
    }

    let cursor = subtableOffset
    while (cursor < fnt.byteLength) {
      const descriptor = fnt[cursor]
      cursor += 1
      if (descriptor === 0) return

      const isDirectory = (descriptor & 0x80) !== 0
      const nameLength = descriptor & 0x7f
      if (nameLength === 0 || cursor + nameLength + (isDirectory ? 2 : 0) > fnt.byteLength) {
        throw new Error('Une entree de nom NitroFS est invalide.')
      }

      const name = decodeAscii(fnt.slice(cursor, cursor + nameLength))
      cursor += nameLength
      const path = `${parentPath}/${name}`
      if (isDirectory) {
        const directoryId = readUint16(view, cursor)
        cursor += 2
        visitDirectory(directoryId - 0xf000, path)
      } else {
        if (fileId >= fileCount) {
          throw new Error('La table des noms NitroFS reference un fichier absent de la FAT.')
        }
        names.set(fileId, path)
        fileId += 1
      }
    }

    throw new Error('La table de noms NitroFS se termine sans marqueur de fin.')
  }

  visitDirectory(0, '')
  return names
}