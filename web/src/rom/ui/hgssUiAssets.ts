import type { NitroCellSpritePreview, NitroGraphic, RomFile } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import { decodeNitroGraphicPayload, decodeNitroTilemapGraphicPayload } from '../graphics/nitro2d'
import { decodeNitroCellGraphicPayload, readNitroCells } from '../graphics/nitroCells'
import { decodeNitroCellAnimationPayload } from '../graphics/nitroCellAnimations'

export type HgssUiAssets = {
  windowFrames: readonly NitroGraphic[]
  bagBackgrounds: readonly [NitroGraphic, NitroGraphic]
  bagPocketPanel: NitroGraphic
  /** Canevas NSCR 64 x 64 natifs, blocs de composition inclus. */
  pokegearMapAtlases: readonly NitroGraphic[]
  /** Même NSCR avec couleur 0 transparente pour la couche de surbrillance. */
  pokegearMapHighlightAtlases: readonly NitroGraphic[]
  pokegearMapBackgrounds: readonly NitroGraphic[]
  pokegearMapMarkingBackgrounds: readonly NitroGraphic[]
  pokegearMapMarkingIcons: readonly NitroGraphic[]
  /** Resource sets OBJ natifs du header resdat 80, nommés selon l'overlay HGSS. */
  pokegearMapObjectSprites: {
    markings: NitroCellSpritePreview
    map: NitroCellSpritePreview
    wordSlots: NitroCellSpritePreview
  }
  pokegearShells: readonly NitroGraphic[]
  pokegearConfigureBackgrounds: readonly NitroGraphic[]
  pokegearPhoneBackgrounds: readonly NitroGraphic[]
  /** Superposition native MAIN_3 + MAIN_2 de l'écran de réglage. */
  pokegearRadioBackgrounds: readonly NitroGraphic[]
  /** Couche native SUB_3 de l'écran de diffusion. */
  pokegearRadioBroadcastBackgrounds: readonly NitroGraphic[]
  /** Resource set OBJ natif du header resdat 81 (curseur tuner en séquence 0). */
  pokegearRadioObjectSprites: NitroCellSpritePreview
  /** Ecrans d'entrée natifs de 23 zones, résolus selon l'heure HGSS. */
  pokegearLocationPreviewResolver: (mapId: number, visualTime: 0 | 1 | 2 | 3) => NitroGraphic | undefined
  /** Bandeau natif indexé par MapHeader.areaIcon (1..9). */
  pokegearAreaBannerResolver: (areaIcon: number) => NitroGraphic | undefined
}

const windowFrameArchivePath = '/pbr/winframe.narc'
const bagArchivePath = '/pbr/bag_gra.narc'
const pokegearMapArchivePath = '/a/1/4/4'
const pokegearShellArchivePath = '/a/1/4/3'
const pokegearConfigureArchivePath = '/a/1/4/5'
const pokegearPhoneArchivePath = '/a/1/4/6'
const pokegearRadioArchivePath = '/a/1/4/7'
const locationPreviewArchivePath = '/a/1/5/0'
const areaBannerArchivePath = '/a/1/6/3'

type LocationPreviewSpec = {
  mapIds: readonly number[]
  memberStart: number
  variantCount: 3 | 4
}

// Table native des écrans d'entrée: chaque variante est stockée sous la
// forme NCLR, NCGR, NSCR. Les deux entrées partagées sont celles de la ROM.
const locationPreviewSpecs: readonly LocationPreviewSpec[] = [
  { mapIds: [123], memberStart: 0, variantCount: 3 },
  { mapIds: [176], memberStart: 9, variantCount: 3 },
  { mapIds: [110], memberStart: 18, variantCount: 3 },
  { mapIds: [323, 491], memberStart: 27, variantCount: 3 },
  { mapIds: [99], memberStart: 36, variantCount: 3 },
  { mapIds: [114], memberStart: 45, variantCount: 3 },
  { mapIds: [117], memberStart: 54, variantCount: 4 },
  { mapIds: [96], memberStart: 66, variantCount: 4 },
  { mapIds: [7], memberStart: 78, variantCount: 4 },
  { mapIds: [111], memberStart: 90, variantCount: 4 },
  { mapIds: [121], memberStart: 102, variantCount: 3 },
  { mapIds: [119], memberStart: 111, variantCount: 4 },
  { mapIds: [120], memberStart: 123, variantCount: 3 },
  { mapIds: [125], memberStart: 132, variantCount: 3 },
  { mapIds: [126], memberStart: 141, variantCount: 3 },
  { mapIds: [124, 179], memberStart: 150, variantCount: 3 },
  { mapIds: [147], memberStart: 159, variantCount: 4 },
  { mapIds: [106], memberStart: 171, variantCount: 3 },
  { mapIds: [108], memberStart: 180, variantCount: 3 },
  { mapIds: [107], memberStart: 189, variantCount: 4 },
  { mapIds: [146], memberStart: 201, variantCount: 3 },
  { mapIds: [122], memberStart: 210, variantCount: 3 },
  { mapIds: [145], memberStart: 219, variantCount: 3 },
] as const

