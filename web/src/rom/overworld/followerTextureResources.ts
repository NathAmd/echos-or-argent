import { readUint16, readUint32 } from '../../core/binaryReader'
import type { NarcMember, NitroTexturePreview, PlayerDirection, RomFile, RomInventory } from '../../ndsTypes'
import { decompressLz10 } from '../lz10'
import {
  decodeNitroTextureByNameFromMember,
  decodeNitroTextureMemberSet,
  getNitroTextureResourceNamesFromMember,
} from '../model/nitroTextureResources'
import {
  decodeHgssFollowerEmoteTimeline,
  hgssFollowerEmoteCount,
  hgssFollowerEmoteSoundId,
  hgssFollowerEmoteTextureBase,
  hgssFollowerEmoteTimelineBase,
} from './followerEmotes'
import { hgssFollowerModelBase } from './followerParameters'

export const followerAnimationDirections: readonly PlayerDirection[] = ['north', 'south', 'west', 'east']
export const followerAnimationFrameCount = 20
export const followerAnimationDataMemberIndex = 292

function readArchiveMemberPayload(bytes: Uint8Array, member: NarcMember): Uint8Array {
  const payload = bytes.slice(member.offset, member.offset + member.size)
  return decompressLz10(payload) ?? payload
}

export function selectFollowerPaletteName(paletteNames: readonly string[], shiny: boolean): string | undefined {
  return paletteNames[shiny ? 1 : 0] ?? paletteNames[0]
}

export function getFollowerAnimationTextureNamesFromMember(
  bytes: Uint8Array,
  archive: RomFile,
  textureNames: readonly string[],
): Record<PlayerDirection, string[]> {
  const member = archive.archiveMembers[followerAnimationDataMemberIndex]
  if (!member || member.size < 8) {
    throw new Error(`La table d'animation follower HGSS ${followerAnimationDataMemberIndex} est absente ou invalide.`)
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset + member.offset, member.size)
  const entryCount = readUint32(view, 0)
  const thresholdsOffset = 4
  const textureIndexesOffset = thresholdsOffset + entryCount * 2
  const paletteIndexesOffset = textureIndexesOffset + entryCount
  if (entryCount === 0 || paletteIndexesOffset + entryCount > member.size) {
    throw new Error(`La table d'animation follower HGSS ${followerAnimationDataMemberIndex} est tronquee.`)
  }
  const thresholds = Array.from({ length: entryCount }, (_, index) => readUint16(view, thresholdsOffset + index * 2))
  if (!thresholds.slice(1).every((threshold, index) => threshold > thresholds[index]!)) {
    throw new Error(`Les seuils d'animation follower HGSS ${followerAnimationDataMemberIndex} ne sont pas strictement croissants.`)
  }
  const requiredFrameCount = followerAnimationDirections.length * followerAnimationFrameCount
  const frameTextureNames = Array.from({ length: requiredFrameCount }, (_, frame) => {
    let entryIndex = 0
    while (entryIndex < entryCount - 1 && thresholds[entryIndex + 1]! <= frame) entryIndex += 1
    const textureIndex = view.getUint8(textureIndexesOffset + entryIndex)
    const paletteIndex = view.getUint8(paletteIndexesOffset + entryIndex)
    const textureName = textureNames[textureIndex]
    if (!textureName) throw new Error(`L'image follower HGSS ${frame} reference la texture absente ${textureIndex}.`)
    if (paletteIndex !== 0) throw new Error(`L'image follower HGSS ${frame} reference la palette inattendue ${paletteIndex}.`)
    return textureName
  })

  return Object.fromEntries(followerAnimationDirections.map((direction, directionIndex) => [
    direction,
    frameTextureNames.slice(
      directionIndex * followerAnimationFrameCount,
      (directionIndex + 1) * followerAnimationFrameCount,
    ),
  ])) as Record<PlayerDirection, string[]>
}

