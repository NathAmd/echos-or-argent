import type { NitroGraphic, RomFile } from '../../ndsTypes'
import { nitroColorToRgba, readNitroPalette } from '../graphics/nitro2d'

const maxStandardSpeciesId = 493
const membersPerSpecies = 6
const spriteSize = 80
const sheetWidth = spriteSize * 2
const encryptedPixelBytes = 6400
const animationRecordSize = 89
const animationFacingSize = 43
const animationCommandCount = 10

export type BattlePokemonSpriteFacing = 'back' | 'front'

export type BattlePokemonSpriteRequest = {
  speciesId: number
  gender: 'male' | 'female' | 'genderless'
  facing: BattlePokemonSpriteFacing
  shiny: boolean
  form?: number
}

export type BattlePokemonSprite = {
  graphic: NitroGraphic
  frames: NitroGraphic[]
  animationScript: BattlePokemonAnimationCommand[]
  height: number
  memberIndex: number
  paletteMemberIndex: number
  animationFrameCount: number
}

export type BattlePokemonAnimationCommand = {
  next: number
  duration: number
  xOffset: number
}

export type BattlePokemonAnimationSample = {
  frameIndex: 0 | 1
  xOffset: number
  complete: boolean
}

export type BattlePokemonMemberIndexes = {
  archive: 'standard' | 'forms'
  graphic: number
  palette: number
  height: number
  animationSpeciesId: number
}

function requireMember(rom: Uint8Array, archive: RomFile, index: number): Uint8Array {
  const member = archive.archiveMembers[index]
  if (!member) throw new Error(`Le membre ${index} des sprites de combat HGSS est absent.`)
  if (member.offset < 0 || member.size < 0 || member.offset + member.size > rom.byteLength) {
    throw new Error(`Le membre ${index} des sprites de combat HGSS est hors limites.`)
  }
  return rom.slice(member.offset, member.offset + member.size)
}