export function resolvePokegearLocationPreviewMember(mapId: number, visualTime: 0 | 1 | 2 | 3): number | undefined {
  const spec = locationPreviewSpecs.find(({ mapIds }) => mapIds.includes(mapId))
  if (!spec) return undefined
  const variant = spec.variantCount === 3 && visualTime === 2 ? 1 : Math.min(spec.variantCount - 1, visualTime)
  return spec.memberStart + variant * 3
}

function requireArchive(files: readonly RomFile[], path: string): RomFile {
  const archive = files.find((file) => file.path === path)
  if (!archive) throw new Error(`L'archive UI ROM ${path} est absente.`)
  return archive
}

function readMember(rom: Uint8Array, archive: RomFile, memberIndex: number): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member) throw new Error(`Le membre UI ROM ${archive.path}[${memberIndex}] est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre UI ROM ${archive.path}[${memberIndex}] est hors limites.`)
  }
  const packed = rom.subarray(member.offset, member.offset + member.size)
  return decompressLz10(packed) ?? packed
}

function requireGraphic(label: string, graphic: NitroGraphic | undefined): NitroGraphic {
  if (!graphic) throw new Error(`La ressource UI ROM ${label} est invalide.`)
  return graphic
}

function decodeUiCellSprite(
  label: string,
  graphicPayload: Uint8Array,
  palettePayload: Uint8Array,
  cellPayload: Uint8Array,
  animationPayload: Uint8Array,
): NitroCellSpritePreview {
  const cells = readNitroCells(cellPayload)
  const animation = decodeNitroCellAnimationPayload(animationPayload)
  if (!cells?.length || !animation) throw new Error(`La ressource OBJ UI ROM ${label} est invalide.`)
  const frames = cells.map((_, cellIndex) => requireGraphic(
    `${label}, cellule ${cellIndex}`,
    decodeNitroCellGraphicPayload(graphicPayload, palettePayload, cellPayload, cellIndex),
  ))
  const invalidCell = animation.sequences.flatMap(({ frames: sequenceFrames }) => sequenceFrames)
    .find(({ cellIndex }) => !frames[cellIndex])
  if (invalidCell) throw new Error(`L'animation OBJ UI ROM ${label} référence la cellule absente ${invalidCell.cellIndex}.`)
  return { frames, animation }
}

function cropPokegearMap(graphic: NitroGraphic): NitroGraphic {
  const width = 47 * 8
  const height = 160
  if (graphic.width !== 512 || graphic.height < height) throw new Error(`Le fond Carte du Pokématos mesure ${graphic.width} × ${graphic.height}, au lieu du canevas natif 512 × 512.`)
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    const sourceOffset = y * graphic.width * 4
    pixels.set(graphic.pixels.subarray(sourceOffset, sourceOffset + width * 4), y * width * 4)
  }
  return { ...graphic, width, height, pixels }
}

function cropGraphic(label: string, graphic: NitroGraphic, height: number): NitroGraphic {
  if (graphic.width !== 256 || graphic.height < height) throw new Error(`${label} mesure ${graphic.width} × ${graphic.height}, au lieu du canevas natif 256 × ${height}.`)
  return { ...graphic, height, pixels: graphic.pixels.slice(0, graphic.width * height * 4) }
}

function compositeGraphics(label: string, background: NitroGraphic, foreground: NitroGraphic, width: number, height: number): NitroGraphic {
  if (background.width < width || background.height < height || foreground.width < width || foreground.height < height) {
    throw new Error(`${label} ne couvre pas le canevas natif ${width} × ${height}.`)
  }
  const pixels = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const destination = (y * width + x) * 4
      const back = (y * background.width + x) * 4
      const front = (y * foreground.width + x) * 4
      const source = foreground.pixels[front + 3] === 0 ? background.pixels : foreground.pixels
      const offset = source === foreground.pixels ? front : back
      pixels[destination] = source[offset]
      pixels[destination + 1] = source[offset + 1]
      pixels[destination + 2] = source[offset + 2]
      pixels[destination + 3] = source[offset + 3]
    }
  }
  return { ...background, width, height, pixels }
}

