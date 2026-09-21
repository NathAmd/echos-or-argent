import type { NitroNamedEntry } from './internalTypes'

export type NitroResourceView = {
  /** Octets du conteneur parent (ROM complète ou membre isolé). */
  bytes: Uint8Array
  /** Vue dont l'offset zéro correspond au début de la ressource Nitro. */
  view: DataView
  /** Offset absolu de la ressource dans `bytes`. */
  baseOffset: number
  /** Taille validée de la ressource, relative à `view`. */
  fileSize: number
}

export function decodeNitroAscii(bytes: Uint8Array): string {
  const end = bytes.indexOf(0)
  return new TextDecoder('ascii').decode(end < 0 ? bytes : bytes.subarray(0, end))
}

export function hasNitroMagic(bytes: Uint8Array, offset: number, magic: string): boolean {
  return magic.length <= bytes.length - offset
    && [...magic].every((value, index) => bytes[offset + index] === value.charCodeAt(0))
}

export function readNitroDictionary<T>(
  resource: NitroResourceView,
  offset: number,
  readValue: (elementOffset: number, elementSize: number) => T,
): NitroNamedEntry<T>[] {
  const { bytes, view, baseOffset, fileSize } = resource
  if (offset + 4 > fileSize || view.getUint8(offset) !== 0) return []
  const count = view.getUint8(offset + 1)
  const size = view.getUint16(offset + 2, true)
  if (count === 0 || size < 16 + count * 4 || offset + size > fileSize) return []
  const dataOffset = offset + 16 + count * 4
  const elementSizeOffset = offset + 12 + count * 4
  const elementSize = elementSizeOffset + 2 <= fileSize ? view.getUint16(elementSizeOffset, true) : 0
  const namesOffset = offset + size - count * 16
  if (elementSize === 0 || dataOffset + elementSize * count > namesOffset || namesOffset + count * 16 > fileSize) return []
  return Array.from({ length: count }, (_, index) => ({
    name: decodeNitroAscii(bytes.subarray(baseOffset + namesOffset + index * 16, baseOffset + namesOffset + (index + 1) * 16)),
    value: readValue(dataOffset + index * elementSize, elementSize),
  }))
}

export function readNitroFixedNames(resource: NitroResourceView, offset: number, count: number): string[] | undefined {
  if (offset < 0 || count < 0 || offset + count * 16 > resource.fileSize) return undefined
  return Array.from({ length: count }, (_, index) => decodeNitroAscii(resource.bytes.subarray(
    resource.baseOffset + offset + index * 16,
    resource.baseOffset + offset + (index + 1) * 16,
  )))
}

export function readNitroInfoOffsets(resource: NitroResourceView, offset: number): number[] {
  const { view, fileSize } = resource
  if (offset + 16 > fileSize || view.getUint8(offset) !== 0) return []
  const count = view.getUint8(offset + 1)
  const dataOffset = offset + 16 + count * 4
  if (dataOffset + count * 4 > fileSize) return []
  return Array.from({ length: count }, (_, index) => offset + view.getUint32(dataOffset + index * 4, true))
}
