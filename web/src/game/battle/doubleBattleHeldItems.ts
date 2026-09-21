import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { cloneCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { applyHgssPrimaryStatus } from './hgssBattleRules'
import { applyDoubleConsumedItemEffect } from './doubleBattleItems'
import { isDoubleBattleWeatherSuppressed } from './doubleBattleMoveOrder'
import type { DoubleBattleEvent, DoubleBattleParticipant, DoubleBattlePosition, DoubleBattleSession } from './doubleBattleSession'
import { isHgssHeldSurvivalActive, isHgssResistBerryActive, resolveHgssHeldAutoUse, resolveHgssHeldEndTurn, resolveHgssHeldItemEffect, resolveHgssHeldOnHit, resolveHgssHeldPostDamage, type HgssHeldItemEffect } from './hgssHeldItemRules'
import { requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function pokemon(participant: DoubleBattleParticipant) {
  const active = participant.party[participant.activePartyIndex]
  if (!active) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return active
}

export function getDoubleBattleHeldItemEffect(session: DoubleBattleSession, participant: DoubleBattleParticipant): HgssHeldItemEffect {
  const active = pokemon(participant), item = session.itemCatalog?.items[active.heldItemId]
  const abilityId = participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? active.abilityId
  return resolveHgssHeldItemEffect({ holdEffect: item?.holdEffect, holdEffectParameter: item?.holdEffectParameter, abilityId, embargoTurns: participant.volatile.embargoTurns })
}

function consume(participant: DoubleBattleParticipant): void {
  const active = pokemon(participant)
  if (active.heldItemId !== 0) { participant.volatile.recyclableItemId = active.heldItemId; participant.volatile.canUnburden = true }
  active.heldItemId = 0
}

export function applyDoubleBattleAutoHeldItem(session: DoubleBattleSession, position: DoubleBattlePosition, rng: HgssLcrng, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position), active = pokemon(participant), held = getDoubleBattleHeldItemEffect(session, participant)
  const abilityId = participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? active.abilityId
  const use = resolveHgssHeldAutoUse({ held, abilityId, currentHp: active.currentHp, maximumHp: active.stats.hp, status: active.status, confusion: participant.volatile.confusionTurns > 0, infatuated: participant.volatile.infatuated, stages: participant.stages, hasEmptyPp: active.moves.some(({ moveId, pp }) => moveId > 0 && pp === 0) })
  if (!use) return
  consume(participant)
  applyDoubleConsumedItemEffect(session, position, use.consumedEffect, use.parameter, rng, events)
}

export function applyDoubleBattleIncomingHeldItem(session: DoubleBattleSession, position: DoubleBattlePosition, damage: number, moveType: number, typeMultiplier: number, firstHit: boolean, rng: HgssLcrng, events: DoubleBattleEvent[]): number {
  const participant = requireDoubleBattleParticipantAt(session, position), active = pokemon(participant)
  let held = getDoubleBattleHeldItemEffect(session, participant), resolved = damage
  if (firstHit && isHgssResistBerryActive(held, moveType, typeMultiplier)) { resolved = Math.floor(resolved / 2); consume(participant); events.push({ kind: 'condition', target: position, condition: 'resistBerry', applied: true }); held = { effect: 0, parameter: 0 } }
  if (resolved >= active.currentHp && isHgssHeldSurvivalActive(held, active.currentHp, active.stats.hp, rng.nextU16())) {
    resolved = active.currentHp - 1
    if (held.effect === 103) consume(participant)
    events.push({ kind: 'condition', target: position, condition: 'heldItemEndure', applied: true })
  }
  return resolved
}

export function applyDoubleBattlePostDamageHeldItem(session: DoubleBattleSession, position: DoubleBattlePosition, dealtDamage: number, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position), active = pokemon(participant)
  const abilityId = participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? active.abilityId
  const result = resolveHgssHeldPostDamage({ held: getDoubleBattleHeldItemEffect(session, participant), dealtDamage, currentHp: active.currentHp, maximumHp: active.stats.hp, healBlocked: participant.volatile.healBlockTurns > 0, magicGuard: abilityId === 98 })
  if (!result) return
  if (result.kind === 'heal') { active.currentHp += result.amount; events.push({ kind: 'heal', target: position, pokemonName: active.nickname ?? active.speciesName, amount: result.amount }) }
  else { active.currentHp -= result.amount; events.push({ kind: 'recoil', target: position, pokemonName: active.nickname ?? active.speciesName, damage: result.amount }); if (active.currentHp === 0) events.push({ kind: 'faint', target: position, pokemonName: active.nickname ?? active.speciesName, defeated: cloneCanonicalPokemon(active) }) }
}

