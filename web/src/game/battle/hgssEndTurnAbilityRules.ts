import type { BattleStatStages } from './hgssBattleRules'

export type HgssResidualWeather = 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'

export type HgssStatusResidual =
  | { kind: 'damage', status: 'poison' | 'badPoison' | 'burn', amount: number, nextStatus: number }
  | { kind: 'heal', abilityId: 90, amount: number, nextStatus: number }
  | { kind: 'none', nextStatus: number }

export type HgssEndTurnAbilityEffect =
  | { kind: 'heal', abilityId: number, amount: number }
  | { kind: 'damage', abilityId: number, amount: number }
  | { kind: 'cureStatus', abilityId: number }
  | { kind: 'raiseSpeed', abilityId: 3, applied: boolean }

const primaryStatusMask = 0x7 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0xf00

export function isHgssWeatherSuppressed(activeAbilityIds: readonly number[]): boolean {
  return activeAbilityIds.some((abilityId) => abilityId === 13 || abilityId === 76)
}

export function resolveHgssStatusResidual(input: {
  abilityId: number
  currentHp: number
  maximumHp: number
  status: number
}): HgssStatusResidual {
  const { abilityId, currentHp, maximumHp, status } = input
  if (abilityId === 98) return { kind: 'none', nextStatus: status }
  const badPoison = (status & 0x80) !== 0
  const poison = badPoison || (status & 0x8) !== 0
  if (poison && abilityId === 90) {
    return { kind: 'heal', abilityId: 90, amount: Math.min(maximumHp - currentHp, Math.max(1, Math.floor(maximumHp / 8))), nextStatus: status }
  }
  if (badPoison) {
    const counter = Math.max(1, (status >>> 8) & 0xf)
    return {
      kind: 'damage', status: 'badPoison', amount: Math.min(currentHp, Math.max(1, Math.floor(maximumHp * counter / 16))),
      nextStatus: (status & ~0xf00) | (Math.min(15, counter + 1) << 8),
    }
  }
  if (poison) return { kind: 'damage', status: 'poison', amount: Math.min(currentHp, Math.max(1, Math.floor(maximumHp / 8))), nextStatus: status }
  if ((status & 0x10) !== 0) return { kind: 'damage', status: 'burn', amount: Math.min(currentHp, Math.max(1, Math.floor(maximumHp / (abilityId === 85 ? 16 : 8)))), nextStatus: status }
  return { kind: 'none', nextStatus: status }
}

export function resolveHgssEndTurnAbility(input: {
  abilityId: number
  currentHp: number
  maximumHp: number
  status: number
  weather: HgssResidualWeather
  weatherSuppressed: boolean
  healBlocked: boolean
  speedStage: number
  enteredThisTurn: boolean
  random: number
}): HgssEndTurnAbilityEffect | undefined {
  const { abilityId, currentHp, maximumHp, status, weatherSuppressed, healBlocked } = input
  const weather = weatherSuppressed ? 'clear' : input.weather
  const missingHp = maximumHp - currentHp
  const heal = (divisor: number): number => healBlocked ? 0 : Math.min(missingHp, Math.max(1, Math.floor(maximumHp / divisor)))
  const damage = (divisor: number): number => Math.min(currentHp, Math.max(1, Math.floor(maximumHp / divisor)))
  if (abilityId === 3 && !input.enteredThisTurn && input.speedStage < 6) return { kind: 'raiseSpeed', abilityId: 3, applied: true }
  if (abilityId === 44 && weather === 'rain' && missingHp > 0 && heal(16) > 0) return { kind: 'heal', abilityId, amount: heal(16) }
  if (abilityId === 61 && (status & primaryStatusMask) !== 0 && input.random % 10 < 3) return { kind: 'cureStatus', abilityId }
  if (abilityId === 87 && weather === 'rain' && missingHp > 0 && heal(8) > 0) return { kind: 'heal', abilityId, amount: heal(8) }
  if (abilityId === 87 && weather === 'sun') return { kind: 'damage', abilityId, amount: damage(8) }
  if (abilityId === 93 && weather === 'rain' && (status & primaryStatusMask) !== 0) return { kind: 'cureStatus', abilityId }
  if (abilityId === 94 && weather === 'sun') return { kind: 'damage', abilityId, amount: damage(8) }
  if (abilityId === 115 && weather === 'hail' && missingHp > 0 && heal(16) > 0) return { kind: 'heal', abilityId, amount: heal(16) }
  return undefined
}

export function isHgssWeatherDamageImmune(weather: 'sandstorm' | 'hail', types: readonly number[], abilityId: number): boolean {
  if (abilityId === 98) return true
  if (weather === 'sandstorm') return abilityId === 8 || types.some((type) => type === 4 || type === 5 || type === 8)
  return abilityId === 81 || abilityId === 115 || types.includes(15)
}

export function applyHgssSpeedBoost(stages: BattleStatStages): boolean {
  if (stages.speed >= 6) return false
  stages.speed += 1
  return true
}
