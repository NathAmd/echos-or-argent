import type { HgssSessionRng } from './game/pokemon/hgssSessionRng'
import { getPlayerAvatarSpriteId, type PlayerLocomotionMode } from './game/player/hgssPlayerMovement'
import type { NitroTexturePreview, PlayerGender, PlayerTextureFrames, RomInventory, RomMetadata } from './ndsTypes'

export type PlayerProfile = {
  gender: PlayerGender
  name: string
  trainerId?: number
  language?: number
  gameVersion?: number
}

export type PlayerSkinTarget = {
  setPlayerTexture: (texture: NitroTexturePreview | undefined) => void
  setPlayerTextureFrames: (frames: PlayerTextureFrames | undefined) => void
  setPlayerLocomotion?: (locomotion: PlayerLocomotionMode) => void
}

export function createDefaultPlayerProfile(): PlayerProfile {
  return { gender: 'male', name: '' }
}

const languageByGameCodeRegion: Readonly<Record<string, number>> = {
  J: 1,
  E: 2,
  F: 3,
  I: 4,
  D: 5,
  S: 7,
  K: 8,
}

export function createPlayerProfileForRom(metadata: RomMetadata): PlayerProfile {
  const versionCode = metadata.gameCode.slice(0, 3)
  const gameVersion = versionCode === 'IPK' ? 7 : versionCode === 'IPG' ? 8 : undefined
  const language = languageByGameCodeRegion[metadata.gameCode[3] ?? '']
  if (gameVersion === undefined || language === undefined) {
    throw new Error(`Le profil joueur ne prend pas en charge le code ROM ${metadata.gameCode}.`)
  }
  return { ...createDefaultPlayerProfile(), language, gameVersion }
}

export type HgssPostOakInitialization = {
  friendGroupSeed: number
  pokewalkerSeeds: number[]
  mailMarillPersonality: number
}

export function initializeHgssNewGamePlayerProfile(profile: PlayerProfile, sessionRng: HgssSessionRng): HgssPostOakInitialization {
  const friendGroupSeed = sessionRng.mt.nextU32()
  profile.trainerId = sessionRng.mt.nextU32()
  const pokewalkerSeeds = Array.from({ length: 10 }, () => sessionRng.mt.nextU32())
  const mailMarillPersonality = (sessionRng.lc.nextU16() | (sessionRng.lc.nextU16() << 16)) >>> 0
  return { friendGroupSeed, pokewalkerSeeds, mailMarillPersonality }
}

export function applyPlayerProfileSkin(
  runtime: PlayerSkinTarget,
  inventory: RomInventory,
  profile: PlayerProfile,
  locomotion: PlayerLocomotionMode = 'walking',
  playerState = 0,
): string {
  const rocketCostume = playerState === 3 || playerState === 12 || playerState === 14
  const avatarResource = rocketCostume
    ? inventory.eventTextureResolver?.(profile.gender === 'male' ? 222 : 221)
    : locomotion === 'walking'
      ? undefined
      : inventory.eventTextureResolver?.(getPlayerAvatarSpriteId(profile.gender, locomotion))
  const frames = avatarResource?.frames ?? inventory.playerTextureFramesByGender?.[profile.gender]
  const texture = avatarResource?.preview ?? inventory.playerTexturePreviewsByGender?.[profile.gender]
  const source = texture ?? frames?.standing.south
  const actorLabel = profile.gender === 'female' ? 'joueuse ROM' : 'joueur ROM'

  if (!frames || !source) throw new Error(`Les textures animees ${actorLabel} sont absentes de la ROM.`)
  if (!source.sourcePath || source.sourceMemberIndex === undefined) {
    throw new Error(`La provenance des textures ${actorLabel} n’est pas identifiee dans la ROM.`)
  }

  runtime.setPlayerLocomotion?.(locomotion)
  runtime.setPlayerTextureFrames(frames)

  return `${actorLabel} ${rocketCostume ? 'rocket' : locomotion} ${source.sourcePath}#${source.sourceMemberIndex}/${source.name} anime`
}
