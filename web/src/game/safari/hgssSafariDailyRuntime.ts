import { formatHgssFieldDay } from '../time/hgssDailyState'
import {
  advanceHgssSafariAreaDays,
  type HgssSafariEncounterSignatureResolver,
  type HgssSafariProgressionState,
} from './hgssSafariProgression'
import type { HgssSafariAreaId, HgssSafariState } from './hgssSafariState'

export const HGSS_SAFARI_NEW_POKEMON_CALL_TRIGGER = 6 as const

export type HgssSafariDailySlice = {
  safariZone: HgssSafariState
  safariProgression: HgssSafariProgressionState
  phoneCallTriggers: Set<number>
}

function dayOrdinal(value: string): number | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (!match) return undefined
  const year = Number.parseInt(match[1]!, 10)
  const month = Number.parseInt(match[2]!, 10)
  const day = Number.parseInt(match[3]!, 10)
  const time = Date.UTC(year, month - 1, day)
  const date = new Date(time)
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return undefined
  return Math.floor(time / 86_400_000)
}

export function publishHgssSafariEncounterChanges(
  state: Pick<HgssSafariDailySlice, 'safariProgression' | 'phoneCallTriggers'>,
  changedAreaIds: readonly HgssSafariAreaId[],
): void {
  const uniqueAreaIds = [...new Set(changedAreaIds)]
  state.safariProgression = {
    ...state.safariProgression,
    pendingEncounterAreaIds: uniqueAreaIds,
  }
  if (uniqueAreaIds.length > 0) state.phoneCallTriggers.add(HGSS_SAFARI_NEW_POKEMON_CALL_TRIGGER)
  else state.phoneCallTriggers.delete(HGSS_SAFARI_NEW_POKEMON_CALL_TRIGGER)
}

/**
 * Browser host for `SaveData_SafariZone_CheckAreasWithUpdatedEncounters`.
 * It advances by civil days and keeps the native u8 deferral while a session is active.
 */
export function refreshHgssSafariForCurrentDay(
  state: HgssSafariDailySlice,
  now: Date,
  resolveEncounterSignature: HgssSafariEncounterSignatureResolver,
  rtcPenalty = false,
): void {
  const currentDay = formatHgssFieldDay(now)
  const currentOrdinal = dayOrdinal(currentDay)!
  const previousOrdinal = state.safariProgression.lastAreaUpdateDay
    ? dayOrdinal(state.safariProgression.lastAreaUpdateDay)
    : undefined
  state.safariProgression = { ...state.safariProgression, lastAreaUpdateDay: currentDay }
  if (previousOrdinal === undefined || currentOrdinal <= previousOrdinal) return
  // `sub_02055508` avance tout de même le repère civil global, mais n'appelle
  // jamais le vieillissement Safari tant que la pénalité RTC est active.
  if (rtcPenalty) return

  const sessionWasActive = state.safariZone.session.active
  const objectUnlockLevel = state.safariZone.objectUnlockLevel
  const result = advanceHgssSafariAreaDays(
    state.safariZone,
    currentOrdinal - previousOrdinal,
    resolveEncounterSignature,
  )
  state.safariZone = result.state
  // The retail function returns before touching the persistent call when aging is deferred or unavailable.
  if (sessionWasActive || objectUnlockLevel === 0) return
  publishHgssSafariEncounterChanges(state, result.changedAreaIds)
}
