import type { MapMatrixPreview, OpeningMapPreview, PlayerGender, RomInventory } from '../../ndsTypes'
import type { HgssSafariState } from '../safari/hgssSafariState'
import { resolveHgssWeekday, type HgssWeekday } from '../time/hgssRtc'

export const hgssLakeOfRageMapId = 88
export const hgssRoute43MapId = 45
export const hgssRocketHideoutClearedFlag = 0xca

export function shouldUseHgssWednesdayLakeVariant(
  mapId: number,
  weekday: HgssWeekday,
  rocketHideoutCleared: boolean,
): boolean {
  return rocketHideoutCleared && weekday === 3 && (mapId === hgssLakeOfRageMapId || mapId === hgssRoute43MapId)
}

export function createHgssWednesdayLakeMatrix(matrix: MapMatrixPreview): MapMatrixPreview {
  const modelIds = new Uint16Array(matrix.modelIds)
  const replacements = [95, 96, 97, 98, 99, 100] as const
  const indexes = [
    matrix.width + 15, matrix.width + 16, matrix.width + 17,
    matrix.width * 2 + 15, matrix.width * 2 + 16, matrix.width * 2 + 17,
  ]
  indexes.forEach((index, replacementIndex) => {
    if (index < modelIds.length) modelIds[index] = replacements[replacementIndex]!
  })
  return { ...matrix, modelIds }
}

export function resolveCurrentHgssMapVariant(
  resolver: RomInventory['mapVariantResolver'], map: OpeningMapPreview, now: Date, flags: ReadonlySet<number>,
  safariZone?: HgssSafariState, playerGender?: PlayerGender,
): OpeningMapPreview {
  return resolver?.(map, {
    weekday: resolveHgssWeekday(now),
    rocketHideoutCleared: flags.has(hgssRocketHideoutClearedFlag),
    safariZone,
    playerGender,
  }) ?? map
}
