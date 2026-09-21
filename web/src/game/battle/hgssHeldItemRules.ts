import type { PokemonStatValues } from '../pokemon/pokemonFormulas'
import type { BattleStatStages } from './hgssBattleRules'

export type HgssHeldItemEffect = { effect: number, parameter: number }
export type HgssHeldAutoUse = { consumedEffect: number, parameter: number }
export type HgssHeldOnHit = { kind: 'healTarget' | 'damageAttacker', amount: number, consume: true } | { kind: 'transferToAttacker', amount: 0, consume: false }

const typeBoosts = new Map<number, number>([
  [57, 6], [68, 8], [72, 4], [73, 5], [74, 12], [75, 16], [76, 1], [77, 13], [78, 11],
  [79, 2], [80, 3], [81, 15], [82, 7], [83, 14], [84, 10], [85, 17], [86, 0],
])
const resistBerries = new Map<number, number>([
  [19, 10], [20, 11], [21, 13], [22, 12], [23, 15], [24, 1], [25, 3], [26, 4], [27, 2],
  [28, 14], [29, 6], [30, 5], [31, 7], [32, 17], [33, 16], [34, 8], [35, 0],
])

export function resolveHgssHeldItemEffect(input: { holdEffect?: number, holdEffectParameter?: number, abilityId: number, embargoTurns: number }): HgssHeldItemEffect {
  return input.abilityId === 103 || input.embargoTurns > 0 ? { effect: 0, parameter: 0 } : { effect: input.holdEffect ?? 0, parameter: input.holdEffectParameter ?? 0 }
}

export function applyHgssHeldBattleStats(stats: PokemonStatValues, held: HgssHeldItemEffect, speciesId: number, role: 'attacker' | 'defender', frontierBattle = false): PokemonStatValues {
  const result = { ...stats }
  if (role === 'attacker') {
    if (held.effect === 55) result.attack = Math.floor(result.attack * 3 / 2)
    if (held.effect === 125) result.specialAttack = Math.floor(result.specialAttack * 3 / 2)
    if (held.effect === 60 && !frontierBattle && (speciesId === 380 || speciesId === 381)) result.specialAttack = Math.floor(result.specialAttack * 3 / 2)
    if (held.effect === 61 && speciesId === 366) result.specialAttack *= 2
    if (held.effect === 91 && (speciesId === 104 || speciesId === 105)) result.attack *= 2
  } else {
    if (held.effect === 60 && !frontierBattle && (speciesId === 380 || speciesId === 381)) result.specialDefense = Math.floor(result.specialDefense * 3 / 2)
    if (held.effect === 62 && speciesId === 366) result.specialDefense *= 2
    if (held.effect === 90 && speciesId === 132) result.defense *= 2
  }
  return result
}

export function applyHgssHeldAttackStats(stats: PokemonStatValues, held: HgssHeldItemEffect, category: number, speciesId = 0, frontierBattle = false): PokemonStatValues {
  const boosted = applyHgssHeldBattleStats(stats, held, speciesId, 'attacker', frontierBattle)
  if (category === 0 && held.effect === 125) boosted.specialAttack = stats.specialAttack
  if (category === 1 && held.effect === 55) boosted.attack = stats.attack
  return boosted
}

export function applyHgssHeldDamageBoost(damage: number, held: HgssHeldItemEffect, moveType: number, category: number, typeMultiplier: number, context: { speciesId?: number, transformed?: boolean, metronomeTurns?: number } = {}): number {
  const applies = typeBoosts.get(held.effect) === moveType || held.effect === 94 && category === 0
    || held.effect === 95 && category === 1 || held.effect === 96 && typeMultiplier > 10 || held.effect === 98
    || held.effect === 71 && context.speciesId === 25
    || held.effect === 2 && context.speciesId === 487 && !context.transformed && (moveType === 14 || moveType === 7)
    || held.effect === 3 && context.speciesId === 483 && (moveType === 14 || moveType === 8)
    || held.effect === 4 && context.speciesId === 484 && (moveType === 14 || moveType === 11)
  let result = applies ? Math.floor(damage * (held.effect === 71 ? 200 : 100 + held.parameter) / 100) : damage
  if (held.effect === 105 && context.metronomeTurns) result = Math.floor(result * (10 + Math.min(10, context.metronomeTurns)) / 10)
  return result
}

