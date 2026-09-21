import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { resolveHgssHiddenPower } from './hgssBattleRules'
import { resolveHgssActiveAbilityId } from './hgssBattleEntryRules'
import { isDoubleBattleWeatherSuppressed } from './doubleBattleMoveOrder'
import { resolveHgssContextualDamageMove, resolveHgssPlateType } from './simpleBattleTemporalRules'
import type { DoubleBattleParticipant, DoubleBattlePosition, DoubleBattleSession, DoubleBattleSide } from './doubleBattleSession'
import { getDoubleBattleOccupiedPositions, requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function pokemon(participant: DoubleBattleParticipant) {
  const active = participant.party[participant.activePartyIndex]
  if (!active) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return active
}

function ability(participant: DoubleBattleParticipant): number {
  return resolveHgssActiveAbilityId(pokemon(participant).abilityId, participant.volatile.abilityOverrideId, participant.volatile.abilitySuppressed)
}

function livingTargets(session: DoubleBattleSession, side: DoubleBattleSide): DoubleBattlePosition[] {
  return session.teams[side].flatMap((participant, slot) => pokemon(participant).currentHp > 0 ? [{ side, slot: slot as 0 | 1 }] : [])
}

function dynamicMoveType(session: DoubleBattleSession, actor: DoubleBattlePosition, move: PokemonMoveData): number {
  const participant = requireDoubleBattleParticipantAt(session, actor)
  const active = pokemon(participant)
  if (move.effect === 135) return resolveHgssHiddenPower(active.individualValues).type
  if (move.effect === 268) return resolveHgssPlateType(active.heldItemId) ?? move.type
  if (move.effect === 222) return session.itemCatalog?.items[active.heldItemId]?.naturalGiftType ?? move.type
  const weather = isDoubleBattleWeatherSuppressed(session) ? 'clear' : session.weather.kind
  return resolveHgssContextualDamageMove(move, { weather, rolloutCount: participant.volatile.rolloutCount, defenseCurl: participant.volatile.defenseCurl, targetMinimized: false }).type
}

function firstRedirectorInTurnOrder(session: DoubleBattleSession, actor: DoubleBattlePosition, abilityId: 31 | 114): DoubleBattlePosition | undefined {
  const order = session.turnOrder.length > 0 ? session.turnOrder : getDoubleBattleOccupiedPositions(session)
  return order.find((position) => {
    const participant = requireDoubleBattleParticipantAt(session, position)
    return !(position.side === actor.side && position.slot === actor.slot) && pokemon(participant).currentHp > 0 && ability(participant) === abilityId
  })
}

/** Ciblage HGSS : Suivez-moi précède les redirections Paratonnerre/Lavabo. */
export function resolveDoubleBattleMoveTargets(
  session: DoubleBattleSession,
  actor: DoubleBattlePosition,
  range: number,
  chosenTarget: DoubleBattlePosition,
  rng: HgssLcrng,
  move?: PokemonMoveData,
): DoubleBattlePosition[] {
  const opposingSide = actor.side === 'player' ? 'opponent' : 'player'
  const opponents = livingTargets(session, opposingSide)
  const allies = livingTargets(session, actor.side)
  if ((range & (1 << 2)) !== 0) return opponents
  if ((range & (1 << 3)) !== 0) return [...opponents, ...allies.filter(({ slot }) => slot !== actor.slot)]
  if ((range & ((1 << 4) | (1 << 5) | (1 << 6))) !== 0) return [actor]
  if ((range & (1 << 7)) !== 0) return opponents.length === 0 ? [] : [opponents[0]!]
  if ((range & ((1 << 8) | (1 << 9))) !== 0) {
    const chosenAlly = allies.find(({ side, slot }) => side === chosenTarget.side && slot === chosenTarget.slot)
    return chosenAlly ? [chosenAlly] : [actor]
  }
  const randomTarget = (range & (1 << 1)) !== 0 ? opponents[rng.nextU16() % Math.max(1, opponents.length)] : undefined
  const chosen = randomTarget ?? opponents.find(({ side, slot }) => side === chosenTarget.side && slot === chosenTarget.slot) ?? opponents[0]
  if (!chosen) return []
  const followMe = opponents.find((position) => requireDoubleBattleParticipantAt(session, position).volatile.followMe)
  if (followMe) return [followMe]
  const actorAbility = ability(requireDoubleBattleParticipantAt(session, actor))
  if (!move || actorAbility === 96 || actorAbility === 104 || ![0, 1 << 1].includes(range)) return [chosen]
  const type = dynamicMoveType(session, actor, move)
  const redirect = type === 13 ? firstRedirectorInTurnOrder(session, actor, 31)
    : type === 11 ? firstRedirectorInTurnOrder(session, actor, 114) : undefined
  return [redirect ?? chosen]
}
