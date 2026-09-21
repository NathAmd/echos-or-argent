import type { NitroCellSpritePreview, RomFile } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import { decodeNitroCellAnimationPayload } from '../graphics/nitroCellAnimations'
import { decodeNitroCellGraphicPayload, readNitroCells } from '../graphics/nitroCells'

export const HGSS_BATTLE_THROW_SPRITE_ARCHIVE_PATH = '/a/0/0/8'

export type HgssBattleThrowSpriteKind = 'safari-rock' | 'safari-bait'

export type HgssBattleThrowSpriteAsset = NitroCellSpritePreview & {
  kind: HgssBattleThrowSpriteKind
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  animationMemberId: number
  sequenceIndex: 1
  nativeOrigin: readonly [64, 112]
}

type ThrowSpriteMembers = Pick<
  HgssBattleThrowSpriteAsset,
  'characterMemberId' | 'paletteMemberId' | 'cellMemberId' | 'animationMemberId'
>

/*
 * `ov12_0225D138` selects resources 0x401/0x402. The resource LUT at
 * `ov07_022375BC` resolves them to these four members of NARC a/0/0/8.
 */
const hgssBattleThrowSpriteMembers: Readonly<Record<HgssBattleThrowSpriteKind, ThrowSpriteMembers>> = {
  'safari-rock': { characterMemberId: 336, paletteMemberId: 108, cellMemberId: 335, animationMemberId: 334 },
  'safari-bait': { characterMemberId: 339, paletteMemberId: 109, cellMemberId: 338, animationMemberId: 337 },
}

export function resolveHgssBattleThrowSpriteMemberIds(kind: HgssBattleThrowSpriteKind): ThrowSpriteMembers {
  return hgssBattleThrowSpriteMembers[kind]
}

function requireMember(rom: Uint8Array, archive: RomFile, memberId: number): Uint8Array {
  const member = archive.archiveMembers[memberId]
  if (!member || member.index !== memberId) {
    throw new Error(`La ressource de lancer HGSS ${archive.path}[${memberId}] est absente.`)
  }
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`La ressource de lancer HGSS ${archive.path}[${memberId}] dépasse la ROM.`)
  }
  const payload = rom.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

export function createHgssBattleThrowSpriteResolver(
  rom: Uint8Array,
  archive: RomFile,
): (kind: HgssBattleThrowSpriteKind) => HgssBattleThrowSpriteAsset {
  if (archive.path !== HGSS_BATTLE_THROW_SPRITE_ARCHIVE_PATH) {
    throw new Error(`Archive de lancer HGSS attendue ${HGSS_BATTLE_THROW_SPRITE_ARCHIVE_PATH}, reçue ${archive.path}.`)
  }
  const cache = new Map<HgssBattleThrowSpriteKind, HgssBattleThrowSpriteAsset>()
  return (kind) => {
    const cached = cache.get(kind)
    if (cached) return cached
    const members = resolveHgssBattleThrowSpriteMemberIds(kind)
    const character = requireMember(rom, archive, members.characterMemberId)
    const palette = requireMember(rom, archive, members.paletteMemberId)
    const cellsPayload = requireMember(rom, archive, members.cellMemberId)
    const animationPayload = requireMember(rom, archive, members.animationMemberId)
    const cells = readNitroCells(cellsPayload)
    const animation = decodeNitroCellAnimationPayload(animationPayload)
    if (!cells?.length || !animation?.sequences[1]?.frames.length) {
      throw new Error(`Le projectile Safari HGSS ${kind} est invalide dans ${archive.path}.`)
    }
    const frames = cells.map((_cell, cellIndex) => {
      const graphic = decodeNitroCellGraphicPayload(character, palette, cellsPayload, cellIndex, true)
      if (!graphic) throw new Error(`La cellule ${cellIndex} du projectile Safari HGSS ${kind} est indécodable.`)
      return graphic
    })
    const missing = animation.sequences.flatMap(({ frames: sequenceFrames }) => sequenceFrames)
      .find(({ cellIndex }) => !frames[cellIndex])
    if (missing) throw new Error(`Le projectile Safari HGSS ${kind} référence la cellule absente ${missing.cellIndex}.`)
    const asset: HgssBattleThrowSpriteAsset = {
      kind,
      ...members,
      frames,
      cells,
      animation,
      sequenceIndex: 1,
      // `ov07_02221F04(0, 1)` : position native du lanceur joueur.
      nativeOrigin: [64, 112],
    }
    cache.set(kind, asset)
    return asset
  }
}
