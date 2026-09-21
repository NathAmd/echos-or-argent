import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import { applyHgssPrimaryStatus, type HgssAppliedStatus } from './hgssBattleRules'
import type { DoubleBattleEvent, DoubleBattleParticipant, DoubleBattlePosition } from './doubleBattleSession'
import type { SimpleBattleEvent, SimpleBattleSide, SimpleBattleSideState } from './simpleBattleSession'
import { canHgssInfatuate, resolveHgssSynchronizeStatusChain } from './hgssAbilityMoveRules'

export type HgssPostHitAbilityEffect =
  | { kind: 'damageAttacker', abilityId: 24 | 106, divisor: 8 | 4 }
  | { kind: 'statusAttacker', abilityId: 9 | 27 | 38 | 49, status: HgssAppliedStatus }
  | { kind: 'infatuateAttacker', abilityId: 56 }
  | { kind: 'changeDefenderType', abilityId: 16, type: number }
  | { kind: 'maximizeDefenderAttack', abilityId: 83 }

export type HgssPostHitAbilityInput = {
  attacker: CanonicalPokemon
  defender: CanonicalPokemon
  attackerAbilityId: number
  defenderAbilityId: number
  defenderTypes: readonly [number, number]
  defenderAttackStage: number
  move: PokemonMoveData
  moveType: number
  dealtDamage: number
  substituteWasHit: boolean
  critical: boolean
  attackerInfatuated: boolean
  dampActive: boolean
  weather: 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'
}

/** Fidèle à CheckAbilityEffectOnHit et au sous-script critique de l'overlay 12. */
export function resolveHgssPostHitAbilityEffects(input: HgssPostHitAbilityInput, rng: HgssLcrng): HgssPostHitAbilityEffect[] {
  if (input.dealtDamage <= 0 || input.substituteWasHit) return []
  const effects: HgssPostHitAbilityEffect[] = []
  if (input.critical && input.defender.currentHp > 0 && input.defenderAbilityId === 83 && input.defenderAttackStage < 6) effects.push({ kind: 'maximizeDefenderAttack', abilityId: 83 })
  if (input.attackerAbilityId === 104 || input.move.effect === 228) return effects // Brise Moule / Demi-Tour neutralisent cette vérification native.
  const abilityId = input.defenderAbilityId
  const contact = (input.move.flags & 1) !== 0
  if (abilityId === 16 && input.defender.currentHp > 0 && input.move.moveId !== 165 && input.move.power > 0 && !input.defenderTypes.includes(input.moveType)) {
    effects.push({ kind: 'changeDefenderType', abilityId: 16, type: input.moveType })
  } else if (abilityId === 24 && contact && input.attacker.currentHp > 0 && input.attackerAbilityId !== 98) {
    effects.push({ kind: 'damageAttacker', abilityId: 24, divisor: 8 })
  } else if (abilityId === 106 && contact && input.defender.currentHp === 0 && input.attacker.currentHp > 0 && input.attackerAbilityId !== 98 && !input.dampActive) {
    effects.push({ kind: 'damageAttacker', abilityId: 106, divisor: 4 })
  } else if (contact && input.attacker.currentHp > 0 && input.attacker.status === 0 && [9, 27, 38, 49].includes(abilityId) && rng.nextU16() % 10 < 3) {
    const status = abilityId === 9 ? 'paralysis' : abilityId === 38 ? 'poison' : abilityId === 49 ? 'burn'
      : (['poison', 'paralysis', 'sleep'] as const)[rng.nextU16() % 3]!
    effects.push({ kind: 'statusAttacker', abilityId: abilityId as 9 | 27 | 38 | 49, status })
  } else if (abilityId === 56 && contact && input.defender.currentHp > 0 && input.attacker.currentHp > 0 && !input.attackerInfatuated
    && input.attackerAbilityId !== 12 && input.attacker.gender !== 'genderless' && input.defender.gender !== 'genderless'
    && input.attacker.gender !== input.defender.gender && rng.nextU16() % 10 < 3) effects.push({ kind: 'infatuateAttacker', abilityId: 56 })
  return effects
}

type AdapterInput<T> = HgssPostHitAbilityInput & {
  attackerState: T
  defenderState: T
  attackerSafeguarded: boolean
  attackerHeldEffect: number
}

function applyStatus<T extends { types: readonly [number, number] }>(input: AdapterInput<T>, status: HgssAppliedStatus, rng: HgssLcrng) {
  const inflicted = input.attackerSafeguarded
    ? { status, applied: false }
    : applyHgssPrimaryStatus(status, input.attacker, input.attackerState.types, rng, input.attackerAbilityId, { weather: input.weather })
  return resolveHgssSynchronizeStatusChain(inflicted, input.attackerAbilityId, input.defender, input.defenderState.types, input.defenderAbilityId, rng, { weather: input.weather })
}