export function isHgssResistBerryActive(held: HgssHeldItemEffect, moveType: number, typeMultiplier: number): boolean {
  return resistBerries.get(held.effect) === moveType && (held.effect === 35 || typeMultiplier > 10)
}

export function isHgssHeldSurvivalActive(held: HgssHeldItemEffect, currentHp: number, maximumHp: number, roll: number): boolean {
  return currentHp > 1 && (held.effect === 103 && currentHp === maximumHp || held.effect === 65 && roll % 100 < held.parameter)
}

export function resolveHgssHeldCriticalStage(held: HgssHeldItemEffect, speciesId: number): number {
  if (held.effect === 89 && speciesId === 113 || held.effect === 92 && speciesId === 83) return 2
  return held.effect === 67 ? 1 : 0
}

export function applyHgssHeldAccuracy(accuracy: number, attacker: HgssHeldItemEffect, defender: HgssHeldItemEffect, targetActed = false): number {
  if (accuracy === 0) return 0
  let result = accuracy
  if (attacker.effect === 93) result = Math.floor(result * (100 + attacker.parameter) / 100)
  if (attacker.effect === 104 && targetActed) result = Math.floor(result * (100 + attacker.parameter) / 100)
  if (defender.effect === 48) result = Math.floor(result * (100 - defender.parameter) / 100)
  return Math.max(1, Math.min(100, result))
}

export function doesHgssHeldItemFlinch(held: HgssHeldItemEffect, moveFlags: number, dealtDamage: number, targetAbilityId: number, roll: number): boolean {
  return held.effect === 56 && (moveFlags & (1 << 5)) !== 0 && dealtDamage > 0 && targetAbilityId !== 39 && roll % 100 < held.parameter
}

export function resolveHgssMetronomeState(held: HgssHeldItemEffect, currentMoveId: number, previousMoveId: number, previousTurns: number, lockedSequence: boolean): { moveId: number, turns: number } {
  if (held.effect !== 105) return { moveId: previousMoveId, turns: 0 }
  if (lockedSequence) return { moveId: previousMoveId, turns: previousTurns }
  return currentMoveId === previousMoveId
    ? { moveId: currentMoveId, turns: Math.min(10, previousTurns + 1) }
    : { moveId: currentMoveId, turns: 0 }
}

export function resolveHgssHeldOnHit(input: {
  targetHeld: HgssHeldItemEffect
  damageCategory: number
  moveFlags: number
  moveEffect: number
  dealtDamage: number
  typeMultiplier: number
  substituteWasHit: boolean
  attackerCurrentHp: number
  attackerMaximumHp: number
  attackerAbilityId: number
  attackerHasItem: boolean
  targetCurrentHp: number
  targetMaximumHp: number
  targetHealBlocked: boolean
}): HgssHeldOnHit | undefined {
  if (input.dealtDamage <= 0 || input.substituteWasHit) return undefined
  const { effect, parameter } = input.targetHeld
  if (effect === 43 && input.typeMultiplier > 10 && input.targetCurrentHp > 0 && input.targetCurrentHp < input.targetMaximumHp && !input.targetHealBlocked) {
    return { kind: 'healTarget', amount: Math.min(input.targetMaximumHp - input.targetCurrentHp, Math.max(1, Math.floor(input.targetMaximumHp / parameter))), consume: true }
  }
  if ((effect === 46 && input.damageCategory === 0 || effect === 47 && input.damageCategory === 1) && input.attackerCurrentHp > 0 && input.attackerAbilityId !== 98) {
    return { kind: 'damageAttacker', amount: Math.min(input.attackerCurrentHp, Math.max(1, Math.floor(input.attackerMaximumHp / parameter))), consume: true }
  }
  if (effect === 116 && (input.moveFlags & 1) !== 0 && input.moveEffect !== 188 && input.attackerCurrentHp > 0 && !input.attackerHasItem) {
    return { kind: 'transferToAttacker', amount: 0, consume: false }
  }
  return undefined
}

