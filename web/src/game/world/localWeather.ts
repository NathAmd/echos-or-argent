import { hgssWeather, isHgssExteriorMapType, type HgssWeather } from './hgssWeather'

export type LocalWeatherObservation = {
  weatherCode: number
  precipitation: number
  rain: number
  showers: number
  snowfall: number
  cloudCover: number
  windSpeed: number
  windGusts: number
}

export type LocalWeatherSnapshot = {
  weather: HgssWeather
  label: string
  observedAt: number
}

type LocalWeatherPosition = { coords: { latitude: number, longitude: number } }
type LocalWeatherPositionError = { code: number }
type LocalWeatherGeolocation = {
  getCurrentPosition: (
    success: (position: LocalWeatherPosition) => void,
    error: (reason: LocalWeatherPositionError) => void,
    options: PositionOptions,
  ) => void
}
type LocalWeatherResponse = { ok: boolean, status: number, json: () => Promise<unknown> }
type LocalWeatherFetch = (input: string, init?: RequestInit) => Promise<LocalWeatherResponse>

export type LocalWeatherService = {
  enable: () => Promise<LocalWeatherSnapshot>
  resume: () => void
  disable: () => void
  refreshIfDue: () => void
  getSnapshot: () => LocalWeatherSnapshot | undefined
  getLastError: () => string | undefined
}

const refreshIntervalMs = 15 * 60 * 1000
const retryIntervalMs = 2 * 60 * 1000

function finiteMetric(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0
}

export function resolveHgssLocalWeather(observation: LocalWeatherObservation): HgssWeather {
  const code = observation.weatherCode
  const windy = observation.windSpeed >= 30 || observation.windGusts >= 50
  if (code === 45) return hgssWeather.mist
  if (code === 48) return hgssWeather.denseMist
  if (code === 95) return hgssWeather.thunderstorm
  if (code === 96 || code === 99) return hgssWeather.storm
  if ([71, 73, 75, 77, 85, 86].includes(code)) {
    return code === 75 || code === 86 || windy ? hgssWeather.blizzard : hgssWeather.snow
  }
  if ([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82].includes(code)) {
    if (code === 82 || observation.precipitation >= 7.5 || observation.rain + observation.showers >= 7.5) {
      return windy ? hgssWeather.storm : hgssWeather.heavyRain
    }
    if ([55, 57, 65, 66, 67].includes(code)) return hgssWeather.heavyRain
    return hgssWeather.rain
  }
  return hgssWeather.clear
}

export function getLocalWeatherLabel(weather: HgssWeather): string {
  if (weather === hgssWeather.rain) return 'Pluie'
  if (weather === hgssWeather.heavyRain) return 'Forte pluie'
  if (weather === hgssWeather.thunderstorm) return 'Orage'
  if (weather === hgssWeather.storm) return 'Tempête'
  if (weather === hgssWeather.snow) return 'Neige'
  if (weather === hgssWeather.blizzard) return 'Blizzard'
  if (weather === hgssWeather.mist) return 'Brume'
  if (weather === hgssWeather.denseMist) return 'Brouillard dense'
  return 'Temps clair'
}

export function resolvePresentedHgssWeather(
  nativeWeather: HgssWeather,
  mapType: number,
  localWeatherEnabled: boolean,
  localSnapshot: LocalWeatherSnapshot | undefined,
): HgssWeather {
  return isHgssExteriorMapType(mapType) && localWeatherEnabled && localSnapshot ? localSnapshot.weather : nativeWeather
}

function parseOpenMeteoCurrent(value: unknown): LocalWeatherObservation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Réponse météo locale invalide.')
  const current = (value as { current?: unknown }).current
  if (!current || typeof current !== 'object' || Array.isArray(current)) throw new Error('Observation météo locale absente.')
  const data = current as Record<string, unknown>
  if (!Number.isInteger(data.weather_code)) throw new Error('Code météo local absent.')
  return {
    weatherCode: data.weather_code as number,
    precipitation: finiteMetric(data.precipitation),
    rain: finiteMetric(data.rain),
    showers: finiteMetric(data.showers),
    snowfall: finiteMetric(data.snowfall),
    cloudCover: finiteMetric(data.cloud_cover),
    windSpeed: finiteMetric(data.wind_speed_10m),
    windGusts: finiteMetric(data.wind_gusts_10m),
  }
}