export function applySimpleBattlePostHitAbilities(input: AdapterInput<SimpleBattleSideState> & { attackerSide: SimpleBattleSide, defenderSide: SimpleBattleSide }, rng: HgssLcrng, events: SimpleBattleEvent[]): void {
  for (const effect of resolveHgssPostHitAbilityEffects(input, rng)) {
    if (effect.kind === 'damageAttacker') {
      const damage = Math.min(input.attacker.currentHp, Math.max(1, Math.floor(input.attacker.stats.hp / effect.divisor)))
      input.attacker.currentHp -= damage
      events.push({ kind: 'condition', side: input.attackerSide, condition: `ability:${effect.abilityId}`, applied: true }, { kind: 'damage', side: input.attackerSide, damage, critical: false, typeMultiplier: 10 })
      if (input.attacker.currentHp === 0) events.push({ kind: 'faint', side: input.attackerSide, pokemonName: input.attacker.nickname ?? input.attacker.speciesName, defeated: cloneCanonicalPokemon(input.attacker) })
    } else if (effect.kind === 'statusAttacker') for (const status of applyStatus(input, effect.status, rng)) events.push({ kind: 'status', side: status.recipient === 'source' ? input.defenderSide : input.attackerSide, pokemonName: status.recipient === 'source' ? input.defender.nickname ?? input.defender.speciesName : input.attacker.nickname ?? input.attacker.speciesName, status: status.status, applied: status.applied })
    else if (effect.kind === 'infatuateAttacker') { input.attackerState.volatile.infatuated = true; events.push({ kind: 'condition', side: input.attackerSide, condition: `ability:${effect.abilityId}`, applied: true }); if (input.attackerHeldEffect === 108 && canHgssInfatuate(input.defenderAbilityId)) { input.defenderState.volatile.infatuated = true; events.push({ kind: 'condition', side: input.defenderSide, condition: 'item:108', applied: true }) } }
    else if (effect.kind === 'changeDefenderType') { input.defenderState.types = [effect.type, effect.type]; events.push({ kind: 'condition', side: input.defenderSide, condition: `type:${effect.type}`, applied: true }) }
    else { const change = 6 - input.defenderState.stages.attack; input.defenderState.stages.attack = 6; events.push({ kind: 'stat', side: input.defenderSide, pokemonName: input.defender.nickname ?? input.defender.speciesName, stat: 'attack', change, applied: change > 0 }) }
  }
}

export function applyDoubleBattlePostHitAbilities(input: AdapterInput<DoubleBattleParticipant> & { attackerPosition: DoubleBattlePosition, defenderPosition: DoubleBattlePosition }, rng: HgssLcrng, events: DoubleBattleEvent[]): void {
  for (const effect of resolveHgssPostHitAbilityEffects(input, rng)) {
    if (effect.kind === 'damageAttacker') {
      const damage = Math.min(input.attacker.currentHp, Math.max(1, Math.floor(input.attacker.stats.hp / effect.divisor)))
      input.attacker.currentHp -= damage
      events.push({ kind: 'condition', target: input.attackerPosition, condition: `ability:${effect.abilityId}`, applied: true }, { kind: 'damage', target: input.attackerPosition, damage, critical: false, typeMultiplier: 10 })
      if (input.attacker.currentHp === 0) events.push({ kind: 'faint', target: input.attackerPosition, pokemonName: input.attacker.nickname ?? input.attacker.speciesName, defeated: cloneCanonicalPokemon(input.attacker) })
    } else if (effect.kind === 'statusAttacker') for (const status of applyStatus(input, effect.status, rng)) events.push({ kind: 'status', target: status.recipient === 'source' ? input.defenderPosition : input.attackerPosition, pokemonName: status.recipient === 'source' ? input.defender.nickname ?? input.defender.speciesName : input.attacker.nickname ?? input.attacker.speciesName, status: status.status, applied: status.applied })
    else if (effect.kind === 'infatuateAttacker') { input.attackerState.volatile.infatuated = true; events.push({ kind: 'condition', target: input.attackerPosition, condition: `ability:${effect.abilityId}`, applied: true }); if (input.attackerHeldEffect === 108 && canHgssInfatuate(input.defenderAbilityId)) { input.defenderState.volatile.infatuated = true; events.push({ kind: 'condition', target: input.defenderPosition, condition: 'item:108', applied: true }) } }
    else if (effect.kind === 'changeDefenderType') { input.defenderState.types = [effect.type, effect.type]; events.push({ kind: 'condition', target: input.defenderPosition, condition: `type:${effect.type}`, applied: true }) }
    else { const change = 6 - input.defenderState.stages.attack; input.defenderState.stages.attack = 6; events.push({ kind: 'stat', target: input.defenderPosition, pokemonName: input.defender.nickname ?? input.defender.speciesName, stat: 'attack', change, applied: change > 0 }) }
  }
}
