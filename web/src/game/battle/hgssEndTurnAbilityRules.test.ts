import { describe, expect, it } from 'vitest'
import { neutralBattleStatStages } from './hgssBattleRules'
import { applyHgssSpeedBoost, isHgssWeatherDamageImmune, isHgssWeatherSuppressed, resolveHgssEndTurnAbility, resolveHgssStatusResidual } from './hgssEndTurnAbilityRules'

describe('talents HGSS de fin de tour', () => {
  it('résout poison, brûlure, Soin Poison et Garde Magik sans dupliquer les moteurs', () => {
    expect(resolveHgssStatusResidual({ abilityId: 90, currentHp: 40, maximumHp: 80, status: 0x80 | 0x200 })).toEqual({ kind: 'heal', abilityId: 90, amount: 10, nextStatus: 0x280 })
    expect(resolveHgssStatusResidual({ abilityId: 0, currentHp: 80, maximumHp: 80, status: 0x80 | 0x200 })).toEqual({ kind: 'damage', status: 'badPoison', amount: 10, nextStatus: 0x380 })
    expect(resolveHgssStatusResidual({ abilityId: 85, currentHp: 80, maximumHp: 80, status: 0x10 })).toMatchObject({ kind: 'damage', status: 'burn', amount: 5 })
    expect(resolveHgssStatusResidual({ abilityId: 98, currentHp: 80, maximumHp: 80, status: 0x8 })).toEqual({ kind: 'none', nextStatus: 0x8 })
  })

  it('applique les familles météo, soin, soin bloqué et guérison aux valeurs Gen IV', () => {
    const base = { currentHp: 40, maximumHp: 80, status: 0x10, weatherSuppressed: false, healBlocked: false, speedStage: 0, enteredThisTurn: false, random: 0 } as const
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 44, weather: 'rain' })).toEqual({ kind: 'heal', abilityId: 44, amount: 5 })
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 87, weather: 'rain' })).toEqual({ kind: 'heal', abilityId: 87, amount: 10 })
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 94, weather: 'sun' })).toEqual({ kind: 'damage', abilityId: 94, amount: 10 })
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 93, weather: 'rain' })).toEqual({ kind: 'cureStatus', abilityId: 93 })
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 44, weather: 'rain', healBlocked: true })).toBeUndefined()
    expect(resolveHgssEndTurnAbility({ ...base, abilityId: 87, weather: 'sun', weatherSuppressed: true })).toBeUndefined()
  })

  it('centralise Turbo, la suppression météo et les immunités résiduelles', () => {
    const stages = { ...neutralBattleStatStages, speed: 5 }
    const turbo = { abilityId: 3, currentHp: 1, maximumHp: 1, status: 0, weather: 'clear', weatherSuppressed: false, healBlocked: false, speedStage: 5, enteredThisTurn: false, random: 9 } as const
    expect(resolveHgssEndTurnAbility(turbo)).toMatchObject({ kind: 'raiseSpeed', applied: true })
    expect(resolveHgssEndTurnAbility({ ...turbo, enteredThisTurn: true })).toBeUndefined()
    expect(applyHgssSpeedBoost(stages)).toBe(true)
    expect(stages.speed).toBe(6)
    expect(applyHgssSpeedBoost(stages)).toBe(false)
    expect(isHgssWeatherSuppressed([0, 13])).toBe(true)
    expect(isHgssWeatherSuppressed([76])).toBe(true)
    expect(isHgssWeatherDamageImmune('sandstorm', [0], 8)).toBe(true)
    expect(isHgssWeatherDamageImmune('hail', [0], 81)).toBe(true)
  })
})
