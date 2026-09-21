/** Les cinq valeurs de TIMEOFDAY utilisées par Pokémon HeartGold/SoulSilver. */
export type HgssTimeOfDay = 0 | 1 | 2 | 3 | 4

/** Index des trois tables de rencontres sauvages : matin, jour, nuit. */
export type HgssWildTimeOfDay = 0 | 1 | 2

/** Index des trois palettes de décor de combat : jour, crépuscule, nuit. */
export type HgssBattlePaletteTime = 0 | 1 | 2

/** Les quatre états visuels du terrain; nuit et nuit profonde partagent l'état 3. */
export type HgssFieldVisualTime = 0 | 1 | 2 | 3

export type HgssWeekday = 0 | 1 | 2 | 3 | 4 | 5 | 6

const timeOfDayByHour: readonly HgssTimeOfDay[] = [
  4, 4, 4, 4,
  0, 0, 0, 0, 0, 0,
  1, 1, 1, 1, 1, 1, 1,
  2, 2, 2,
  3, 3, 3, 3,
]

export function resolveHgssTimeOfDayByHour(hour: number): HgssTimeOfDay {
  if (!Number.isInteger(hour) || hour < 0 || hour >= 24) {
    throw new Error(`L’heure RTC HGSS ${hour} est invalide.`)
  }
  return timeOfDayByHour[hour]!
}

export function resolveHgssTimeOfDay(now: Date): HgssTimeOfDay {
  return resolveHgssTimeOfDayByHour(now.getHours())
}

export function refreshHgssTimeOfDayState(state: { timeOfDay: HgssTimeOfDay, pokemonRuntime?: { now: () => Date } }): HgssTimeOfDay {
  state.timeOfDay = resolveHgssTimeOfDay(state.pokemonRuntime?.now() ?? new Date())
  return state.timeOfDay
}

export function resolveHgssWildTimeOfDay(timeOfDay: HgssTimeOfDay): HgssWildTimeOfDay {
  if (timeOfDay === 0) return 0
  if (timeOfDay === 1 || timeOfDay === 2) return 1
  return 2
}

export function resolveHgssFieldVisualTime(timeOfDay: HgssTimeOfDay): HgssFieldVisualTime {
  return timeOfDay === 4 ? 3 : timeOfDay
}

export function resolveHgssBattlePaletteTime(timeOfDay: HgssTimeOfDay): HgssBattlePaletteTime {
  if (timeOfDay === 2) return 1
  return timeOfDay === 3 || timeOfDay === 4 ? 2 : 0
}

export function isHgssNighttime(timeOfDay: HgssTimeOfDay): boolean {
  return timeOfDay === 3 || timeOfDay === 4
}

/** RTCWeek est dominical dans la ROM, comme Date#getDay(). */
export function resolveHgssWeekday(now: Date): HgssWeekday {
  return now.getDay() as HgssWeekday
}
