export function decodeAscii(bytes: Uint8Array): string {
  return new TextDecoder('ascii')
    .decode(bytes)
    .replace(/\0/g, '')
    .trim()
}

export function assertRange(offset: number, length: number, fileSize: number, label: string): void {
  if (!Number.isSafeInteger(offset) || !Number.isSafeInteger(length) || offset < 0 || length < 0 || offset + length > fileSize) {
    throw new Error(`La zone ${label} annoncee dans l’en-tete est hors des limites du fichier.`)
  }
}

export function readUint16(data: DataView, offset: number): number {
  return data.getUint16(offset, true)
}

export function readUint32(data: DataView, offset: number): number {
  return data.getUint32(offset, true)
}

export function formatSignature(bytes: Uint8Array): string {
  return [...bytes]
    .map((value) => (value >= 32 && value <= 126 ? String.fromCharCode(value) : value.toString(16).padStart(2, '0')))
    .join(' ')
}

export function hasMagic(bytes: Uint8Array, offset: number, magic: string): boolean {
  if (offset + magic.length > bytes.byteLength) return false
  return [...magic].every((character, index) => bytes[offset + index] === character.charCodeAt(0))
}

export function findMagic(bytes: Uint8Array, magic: string, start = 0, end = bytes.byteLength): number {
  for (let offset = start; offset <= end - magic.length; offset += 1) {
    if (hasMagic(bytes, offset, magic)) return offset
  }
  return -1
}