export function applyDoubleBattleOnHitHeldItem(session: DoubleBattleSession, attackerPosition: DoubleBattlePosition, targetPosition: DoubleBattlePosition, input: { damageCategory: number, moveFlags: number, moveEffect: number, dealtDamage: number, typeMultiplier: number, substituteWasHit: boolean }, events: DoubleBattleEvent[]): void {
  const attacker = requireDoubleBattleParticipantAt(session, attackerPosition), target = requireDoubleBattleParticipantAt(session, targetPosition)
  const attackerPokemon = pokemon(attacker), targetPokemon = pokemon(target)
  const attackerAbilityId = attacker.volatile.abilitySuppressed ? 0 : attacker.volatile.abilityOverrideId ?? attackerPokemon.abilityId
  const result = resolveHgssHeldOnHit({ ...input, targetHeld: getDoubleBattleHeldItemEffect(session, target), attackerCurrentHp: attackerPokemon.currentHp, attackerMaximumHp: attackerPokemon.stats.hp, attackerAbilityId, attackerHasItem: attackerPokemon.heldItemId !== 0, targetCurrentHp: targetPokemon.currentHp, targetMaximumHp: targetPokemon.stats.hp, targetHealBlocked: target.volatile.healBlockTurns > 0 })
  if (!result) return
  if (result.kind === 'healTarget') { consume(target); targetPokemon.currentHp += result.amount; events.push({ kind: 'heal', target: targetPosition, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, amount: result.amount }) }
  else if (result.kind === 'damageAttacker') { consume(target); attackerPokemon.currentHp -= result.amount; events.push({ kind: 'recoil', target: attackerPosition, pokemonName: attackerPokemon.nickname ?? attackerPokemon.speciesName, damage: result.amount }); if (attackerPokemon.currentHp === 0) events.push({ kind: 'faint', target: attackerPosition, pokemonName: attackerPokemon.nickname ?? attackerPokemon.speciesName, defeated: cloneCanonicalPokemon(attackerPokemon) }) }
  else { attackerPokemon.heldItemId = targetPokemon.heldItemId; targetPokemon.heldItemId = 0; events.push({ kind: 'condition', target: attackerPosition, condition: 'stickyBarbTransfer', applied: true }) }
}

export function applyDoubleBattleEndTurnHeldItem(session: DoubleBattleSession, position: DoubleBattlePosition, rng: HgssLcrng, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position), active = pokemon(participant)
  if (active.currentHp <= 0) return
  const abilityId = participant.volatile.abilitySuppressed ? 0 : participant.volatile.abilityOverrideId ?? active.abilityId
  const result = resolveHgssHeldEndTurn({ held: getDoubleBattleHeldItemEffect(session, participant), currentHp: active.currentHp, maximumHp: active.stats.hp, poisonType: participant.types.includes(3), magicGuard: abilityId === 98, healBlocked: participant.volatile.healBlockTurns > 0 })
  if (!result) return
  if (result.kind === 'heal') { active.currentHp += result.amount; events.push({ kind: 'heal', target: position, pokemonName: active.nickname ?? active.speciesName, amount: result.amount }); return }
  if (result.kind === 'damage') { active.currentHp -= result.amount; events.push({ kind: 'recoil', target: position, pokemonName: active.nickname ?? active.speciesName, damage: result.amount }); if (active.currentHp === 0) events.push({ kind: 'faint', target: position, pokemonName: active.nickname ?? active.speciesName, defeated: cloneCanonicalPokemon(active) }); return }
  if (active.status !== 0) return
  const status = applyHgssPrimaryStatus(result.kind, active, participant.types, rng, abilityId, { weather: isDoubleBattleWeatherSuppressed(session) ? 'clear' : session.weather.kind })
  if (status.applied) events.push({ kind: 'status', target: position, pokemonName: active.nickname ?? active.speciesName, ...status })
}
