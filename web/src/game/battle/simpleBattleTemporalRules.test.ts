import { describe, expect, it } from 'vitest'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import {
  canHgssMoveHitSemiInvulnerable,
  resolveHgssChargeKind,
  resolveHgssContextualDamageMove,
  resolveHgssMagnitudePower,
  resolveHgssPlateType,
  resolveHgssTrumpCardPower,
  resolveHgssWeatherAccuracy,
} from './simpleBattleTemporalRules'

const move = (effect: number, power = 60, type = 0): PokemonMoveData => ({
  moveId: effect, effect, category: 0, power, type, accuracy: 70, pp: 10,
  effectChance: 0, range: 0, priority: 0, flags: 0, contestEffect: 0, contestType: 0, contestUnknown: 0,
})

describe('règles temporelles HGSS communes au combat simple', () => {
  it('résout globalement les charges et les fenêtres de semi-invulnérabilité', () => {
    expect(resolveHgssChargeKind(155, 'clear')).toBe('fly')
    expect(resolveHgssChargeKind(151, 'sun')).toBeUndefined()
    expect(resolveHgssChargeKind(151, 'rain')).toBe('solar')
    expect(canHgssMoveHitSemiInvulnerable(147, 'dig')).toBe(true)
    expect(canHgssMoveHitSemiInvulnerable(257, 'dive')).toBe(true)
    expect(canHgssMoveHitSemiInvulnerable(207, 'fly')).toBe(true)
    expect(resolveHgssChargeKind(272, 'clear')).toBe('shadow')
    expect(resolveHgssChargeKind(39, 'clear')).toBe('charge')
    expect(resolveHgssChargeKind(75, 'clear')).toBe('charge')
    expect(canHgssMoveHitSemiInvulnerable(0, 'fly')).toBe(false)
  })

  it('dérive puissance, type et précision sans modifier les données ROM sources', () => {
    const weatherBall = move(203, 50)
    const resolved = resolveHgssContextualDamageMove(weatherBall, {
      weather: 'rain', rolloutCount: 0, defenseCurl: false, targetMinimized: false,
    })
    expect(resolved).toMatchObject({ power: 100, type: 11 })
    expect(weatherBall).toMatchObject({ power: 50, type: 0 })
    expect(resolveHgssWeatherAccuracy(move(152), 'rain')).toBe('always-hit')
    expect(resolveHgssWeatherAccuracy(move(152), 'sun')).toMatchObject({ accuracy: 50 })
  })

  it('centralise les multiplicateurs dépendant de la chronologie du tour', () => {
    const contextual = (effect: number, extra: Partial<Parameters<typeof resolveHgssContextualDamageMove>[1]>) => resolveHgssContextualDamageMove(move(effect, 50), {
      weather: 'clear', rolloutCount: 0, defenseCurl: false, targetMinimized: false, ...extra,
    }).power
    expect(contextual(119, { furyCutterCount: 3 })).toBe(400)
    expect(contextual(185, { attackerDamagedThisTurn: true })).toBe(100)
    expect(contextual(230, { targetActedThisTurn: true })).toBe(100)
    expect(contextual(231, { targetDamagedThisTurn: true })).toBe(100)
    expect(contextual(128, { targetSwitching: true })).toBe(100)
  })

  it('reproduit les sept paliers de puissance d’Ampleur', () => {
    expect([0, 5, 15, 35, 65, 85, 95].map((roll) => resolveHgssMagnitudePower(roll))).toEqual([
      { level: 4, power: 10 }, { level: 5, power: 30 }, { level: 6, power: 50 },
      { level: 7, power: 70 }, { level: 8, power: 90 }, { level: 9, power: 110 }, { level: 10, power: 150 },
    ])
  })

  it('résout Atout et les types des Plaques depuis les registres HGSS', () => {
    expect([0, 1, 2, 3, 4].map(resolveHgssTrumpCardPower)).toEqual([200, 80, 60, 50, 40])
    expect(resolveHgssPlateType(275)).toBe(10)
    expect(resolveHgssPlateType(290)).toBe(8)
    expect(resolveHgssPlateType(274)).toBeUndefined()
  })
})
