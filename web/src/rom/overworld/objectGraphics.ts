import { readArm9OverlayFromRom } from '../arm9Overlay'

export type ObjectGraphicsInfo = {
  spriteId: number
  mapModelId: number
  flags: number
}

const GRAPHICS_ENTRY_SIZE = 6
const GRAPHICS_SENTINEL = 0xffff
const TABLE_PREFIX = [
  [1, 0],
  [2, 1],
  [3, 2],
  [4, 3],
  [5, 4],
  [6, 5],
  [7, 6],
  [8, 7],
] as const

export function locateObjectGraphicsTable(overlay: Uint8Array): number {
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)
  const matches: number[] = []
  const prefixSize = TABLE_PREFIX.length * GRAPHICS_ENTRY_SIZE
  for (let offset = 0; offset + prefixSize <= overlay.byteLength; offset += 2) {
    const matchesPrefix = TABLE_PREFIX.every(([spriteId, mapModelId], index) => {
      const entryOffset = offset + index * GRAPHICS_ENTRY_SIZE
      return view.getUint16(entryOffset, true) === spriteId
        && view.getUint16(entryOffset + 2, true) === mapModelId
        && view.getUint16(entryOffset + 4, true) === 0
    })
    if (matchesPrefix) matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table graphique des object events HGSS doit etre unique; ${matches.length} candidate(s) trouvee(s).`)
  }
  return matches[0]
}

export function decodeObjectGraphicsTable(overlay: Uint8Array, tableOffset = locateObjectGraphicsTable(overlay)): ObjectGraphicsInfo[] {
  if (!Number.isInteger(tableOffset) || tableOffset < 0 || tableOffset + GRAPHICS_ENTRY_SIZE > overlay.byteLength) {
    throw new Error('La table graphique des object events est hors limites.')
  }
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)
  const entries: ObjectGraphicsInfo[] = []
  for (let offset = tableOffset; offset + GRAPHICS_ENTRY_SIZE <= overlay.byteLength; offset += GRAPHICS_ENTRY_SIZE) {
    const spriteId = view.getUint16(offset, true)
    if (spriteId === GRAPHICS_SENTINEL) return entries
    entries.push({
      spriteId,
      mapModelId: view.getUint16(offset + 2, true),
      flags: view.getUint16(offset + 4, true),
    })
  }
  throw new Error('La table graphique des object events ne contient pas de sentinelle.')
}

export function decodeObjectGraphicsFromRom(rom: Uint8Array, overlayId = 1): ObjectGraphicsInfo[] {
  return decodeObjectGraphicsTable(readArm9OverlayFromRom(rom, overlayId))
}
