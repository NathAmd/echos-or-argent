import type {
  GameDataArchive,
  MapHeaderPreview,
  MapEventPreview,
  MapMatrixPreview,
  MapTerrainPreview,
  NarcMember,
  NitroGraphic,
  NitroAnimationPreview,
  NitroModelPreview,
  NitroSurfacePreview,
  NitroTextureAnimationPreview,
  NitroTexturePreview,
  OpeningMapPreview,
  PlayerGender,
  PlayerTextureFrames,
  ResolvedMapCatalog,
  RomFile,
  RomInventory,
  RomMetadata,
} from './ndsTypes'
import { assertRange, decodeAscii, formatSignature, hasMagic, readUint16, readUint32 } from './core/binaryReader'
import { decompressLz10 } from './rom/lz10'
import { decodeHgssMessageBank, stripMessageControls } from './rom/messages/hgssMessageBank'
import { decodeHgssEasyChatCatalog } from './rom/easyChat/easyChatData'
import { fix32 } from './rom/model/nitroMatrix'
import { decodeNitroMaterialAnimationFrames } from './rom/model/nitroMaterialAnimations'
import { decodeNitroAnimationPreview } from './rom/model/nitroAnimationPreview'
import { decodeNitroModel, decodeNitroModelMember } from './rom/model/nitroModelDecoder'
import { decodeNitroSkeletalAnimationFrame, decodeNitroSkeletalModelFrames } from './rom/model/nitroSkeletalAnimations'
import { decodeNitroPatternModelFrames } from './rom/model/nitroPatternModelFrames'
import { createNitroArchiveAssetResolvers } from './rom/model/nitroArchiveAssetResolver'
import { decodeNitroTextureMember, decodeNitroTextureMemberSet, findNitroTextureByNameInArchive } from './rom/model/nitroTextureResources'
import { readNarcMembers } from './rom/narc'
import { parseNitroFileNames } from './rom/nitrofs'
import { decodeFieldMapTerrain, decodeMapEvents, decodeMapMatrix, decodeMapTerrain, findMapMatrixForHeader } from './rom/maps/mapData'
import { getMapMatrixRenderWindow, mapMatrixAltitudeStep, type MapMatrixFootprint } from './rom/maps/mapFootprint'
import { collectConnectedMapIds } from './rom/maps/mapGraph'
import { decodeRomMapHeaders } from './rom/maps/mapHeaders'
import { decodeFieldCameraParamsFromRom } from './rom/maps/fieldCamera'
import { decodeMapPropAnimationMetadata } from './rom/model/mapPropAnimationMetadata'
import { decodeHgssPokegearMapData } from './rom/pokegear/mapData'
import { buildMapEncounterLandmarkIndex } from './rom/pokegear/mapEncounterLandmarks'
import { orderAreaMapPropDomains, resolveAreaMapPropDomains } from './rom/maps/areaMapPropDomain'
import { decodeEventTextureResources, decodePlayerTextureFrames } from './rom/overworld/actorTextureResources'
import { decodePokemonFollowerCatalog } from './rom/overworld/followerParameters'
import { decodeHgssFollowerReactionCatalog } from './rom/overworld/followerReactions'
import { createFollowerEmoteResolver, createFollowerTextureResolver } from './rom/overworld/followerTextureResources'
import { decodeHgssGrassTextureTimeline, type HgssGrassEffectKind } from './rom/overworld/grassEffects'
import {
  HGSS_FISHING_BITE_EFFECT_MODEL_MEMBER,
  HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER,
  HGSS_FISHING_BITE_EFFECT_TIMELINE_MEMBER,
  HGSS_FISHING_BITE_RESOURCE_TIMELINE,
} from './game/encounters/hgssFishingBiteEffect'
import { createHgssBlackoutResolvers } from './rom/overworld/blackoutSpawns'
import { decodePokemonGrowthTableCatalog } from './rom/pokemon/growthTable'
import { decodeHgssSplParticleResource } from './rom/battle/splParticleResources'
import { decodePokemonLevelUpLearnsetCatalog } from './rom/pokemon/levelUpLearnset'
import { decodePokemonEvolutionCatalog } from './rom/pokemon/evolutionData'
import { decodePokemonMoveCatalog } from './rom/pokemon/moveData'
import { decodePokemonPersonalCatalog } from './rom/pokemon/personalData'; import { decodeHgssPokeathlonPerformanceCatalog } from './rom/pokemon/pokeathlonPerformance'
import { createPokemonArchiveRegistry } from './rom/pokemon/pokemonArchiveRegistry'
import { decodeFieldScriptBank, decodeMapInitScripts } from './rom/scripts/fieldScripts'
import { decodeHgssPhoneBook, hgssPhoneMessageBanks } from './rom/phone/phoneBook'
import { decodeNitroGraphic, decodeNitroGraphicPayload, decodeNitroTilemapGraphicPayload, findGraphicPreview } from './rom/graphics/nitro2d'
import { decodeNitroCellGraphicPayload } from './rom/graphics/nitroCells'
import { decodeNitroCellAnimationPayload } from './rom/graphics/nitroCellAnimations'
import { decodeHgssTrainerCatalog } from './rom/battle/trainerData'
import { decodeHgssTrainerMessageCatalog } from './rom/battle/trainerMessages'
import { createHgssTrainerBattleSpriteResolver } from './rom/battle/trainerBattleSprites'
import { decodeHgssWildEncounterCatalog } from './rom/encounters/wildEncounterData'
import { decodeHgssSafariEncounterCatalog, HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH } from './rom/safari/safariEncounterData'
import { decodeHgssPhotoDataCatalog, HGSS_PHOTO_DATA_ARCHIVE_PATH } from './rom/photo/photoData'
import { decodeHgssPokedexCatalog, decodeHgssPokemonWeights } from './rom/pokedex/pokedexData'
import { decodeHgssItemCatalog } from './rom/items/itemData'
import { createHgssItemIconResolver } from './rom/items/itemIcons'
import { decodeHgssUiAssets } from './rom/ui/hgssUiAssets'
import { decodeHgssSafariUiAssets } from './rom/safari/safariUiAssets'
import { createPokemonIconResolver } from './rom/pokemon/pokemonIcons'
import { createBattlePokemonSpriteResolver } from './rom/pokemon/battlePokemonSprites'
import { decodeHgssNpcTradeCatalog } from './rom/pokemon/npcTradeData'
import { createHgssBattleBackgroundResolver } from './rom/battle/battleBackgrounds'
import { decodeHgssCamouflageTypeIds, decodeHgssNaturePowerMoveIds, decodeHgssSecretPowerEffectIds } from './rom/battle/naturePower'
import { decodeHgssPokemonSummaryNames } from './rom/pokemon/pokemonSummaryMessages'
import { decodeHgssBattleAnimationCatalog, HGSS_BATTLE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_ANIMATION_RESOURCE_PATHS, HGSS_MOVE_ANIMATION_ARCHIVE_PATH } from './rom/battle/battleAnimationScripts'
import { createHgssBattleParticleResourceResolver, HGSS_BATTLE_PARTICLE_ARCHIVE_PATH } from './rom/battle/splParticleResources'
import { createHgssBattleSpriteResourceResolver, HGSS_BATTLE_SPRITE_ANIMATION_ARCHIVE_PATH, HGSS_BATTLE_SPRITE_CELL_ARCHIVE_PATH, HGSS_BATTLE_SPRITE_CHARACTER_ARCHIVE_PATH, HGSS_BATTLE_SPRITE_PALETTE_ARCHIVE_PATH } from './rom/battle/battleSpriteResources'
import { decodePhoneContactNames } from './rom/pokegear/phoneContacts'
import { decodeHgssPrizeMoneyTable } from './rom/battle/prizeMoney'
import { createHgssMapVariantResolver } from './rom/maps/hgssMapVariants'
import { resolveMapLabel, usesWorldMatrixCoordinates } from './rom/maps/resolvedMapSupport'
import { hgssRadioMessageBanks } from './rom/pokegear/radioPrograms'
export type {
  GameDataArchive,
  MapHeaderPreview,
  MapEventPreview,
  MapMatrixPreview,
  MapTerrainPreview,
  NarcMember,
  NitroGraphic,
  NitroAnimationPreview,
  NitroModelPreview,
  NitroSurfacePreview,
  NitroTextureAnimationPreview,
  NitroTexturePreview,
  OpeningMapPreview,
  PlayerDirection,
  PlayerGender,
  PlayerTextureFrames,
  RomFile,
  RomInventory,
  RomMetadata,
  RomResourceCatalog,
} from './ndsTypes'
const HEADER_LENGTH = 0x200
const DIRECTORY_ENTRY_SIZE = 8
export async function readRomMetadata(file: File): Promise<RomMetadata> {
  if (!file.name.toLowerCase().endsWith('.nds')) {
    throw new Error('Selectionnez un fichier avec l’extension .nds.')
  }
  if (file.size < HEADER_LENGTH) {
    throw new Error('Ce fichier est trop petit pour contenir un en-tete Nintendo DS.')
  }
  const buffer = await file.slice(0, HEADER_LENGTH).arrayBuffer()
  const header = new Uint8Array(buffer)
  const title = decodeAscii(header.slice(0x00, 0x0c))
  const gameCode = decodeAscii(header.slice(0x0c, 0x10))
  const makerCode = decodeAscii(header.slice(0x10, 0x12))
  if (!title || !/^[A-Z0-9]{4}$/.test(gameCode)) {
    throw new Error('L’en-tete du fichier ne correspond pas a une ROM Nintendo DS lisible.')
  }
  return {
    fileName: file.name,
    fileSize: file.size,
    title,
    gameCode,
    makerCode,
    unitCode: header[0x12],
  }
}
function readArchiveMemberPayload(bytes: Uint8Array, member: NarcMember): Uint8Array {
  const payload = bytes.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

function decodeArchiveTilemapGraphic(bytes: Uint8Array, archive: RomFile | undefined, graphicIndex: number, paletteIndex: number, screenIndex: number, color0Transparent = true, forcedPaletteBank?: number): NitroGraphic | undefined {
  const graphicMember = archive?.archiveMembers[graphicIndex]
  const paletteMember = archive?.archiveMembers[paletteIndex]
  const screenMember = archive?.archiveMembers[screenIndex]
  if (!graphicMember || !paletteMember || !screenMember) return undefined
  const graphicPayload = readArchiveMemberPayload(bytes, graphicMember)
  const palettePayload = readArchiveMemberPayload(bytes, paletteMember)
  const screenPayload = readArchiveMemberPayload(bytes, screenMember)
  return decodeNitroTilemapGraphicPayload(graphicPayload, palettePayload, screenPayload, color0Transparent, forcedPaletteBank)
}

function decodeArchiveCellGraphic(bytes: Uint8Array, archive: RomFile | undefined, graphicIndex: number, paletteIndex: number, cellIndex: number, cellFrameIndex = 0, color0Transparent = true): NitroGraphic | undefined {
  const graphicMember = archive?.archiveMembers[graphicIndex]
  const paletteMember = archive?.archiveMembers[paletteIndex]
  const cellMember = archive?.archiveMembers[cellIndex]
  if (!graphicMember || !paletteMember || !cellMember) return undefined

  const graphicPayload = readArchiveMemberPayload(bytes, graphicMember)
  const palettePayload = readArchiveMemberPayload(bytes, paletteMember)
  const cellPayload = readArchiveMemberPayload(bytes, cellMember)
  return decodeNitroCellGraphicPayload(graphicPayload, palettePayload, cellPayload, cellFrameIndex, color0Transparent)
}

function createCompositeGraphic(width: number, height: number): NitroGraphic {
  return {
    width,
    height,
    pixels: new Uint8ClampedArray(width * height * 4),
    graphicsOffset: 0,
    paletteOffset: 0,
    colorDepth: 0,
  }
}

function fillGraphic(graphic: NitroGraphic, red: number, green: number, blue: number, alpha = 255): void {
  for (let offset = 0; offset < graphic.pixels.length; offset += 4) {
    graphic.pixels[offset] = red
    graphic.pixels[offset + 1] = green
    graphic.pixels[offset + 2] = blue
    graphic.pixels[offset + 3] = alpha
  }
}

function blitGraphic(target: NitroGraphic, source: NitroGraphic | undefined, x: number, y: number, sourceX = 0, sourceY = 0, width = source?.width ?? 0, height = source?.height ?? 0): void {
  if (!source) return
  const startX = Math.max(0, Math.floor(sourceX))
  const startY = Math.max(0, Math.floor(sourceY))
  const endX = Math.min(source.width, startX + Math.max(0, Math.floor(width)))
  const endY = Math.min(source.height, startY + Math.max(0, Math.floor(height)))
  for (let py = startY; py < endY; py += 1) {
    const targetY = y + py - startY
    if (targetY < 0 || targetY >= target.height) continue
    for (let px = startX; px < endX; px += 1) {
      const targetX = x + px - startX
      if (targetX < 0 || targetX >= target.width) continue
      const sourceOffset = (py * source.width + px) * 4
      const alpha = source.pixels[sourceOffset + 3]
      if (alpha === 0) continue
      const targetOffset = (targetY * target.width + targetX) * 4
      if (alpha === 255) {
        target.pixels[targetOffset] = source.pixels[sourceOffset]
        target.pixels[targetOffset + 1] = source.pixels[sourceOffset + 1]
        target.pixels[targetOffset + 2] = source.pixels[sourceOffset + 2]
        target.pixels[targetOffset + 3] = 255
        continue
      }
      const inverse = 255 - alpha
      target.pixels[targetOffset] = Math.round((source.pixels[sourceOffset] * alpha + target.pixels[targetOffset] * inverse) / 255)
      target.pixels[targetOffset + 1] = Math.round((source.pixels[sourceOffset + 1] * alpha + target.pixels[targetOffset + 1] * inverse) / 255)
      target.pixels[targetOffset + 2] = Math.round((source.pixels[sourceOffset + 2] * alpha + target.pixels[targetOffset + 2] * inverse) / 255)
      target.pixels[targetOffset + 3] = Math.max(target.pixels[targetOffset + 3], alpha)
    }
  }
}

type TitleScreenPreview = {
  composite: NitroGraphic
  background?: NitroGraphic
  logo?: NitroGraphic
  credit?: NitroGraphic
}

function decodeTitleScreenPreview(bytes: Uint8Array, titleArchive: RomFile | undefined): TitleScreenPreview | undefined {
  const background = decodeArchiveTilemapGraphic(bytes, titleArchive, 34, 4, 35, false)
  const logo = decodeArchiveTilemapGraphic(bytes, titleArchive, 3, 4, 0, true)
  const credit = decodeArchiveTilemapGraphic(bytes, titleArchive, 15, 13, 17, true)
    ?? decodeArchiveTilemapGraphic(bytes, titleArchive, 15, 16, 17, true)
  if (!background && !logo && !credit) return undefined

  const composite = createCompositeGraphic(256, 384)
  fillGraphic(composite, 0, 0, 0)
  blitGraphic(composite, background, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, logo, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, credit, 0, 0, 0, 0, 256, 192)
  return { composite, background, logo, credit }
}

function decodeIntroGenderScreenPreview(bytes: Uint8Array, introArchive: RomFile | undefined): NitroGraphic | undefined {
  const topBackground = decodeArchiveTilemapGraphic(bytes, introArchive, 0, 2, 3, false)
  const oak = decodeArchiveTilemapGraphic(bytes, introArchive, 10, 11, 9, true)
  const genderSelect = decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 51, false)
  const boy = decodeArchiveCellGraphic(bytes, introArchive, 12, 16, 55, 0, true)
  const girl = decodeArchiveCellGraphic(bytes, introArchive, 17, 21, 55, 0, true)
  if (!topBackground && !oak && !genderSelect && !boy && !girl) return undefined

  const composite = createCompositeGraphic(256, 384)
  fillGraphic(composite, 77, 104, 218)
  blitGraphic(composite, topBackground, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, oak, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, genderSelect, 0, 192, 0, 0, 256, 192)
  blitGraphic(composite, boy, 64 - Math.floor((boy?.width ?? 0) / 2), 192 + 104 - Math.floor((boy?.height ?? 0) / 2))
  blitGraphic(composite, girl, 192 - Math.floor((girl?.width ?? 0) / 2), 192 + 104 - Math.floor((girl?.height ?? 0) / 2))
  return composite
}

