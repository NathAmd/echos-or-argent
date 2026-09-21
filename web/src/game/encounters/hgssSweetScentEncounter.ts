import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { HGSS_PAL_PARK_SYSTEM_FLAG } from '../scripts/hgssFieldSystemFlags'
import type { HgssLandOrSurfEncounterGenerationContext, PreparedSafariWildEncounter, PreparedFieldWildEncounter } from './wildEncounterSelection'
import { classifyWildEncounterTerrain, prepareHgssLandOrSurfWildEncounter } from './wildEncounterSelection'

export const HGSS_HONEY_ITEM_ID = 94 as const
export const HGSS_SWEET_SCENT_MOVE_ID = 230 as const
export const HGSS_SWEET_SCENT_FAILURE_SCRIPT_ID = 2018 as const
export const HGSS_SWEET_SCENT_WEATHER_FAILURE_SCRIPT_ID = 2019 as const
export { HGSS_PAL_PARK_SYSTEM_FLAG }

const sweetScentBlockedFieldMoveMapIds = new Set([2, 4, 5])

const blockedWeatherIds = new Set([1, 5, 9])
const alphEncounterGateMapIds = new Set([315, 490, 491, 492])
const alphPuzzleFlags = [0x977, 0x978, 0x979, 0x97a] as const

export type HgssSweetScentEncounterCheck =
  | { kind: 'weather-blocked' }
  | { kind: 'unavailable' }
  | { kind: 'ready', method: 'land' | 'surf', encounterRate: number }

export type HgssSweetScentEncounterContext = {
  mapId: number
  weatherId: number
  terrainAttribute: number | undefined
  encounters?: HgssWildEncounterData
  eventFlags: ReadonlySet<number>
}

/** Garde du menu de capacité; le Miel contourne volontairement cette garde native. */
export function canSelectHgssSweetScentFieldMove(mapId: number, eventFlags: ReadonlySet<number>): boolean {
  return !sweetScentBlockedFieldMoveMapIds.has(mapId) && !eventFlags.has(HGSS_PAL_PARK_SYSTEM_FLAG)
}

/** Port partagé de la garde de `Task_HoneyOrSweetScent`, sans texte de repli. */
export function checkHgssSweetScentEncounter(
  context: HgssSweetScentEncounterContext,
): HgssSweetScentEncounterCheck {
  if (blockedWeatherIds.has(context.weatherId)) return { kind: 'weather-blocked' }
  const encounters = context.encounters
  if (!encounters) return { kind: 'unavailable' }
  const terrain = classifyWildEncounterTerrain(context.terrainAttribute)
  const method = terrain === 'land' ? 'land' : terrain === 'surfing' ? 'surf' : undefined
  if (!method) return { kind: 'unavailable' }
  const encounterRate = method === 'land' ? encounters.rates.walking : encounters.rates.surfing
  if (encounterRate === 0) return { kind: 'unavailable' }
  if (alphEncounterGateMapIds.has(context.mapId)
    && !alphPuzzleFlags.some((flag) => context.eventFlags.has(flag))) return { kind: 'unavailable' }
  return { kind: 'ready', method, encounterRate }
}

export function prepareHgssSweetScentEncounter(
  check: Extract<HgssSweetScentEncounterCheck, { kind: 'ready' }>,
  encounters: HgssWildEncounterData,
  hour: number,
  rng: HgssLcrng,
  prepareContextEncounter?: (method: 'land' | 'surf') => PreparedSafariWildEncounter | undefined,
  generationContext?: Omit<HgssLandOrSurfEncounterGenerationContext, 'isSweetScent'>,
): PreparedFieldWildEncounter | undefined {
  const encounter = prepareContextEncounter?.(check.method)
    ?? (prepareContextEncounter
      ? undefined
      : prepareHgssLandOrSurfWildEncounter(encounters, check.method, hour, rng, {
        mapId: generationContext?.mapId ?? -1,
        ...generationContext,
        isSweetScent: true,
      }))
  return encounter && {
    encounter,
    // La routine forcée ne fait aucun jet de taux; ce relevé marque seulement
    // que la garde native a accepté le taux non nul de la table.
    rateRoll: { triggered: true, modifiedRate: check.encounterRate, firstRoll: 0 },
  }
}
