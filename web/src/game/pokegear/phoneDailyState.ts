import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { formatHgssFieldDay } from '../time/hgssDailyState'

export type HgssKenjiPhoneDailyState = {
  kenjiActive: boolean
  kenjiWaitDays: number
  kenjiDay: string
  phoneRematchSeeking: Set<number>
  phoneGiftItems: Map<number, number>
}

function dayNumber(value: string): number | undefined {
  const match = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(value)
  if (!match) return undefined
  return Math.floor(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) / 86_400_000)
}

/** Reproduit `sub_0202F294` lorsque le RTC avance d'au moins un jour. */
export function refreshKenjiPhoneDay(state: HgssKenjiPhoneDailyState, now: Date, rng: HgssLcrng): void {
  const currentDay = formatHgssFieldDay(now)
  if (state.kenjiDay === currentDay) return
  const previous = dayNumber(state.kenjiDay)
  const current = dayNumber(currentDay)!
  const elapsed = previous === undefined ? 0 : Math.max(0, current - previous)
  state.kenjiDay = currentDay
  if (elapsed === 0) return
  state.kenjiActive = false
  state.phoneGiftItems.delete(16)
  state.phoneRematchSeeking.delete(16)
  if (state.kenjiWaitDays >= elapsed) state.kenjiWaitDays -= elapsed
  else state.kenjiWaitDays = rng.nextU16() % 6 + 1
}