function decodeIntroOakScreenPreview(bytes: Uint8Array, introArchive: RomFile | undefined): NitroGraphic | undefined {
  const topBackground = decodeArchiveTilemapGraphic(bytes, introArchive, 0, 2, 3, false)
  const oak = decodeArchiveTilemapGraphic(bytes, introArchive, 10, 11, 9, true)
  const lowerBackground = decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 44, false)
    ?? decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 43, false)
  if (!topBackground && !oak && !lowerBackground) return undefined

  const composite = createCompositeGraphic(256, 384)
  fillGraphic(composite, 77, 104, 218)
  blitGraphic(composite, topBackground, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, oak, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, lowerBackground, 0, 192, 0, 0, 256, 192)
  return composite
}

function decodeIntroSceneAssets(bytes: Uint8Array, introArchive: RomFile | undefined): Pick<RomInventory,
  | 'introTopBackgroundGraphic'
  | 'introOakSpriteGraphic'
  | 'introMarillGraphic'
  | 'introMarillSprite'
  | 'introLowerBackgroundGraphic'
  | 'introTutorialBackgroundGraphics'
  | 'introGenderBackgroundGraphic'
  | 'introBoyGraphic'
  | 'introGirlGraphic'
  | 'introBoyShrinkGraphics'
  | 'introGirlShrinkGraphics'
> {
  const decodePortrait = (graphicIndex: number, paletteIndex: number) =>
    decodeArchiveTilemapGraphic(bytes, introArchive, graphicIndex, paletteIndex, 9, true, 7)
  const boyShrink = [12, 22, 23, 24, 25].map((graphic) => decodePortrait(graphic, 16))
  const girlShrink = [17, 26, 27, 28, 29].map((graphic) => decodePortrait(graphic, 21))
  // The full-size gender portraits are OBJ resources. Palette bank 7 from the
  // shrink BG sequence is intentionally a black transition silhouette and
  // must not be reused by the interactive gender selector.
  const boyPortrait = decodeArchiveCellGraphic(bytes, introArchive, 12, 16, 55, 0, true)
  const girlPortrait = decodeArchiveCellGraphic(bytes, introArchive, 17, 21, 55, 0, true)
  const marillAnimationMember = introArchive?.archiveMembers[66]
  const marillAnimation = marillAnimationMember
    ? decodeNitroCellAnimationPayload(readArchiveMemberPayload(bytes, marillAnimationMember))
    : undefined
  const marillFrameCount = marillAnimation
    ? Math.max(...marillAnimation.sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.cellIndex))) + 1
    : 0
  const marillFrames = Array.from({ length: marillFrameCount }, (_, frame) =>
    decodeArchiveCellGraphic(bytes, introArchive, 64, 63, 65, frame, true))
  return {
    introTopBackgroundGraphic: decodeArchiveTilemapGraphic(bytes, introArchive, 0, 2, 3, false),
    introOakSpriteGraphic: decodeArchiveTilemapGraphic(bytes, introArchive, 10, 11, 9, true),
    // resdat resource set 5 resolves to intro members 64/65/63 (char/cell/palette).
    introMarillGraphic: decodeArchiveCellGraphic(bytes, introArchive, 64, 63, 65, 0, true),
    introMarillSprite: marillAnimation && marillFrames.every((frame) => frame !== undefined)
      ? { animation: marillAnimation, frames: marillFrames as NitroGraphic[] }
      : undefined,
    introLowerBackgroundGraphic: decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 44, false)
      ?? decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 43, false),
    introTutorialBackgroundGraphics: [3, 4, 5, 6, 7, 8]
      .map((screen) => decodeArchiveTilemapGraphic(bytes, introArchive, 0, 2, screen, false))
      .filter((graphic): graphic is NitroGraphic => graphic !== undefined),
    introGenderBackgroundGraphic: decodeArchiveTilemapGraphic(bytes, introArchive, 32, 31, 51, false),
    introBoyGraphic: boyPortrait ?? boyShrink[0],
    introGirlGraphic: girlPortrait ?? girlShrink[0],
    introBoyShrinkGraphics: boyShrink.filter((graphic): graphic is NitroGraphic => graphic !== undefined),
    introGirlShrinkGraphics: girlShrink.filter((graphic): graphic is NitroGraphic => graphic !== undefined),
  }
}

function decodeOpeningMovieGraphics(bytes: Uint8Array, archive: RomFile | undefined): NitroGraphic[] {
  if (!archive || archive.archiveMembers.length < 106) return []
  // Associations NCGR/NCLR/NSCR utilisées par intro_movie_scene_1..5 dans HG.
  return [
    decodeArchiveTilemapGraphic(bytes, archive, 5, 1, 13, false),
    decodeArchiveTilemapGraphic(bytes, archive, 4, 0, 12, false),
    decodeArchiveTilemapGraphic(bytes, archive, 7, 1, 18, false),
    decodeArchiveTilemapGraphic(bytes, archive, 33, 32, 35, false),
    decodeArchiveTilemapGraphic(bytes, archive, 40, 39, 47, false),
    decodeArchiveTilemapGraphic(bytes, archive, 54, 53, 58, false),
    decodeArchiveTilemapGraphic(bytes, archive, 60, 31, 62, false),
  ].filter((graphic): graphic is NitroGraphic => graphic !== undefined)
}

function decodeOpeningMovieSceneGraphics(bytes: Uint8Array, archive: RomFile | undefined): NitroGraphic[][] {
  if (!archive || archive.archiveMembers.length < 106) return []
  const decode = (graphic: number, palette: number, screen: number, transparent = false) =>
    decodeArchiveTilemapGraphic(bytes, archive, graphic, palette, screen, transparent)
  return [
    [
      // Scene 1: copyright, Game Freak, then the layered HG sunrise.
      decode(4, 0, 12), decode(5, 1, 13), decode(4, 0, 14, true),
      decode(6, 0, 15), decode(7, 1, 18), decode(7, 1, 17, true), decode(7, 1, 16, true),
    ],
    [
      // Scene 2 keeps a dedicated character/palette pair for the lower landscape.
      decode(33, 32, 35), decode(34, 31, 36), decode(33, 32, 37, true), decode(33, 32, 38, true),
    ],
    [
      ...[42, 43, 44, 45, 46, 47, 48, 49].map((screen) => decode(40, 39, screen, screen !== 42)),
      ...[50, 51, 52].map((screen) => decode(41, 39, screen, true)),
    ],
    [
      decode(54, 53, 58), decode(54, 53, 55, true),
      decode(54, 53, 56, true), decode(54, 53, 57),
    ],
    [
      decode(59, 39, 61), decode(59, 39, 63, true),
      decode(60, 31, 64), decode(60, 31, 62, true),
    ],
  ].map((scene) => scene.filter((graphic): graphic is NitroGraphic => graphic !== undefined))
}

function decodeOpeningMovieSprites(bytes: Uint8Array, archive: RomFile | undefined): NonNullable<RomInventory['openingMovieSprites']> {
  if (!archive || archive.archiveMembers.length < 97) return []
  const groups = [
    [24, 23, 25, 26], [28, 27, 29, 30],
    [66, 65, 67, 68], [70, 69, 71, 72], [74, 73, 75, 76], [78, 77, 79, 80],
    [82, 81, 83, 84], [86, 85, 87, 88], [90, 89, 91, 92], [94, 93, 95, 96],
  ] as const
  return groups.flatMap(([graphicIndex, paletteIndex, animationIndex, cellIndex]) => {
    const animationMember = archive.archiveMembers[animationIndex]
    if (!animationMember) return []
    const animation = decodeNitroCellAnimationPayload(readArchiveMemberPayload(bytes, animationMember))
    if (!animation) return []
    const cellIndexes = animation.sequences.flatMap((sequence) => sequence.frames.map((frame) => frame.cellIndex))
    const frameCount = Math.max(-1, ...cellIndexes) + 1
    const frames = Array.from({ length: frameCount }, (_, frameIndex) =>
      decodeArchiveCellGraphic(bytes, archive, graphicIndex, paletteIndex, cellIndex, frameIndex, true))
    if (frames.some((frame) => !frame)) return []
    return [{ animation, frames: frames as NitroGraphic[] }]
  })
}

function mergeNitroModels(models: (NitroModelPreview | undefined)[]): NitroModelPreview | undefined {
  const available = models.filter((model): model is NitroModelPreview => model !== undefined)
  if (available.length === 0) return undefined
  return {
    modelId: available[0].modelId,
    vertexCount: available.reduce((sum, model) => sum + model.vertexCount, 0),
    triangleCount: available.reduce((sum, model) => sum + model.triangleCount, 0),
    quadCount: available.reduce((sum, model) => sum + model.quadCount, 0),
    materialCount: available.reduce((sum, model) => sum + model.materialCount, 0),
    pieceCount: available.reduce((sum, model) => sum + model.pieceCount, 0),
    surfaces: available.flatMap((model) => model.surfaces ?? []),
    textures: available.flatMap((model) => model.textures ?? []),
  }
}

function decodeNameInputScreenPreview(bytes: Uint8Array, nameInputArchive: RomFile | undefined): NitroGraphic | undefined {
  const topBackground = decodeArchiveTilemapGraphic(bytes, nameInputArchive, 2, 0, 4, false)
    ?? decodeArchiveTilemapGraphic(bytes, nameInputArchive, 2, 1, 4, false)
  const bottomBackground = decodeArchiveTilemapGraphic(bytes, nameInputArchive, 10, 1, 18, false)
    ?? decodeArchiveTilemapGraphic(bytes, nameInputArchive, 10, 1, 17, false)
    ?? decodeArchiveTilemapGraphic(bytes, nameInputArchive, 2, 0, 5, false)
    ?? decodeArchiveTilemapGraphic(bytes, nameInputArchive, 2, 1, 5, false)
  if (!topBackground && !bottomBackground) return undefined

  const composite = createCompositeGraphic(256, 384)
  fillGraphic(composite, 0, 0, 0)
  blitGraphic(composite, topBackground, 0, 0, 0, 0, 256, 192)
  blitGraphic(composite, bottomBackground, 0, 192, 0, 0, 256, 192)
  return composite
}

function decodeRomFontGraphic(bytes: Uint8Array, files: RomFile[]): NitroGraphic | undefined {
  const graphicFile = files.find((file) => file.path === '/data/nfont.NCGR')
  const paletteFile = files.find((file) => file.path === '/data/nfont.NCLR')
  if (!graphicFile || !paletteFile) return undefined
  return decodeNitroGraphic(bytes, graphicFile.offset, paletteFile.offset, true)
}

function scoreNitroGraphicPreview(graphic: NitroGraphic): number {
  const colorCounts = new Map<number, number>()
  let visiblePixels = 0
  let saturationTotal = 0
  const stride = Math.max(4, Math.floor((graphic.width * graphic.height) / 4096) * 4)
  for (let offset = 0; offset < graphic.pixels.length; offset += stride) {
    const alpha = graphic.pixels[offset + 3]
    if (alpha < 32) continue
    visiblePixels += 1
    const red = graphic.pixels[offset]
    const green = graphic.pixels[offset + 1]
    const blue = graphic.pixels[offset + 2]
    const color = (red << 16) | (green << 8) | blue
    saturationTotal += (Math.max(red, green, blue) - Math.min(red, green, blue)) / 255
    colorCounts.set(color, (colorCounts.get(color) ?? 0) + 1)
  }
  const aspect = graphic.width / Math.max(1, graphic.height)
  const aspectScore = Math.max(0.2, 1 - Math.min(1, Math.abs(aspect - 4 / 3) / (4 / 3)))
  const uniqueScore = Math.log2(colorCounts.size + 1)
  const coverageScore = visiblePixels / Math.max(1, Math.ceil(graphic.pixels.length / stride))
  const saturationScore = saturationTotal / Math.max(1, visiblePixels)
  return aspectScore * 12 + uniqueScore * 10 + coverageScore * 6 + saturationScore * 42
}

