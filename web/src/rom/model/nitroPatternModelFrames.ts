import type { NitroModelPreview, NitroTexturePreview, RomFile } from '../../ndsTypes'
import { decodeNitroPatternAnimation, resolveNitroPatternKeyframe } from './nitroPatternAnimations'
import {
  decodeNitroTextureByNameFromMember,
  findNitroTextureByNameInArchive,
} from './nitroTextureResources'

/**
 * Résout les remplacements BTP par matériau et produit des modèles immuables.
 * Le cache est local à l'asset : aucune texture d'un ancien MapProp ne peut
 * contaminer le suivant.
 */
export function decodeNitroPatternModelFrames(
  bytes: Uint8Array,
  modelArchive: RomFile | undefined,
  modelId: number,
  animationArchive: RomFile | undefined,
  animationMemberIndex: number,
  staticModel: NitroModelPreview,
  propTextureArchive: RomFile | undefined,
): NitroModelPreview[] | undefined {
  const member = animationArchive?.archiveMembers[animationMemberIndex]
  if (!animationArchive || !member) return undefined
  const animation = decodeNitroPatternAnimation(bytes.subarray(member.offset, member.offset + member.size))
  if (!animation) return undefined
  const modelMaterialNames = new Set((staticModel.surfaces ?? []).flatMap(({ materialName }) => (
    materialName ? [materialName] : []
  )))
  const activeTracks = animation.tracks.filter(({ materialName }) => modelMaterialNames.has(materialName))
  const decodedTextures = new Map<string, NitroTexturePreview>()
  const resolveTexture = (textureIndex: number, paletteIndex: number): NitroTexturePreview | undefined => {
    const textureName = animation.textureNames[textureIndex]
    const paletteName = animation.paletteNames[paletteIndex]
    if (!textureName) return undefined
    const key = `${textureName}\0${paletteName ?? ''}`
    if (!decodedTextures.has(key)) {
      const texture = decodeNitroTextureByNameFromMember(bytes, modelArchive, modelId, textureName, paletteName)
        ?? findNitroTextureByNameInArchive(bytes, modelArchive, textureName, paletteName)
        ?? findNitroTextureByNameInArchive(bytes, propTextureArchive, textureName, paletteName)
      if (!texture) return undefined
      const id = `map-prop-pattern:${animationMemberIndex}:${textureIndex}:${paletteIndex}:${texture.id}`
      decodedTextures.set(key, { ...texture, id })
    }
    return decodedTextures.get(key)
  }
  const frames: NitroModelPreview[] = []
  for (let frameIndex = 0; frameIndex < animation.frameCount; frameIndex += 1) {
    const replacements = new Map<string, NitroTexturePreview>()
    for (const track of activeTracks) {
      const keyframe = resolveNitroPatternKeyframe(track, frameIndex)
      const texture = resolveTexture(keyframe.textureIndex, keyframe.paletteIndex)
      if (!texture) return undefined
      replacements.set(track.materialName, texture)
    }
    const textures = new Map((staticModel.textures ?? []).map((texture) => [texture.id, texture]))
    for (const texture of replacements.values()) textures.set(texture.id, texture)
    const surfaces = staticModel.surfaces?.map((surface) => {
      const texture = surface.materialName ? replacements.get(surface.materialName) : undefined
      return texture
        ? { ...surface, textureId: texture.id, textureName: texture.name, paletteName: texture.paletteName }
        : surface
    })
    frames.push({ ...staticModel, textures: [...textures.values()], surfaces })
  }
  return frames
}
