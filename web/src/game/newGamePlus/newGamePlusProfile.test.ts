import { describe, expect, it } from 'vitest'
import { parseNewGamePlusProfileV1 } from './newGamePlusProfile'

const validProfile = {
  format: 'pokemaster-hgss-new-game-plus',
  version: 1,
  source: {
    gameCode: 'IPKF',
    slot: 1,
    playerName: 'LUTH',
    leagueCompletedAt: '2026-08-24T18:30:00.000Z',
  },
  modules: [
    { id: 'carry-money', revision: 1, config: { percentage: 50 } },
    { id: 'carry-pokedex', revision: 1, config: { includeNationalDex: true } },
  ],
}

describe('profil New Game+', () => {
  it('restaure un profil V1 sérialisable et le gèle profondément', () => {
    const profile = parseNewGamePlusProfileV1(JSON.parse(JSON.stringify(validProfile)))
    const canonicalProfile = {
      ...validProfile,
      source: {
        gameVersion: 7,
        language: 3,
        slot: 1,
        playerName: 'LUTH',
        playerNameSource: 'user-text',
        leagueCompletedAt: '2026-08-24T18:30:00.000Z',
      },
    }

    expect(profile).toEqual(canonicalProfile)
    expect(JSON.parse(JSON.stringify(profile))).toEqual(canonicalProfile)
    expect(Object.isFrozen(profile)).toBe(true)
    expect(Object.isFrozen(profile.source)).toBe(true)
    expect(Object.isFrozen(profile.modules)).toBe(true)
    expect(Object.isFrozen(profile.modules[0])).toBe(true)
    expect(Object.isFrozen(profile.modules[0]?.config)).toBe(true)
  })

  it.each([
    [{ ...validProfile, version: 2 }, 'pas pris en charge'],
    [{ ...validProfile, source: { ...validProfile.source, gameCode: 'IPK' } }, 'code ROM'],
    [{ ...validProfile, source: { ...validProfile.source, slot: 4 } }, 'emplacement source'],
    [{ ...validProfile, source: { ...validProfile.source, leagueCompletedAt: 'jamais' } }, 'date de victoire'],
    [{ ...validProfile, modules: [{ id: 'Carry Money', revision: 1, config: null }] }, 'identifiant'],
  ])('refuse une métadonnée source ou structurelle invalide', (value, message) => {
    expect(() => parseNewGamePlusProfileV1(value)).toThrow(message)
  })

  it('refuse les valeurs qui ne peuvent pas survivre à JSON', () => {
    expect(() => parseNewGamePlusProfileV1({
      ...validProfile,
      modules: [{ id: 'test', revision: 1, config: { ratio: Number.NaN } }],
    })).toThrow('non sérialisable')
  })
})