function findArchiveGraphicPreview(bytes: Uint8Array, archive: RomFile | undefined, preferLargest = false): NitroGraphic | undefined {
  if (!archive) return undefined
  const payloads = archive.archiveMembers.map((member) => ({
    member,
    payload: readArchiveMemberPayload(bytes, member),
  }))
  const palettes = payloads.filter(({ payload }) => hasMagic(payload, 0, 'RLCN'))
  const screenMaps = payloads.filter(({ payload }) => hasMagic(payload, 0, 'RCSN'))
  let best: NitroGraphic | undefined
  let bestScore = -Infinity
  for (const graphicMember of payloads) {
    if (!hasMagic(graphicMember.payload, 0, 'RGCN')) continue
    const candidatePalettes = palettes
      .map((palette) => ({ ...palette, distance: Math.abs(palette.member.index - graphicMember.member.index) }))
      .sort((left, right) => left.distance - right.distance)
    const candidateScreens = screenMaps
      .map((screenMap) => ({ ...screenMap, distance: Math.abs(screenMap.member.index - graphicMember.member.index) }))
      .sort((left, right) => left.distance - right.distance)
    for (const paletteMember of candidatePalettes) {
      const tilemappedGraphic = candidateScreens
        .map((screenMap) => decodeNitroTilemapGraphicPayload(graphicMember.payload, paletteMember.payload, screenMap.payload))
        .find((graphic): graphic is NitroGraphic => Boolean(graphic))
      const graphic = tilemappedGraphic ?? decodeNitroGraphicPayload(graphicMember.payload, paletteMember.payload)
      if (!graphic) continue
      if (!preferLargest) return graphic
      const score = scoreNitroGraphicPreview(graphic)
      if (!best || score > bestScore) {
        best = graphic
        bestScore = score
      }
      break
    }
  }
  return best
}

function findBestArchiveGraphicPreview(bytes: Uint8Array, archives: Array<RomFile | undefined>): NitroGraphic | undefined {
  let best: NitroGraphic | undefined
  let bestScore = -Infinity
  for (const archive of archives) {
    const graphic = findArchiveGraphicPreview(bytes, archive, true)
    if (!graphic) continue
    const score = scoreNitroGraphicPreview(graphic)
    if (!best || score > bestScore) {
      best = graphic
      bestScore = score
    }
  }
  return best
}

function decodeMessageBank(bytes: Uint8Array, archive: RomFile | undefined, memberIndex: number): Record<number, string> | undefined {
  const member = archive?.archiveMembers[memberIndex]
  return decodeHgssMessageBank(bytes, member)
}

const hgssGrassEffectMembers: Record<HgssGrassEffectKind, { model: number, timeline: number, texture: number }> = {
  tallGrass: { model: 126, timeline: 140, texture: 25 },
  veryTallGrass: { model: 122, timeline: 146, texture: 21 },
}

function createGrassEffectResolver(bytes: Uint8Array, archive: RomFile): RomInventory['grassEffectResolver'] {
  const cache = new Map<HgssGrassEffectKind, ReturnType<RomInventory['grassEffectResolver']>>()
  return (kind) => {
    const cached = cache.get(kind)
    if (cached) return cached
    const members = hgssGrassEffectMembers[kind]
    const model = decodeNitroModel(bytes, archive, members.model, false, undefined, false)
    const textures = decodeNitroTextureMemberSet(bytes, archive, members.texture)
    const timelineMember = archive.archiveMembers[members.timeline]
    if (!model?.surfaces?.length || textures.length === 0 || !timelineMember) {
      throw new Error(`Les ressources ROM de l'effet ${kind} sont incompletes dans ${archive.path}.`)
    }
    const timeline = decodeHgssGrassTextureTimeline(readArchiveMemberPayload(bytes, timelineMember))
    if (timeline.textureIndexes.some((textureIndex) => textureIndex >= textures.length)) {
      throw new Error(`L'effet ${kind} reference une texture BTX absente.`)
    }
    if (timeline.paletteIndexes.some((paletteIndex, index) => paletteIndex !== 0 && paletteIndex !== timeline.textureIndexes[index])) {
      throw new Error(`L'effet ${kind} reference une combinaison texture/palette BTX non decodee.`)
    }
    const resolved = { kind, model, textures, timeline }
    cache.set(kind, resolved)
    return resolved
  }
}

function createFishingBiteEffectResolver(bytes: Uint8Array, archive: RomFile): RomInventory['fishingBiteEffectResolver'] {
  let cached: ReturnType<RomInventory['fishingBiteEffectResolver']> | undefined
  return () => {
    if (cached) return cached
    const model = decodeNitroModel(bytes, archive, HGSS_FISHING_BITE_EFFECT_MODEL_MEMBER, false, undefined, false)
    const textures = decodeNitroTextureMemberSet(bytes, archive, HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER)
    const timelineMember = archive.archiveMembers[HGSS_FISHING_BITE_EFFECT_TIMELINE_MEMBER]
    if (!model?.surfaces?.length || textures.length === 0 || !timelineMember) {
      throw new Error(`Les ressources ROM de la touche de peche sont incompletes dans ${archive.path}.`)
    }
    const timeline = decodeHgssGrassTextureTimeline(readArchiveMemberPayload(bytes, timelineMember))
    const expected = HGSS_FISHING_BITE_RESOURCE_TIMELINE
    if (timeline.keyFrames.length !== expected.keyFrames.length
      || timeline.textureIndexes.length !== expected.textureAddressOffsets.length
      || timeline.paletteIndexes.length !== expected.paletteAddressOffsets.length
      || timeline.keyFrames.some((frame, index) => frame !== expected.keyFrames[index])
      || timeline.textureIndexes.some((offset, index) => offset !== expected.textureAddressOffsets[index])
      || timeline.paletteIndexes.some((offset, index) => offset !== expected.paletteAddressOffsets[index])) {
      throw new Error(`La timeline ROM de la touche de peche de ${archive.path} ne correspond pas a ov01_02200540.`)
    }
    if (textures.length !== 1) throw new Error(`La touche de peche HGSS attend une seule texture BTX dans le membre ${HGSS_FISHING_BITE_EFFECT_TEXTURE_MEMBER}.`)
    const texture = textures[0]!
    cached = {
      model,
      texture,
      timeline: {
        keyFrames: timeline.keyFrames,
        textureAddressOffsets: timeline.textureIndexes,
        paletteAddressOffsets: timeline.paletteIndexes,
      },
    }
    return cached
  }
}

function transformFieldFloat3(source: Float32Array, offsetX: number, offsetY: number, offsetZ: number, cellSize: number, unitsPerTile = 16): Float32Array {
  const output = new Float32Array(source.length)
  const halfCell = cellSize / 2
  for (let index = 0; index < source.length; index += 3) {
    output[index] = source[index] / unitsPerTile + offsetX + halfCell
    output[index + 1] = source[index + 1] / unitsPerTile + offsetY
    output[index + 2] = source[index + 2] / unitsPerTile + offsetZ + halfCell
  }
  return output
}

function transformLocalMatrixFloat3(
  source: Float32Array,
  cellX: number,
  cellZ: number,
  footprint: MapMatrixFootprint,
  offsetY: number,
  cellSize = 32,
  unitsPerTile = 16,
): Float32Array {
  const output = new Float32Array(source.length)
  const offsetX = ((cellX - footprint.minCellX) - (footprint.widthCells - 1) / 2) * cellSize * unitsPerTile
  const offsetZ = ((cellZ - footprint.minCellZ) - (footprint.heightCells - 1) / 2) * cellSize * unitsPerTile
  for (let index = 0; index < source.length; index += 3) {
    output[index] = source[index] + offsetX
    output[index + 1] = source[index + 1] + offsetY
    output[index + 2] = source[index + 2] + offsetZ
  }
  return output
}

function prefixTextureId(modelId: number | string, textureId: string): string {
  return `${modelId}:${textureId}`
}

function transformRoomFloat3(source: Float32Array, cellX: number, cellZ: number, rotation: number, cellSize = 16): Float32Array {
  const output = new Float32Array(source.length)
  const angle = ((rotation & 3) * Math.PI) / 2
  const cos = Math.cos(angle)
  const sin = Math.sin(angle)
  const offsetX = cellX * cellSize
  const offsetZ = cellZ * cellSize
  for (let index = 0; index < source.length; index += 3) {
    const x = source[index]
    const z = source[index + 2]
    output[index] = x * cos - z * sin + offsetX
    output[index + 1] = source[index + 1]
    output[index + 2] = x * sin + z * cos + offsetZ
  }
  return output
}

function decodeFieldMapModel(
  bytes: Uint8Array,
  matrix: MapMatrixPreview,
  landDataArchive: RomFile | undefined,
  areaDataArchive: RomFile | undefined,
  mapTextureArchive: RomFile | undefined,
  propTextureArchive: RomFile | undefined,
  areaDataBank: number,
  mapId: number,
  worldCoordinates = true,
): NitroModelPreview | undefined {
  if (!landDataArchive || !areaDataArchive || !mapTextureArchive || !propTextureArchive) return undefined

  // MapLoadManager n'affiche que quatre parcelles sur les petits écrans DS.
  // Notre caméra mono-écran peut voir au-delà de ce quadrant : on prédécode donc
  // une marge d'une cellule et le runtime garde cette fenêtre stable pour éviter
  // qu'une rangée d'arbres ne poppe à la moitié d'une parcelle.
  const renderWindow = getMapMatrixRenderWindow(mapId, matrix)
  if (!renderWindow) return undefined

  const { footprint, minCellX, maxCellX, minCellZ, maxCellZ } = renderWindow
  const cellSize = 32
  const fieldUnitsPerTile = 16
  const modelCache = new Map<number, NitroModelPreview | undefined>()
  const textureMap = new Map<string, NitroTexturePreview>()
  const surfaces: NitroSurfacePreview[] = []
  const mapProps: NonNullable<NitroModelPreview['mapProps']> = []
  const positionValues: number[] = []
  let vertexCount = 0
  let triangleCount = 0
  let quadCount = 0
  let materialCount = 0
  let pieceCount = 0

  const readModel = (modelId: number): NitroModelPreview | undefined => {
    if (!modelCache.has(modelId)) {
      modelCache.set(modelId, decodeLandDataModel(
        bytes,
        landDataArchive,
        areaDataArchive,
        mapTextureArchive,
        propTextureArchive,
        modelId,
        areaDataBank,
      ))
    }
    return modelCache.get(modelId)
  }

  for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      const mapMatrixCellIndex = cellZ * matrix.width + cellX
      const modelId = matrix.modelIds[mapMatrixCellIndex]
      if (modelId === 0xffff) continue
      const model = readModel(modelId)
      if (!model?.positions || !model.surfaces || model.surfaces.length === 0) continue

      const offsetX = (cellX - footprint.minCellX) * cellSize
      const offsetZ = (cellZ - footprint.minCellZ) * cellSize
      const offsetY = (matrix.altitudes[cellZ * matrix.width + cellX] ?? 0) * mapMatrixAltitudeStep
      vertexCount += model.vertexCount
      triangleCount += model.triangleCount
      quadCount += model.quadCount
      materialCount += model.materialCount
      pieceCount += model.pieceCount

      for (const texture of model.textures ?? []) {
        const id = prefixTextureId(model.modelId, texture.id)
        if (!textureMap.has(id)) textureMap.set(id, { ...texture, id })
      }

      for (const surface of model.surfaces) {
        const positions = worldCoordinates
          ? transformFieldFloat3(surface.positions, offsetX, offsetY, offsetZ, cellSize, fieldUnitsPerTile)
          : transformLocalMatrixFloat3(surface.positions, cellX, cellZ, footprint, offsetY, cellSize, fieldUnitsPerTile)
        positionValues.push(...positions)
        surfaces.push({
          ...surface,
          mapMatrixCellIndex: worldCoordinates ? mapMatrixCellIndex : undefined,
          textureId: surface.textureId ? prefixTextureId(model.modelId, surface.textureId) : undefined,
          positions,
          colors: surface.colors ? new Float32Array(surface.colors) : undefined,
          uvs: surface.uvs ? new Float32Array(surface.uvs) : undefined,
        })
      }
      for (const prop of model.mapProps ?? []) {
        const localOffsetX = ((cellX - footprint.minCellX) - (footprint.widthCells - 1) / 2) * cellSize * fieldUnitsPerTile
        const localOffsetZ = ((cellZ - footprint.minCellZ) - (footprint.heightCells - 1) / 2) * cellSize * fieldUnitsPerTile
        const worldProp = {
          ...prop,
          mapMatrixCellIndex: worldCoordinates ? mapMatrixCellIndex : undefined,
          position: worldCoordinates
            ? [
                prop.position[0] / fieldUnitsPerTile + offsetX + cellSize / 2,
                prop.position[1] / fieldUnitsPerTile + offsetY,
                prop.position[2] / fieldUnitsPerTile + offsetZ + cellSize / 2,
              ] as const
            : [
                prop.position[0] + localOffsetX,
                prop.position[1] + offsetY,
                prop.position[2] + localOffsetZ,
              ] as const,
        }
        mapProps.push(worldProp)
      }
    }
  }

  if (surfaces.length === 0 || positionValues.length === 0) return undefined
  return {
    modelId: footprint.cells[0].modelId,
    vertexCount,
    triangleCount,
    quadCount,
    materialCount,
    pieceCount,
    positions: new Float32Array(positionValues),
    surfaces,
    textures: [...textureMap.values()],
    mapProps,
    tileBounds: {
      minX: (minCellX - footprint.minCellX) * cellSize,
      maxX: (maxCellX - footprint.minCellX + 1) * cellSize,
      minZ: (minCellZ - footprint.minCellZ) * cellSize,
      maxZ: (maxCellZ - footprint.minCellZ + 1) * cellSize,
    },
  }
}

function deriveIndoorTileBoundsFromEvents(events: MapEventPreview | undefined): NitroModelPreview['tileBounds'] | undefined {
  const coordinates = [
    ...(events?.objects ?? []).map((object) => ({ x: object.x, z: object.z })),
    ...(events?.warps ?? []).map((warp) => ({ x: warp.x, z: warp.z })),
    ...(events?.coordinateEvents ?? []).flatMap((event) => {
      const maxX = event.width > 0 ? event.x + event.width - 1 : event.x
      const maxZ = event.height > 0 ? event.z + event.height - 1 : event.z
      return [{ x: event.x, z: event.z }, { x: maxX, z: maxZ }]
    }),
  ]
  if (coordinates.length === 0) return undefined

  const maxEventX = Math.max(...coordinates.map((coordinate) => coordinate.x))
  const maxEventZ = Math.max(...coordinates.map((coordinate) => coordinate.z))
  return {
    minX: 0,
    maxX: Math.max(12, Math.ceil(maxEventX + 3)),
    minZ: 0,
    maxZ: Math.max(12, Math.ceil(maxEventZ + 2)),
  }
}

