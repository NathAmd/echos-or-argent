import type { NitroCellSpritePreview, NitroGraphic, RomFile } from '../../ndsTypes'
import type { NitroCell } from '../graphics/nitroCells'
import { decodeNitroCellGraphicPayload, readNitroCells } from '../graphics/nitroCells'
import type { NitroCellAnimation } from '../graphics/nitroCellAnimations'
import { decodeNitroCellAnimationPayload } from '../graphics/nitroCellAnimations'
import { decodeNitroTilemapGraphicPayload, readNitroPalette } from '../graphics/nitro2d'
import { decompressLz10 } from '../lz10'
import type { HgssSafariAreaId } from './safariEncounterData'

export const HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH = '/a/1/6/6'
export const HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH = '/a/2/2/3'

export type HgssSafariTilemapLayer = {
  screenMemberId: number
  graphic: NitroGraphic
}

export type HgssSafariBackgroundGroup = {
  characterMemberId: number
  paletteMemberId: number
  palette: Uint16Array
  layers: HgssSafariTilemapLayer[]
}

export type HgssSafariCellSpriteAsset = NitroCellSpritePreview & {
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  animationMemberId: number
  palette: Uint16Array
  cells: NitroCell[]
}

export type HgssSafariAreaPreviewAsset = HgssSafariCellSpriteAsset & {
  areaId: HgssSafariAreaId
}

export type HgssSafariUiAssets = {
  customizer: {
    backgroundGroups: HgssSafariBackgroundGroup[]
    objectSprites: HgssSafariCellSpriteAsset
    areaPreviews: HgssSafariAreaPreviewAsset[]
  }
  decorator: {
    backgroundGroups: HgssSafariBackgroundGroup[]
    objectSprites: HgssSafariCellSpriteAsset
  }
}

type BackgroundGroupSpec = {
  characterMemberId: number
  paletteMemberId: number
  screenMemberIds: readonly number[]
}

type CellSpriteSpec = {
  characterMemberId: number
  paletteMemberId: number
  cellMemberId: number
  animationMemberId: number
}

const customizerBackgroundSpecs: readonly BackgroundGroupSpec[] = [
  { characterMemberId: 1, paletteMemberId: 0, screenMemberIds: [2, 3, 4] },
  { characterMemberId: 6, paletteMemberId: 5, screenMemberIds: [7, 8, 9, 10] },
]
const customizerObjectSpriteSpec: CellSpriteSpec = {
  characterMemberId: 12,
  paletteMemberId: 11,
  cellMemberId: 13,
  animationMemberId: 14,
}
const customizerAreaPreviewSharedSpec = {
  paletteMemberId: 15,
  cellMemberId: 16,
  animationMemberId: 17,
} as const

const decoratorBackgroundSpecs: readonly BackgroundGroupSpec[] = [
  { characterMemberId: 1, paletteMemberId: 0, screenMemberIds: [2, 3] },
  { characterMemberId: 5, paletteMemberId: 4, screenMemberIds: [6, 7, 8] },
]
const decoratorObjectSpriteSpec: CellSpriteSpec = {
  characterMemberId: 10,
  paletteMemberId: 9,
  cellMemberId: 11,
  animationMemberId: 12,
}

function requireArchive(files: readonly RomFile[], path: string, memberCount: number): RomFile {
  const archive = files.find((file) => file.path === path)
  if (!archive) throw new Error(`L'archive UI Safari ROM ${path} est absente.`)
  if (archive.archiveMembers.length !== memberCount) {
    throw new Error(`L'archive UI Safari ROM ${path} contient ${archive.archiveMembers.length} membres au lieu de ${memberCount}.`)
  }
  return archive
}

function readMember(rom: Uint8Array, archive: RomFile, memberId: number): Uint8Array {
  if (!Number.isInteger(memberId) || memberId < 0) throw new Error(`L'indice UI Safari ROM ${memberId} est invalide.`)
  const member = archive.archiveMembers[memberId]
  if (!member) throw new Error(`Le membre UI Safari ROM ${archive.path}[${memberId}] est absent.`)
  if (member.index !== memberId) throw new Error(`L'archive UI Safari ROM ${archive.path} n'est pas contigue au membre ${memberId}.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre UI Safari ROM ${archive.path}[${memberId}] depasse la ROM.`)
  }
  const packed = rom.subarray(member.offset, member.offset + member.size)
  return decompressLz10(packed) ?? packed
}

