import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import { decodeNitroTilemapGraphicPayload } from '../graphics/nitro2d'

const battleBackgroundTilemapMember = 2
const battleBackgroundPaletteBase = 176
const battleBackgroundPaletteVariants = 3
const battleViewportWidth = 256
const battleViewportHeight = 192
// Dans le tilemap 256×192, le décor occupe 0–79, la séparation des deux BG
// 80–127 et le sol natif 128–191. Sur un écran unique on recolle les deux
// couches ROM et on supprime uniquement la bande noire inter-écrans.
export const hgssBattleBackdropHeight = 80
export const hgssBattleGroundOffset = 128
export const hgssBattleGroundHeight = 64
export const hgssSingleScreenHorizon = 96

export type HgssBattleBackgroundRequest = {
  backgroundId: number
  timeOfDay: 0 | 1 | 2
}

export type HgssBattleBackgroundMemberIndexes = {
  graphic: number
  palette: number
  screen: number
}

export function getHgssBattleBackgroundMemberIndexes(
  request: HgssBattleBackgroundRequest,
): HgssBattleBackgroundMemberIndexes {
  if (!Number.isInteger(request.backgroundId) || request.backgroundId < 0) {
    throw new Error(`L'identifiant de décor de combat HGSS ${request.backgroundId} est invalide.`)
  }
  return {
    graphic: request.backgroundId + 3,
    palette: battleBackgroundPaletteBase + request.backgroundId * battleBackgroundPaletteVariants + request.timeOfDay,
    screen: battleBackgroundTilemapMember,
  }
}

function requireMember(rom: Uint8Array, archive: RomFile, index: number): Uint8Array {
  const member = archive.archiveMembers[index]
  if (!member) throw new Error(`Le membre ${index} des décors de combat HGSS est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${index} des décors de combat HGSS est hors limites.`)
  }
  const payload = rom.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

function cropBattleViewport(graphic: NitroGraphic): NitroGraphic {
  if (graphic.width < battleViewportWidth || graphic.height < battleViewportHeight) {
    throw new Error(`Le décor de combat HGSS mesure ${graphic.width} × ${graphic.height}, moins que le viewport Nintendo DS.`)
  }
  const pixels = new Uint8ClampedArray(battleViewportWidth * battleViewportHeight * 4)
  for (let y = 0; y < battleViewportHeight; y += 1) {
    const sourceStart = y * graphic.width * 4
    pixels.set(graphic.pixels.subarray(sourceStart, sourceStart + battleViewportWidth * 4), y * battleViewportWidth * 4)
  }
  return { ...graphic, width: battleViewportWidth, height: battleViewportHeight, pixels }
}

export function createHgssSingleScreenBattleBackdrop(graphic: NitroGraphic): NitroGraphic {
  if (graphic.width < battleViewportWidth || graphic.height < hgssBattleGroundOffset + hgssBattleGroundHeight) {
    throw new Error(`Le décor de combat HGSS ${graphic.width} × ${graphic.height} ne contient pas ses couches décor et sol.`)
  }
  const pixels = new Uint8ClampedArray(battleViewportWidth * battleViewportHeight * 4)
  for (let y = 0; y < battleViewportHeight; y += 1) {
    const sourceY = y < hgssSingleScreenHorizon
      ? Math.min(hgssBattleBackdropHeight - 1, Math.floor(y * hgssBattleBackdropHeight / hgssSingleScreenHorizon))
      : hgssBattleGroundOffset + Math.min(
          hgssBattleGroundHeight - 1,
          Math.floor((y - hgssSingleScreenHorizon) * hgssBattleGroundHeight / (battleViewportHeight - hgssSingleScreenHorizon)),
        )
    const sourceStart = sourceY * graphic.width * 4
    pixels.set(graphic.pixels.subarray(sourceStart, sourceStart + battleViewportWidth * 4), y * battleViewportWidth * 4)
  }
  return { ...graphic, width: battleViewportWidth, height: battleViewportHeight, pixels }
}

export function createHgssBattleBackgroundResolver(
  rom: Uint8Array,
  archive: RomFile,
): (request: HgssBattleBackgroundRequest) => NitroGraphic {
  const cache = new Map<string, NitroGraphic>()
  return (request) => {
    const key = `${request.backgroundId}:${request.timeOfDay}`
    const cached = cache.get(key)
    if (cached) return cached
    const indexes = getHgssBattleBackgroundMemberIndexes(request)
    const decoded = decodeNitroTilemapGraphicPayload(
      requireMember(rom, archive, indexes.graphic),
      requireMember(rom, archive, indexes.palette),
      requireMember(rom, archive, indexes.screen),
      false,
    )
    if (!decoded) {
      throw new Error(`Le décor de combat HGSS ${request.backgroundId} n'est pas décodable.`)
    }
    const graphic = cropBattleViewport(decoded)
    cache.set(key, graphic)
    return graphic
  }
}
