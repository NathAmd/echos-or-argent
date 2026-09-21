import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decodeNitroCellGraphicPayload, readNitroCells } from '../graphics/nitroCells'
import { readNitroIndexedGraphicPayload } from '../graphics/nitro2d'
import { decodeNitroCellAnimationPayload, type NitroCellAnimation } from '../graphics/nitroCellAnimations'
import { decompressLz10 } from '../lz10'

export const HGSS_BATTLE_SPRITE_CHARACTER_ARCHIVE_PATH = '/a/0/2/2'
export const HGSS_BATTLE_SPRITE_PALETTE_ARCHIVE_PATH = '/a/0/2/3'
export const HGSS_BATTLE_SPRITE_CELL_ARCHIVE_PATH = '/a/0/2/4'
export const HGSS_BATTLE_SPRITE_ANIMATION_ARCHIVE_PATH = '/a/0/2/5'

export type HgssBattleSpriteResourceRequest = {
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  cellFrameIndex?: number
  animationMemberId?: number
  color0Transparent?: boolean
}

export type HgssBattleSpriteResource = {
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  cellFrameIndex: number
  animationMemberId?: number
  graphic: NitroGraphic
  /** NANR brut, conservé pour que le lecteur applique ensuite sa timeline ROM. */
  animationPayload?: Uint8Array
  animation?: NitroCellAnimation
}

export type HgssBattleSpriteResourceArchives = {
  characters: RomFile
  palettes: RomFile
  cells: RomFile
  animations: RomFile
}

function requireArchivePath(archive: RomFile, path: string): void {
  if (archive.path !== path) throw new Error(`Archive d'animation de combat HGSS attendue ${path}, reçue ${archive.path}.`)
}

function readMember(rom: Uint8Array, archive: RomFile, memberId: number): Uint8Array {
  if (!Number.isInteger(memberId) || memberId < 0) throw new Error(`Indice de ressource de combat HGSS invalide : ${memberId}.`)
  const member = archive.archiveMembers[memberId]
  if (!member) throw new Error(`Le membre ${memberId} de ${archive.path} est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${memberId} de ${archive.path} dépasse la ROM.`)
  }
  const payload = rom.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

function hasNanrSignature(payload: Uint8Array): boolean {
  return payload.byteLength >= 4
    && payload[0] === 0x52
    && payload[1] === 0x4e
    && payload[2] === 0x41
    && payload[3] === 0x4e
}

function payloadSignature(payload: Uint8Array): string {
  return Array.from(payload.subarray(0, 4), (value) => String.fromCharCode(value)).join('')
}

/**
 * Relie les quatre banques distinctes utilisées par les opcodes 74 à 77.
 * Les identifiants des scripts sont des identifiants de ressource, pas des
 * offsets dans une archive composite : chaque banque est donc résolue séparément.
 */
export function createHgssBattleSpriteResourceResolver(
  rom: Uint8Array,
  archives: HgssBattleSpriteResourceArchives,
): (request: HgssBattleSpriteResourceRequest) => HgssBattleSpriteResource {
  requireArchivePath(archives.characters, HGSS_BATTLE_SPRITE_CHARACTER_ARCHIVE_PATH)
  requireArchivePath(archives.palettes, HGSS_BATTLE_SPRITE_PALETTE_ARCHIVE_PATH)
  requireArchivePath(archives.cells, HGSS_BATTLE_SPRITE_CELL_ARCHIVE_PATH)
  requireArchivePath(archives.animations, HGSS_BATTLE_SPRITE_ANIMATION_ARCHIVE_PATH)
  const cache = new Map<string, HgssBattleSpriteResource>()

  return (request) => {
    if (request.cellFrameIndex !== undefined && (!Number.isInteger(request.cellFrameIndex) || request.cellFrameIndex < 0)) {
      throw new Error(`Indice de cellule d'animation de combat HGSS invalide : ${request.cellFrameIndex}.`)
    }
    const color0Transparent = request.color0Transparent ?? true
    const key = [
      request.characterMemberId,
      request.paletteMemberId,
      request.cellMemberId,
      request.cellFrameIndex ?? 'auto',
      request.animationMemberId ?? '',
      color0Transparent ? 1 : 0,
    ].join(':')
    const cached = cache.get(key)
    if (cached) return cached

    const characterPayload = readMember(rom, archives.characters, request.characterMemberId)
    const palettePayload = readMember(rom, archives.palettes, request.paletteMemberId)
    const cellPayload = readMember(rom, archives.cells, request.cellMemberId)
    let animationPayload: Uint8Array | undefined
    let animation: NitroCellAnimation | undefined
    if (request.animationMemberId !== undefined) {
      animationPayload = readMember(rom, archives.animations, request.animationMemberId)
      if (!hasNanrSignature(animationPayload)) {
        throw new Error(`Le membre ${request.animationMemberId} de ${archives.animations.path} n'est pas un NANR.`)
      }
      animation = decodeNitroCellAnimationPayload(animationPayload)
      if (!animation) throw new Error(`Le NANR ${request.animationMemberId} de ${archives.animations.path} est invalide.`)
    }
    const cellFrameIndex = request.cellFrameIndex ?? animation?.sequences[0]?.frames[0]?.cellIndex ?? 0
    const graphic = decodeNitroCellGraphicPayload(
      characterPayload,
      palettePayload,
      cellPayload,
      cellFrameIndex,
      color0Transparent,
    )
    if (!graphic) {
      const indexed = readNitroIndexedGraphicPayload(characterPayload, palettePayload)
      const cells = readNitroCells(cellPayload)
      throw new Error(
        `Ressource de sprite de combat HGSS indécodable (${request.characterMemberId}/${request.paletteMemberId}/${request.cellMemberId}, cellule ${cellFrameIndex}; signatures ${payloadSignature(characterPayload)}/${payloadSignature(palettePayload)}/${payloadSignature(cellPayload)}, graphique ${indexed ? `${indexed.bitsPerPixel} bpp/${indexed.tileCount} tuiles` : 'invalide'}, cellules ${cells?.length ?? 'invalides'}).`,
      )
    }

    const resource: HgssBattleSpriteResource = {
      characterMemberId: request.characterMemberId,
      paletteMemberId: request.paletteMemberId,
      cellMemberId: request.cellMemberId,
      cellFrameIndex,
      animationMemberId: request.animationMemberId,
      graphic,
      animationPayload,
      animation,
    }
    cache.set(key, resource)
    return resource
  }
}