function getPixelDataRange(payload: Uint8Array): { offset: number, size: number } {
  if (payload.byteLength < 0x30 || String.fromCharCode(...payload.subarray(0, 4)) !== 'RGCN') {
    throw new Error("Le sprite de combat HGSS n'est pas un NCGR valide.")
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  const blockOffset = view.getUint16(12, true)
  if (blockOffset < 16 || blockOffset + 32 > payload.byteLength
    || String.fromCharCode(...payload.subarray(blockOffset, blockOffset + 4)) !== 'RAHC') {
    throw new Error('Le bloc RAHC du sprite de combat HGSS est absent.')
  }
  const size = view.getUint32(blockOffset + 24, true)
  const offset = blockOffset + 32
  if (size !== encryptedPixelBytes || offset + size > payload.byteLength) {
    throw new Error(`Les pixels du sprite de combat HGSS mesurent ${size} octets au lieu de ${encryptedPixelBytes}.`)
  }
  return { offset, size }
}

/** Port exact de UnscanPokepic_PtHGSS : le flux NCGR est chiffré par mots de 16 bits. */
export function unscanHgssBattlePokemonGraphic(payload: Uint8Array): Uint8Array {
  const decoded = payload.slice()
  const { offset, size } = getPixelDataRange(decoded)
  const view = new DataView(decoded.buffer, decoded.byteOffset + offset, size)
  let seed = view.getUint16(0, true)
  for (let word = 0; word < size / 2; word += 1) {
    view.setUint16(word * 2, view.getUint16(word * 2, true) ^ (seed & 0xffff), true)
    seed = (Math.imul(seed, 1103515245) + 24691) >>> 0
  }
  return decoded
}


export function decodeHgssBattlePokemonSheet(graphicPayload: Uint8Array, palettePayload: Uint8Array): NitroGraphic {
  const { offset, size } = getPixelDataRange(graphicPayload)
  const palette = readNitroPalette(palettePayload, 0)
  if (!palette || palette.length < 16) throw new Error('La palette du sprite de combat HGSS est invalide.')
  const height = size * 2 / sheetWidth
  const pixels = new Uint8ClampedArray(sheetWidth * height * 4)
  for (let pixelIndex = 0; pixelIndex < sheetWidth * height; pixelIndex += 1) {
    const packed = graphicPayload[offset + Math.floor(pixelIndex / 2)]!
    const colorIndex = pixelIndex % 2 === 0 ? packed & 0x0f : packed >> 4
    nitroColorToRgba(palette[colorIndex]!, colorIndex === 0 ? 0 : 255, pixels, pixelIndex * 4)
  }
  return { width: sheetWidth, height, pixels, graphicsOffset: 0, paletteOffset: 0, colorDepth: 4 }
}

export function getStandardBattlePokemonMemberIndexes(request: BattlePokemonSpriteRequest): {
  graphic: number
  palette: number
  height: number
} {
  const { speciesId, facing, shiny } = request
  if (!Number.isInteger(speciesId) || speciesId < 0 || speciesId > maxStandardSpeciesId) {
    throw new Error(`L'espèce ${speciesId} est invalide pour l'archive de combat HGSS standard.`)
  }
  if ((request.form ?? 0) !== 0) {
    throw new Error(`La forme ${request.form} de l'espèce ${speciesId} utilise l'archive HGSS des formes spéciales.`)
  }
  const facingOffset = facing === 'back' ? 0 : 2
  const genderOffset = request.gender === 'female' ? 0 : 1
  return {
    graphic: speciesId * membersPerSpecies + facingOffset + genderOffset,
    palette: speciesId * membersPerSpecies + 4 + (shiny ? 1 : 0),
    height: speciesId * 4 + facingOffset + genderOffset,
  }
}

function normalizeForm(form: number | undefined, count: number): number {
  return Number.isInteger(form) && form! >= 0 && form! < count ? form! : 0
}

/** Port de GetMonSpriteCharAndPlttNarcIdsEx/GetMonPicHeightBySpeciesGenderForm HGSS. */
export function getBattlePokemonMemberIndexes(request: BattlePokemonSpriteRequest): BattlePokemonMemberIndexes {
  const facing = request.facing === 'back' ? 0 : 2
  const shiny = request.shiny ? 1 : 0
  const make = (_form: number, graphic: number, palette: number, height = graphic): BattlePokemonMemberIndexes => ({
    archive: 'forms', graphic, palette, height,
    animationSpeciesId: request.speciesId,
  })
  switch (request.speciesId) {
    case 412: { const form = normalizeForm(request.form, 3); return make(form, facing / 2 + 0x48 + form * 2, shiny + 0xaa + form * 2) }
    case 413: { const form = normalizeForm(request.form, 3); return make(form, facing / 2 + 0x4e + form * 2, shiny + 0xb0 + form * 2) }
    case 422: { const form = normalizeForm(request.form, 2); return make(form, facing + 0x54 + form, shiny + 0xb6 + form * 2) }
    case 423: { const form = normalizeForm(request.form, 2); return make(form, facing + 0x58 + form, shiny + 0xba + form * 2) }
    case 421: { const form = normalizeForm(request.form, 2); return make(form, facing + 0x5c + form, shiny * 2 + 0xbe + form) }
    case 493: { const form = normalizeForm(request.form, 18); return make(form, facing / 2 + 0x60 + form * 2, shiny + 0xc2 + form * 2) }
    case 351: { const form = normalizeForm(request.form, 4); return make(form, facing * 2 + 0x40 + form, shiny * 4 + 0xa2 + form) }
    case 386: { const form = normalizeForm(request.form, 4); return make(form, facing / 2 + form * 2, shiny + 0x9e) }
    case 201: { const form = normalizeForm(request.form, 28); return make(form, facing / 2 + 0x08 + form * 2, shiny + 0xa0) }
    case 492: { const form = normalizeForm(request.form, 2); return make(form, facing / 2 + 0x86 + form * 2, shiny + 0xe8 + form * 2, facing / 2 + 0x88 + form * 2) }
    case 479: { const form = normalizeForm(request.form, 6); return make(form, facing / 2 + 0x8a + form * 2, shiny + 0xec + form * 2, facing / 2 + 0x8c + form * 2) }
    case 487: { const form = normalizeForm(request.form, 2); return make(form, facing / 2 + 0x96 + form * 2, shiny + 0xf8 + form * 2, facing / 2 + 0x98 + form * 2) }
    case 172: { const form = normalizeForm(request.form, 2); return make(form, facing / 2 + 0x9a + form * 2, shiny + 0xfc + form * 2, facing / 2 + 0x9c + form * 2) }
    default: {
      const indexes = getStandardBattlePokemonMemberIndexes(request)
      return { archive: 'standard', ...indexes, animationSpeciesId: request.speciesId }
    }
  }
}

export function decodeHgssBattlePokemonAnimationScript(
  payload: Uint8Array,
  speciesId: number,
  facing: BattlePokemonSpriteFacing,
): BattlePokemonAnimationCommand[] {
  const recordOffset = speciesId * animationRecordSize
  const facingOffset = facing === 'front' ? 0 : animationFacingSize
  const scriptOffset = recordOffset + facingOffset + 3
  if (speciesId < 0 || scriptOffset + animationCommandCount * 4 > payload.byteLength) {
    throw new Error(`Le script d'animation de combat HGSS de l'espèce ${speciesId} est absent.`)
  }
  const view = new DataView(payload.buffer, payload.byteOffset, payload.byteLength)
  return Array.from({ length: animationCommandCount }, (_, index) => {
    const offset = scriptOffset + index * 4
    return {
      next: view.getInt8(offset),
      duration: view.getUint8(offset + 1),
      xOffset: view.getInt8(offset + 2),
    }
  })
}

export function sampleHgssBattlePokemonAnimation(
  script: readonly BattlePokemonAnimationCommand[],
  elapsedVblanks: number,
): BattlePokemonAnimationSample {
  let commandIndex = 0
  let frame = script[0]?.next ?? -1
  let delay = script[0]?.duration ?? 0
  let xOffset = script[0]?.xOffset ?? 0
  let active = frame !== -1
  const loopTimers = new Uint8Array(animationCommandCount)
  for (let tick = 0; tick < Math.max(0, Math.floor(elapsedVblanks)) && active; tick += 1) {
    if (delay > 0) {
      delay -= 1
      continue
    }
    commandIndex += 1
    while (commandIndex < animationCommandCount && (script[commandIndex]?.next ?? -1) < -1) {
      const command = script[commandIndex]!
      loopTimers[commandIndex] += 1
      if (command.duration === 0 || loopTimers[commandIndex] === command.duration) {
        loopTimers[commandIndex] = 0
        commandIndex += 1
      } else {
        commandIndex = -2 - command.next
      }
    }
    const command = script[commandIndex]
    if (!command || command.next === -1) {
      frame = 0
      xOffset = 0
      active = false
    } else {
      frame = command.next
      delay = command.duration
      xOffset = command.xOffset
    }
  }
  return { frameIndex: frame === 1 ? 1 : 0, xOffset, complete: !active }
}

export function splitBattlePokemonAnimationFrames(graphic: NitroGraphic): NitroGraphic[] {
  if (graphic.height !== spriteSize || graphic.width < spriteSize || graphic.width % spriteSize !== 0) {
    throw new Error(`La planche Pokémon HGSS mesure ${graphic.width} × ${graphic.height} au lieu de frames 80 × 80 horizontales.`)
  }
  const framePixelLength = spriteSize * spriteSize * 4
  return Array.from({ length: graphic.width / spriteSize }, (_, frameIndex) => {
    const pixels = new Uint8ClampedArray(framePixelLength)
    for (let y = 0; y < spriteSize; y += 1) {
      const sourceStart = (y * graphic.width + frameIndex * spriteSize) * 4
      pixels.set(graphic.pixels.subarray(sourceStart, sourceStart + spriteSize * 4), y * spriteSize * 4)
    }
    return { ...graphic, width: spriteSize, pixels }
  })
}

export function createBattlePokemonSpriteResolver(
  rom: Uint8Array,
  standardArchive: RomFile,
  formArchive: RomFile,
  animationArchive: RomFile,
  heightArchive: RomFile,
  formHeightArchive: RomFile,
): (request: BattlePokemonSpriteRequest) => BattlePokemonSprite {
  const cache = new Map<string, BattlePokemonSprite>()
  const animationPayload = requireMember(rom, animationArchive, 0)
  return (request) => {
    const key = `${request.speciesId}:${request.gender}:${request.facing}:${request.shiny ? 1 : 0}:${request.form ?? 0}`
    const cached = cache.get(key)
    if (cached) return cached
    const indexes = getBattlePokemonMemberIndexes(request)
    const spriteArchive = indexes.archive === 'forms' ? formArchive : standardArchive
    const spriteHeightArchive = indexes.archive === 'forms' ? formHeightArchive : heightArchive
    const graphicPayload = unscanHgssBattlePokemonGraphic(requireMember(rom, spriteArchive, indexes.graphic))
    const palettePayload = requireMember(rom, spriteArchive, indexes.palette)
    const sheet = decodeHgssBattlePokemonSheet(graphicPayload, palettePayload)
    const frames = splitBattlePokemonAnimationFrames(sheet)
    const heightPayload = requireMember(rom, spriteHeightArchive, indexes.height)
    if (heightPayload.byteLength !== 1) {
      throw new Error(`La hauteur HGSS du sprite de combat ${indexes.height} mesure ${heightPayload.byteLength} octets au lieu de 1.`)
    }
    const result = {
      graphic: frames[0]!,
      frames,
      animationScript: decodeHgssBattlePokemonAnimationScript(animationPayload, indexes.animationSpeciesId, request.facing),
      height: heightPayload[0]!,
      memberIndex: indexes.graphic,
      paletteMemberIndex: indexes.palette,
      animationFrameCount: frames.length,
    }
    cache.set(key, result)
    return result
  }
}