function deriveIndoorTileBoundsFromTerrain(terrain: MapTerrainPreview | undefined): NitroModelPreview['tileBounds'] | undefined {
  if (!terrain || terrain.attributes.length < terrain.width * terrain.height) return undefined
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (let z = 0; z < terrain.height; z += 1) {
    for (let x = 0; x < terrain.width; x += 1) {
      if (terrain.attributes[z * terrain.width + x] === 0) continue
      if (x < minX) minX = x
      if (x > maxX) maxX = x
      if (z < minZ) minZ = z
      if (z > maxZ) maxZ = z
    }
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX) || !Number.isFinite(minZ) || !Number.isFinite(maxZ)) return undefined
  return {
    minX,
    maxX: Math.min(terrain.width, maxX + 1),
    minZ,
    maxZ: Math.min(terrain.height, maxZ + 1),
  }
}

function readAreaDataModelIds(bytes: Uint8Array, archive: RomFile | undefined, memberId: number): Uint16Array | undefined {
  const member = archive?.archiveMembers[memberId]
  if (!member || member.size < 2) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const count = readUint16(view, 0)
  if (2 + count * 2 > member.size) return undefined
  const modelIds = new Uint16Array(count)
  for (let index = 0; index < count; index += 1) {
    modelIds[index] = readUint16(view, 2 + index * 2)
  }
  return modelIds
}

function readAreaDataModelList(bytes: Uint8Array, areaDataArchive: RomFile | undefined, roomModelListsArchive: RomFile | undefined, areaDataBank: number | undefined): Uint16Array | undefined {
  if (areaDataBank === undefined) return undefined
  const member = areaDataArchive?.archiveMembers[areaDataBank]
  if (!member || member.size < 2) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  return readAreaDataModelIds(bytes, roomModelListsArchive, readUint16(view, 0))
}

function readAreaTextureMemberId(bytes: Uint8Array, areaDataArchive: RomFile | undefined, areaDataBank: number | undefined): number | undefined {
  if (areaDataBank === undefined) return undefined
  const member = areaDataArchive?.archiveMembers[areaDataBank]
  if (!member || member.size < 2) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  return readUint16(view, 0)
}

function readAreaPropTextureMemberId(bytes: Uint8Array, areaDataArchive: RomFile | undefined, areaDataBank: number | undefined): number | undefined {
  if (areaDataBank === undefined) return undefined
  const member = areaDataArchive?.archiveMembers[areaDataBank]
  if (!member || member.size < 4) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const memberId = readUint16(view, 2)
  return memberId === 0xffff ? undefined : memberId
}
export function resolveLandDataPropListOffset(terrainSize: number, propListSize: number, embeddedModelOffset: number, bgsDataLength = 0): number {
  const declaredOffset = 0x14 + bgsDataLength + terrainSize
  if (propListSize === 0) return declaredOffset
  return Math.max(declaredOffset, embeddedModelOffset - propListSize)
}

export function decodeLandDataMapPropRecord(view: DataView, offset: number): NonNullable<NitroModelPreview['mapProps']>[number] {
  if (offset < 0 || offset + 0x30 > view.byteLength) throw new Error(`Le record de prop terrain a l'offset ${offset} est tronque.`)
  const readVector = (vectorOffset: number): readonly [number, number, number] => [
    fix32(view.getInt32(offset + vectorOffset, true)),
    fix32(view.getInt32(offset + vectorOffset + 4, true)),
    fix32(view.getInt32(offset + vectorOffset + 8, true)),
  ]
  return {
    modelId: readUint32(view, offset),
    position: readVector(4),
    rotation: readVector(16),
    scale: readVector(28),
  }
}

function parseNumberedTextureName(textureName: string): { baseName: string, frameIndex: number } | undefined {
  const match = /^(.*)\.(\d+)$/.exec(textureName)
  if (!match) return undefined
  const frameNumber = Number.parseInt(match[2], 10)
  if (!Number.isInteger(frameNumber) || frameNumber <= 0) return undefined
  return { baseName: match[1], frameIndex: frameNumber - 1 }
}

function collectTextureAnimationFrames(textures: NitroTexturePreview[]): Map<string, NitroTexturePreview[]> {
  const framesByName = new Map<string, Array<{ frameIndex: number, texture: NitroTexturePreview }>>()
  for (const texture of textures) {
    const numberedName = parseNumberedTextureName(texture.name)
    if (!numberedName) continue
    const entries = framesByName.get(numberedName.baseName) ?? []
    entries.push({ frameIndex: numberedName.frameIndex, texture })
    framesByName.set(numberedName.baseName, entries)
  }
  return new Map(
    [...framesByName.entries()].map(([name, entries]) => [
      name,
      entries
        .sort((left, right) => left.frameIndex - right.frameIndex)
        .map((entry) => entry.texture),
    ]),
  )
}

function decodeFieldTextureAnimations(bytes: Uint8Array, archive: RomFile | undefined): Record<string, NitroTextureAnimationPreview> | undefined {
  const tableMember = archive?.archiveMembers[0]
  if (!archive || !tableMember || tableMember.size < 4) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + tableMember.offset, tableMember.size)
  const count = readUint32(view, 0)
  // TextureAnimationData: name[16] puis exactement 18 couples
  // (frame, durée). FieldTextureManager_LoadTexture lit le membre index+1.
  const recordSize = 0x34
  if (count === 0 || 4 + count * recordSize > tableMember.size || archive.archiveMembers.length < count + 1) return undefined

  const animations: Record<string, NitroTextureAnimationPreview> = {}
  for (let index = 0; index < count; index += 1) {
    const recordOffset = 4 + index * recordSize
    const name = decodeAscii(bytes.slice(tableMember.offset + recordOffset, tableMember.offset + recordOffset + 16))
    const sourceMemberIndex = index + 1
    const textures = collectTextureAnimationFrames(decodeNitroTextureMemberSet(bytes, archive, sourceMemberIndex)).get(name)
    if (!name || !textures || textures.length === 0) continue

    const frames = [] as NitroTextureAnimationPreview['frames']
    for (let pairOffset = 16; pairOffset + 1 < recordSize; pairOffset += 2) {
      const frameIndex = view.getUint8(recordOffset + pairOffset)
      const durationFrames = view.getUint8(recordOffset + pairOffset + 1)
      if (frameIndex === 0xff && durationFrames === 0xff) break
      const texture = textures[frameIndex]
      if (!texture || durationFrames === 0) continue
      frames.push({ texture, durationFrames })
    }
    if (frames.length > 0) {
      if (animations[name]) throw new Error(`L'archive fldtanime HGSS contient deux animations nommees ${name}.`)
      animations[name] = { name, sourceMemberIndex, frames }
    }
  }

  return Object.keys(animations).length > 0 ? animations : undefined
}

function decodeLandDataModel(bytes: Uint8Array, landDataArchive: RomFile | undefined, areaDataArchive: RomFile | undefined, mapTextureArchive: RomFile | undefined, propTextureArchive: RomFile | undefined, mapModelId: number, areaDataBank: number | undefined): NitroModelPreview | undefined {
  const landMember = landDataArchive?.archiveMembers[mapModelId]
  if (!landMember || landMember.size < 0x14) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + landMember.offset, landMember.size)
  const terrainSize = readUint32(view, 0)
  const propListSize = readUint32(view, 4)
  const embeddedModelSize = readUint32(view, 8)
  const extraModelDataSize = readUint32(view, 12)
  if (readUint16(view, 16) !== 0x1234) return undefined
  const bgsDataLength = readUint16(view, 18)
  const sectionOffset = 0x14 + bgsDataLength
  const propListOffset = sectionOffset + terrainSize
  const embeddedModelOffset = landMember.size - embeddedModelSize - extraModelDataSize
  const propRecordsOffset = resolveLandDataPropListOffset(terrainSize, propListSize, embeddedModelOffset, bgsDataLength)
  const endOffset = embeddedModelOffset + embeddedModelSize + extraModelDataSize
  if (
    terrainSize === 0
    || embeddedModelSize < 0x20
    || propListOffset > landMember.size
    || propRecordsOffset < propListOffset
    || propRecordsOffset + propListSize > embeddedModelOffset
    || embeddedModelOffset > landMember.size
    || endOffset > landMember.size
    || !hasMagic(bytes, landMember.offset + embeddedModelOffset, 'BMD0')
  ) {
    return undefined
  }

  const areaTextures = decodeNitroTextureMemberSet(bytes, mapTextureArchive, readAreaTextureMemberId(bytes, areaDataArchive, areaDataBank))
  const propTextures = decodeNitroTextureMemberSet(bytes, propTextureArchive, readAreaPropTextureMemberId(bytes, areaDataArchive, areaDataBank))
  const externalTexturesByName = new Map([...propTextures, ...areaTextures].map((texture) => [texture.name, texture]))
  const scannedTextures = new Map<string, NitroTexturePreview | undefined>()
  const textureMap = new Map<string, NitroTexturePreview>()
  const surfaces: NitroSurfacePreview[] = []
  const mapProps: NonNullable<NitroModelPreview['mapProps']> = []
  const positionValues: number[] = []
  let vertexCount = 0
  let triangleCount = 0
  let quadCount = 0
  let materialCount = 0
  let pieceCount = 0

  const resolveExternalTexture = (textureName: string | undefined, paletteName: string | undefined): NitroTexturePreview | undefined => {
    if (!textureName) return undefined
    const exact = externalTexturesByName.get(textureName)
    if (exact) return exact
    const key = `${textureName}:${paletteName ?? ''}`
    if (!scannedTextures.has(key)) {
      scannedTextures.set(
        key,
        findNitroTextureByNameInArchive(bytes, propTextureArchive, textureName, paletteName)
          ?? findNitroTextureByNameInArchive(bytes, mapTextureArchive, textureName, paletteName),
      )
    }
    return scannedTextures.get(key)
  }

  const appendModel = (
    model: NitroModelPreview | undefined,
    texturePrefix: string,
    transformPositions: (positions: Float32Array) => Float32Array,
  ): void => {
    if (!model?.positions || !model.surfaces || model.surfaces.length === 0) return
    vertexCount += model.vertexCount
    triangleCount += model.triangleCount
    quadCount += model.quadCount
    materialCount += model.materialCount
    pieceCount += model.pieceCount

    for (const texture of model.textures ?? []) {
      const id = prefixTextureId(texturePrefix, texture.id)
      if (!textureMap.has(id)) textureMap.set(id, { ...texture, id })
    }

    for (const surface of model.surfaces) {
      const externalTexture = resolveExternalTexture(surface.textureName, surface.paletteName)
      if (externalTexture) {
        const id = prefixTextureId(texturePrefix, externalTexture.id)
        if (!textureMap.has(id)) textureMap.set(id, { ...externalTexture, id })
      }
      const positions = transformPositions(surface.positions)
      positionValues.push(...positions)
      surfaces.push({
        ...surface,
        textureId: externalTexture
          ? prefixTextureId(texturePrefix, externalTexture.id)
          : surface.textureId ? prefixTextureId(texturePrefix, surface.textureId) : undefined,
        textureName: externalTexture?.name ?? surface.textureName,
        positions,
        colors: surface.colors ? new Float32Array(surface.colors) : undefined,
        uvs: surface.uvs ? new Float32Array(surface.uvs) : undefined,
      })
    }
  }

  const embeddedMember: NarcMember = {
    index: mapModelId,
    offset: landMember.offset + embeddedModelOffset,
    size: embeddedModelSize,
    signature: 'BMD0',
  }
  appendModel(decodeNitroModelMember(bytes, embeddedMember, mapModelId), `land:${mapModelId}`, (positions) => new Float32Array(positions))

  const propRecordSize = 0x30
  for (let offset = 0; offset + propRecordSize <= propListSize; offset += propRecordSize) {
    const recordOffset = propRecordsOffset + offset
    const prop = decodeLandDataMapPropRecord(view, recordOffset)
    const propModelId = prop.modelId
    const recordStart = landMember.offset + recordOffset
    const isEmptyRecord = propModelId === 0 && bytes.slice(recordStart, recordStart + propRecordSize).every((value) => value === 0)
    if (isEmptyRecord) continue

    mapProps.push(prop)
  }

  if (surfaces.length === 0 || positionValues.length === 0) return undefined
  return {
    modelId: mapModelId,
    vertexCount,
    triangleCount,
    quadCount,
    materialCount,
    pieceCount,
    positions: new Float32Array(positionValues),
    surfaces,
    textures: [...textureMap.values()],
    mapProps,
  }
}

function decodeMapPropModel(
  bytes: Uint8Array,
  modelArchive: RomFile | undefined,
  areaDataArchive: RomFile | undefined,
  propTextureArchive: RomFile | undefined,
  modelId: number,
  areaDataBank: number,
): NitroModelPreview | undefined {
  const model = decodeNitroModel(bytes, modelArchive, modelId)
  if (!model?.surfaces) return model
  const areaTextures = decodeNitroTextureMemberSet(
    bytes,
    propTextureArchive,
    readAreaPropTextureMemberId(bytes, areaDataArchive, areaDataBank),
  )
  const texturesByName = new Map(areaTextures.map((texture) => [texture.name, texture]))
  const textures = new Map((model.textures ?? []).map((texture) => [texture.id, texture]))
  const surfaces = model.surfaces.map((surface) => {
    const texture = surface.textureName
      ? texturesByName.get(surface.textureName)
        ?? findNitroTextureByNameInArchive(bytes, propTextureArchive, surface.textureName, surface.paletteName)
      : undefined
    if (!texture) return surface
    const id = `map-prop:${areaDataBank}:${modelId}:${texture.id}`
    if (!textures.has(id)) textures.set(id, { ...texture, id })
    return { ...surface, textureId: id, textureName: texture.name }
  })
  return { ...model, surfaces, textures: [...textures.values()] }
}

