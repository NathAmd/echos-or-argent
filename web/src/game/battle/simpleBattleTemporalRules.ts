import type { PokemonMoveData } from '../../rom/pokemon/moveData'

export type SimpleBattleLockKind = 'bide' | 'charge' | 'rollout' | 'rampage' | 'uproar'
export type SimpleBattleSemiInvulnerable = 'dig' | 'dive' | 'fly' | 'shadow'

export function resolveHgssChargeKind(
  effect: number,
  weather: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail',
): SimpleBattleSemiInvulnerable | 'charge' | 'solar' | 'skullBash' | undefined {
  if (effect === 256) return 'dig'
  if (effect === 255) return 'dive'
  if (effect === 155 || effect === 263) return 'fly'
  if (effect === 272) return 'shadow'
  if (effect === 39 || effect === 75) return 'charge'
  if (effect === 151 && weather !== 'sun') return 'solar'
  if (effect === 145) return 'skullBash'
  return undefined
}

export function canHgssMoveHitSemiInvulnerable(effect: number, state: SimpleBattleSemiInvulnerable): boolean {
  return state === 'dig' && (effect === 126 || effect === 147)
    || state === 'dive' && effect === 257
    || state === 'fly' && (effect === 146 || effect === 149 || effect === 152 || effect === 207)
}

export function resolveHgssContextualDamageMove(
  move: PokemonMoveData,
  input: {
    weather: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'
    rolloutCount: number
    defenseCurl: boolean
    targetMinimized: boolean
    targetSemiInvulnerable?: SimpleBattleSemiInvulnerable
    furyCutterCount?: number
    attackerDamagedThisTurn?: boolean
    targetActedThisTurn?: boolean
    targetDamagedThisTurn?: boolean
    targetSwitching?: boolean
  },
): PokemonMoveData {
  let power = move.power
  let type = move.type
  if (move.effect === 117) power *= 2 ** input.rolloutCount * (input.defenseCurl ? 2 : 1)
  if (move.effect === 119) power *= 2 ** Math.min(4, input.furyCutterCount ?? 0)
  if (move.effect === 185 && input.attackerDamagedThisTurn) power *= 2
  if (move.effect === 230 && input.targetActedThisTurn) power *= 2
  if (move.effect === 231 && input.targetDamagedThisTurn) power *= 2
  if (move.effect === 128 && input.targetSwitching) power *= 2
  if (move.effect === 150 && input.targetMinimized) power *= 2
  if (input.targetSemiInvulnerable && [126, 146, 147, 149, 257].includes(move.effect)) power *= 2
  if (move.effect === 151 && input.weather !== 'clear' && input.weather !== 'sun') power = Math.floor(power / 2)
  if (move.effect === 203 && input.weather !== 'clear') {
    power *= 2
    type = input.weather === 'rain' ? 11 : input.weather === 'sun' ? 10 : input.weather === 'sandstorm' ? 5 : 15
  }
  return power === move.power && type === move.type ? move : { ...move, power, type }
}

/** Puissance d'Atout selon les PP restants après consommation, table native Gen IV. */
export function resolveHgssTrumpCardPower(ppRemaining: number): number {
  return ppRemaining <= 0 ? 200 : ppRemaining === 1 ? 80 : ppRemaining === 2 ? 60 : ppRemaining === 3 ? 50 : 40
}

/** Les seize Plaques sont un bloc contigu du registre d'objets HGSS. */
export function resolveHgssPlateType(itemId: number): number | undefined {
  return [10, 11, 13, 12, 15, 1, 3, 4, 2, 14, 6, 5, 7, 16, 17, 8][itemId - 275]
}

export function resolveHgssMagnitudePower(roll: number): { level: number, power: number } {
  const normalized = ((roll % 100) + 100) % 100
  if (normalized < 5) return { level: 4, power: 10 }
  if (normalized < 15) return { level: 5, power: 30 }
  if (normalized < 35) return { level: 6, power: 50 }
  if (normalized < 65) return { level: 7, power: 70 }
  if (normalized < 85) return { level: 8, power: 90 }
  if (normalized < 95) return { level: 9, power: 110 }
  return { level: 10, power: 150 }
}

export function resolveHgssWeatherAccuracy(
  move: PokemonMoveData,
  weather: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail',
): PokemonMoveData | 'always-hit' {
  if (move.effect !== 152) return move
  if (weather === 'rain') return 'always-hit'
  return weather === 'sun' ? { ...move, accuracy: 50 } : move
}
