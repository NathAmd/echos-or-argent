import type { BattleStat } from './hgssBattleRules'

export type HgssConsumedItemEffect =
  | { kind: 'none' }
  | { kind: 'cure', status: 'paralysis' | 'sleep' | 'poison' | 'burn' | 'freeze' | 'confusion' | 'all' }
  | { kind: 'restorePp', amount: number }
  | { kind: 'heal', amount: number, confuse: boolean }
  | { kind: 'raiseStat', stat: BattleStat, change: 1 }
  | { kind: 'raiseRandomStat', change: 2 }
  | { kind: 'focusEnergy' }
  | { kind: 'nextMoveAccuracy' }
  | { kind: 'restoreLoweredStats' }
  | { kind: 'cureInfatuation' }
  | { kind: 'flinch' }
  | { kind: 'inflict', status: 'paralysis' | 'poison' | 'badPoison' | 'burn' }

/**
 * Décode les identifiants `pluckEffect` / `flingEffect` présents dans chaque
 * objet HGSS. La valeur `parameter` vient du même enregistrement ROM.
 */
export function resolveHgssConsumedItemEffect(
  effect: number,
  parameter: number,
  maxHp: number,
  nature: number,
): HgssConsumedItemEffect {
  const cure = ['paralysis', 'sleep', 'poison', 'burn', 'freeze'] as const
  if (effect >= 1 && effect <= 5) return { kind: 'cure', status: cure[effect - 1]! }
  if (effect === 6) return { kind: 'restorePp', amount: parameter }
  if (effect === 7) return { kind: 'heal', amount: parameter, confuse: false }
  if (effect === 8) return { kind: 'cure', status: 'confusion' }
  if (effect === 9) return { kind: 'cure', status: 'all' }
  if (effect === 10) return { kind: 'heal', amount: Math.max(1, Math.floor(maxHp * parameter / 100)), confuse: false }
  if (effect >= 11 && effect <= 15) {
    const flavor = effect - 11
    const dislikesFlavor = Math.floor(nature / 5) !== nature % 5 && nature % 5 === flavor
    return { kind: 'heal', amount: Math.max(1, Math.floor(maxHp / Math.max(1, parameter))), confuse: dislikesFlavor }
  }
  const raisedStats: readonly BattleStat[] = ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense']
  if (effect >= 16 && effect <= 20) return { kind: 'raiseStat', stat: raisedStats[effect - 16]!, change: 1 }
  if (effect === 21) return { kind: 'focusEnergy' }
  if (effect === 22) return { kind: 'raiseRandomStat', change: 2 }
  if (effect === 23) return { kind: 'nextMoveAccuracy' }
  if (effect === 24) return { kind: 'restoreLoweredStats' }
  if (effect === 25) return { kind: 'cureInfatuation' }
  if (effect === 26) return { kind: 'flinch' }
  if (effect >= 27 && effect <= 30) {
    const inflicted = ['paralysis', 'poison', 'badPoison', 'burn'] as const
    return { kind: 'inflict', status: inflicted[effect - 27]! }
  }
  return { kind: 'none' }
}
