import { formatSignature, hasMagic, readUint16, readUint32 } from '../core/binaryReader'
import type { NarcMember } from '../ndsTypes'

export function readNarcMembers(bytes: Uint8Array, offset: number, size: number): NarcMember[] {
  if (size < 16 || !hasMagic(bytes, offset, 'NARC')) return []
  const view = new DataView(bytes.buffer, bytes.byteOffset + offset, size)
  const headerSize = readUint16(view, 12)
  const blockCount = readUint16(view, 14)
  if (headerSize < 16 || headerSize > size || blockCount < 2) return []

  let cursor = headerSize
  let fileBounds: { start: number, end: number }[] | undefined
  let gmifDataOffset: number | undefined
  let gmifDataSize = 0
  for (let block = 0; block < blockCount; block += 1) {
    if (cursor + 8 > size) return []
    const blockSize = readUint32(view, cursor + 4)
    if (blockSize < 8 || cursor + blockSize > size) return []
    if (hasMagic(bytes, offset + cursor, 'BTAF')) {
      if (blockSize < 12) return []
      const entryCount = readUint16(view, cursor + 8)
      if (12 + entryCount * 8 > blockSize) return []
      fileBounds = Array.from({ length: entryCount }, (_, index) => ({
        start: readUint32(view, cursor + 12 + index * 8),
        end: readUint32(view, cursor + 16 + index * 8),
      }))
    }
    if (hasMagic(bytes, offset + cursor, 'GMIF')) {
      gmifDataOffset = cursor + 8
      gmifDataSize = blockSize - 8
    }
    cursor += blockSize
  }

  if (!fileBounds || gmifDataOffset === undefined) return []
  return fileBounds.map(({ start, end }, index) => {
    if (end < start || end > gmifDataSize) {
      throw new Error(`Le membre ${index} d’une archive NARC depasse le bloc GMIF.`)
    }
    const memberOffset = offset + gmifDataOffset + start
    const memberSize = end - start
    return {
      index,
      offset: memberOffset,
      size: memberSize,
      signature: formatSignature(bytes.slice(memberOffset, Math.min(memberOffset + 4, memberOffset + memberSize))),
    }
  })
}