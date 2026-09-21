import { describe, expect, it, vi } from 'vitest'
import { createLocalWeatherService, resolveHgssLocalWeather, resolvePresentedHgssWeather } from './localWeather'
import { hgssWeather } from './hgssWeather'

const observation = (weatherCode: number, overrides: Partial<Parameters<typeof resolveHgssLocalWeather>[0]> = {}) => ({
  weatherCode,
  precipitation: 0,
  rain: 0,
  showers: 0,
  snowfall: 0,
  cloudCover: 0,
  windSpeed: 0,
  windGusts: 0,
  ...overrides,
})

describe('local weather translation', () => {
  it.each([
    [0, hgssWeather.clear],
    [45, hgssWeather.mist],
    [48, hgssWeather.denseMist],
    [51, hgssWeather.rain],
    [65, hgssWeather.heavyRain],
    [71, hgssWeather.snow],
    [75, hgssWeather.blizzard],
    [95, hgssWeather.thunderstorm],
    [99, hgssWeather.storm],
  ])('maps WMO code %i to HGSS weather %i', (code, expected) => {
    expect(resolveHgssLocalWeather(observation(code))).toBe(expected)
  })

  it('promotes intense wind and precipitation without inventing a battle weather', () => {
    expect(resolveHgssLocalWeather(observation(73, { windGusts: 55 }))).toBe(hgssWeather.blizzard)
    expect(resolveHgssLocalWeather(observation(82, { precipitation: 9, windSpeed: 35 }))).toBe(hgssWeather.storm)
  })

  it('overrides only the visual weather of exterior maps when enabled', () => {
    const local = { weather: hgssWeather.rain, label: 'Pluie', observedAt: 1 }
    expect(resolvePresentedHgssWeather(hgssWeather.snow, 1, true, local)).toBe(hgssWeather.rain)
    expect(resolvePresentedHgssWeather(hgssWeather.snow, 2, true, local)).toBe(hgssWeather.rain)
    expect(resolvePresentedHgssWeather(hgssWeather.snow, 0, true, local)).toBe(hgssWeather.snow)
    expect(resolvePresentedHgssWeather(hgssWeather.snow, 3, true, local)).toBe(hgssWeather.snow)
    expect(resolvePresentedHgssWeather(hgssWeather.snow, 1, false, local)).toBe(hgssWeather.snow)
  })
})

describe('local weather service', () => {
  it('asks for location on enable, rounds coordinates and refreshes only when due', async () => {
    let timestamp = 10_000
    const geolocation = {
      getCurrentPosition: vi.fn((success: (position: { coords: { latitude: number, longitude: number } }) => void) => {
        success({ coords: { latitude: 50.84672, longitude: 4.35247 } })
      }),
    }
    const request = vi.fn(async () => ({
      ok: true,
      status: 200,
      json: async () => ({ current: { weather_code: 61, precipitation: 1.2, rain: 1.2 } }),
    }))
    const service = createLocalWeatherService({ geolocation, fetch: request, now: () => timestamp })

    await expect(service.enable()).resolves.toMatchObject({ weather: hgssWeather.rain, label: 'Pluie' })
    expect(request).toHaveBeenCalledWith(expect.stringContaining('latitude=50.85&longitude=4.35'), expect.anything())
    service.refreshIfDue()
    expect(request).toHaveBeenCalledTimes(1)

    timestamp += 15 * 60 * 1000
    service.refreshIfDue()
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(2))
    service.disable()
    expect(service.getSnapshot()).toBeUndefined()
  })

  it('keeps local weather disabled when geolocation permission is refused', async () => {
    const geolocation = {
      getCurrentPosition: (_success: unknown, failure: (error: { code: number }) => void) => failure({ code: 1 }),
    }
    const service = createLocalWeatherService({ geolocation, fetch: vi.fn() })

    await expect(service.enable()).rejects.toThrow('Permission de localisation refusée')
    expect(service.getSnapshot()).toBeUndefined()
  })
})