export function resolveHgssHeldAutoUse(input: {
  held: HgssHeldItemEffect
  abilityId: number
  currentHp: number
  maximumHp: number
  status: number
  confusion: boolean
  infatuated: boolean
  stages: BattleStatStages
  hasEmptyPp: boolean
}): HgssHeldAutoUse | undefined {
  const { effect, parameter } = input.held
  if (effect === 1 && input.currentHp <= Math.floor(input.maximumHp / 2) && input.currentHp < input.maximumHp) return { consumedEffect: 7, parameter }
  if (effect === 13 && input.currentHp <= Math.floor(input.maximumHp / 2) && input.currentHp < input.maximumHp) return { consumedEffect: 10, parameter }
  if (effect >= 14 && effect <= 18 && input.currentHp <= Math.floor(input.maximumHp / 2) && input.currentHp < input.maximumHp) return { consumedEffect: effect - 3, parameter }
  if (effect === 5 && (input.status & 0x40) !== 0) return { consumedEffect: 1, parameter }
  if (effect === 6 && (input.status & 0x7) !== 0) return { consumedEffect: 2, parameter }
  if (effect === 7 && (input.status & (0x8 | 0x80)) !== 0) return { consumedEffect: 3, parameter }
  if (effect === 8 && (input.status & 0x10) !== 0) return { consumedEffect: 4, parameter }
  if (effect === 9 && (input.status & 0x20) !== 0) return { consumedEffect: 5, parameter }
  if (effect === 10 && input.hasEmptyPp) return { consumedEffect: 6, parameter }
  if (effect === 11 && input.confusion) return { consumedEffect: 8, parameter }
  if (effect === 12 && (input.status !== 0 || input.confusion)) return { consumedEffect: 9, parameter }
  let divisor = parameter
  if (input.abilityId === 82) divisor = Math.floor(divisor / 2)
  const pinched = divisor > 0 && input.currentHp <= Math.floor(input.maximumHp / divisor)
  if (effect >= 36 && effect <= 40 && pinched && input.stages[(['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const)[effect - 36]!] < 6) return { consumedEffect: effect - 20, parameter }
  if (effect === 41 && pinched) return { consumedEffect: 21, parameter }
  if (effect === 42 && pinched && Object.values(input.stages).some((stage) => stage < 6)) return { consumedEffect: 22, parameter }
  if (effect === 44 && pinched) return { consumedEffect: 23, parameter }
  if (effect === 49 && Object.values(input.stages).some((stage) => stage < 0)) return { consumedEffect: 24, parameter }
  if (effect === 54 && input.infatuated) return { consumedEffect: 25, parameter }
  return undefined
}

export function resolveHgssHeldPostDamage(input: { held: HgssHeldItemEffect, dealtDamage: number, currentHp: number, maximumHp: number, healBlocked: boolean, magicGuard?: boolean }): { kind: 'heal' | 'damage', amount: number } | undefined {
  if (input.dealtDamage <= 0 || input.currentHp <= 0) return undefined
  if (input.held.effect === 88 && !input.healBlocked && input.currentHp < input.maximumHp) return { kind: 'heal', amount: Math.min(input.maximumHp - input.currentHp, Math.max(1, Math.floor(input.dealtDamage / 8))) }
  if (input.held.effect === 98 && !input.magicGuard) return { kind: 'damage', amount: Math.min(input.currentHp, Math.max(1, Math.floor(input.maximumHp / 10))) }
  return undefined
}

export function resolveHgssHeldEndTurn(input: { held: HgssHeldItemEffect, currentHp: number, maximumHp: number, poisonType: boolean, magicGuard: boolean, healBlocked: boolean }): { kind: 'heal' | 'damage' | 'badPoison' | 'burn', amount: number } | undefined {
  if ((input.held.effect === 69 || input.held.effect === 109 && input.poisonType) && !input.healBlocked && input.currentHp < input.maximumHp) return { kind: 'heal', amount: Math.min(input.maximumHp - input.currentHp, Math.max(1, Math.floor(input.maximumHp / 16))) }
  if (input.held.effect === 109 && !input.poisonType && !input.magicGuard) return { kind: 'damage', amount: Math.min(input.currentHp, Math.max(1, Math.floor(input.maximumHp / 8))) }
  if (input.held.effect === 116 && !input.magicGuard) return { kind: 'damage', amount: Math.min(input.currentHp, Math.max(1, Math.floor(input.maximumHp / Math.max(1, input.held.parameter)))) }
  if (input.held.effect === 100) return { kind: 'badPoison', amount: 0 }
  if (input.held.effect === 101) return { kind: 'burn', amount: 0 }
  return undefined
}
