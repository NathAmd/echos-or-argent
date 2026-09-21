import { getMetatileBehavior, isSurfableMetatile, type PlayerLocomotionMode } from '../player/hgssPlayerMovement'

export const hgssOceanBattleBackgroundId = 1 as const
export const hgssMaximumBattleBackgroundId = 22 as const
export const hgssMaximumBattleTerrainId = 24 as const

const terrainByBattleBackground = [
  0, 7, 9, 2, 4, 6, 9, 9, 9, 5, 5, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
] as const

export type HgssFieldBattleEnvironmentInput = {
  terrainAttribute: number | undefined
  mapBattleBackgroundId: number
  locomotion: PlayerLocomotionMode
}

export type HgssFieldBattleEnvironment = {
  backgroundId: number
  terrainId: number
}

function requireBattleBackgroundId(value: number): number {
  if (!Number.isInteger(value) || value < 0 || value > hgssMaximumBattleBackgroundId) {
    throw new Error(`Le décor de combat HGSS ${value} est invalide.`)
  }
  return value
}

/** Port de `sub_02052504`: Surf remplace le décor du header par l'océan. */
export function resolveHgssFieldBattleBackgroundId(
  mapBattleBackgroundId: number,
  locomotion: PlayerLocomotionMode,
): number {
  return locomotion === 'surfing' ? hgssOceanBattleBackgroundId : requireBattleBackgroundId(mapBattleBackgroundId)
}

/** Port de `FieldSystem_GetTerrainFromStandingTile` dans son ordre ROM exact. */
export function resolveHgssFieldBattleTerrainId(
  terrainAttribute: number | undefined,
  battleBackgroundId: number,
): number {
  const behavior = getMetatileBehavior(terrainAttribute)
  if (behavior === 32) return 8
  if (behavior === 2 || behavior === 3) return 2
  if (behavior === 33) return 1
  if (behavior === 168) return 6
  if (behavior === 164) return 10
  if (behavior === 8) return 5
  if (isSurfableMetatile(terrainAttribute)) return 7
  return terrainByBattleBackground[requireBattleBackgroundId(battleBackgroundId)]
}

export function resolveHgssFieldBattleEnvironment(
  input: HgssFieldBattleEnvironmentInput,
): HgssFieldBattleEnvironment {
  const backgroundId = resolveHgssFieldBattleBackgroundId(input.mapBattleBackgroundId, input.locomotion)
  return {
    backgroundId,
    terrainId: resolveHgssFieldBattleTerrainId(input.terrainAttribute, backgroundId),
  }
}