function resolveSimpleRoomModelId(bytes: Uint8Array, roomMetadataArchive: RomFile | undefined, roomModelListsArchive: RomFile | undefined, modelId: number): number | undefined {
  const member = roomMetadataArchive?.archiveMembers[modelId]
  if (!member || member.size < 12) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const listMemberId = view.getUint8(0)
  const width = view.getUint8(6)
  const height = view.getUint8(7)
  if (listMemberId === 0xff || width !== 1 || height !== 1) return undefined
  const slot = view.getUint8(8)
  if (slot === 0xff || view.getUint8(9) !== 1 || view.getUint8(10) !== 0 || view.getUint8(11) !== 0) return undefined
  for (let offset = 12; offset + 4 <= member.size; offset += 4) {
    if (view.getUint8(offset) !== 0xff || view.getUint8(offset + 1) !== 0xff || view.getUint8(offset + 2) !== 0xff || view.getUint8(offset + 3) !== 0xff) {
      return undefined
    }
  }
  const modelIds = readAreaDataModelIds(bytes, roomModelListsArchive, listMemberId)
  return modelIds?.[slot]
}

function decodeRoomMapModel(bytes: Uint8Array, roomMetadataArchive: RomFile | undefined, roomModelListsArchive: RomFile | undefined, areaDataArchive: RomFile | undefined, mapTextureArchive: RomFile | undefined, propTextureArchive: RomFile | undefined, modelArchive: RomFile | undefined, recipeId: number, areaDataBank: number | undefined): NitroModelPreview | undefined {
  const member = roomMetadataArchive?.archiveMembers[recipeId]
  const modelList = readAreaDataModelList(bytes, areaDataArchive, roomModelListsArchive, areaDataBank)
  if (!member || !modelArchive || !modelList || member.size < 12) return undefined

  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const gridWidth = view.getUint8(6)
  const gridHeight = view.getUint8(7)
  const gridOffset = 8
  const gridCells = gridWidth * gridHeight
  if (gridWidth === 0 || gridHeight === 0 || gridOffset + gridCells * 4 > member.size) return undefined

  const areaTextures = decodeNitroTextureMemberSet(bytes, mapTextureArchive, readAreaTextureMemberId(bytes, areaDataArchive, areaDataBank))
  const propTextures = decodeNitroTextureMemberSet(bytes, propTextureArchive, readAreaPropTextureMemberId(bytes, areaDataArchive, areaDataBank))
  const externalTexturesByName = new Map([...propTextures, ...areaTextures].map((texture) => [texture.name, texture]))
  const scannedTextures = new Map<string, NitroTexturePreview | undefined>()
  const modelCache = new Map<number, NitroModelPreview | undefined>()
  const textureMap = new Map<string, NitroTexturePreview>()
  const surfaces: NitroSurfacePreview[] = []
  const positionValues: number[] = []
  let vertexCount = 0
  let triangleCount = 0
  let quadCount = 0
  let materialCount = 0
  let pieceCount = 0

  const readModel = (modelId: number): NitroModelPreview | undefined => {
    if (!modelCache.has(modelId)) modelCache.set(modelId, decodeNitroModel(bytes, modelArchive, modelId))
    return modelCache.get(modelId)
  }

  const resolveExternalTexture = (textureName: string | undefined, paletteName: string | undefined): NitroTexturePreview | undefined => {
    if (!textureName) return undefined
    const exact = externalTexturesByName.get(textureName)
    if (exact) return exact
    const key = `${textureName}:${paletteName ?? ''}`
    if (!scannedTextures.has(key)) {
      scannedTextures.set(
        key,
        findNitroTextureByNameInArchive(bytes, propTextureArchive, textureName, paletteName)
          ?? findNitroTextureByNameInArchive(bytes, mapTextureArchive, textureName, paletteName),
      )
    }
    return scannedTextures.get(key)
  }

  for (let cell = 0; cell < gridCells; cell += 1) {
    const offset = gridOffset + cell * 4
    const slot = view.getUint8(offset)
    if (slot === 0xff) continue
    const referencedModelId = modelList[slot] ?? slot
    const model = readModel(referencedModelId)
    if (!model?.positions || !model.surfaces || model.surfaces.length === 0) continue

    const cellX = cell % gridWidth
    const cellZ = Math.floor(cell / gridWidth)
    const rotation = view.getUint8(offset + 3)
    vertexCount += model.vertexCount
    triangleCount += model.triangleCount
    quadCount += model.quadCount
    materialCount += model.materialCount
    pieceCount += model.pieceCount

    for (const texture of model.textures ?? []) {
      const id = prefixTextureId(referencedModelId, texture.id)
      if (!textureMap.has(id)) textureMap.set(id, { ...texture, id })
    }

    for (const surface of model.surfaces) {
      const externalTexture = resolveExternalTexture(surface.textureName, surface.paletteName)
      if (externalTexture) {
        const id = prefixTextureId(referencedModelId, externalTexture.id)
        if (!textureMap.has(id)) textureMap.set(id, { ...externalTexture, id })
      }
      const positions = transformRoomFloat3(surface.positions, cellX, cellZ, rotation)
      positionValues.push(...positions)
      surfaces.push({
        ...surface,
        textureId: externalTexture
          ? prefixTextureId(referencedModelId, externalTexture.id)
          : surface.textureId ? prefixTextureId(referencedModelId, surface.textureId) : undefined,
        textureName: externalTexture?.name ?? surface.textureName,
        positions,
        colors: surface.colors ? new Float32Array(surface.colors) : undefined,
        uvs: surface.uvs ? new Float32Array(surface.uvs) : undefined,
      })
    }
  }

  if (surfaces.length === 0 || positionValues.length === 0) return undefined
  return {
    modelId: recipeId,
    vertexCount,
    triangleCount,
    quadCount,
    materialCount,
    pieceCount,
    positions: new Float32Array(positionValues),
    surfaces,
    textures: [...textureMap.values()],
    tileBounds: {
      minX: 0,
      maxX: Math.max(1, gridWidth) * 16,
      minZ: 0,
      maxZ: Math.max(1, gridHeight) * 16,
    },
  }
}

function decodeIndoorNestedMatrixModel(bytes: Uint8Array, matrixArchive: RomFile | undefined, fieldModelArchive: RomFile | undefined, modelId: number | undefined): NitroModelPreview | undefined {
  const member = modelId === undefined ? undefined : matrixArchive?.archiveMembers[modelId]
  if (!member || !fieldModelArchive) return undefined
  const nestedMatrix = decodeMapMatrix(bytes, member)
  const nestedModelId = nestedMatrix?.modelIds[0]
  if (nestedModelId === undefined || nestedModelId === 0xffff) return undefined
  return decodeNitroModel(bytes, fieldModelArchive, nestedModelId)
}

function isRoomModelArchive(archive: RomFile | undefined): boolean {
  return archive?.path === '/a/1/4/8' || archive?.path === '/fielddata/build_model/bm_room.narc'
}

function decodeResolvedMap(bytes: Uint8Array, header: MapHeaderPreview, label: string, maxMapCount: number, matrixArchive: RomFile | undefined, eventsArchive: RomFile | undefined, landDataArchive: RomFile | undefined, roomModelArchive: RomFile | undefined, fieldModelArchive: RomFile | undefined, fieldScriptsArchive: RomFile, messagesArchive: RomFile, standardScriptBanks: OpeningMapPreview['standardScriptBanks'], externalMessageCache: Map<number, Record<number, string>>, roomMetadataArchive?: RomFile, roomModelListsArchive?: RomFile, areaDataArchive?: RomFile, areaTextureArchive?: RomFile, propTextureArchive?: RomFile): OpeningMapPreview | undefined {
  const mapId = header.mapId
  const matrix = header.matrixId === 0
    ? findMapMatrixForHeader(bytes, matrixArchive, mapId)
    : matrixArchive?.archiveMembers[header.matrixId] && decodeMapMatrix(bytes, matrixArchive.archiveMembers[header.matrixId])
  if (!matrix) return undefined
  const isFieldMap = usesWorldMatrixCoordinates(mapId, matrix)
  const isLocalCompositeMap = matrix.hasHeaders === false && matrix.width * matrix.height > 1
  const modelArchive = isFieldMap ? fieldModelArchive : roomModelArchive
  const events = eventsArchive?.archiveMembers[header.eventsBank] ? decodeMapEvents(bytes, eventsArchive.archiveMembers[header.eventsBank]) : undefined
  const mapCell = matrix.headers.indexOf(mapId)
  const modelId = mapCell >= 0 ? matrix.modelIds[mapCell] : matrix.modelIds[0]
  const terrain = isFieldMap || isLocalCompositeMap
    ? decodeFieldMapTerrain(bytes, landDataArchive, matrix, mapId)
    : modelId === undefined ? undefined : decodeMapTerrain(bytes, landDataArchive, modelId)
  const resolvedModelId = modelId === undefined || !isRoomModelArchive(modelArchive)
    ? undefined
    : resolveSimpleRoomModelId(bytes, roomMetadataArchive, roomModelListsArchive, modelId) ?? modelId
  let model = modelId === undefined
    ? undefined
    : (isFieldMap && mapCell >= 0 && modelArchive?.path === '/fielddata/build_model/bm_field.narc') || isLocalCompositeMap
      ? decodeFieldMapModel(bytes, matrix, landDataArchive, areaDataArchive, areaTextureArchive, propTextureArchive, header.areaDataBank, mapId, isFieldMap)
      : isRoomModelArchive(modelArchive)
        // Les MapProps ont leur propre gestionnaire natif et sont reconstruits
        // par le runtime depuis les records de land_data. Les fusionner aussi
        // dans le modèle de terrain les affiche deux fois. C'est surtout faux
        // pour les grottes 1x1 : leur AreaData sélectionne bm_field alors que
        // l'ancien chemin local décodait ici le même ID depuis bm_room (une
        // étagère pouvait ainsi recouvrir un escalier de grotte).
        ? decodeLandDataModel(bytes, landDataArchive, areaDataArchive, areaTextureArchive, propTextureArchive, modelId, header.areaDataBank)
          ?? decodeRoomMapModel(bytes, roomMetadataArchive, roomModelListsArchive, areaDataArchive, areaTextureArchive, propTextureArchive, modelArchive, modelId, header.areaDataBank)
          ?? decodeIndoorNestedMatrixModel(bytes, matrixArchive, fieldModelArchive, modelId)
          ?? (resolvedModelId === undefined ? decodeNitroModel(bytes, modelArchive, modelId) : decodeNitroModel(bytes, modelArchive, resolvedModelId) ?? decodeNitroModel(bytes, modelArchive, modelId))
      : resolvedModelId === undefined
        ? decodeNitroModel(bytes, modelArchive, modelId)
        : decodeNitroModel(bytes, modelArchive, resolvedModelId) ?? decodeNitroModel(bytes, modelArchive, modelId)
  if (model && !isFieldMap) {
    const tileBounds = deriveIndoorTileBoundsFromTerrain(terrain) ?? deriveIndoorTileBoundsFromEvents(events)
    if (tileBounds) model = { ...model, tileBounds }
  }
  const fieldScriptMember = fieldScriptsArchive.archiveMembers[header.scriptsBank]
  const initScriptMember = fieldScriptsArchive.archiveMembers[header.scriptHeaderBank]
  const messageMember = messagesArchive.archiveMembers[header.msgBank]
  if (!fieldScriptMember || !initScriptMember || !messageMember) {
    throw new Error(`Les banques de scenario ROM de la carte ${mapId} sont absentes.`)
  }
  const scriptBytes = readArchiveMemberPayload(bytes, fieldScriptMember)
  const fieldScriptTable = decodeFieldScriptBank(scriptBytes)
  const messages = decodeHgssMessageBank(bytes, messageMember)
  if (!messages) {
    throw new Error(`La banque de messages ${header.msgBank} de la carte ${mapId} est invalide.`)
  }
  const externalMessages: Record<number, Record<number, string>> = {}
  for (const bankId of [21, 30, 182, 191, 211, 216, 217, 218, 430, 435, 752, ...hgssPhoneMessageBanks]) {
    let bankMessages = externalMessageCache.get(bankId)
    if (!bankMessages) {
      const member = messagesArchive.archiveMembers[bankId]
      const decoded = member ? decodeHgssMessageBank(bytes, member) : undefined
      if (decoded) {
        bankMessages = decoded
        externalMessageCache.set(bankId, bankMessages)
      }
    }
    if (bankMessages) externalMessages[bankId] = bankMessages
  }
  return {
    id: mapId,
    label,
    connectedMapIds: collectConnectedMapIds(mapId, matrix, events, maxMapCount),
    header,
    fieldScripts: {
      bank: header.scriptsBank,
      bytes: scriptBytes,
      ...fieldScriptTable,
    },
    standardScripts: standardScriptBanks?.find((bank) => bank.baseScriptId === 2000),
    standardScriptBanks,
    initScripts: decodeMapInitScripts(readArchiveMemberPayload(bytes, initScriptMember)),
    messages,
    externalMessages,
    matrix,
    events,
    terrain,
    model,
  }
}

const standardScriptBankMappings = [
  [10490, 263, 433], [10450, 264, 19], [10440, 2, 748], [10400, 151, 246], [10350, 952, 726],
  [10300, 734, 444], [10200, 144, 209], [10150, 955, 732], [10100, 954, 733], [10000, 146, 211],
  [9950, 148, 666], [9900, 136, 40], [9850, 167, 312], [9800, 166, 43], [9700, 163, 266],
  [9600, 149, 40], [9500, 265, 439], [9300, 143, 204], [9200, 164, 267], [9100, 0, 14],
  [9000, 4, 46], [8900, 165, 268], [8800, 262, 427], [8000, 145, 210], [7000, 141, 199],
  [5000, 953, 40], [3000, 953, 40], [2800, 150, 23], [2500, 1, 20], [2000, 3, 40],
] as const

function decodeStandardScriptBanks(bytes: Uint8Array, fieldScriptsArchive: RomFile, messagesArchive: RomFile): NonNullable<OpeningMapPreview['standardScriptBanks']> {
  return standardScriptBankMappings.map(([baseScriptId, scriptBank, messageBank]) => {
    const scriptMember = fieldScriptsArchive.archiveMembers[scriptBank]
    const messageMember = messagesArchive.archiveMembers[messageBank]
    if (!scriptMember || !messageMember) throw new Error(`La banque standard ROM ${baseScriptId} est absente.`)
    const scriptBytes = readArchiveMemberPayload(bytes, scriptMember)
    const messages = decodeHgssMessageBank(bytes, messageMember)
    if (!messages) throw new Error(`La banque de messages standard ROM ${messageBank} est invalide.`)
    return {
      bank: scriptBank,
      baseScriptId,
      bytes: scriptBytes,
      messages,
      ...decodeFieldScriptBank(scriptBytes),
    }
  })
}

