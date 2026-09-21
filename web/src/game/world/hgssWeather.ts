export type HgssWeather = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12 | 13

export const hgssWeather = {
  clear: 0,
  rain: 1,
  heavyRain: 2,
  thunderstorm: 3,
  storm: 4,
  snow: 5,
  blizzard: 6,
  sandstorm: 7,
  diamondDust: 8,
  mist: 9,
  denseMist: 10,
  darkness: 11,
  deepDarkness: 12,
  lowLight: 13,
} as const satisfies Readonly<Record<string, HgssWeather>>

export const hgssMountSilverSummitMapId = 465

/** MAP_TYPE_CITY_TOWN et MAP_TYPE_ROUTE sont les deux types exterieurs HGSS. */
export function isHgssExteriorMapType(mapType: number): boolean {
  return mapType === 1 || mapType === 2
}

const diamondDustDates = new Set([
  '1-1', '1-31', '2-1', '2-29', '3-15', '10-10', '12-3', '12-31',
])

export function isHgssDiamondDustDate(now: Date): boolean {
  return diamondDustDates.has(`${now.getMonth() + 1}-${now.getDate()}`)
}

export function resolveHgssMapWeather(
  mapId: number,
  headerWeather: number,
  now: Date,
  rtcPenalty = false,
): HgssWeather {
  if (!Number.isInteger(headerWeather) || headerWeather < 0 || headerWeather > 13) {
    throw new Error(`La météo HGSS ${headerWeather} de la carte ${mapId} est invalide.`)
  }
  if (mapId === hgssMountSilverSummitMapId && !rtcPenalty && isHgssDiamondDustDate(now)) {
    return hgssWeather.diamondDust
  }
  return headerWeather as HgssWeather
}

export function restoreHgssSavedMapWeather(
  weather: HgssWeather,
  mapId: number,
  headerWeather: number,
  now: Date,
  rtcPenalty = false,
): HgssWeather {
  return weather === hgssWeather.clear && headerWeather !== hgssWeather.clear
    ? resolveHgssMapWeather(mapId, headerWeather, now, rtcPenalty)
    : weather
}

export function resolveHgssBattleWeather(weather: HgssWeather): 'clear' | 'rain' | 'sandstorm' | 'hail' {
  if (weather >= hgssWeather.rain && weather <= hgssWeather.storm) return 'rain'
  if (weather === hgssWeather.sandstorm) return 'sandstorm'
  if (weather === hgssWeather.snow || weather === hgssWeather.blizzard || weather === hgssWeather.diamondDust) return 'hail'
  return 'clear'
}
