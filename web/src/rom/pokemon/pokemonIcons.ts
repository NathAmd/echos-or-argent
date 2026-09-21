import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { decodeNitroGraphicPayload } from '../graphics/nitro2d'
import { readArm9FromRom } from '../maps/mapHeaders'

const maxSpeciesId = 493
const paletteTableLength = 544
const baseIconMemberOffset = 7

const species = {
  unown: 201,
  deoxys: 386,
  burmy: 412,
  wormadam: 413,
  shellos: 422,
  gastrodon: 423,
  rotom: 479,
  giratina: 487,
  manaphy: 490,
  shaymin: 492,
} as const

const formLimits = new Map<number, number>([
  [species.unown, 28], [species.deoxys, 4], [species.burmy, 3], [species.wormadam, 3],
  [species.shellos, 2], [species.gastrodon, 2], [species.rotom, 6], [species.giratina, 2], [species.shaymin, 2],
])

const paletteSignature = [
  0, 1, 1, 1, 0, 0, 0, 0, 2, 2, 1, 1, 0, 1, 2, 2,
  0, 0, 0, 2, 1, 0, 0, 2, 2, 2, 0, 2, 2, 2, 2, 2,
] as const

export type PokemonIconPreview = {
  memberIndex: number
  paletteIndex: number
  frames: NitroGraphic[]
}

function normalizeForm(speciesId: number, form: number): number {
  const limit = formLimits.get(speciesId)
  return limit !== undefined && Number.isInteger(form) && form >= 0 && form < limit ? form : 0
}

export function getPokemonIconMemberIndex(speciesId: number, form = 0, isEgg = false): number {
  if (isEgg) return speciesId === species.manaphy ? 502 : 501
  const normalizedSpecies = Number.isInteger(speciesId) && speciesId >= 0 && speciesId <= maxSpeciesId ? speciesId : 0
  const normalizedForm = normalizeForm(normalizedSpecies, form)
  if (normalizedForm !== 0) {
    if (normalizedSpecies === species.deoxys) return normalizedForm + 502
    if (normalizedSpecies === species.unown) return normalizedForm + 506
    if (normalizedSpecies === species.burmy) return normalizedForm + 533
    if (normalizedSpecies === species.wormadam) return normalizedForm + 535
    if (normalizedSpecies === species.shellos) return normalizedForm + 537
    if (normalizedSpecies === species.gastrodon) return normalizedForm + 538
    if (normalizedSpecies === species.giratina) return normalizedForm + 539
    if (normalizedSpecies === species.shaymin) return normalizedForm + 540
    if (normalizedSpecies === species.rotom) return normalizedForm + 541
  }
  return normalizedSpecies + baseIconMemberOffset
}

function getPokemonPaletteLookupIndex(speciesId: number, form = 0, isEgg = false): number {
  if (isEgg) return speciesId === species.manaphy ? 495 : 494
  const normalizedSpecies = Number.isInteger(speciesId) && speciesId >= 0 && speciesId <= maxSpeciesId ? speciesId : 0
  const normalizedForm = normalizeForm(normalizedSpecies, form)
  if (normalizedForm !== 0) {
    if (normalizedSpecies === species.deoxys) return normalizedForm + 495
    if (normalizedSpecies === species.unown) return normalizedForm + 498
    if (normalizedSpecies === species.burmy) return normalizedForm + 526
    if (normalizedSpecies === species.wormadam) return normalizedForm + 528
    if (normalizedSpecies === species.shellos) return normalizedForm + 530
    if (normalizedSpecies === species.gastrodon) return normalizedForm + 531
    if (normalizedSpecies === species.giratina) return normalizedForm + 532
    if (normalizedSpecies === species.shaymin) return normalizedForm + 533
    if (normalizedSpecies === species.rotom) return normalizedForm + 534
  }
  return normalizedSpecies
}

