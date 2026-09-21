import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { PokemonStatValues } from '../pokemon/pokemonFormulas'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

export type BattleStat = 'attack' | 'defense' | 'speed' | 'specialAttack' | 'specialDefense' | 'accuracy' | 'evasion'
export type BattleStatStages = Record<BattleStat, number>

export function resolveHgssHiddenPower(individualValues: PokemonStatValues): { type: number, power: number } {
  const ordered = [
    individualValues.hp, individualValues.attack, individualValues.defense,
    individualValues.speed, individualValues.specialAttack, individualValues.specialDefense,
  ]
  const typeBits = ordered.reduce((value, iv, index) => value | (iv & 1) << index, 0)
  const powerBits = ordered.reduce((value, iv, index) => value | ((iv >>> 1) & 1) << index, 0)
  return { type: 1 + Math.floor(typeBits * 15 / 63), power: 30 + Math.floor(powerBits * 40 / 63) }
}

export const neutralBattleStatStages: BattleStatStages = {
  attack: 0,
  defense: 0,
  speed: 0,
  specialAttack: 0,
  specialDefense: 0,
  accuracy: 0,
  evasion: 0,
}

export const hgssPrimaryStatusMask = 0x7 | 0x8 | 0x10 | 0x20 | 0x40 | 0x80 | 0xf00

