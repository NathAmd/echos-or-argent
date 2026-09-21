import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import { isHgssPriorityItemActive, type HgssMoveOrderCombatant } from './hgssBattleRules'
import { resolveHgssActiveAbilityId } from './hgssBattleEntryRules'
import { isHgssWeatherSuppressed } from './hgssEndTurnAbilityRules'
import type { DoubleBattleEvent, DoubleBattleParticipant, DoubleBattlePosition, DoubleBattleSession, DoubleBattleSide } from './doubleBattleSession'
import { resolveHgssPressurePpCost } from './hgssAbilityMoveRules'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { getDoubleBattleOccupiedPositions, requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function activePokemon(participant: DoubleBattleParticipant) {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}

function activeAbilityId(participant: DoubleBattleParticipant): number {
  return resolveHgssActiveAbilityId(activePokemon(participant).abilityId, participant.volatile.abilityOverrideId, participant.volatile.abilitySuppressed)
}

export function isDoubleBattleWeatherSuppressed(session: DoubleBattleSession): boolean {
  return isHgssWeatherSuppressed((['player', 'opponent'] as const).flatMap((side) => session.teams[side].flatMap((member) => activePokemon(member).currentHp > 0 ? [activeAbilityId(member)] : [])))
}

export function hasDoubleBattleActiveAbility(session: DoubleBattleSession, side: DoubleBattleSide, abilityId: number, excluded?: DoubleBattleParticipant): boolean {
  return session.teams[side].some((member) => member !== excluded && activePokemon(member).currentHp > 0 && activeAbilityId(member) === abilityId)
}

export function resolveDoubleBattlePressureCost(session: DoubleBattleSession, actor: DoubleBattlePosition, target: DoubleBattlePosition, move: PokemonMoveData): number {
  const opponentSide = actor.side === 'player' ? 'opponent' : 'player'
  const activeAbilities = (side: DoubleBattleSide) => session.teams[side].flatMap((member) => activePokemon(member).currentHp > 0 ? [activeAbilityId(member)] : [])
  const targetParticipant = requireDoubleBattleParticipantAt(session, target)
  const actorParticipant = requireDoubleBattleParticipantAt(session, actor)
  const otherAbilityIds = (['player', 'opponent'] as const).flatMap((side) => session.teams[side].flatMap((member) => member !== actorParticipant && activePokemon(member).currentHp > 0 ? [activeAbilityId(member)] : []))
  return resolveHgssPressurePpCost({ moveId: move.moveId, range: move.range, targetIsAttacker: actor.side === target.side && actor.slot === target.slot, targetAbilityId: activeAbilityId(targetParticipant), opposingAbilityIds: activeAbilities(opponentSide), otherAbilityIds })
}

/** Construit la même vue d'ordre pour chaque emplacement occupé du combat. */
export function createDoubleBattleMoveOrderState(session: DoubleBattleSession, participant: DoubleBattleParticipant, side: DoubleBattleSide, move: PokemonMoveData, priorityItemRoll = -1): HgssMoveOrderCombatant {
  const pokemon = activePokemon(participant)
  const weatherSuppressed = isDoubleBattleWeatherSuppressed(session)
  const abilityId = activeAbilityId(participant)
  const item = participant.volatile.embargoTurns > 0 || abilityId === 103 ? undefined : session.itemCatalog?.items[pokemon.heldItemId]
  return {
    pokemon, stages: participant.stages, move, abilityId, heldItemEffect: item?.holdEffect ?? 0, heldItemParameter: item?.holdEffectParameter ?? 0, priorityItemRoll,
    weather: session.weather.kind, weatherSuppressed, turnsActive: participant.volatile.turnsActive,
    canUnburden: participant.volatile.canUnburden, speedMultiplier: session.sideConditions[side].tailwindTurns > 0 ? 2 : 1,
  }
}

export function createDoubleBattlePriorityRolls(session: DoubleBattleSession, rng: HgssLcrng): Map<string, number> {
  return new Map(getDoubleBattleOccupiedPositions(session).map(({ side, slot }) => [`${side}:${slot}`, rng.nextU16()] as const))
}

export function activateDoubleBattlePriorityItem(session: DoubleBattleSession, position: DoubleBattlePosition, move: PokemonMoveData, roll: number, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(participant)
  if (pokemon.currentHp <= 0) return
  const state = createDoubleBattleMoveOrderState(session, participant, position.side, move, roll)
  if (!isHgssPriorityItemActive(state)) return
  events.push({ kind: 'condition', target: position, condition: `itemPriority:${state.heldItemEffect}`, applied: true })
  if (state.heldItemEffect === 45 && pokemon.heldItemId !== 0) {
    participant.volatile.recyclableItemId = pokemon.heldItemId
    participant.volatile.canUnburden = true
    pokemon.heldItemId = 0
  }
}