function requirePalette(rom: Uint8Array, archive: RomFile, memberId: number): Uint16Array {
  const palette = readNitroPalette(readMember(rom, archive, memberId), 0)
  if (!palette?.length) throw new Error(`La palette UI Safari ROM ${archive.path}[${memberId}] est invalide.`)
  return palette
}

function decodeBackgroundGroup(rom: Uint8Array, archive: RomFile, spec: BackgroundGroupSpec): HgssSafariBackgroundGroup {
  const characterPayload = readMember(rom, archive, spec.characterMemberId)
  const palettePayload = readMember(rom, archive, spec.paletteMemberId)
  const palette = requirePalette(rom, archive, spec.paletteMemberId)
  const layers = spec.screenMemberIds.map((screenMemberId): HgssSafariTilemapLayer => {
    const graphic = decodeNitroTilemapGraphicPayload(
      characterPayload,
      palettePayload,
      readMember(rom, archive, screenMemberId),
      true,
    )
    if (!graphic) {
      throw new Error(`La couche UI Safari ROM ${archive.path}[${spec.characterMemberId}/${spec.paletteMemberId}/${screenMemberId}] est invalide.`)
    }
    return { screenMemberId, graphic }
  })
  return {
    characterMemberId: spec.characterMemberId,
    paletteMemberId: spec.paletteMemberId,
    palette,
    layers,
  }
}

function validateAnimationCells(animation: NitroCellAnimation, frames: readonly NitroGraphic[], label: string): void {
  const missingCell = animation.sequences
    .flatMap(({ frames: sequenceFrames }) => sequenceFrames)
    .find(({ cellIndex }) => !frames[cellIndex])
  if (missingCell) throw new Error(`${label} reference la cellule absente ${missingCell.cellIndex}.`)
}

function decodeCellSprite(rom: Uint8Array, archive: RomFile, spec: CellSpriteSpec): HgssSafariCellSpriteAsset {
  const characterPayload = readMember(rom, archive, spec.characterMemberId)
  const palettePayload = readMember(rom, archive, spec.paletteMemberId)
  const cellPayload = readMember(rom, archive, spec.cellMemberId)
  const animationPayload = readMember(rom, archive, spec.animationMemberId)
  const palette = requirePalette(rom, archive, spec.paletteMemberId)
  const cells = readNitroCells(cellPayload)
  const animation = decodeNitroCellAnimationPayload(animationPayload)
  const label = `La ressource OBJ UI Safari ROM ${archive.path}[${spec.characterMemberId}/${spec.paletteMemberId}/${spec.cellMemberId}/${spec.animationMemberId}]`
  if (!cells?.length || !animation) throw new Error(`${label} est invalide.`)
  const frames = cells.map((_cell, cellIndex) => {
    const graphic = decodeNitroCellGraphicPayload(characterPayload, palettePayload, cellPayload, cellIndex, true)
    if (!graphic) throw new Error(`${label} ne peut pas decoder la cellule ${cellIndex}.`)
    return graphic
  })
  validateAnimationCells(animation, frames, label)
  return {
    ...spec,
    palette,
    cells,
    frames,
    animation,
  }
}

export function decodeHgssSafariUiAssets(rom: Uint8Array, files: readonly RomFile[]): HgssSafariUiAssets {
  const customizerArchive = requireArchive(files, HGSS_SAFARI_CUSTOMIZER_UI_ARCHIVE_PATH, 30)
  const decoratorArchive = requireArchive(files, HGSS_SAFARI_DECORATOR_UI_ARCHIVE_PATH, 13)
  const customizerBackgrounds = customizerBackgroundSpecs.map((spec) => decodeBackgroundGroup(rom, customizerArchive, spec))
  const decoratorBackgrounds = decoratorBackgroundSpecs.map((spec) => decodeBackgroundGroup(rom, decoratorArchive, spec))
  const areaPreviews = Array.from({ length: 12 }, (_, areaId): HgssSafariAreaPreviewAsset => ({
    areaId: areaId as HgssSafariAreaId,
    ...decodeCellSprite(rom, customizerArchive, {
      characterMemberId: areaId + 18,
      ...customizerAreaPreviewSharedSpec,
    }),
  }))
  return {
    customizer: {
      backgroundGroups: customizerBackgrounds,
      objectSprites: decodeCellSprite(rom, customizerArchive, customizerObjectSpriteSpec),
      areaPreviews,
    },
    decorator: {
      backgroundGroups: decoratorBackgrounds,
      objectSprites: decodeCellSprite(rom, decoratorArchive, decoratorObjectSpriteSpec),
    },
  }
}
