import { isHgssAbilityStatReductionBlocked, type BattleStat } from './hgssBattleRules'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

export type HgssBattleWeather = 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'

export type HgssEntryHazard = {
  kind: 'spikes' | 'stealthRock'
  damage: number
}

export type HgssBattleForm = { form: number, types?: readonly [number, number] }
export type HgssEntryMove = { moveId: number, effect: number, power: number, typeMultiplier: number }

/** Formes recalculées par Battler_CheckWeatherFormChange dans l'overlay 12 HGSS. */
export function resolveHgssBattleForm(input: {
  speciesId: number
  abilityId: number
  weather: HgssBattleWeather
  heldItemEffect?: number
}): HgssBattleForm | undefined {
  if (input.speciesId === 351 && input.abilityId === 59) {
    if (input.weather === 'sun') return { form: 1, types: [10, 10] }
    if (input.weather === 'rain') return { form: 2, types: [11, 11] }
    if (input.weather === 'hail') return { form: 3, types: [15, 15] }
    return { form: 0, types: [0, 0] }
  }
  if (input.speciesId === 421) return { form: input.weather === 'sun' ? 1 : 0 }
  if (input.speciesId === 493 && input.abilityId === 121) {
    const type = [10, 11, 13, 12, 15, 1, 3, 4, 2, 14, 6, 5, 7, 16, 17, 8][(input.heldItemEffect ?? 0) - 126] ?? 0
    return { form: type, types: [type, type] }
  }
  return undefined
}

const anticipationExcludedEffects = new Set([41, 87, 88, 89, 144, 227])

export function doesHgssAnticipationTrigger(targetLevel: number, opponents: readonly { level: number, moves: readonly HgssEntryMove[] }[]): boolean {
  return opponents.some((opponent) => opponent.moves.some((move) => !anticipationExcludedEffects.has(move.effect)
    && (move.power > 0 && move.typeMultiplier > 10 || move.effect === 38 && targetLevel <= opponent.level && move.typeMultiplier > 0)))
}

/** Choix natif de Prédiction : puissance maximale, avec les valeurs virtuelles de l'overlay 12. */
export function resolveHgssForewarnMove(opponents: readonly { currentHp: number, moves: readonly { moveId: number, effect: number, power: number }[] }[], rng: HgssLcrng): number | undefined {
  let selected: number | undefined, selectedPower = 0
  for (const opponent of opponents) if (opponent.currentHp > 0) for (const move of opponent.moves) {
    if (move.moveId === 0) continue
    const power = move.power === 1 ? move.effect === 38 ? 150 : [89, 144, 227].includes(move.effect) ? 120 : 80 : move.power
    if (power > selectedPower || power === selectedPower && power > 0 && (rng.nextU16() & 1) !== 0) { selected = move.moveId; selectedPower = power }
  }
  if (selectedPower > 0) return selected
  const candidates = opponents.filter(({ currentHp, moves }) => currentHp > 0 && moves.some(({ moveId }) => moveId > 0))
  const opponent = candidates[rng.nextU16() % Math.max(1, candidates.length)]
  const moves = opponent?.moves.filter(({ moveId }) => moveId > 0) ?? []
  return moves[rng.nextU16() % Math.max(1, moves.length)]?.moveId
}

export function resolveHgssFriskItem(itemIds: readonly number[], rng: HgssLcrng): number | undefined {
  const held = itemIds.filter((itemId) => itemId > 0)
  return held.length <= 1 ? held[0] : held[rng.nextU16() & 1]
}

export function resolveHgssActiveAbilityId(
  abilityId: number,
  abilityOverrideId?: number,
  abilitySuppressed = false,
): number {
  return abilitySuppressed ? 0 : abilityOverrideId ?? abilityId
}

export function resetHgssBadPoisonCounter(status: number): number {
  return (status & ~0xf00) | ((status & 0x80) !== 0 ? 0x100 : 0)
}

export function resolveHgssEntryWeather(abilityId: number): Exclude<HgssBattleWeather, 'clear'> | undefined {
  if (abilityId === 2) return 'rain'
  if (abilityId === 45) return 'sandstorm'
  if (abilityId === 70) return 'sun'
  if (abilityId === 117) return 'hail'
  return undefined
}

export function isHgssGrounded(
  types: readonly [number, number],
  abilityId: number,
  gravity: boolean,
  ironBall = false,
): boolean {
  return gravity || ironBall || (!types.includes(2) && abilityId !== 26)
}

export function resolveHgssEntryHazards(input: {
  maxHp: number
  types: readonly [number, number]
  abilityId: number
  grounded: boolean
  spikesLayers: number
  stealthRock: boolean
  rockTypeMultiplier: number
}): HgssEntryHazard[] {
  if (input.abilityId === 98) return [] // Garde Magik bloque tous les dégâts indirects.
  const hazards: HgssEntryHazard[] = []
  if (input.grounded && input.spikesLayers > 0) {
    const divisor = input.spikesLayers === 1 ? 8 : input.spikesLayers === 2 ? 6 : 4
    hazards.push({ kind: 'spikes', damage: Math.max(1, Math.floor(input.maxHp / divisor)) })
  }
  if (input.stealthRock) {
    hazards.push({ kind: 'stealthRock', damage: Math.max(1, Math.floor(input.maxHp * input.rockTypeMultiplier / 80)) })
  }
  return hazards
}

export function resolveHgssToxicSpikes(input: {
  types: readonly [number, number]
  abilityId: number
  grounded: boolean
  layers: number
  currentStatus: number
  safeguarded: boolean
  weather?: HgssBattleWeather
}): 'absorb' | 'poison' | 'badPoison' | undefined {
  if (!input.grounded || input.layers <= 0) return undefined
  if (input.types.includes(3)) return 'absorb'
  if (input.types.includes(8) || input.abilityId === 17 || input.abilityId === 98 || input.abilityId === 102 && input.weather === 'sun' || input.currentStatus !== 0 || input.safeguarded) return undefined
  return input.layers >= 2 ? 'badPoison' : 'poison'
}

export function isHgssStatReductionBlocked(
  abilityId: number,
  stat: BattleStat,
  protectedByMist = false,
): boolean {
  return protectedByMist || isHgssAbilityStatReductionBlocked(abilityId, stat)
}

export function canHgssIntimidateTarget(input: {
  abilityId: number
  protectedByMist?: boolean
  substituteHp?: number
}): boolean {
  return (input.substituteHp ?? 0) <= 0 && !isHgssStatReductionBlocked(input.abilityId, 'attack', input.protectedByMist)
}

export function resolveHgssDownloadStat(
  opponents: readonly { defense: number, specialDefense: number, substituteHp?: number }[],
): Extract<BattleStat, 'attack' | 'specialAttack'> | undefined {
  const visible = opponents.filter(({ substituteHp = 0 }) => substituteHp <= 0)
  if (visible.length === 0) return undefined
  const defense = visible.reduce((sum, target) => sum + target.defense, 0)
  const specialDefense = visible.reduce((sum, target) => sum + target.specialDefense, 0)
  return defense >= specialDefense ? 'specialAttack' : 'attack'
}
