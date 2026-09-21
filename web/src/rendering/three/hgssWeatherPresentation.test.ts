import { describe, expect, it } from 'vitest'
import { hgssWeather } from '../../game/world/hgssWeather'
import { resolveHgssWeatherVisualProfile } from './hgssWeatherPresentation'

describe('presentation météo HGSS', () => {
  it('projette les codes natifs sur un seul pipeline de particules', () => {
    expect(resolveHgssWeatherVisualProfile(hgssWeather.rain).particleMode).toBe('rain')
    expect(resolveHgssWeatherVisualProfile(hgssWeather.snow).particleMode).toBe('snow')
    expect(resolveHgssWeatherVisualProfile(hgssWeather.sandstorm).particleMode).toBe('sand')
    expect(resolveHgssWeatherVisualProfile(hgssWeather.diamondDust).particleMode).toBe('diamond')
    expect(resolveHgssWeatherVisualProfile(hgssWeather.denseMist).particleMode).toBe('mist')
  })

  it('rend les variantes fortes plus denses et assombrit leur lumière', () => {
    const rain = resolveHgssWeatherVisualProfile(hgssWeather.rain)
    const storm = resolveHgssWeatherVisualProfile(hgssWeather.storm)
    expect(storm.particleCount).toBeGreaterThan(rain.particleCount)
    expect(storm.streakLength).toBeGreaterThan(rain.streakLength)
    expect(storm.lighting).toBeLessThan(rain.lighting)
  })

  it('ne fabrique aucune particule pour les codes de luminosité seuls', () => {
    for (const weather of [hgssWeather.clear, hgssWeather.darkness, hgssWeather.deepDarkness, hgssWeather.lowLight]) {
      expect(resolveHgssWeatherVisualProfile(weather).particleCount).toBe(0)
    }
  })
})
