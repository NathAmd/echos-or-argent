import type {
  NitroTexturePreview,
  OpeningMapPreview,
  PlayerDirection,
  PlayerTextureFrames,
  RomFile,
  RomInventory,
} from '../../ndsTypes'
import {
  decodeNitroTextureByNameFromMember,
  decodeNitroTextureMember,
} from '../model/nitroTextureResources'
import { hgssFollowerModelBase } from './followerParameters'
import { decodeObjectGraphicsFromRom } from './objectGraphics'

export const overworldTextureDirections: readonly PlayerDirection[] = ['north', 'south', 'west', 'east']

/**
 * Répartit les cellules NSBTX d'un acteur selon l'ordre cardinal natif HGSS.
 * Les sprites compacts (Surf) gardent une cellule par direction, tandis que
 * les jeux complets exposent quatre cellules de marche et, à 32 cellules, de course.
 */
export function groupPlayerTextureFrames(sequentialFrames: readonly NitroTexturePreview[]): PlayerTextureFrames | undefined {
  if (sequentialFrames.length < overworldTextureDirections.length) return undefined
  const directionalFrames = sequentialFrames.length >= 16 ? sequentialFrames.slice(0, 16) : sequentialFrames
  if (directionalFrames.length % overworldTextureDirections.length !== 0) return undefined
  const framesPerDirection = directionalFrames.length / overworldTextureDirections.length
  const walking = {} as Record<PlayerDirection, NitroTexturePreview[]>
  const running = sequentialFrames.length >= 32 ? {} as Record<PlayerDirection, NitroTexturePreview[]> : undefined
  const standing = {} as Record<PlayerDirection, NitroTexturePreview>

  for (const [directionIndex, direction] of overworldTextureDirections.entries()) {
    const frames = directionalFrames.slice(
      directionIndex * framesPerDirection,
      (directionIndex + 1) * framesPerDirection,
    )
    walking[direction] = frames
    standing[direction] = frames[0]!
    if (running) {
      running[direction] = sequentialFrames.slice(
        16 + directionIndex * 4,
        16 + (directionIndex + 1) * 4,
      )
    }
  }

  return { standing, walking, running }
}

export function decodePlayerTextureFrames(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  memberIndex: number,
  texturePrefix = 'hero',
): PlayerTextureFrames | undefined {
  const sequentialFrames: NitroTexturePreview[] = []
  for (let index = 1; index <= 32; index += 1) {
    const texture = decodeNitroTextureByNameFromMember(
      bytes,
      archive,
      memberIndex,
      `${texturePrefix}.${index}`,
      texturePrefix,
    )
    if (!texture) break
    sequentialFrames.push(texture)
  }
  return groupPlayerTextureFrames(sequentialFrames)
}

/**
 * Les object events de Pokemon statiques utilisent les memes membres mmodel
 * que le follower. Ces membres ont deux palettes et une table d'animation
 * commune : le decodeur generique d'acteur ne peut donc pas choisir seul la
 * palette et renvoie volontairement `undefined`.
 */
export function resolveFollowerEventTextureResource(
  mapModelId: number,
  followerTextureResolver: RomInventory['followerTextureResolver'] | undefined,
): { preview: NitroTexturePreview, frames: PlayerTextureFrames } | undefined {
  const parameterIndex = mapModelId - hgssFollowerModelBase
  if (!followerTextureResolver || !Number.isInteger(parameterIndex) || parameterIndex < 0) return undefined
  const resource = followerTextureResolver(parameterIndex)
  const standing = {} as Record<PlayerDirection, NitroTexturePreview>
  const walking = {} as Record<PlayerDirection, NitroTexturePreview[]>
  for (const direction of overworldTextureDirections) {
    const frames = resource.animationFrames[direction]
    const first = frames[0]
    if (!first) return undefined
    standing[direction] = first
    walking[direction] = frames
  }
  return { preview: resource.preview, frames: { standing, walking } }
}

export type EventTextureResources = {
  eventTexturePreviews?: Record<number, NitroTexturePreview>
  eventTextureFrames?: Record<number, PlayerTextureFrames>
  eventTextureResolver?: RomInventory['eventTextureResolver']
}

export function decodeEventTextureResources(
  bytes: Uint8Array,
  archive: RomFile | undefined,
  maps: readonly OpeningMapPreview[],
  followerTextureResolver?: RomInventory['followerTextureResolver'],
): EventTextureResources {
  if (!archive) return {}
  const requiredSpriteIds = new Set(maps.flatMap((map) => map.events?.objects.map((object) => object.spriteId) ?? []))
  if (requiredSpriteIds.size === 0) return {}
  const modelIdsBySprite = new Map(decodeObjectGraphicsFromRom(bytes).map((entry) => [entry.spriteId, entry.mapModelId]))
  const previews: Record<number, NitroTexturePreview> = {}
  const framesBySprite: Record<number, PlayerTextureFrames> = {}
  const attemptedSpriteIds = new Set<number>()
  const resolve = (spriteId: number): { preview?: NitroTexturePreview, frames?: PlayerTextureFrames } => {
    if (attemptedSpriteIds.has(spriteId)) {
      return { preview: previews[spriteId], frames: framesBySprite[spriteId] }
    }
    attemptedSpriteIds.add(spriteId)
    const mapModelId = modelIdsBySprite.get(spriteId)
    if (mapModelId === undefined || !archive.archiveMembers[mapModelId]) return {}
    const genericPreview = decodeNitroTextureMember(bytes, archive, mapModelId, '')
    const followerResource = genericPreview
      ? undefined
      : resolveFollowerEventTextureResource(mapModelId, followerTextureResolver)
    const preview = genericPreview ?? followerResource?.preview
    if (!preview) return {}
    previews[spriteId] = preview
    const frames = followerResource?.frames ?? decodePlayerTextureFrames(
      bytes,
      archive,
      mapModelId,
      preview.name.replace(/\.\d+$/, ''),
    )
    if (frames) framesBySprite[spriteId] = frames
    return { preview, frames }
  }
  for (const spriteId of requiredSpriteIds) resolve(spriteId)
  return {
    eventTexturePreviews: Object.keys(previews).length > 0 ? previews : undefined,
    eventTextureFrames: Object.keys(framesBySprite).length > 0 ? framesBySprite : undefined,
    eventTextureResolver: resolve,
  }
}
