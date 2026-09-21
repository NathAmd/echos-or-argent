import { readArm9OverlayFromRom } from '../arm9Overlay'

export const hgssBattleTerrainCount = 13

// sTerrainMove dans l'overlay 12 français. La signature complète est unique ;
// les valeurs retournées restent lues depuis la ROM et non recopiées au runtime.
const terrainMoveSignature = new Uint8Array([
  0x59, 0x00, 0x59, 0x00, 0x92, 0x01, 0x92, 0x01, 0x9d, 0x00, 0x9d, 0x00,
  0x3b, 0x00, 0x38, 0x00, 0x3a, 0x00, 0xa1, 0x00, 0xaa, 0x01, 0x93, 0x01, 0xa1, 0x00,
])
const camouflageTypeSignature = new Uint8Array([4, 4, 12, 12, 5, 5, 15, 11, 15, 0, 4, 2, 0])
const secretPowerSideEffectSignature = [
  0x8000001b, 0x8000001b, 0x80000001, 0x80000001, 0x80000008, 0x80000008, 0x80000004,
  0x80000016, 0x80000004, 0x80000005, 0x80000018, 0x8000001c, 0x80000005,
] as const

function locateTerrainMoveTable(overlay: Uint8Array): number {
  const matches: number[] = []
  outer: for (let offset = 0; offset <= overlay.byteLength - terrainMoveSignature.byteLength; offset += 2) {
    for (let index = 0; index < terrainMoveSignature.byteLength; index += 1) {
      if (overlay[offset + index] !== terrainMoveSignature[index]) continue outer
    }
    matches.push(offset)
  }
  if (matches.length !== 1) throw new Error(`La table terrain→capacité HGSS doit être unique dans l'overlay 12; ${matches.length} candidate(s) trouvée(s).`)
  return matches[0]!
}

function locateUniqueSignature(overlay: Uint8Array, signature: Uint8Array, label: string): number {
  const matches: number[] = []
  outer: for (let offset = 0; offset <= overlay.byteLength - signature.byteLength; offset += 1) {
    for (let index = 0; index < signature.byteLength; index += 1) if (overlay[offset + index] !== signature[index]) continue outer
    matches.push(offset)
  }
  if (matches.length !== 1) throw new Error(`La table ${label} HGSS doit être unique dans l'overlay 12; ${matches.length} candidate(s) trouvée(s).`)
  return matches[0]!
}

function locateUniqueUint32Signature(overlay: Uint8Array, signature: readonly number[], label: string): number {
  const view = new DataView(overlay.buffer, overlay.byteOffset, overlay.byteLength)
  const matches: number[] = []
  outer: for (let offset = 0; offset <= overlay.byteLength - signature.length * 4; offset += 4) {
    for (let index = 0; index < signature.length; index += 1) if (view.getUint32(offset + index * 4, true) !== signature[index]) continue outer
    matches.push(offset)
  }
  if (matches.length !== 1) throw new Error(`La table ${label} HGSS doit être unique dans l'overlay 12; ${matches.length} candidate(s) trouvée(s).`)
  return matches[0]!
}

export function decodeHgssNaturePowerMoveIdsFromOverlay(overlay: Uint8Array): number[] {
  const offset = locateTerrainMoveTable(overlay)
  const view = new DataView(overlay.buffer, overlay.byteOffset + offset, terrainMoveSignature.byteLength)
  return Array.from({ length: hgssBattleTerrainCount }, (_, terrainId) => view.getUint16(terrainId * 2, true))
}

export function decodeHgssNaturePowerMoveIds(rom: Uint8Array): number[] {
  return decodeHgssNaturePowerMoveIdsFromOverlay(readArm9OverlayFromRom(rom, 12))
}

export function decodeHgssCamouflageTypeIdsFromOverlay(overlay: Uint8Array): number[] {
  const offset = locateUniqueSignature(overlay, camouflageTypeSignature, 'terrain→type')
  return [...overlay.slice(offset, offset + hgssBattleTerrainCount)]
}

export function decodeHgssCamouflageTypeIds(rom: Uint8Array): number[] {
  return decodeHgssCamouflageTypeIdsFromOverlay(readArm9OverlayFromRom(rom, 12))
}

export function decodeHgssSecretPowerEffectIdsFromOverlay(overlay: Uint8Array): number[] {
  const offset = locateUniqueUint32Signature(overlay, secretPowerSideEffectSignature, 'terrain→effet secondaire')
  const view = new DataView(overlay.buffer, overlay.byteOffset + offset, secretPowerSideEffectSignature.length * 4)
  return Array.from({ length: hgssBattleTerrainCount }, (_, terrainId) => view.getUint32(terrainId * 4, true) & 0x7fffffff)
}

export function decodeHgssSecretPowerEffectIds(rom: Uint8Array): number[] {
  return decodeHgssSecretPowerEffectIdsFromOverlay(readArm9OverlayFromRom(rom, 12))
}

/** BattleSystem_GetTerrain rabat les décors spéciaux au terrain sentinelle final. */
export function resolveHgssBattleTerrainId(mapBattleBackground: number): number {
  if (!Number.isInteger(mapBattleBackground) || mapBattleBackground < 0) return hgssBattleTerrainCount - 1
  return Math.min(hgssBattleTerrainCount - 1, mapBattleBackground)
}
