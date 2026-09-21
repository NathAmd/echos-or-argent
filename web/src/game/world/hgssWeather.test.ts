import { describe, expect, it } from 'vitest'
import { hgssMountSilverSummitMapId, hgssWeather, isHgssExteriorMapType, resolveHgssBattleWeather, resolveHgssMapWeather, restoreHgssSavedMapWeather } from './hgssWeather'

describe('météo RTC HGSS', () => {
  it('reprend les types exterieurs CITY_TOWN et ROUTE du header HGSS', () => {
    expect(isHgssExteriorMapType(1)).toBe(true)
    expect(isHgssExteriorMapType(2)).toBe(true)
    expect(isHgssExteriorMapType(3)).toBe(false)
    expect(isHgssExteriorMapType(4)).toBe(false)
  })

  it.each([
    [1, 1], [1, 31], [2, 1], [2, 29], [3, 15], [10, 10], [12, 3], [12, 31],
  ])('active la poussière de diamant au sommet le %i/%i', (month, day) => {
    expect(resolveHgssMapWeather(hgssMountSilverSummitMapId, hgssWeather.snow, new Date(2028, month - 1, day))).toBe(hgssWeather.diamondDust)
  })

  it('respecte la pénalité RTC et les autres cartes', () => {
    const date = new Date(2028, 0, 1)
    expect(resolveHgssMapWeather(hgssMountSilverSummitMapId, hgssWeather.snow, date, true)).toBe(hgssWeather.snow)
    expect(restoreHgssSavedMapWeather(hgssWeather.clear, hgssMountSilverSummitMapId, hgssWeather.snow, date, true)).toBe(hgssWeather.snow)
    expect(resolveHgssMapWeather(464, hgssWeather.snow, date)).toBe(hgssWeather.snow)
  })

  it('projette la météo de terrain dans les quatre climats du combat', () => {
    expect(resolveHgssBattleWeather(hgssWeather.heavyRain)).toBe('rain')
    expect(resolveHgssBattleWeather(hgssWeather.sandstorm)).toBe('sandstorm')
    expect(resolveHgssBattleWeather(hgssWeather.blizzard)).toBe('hail')
    expect(resolveHgssBattleWeather(hgssWeather.darkness)).toBe('clear')
  })
})