function repackPokegearAreaBanner(source: NitroGraphic): NitroGraphic {
  if (source.width !== 256 || source.height < 24) {
    throw new Error(`La source du bandeau Pokématos mesure ${source.width} × ${source.height}, au lieu de 256 × 24.`)
  }
  const width = 17 * 8
  const height = 4 * 8
  const pixels = new Uint8ClampedArray(width * height * 4)
  // AreaNameWindow_LoadGfx saute la tuile 0 et copie les 68 suivantes dans
  // une grille 17 × 4 avant d'imprimer le nom localisé dans la fenêtre.
  for (let tile = 0; tile < 68; tile += 1) {
    const sourceTile = tile + 1
    const sourceX = sourceTile % 32 * 8
    const sourceY = Math.floor(sourceTile / 32) * 8
    const destinationX = tile % 17 * 8
    const destinationY = Math.floor(tile / 17) * 8
    for (let y = 0; y < 8; y += 1) {
      const sourceOffset = ((sourceY + y) * source.width + sourceX) * 4
      const destinationOffset = ((destinationY + y) * width + destinationX) * 4
      pixels.set(source.pixels.subarray(sourceOffset, sourceOffset + 8 * 4), destinationOffset)
    }
  }
  return { ...source, width, height, pixels }
}

function decodePokegearSkins(rom: Uint8Array, archive: RomFile, label: string, graphicMember: number, paletteMember: number, screenMember: number, height: number): NitroGraphic[] {
  return Array.from({ length: 6 }, (_, skin) => cropGraphic(`${label} ${skin}`, requireGraphic(label,
    decodeNitroTilemapGraphicPayload(readMember(rom, archive, graphicMember + skin), readMember(rom, archive, paletteMember + skin), readMember(rom, archive, screenMember + skin), false),
  ), height))
}