function getPosition(geolocation: LocalWeatherGeolocation): Promise<LocalWeatherPosition> {
  return new Promise((resolve, reject) => geolocation.getCurrentPosition(resolve, (error) => {
    reject(new Error(error.code === 1
      ? 'Permission de localisation refusée. La météo locale reste désactivée.'
      : 'Position locale indisponible. La météo ROM reste active.'))
  }, { enableHighAccuracy: false, timeout: 12_000, maximumAge: 30 * 60 * 1000 }))
}

function weatherEndpoint(position: LocalWeatherPosition): string {
  const latitude = Math.round(position.coords.latitude * 100) / 100
  const longitude = Math.round(position.coords.longitude * 100) / 100
  const current = 'weather_code,precipitation,rain,showers,snowfall,cloud_cover,wind_speed_10m,wind_gusts_10m'
  return `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=${current}`
}

export function createLocalWeatherService(dependencies: {
  geolocation?: LocalWeatherGeolocation
  fetch?: LocalWeatherFetch
  now?: () => number
} = {}): LocalWeatherService {
  const geolocation = dependencies.geolocation ?? (typeof navigator !== 'undefined' ? navigator.geolocation : undefined)
  const request = dependencies.fetch ?? (typeof fetch !== 'undefined' ? fetch.bind(globalThis) : undefined)
  const now = dependencies.now ?? Date.now
  let enabled = false
  let generation = 0
  let nextRefreshAt = 0
  let snapshot: LocalWeatherSnapshot | undefined
  let lastError: string | undefined
  let pending: Promise<LocalWeatherSnapshot> | undefined

  const refresh = (): Promise<LocalWeatherSnapshot> => {
    if (pending) return pending
    const requestGeneration = generation
    pending = (async () => {
      if (!geolocation) throw new Error('La géolocalisation n’est pas disponible dans ce navigateur.')
      if (!request) throw new Error('Le service météo n’est pas disponible dans ce navigateur.')
      const position = await getPosition(geolocation)
      const response = await request(weatherEndpoint(position), { headers: { Accept: 'application/json' } })
      if (!response.ok) throw new Error(`Open-Meteo est indisponible (HTTP ${response.status}).`)
      const weather = resolveHgssLocalWeather(parseOpenMeteoCurrent(await response.json()))
      const result = { weather, label: getLocalWeatherLabel(weather), observedAt: now() }
      if (enabled && requestGeneration === generation) {
        snapshot = result
        lastError = undefined
        nextRefreshAt = now() + refreshIntervalMs
      }
      return result
    })().catch((error: unknown) => {
      if (enabled && requestGeneration === generation) {
        lastError = error instanceof Error ? error.message : 'Météo locale indisponible.'
        nextRefreshAt = now() + retryIntervalMs
      }
      throw error
    }).finally(() => { pending = undefined })
    return pending
  }

  return {
    async enable() {
      if (enabled && pending) return pending
      enabled = true
      generation += 1
      try {
        if (pending) await pending.catch(() => undefined)
        return await refresh()
      } catch (error) {
        enabled = false
        generation += 1
        throw error
      }
    },
    resume() {
      enabled = true
      generation += 1
      nextRefreshAt = 0
    },
    disable() {
      enabled = false
      generation += 1
      snapshot = undefined
      lastError = undefined
      nextRefreshAt = 0
    },
    refreshIfDue() {
      if (!enabled || pending || now() < nextRefreshAt) return
      void refresh().catch(() => undefined)
    },
    getSnapshot: () => snapshot,
    getLastError: () => lastError,
  }
}

export async function toggleLocalWeatherPreference(
  service: LocalWeatherService,
  currentlyEnabled: boolean,
): Promise<{ enabled: boolean, message: string, tone: 'success' | 'warning' }> {
  if (currentlyEnabled) {
    service.disable()
    return { enabled: false, message: 'Météo locale désactivée. La météo de la ROM reprend le relais.', tone: 'success' }
  }
  try {
    const snapshot = await service.enable()
    return { enabled: true, message: `Météo locale activée : ${snapshot.label} · Open-Meteo.`, tone: 'success' }
  } catch (error) {
    return {
      enabled: false,
      message: error instanceof Error ? error.message : 'Météo locale indisponible. La météo ROM reste active.',
      tone: 'warning',
    }
  }
}
