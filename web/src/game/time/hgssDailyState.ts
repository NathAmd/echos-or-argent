export type HgssDailyApricornState = {
  apricornTreeDay: string
  harvestedApricornTrees: Set<number>
  pokemonRuntime?: { now: () => Date }
}

export function formatHgssFieldDay(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

export function refreshHgssApricornTreesForCurrentDay(state: HgssDailyApricornState): void {
  const day = formatHgssFieldDay(state.pokemonRuntime?.now() ?? new Date())
  if (state.apricornTreeDay === day) return
  state.apricornTreeDay = day
  state.harvestedApricornTrees.clear()
}