export function decodeHgssUiAssets(rom: Uint8Array, files: readonly RomFile[]): HgssUiAssets {
  const windows = requireArchive(files, windowFrameArchivePath)
  // Les 22 NCGR 0..21 sont appariés aux 22 NCLR 24..45 dans l'ordre natif.
  const windowFrames = Array.from({ length: 22 }, (_, index) => requireGraphic(
    `cadre ${index}`,
    decodeNitroGraphicPayload(readMember(rom, windows, index), readMember(rom, windows, index + 24)),
  ))

  const bag = requireArchive(files, bagArchivePath)
  const bagBackgrounds = [9, 10].map((screenMember) => requireGraphic(
    `fond du Sac ${screenMember}`,
    decodeNitroTilemapGraphicPayload(
      readMember(rom, bag, 7),
      readMember(rom, bag, 8),
      readMember(rom, bag, screenMember),
      false,
    ),
  )) as [NitroGraphic, NitroGraphic]
  const bagPocketPanel = requireGraphic(
    'panneau de poche du Sac',
    decodeNitroTilemapGraphicPayload(readMember(rom, bag, 11), readMember(rom, bag, 12), readMember(rom, bag, 13), false),
  )

  const pokegearMap = requireArchive(files, pokegearMapArchivePath)
  // ov101_021EAF40 copie exactement 47 × 20 tuiles depuis le NSCR 11. Le
  // stockage restant (64 × 64) contient les blocs de remplacement et ne fait
  // pas partie de la carte affichée.
  const pokegearMapOpaqueAtlases = Array.from({ length: 6 }, (_, frame) => requireGraphic(
    `fond Carte du Pokématos ${frame}`,
    decodeNitroTilemapGraphicPayload(readMember(rom, pokegearMap, 10), readMember(rom, pokegearMap, 20 + frame), readMember(rom, pokegearMap, 11), false),
  ))
  const pokegearMapBackgrounds = pokegearMapOpaqueAtlases.map(cropPokegearMap)
  const pokegearMapAtlases = pokegearMapOpaqueAtlases
  const pokegearMapHighlightAtlases = Array.from({ length: 6 }, (_, frame) => requireGraphic(
    `surbrillance Carte du Pokématos ${frame}`,
    decodeNitroTilemapGraphicPayload(readMember(rom, pokegearMap, 10), readMember(rom, pokegearMap, 20 + frame), readMember(rom, pokegearMap, 11), true),
  ))
  // Le mode annotations superpose les NSCR 44+skin (fond) et 38+skin
  // (panneau), tous deux sur le NCGR 10 et la palette principale 20+skin.
  const pokegearMapMarkingBackgrounds = Array.from({ length: 6 }, (_, frame) => compositeGraphics(
    `fond Annotations du Pokématos ${frame}`,
    requireGraphic('fond des annotations', decodeNitroTilemapGraphicPayload(readMember(rom, pokegearMap, 10), readMember(rom, pokegearMap, 20 + frame), readMember(rom, pokegearMap, 44 + frame), true)),
    requireGraphic('panneau des annotations', decodeNitroTilemapGraphicPayload(readMember(rom, pokegearMap, 10), readMember(rom, pokegearMap, 20 + frame), readMember(rom, pokegearMap, 38 + frame), true)),
    256,
    112,
  ))
  // Le header resdat 80 impose cet ordre précis : resourceSet 0 = membres
  // 4/5/6 (annotations), 1 = 1/2/3 (carte), 2 = 7/8/9 (slots de mots).
  // Tous partagent la palette OBJ du membre 0.
  const mapObjectPalette = readMember(rom, pokegearMap, 0)
  const pokegearMapObjectSprites = {
    markings: decodeUiCellSprite(
      'annotations du Pokématos',
      readMember(rom, pokegearMap, 4),
      mapObjectPalette,
      readMember(rom, pokegearMap, 5),
      readMember(rom, pokegearMap, 6),
    ),
    map: decodeUiCellSprite(
      'objets de la Carte du Pokématos',
      readMember(rom, pokegearMap, 1),
      mapObjectPalette,
      readMember(rom, pokegearMap, 2),
      readMember(rom, pokegearMap, 3),
    ),
    wordSlots: decodeUiCellSprite(
      'slots de mots de la Carte du Pokématos',
      readMember(rom, pokegearMap, 7),
      mapObjectPalette,
      readMember(rom, pokegearMap, 8),
      readMember(rom, pokegearMap, 9),
    ),
  }
  // Le code natif garde la séquence 0 active puis passe directement l'identifiant
  // MapMarkingIcon à Sprite_SetAnimationFrame. L'ordre des cellules doit donc
  // venir du NANR, jamais de l'ordre physique du NCER (qui contient aussi les
  // cadres, curseurs et autres sprites de l'application).
  // Le header resdat 80 relie le resourceSet 0 à NCGR 4 / NCER 5 /
  // NANR 6 (la palette OBJ commune reste NCLR 0).
  const markingCellIndices = pokegearMapObjectSprites.markings.animation.sequences[0]?.frames.slice(0, 8).map(({ cellIndex }) => cellIndex) ?? []
  if (markingCellIndices.length !== 8) throw new Error("L'animation ROM des huit annotations du Pokématos est absente ou tronquée.")
  const pokegearMapMarkingIcons = markingCellIndices.map((cellIndex) => pokegearMapObjectSprites.markings.frames[cellIndex]!)

  // Chaque application recharge ces mêmes six indices de peau depuis son archive.
  // Les tilemaps Téléphone/Radio contiennent des données sous l'écran DS : seul le
  // viewport réellement copié par les overlays natifs est conservé.
  const pokegearShells = decodePokegearSkins(rom, requireArchive(files, pokegearShellArchivePath), 'coque Pokématos', 48, 30, 54, 96)
  const pokegearConfigureBackgrounds = decodePokegearSkins(rom, requireArchive(files, pokegearConfigureArchivePath), 'habillage Pokématos', 10, 4, 16, 192)
  const pokegearPhoneBackgrounds = decodePokegearSkins(rom, requireArchive(files, pokegearPhoneArchivePath), 'fond Téléphone Pokématos', 28, 10, 34, 160)
  const pokegearRadio = requireArchive(files, pokegearRadioArchivePath)
  // L'overlay Radio charge deux tilemaps sur l'écran de réglage : MAIN_3 est
  // la base opaque (NSCR 28+skin) et MAIN_2 la couche transparente (22+skin).
  // Les décoder séparément évite de perdre le vrai fond ou d'inventer un
  // cadran CSS à sa place.
  const pokegearRadioBackgrounds = Array.from({ length: 6 }, (_, skin) => compositeGraphics(
    `écran de réglage Radio Pokématos ${skin}`,
    requireGraphic('base Radio Pokématos', decodeNitroTilemapGraphicPayload(
      readMember(rom, pokegearRadio, 16 + skin),
      readMember(rom, pokegearRadio, 10 + skin),
      readMember(rom, pokegearRadio, 28 + skin),
      false,
    )),
    requireGraphic('couche Radio Pokématos', decodeNitroTilemapGraphicPayload(
      readMember(rom, pokegearRadio, 16 + skin),
      readMember(rom, pokegearRadio, 10 + skin),
      readMember(rom, pokegearRadio, 22 + skin),
      true,
    )),
    256,
    192,
  ))
  // L'écran inférieur emploie un second jeu NCGR/NCLR/NSCR. Il devient la
  // texture de la diffusion dans la présentation remasterisée.
  const pokegearRadioBroadcastBackgrounds = decodePokegearSkins(
    rom,
    pokegearRadio,
    'écran de diffusion Radio Pokématos',
    34,
    4,
    40,
    192,
  )
  // Le header resdat 81 ne déclare qu'un resourceSet. Dans l'overlay natif,
  // seul sprites[4], réglé sur la séquence 0, reste affiché en permanence.
  const pokegearRadioObjectSprites = decodeUiCellSprite(
    'objets de la Radio du Pokématos',
    readMember(rom, pokegearRadio, 1),
    readMember(rom, pokegearRadio, 0),
    readMember(rom, pokegearRadio, 2),
    readMember(rom, pokegearRadio, 3),
  )

  const locationPreviews = requireArchive(files, locationPreviewArchivePath)
  if (locationPreviews.archiveMembers.length !== 228) {
    throw new Error(`L'archive ROM des écrans d'entrée contient ${locationPreviews.archiveMembers.length} membres au lieu de 228.`)
  }
  const locationPreviewCache = new Map<string, NitroGraphic>()
  const pokegearLocationPreviewResolver = (mapId: number, visualTime: 0 | 1 | 2 | 3): NitroGraphic | undefined => {
    const member = resolvePokegearLocationPreviewMember(mapId, visualTime)
    if (member === undefined) return undefined
    const key = `${member}`
    const cached = locationPreviewCache.get(key)
    if (cached) return cached
    const graphic = decodeNitroTilemapGraphicPayload(
      readMember(rom, locationPreviews, member + 1),
      readMember(rom, locationPreviews, member),
      readMember(rom, locationPreviews, member + 2),
      false,
    )
    if (!graphic) throw new Error(`L'écran d'entrée ROM ${member / 3} est invalide.`)
    const cropped = cropGraphic(`écran d'entrée ROM ${member / 3}`, graphic, 192)
    locationPreviewCache.set(key, cropped)
    return cropped
  }

  const areaBanners = requireArchive(files, areaBannerArchivePath)
  if (areaBanners.archiveMembers.length !== 18) {
    throw new Error(`L'archive ROM des bandeaux de zone contient ${areaBanners.archiveMembers.length} membres au lieu de 18.`)
  }
  const areaBannerCache = new Map<number, NitroGraphic>()
  const pokegearAreaBannerResolver = (areaIcon: number): NitroGraphic | undefined => {
    if (!Number.isInteger(areaIcon) || areaIcon < 1 || areaIcon > 9) return undefined
    const cached = areaBannerCache.get(areaIcon)
    if (cached) return cached
    const member = (areaIcon - 1) * 2
    const source = requireGraphic(
      `bandeau de zone ${areaIcon}`,
      decodeNitroGraphicPayload(readMember(rom, areaBanners, member), readMember(rom, areaBanners, member + 1), true, 0, 32),
    )
    const graphic = repackPokegearAreaBanner(source)
    areaBannerCache.set(areaIcon, graphic)
    return graphic
  }

  return {
    windowFrames,
    bagBackgrounds,
    bagPocketPanel,
    pokegearMapAtlases,
    pokegearMapHighlightAtlases,
    pokegearMapBackgrounds,
    pokegearMapMarkingBackgrounds,
    pokegearMapMarkingIcons,
    pokegearMapObjectSprites,
    pokegearShells,
    pokegearConfigureBackgrounds,
    pokegearPhoneBackgrounds,
    pokegearRadioBackgrounds,
    pokegearRadioBroadcastBackgrounds,
    pokegearRadioObjectSprites,
    pokegearLocationPreviewResolver,
    pokegearAreaBannerResolver,
  }
}
