import { cloneCanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { applyHgssPrimaryStatus } from './hgssBattleRules'
import { resolveHgssLeechSeedDrain, resolveHgssPassiveRecovery } from './hgssAbilityMoveRules'
import { applyHgssSpeedBoost, isHgssWeatherDamageImmune, isHgssWeatherSuppressed, resolveHgssEndTurnAbility, resolveHgssStatusResidual } from './hgssEndTurnAbilityRules'
import type { DoubleBattleEvent, DoubleBattleParticipant, DoubleBattlePosition, DoubleBattleSession, DoubleBattleSide, DoubleBattleSlot } from './doubleBattleSession'
import { refreshDoubleBattleForms } from './doubleBattleSwitching'
import { applyDoubleBattleEndTurnHeldItem, getDoubleBattleHeldItemEffect } from './doubleBattleHeldItems'
import { getDoubleBattleOccupiedPositions, getDoubleBattleParticipantAt, requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function activePokemon(participant: DoubleBattleParticipant) {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}

function participantAt(session: DoubleBattleSession, position: DoubleBattlePosition): DoubleBattleParticipant {
  return requireDoubleBattleParticipantAt(session, position)
}

function presentationTargetForSide(session: DoubleBattleSession, side: DoubleBattleSide): DoubleBattlePosition {
  const livingSlot = session.teams[side].findIndex((participant) => activePokemon(participant).currentHp > 0)
  return { side, slot: (livingSlot === 1 ? 1 : 0) }
}

function activeAbilityId(participant: DoubleBattleParticipant): number {
  if (participant.volatile.abilitySuppressed) return 0
  return participant.volatile.abilityOverrideId ?? activePokemon(participant).abilityId
}

function applyPassiveRecovery(
  session: DoubleBattleSession,
  position: DoubleBattlePosition,
  participant: DoubleBattleParticipant,
  events: DoubleBattleEvent[],
): void {
  const pokemon = activePokemon(participant)
  const held = getDoubleBattleHeldItemEffect(session, participant)
  const amount = resolveHgssPassiveRecovery({
    baseAmount: Math.max(1, Math.floor(pokemon.stats.hp / 16)),
    currentHp: pokemon.currentHp,
    maximumHp: pokemon.stats.hp,
    healBlocked: participant.volatile.healBlockTurns > 0,
    leechBoostPercent: held.effect === 124 ? held.parameter : undefined,
  })
  if (amount <= 0) return
  pokemon.currentHp += amount
  events.push({
    kind: 'heal',
    target: position,
    pokemonName: pokemon.nickname ?? pokemon.speciesName,
    amount,
  })
}

export function applyDoubleBattleResidual(session: DoubleBattleSession, events: DoubleBattleEvent[], rng: HgssLcrng): void {
  const faintedPositions = new Set<string>()
  const emitFaint = (position: DoubleBattlePosition, participant: DoubleBattleParticipant): boolean => {
    const pokemon = activePokemon(participant)
    if (pokemon.currentHp > 0) return false
    const key = `${position.side}:${position.slot}`
    if (!faintedPositions.has(key)) {
      faintedPositions.add(key)
      events.push({ kind: 'faint', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, defeated: cloneCanonicalPokemon(pokemon) })
    }
    return true
  }
  const weatherSuppressed = () => isHgssWeatherSuppressed(getDoubleBattleOccupiedPositions(session).flatMap((position) => {
    const participant = participantAt(session, position)
    return activePokemon(participant).currentHp > 0 ? [activeAbilityId(participant)] : []
  }))
  for (const position of getDoubleBattleOccupiedPositions(session)) {
    const participant = participantAt(session, position)
    const pokemon = activePokemon(participant)
    const abilityId = activeAbilityId(participant)
    if (pokemon.currentHp <= 0) continue
    const residual = resolveHgssStatusResidual({ abilityId, currentHp: pokemon.currentHp, maximumHp: pokemon.stats.hp, status: pokemon.status })
    pokemon.status = residual.nextStatus
    if (residual.kind === 'heal' && residual.amount > 0) {
      pokemon.currentHp += residual.amount
      events.push({ kind: 'heal', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, amount: residual.amount })
    } else if (residual.kind === 'damage') {
      pokemon.currentHp -= residual.amount
      events.push({ kind: 'residual', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: residual.status, damage: residual.amount })
    }
    if (emitFaint(position, participant)) continue
    if (participant.volatile.trappedTurns > 0) {
      if (abilityId !== 98) {
        const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 16)))
        pokemon.currentHp -= damage
        events.push({ kind: 'residual', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'trap', damage })
        if (emitFaint(position, participant)) continue
      }
      participant.volatile.trappedTurns -= 1
      if (participant.volatile.trappedTurns === 0) {
        events.push({ kind: 'condition', target: position, condition: 'bindingEnded', applied: true })
      }
    }
    emitFaint(position, participant)
  }
  for (const target of getDoubleBattleOccupiedPositions(session)) {
    const participant = participantAt(session, target)
    const pokemon = activePokemon(participant)
    const abilityId = activeAbilityId(participant)
    if (pokemon.currentHp <= 0) continue
    if (participant.volatile.aquaRing) applyPassiveRecovery(session, target, participant, events)
    if (participant.volatile.ingrain) applyPassiveRecovery(session, target, participant, events)
    if (participant.volatile.yawnTurns > 0) {
      participant.volatile.yawnTurns -= 1
      if (participant.volatile.yawnTurns === 0 && pokemon.status === 0) {
        const status = applyHgssPrimaryStatus('sleep', pokemon, participant.types, rng, abilityId, { weather: weatherSuppressed() ? 'clear' : session.weather.kind })
        events.push({ kind: 'status', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, ...status })
      }
    }
    if (participant.volatile.nightmare) {
      if ((pokemon.status & 0x7) === 0) participant.volatile.nightmare = false
      else if (abilityId !== 98) {
        const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 4)))
        pokemon.currentHp -= damage
        events.push({ kind: 'residual', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'trap', damage })
      }
    }
    if (emitFaint(target, participant)) continue
    if (pokemon.currentHp > 0 && abilityId !== 98 && participant.volatile.seededBy) {
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 8)))
      pokemon.currentHp -= damage
      events.push({ kind: 'residual', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'trap', damage })
      const seeder = getDoubleBattleParticipantAt(session, participant.volatile.seededBy)
      if (!seeder) participant.volatile.seededBy = undefined
      else {
        const seederPokemon = activePokemon(seeder)
        if (seederPokemon.currentHp > 0) {
        const held = getDoubleBattleHeldItemEffect(session, seeder)
        const drain = resolveHgssLeechSeedDrain({
          dealtDamage: damage,
          receiverCurrentHp: seederPokemon.currentHp,
          receiverMaximumHp: seederPokemon.stats.hp,
          receiverAbilityId: activeAbilityId(seeder),
          seededAbilityId: abilityId,
          healBlocked: seeder.volatile.healBlockTurns > 0,
          leechBoostPercent: held.effect === 124 ? held.parameter : undefined,
        })
        if (drain.kind === 'heal') {
          seederPokemon.currentHp += drain.amount
          events.push({ kind: 'heal', target: participant.volatile.seededBy, pokemonName: seederPokemon.nickname ?? seederPokemon.speciesName, amount: drain.amount })
        } else if (drain.kind === 'damage') {
          seederPokemon.currentHp -= drain.amount
          events.push(
            { kind: 'condition', target: participant.volatile.seededBy, condition: 'ability:64', applied: true },
            { kind: 'recoil', target: participant.volatile.seededBy, pokemonName: seederPokemon.nickname ?? seederPokemon.speciesName, damage: drain.amount },
          )
          emitFaint(participant.volatile.seededBy, seeder)
        }
      }
      }
    }
    if (emitFaint(target, participant)) continue
    if (pokemon.currentHp > 0 && participant.volatile.perishTurns > 0) {
      participant.volatile.perishTurns -= 1
      events.push({ kind: 'condition', target, condition: `perish:${participant.volatile.perishTurns}`, applied: true })
      if (participant.volatile.perishTurns === 0) pokemon.currentHp = 0
    }
    if (emitFaint(target, participant)) continue
    if (pokemon.currentHp > 0 && abilityId !== 98 && participant.volatile.cursed) {
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 4)))
      pokemon.currentHp -= damage
      events.push({ kind: 'residual', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'trap', damage })
    }
    if (emitFaint(target, participant)) continue
    const abilityEffect = resolveHgssEndTurnAbility({ abilityId, currentHp: pokemon.currentHp, maximumHp: pokemon.stats.hp, status: pokemon.status, weather: session.weather.kind, weatherSuppressed: weatherSuppressed(), healBlocked: participant.volatile.healBlockTurns > 0, speedStage: participant.stages.speed, enteredThisTurn: participant.volatile.enteredThisTurn, random: abilityId === 61 ? rng.nextU16() : 9 })
    if (abilityEffect?.kind === 'heal') { pokemon.currentHp += abilityEffect.amount; events.push({ kind: 'heal', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, amount: abilityEffect.amount }) }
    else if (abilityEffect?.kind === 'cureStatus') { pokemon.status = 0; events.push({ kind: 'statusCured', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, applied: true }) }
    else if (abilityEffect?.kind === 'raiseSpeed') { const applied = applyHgssSpeedBoost(participant.stages); if (applied) events.push({ kind: 'stat', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, stat: 'speed', change: 1, applied }) }
    else if (abilityEffect?.kind === 'damage') { pokemon.currentHp -= abilityEffect.amount; events.push({ kind: 'condition', target, condition: `ability:${abilityEffect.abilityId}`, applied: true }, { kind: 'damage', target, damage: abilityEffect.amount, critical: false, typeMultiplier: 10 }) }
    if (emitFaint(target, participant)) continue
    if (pokemon.currentHp > 0 && (session.weather.kind === 'sandstorm' || session.weather.kind === 'hail') && !weatherSuppressed()) {
      const immune = isHgssWeatherDamageImmune(session.weather.kind, participant.types, abilityId)
      if (!immune) {
        const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 16)))
        pokemon.currentHp -= damage
        events.push({ kind: 'weatherDamage', target, pokemonName: pokemon.nickname ?? pokemon.speciesName, weather: session.weather.kind, damage })
      }
    }
    if (emitFaint(target, participant)) continue
    applyDoubleBattleEndTurnHeldItem(session, target, rng, events)
  }
  for (const sourcePosition of getDoubleBattleOccupiedPositions(session)) {
    const { side: sourceSide } = sourcePosition
    const source = participantAt(session, sourcePosition)
    if (activePokemon(source).currentHp <= 0 || activeAbilityId(source) !== 123) continue
    const targetSide: DoubleBattleSide = sourceSide === 'player' ? 'opponent' : 'player'
    for (const targetPosition of getDoubleBattleOccupiedPositions(session, targetSide)) {
      const target = participantAt(session, targetPosition)
      const pokemon = activePokemon(target)
      if (pokemon.currentHp <= 0 || (pokemon.status & 0x7) === 0 || activeAbilityId(target) === 98) continue
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 8)))
      pokemon.currentHp -= damage
      events.push({ kind: 'condition', target: targetPosition, condition: 'ability:123', applied: true }, { kind: 'damage', target: targetPosition, damage, critical: false, typeMultiplier: 10 })
      emitFaint(targetPosition, target)
    }
  }
  for (const pending of session.futureAttacks) pending.turns -= 1
  for (const pending of session.futureAttacks.filter(({ turns }) => turns === 0)) {
    const intended = getDoubleBattleParticipantAt(session, pending.target)
    const fallbackSlot: DoubleBattleSlot = pending.target.slot === 0 ? 1 : 0
    const fallbackPosition = { side: pending.target.side, slot: fallbackSlot }
    const fallback = getDoubleBattleParticipantAt(session, fallbackPosition)
    const resolvedPosition = intended && activePokemon(intended).currentHp > 0 ? pending.target : fallback && activePokemon(fallback).currentHp > 0 ? fallbackPosition : undefined
    if (!resolvedPosition || !pending.hits) continue
    const pokemon = activePokemon(participantAt(session, resolvedPosition))
    const damage = Math.min(pokemon.currentHp, pending.damage)
    pokemon.currentHp -= damage
    events.push({ kind: 'residual', target: resolvedPosition, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'futureSight', damage })
    emitFaint(resolvedPosition, participantAt(session, resolvedPosition))
  }
  session.futureAttacks = session.futureAttacks.filter(({ turns }) => turns > 0)
  for (const wish of session.wishes) wish.turns -= 1
  for (const wish of session.wishes.filter(({ turns }) => turns === 0)) {
    const participant = getDoubleBattleParticipantAt(session, wish.target)
    if (!participant) continue
    const pokemon = activePokemon(participant)
    if (pokemon.currentHp > 0 && pokemon.currentHp < pokemon.stats.hp && participant.volatile.healBlockTurns === 0) {
      const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, wish.amount)
      pokemon.currentHp += amount
      events.push({ kind: 'heal', target: wish.target, pokemonName: pokemon.nickname ?? pokemon.speciesName, amount })
      events.push({ kind: 'condition', target: wish.target, condition: 'wishGranted', applied: true })
    }
  }
  session.wishes = session.wishes.filter(({ turns }) => turns > 0)
  const screenExpirations = [
    ['reflectTurns', 'reflectEnded'],
    ['lightScreenTurns', 'lightScreenEnded'],
    ['tailwindTurns', 'tailwindEnded'],
    ['luckyChantTurns', 'luckyChantEnded'],
    ['mistTurns', 'mistEnded'],
    ['safeguardTurns', 'safeguardEnded'],
  ] as const
  for (const side of ['player', 'opponent'] as const) for (const [key, condition] of screenExpirations) {
    if (session.sideConditions[side][key] > 0 && --session.sideConditions[side][key] === 0) {
      events.push({ kind: 'condition', target: presentationTargetForSide(session, side), condition, applied: true })
    }
  }
  if (session.weather.turns > 0 && --session.weather.turns === 0) {
    session.weather.kind = 'clear'
    events.push({ kind: 'weather', weather: 'clear' })
  }
  const globalTarget = presentationTargetForSide(session, 'player')
  if (session.trickRoomTurns > 0 && --session.trickRoomTurns === 0) {
    events.push({ kind: 'condition', target: globalTarget, condition: 'trickRoomEnded', applied: true })
  }
  if (session.gravityTurns > 0 && --session.gravityTurns === 0) {
    events.push({ kind: 'condition', target: globalTarget, condition: 'gravityEnded', applied: true })
  }
  const volatileExpirations = [
    ['disableTurns', 'disableEnded'],
    ['encoreTurns', 'encoreEnded'],
    ['tauntTurns', 'tauntEnded'],
    ['healBlockTurns', 'healBlockEnded'],
    ['embargoTurns', 'embargoEnded'],
    ['magnetRiseTurns', 'magnetRiseEnded'],
  ] as const
  for (const target of getDoubleBattleOccupiedPositions(session)) {
    const participant = participantAt(session, target)
    for (const [key, condition] of volatileExpirations) {
      if (participant.volatile[key] > 0 && --participant.volatile[key] === 0) {
        events.push({ kind: 'condition', target, condition, applied: true })
      }
    }
    if (participant.volatile.disableTurns === 0) participant.volatile.disabledMoveId = 0
    if (participant.volatile.encoreTurns === 0) participant.volatile.encoreMoveIndex = -1
    if (participant.volatile.lockOnTurns > 0) participant.volatile.lockOnTurns -= 1
    participant.volatile.turnsActive += 1
    participant.volatile.enteredThisTurn = false
  }
  refreshDoubleBattleForms(session, events)
}