function decodeResolvedMaps(
  bytes: Uint8Array,
  mapHeaders: MapHeaderPreview[],
  seedMapIds: number[],
  matrixArchive: RomFile | undefined,
  eventsArchive: RomFile | undefined,
  landDataArchive: RomFile | undefined,
  roomModelArchive: RomFile | undefined,
  fieldModelArchive: RomFile | undefined,
  fieldScriptsArchive: RomFile,
  messagesArchive: RomFile,
  mapSectionNames: Record<number, string>,
  standardScriptBanks: NonNullable<OpeningMapPreview['standardScriptBanks']>,
  roomMetadataArchive?: RomFile,
  roomModelListsArchive?: RomFile,
  areaDataArchive?: RomFile,
  areaTextureArchive?: RomFile,
  propTextureArchive?: RomFile,
): OpeningMapPreview[] {
  const pending = [...new Set(seedMapIds.filter((mapId) => Number.isInteger(mapId) && mapId >= 0 && mapId < mapHeaders.length))]
  const decodedMaps = new Map<number, OpeningMapPreview>()
  const externalMessageCache = new Map<number, Record<number, string>>()

  while (pending.length > 0) {
    const mapId = pending.shift()
    if (mapId === undefined || decodedMaps.has(mapId)) continue
    const header = mapHeaders[mapId]
    if (!header) continue
    const map = decodeResolvedMap(
      bytes,
      header,
      resolveMapLabel(mapId, header, mapSectionNames),
      mapHeaders.length,
      matrixArchive,
      eventsArchive,
      landDataArchive,
      roomModelArchive,
      fieldModelArchive,
      fieldScriptsArchive,
      messagesArchive,
      standardScriptBanks,
      externalMessageCache,
      roomMetadataArchive,
      roomModelListsArchive,
      areaDataArchive,
      areaTextureArchive,
      propTextureArchive,
    )
    if (!map) continue
    decodedMaps.set(mapId, map)

    for (const destinationMapId of map.connectedMapIds ?? []) {
      if (!Number.isInteger(destinationMapId) || destinationMapId < 0 || destinationMapId >= mapHeaders.length) continue
      if (decodedMaps.has(destinationMapId) || pending.includes(destinationMapId)) continue
      pending.push(destinationMapId)
    }
  }

  return [...decodedMaps.values()]
}

function findGameDataArchive(files: RomFile[], id: GameDataArchive['id'], label: string, path: string): GameDataArchive {
  return { id, label, file: files.find((file) => file.path === path) }
}