export type HgssAppliedStatus = 'sleep' | 'poison' | 'badPoison' | 'burn' | 'freeze' | 'paralysis'
export type HgssStatusContext = { weather?: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail', ignoreTargetAbility?: boolean }

// Valeurs de sTypeEffectiveness dans overlay 12. Une absence vaut ×1.
const typeEffectiveness = new Map<string, number>([
  ['0:5', 5], ['0:8', 5], ['0:7', 0],
  ['10:10', 5], ['10:11', 5], ['10:12', 20], ['10:15', 20], ['10:6', 20], ['10:5', 5], ['10:16', 5], ['10:8', 20],
  ['11:10', 20], ['11:11', 5], ['11:12', 5], ['11:4', 20], ['11:5', 20], ['11:16', 5],
  ['13:11', 20], ['13:13', 5], ['13:12', 5], ['13:4', 0], ['13:2', 20], ['13:16', 5],
  ['12:10', 5], ['12:11', 20], ['12:12', 5], ['12:3', 5], ['12:4', 20], ['12:2', 5], ['12:6', 5], ['12:5', 20], ['12:16', 5], ['12:8', 5],
  ['15:11', 5], ['15:12', 20], ['15:15', 5], ['15:4', 20], ['15:2', 20], ['15:16', 20], ['15:8', 5], ['15:10', 5],
  ['1:0', 20], ['1:15', 20], ['1:3', 5], ['1:2', 5], ['1:14', 5], ['1:6', 5], ['1:5', 20], ['1:17', 20], ['1:8', 20], ['1:7', 0],
  ['3:12', 20], ['3:3', 5], ['3:4', 5], ['3:5', 5], ['3:7', 5], ['3:8', 0],
  ['4:10', 20], ['4:13', 20], ['4:12', 5], ['4:3', 20], ['4:2', 0], ['4:6', 5], ['4:5', 20], ['4:8', 20],
  ['2:13', 5], ['2:12', 20], ['2:1', 20], ['2:6', 20], ['2:5', 5], ['2:8', 5],
  ['14:1', 20], ['14:3', 20], ['14:14', 5], ['14:17', 0], ['14:8', 5],
  ['6:10', 5], ['6:12', 20], ['6:1', 5], ['6:3', 5], ['6:2', 5], ['6:14', 20], ['6:7', 5], ['6:17', 20], ['6:8', 5],
  ['5:10', 20], ['5:15', 20], ['5:1', 5], ['5:4', 5], ['5:2', 20], ['5:6', 20], ['5:8', 5],
  ['7:0', 0], ['7:14', 20], ['7:17', 5], ['7:8', 5], ['7:7', 20],
  ['16:16', 20], ['16:8', 5],
  ['17:1', 5], ['17:14', 20], ['17:7', 20], ['17:17', 5], ['17:8', 5],
  ['8:10', 5], ['8:11', 5], ['8:13', 5], ['8:15', 20], ['8:5', 20], ['8:8', 5],
])

function clampStage(stage: number): number {
  return Math.max(-6, Math.min(6, Math.trunc(stage)))
}

export function applyHgssStatStage(stat: number, stage: number): number {
  const normalized = clampStage(stage)
  return normalized >= 0
    ? Math.floor(stat * (2 + normalized) / 2)
    : Math.floor(stat * 2 / (2 - normalized))
}

export function calculateHgssTypeMultiplier(
  moveType: number,
  targetTypes: readonly [number, number],
  ignoreFlyingGroundImmunity = false,
  identifyGhost = false,
  identifyDark = false,
): number {
  let multiplier = 10
  const distinctTypes = targetTypes[0] === targetTypes[1] ? [targetTypes[0]] : targetTypes
  for (const targetType of distinctTypes) {
    const effectiveness = identifyGhost && targetType === 7 && (moveType === 0 || moveType === 1)
      || identifyDark && targetType === 17 && moveType === 14
      ? 10
      : ignoreFlyingGroundImmunity && moveType === 4 && targetType === 2
      ? 10
      : typeEffectiveness.get(`${moveType}:${targetType}`) ?? 10
    multiplier = Math.floor(multiplier * effectiveness / 10)
  }
  return multiplier
}

export type HgssDamageInput = {
  attacker: CanonicalPokemon
  defender: CanonicalPokemon
  attackerTypes: readonly [number, number]
  defenderTypes: readonly [number, number]
  attackerStages: BattleStatStages
  defenderStages: BattleStatStages
  move: PokemonMoveData
  rng: HgssLcrng
  criticalMultiplier?: 1 | 2 | 3
  ignoreGroundImmunity?: boolean
  grantGroundImmunity?: boolean
  identifyGhost?: boolean
  identifyDark?: boolean
  defenderWeightTenthsKg?: number
  weather?: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'
  attackerPlusMinusPartner?: boolean
  attackerFlowerGiftActive?: boolean
  defenderFlowerGiftActive?: boolean
  attackerTurnsActive?: number
}

export function resolveHgssMovePower(input: HgssDamageInput): number {
  const { move, attacker, defender } = input
  if (move.effect === 99) { // Fléau / Contre
    const ratio = Math.floor(attacker.currentHp * 48 / Math.max(1, attacker.stats.hp))
    if (ratio <= 1) return 200
    if (ratio <= 4) return 150
    if (ratio <= 9) return 100
    if (ratio <= 16) return 80
    if (ratio <= 32) return 40
    return 20
  }
  if (move.effect === 121) return Math.max(1, Math.floor(attacker.friendship * 10 / 25)) // Retour
  if (move.effect === 123) return Math.max(1, Math.floor((255 - attacker.friendship) * 10 / 25)) // Frustration
  if (move.effect === 169 && (attacker.status & hgssPrimaryStatusMask) !== 0) return move.power * 2 // Façade
  if (move.effect === 190) return Math.max(1, Math.floor(move.power * attacker.currentHp / Math.max(1, attacker.stats.hp)))
  if (move.effect === 196 && input.defenderWeightTenthsKg !== undefined) {
    const weight = input.defenderWeightTenthsKg
    return weight < 100 ? 20 : weight < 250 ? 40 : weight < 500 ? 60 : weight < 1000 ? 80 : weight < 2000 ? 100 : 120
  }
  if (move.effect === 217 && (defender.status & 0x7) !== 0) return move.power * 2
  if (move.effect === 219) {
    const attackerSpeed = Math.max(1, applyHgssStatStage(attacker.stats.speed, input.attackerStages.speed))
    const defenderSpeed = Math.max(1, applyHgssStatStage(defender.stats.speed, input.defenderStages.speed))
    return Math.min(150, Math.max(1, Math.floor(25 * defenderSpeed / attackerSpeed)))
  }
  if (move.effect === 221 && defender.currentHp * 2 <= defender.stats.hp) return move.power * 2
  if (move.effect === 237) return Math.max(1, Math.floor(120 * defender.currentHp / Math.max(1, defender.stats.hp)) + 1)
  if (move.effect === 245) {
    const positiveStages = Object.values(input.defenderStages).reduce((sum, stage) => sum + Math.max(0, stage), 0)
    return Math.min(200, 60 + positiveStages * 20)
  }
  return move.power
}

export function calculateHgssMoveDamage(input: HgssDamageInput): { damage: number, typeMultiplier: number } {
  const { move } = input
  if (move.power === 0 || move.category === 2) return { damage: 0, typeMultiplier: 10 }
  const physical = move.category === 0
  const criticalMultiplier = input.criticalMultiplier ?? 1
  const ignoresDefenderAbility = input.attacker.abilityId === 104 // Brise Moule
  const moveType = input.attacker.abilityId === 96 && move.moveId !== 165 ? 0 : move.type // Normalise, hors Lutte
  let movePower = resolveHgssMovePower(input)
  if (input.attacker.abilityId === 101 && move.moveId !== 165 && movePower <= 60) movePower = Math.floor(movePower * 15 / 10) // Technicien, hors Lutte
  const pinchType = input.attacker.abilityId === 65 ? 12 : input.attacker.abilityId === 66 ? 10 : input.attacker.abilityId === 67 ? 11 : input.attacker.abilityId === 68 ? 6 : -1
  if (moveType === pinchType && input.attacker.currentHp <= Math.floor(input.attacker.stats.hp / 3)) movePower = Math.floor(movePower * 15 / 10)
  if (!ignoresDefenderAbility && input.defender.abilityId === 47 && (moveType === 10 || moveType === 15)) movePower = Math.floor(movePower / 2) // Isograisse
  if (!ignoresDefenderAbility && input.defender.abilityId === 85 && moveType === 10) movePower = Math.floor(movePower / 2) // Ignifuge
  if (!ignoresDefenderAbility && input.defender.abilityId === 87 && moveType === 10) movePower = Math.floor(movePower * 125 / 100) // Peau Sèche
  if (input.attacker.abilityId === 79 && input.attacker.gender !== 'genderless' && input.defender.gender !== 'genderless') movePower = Math.floor(movePower * (input.attacker.gender === input.defender.gender ? 125 : 75) / 100) // Rivalité
  if (input.attacker.abilityId === 89 && [8, 7, 9, 183, 264, 146, 223, 359, 5, 4, 309, 325, 409, 418, 327].includes(move.moveId)) movePower = Math.floor(movePower * 12 / 10) // Poing de Fer, table sPunchingMoves
  if (input.attacker.abilityId === 120 && [45, 48, 198, 253, 262, 269].includes(move.effect)) movePower = Math.floor(movePower * 12 / 10) // Téméraire
  const simpleStage = (stage: number, simple: boolean) => simple ? Math.max(-6, Math.min(6, stage * 2)) : stage
  const attackStage = !ignoresDefenderAbility && input.defender.abilityId === 109 ? 0 : simpleStage(physical ? input.attackerStages.attack : input.attackerStages.specialAttack, input.attacker.abilityId === 86)
  const defenseStage = input.attacker.abilityId === 109 ? 0 : simpleStage(physical ? input.defenderStages.defense : input.defenderStages.specialDefense, !ignoresDefenderAbility && input.defender.abilityId === 86)
  let attack = applyHgssStatStage(
    physical ? input.attacker.stats.attack : input.attacker.stats.specialAttack,
    criticalMultiplier > 1 && attackStage < 0 ? 0 : attackStage,
  )
  const defense = Math.max(1, applyHgssStatStage(
    physical ? input.defender.stats.defense : input.defender.stats.specialDefense,
    criticalMultiplier > 1 && defenseStage > 0 ? 0 : defenseStage,
  ))
  if (physical && (input.attacker.abilityId === 37 || input.attacker.abilityId === 74)) attack *= 2
  if (physical && input.attacker.abilityId === 112 && (input.attackerTurnsActive ?? 5) < 5) attack = Math.floor(attack / 2)
  if (physical && input.attacker.abilityId === 55) attack = Math.floor(attack * 15 / 10)
  if (!physical && input.attackerPlusMinusPartner && (input.attacker.abilityId === 57 || input.attacker.abilityId === 58)) attack = Math.floor(attack * 15 / 10)
  if (!physical && input.weather === 'sun' && input.attacker.abilityId === 94) attack = Math.floor(attack * 15 / 10)
  if (physical && input.weather === 'sun' && input.attackerFlowerGiftActive) attack = Math.floor(attack * 15 / 10)
  let effectiveDefense = move.effect === 7 ? Math.max(1, Math.floor(defense / 2)) : defense
  if (physical && !ignoresDefenderAbility && input.defender.abilityId === 63 && (input.defender.status & hgssPrimaryStatusMask) !== 0) effectiveDefense = Math.floor(effectiveDefense * 15 / 10)
  if (!physical && input.weather === 'sandstorm' && input.defenderTypes.includes(5)) effectiveDefense = Math.floor(effectiveDefense * 15 / 10)
  if (!physical && input.weather === 'sun' && !ignoresDefenderAbility && input.defenderFlowerGiftActive) effectiveDefense = Math.floor(effectiveDefense * 15 / 10)
  // overlay 12 : Cran multiplie l'Attaque par 1,5 sous statut ; sinon la brûlure la divise par deux.
  if (physical && input.attacker.abilityId === 62 && (input.attacker.status & hgssPrimaryStatusMask) !== 0) attack = Math.floor(attack * 15 / 10)
  else if (physical && (input.attacker.status & 0x10) !== 0) attack = Math.floor(attack / 2)
  let damage = Math.floor(input.attacker.level * 2 / 5) + 2
  damage = Math.floor(damage * movePower * attack / effectiveDefense)
  damage = Math.floor(damage / 50) + 2
  damage *= criticalMultiplier
  // BtlCmd_CalcDamage applique la plage avant ov12_02251D28 (STAB/types).
  if (damage > 0) damage = Math.max(1, Math.floor(damage * (100 - (input.rng.nextU16() % 16)) / 100))
  if (input.attackerTypes.includes(moveType)) damage = Math.floor(damage * (input.attacker.abilityId === 91 ? 20 : 15) / 10)
  let typeMultiplier = moveType === 4 && (input.grantGroundImmunity
    || (!input.ignoreGroundImmunity && !ignoresDefenderAbility && input.defender.abilityId === 26))
    ? 0 // Lévitation, sauf si l'appelant impose le sol via Gravité ou la Balle Fer.
    : calculateHgssTypeMultiplier(moveType, input.defenderTypes, input.ignoreGroundImmunity, input.identifyGhost || input.attacker.abilityId === 113, input.identifyDark)
  if (!ignoresDefenderAbility && input.defender.abilityId === 25 && typeMultiplier <= 10) typeMultiplier = 0 // Garde Mystik
  damage = Math.floor(damage * typeMultiplier / 10)
  if (input.attacker.abilityId === 110 && typeMultiplier > 0 && typeMultiplier < 10) damage *= 2 // Lentiteintée
  if (!ignoresDefenderAbility && (input.defender.abilityId === 111 || input.defender.abilityId === 116) && typeMultiplier > 10) damage = Math.floor(damage * 3 / 4)
  return { damage, typeMultiplier }
}

export function doesHgssMoveHit(
  move: PokemonMoveData,
  attackerStages: BattleStatStages,
  defenderStages: BattleStatStages,
  rng: HgssLcrng,
  context: { attackerAbilityId?: number, targetAbilityId?: number, weather?: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail', targetConfused?: boolean } = {},
): boolean {
  if (move.accuracy === 0) return true
  const stage = clampStage(attackerStages.accuracy - defenderStages.evasion)
  const numerator = stage >= 0 ? 3 + stage : 3
  const denominator = stage >= 0 ? 3 : 3 - stage
  let accuracy = Math.floor(move.accuracy * numerator / denominator)
  if (context.attackerAbilityId === 14) accuracy = Math.floor(accuracy * 13 / 10)
  if (context.attackerAbilityId === 55 && move.category === 0) accuracy = Math.floor(accuracy * 8 / 10)
  if (context.targetAbilityId === 8 && context.weather === 'sandstorm' || context.targetAbilityId === 81 && context.weather === 'hail') accuracy = Math.floor(accuracy * 8 / 10)
  if (context.targetAbilityId === 77 && context.targetConfused) accuracy = Math.floor(accuracy / 2)
  return rng.nextU16() % 100 < accuracy
}

export function canHgssPokemonFlinch(abilityId: number): boolean { return abilityId !== 39 }

export function doesHgssSecondaryEffectOccur(chance: number, rng: HgssLcrng, attackerAbilityId = 0, targetAbilityId = 0): boolean {
  if (targetAbilityId === 19) return false // Écran Poudre
  const effectiveChance = attackerAbilityId === 32 ? Math.min(100, chance * 2) : chance // Sérénité
  return effectiveChance === 0 || rng.nextU16() % 100 < effectiveChance
}

export function applyHgssSteadfast(stages: BattleStatStages, abilityId: number): boolean {
  if (abilityId !== 80 || stages.speed >= 6) return false
  stages.speed += 1
  return true
}

export type HgssMoveOrderCombatant = {
  pokemon: CanonicalPokemon
  stages: BattleStatStages
  move: PokemonMoveData
  abilityId?: number
  weather?: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'
  weatherSuppressed?: boolean
  turnsActive?: number
  canUnburden?: boolean
  heldItemEffect?: number
  heldItemParameter?: number
  priorityItemRoll?: number
  speedMultiplier?: number
}

/** Reproduit CheckSortSpeed de l'overlay 12 pour une seule combattante. */
export function calculateHgssEffectiveSpeed(input: HgssMoveOrderCombatant): number {
  const { pokemon, stages } = input
  const abilityId = input.abilityId ?? pokemon.abilityId
  const speedStage = abilityId === 86 ? clampStage(stages.speed * 2) : stages.speed // Simple
  let speed = applyHgssStatStage(pokemon.stats.speed, speedStage)
  if (!input.weatherSuppressed && (abilityId === 33 && input.weather === 'rain' || abilityId === 34 && input.weather === 'sun')) speed *= 2
  if ([50, 106, 117, 118, 119, 120, 121, 122].includes(input.heldItemEffect ?? 0)) speed = Math.floor(speed / 2)
  if (input.heldItemEffect === 115) speed = Math.floor(speed * 15 / 10)
  if (input.heldItemEffect === 102 && pokemon.speciesId === 132) speed *= 2
  if (abilityId === 95 && (pokemon.status & 0xff) !== 0) speed = Math.floor(speed * 15 / 10)
  else if ((pokemon.status & 0x40) !== 0) speed = Math.floor(speed / 4)
  if (abilityId === 112 && (input.turnsActive ?? 5) < 5) speed = Math.floor(speed / 2)
  if (abilityId === 84 && input.canUnburden && pokemon.heldItemId === 0) speed *= 2
  return Math.max(1, Math.floor(speed * (input.speedMultiplier ?? 1)))
}

export function compareHgssMoveOrder(
  first: HgssMoveOrderCombatant,
  second: HgssMoveOrderCombatant,
  rng: HgssLcrng,
  reverseSpeed = false,
): -1 | 1 {
  if (first.move.priority !== second.move.priority) return first.move.priority > second.move.priority ? -1 : 1
  const firstBoosted = isHgssPriorityItemActive(first)
  const secondBoosted = isHgssPriorityItemActive(second)
  if (firstBoosted !== secondBoosted) return firstBoosted ? -1 : 1
  const firstSpeed = calculateHgssEffectiveSpeed(first)
  const secondSpeed = calculateHgssEffectiveSpeed(second)
  if (firstBoosted && secondBoosted) {
    if (firstSpeed !== secondSpeed) return firstSpeed > secondSpeed ? -1 : 1
    return rng.nextU16() % 2 === 0 ? -1 : 1
  }
  const firstMovesLast = first.heldItemEffect === 107
  const secondMovesLast = second.heldItemEffect === 107
  if (firstMovesLast !== secondMovesLast) return firstMovesLast ? 1 : -1
  const firstStalls = (first.abilityId ?? first.pokemon.abilityId) === 100
  const secondStalls = (second.abilityId ?? second.pokemon.abilityId) === 100
  if (firstStalls !== secondStalls) return firstStalls ? 1 : -1
  const speedIsReversed = firstMovesLast && secondMovesLast || firstStalls && secondStalls || reverseSpeed
  if (firstSpeed !== secondSpeed) return firstSpeed > secondSpeed
    ? speedIsReversed ? 1 : -1
    : speedIsReversed ? -1 : 1
  return rng.nextU16() % 2 === 0 ? -1 : 1
}

export function isHgssPriorityItemActive(input: HgssMoveOrderCombatant): boolean {
  if (input.heldItemEffect === 52) {
    const chance = input.heldItemParameter ?? 0
    return chance > 0 && (input.priorityItemRoll ?? -1) % Math.floor(100 / chance) === 0
  }
  if (input.heldItemEffect !== 45) return false
  let divisor = input.heldItemParameter ?? 0
  if ((input.abilityId ?? input.pokemon.abilityId) === 82) divisor = Math.floor(divisor / 2)
  return divisor > 0 && input.pokemon.currentHp <= Math.floor(input.pokemon.stats.hp / divisor)
}

export function applySupportedHgssStatusMoveEffect(
  move: PokemonMoveData,
  attackerStages: BattleStatStages,
  defenderStages: BattleStatStages,
  rng?: HgssLcrng,
  attackerAbilityId = 0,
  targetAbilityId = 0,
): { stat: BattleStat, change: number, applied: boolean } | undefined {
  const stats: BattleStat[] = ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense', 'accuracy', 'evasion']
  let stat: BattleStat | undefined
  let change = 0
  let stages = defenderStages
  if (move.effect >= 10 && move.effect <= 16) { stat = stats[move.effect - 10]; change = 1; stages = attackerStages }
  else if (move.effect >= 18 && move.effect <= 24) { stat = stats[move.effect - 18]; change = -1 }
  else if (move.effect >= 50 && move.effect <= 56) { stat = stats[move.effect - 50]; change = 2; stages = attackerStages }
  else if (move.effect >= 58 && move.effect <= 64) { stat = stats[[0, 1, 2, 3, 5, 6, 4][move.effect - 58]!]; change = -2 }
  else if (move.effect >= 68 && move.effect <= 74) {
    if (rng && !doesHgssSecondaryEffectOccur(move.effectChance, rng, attackerAbilityId, targetAbilityId)) return undefined
    stat = stats[move.effect - 68]
    change = -1
  }
  if (!stat) return undefined
  const before = stages[stat]
  if (change < 0 && isHgssAbilityStatReductionBlocked(targetAbilityId, stat)) return { stat, change, applied: false }
  stages[stat] = clampStage(before + change)
  return { stat, change, applied: stages[stat] !== before }
}

export function isHgssAbilityStatReductionBlocked(abilityId: number, stat: BattleStat): boolean {
  return abilityId === 29 || abilityId === 73 || stat === 'attack' && abilityId === 52 || stat === 'accuracy' && abilityId === 51
}

export function primaryStatusForMoveEffect(effect: number): HgssAppliedStatus | undefined {
  if (effect === 1) return 'sleep'
  if (effect === 2 || effect === 66) return 'poison'
  if (effect === 4 || effect === 167) return 'burn'
  if (effect === 5) return 'freeze'
  if (effect === 6 || effect === 67) return 'paralysis'
  if (effect === 33) return 'badPoison'
  return undefined
}

export function applyHgssPrimaryStatus(
  status: HgssAppliedStatus,
  target: CanonicalPokemon,
  targetTypes: readonly [number, number],
  rng: HgssLcrng,
  effectiveAbilityId = target.abilityId,
  context: HgssStatusContext = {},
): { status: HgssAppliedStatus, applied: boolean } {
  if (context.ignoreTargetAbility) effectiveAbilityId = 0
  const blockedByExisting = (target.status & hgssPrimaryStatusMask) !== 0
  const blockedByType = (status === 'poison' || status === 'badPoison') && (targetTypes.includes(3) || targetTypes.includes(8))
    || status === 'burn' && targetTypes.includes(10)
    || status === 'freeze' && targetTypes.includes(15)
  const blockedByAbility = (status === 'sleep' && (effectiveAbilityId === 15 || effectiveAbilityId === 72))
    || ((status === 'poison' || status === 'badPoison') && effectiveAbilityId === 17)
    || (status === 'burn' && effectiveAbilityId === 41)
    || (status === 'freeze' && effectiveAbilityId === 40)
    || (status === 'paralysis' && effectiveAbilityId === 7)
    || (effectiveAbilityId === 102 && context.weather === 'sun')
  if (blockedByExisting || blockedByType || blockedByAbility) return { status, applied: false }
  if (status === 'sleep') target.status = 2 + rng.nextU16() % 4
  else if (status === 'poison') target.status = 0x8
  else if (status === 'badPoison') target.status = 0x80 | 0x100
  else if (status === 'burn') target.status = 0x10
  else if (status === 'freeze') target.status = 0x20
  else target.status = 0x40
  return { status, applied: true }
}

export function applySupportedHgssPrimaryStatus(
  move: PokemonMoveData,
  target: CanonicalPokemon,
  targetTypes: readonly [number, number],
  rng: HgssLcrng,
  effectiveAbilityId = target.abilityId,
  attackerAbilityId = 0,
  context: HgssStatusContext = {},
): { status: HgssAppliedStatus, applied: boolean } | undefined {
  const status = primaryStatusForMoveEffect(move.effect)
  if (!status) return undefined
  const damagingSecondary = [2, 4, 5, 6].includes(move.effect)
  if (damagingSecondary && !doesHgssSecondaryEffectOccur(move.effectChance, rng, attackerAbilityId, effectiveAbilityId)) return undefined
  return applyHgssPrimaryStatus(status, target, targetTypes, rng, effectiveAbilityId, { ...context, ignoreTargetAbility: context.ignoreTargetAbility || attackerAbilityId === 104 })
}
