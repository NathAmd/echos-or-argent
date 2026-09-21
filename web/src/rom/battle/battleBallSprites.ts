import type { NitroCellSpritePreview, RomFile } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import { decodeNitroCellAnimationPayload } from '../graphics/nitroCellAnimations'
import { decodeNitroCellGraphicPayload, readNitroCells } from '../graphics/nitroCells'

export const HGSS_BATTLE_BALL_SPRITE_ARCHIVE_PATH = '/a/0/0/8'
export const HGSS_SAFARI_BALL_ITEM_ID = 5
export const HGSS_SAFARI_BALL_ID = 5
export const HGSS_POKE_BALL_ID = 4
export const HGSS_FIRST_BATTLE_BALL_ID = 1
export const HGSS_LAST_BATTLE_BALL_ID = 24

export type HgssBattleBallSpriteAsset = NitroCellSpritePreview & {
  ballId: number
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  animationMemberId: number
  closedSequenceIndex: 0
  activeSequenceIndex: 1
}

export type HgssBattleBallSpriteMembers = Pick<
  HgssBattleBallSpriteAsset,
  'characterMemberId' | 'paletteMemberId' | 'cellMemberId' | 'animationMemberId'
>

export function isHgssBattleBallItemId(itemId: number): boolean {
  return Number.isInteger(itemId) && ((itemId >= 1 && itemId <= 16) || (itemId >= 492 && itemId <= 499))
}

/** Identifiants internes acceptés par la LUT visuelle HGSS `ov07_022375BC`. */
export function isHgssBattleBallId(value: unknown): value is number {
  return Number.isInteger(value)
    && (value as number) >= HGSS_FIRST_BATTLE_BALL_ID
    && (value as number) <= HGSS_LAST_BATTLE_BALL_ID
}

/**
 * Reproduit `ItemToBallId` (`src/item.c`). Les Balls Fargas occupent les
 * objets 492..499 mais les identifiants visuels/sauvegardés 17..24.
 * Comme la ROM, toute autre valeur retombe sur la Poké Ball (4).
 */
export function resolveHgssBallIdFromItemId(itemId: number): number {
  if (Number.isInteger(itemId) && itemId >= 1 && itemId <= 16) return itemId
  if (Number.isInteger(itemId) && itemId >= 492 && itemId <= 499) return itemId - 492 + 17
  return HGSS_POKE_BALL_ID
}

/**
 * Entrées 0..23 de `ov07_022375BC`, après la normalisation 1..24 effectuée
 * par `ov07_0223251C`. Les quatre colonnes sont chargées dans l'ordre
 * NCGR/NCLR/NCER/NANR depuis a/0/0/8.
 */
export function resolveHgssBattleBallSpriteMemberIds(ballId: number): HgssBattleBallSpriteMembers {
  if (!isHgssBattleBallId(ballId)) {
    throw new Error(`Identifiant de Ball HGSS non rendu par la LUT native : ${ballId}.`)
  }
  const index = ballId - 1
  return {
    characterMemberId: 261 + index * 3,
    paletteMemberId: 83 + index,
    cellMemberId: 260 + index * 3,
    animationMemberId: 259 + index * 3,
  }
}

function requireMember(rom: Uint8Array, archive: RomFile, memberId: number): Uint8Array {
  const member = archive.archiveMembers[memberId]
  if (!member || member.index !== memberId) {
    throw new Error(`La ressource de Ball HGSS ${archive.path}[${memberId}] est absente.`)
  }
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`La ressource de Ball HGSS ${archive.path}[${memberId}] dépasse la ROM.`)
  }
  const payload = rom.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

export function createHgssBattleBallSpriteResolver(
  rom: Uint8Array,
  archive: RomFile,
): (ballId: number) => HgssBattleBallSpriteAsset {
  if (archive.path !== HGSS_BATTLE_BALL_SPRITE_ARCHIVE_PATH) {
    throw new Error(`Archive de Balls HGSS attendue ${HGSS_BATTLE_BALL_SPRITE_ARCHIVE_PATH}, reçue ${archive.path}.`)
  }
  const cache = new Map<number, HgssBattleBallSpriteAsset>()
  return (ballId) => {
    const cached = cache.get(ballId)
    if (cached) return cached
    const members = resolveHgssBattleBallSpriteMemberIds(ballId)
    const character = requireMember(rom, archive, members.characterMemberId)
    const palette = requireMember(rom, archive, members.paletteMemberId)
    const cellsPayload = requireMember(rom, archive, members.cellMemberId)
    const animationPayload = requireMember(rom, archive, members.animationMemberId)
    const cells = readNitroCells(cellsPayload)
    const animation = decodeNitroCellAnimationPayload(animationPayload)
    if (!cells?.length || !animation?.sequences[0]?.frames.length || !animation.sequences[1]?.frames.length) {
      throw new Error(`La Ball HGSS ${ballId} est invalide dans ${archive.path}.`)
    }
    const frames = cells.map((_cell, cellIndex) => {
      const graphic = decodeNitroCellGraphicPayload(character, palette, cellsPayload, cellIndex, true)
      if (!graphic) throw new Error(`La cellule ${cellIndex} de la Ball HGSS ${ballId} est indécodable.`)
      return graphic
    })
    const missing = animation.sequences.flatMap(({ frames: sequenceFrames }) => sequenceFrames)
      .find(({ cellIndex }) => !frames[cellIndex])
    if (missing) throw new Error(`La Ball HGSS ${ballId} référence la cellule absente ${missing.cellIndex}.`)
    const asset: HgssBattleBallSpriteAsset = {
      ballId,
      ...members,
      frames,
      cells,
      animation,
      closedSequenceIndex: 0,
      activeSequenceIndex: 1,
    }
    cache.set(ballId, asset)
    return asset
  }
}