export function locatePokemonIconPaletteTable(arm9: Uint8Array): number {
  const matches: number[] = []
  for (let offset = 0; offset + paletteTableLength <= arm9.byteLength; offset += 1) {
    if (!paletteSignature.every((value, index) => arm9[offset + index] === value)) continue
    if (arm9.subarray(offset, offset + paletteTableLength).some((value) => value > 2)) continue
    if (arm9[offset + 152] !== 1 || arm9[offset + 155] !== 1 || arm9[offset + 158] !== 2) continue
    if (arm9[offset + 494] !== 1 || arm9[offset + 495] !== 2 || arm9[offset + 543] !== 1) continue
    matches.push(offset)
  }
  if (matches.length !== 1) {
    throw new Error(`La table ARM9 des palettes d'icônes Pokémon HGSS doit être unique; ${matches.length} candidate(s) trouvée(s).`)
  }
  return matches[0]!
}

export function decodePokemonIconPaletteIndexes(arm9: Uint8Array, tableOffset = locatePokemonIconPaletteTable(arm9)): Uint8Array {
  if (!Number.isInteger(tableOffset) || tableOffset < 0 || tableOffset + paletteTableLength > arm9.byteLength) {
    throw new Error("La table ARM9 des palettes d'icônes Pokémon HGSS est hors limites.")
  }
  return arm9.slice(tableOffset, tableOffset + paletteTableLength)
}

function readMember(rom: Uint8Array, archive: RomFile, memberIndex: number): Uint8Array {
  const member = archive.archiveMembers[memberIndex]
  if (!member) throw new Error(`Le membre ${memberIndex} des icônes Pokémon HGSS est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${memberIndex} des icônes Pokémon HGSS est hors limites.`)
  }
  return rom.subarray(member.offset, member.offset + member.size)
}

function splitIconFrames(graphic: NitroGraphic): NitroGraphic[] {
  const frameSize = 32
  if (graphic.width !== frameSize || graphic.height < frameSize || graphic.height % frameSize !== 0) {
    throw new Error(`La planche d'icône Pokémon HGSS mesure ${graphic.width} × ${graphic.height} au lieu d'un multiple vertical de 32 × 32.`)
  }
  return Array.from({ length: graphic.height / frameSize }, (_, frameIndex) => {
    const pixels = new Uint8ClampedArray(frameSize * frameSize * 4)
    const start = frameIndex * frameSize * graphic.width * 4
    pixels.set(graphic.pixels.subarray(start, start + pixels.length))
    return { ...graphic, width: frameSize, height: frameSize, pixels }
  })
}

export function createPokemonIconResolver(rom: Uint8Array, archive: RomFile): (speciesId: number, form?: number, isEgg?: boolean) => PokemonIconPreview {
  const paletteIndexes = decodePokemonIconPaletteIndexes(readArm9FromRom(rom))
  const palettePayload = readMember(rom, archive, 0)
  const cache = new Map<string, PokemonIconPreview>()
  return (speciesId, form = 0, isEgg = false) => {
    const key = `${speciesId}:${form}:${isEgg ? 1 : 0}`
    const cached = cache.get(key)
    if (cached) return cached
    const memberIndex = getPokemonIconMemberIndex(speciesId, form, isEgg)
    const paletteLookupIndex = getPokemonPaletteLookupIndex(speciesId, form, isEgg)
    const paletteIndex = paletteIndexes[paletteLookupIndex]
    if (paletteIndex === undefined) throw new Error(`La palette de l'icône Pokémon HGSS ${speciesId}:${form} est absente.`)
    const graphic = decodeNitroGraphicPayload(readMember(rom, archive, memberIndex), palettePayload, true, paletteIndex, 4)
    if (!graphic) throw new Error(`L'icône Pokémon HGSS ${speciesId}:${form} est invalide.`)
    const preview = { memberIndex, paletteIndex, frames: splitIconFrames(graphic) }
    cache.set(key, preview)
    return preview
  }
}