export async function readRomInventory(file: File): Promise<RomInventory> {
  const metadata = await readRomMetadata(file)
  const bytes = new Uint8Array(await file.arrayBuffer())
  const header = new DataView(bytes.buffer, bytes.byteOffset, HEADER_LENGTH)
  const fntOffset = readUint32(header, 0x40)
  const fntSize = readUint32(header, 0x44)
  const fatOffset = readUint32(header, 0x48)
  const fatSize = readUint32(header, 0x4c)

  assertRange(fntOffset, fntSize, bytes.byteLength, 'FNT')
  assertRange(fatOffset, fatSize, bytes.byteLength, 'FAT')
  if (fntSize < DIRECTORY_ENTRY_SIZE || fatSize === 0 || fatSize % 8 !== 0) {
    throw new Error('Les tables NitroFS ne sont pas valides pour cette ROM.')
  }

  const fnt = bytes.slice(fntOffset, fntOffset + fntSize)
  const root = new DataView(fnt.buffer, fnt.byteOffset, fnt.byteLength)
  const directoryCount = readUint16(root, 6)
  const fileCount = fatSize / 8
  if (directoryCount === 0 || directoryCount * DIRECTORY_ENTRY_SIZE > fntSize) {
    throw new Error('Le nombre de repertoires NitroFS est invalide.')
  }

  const names = parseNitroFileNames(fnt, directoryCount, fileCount)
  const fat = new DataView(bytes.buffer, bytes.byteOffset + fatOffset, fatSize)
  const files: RomFile[] = []
  let totalDataSize = 0
  let archiveEntryCount = 0
  for (let id = 0; id < fileCount; id += 1) {
    const offset = readUint32(fat, id * 8)
    const end = readUint32(fat, id * 8 + 4)
    if (end < offset) {
      throw new Error(`Le fichier NitroFS ${id} a une taille negative.`)
    }
    assertRange(offset, end - offset, bytes.byteLength, `FAT[${id}]`)
    const signature = formatSignature(bytes.slice(offset, Math.min(offset + 4, end)))
    const size = end - offset
    const archiveMembers = readNarcMembers(bytes, offset, size)
    const archiveEntries = archiveMembers.length
    totalDataSize += size
    archiveEntryCount += archiveEntries
    files.push({
      id,
      path: names.get(id) ?? `/__unnamed__/file-${id.toString().padStart(5, '0')}`,
      offset,
      size,
      signature,
      archiveEntries,
      archiveMembers,
    })
  }

  const pokemonArchives = createPokemonArchiveRegistry(files)
  const resourceCatalog = {
    archives: files.filter((file) => file.archiveEntries > 0).length,
    fontFiles: files.filter((file) => /font/i.test(file.path) && /\.(NCGR|NCLR)$/i.test(file.path)),
    messageArchives: files.filter((file) => /msg\.narc$/i.test(file.path)),
    scenarioArchives: files.filter((file) => /scenario|script/i.test(file.path)),
    pokemonArchives,
    gameData: [
      findGameDataArchive(files, 'opening', 'Ecran titre', '/a/0/4/6'),
      findGameDataArchive(files, 'intro', 'Introduction et tutoriel', '/a/1/2/0'),
      findGameDataArchive(files, 'nameInput', 'Saisie du nom', '/a/0/3/1'),
      findGameDataArchive(files, 'mapMatrices', 'Matrices de cartes', '/a/0/4/1'),
      findGameDataArchive(files, 'zoneEvents', 'Evenements de zone', '/a/0/3/2'),
      findGameDataArchive(files, 'fieldScripts', 'Scripts de terrain', '/a/0/1/2'),
      findGameDataArchive(files, 'landData', 'Attributs de terrain', '/a/0/6/5'),
      findGameDataArchive(files, 'messages', 'Dialogues principaux', '/a/0/2/7'),
      findGameDataArchive(files, 'species', 'Statistiques des creatures', '/a/0/0/2'),
      findGameDataArchive(files, 'moves', 'Capacites', '/a/0/1/1'),
    ],
  }

  const soundFile = files.find((candidate) => candidate.path === '/data/sound/gs_sound_data.sdat')
  const phoneBookEntries = decodeHgssPhoneBook(bytes, files.find((candidate) => candidate.path.endsWith('/tel/pmtel_book.dat')))
  if (!soundFile || soundFile.signature !== 'S D A T') {
    throw new Error('L’archive sonore ROM /data/sound/gs_sound_data.sdat est absente ou invalide.')
  }
  const soundArchive = {
    path: soundFile.path,
    bytes: bytes.slice(soundFile.offset, soundFile.offset + soundFile.size),
  }
  const personalArchive = pokemonArchives.find((entry) => entry.role === 'personalData')!.file
  const growthTablesArchive = pokemonArchives.find((entry) => entry.role === 'growthTables')!.file
  const movesArchive = pokemonArchives.find((entry) => entry.role === 'moves')!.file
  const levelUpLearnsetsArchive = pokemonArchives.find((entry) => entry.role === 'levelUpLearnsets')!.file
  const evolutionsArchive = pokemonArchives.find((entry) => entry.role === 'evolutions')!.file; const pokeathlonPerformanceArchive = pokemonArchives.find((entry) => entry.role === 'pokeathlonPerformances')!.file
  const followerParametersArchive = pokemonArchives.find((entry) => entry.role === 'followerParameters')!.file
  const followerGraphicsArchive = pokemonArchives.find((entry) => entry.role === 'followerGraphics')!.file
  const itemDataArchive = pokemonArchives.find((entry) => entry.role === 'itemData')!.file
  const itemIconsArchive = pokemonArchives.find((entry) => entry.role === 'itemIcons')!.file
  const pokemonIconsArchive = pokemonArchives.find((entry) => entry.role === 'pokemonIcons')!.file
  const battleGraphicsArchive = pokemonArchives.find((entry) => entry.role === 'battleGraphics')!.file; const battleFormGraphicsArchive = pokemonArchives.find((entry) => entry.role === 'battleFormGraphics')!.file
  const battleSpriteHeightArchive = pokemonArchives.find((entry) => entry.role === 'battleSpriteHeights')!.file; const battleFormSpriteHeightArchive = pokemonArchives.find((entry) => entry.role === 'battleFormSpriteHeights')!.file
  const battlePokemonAnimationArchive = files.find((file) => file.path === '/a/1/8/0')
  const battleBackgroundArchive = files.find((file) => file.path === '/a/0/0/7')
  const moveAnimationScriptArchive = files.find((file) => file.path === HGSS_MOVE_ANIMATION_ARCHIVE_PATH)
  const battleAnimationScriptArchive = files.find((file) => file.path === HGSS_BATTLE_ANIMATION_ARCHIVE_PATH)
  const battleParticleArchive = files.find((file) => file.path === HGSS_BATTLE_PARTICLE_ARCHIVE_PATH)
  const battleAnimationResourceArchives = HGSS_BATTLE_ANIMATION_RESOURCE_PATHS
    .map((path) => files.find((file) => file.path === path))
  const battleSpriteResourceArchives = {
    characters: files.find((file) => file.path === HGSS_BATTLE_SPRITE_CHARACTER_ARCHIVE_PATH),
    palettes: files.find((file) => file.path === HGSS_BATTLE_SPRITE_PALETTE_ARCHIVE_PATH),
    cells: files.find((file) => file.path === HGSS_BATTLE_SPRITE_CELL_ARCHIVE_PATH),
    animations: files.find((file) => file.path === HGSS_BATTLE_SPRITE_ANIMATION_ARCHIVE_PATH),
  }
  const trainerDataArchive = files.find((file) => file.path === '/a/0/5/5')
  const trainerPartyArchive = files.find((file) => file.path === '/a/0/5/6')
  const trainerMessageTableArchive = files.find((file) => file.path === '/a/0/5/7')
  const trainerBattleSpriteArchive = files.find((file) => file.path === '/a/0/5/8')
  const npcTradeArchive = files.find((file) => file.path === '/a/1/1/2')
  const wildEncounterArchive = files.find((file) => file.path === '/a/0/3/7')
  const safariEncounterArchive = files.find((file) => file.path === HGSS_SAFARI_ENCOUNTER_ARCHIVE_PATH)
  const photoDataArchive = files.find((file) => file.path === HGSS_PHOTO_DATA_ARCHIVE_PATH)
  const johtoDexArchive = files.find((file) => file.path === '/a/1/3/8')
  const pokedexSpeciesDataArchive = files.find((file) => file.path === '/a/0/7/4')
  const followerReactionRuleArchive = files.find((data) => data.path === '/a/2/2/0')
  const followerReactionArchive = files.find((data) => data.path === '/a/2/2/1')
  const followerReactionMovementArchive = files.find((data) => data.path === '/a/2/2/2')
  const followerSpeciesClassArchive = files.find((data) => data.path === '/a/2/3/1')
  const eggMoveArchive = files.find((data) => data.path === '/a/2/2/9')
  const moveTutorLearnsetFile = files.find((data) => data.path === '/fielddata/wazaoshie/waza_oshie.bin')
  const fieldEffectArchive = files.find((data) => data.path === '/a/1/0/3')
  if (!trainerDataArchive || !trainerPartyArchive || !trainerMessageTableArchive || !trainerBattleSpriteArchive) throw new Error('Les archives ROM HGSS des dresseurs sont absentes.')
  if (!npcTradeArchive) throw new Error("L'archive ROM HGSS des échanges internes est absente.")
  if (!battlePokemonAnimationArchive) throw new Error("L'archive ROM HGSS des animations Pokémon de combat est absente.")
  if (!battleBackgroundArchive) throw new Error("L'archive ROM HGSS des décors de combat est absente.")
  if (!moveAnimationScriptArchive || !battleAnimationScriptArchive || !battleParticleArchive || battleAnimationResourceArchives.some((archive) => !archive)
    || !battleSpriteResourceArchives.characters || !battleSpriteResourceArchives.palettes || !battleSpriteResourceArchives.cells || !battleSpriteResourceArchives.animations) {
    throw new Error("Les archives ROM HGSS des animations visuelles de combat sont absentes.")
  }
  if (!wildEncounterArchive) throw new Error("L'archive ROM HGSS des rencontres sauvages est absente.")
  if (!safariEncounterArchive) throw new Error("L'archive ROM HGSS des rencontres du Parc Safari est absente.")
  if (!photoDataArchive) throw new Error("L'archive ROM HGSS PhotoData est absente.")
  if (!johtoDexArchive || !pokedexSpeciesDataArchive) throw new Error("L'archive ROM HGSS du Pokedex est absente.")
  if (!followerReactionRuleArchive || !followerReactionArchive || !followerReactionMovementArchive || !followerSpeciesClassArchive || !fieldEffectArchive) {
    throw new Error('Les archives ROM HGSS des réactions follower sont absentes.')
  }
  if (!eggMoveArchive?.archiveMembers[0]) throw new Error("L'archive ROM HGSS des capacités héréditaires est absente.")
  const messagesArchive = resourceCatalog.gameData.find((data) => data.id === 'messages')?.file
  if (!messagesArchive) throw new Error("L'archive ROM HGSS des messages est absente.")
  const speciesNameMessages = decodeHgssMessageBank(bytes, messagesArchive?.archiveMembers[237])
  if (!speciesNameMessages) throw new Error('La banque ROM des noms d’especes Pokemon est absente ou invalide.')
  const speciesNames = Array.from({ length: Object.keys(speciesNameMessages).length }, (_, speciesId) => {
    const name = speciesNameMessages[speciesId]
    if (!name) throw new Error(`Le nom ROM de l’espece Pokemon ${speciesId} est absent.`)
    return name
  })
  const moveNameMessages = decodeHgssMessageBank(bytes, messagesArchive?.archiveMembers[750])
  if (!moveNameMessages) throw new Error('La banque ROM des noms de capacités Pokémon est absente ou invalide.')
  const moves = decodePokemonMoveCatalog(bytes, movesArchive)
  const moveNames = Array.from({ length: Object.keys(moveNameMessages).length }, (_, moveId) => {
    const name = moveNameMessages[moveId]
    if (!name) throw new Error(`Le nom ROM de la capacité Pokémon ${moveId} est absent.`)
    return stripMessageControls(name)
  })
  const pokemonCatalog = {
    speciesNames,
    ...decodeHgssPokemonSummaryNames(bytes, messagesArchive.archiveMembers),
    babySpecies: (() => {
      const file = files.find((candidate) => candidate.path === '/poketool/personal/pms.narc')
      if (!file || file.size < speciesNames.length * 2) throw new Error('La table ROM des espèces d’œufs pms.narc est absente ou tronquée.')
      const view = new DataView(bytes.buffer, bytes.byteOffset + file.offset, file.size)
      return Array.from({ length: speciesNames.length }, (_, speciesId) => view.getUint16(speciesId * 2, true))
    })(),
    eggMoves: (() => {
      const payload = readArchiveMemberPayload(bytes, eggMoveArchive.archiveMembers[0]!)
      if (payload.byteLength % 2 !== 0) throw new Error("La table ROM HGSS des capacités héréditaires a une taille impaire.")
      const result = Array.from({ length: speciesNames.length }, () => [] as number[])
      const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
      let currentSpecies: number | undefined
      for (let offset = 0; offset < payload.byteLength; offset += 2) {
        const value = view.getUint16(offset, true)
        if (value === 0xffff) break
        if (value > 20000) {
          currentSpecies = value - 20000
          if (!result[currentSpecies]) throw new Error(`L'espèce ${currentSpecies} de la table des capacités héréditaires est hors catalogue.`)
        } else if (currentSpecies !== undefined && value !== 0) {
          result[currentSpecies]!.push(value)
        }
      }
      return result
    })(),
    moveTutorLearnsets: (() => {
      if (!moveTutorLearnsetFile || moveTutorLearnsetFile.size % 8 !== 0) {
        throw new Error('La table ROM HGSS des capacités de maîtres est absente ou tronquée.')
      }
      return Array.from({ length: moveTutorLearnsetFile.size / 8 }, (_, index) => bytes.slice(
        moveTutorLearnsetFile.offset + index * 8,
        moveTutorLearnsetFile.offset + index * 8 + 8,
      ))
    })(),
    moveNames,
    weightsTenthsKg: decodeHgssPokemonWeights(bytes, pokedexSpeciesDataArchive),
    naturePowerMoveIds: decodeHgssNaturePowerMoveIds(bytes), camouflageTypeIds: decodeHgssCamouflageTypeIds(bytes), secretPowerEffectIds: decodeHgssSecretPowerEffectIds(bytes),
    personalData: decodePokemonPersonalCatalog(bytes, personalArchive),
    growthTables: decodePokemonGrowthTableCatalog(bytes, growthTablesArchive),
    moves,
    levelUpLearnsets: decodePokemonLevelUpLearnsetCatalog(bytes, levelUpLearnsetsArchive),
    evolutions: decodePokemonEvolutionCatalog(bytes, evolutionsArchive),
    followers: decodePokemonFollowerCatalog(bytes, followerParametersArchive),
  }
  const followerReactionCatalog = decodeHgssFollowerReactionCatalog(
    bytes,
    followerReactionRuleArchive,
    followerReactionArchive,
    followerReactionMovementArchive,
    followerSpeciesClassArchive,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[265]),
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[40]),
  )
  const itemCatalog = decodeHgssItemCatalog(
    bytes,
    itemDataArchive,
    decodeHgssMessageBank(bytes, messagesArchive?.archiveMembers[222]),
    decodeHgssMessageBank(bytes, messagesArchive?.archiveMembers[221]),
    decodeHgssMessageBank(bytes, messagesArchive?.archiveMembers[226]),
  )
  const itemIconResolver = createHgssItemIconResolver(bytes, itemIconsArchive)
  const pokemonIconResolver = createPokemonIconResolver(bytes, pokemonIconsArchive)
  const battlePokemonSpriteResolver = createBattlePokemonSpriteResolver(bytes, battleGraphicsArchive, battleFormGraphicsArchive, battlePokemonAnimationArchive, battleSpriteHeightArchive, battleFormSpriteHeightArchive)
  const trainerBattleSpriteResolver = createHgssTrainerBattleSpriteResolver(bytes, trainerBattleSpriteArchive)
  const battleBackgroundResolver = createHgssBattleBackgroundResolver(bytes, battleBackgroundArchive)
  const battleAnimationCatalog = decodeHgssBattleAnimationCatalog(
    bytes,
    moveAnimationScriptArchive,
    battleAnimationScriptArchive,
    battleAnimationResourceArchives as RomFile[],
    createHgssBattleParticleResourceResolver(bytes, battleParticleArchive),
    createHgssBattleSpriteResourceResolver(bytes, battleSpriteResourceArchives as import('./rom/battle/battleSpriteResources').HgssBattleSpriteResourceArchives),
  )
  const battlePrizeMoneyTable = decodeHgssPrizeMoneyTable(bytes)
  const blackoutResolvers = createHgssBlackoutResolvers(bytes)
  const blackoutDestinationResolver = blackoutResolvers.destination
  const blackoutSpawnForMapResolver = blackoutResolvers.spawnForMap
  const flyDestinationResolver = blackoutResolvers.flyDestination
  const phoneContactNames = decodePhoneContactNames(bytes, messagesArchive)
  const phoneContactMessages = Object.fromEntries(hgssPhoneMessageBanks.map((bankId, contactId) => [contactId, decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[bankId]) ?? {}]))
  const phoneGreetingMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[640]) ?? {}
  const radioProgramMessages = Object.fromEntries(hgssRadioMessageBanks.map((bankId, programId) => [programId, decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[bankId]) ?? {}]))
  const storageMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[24]) ?? {}
  const storageBoxNames = Array.from({ length: 18 }, (_, index) => storageMessages[index + 6] ?? '')
  const trainerCatalog = decodeHgssTrainerCatalog(bytes, trainerDataArchive, trainerPartyArchive)
  const trainerMessages = decodeHgssTrainerMessageCatalog(
    bytes,
    trainerMessageTableArchive,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[728]) ?? {},
  )
  const npcTradeCatalog = decodeHgssNpcTradeCatalog(
    bytes,
    npcTradeArchive,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[200]) ?? {},
  )
  const wildEncounterCatalog = decodeHgssWildEncounterCatalog(bytes, wildEncounterArchive)
  const safariEncounterCatalog = decodeHgssSafariEncounterCatalog(bytes, safariEncounterArchive)
  const photoDataCatalog = decodeHgssPhotoDataCatalog(bytes, photoDataArchive)
  const pokedexCatalog = decodeHgssPokedexCatalog(
    bytes,
    johtoDexArchive,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[802]),
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[803]),
    pokedexSpeciesDataArchive, { categoryNames: decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[816]), heightLabels: decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[814]), weightLabels: decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[812]) },
  )
  const battleMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[197]) ?? {}; const uiMessageBanks = Object.fromEntries([0, 2, 5, 6, 10, 19, 24, 25, 40, 45, 66, 135, 157, 191, 196, 249, 269, 270, 271, 273, 282, 300, 302, 427, 428, 429, 430, 435, 442, 720, 825].map((bankId) => [bankId, decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[bankId]) ?? {}]))
  const easyChatCatalog = decodeHgssEasyChatCatalog((bankId) => decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[bankId]))
  const pokeathlonDataMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[277]) ?? {}
  const alphPuzzleArchive = files.find((file) => file.path === '/a/1/7/2')
  const alphPuzzleTiles = Array.from({ length: 4 }, (_, puzzleIndex) => Array.from({ length: 16 }, (_, tileIndex) => (
    decodeArchiveCellGraphic(bytes, alphPuzzleArchive, 4 + puzzleIndex, 0, 8, tileIndex, true)
  )).filter((graphic): graphic is NitroGraphic => graphic !== undefined))
  const alphPuzzleBackground = decodeArchiveTilemapGraphic(bytes, alphPuzzleArchive, 11, 10, 12, false)
  const alphPuzzleMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[2]) ?? {}
  const alphPuzzleHints = Array.from({ length: 4 }, (_, index) => stripMessageControls(alphPuzzleMessages[index + 1] ?? ''))
  const alphHiddenRoomArchive = files.find((file) => file.path === '/a/1/7/4')
  const alphHiddenRoomBackground = decodeArchiveTilemapGraphic(bytes, alphHiddenRoomArchive, 16, 15, 17, false)
  const alphHiddenRoomMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[198]) ?? {}
  const alphHiddenRoomWords = Array.from({ length: 4 }, (_, index) => stripMessageControls(alphHiddenRoomMessages[index] ?? ''))
  const mailMessageBanks = Object.fromEntries([292, 293, 294, 295, 296].map((bankId) => [
    bankId,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[bankId]) ?? {},
  ]))
  const trainerHouseDefaultName = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[726])?.[3] ?? ''
  const blackoutMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[203]) ?? {}
  const trainerNameMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[729]) ?? {}
  const trainerClassMessages = decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[730]) ?? {}
  const trainerNames = Array.from({ length: Object.keys(trainerNameMessages).length }, (_, id) => stripMessageControls(trainerNameMessages[id] ?? ''))
  const trainerClassNames = Array.from({ length: Object.keys(trainerClassMessages).length }, (_, id) => stripMessageControls(trainerClassMessages[id] ?? ''))
  const openingArchive = resourceCatalog.gameData.find((data) => data.id === 'opening')?.file
  const openingMovieArchive = files.find((data) => data.path === '/a/2/6/2')
  const openingParticleArchive = files.find((data) => data.path === '/a/0/5/9')
  const starterMainArchive = files.find((data) => data.path === '/a/0/8/2')
  const introArchive = resourceCatalog.gameData.find((data) => data.id === 'intro')?.file
  const nameInputArchive = resourceCatalog.gameData.find((data) => data.id === 'nameInput')?.file
  const titleMessages = decodeMessageBank(bytes, messagesArchive, 719)
  const introMessages = decodeMessageBank(bytes, messagesArchive, 219)
  const titleLegendAnimation = decodeNitroAnimationPreview(bytes, openingArchive, 26, 'BCA')
  const titleMaterialAnimation = decodeNitroAnimationPreview(bytes, openingArchive, 27, 'BTA') ?? decodeNitroAnimationPreview(bytes, openingArchive, 28, 'BMA')
  const titlePatternAnimation = decodeNitroAnimationPreview(bytes, openingArchive, 29, 'BTP')
  const titleSparkleAnimation = decodeNitroAnimationPreview(bytes, openingArchive, 40, 'BTP')
  const titleLegendBoneMatrices = decodeNitroSkeletalAnimationFrame(bytes, openingArchive, 26, 0)
  const titleLegendModelFrames = decodeNitroSkeletalModelFrames(bytes, openingArchive, openingArchive, 25, 26, titleLegendAnimation?.frameCount, 64)
  const titleLegendModel = decodeNitroModel(bytes, openingArchive, 25, true, titleLegendBoneMatrices)
  const titleScreenPreview = decodeTitleScreenPreview(bytes, openingArchive)
  const introSceneAssets = decodeIntroSceneAssets(bytes, introArchive)
  // Native order from sMap3dResHeaderFileIds: New Bark, Goldenrod, Ecruteak.
  const openingMovieModels = [103, 100, 97]
    .map((member) => decodeNitroModel(bytes, openingMovieArchive, member, true))
    .filter((model): model is NitroModelPreview => model !== undefined)
  const openingMovieModelAnimations = [104, 101, 98]
    .map((member) => decodeNitroAnimationPreview(bytes, openingMovieArchive, member, 'BCA'))
    .filter((animation): animation is NitroAnimationPreview => animation !== undefined)
  // The native scene advances the BCA track once per VBlank. Keep sampled
  // skeletal poses beside each map instead of displaying the bind pose.
  const openingMovieModelFrames = [
    [103, 104, openingMovieModelAnimations[0]?.frameCount],
    [100, 101, openingMovieModelAnimations[1]?.frameCount],
    [97, 98, openingMovieModelAnimations[2]?.frameCount],
  ].map(([model, animation, frameCount]) => decodeNitroSkeletalModelFrames(
    bytes,
    openingMovieArchive,
    openingMovieArchive,
    model,
    animation,
    frameCount,
    32,
  ))
  const openingParticleMember = openingParticleArchive?.archiveMembers[4]
  const openingStarterParticleResource = openingParticleMember
    ? decodeHgssSplParticleResource(
      bytes.subarray(openingParticleMember.offset, openingParticleMember.offset + openingParticleMember.size),
      4,
    )
    : undefined
  const openingCandidateArchives = [
    openingArchive,
    openingMovieArchive,
    files.find((data) => data.path === '/a/2/6/1'),
    files.find((data) => data.path === '/a/2/6/3'),
    files.find((data) => data.path === '/a/2/6/4'),
    files.find((data) => data.path === '/data/demo_climax.narc'),
  ]
  const mapMatrixArchive = resourceCatalog.gameData.find((data) => data.id === 'mapMatrices')?.file
  const areaDataArchive = files.find((data) => data.path === '/a/0/4/2')
  const areaTextureArchive = files.find((data) => data.path === '/a/0/7/0')
  const areaPropTextureArchive = files.find((data) => data.path === '/a/0/4/4')
  const roomModelListsArchive = files.find((data) => data.path === '/a/0/4/3')
  const zoneEventsArchive = resourceCatalog.gameData.find((data) => data.id === 'zoneEvents')?.file
  const landDataArchive = resourceCatalog.gameData.find((data) => data.id === 'landData')?.file
  const fieldTextureAnimationArchive = files.find((data) => data.path === '/data/fldtanime.narc')
  const mapPropAnimationArchive = files.find((data) => data.path === '/a/1/0/6')
  const fieldScriptsArchive = resourceCatalog.gameData.find((data) => data.id === 'fieldScripts')?.file
  const fieldMapPropAnimationMetadataArchive = files.find((data) => data.path === '/a/1/0/7')
  const roomMetadataArchive = files.find((data) => data.path === '/a/1/0/8')
  const roomModelArchive = files.find((data) => data.path === '/a/1/4/8') ?? files.find((data) => data.path === '/fielddata/build_model/bm_room.narc')
  const fieldModelArchive = files.find((data) => data.path === '/fielddata/build_model/bm_field.narc')
  const mapObjectModelArchive = followerGraphicsArchive
  const mapHeaders = decodeRomMapHeaders(bytes)
  const fieldCameraParams = decodeFieldCameraParamsFromRom(bytes)
  if (!fieldScriptsArchive || !messagesArchive) {
    throw new Error('Les archives de scenario HGSS requises sont absentes de la ROM.')
  }
  const playerPreviewByGender: Partial<Record<PlayerGender, NitroTexturePreview>> = {
    male: decodeNitroTextureMember(bytes, mapObjectModelArchive, 69, 'hero.5'),
    female: decodeNitroTextureMember(bytes, mapObjectModelArchive, 70, 'heroine.5'),
  }
  const playerFramesByGender: Partial<Record<PlayerGender, PlayerTextureFrames>> = {
    male: decodePlayerTextureFrames(bytes, mapObjectModelArchive, 69, 'hero'),
    female: decodePlayerTextureFrames(bytes, mapObjectModelArchive, 70, 'heroine'),
  }
  const resolvedMapCatalog: ResolvedMapCatalog = {
    startMapId: 64,
    maps: decodeResolvedMaps(
    bytes,
    mapHeaders,
    // Les warps d'ascenseur et plusieurs transitions scénarisées (dont la
    // terrasse de la Tour Radio) ne sont pas déclarés comme warps statiques
    // dans zone_event. Une exploration limitée au graphe physique les omet
    // donc entièrement. La ROM possède déjà la table canonique des headers :
    // elle est la source globale, le graphe ne sert qu'aux voisinages.
    [64, ...mapHeaders.map((header) => header.mapId)],
    mapMatrixArchive,
    zoneEventsArchive,
    landDataArchive,
    roomModelArchive,
    fieldModelArchive,
    fieldScriptsArchive,
    messagesArchive,
    decodeHgssMessageBank(bytes, messagesArchive.archiveMembers[279]) ?? {},
    decodeStandardScriptBanks(bytes, fieldScriptsArchive, messagesArchive),
    roomMetadataArchive,
    roomModelListsArchive,
    areaDataArchive,
    areaTextureArchive,
    areaPropTextureArchive,
    ),
  }
  const mapEncounterLandmarks = buildMapEncounterLandmarkIndex(resolvedMapCatalog.maps, {
    personalData: pokemonCatalog.personalData,
  })
  const mapVariantResolver = createHgssMapVariantResolver((map, matrix) => ({
    ...map, matrix,
    model: decodeFieldMapModel(bytes, matrix, landDataArchive, areaDataArchive, areaTextureArchive, areaPropTextureArchive, map.header.areaDataBank, map.id) ?? map.model,
    terrain: decodeFieldMapTerrain(bytes, landDataArchive, matrix, map.id) ?? map.terrain,
  }))
  const followerTextureResolver = createFollowerTextureResolver(bytes, followerGraphicsArchive, pokemonCatalog.followers.parameters.length)
  const eventTextureResources = decodeEventTextureResources(bytes, mapObjectModelArchive, resolvedMapCatalog.maps, followerTextureResolver)
  const followerEmoteResolver = createFollowerEmoteResolver(bytes, fieldEffectArchive)
  const grassEffectResolver = createGrassEffectResolver(bytes, fieldEffectArchive)
  const fishingBiteEffectResolver = createFishingBiteEffectResolver(bytes, fieldEffectArchive)
  const mapPropModelCache = new Map<string, NitroModelPreview | undefined>()
  const mapPropModelResolver: RomInventory['mapPropModelResolver'] = (modelId, areaDataBank, domain = 'room') => {
    for (const candidateDomain of resolveAreaMapPropDomains(bytes, areaDataArchive?.archiveMembers[areaDataBank], domain)) {
      const key = `${candidateDomain}:${areaDataBank}:${modelId}`
      if (!mapPropModelCache.has(key)) {
        mapPropModelCache.set(key, decodeMapPropModel(
          bytes,
          candidateDomain === 'field' ? fieldModelArchive : roomModelArchive,
          areaDataArchive,
          areaPropTextureArchive,
          modelId,
          areaDataBank,
        ))
      }
      const resolved = mapPropModelCache.get(key)
      if (resolved) return resolved
    }
    return undefined
  }
  const mapPropAnimationMetadataResolver: RomInventory['mapPropAnimationMetadataResolver'] = (modelId, domain, areaDataBank) => {
    const domains = areaDataBank === undefined ? orderAreaMapPropDomains(domain ?? 'field') : resolveAreaMapPropDomains(bytes, areaDataArchive?.archiveMembers[areaDataBank], domain ?? 'field')
    for (const candidateDomain of domains) {
      const archive = candidateDomain === 'room' ? roomMetadataArchive : fieldMapPropAnimationMetadataArchive
      const member = archive?.archiveMembers[modelId]
      if (member) return decodeMapPropAnimationMetadata(bytes.subarray(member.offset, member.offset + member.size))
    }
    return undefined
  }
  const mapPropAnimationCache = new Map<string, ReturnType<NonNullable<RomInventory['mapPropAnimationResolver']>>>()
  const mapPropAnimationResolver: RomInventory['mapPropAnimationResolver'] = (modelId, areaDataBank, animationArchiveId, domain = 'field') => {
    for (const candidateDomain of resolveAreaMapPropDomains(bytes, areaDataArchive?.archiveMembers[areaDataBank], domain)) {
      const key = `${candidateDomain}:${areaDataBank}:${modelId}:${animationArchiveId}`
      if (!mapPropAnimationCache.has(key)) {
        const skeletalPreview = decodeNitroAnimationPreview(bytes, mapPropAnimationArchive, animationArchiveId, 'BCA')
        const patternPreview = skeletalPreview ? undefined : decodeNitroAnimationPreview(bytes, mapPropAnimationArchive, animationArchiveId, 'BTP')
        const materialPreview = skeletalPreview || patternPreview ? undefined
          : decodeNitroAnimationPreview(bytes, mapPropAnimationArchive, animationArchiveId, 'BTA')
            ?? decodeNitroAnimationPreview(bytes, mapPropAnimationArchive, animationArchiveId, 'BMA')
        const preview = skeletalPreview ?? patternPreview ?? materialPreview
        const modelArchive = candidateDomain === 'field' ? fieldModelArchive : roomModelArchive
        const staticModel = mapPropModelResolver(modelId, areaDataBank, candidateDomain)
        const decodedFrames = skeletalPreview && staticModel
          ? decodeNitroSkeletalModelFrames(bytes, modelArchive, mapPropAnimationArchive, modelId, animationArchiveId, skeletalPreview.frameCount, skeletalPreview.frameCount)
          : patternPreview && staticModel
            ? decodeNitroPatternModelFrames(
              bytes,
              modelArchive,
              modelId,
              mapPropAnimationArchive,
              animationArchiveId,
              staticModel,
              areaPropTextureArchive,
            )
            : materialPreview && staticModel && mapPropAnimationArchive?.archiveMembers[animationArchiveId]
              ? decodeNitroMaterialAnimationFrames(bytes.subarray(mapPropAnimationArchive.archiveMembers[animationArchiveId]!.offset, mapPropAnimationArchive.archiveMembers[animationArchiveId]!.offset + mapPropAnimationArchive.archiveMembers[animationArchiveId]!.size), staticModel)
            : undefined
        const textureIds = new Map((staticModel?.surfaces ?? []).map((surface) => [
          `${surface.materialIndex}:${surface.textureName ?? ''}`,
          surface.textureId,
        ]))
        const frames = decodedFrames?.map((frame) => {
          const resolvedTextures = new Map((staticModel?.textures ?? []).map((texture) => [texture.id, texture]))
          for (const texture of frame.textures ?? []) resolvedTextures.set(texture.id, texture)
          return {
            ...frame,
            textures: [...resolvedTextures.values()],
            surfaces: frame.surfaces?.map((surface) => ({
              ...surface,
              textureId: textureIds.get(`${surface.materialIndex}:${surface.textureName ?? ''}`) ?? surface.textureId,
            })),
          }
        })
        mapPropAnimationCache.set(
          key,
          preview && frames?.length === preview.frameCount
            ? { frameCount: preview.frameCount, frames }
            : undefined,
        )
      }
      const animation = mapPropAnimationCache.get(key)
      if (animation) return animation
    }
    return undefined
  }
  const gymOverlayAssets = createNitroArchiveAssetResolvers(bytes, files, { model: (archive, member) => decodeNitroModel(bytes, archive, member, true), preview: (archive, member, kind) => decodeNitroAnimationPreview(bytes, archive, member, kind), skeletal: (archive, model, animation, frames) => decodeNitroSkeletalModelFrames(bytes, archive, archive, model, animation, frames, frames), pattern: (archive, modelMember, animation, model) => decodeNitroPatternModelFrames(bytes, archive, modelMember, archive, animation, model, undefined), material: decodeNitroMaterialAnimationFrames })
  const fieldTextureAnimations = decodeFieldTextureAnimations(bytes, fieldTextureAnimationArchive)
  const eventTexturePreviews = eventTextureResources.eventTexturePreviews ?? {}
  const eventTextureFrames = eventTextureResources.eventTextureFrames ?? {}
  if (playerPreviewByGender.male) eventTexturePreviews[0] = playerPreviewByGender.male
  if (playerPreviewByGender.female) eventTexturePreviews[97] = playerPreviewByGender.female
  if (playerFramesByGender.male) eventTextureFrames[0] = playerFramesByGender.male
  if (playerFramesByGender.female) eventTextureFrames[97] = playerFramesByGender.female
  eventTextureResources.eventTexturePreviews = eventTexturePreviews
  eventTextureResources.eventTextureFrames = eventTextureFrames
  return {
    metadata,
    files,
    totalDataSize,
    archiveEntryCount,
    filesystemOffset: fntOffset,
    filesystemSize: fntSize + fatSize,
    graphicPreview: findGraphicPreview(bytes),
    openingGraphicPreview: titleScreenPreview?.composite ?? findBestArchiveGraphicPreview(bytes, openingCandidateArchives),
    openingMovieGraphics: decodeOpeningMovieGraphics(bytes, openingMovieArchive),
    openingMovieSceneGraphics: decodeOpeningMovieSceneGraphics(bytes, openingMovieArchive),
    openingMovieSprites: decodeOpeningMovieSprites(bytes, openingMovieArchive),
    openingMovieModels,
    openingMovieModelFrames,
    openingMovieModelAnimations,
    openingStarterParticleResource,
    titleBackgroundGraphicPreview: titleScreenPreview?.background,
    titleLogoGraphicPreview: titleScreenPreview?.logo,
    titleCreditGraphicPreview: titleScreenPreview?.credit,
    introOakGraphicPreview: decodeIntroOakScreenPreview(bytes, introArchive),
    introGraphicPreview: decodeIntroGenderScreenPreview(bytes, introArchive) ?? findArchiveGraphicPreview(bytes, introArchive, true),
    ...introSceneAssets,
    nameInputGraphicPreview: decodeNameInputScreenPreview(bytes, nameInputArchive),
    fontGraphicPreview: decodeRomFontGraphic(bytes, files),
    titleLegendModel,
    titleLegendModelFrames,
    titleSparklesModel: decodeNitroModel(bytes, openingArchive, 38, true),
    starterMachineModel: mergeNitroModels([0, 1, 2].map((member) => decodeNitroModel(bytes, starterMainArchive, member, true))),
    titleLegendAnimation,
    titleMaterialAnimation,
    titlePatternAnimation,
    titleSparkleAnimation,
    titleTouchMessage: titleMessages?.[0] ? stripMessageControls(titleMessages[0]) : undefined,
    introMessages,
    playerTexturePreview: playerPreviewByGender.male,
    playerTextureFrames: playerFramesByGender.male,
    playerTexturePreviewsByGender: playerPreviewByGender,
    playerTextureFramesByGender: playerFramesByGender,
    fieldTextureAnimations,
    fieldCameraParams,
    pokemonCatalog, pokeathlonPerformanceCatalog: decodeHgssPokeathlonPerformanceCatalog(bytes, pokeathlonPerformanceArchive),
    followerReactionCatalog,
    itemCatalog,
    uiAssets: decodeHgssUiAssets(bytes, files),
    safariUiAssets: decodeHgssSafariUiAssets(bytes, files),
    pokegearMapData: decodeHgssPokegearMapData(bytes),
    mapEncounterLandmarks,
    itemIconResolver,
    pokemonIconResolver,
    battlePokemonSpriteResolver,
    trainerBattleSpriteResolver,
    battleBackgroundResolver,
    battleAnimationCatalog,
    battlePrizeMoneyTable,
    blackoutDestinationResolver,
    blackoutSpawnForMapResolver,
    flyDestinationResolver,
    phoneContactNames,
    phoneContactMessages,
    phoneGreetingMessages,
    radioProgramMessages,
    phoneBookEntries,
    storageBoxNames,
    trainerCatalog,
    trainerMessages,
    npcTradeCatalog,
    wildEncounterCatalog,
    safariEncounterCatalog,
    photoDataCatalog,
    pokedexCatalog,
    easyChatCatalog,
    pokeathlonDataMessages,
    alphPuzzleTiles,
    alphPuzzleBackground,
    alphPuzzleHints,
    alphHiddenRoomBackground,
    alphHiddenRoomWords,
    mailMessageBanks,
    trainerHouseDefaultName,
    battleMessages, uiMessageBanks,
    blackoutMessages,
    trainerNames,
    trainerClassNames,
    followerTextureResolver,
    followerEmoteResolver,
    grassEffectResolver,
    fishingBiteEffectResolver,
    mapPropModelResolver,
    mapPropAnimationMetadataResolver,
    mapPropAnimationResolver,
    ...gymOverlayAssets,
    mapVariantResolver,
    ...eventTextureResources,
    soundArchive,
    resolvedMapCatalog,
    resourceCatalog,
  }
}
