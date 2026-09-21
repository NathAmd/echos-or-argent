import { hgssWeather, type HgssWeather } from '../../game/world/hgssWeather'

export type HgssWeatherParticleMode = 'none' | 'rain' | 'snow' | 'sand' | 'diamond' | 'mist'

export type HgssWeatherVisualProfile = {
  particleMode: HgssWeatherParticleMode
  particleCount: number
  color: number
  opacity: number
  size: number
  horizontalSpeed: number
  verticalSpeed: number
  streakLength: number
  lighting: number
  fogDensity: number
}

const profile = (
  particleMode: HgssWeatherParticleMode,
  overrides: Partial<Omit<HgssWeatherVisualProfile, 'particleMode'>> = {},
): HgssWeatherVisualProfile => ({
  particleMode,
  particleCount: particleMode === 'none' ? 0 : 128,
  color: 0xd9e4e8,
  opacity: 0.55,
  size: 3,
  horizontalSpeed: 0,
  verticalSpeed: 0,
  streakLength: 0,
  lighting: 1,
  fogDensity: 0,
  ...overrides,
})

const profiles: Readonly<Record<HgssWeather, HgssWeatherVisualProfile>> = {
  [hgssWeather.clear]: profile('none'),
  [hgssWeather.rain]: profile('rain', { particleCount: 144, color: 0xb8dcff, opacity: 0.68, horizontalSpeed: 0.006, verticalSpeed: -0.025, streakLength: 1.25, lighting: 0.84 }),
  [hgssWeather.heavyRain]: profile('rain', { particleCount: 192, color: 0xaed4ff, opacity: 0.8, horizontalSpeed: 0.009, verticalSpeed: -0.043, streakLength: 2, lighting: 0.72 }),
  [hgssWeather.thunderstorm]: profile('rain', { particleCount: 192, color: 0xa7cfff, opacity: 0.84, horizontalSpeed: 0.012, verticalSpeed: -0.046, streakLength: 2.25, lighting: 0.62 }),
  [hgssWeather.storm]: profile('rain', { particleCount: 192, color: 0x9fc8f8, opacity: 0.88, horizontalSpeed: 0.02, verticalSpeed: -0.05, streakLength: 2.5, lighting: 0.56 }),
  [hgssWeather.snow]: profile('snow', { particleCount: 132, color: 0xf4fbff, opacity: 0.72, size: 4, horizontalSpeed: 0.002, verticalSpeed: -0.006, lighting: 0.9 }),
  [hgssWeather.blizzard]: profile('snow', { particleCount: 192, color: 0xf4fbff, opacity: 0.84, size: 4, horizontalSpeed: 0.018, verticalSpeed: -0.014, lighting: 0.7 }),
  [hgssWeather.sandstorm]: profile('sand', { particleCount: 176, color: 0xd7ad67, opacity: 0.72, size: 4, horizontalSpeed: 0.035, verticalSpeed: 0.001, lighting: 0.7 }),
  [hgssWeather.diamondDust]: profile('diamond', { particleCount: 144, color: 0xd7fbff, opacity: 0.68, size: 4, horizontalSpeed: 0.002, verticalSpeed: -0.004, lighting: 0.94 }),
  [hgssWeather.mist]: profile('mist', { particleCount: 96, color: 0xd9e4e8, opacity: 0.12, size: 14, horizontalSpeed: 0.0015, lighting: 0.82, fogDensity: 0.009 }),
  [hgssWeather.denseMist]: profile('mist', { particleCount: 144, color: 0xd9e4e8, opacity: 0.16, size: 20, horizontalSpeed: 0.002, lighting: 0.66, fogDensity: 0.018 }),
  [hgssWeather.darkness]: profile('none'),
  [hgssWeather.deepDarkness]: profile('none'),
  [hgssWeather.lowLight]: profile('none'),
}

/** Centralise le rendu remasterise sans modifier la valeur météo issue de HGSS. */
export function resolveHgssWeatherVisualProfile(weather: HgssWeather): HgssWeatherVisualProfile {
  return profiles[weather]
}