export function createFollowerTextureResolver(
  bytes: Uint8Array,
  archive: RomFile,
  parameterCount: number,
): RomInventory['followerTextureResolver'] {
  const cache = new Map<string, NonNullable<ReturnType<NonNullable<RomInventory['followerTextureResolver']>>>>()
  return (parameterIndex, shiny = false) => {
    if (!Number.isInteger(parameterIndex) || parameterIndex < 0 || parameterIndex >= parameterCount) {
      throw new Error(`L'index graphique follower HGSS ${parameterIndex} est invalide.`)
    }
    const cacheKey = `${parameterIndex}:${shiny ? 1 : 0}`
    const cached = cache.get(cacheKey)
    if (cached) return cached
    const memberIndex = hgssFollowerModelBase + parameterIndex
    const { textureNames, paletteNames } = getNitroTextureResourceNamesFromMember(bytes, archive, memberIndex)
    const paletteName = selectFollowerPaletteName(paletteNames, shiny)
    const textures = textureNames
      .map((name) => decodeNitroTextureByNameFromMember(bytes, archive, memberIndex, name, paletteName))
      .filter((texture): texture is NitroTexturePreview => Boolean(texture))
    if (textures.length !== textureNames.length || textures.length === 0) {
      throw new Error(`Le jeu de textures follower HGSS ${parameterIndex} est incomplet dans le membre mmodel ${memberIndex}.`)
    }
    const texturesByName = new Map(textures.map((texture) => [texture.name, texture]))
    const animationNames = getFollowerAnimationTextureNamesFromMember(bytes, archive, textureNames)
    const animationFrames = Object.fromEntries(Object.entries(animationNames).map(([direction, names]) => [
      direction,
      names.map((name) => {
        const texture = texturesByName.get(name)
        if (!texture) {
          throw new Error(`La texture d'animation follower HGSS ${name} est absente du membre mmodel ${memberIndex}.`)
        }
        return texture
      }),
    ])) as Record<PlayerDirection, NitroTexturePreview[]>
    const preview = textures[0]
    if (!preview) {
      throw new Error(`La texture follower HGSS ${parameterIndex} est absente du membre mmodel ${memberIndex}.`)
    }
    const resolved = { preview, textures, animationFrames }
    cache.set(cacheKey, resolved)
    return resolved
  }
}

export function createFollowerEmoteResolver(
  bytes: Uint8Array,
  archive: RomFile,
): NonNullable<RomInventory['followerEmoteResolver']> {
  const cache = new Map<number, ReturnType<NonNullable<RomInventory['followerEmoteResolver']>>>()
  return (emoteId) => {
    if (!Number.isInteger(emoteId) || emoteId < 1 || emoteId > hgssFollowerEmoteCount) {
      throw new Error(`L’identifiant d’emote follower HGSS ${emoteId} est invalide.`)
    }
    const cached = cache.get(emoteId)
    if (cached) return cached
    const textureMemberIndex = hgssFollowerEmoteTextureBase + emoteId - 1
    const timelineMemberIndex = hgssFollowerEmoteTimelineBase + emoteId - 1
    const textures = decodeNitroTextureMemberSet(bytes, archive, textureMemberIndex)
    const timelineMember = archive.archiveMembers[timelineMemberIndex]
    if (textures.length === 0 || !timelineMember) {
      throw new Error(`Les ressources de l’emote follower HGSS ${emoteId} sont absentes de ${archive.path}.`)
    }
    const timeline = decodeHgssFollowerEmoteTimeline(readArchiveMemberPayload(bytes, timelineMember), emoteId)
    if (timeline.textureIndexes.some((textureIndex) => textureIndex >= textures.length)) {
      throw new Error(`L’emote follower HGSS ${emoteId} référence une texture absente.`)
    }
    if (timeline.paletteIndexes.some((paletteIndex) => paletteIndex !== 0)) {
      throw new Error(`L’emote follower HGSS ${emoteId} référence une palette secondaire non décodée.`)
    }
    const resolved: ReturnType<NonNullable<RomInventory['followerEmoteResolver']>> = {
      emoteId,
      textures,
      timeline,
      soundId: hgssFollowerEmoteSoundId,
    }
    cache.set(emoteId, resolved)
    return resolved
  }
}
