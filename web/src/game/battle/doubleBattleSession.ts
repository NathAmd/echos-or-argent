import type { PokemonCatalog } from '../../ndsTypes'; import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { assertPokemonBattleEligibility, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import {
  applyHgssPrimaryStatus,
  applyHgssSteadfast,
  applySupportedHgssPrimaryStatus,
  applySupportedHgssStatusMoveEffect,
  calculateHgssMoveDamage,
  calculateHgssTypeMultiplier,
  canHgssPokemonFlinch,
  compareHgssMoveOrder,
  doesHgssMoveHit, doesHgssSecondaryEffectOccur,
  neutralBattleStatStages,
  resolveHgssHiddenPower,
  type BattleStat,
  type BattleStatStages,
} from './hgssBattleRules'
import { resolveHgssBattleTerrainId } from '../../rom/battle/naturePower'
import { createDoubleBattleVolatileState, restoreDoubleBattleTemporaryForm, type DoubleBattleVolatileState } from './doubleBattleState'
import { applyDoubleBattleResidual } from './doubleBattleResidual'
import { applyDoubleConsumedItemEffect } from './doubleBattleItems'
import { applyDoubleBattleBagItem } from './doubleBattleBagItems'
import { applyDoubleBattleEntryAbility, getDoubleBattleReserveIndexes, refreshDoubleBattleForms, replaceFaintedDoubleBattleParticipants, switchDoubleBattleParticipant } from './doubleBattleSwitching'
import { resetHgssBadPoisonCounter, resolveHgssActiveAbilityId } from './hgssBattleEntryRules'
import { activateDoubleBattlePriorityItem, createDoubleBattleMoveOrderState, createDoubleBattlePriorityRolls, hasDoubleBattleActiveAbility, isDoubleBattleWeatherSuppressed, resolveDoubleBattlePressureCost } from './doubleBattleMoveOrder'
import { applyDoubleBattlePostHitAbilities } from './hgssPostHitAbilityRules'
import { canHgssConfuse, canHgssInfatuate, isHgssHeldItemRemovalBlocked, isHgssMoveBlockedBySoundproof, resolveHgssDrain, resolveHgssSynchronizeStatusChain } from './hgssAbilityMoveRules'
import { resolveDoubleBattleMoveTargets } from './doubleBattleTargeting'
import { applyDoubleBattleAutoHeldItem, applyDoubleBattleIncomingHeldItem, applyDoubleBattleOnHitHeldItem, applyDoubleBattlePostDamageHeldItem, getDoubleBattleHeldItemEffect } from './doubleBattleHeldItems'
import { applyHgssHeldAccuracy, applyHgssHeldAttackStats, applyHgssHeldBattleStats, applyHgssHeldDamageBoost, doesHgssHeldItemFlinch, resolveHgssHeldCriticalStage, resolveHgssMetronomeState } from './hgssHeldItemRules'
import { chooseDoubleBattleAiAction, createDoubleBattleAiState, type DoubleBattleAiOptions, type DoubleBattleAiState } from './doubleBattleAi'
import { getSelectableDoubleBattleMoveIndexes, resolveDoubleBattleActionMoveData as resolveActionMoveData } from './doubleBattleActionSelection'
import {
  recordDoubleBattleActiveMatchups,
  type DoubleBattleParticipationState,
} from './doubleBattleParticipation'
import { applyDoubleBattleTrainerItem } from './doubleBattleTrainerItems'
import { getDoubleBattleOccupiedPositions, requireDoubleBattleParticipantAt } from './doubleBattleRoster'
export { getDoubleBattleOccupiedPositions, isDoubleBattlePositionOccupied } from './doubleBattleRoster'
export {
  canSwitchDoubleBattleParticipant,
  getDoubleBattleReserveIndexes,
  getRequiredDoubleBattleReplacementPositions,
  submitDoubleBattleReplacement,
} from './doubleBattleSwitching'
export { validateDoubleBattleBagItem } from './doubleBattleBagItems'
export { createDoubleBattleTrainerAiOptions } from './doubleBattleAi'
export { getSelectableDoubleBattleMoveIndexes } from './doubleBattleActionSelection'
export {
  clearDoubleBattleExperienceParticipation,
  getDoubleBattleExperienceParticipantIndexes,
  getDoubleBattleExperienceParticipants,
} from './doubleBattleParticipation'
import {
  canHgssMoveHitSemiInvulnerable,
  resolveHgssChargeKind,
  resolveHgssContextualDamageMove,
  resolveHgssMagnitudePower,
  resolveHgssPlateType,
  resolveHgssTrumpCardPower,
  resolveHgssWeatherAccuracy,
  type SimpleBattleSemiInvulnerable,
} from './simpleBattleTemporalRules'
import type {
  DoubleBattleAction, DoubleBattleEvent, DoubleBattleItemAction, DoubleBattleMoveAction, DoubleBattlePassAction,
  DoubleBattlePosition, DoubleBattleSide, DoubleBattleSlot, DoubleBattleSwitchAction, DoubleBattleTrainerItemAction, DoubleBattleWeather,
} from './doubleBattleProtocol'
export type {
  DoubleBattleAction, DoubleBattleEvent, DoubleBattleItemAction, DoubleBattleMoveAction, DoubleBattlePassAction,
  DoubleBattlePosition, DoubleBattleSide, DoubleBattleSlot, DoubleBattleSwitchAction, DoubleBattleTrainerItemAction, DoubleBattleWeather,
} from './doubleBattleProtocol'
export type DoubleBattleParticipantInput = {
  ownerId: string
  party: CanonicalPokemon[]
  activePartyIndex: number
  controlled: boolean
  ai?: DoubleBattleAiOptions
}
export type DoubleBattleParticipant = {
  ownerId: string
  party: CanonicalPokemon[]
  activePartyIndex: number
  controlled: boolean
  ai: DoubleBattleAiState
  types: readonly [number, number]
  stages: BattleStatStages
  volatile: DoubleBattleVolatileState
}
export type DoubleBattleSession = {
  kind: 'double' | 'multi' | 'wild'
  turn: number
  phase: 'command' | 'replacement' | 'ended'
  result?: 'won' | 'lost' | 'captured' | 'escaped'
  /** Un ou deux participants de chaque côté, sans slot factice. */
  teams: Record<DoubleBattleSide, DoubleBattleParticipant[]>
  sideConditions: Record<DoubleBattleSide, { reflectTurns: number, lightScreenTurns: number, tailwindTurns: number, luckyChantTurns: number, mistTurns: number, safeguardTurns: number, spikesLayers: number, toxicSpikesLayers: number, stealthRock: boolean }>
  weather: { kind: DoubleBattleWeather, turns: number }
  trickRoomTurns: number
  gravityTurns: number
  futureAttacks: Array<{ turns: number, target: DoubleBattlePosition, damage: number, hits: boolean }>
  wishes: Array<{ turns: number, target: DoubleBattlePosition, amount: number }>
  healingWishes: Array<{ target: DoubleBattlePosition, lunar: boolean }>
  terrainId: number
  payDayCoins: number
  prizeMoneyMultiplier: number
  itemCatalog?: HgssItemCatalog
  bagInventory?: Map<number, number>
  plannedMoves: Map<string, PokemonMoveData>
  turnOrder: DoubleBattlePosition[]
  switchingPositions: Set<string>
  pendingReplacements: Map<string, DoubleBattlePosition>
  experienceParticipation: DoubleBattleParticipationState
  initialEvents: DoubleBattleEvent[]
}
function activePokemon(participant: DoubleBattleParticipant): CanonicalPokemon {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}
function activeBattleAbilityId(participant: DoubleBattleParticipant): number {
  return resolveHgssActiveAbilityId(activePokemon(participant).abilityId, participant.volatile.abilityOverrideId, participant.volatile.abilitySuppressed)
}
function effectiveDoubleBattlePokemon(participant: DoubleBattleParticipant): CanonicalPokemon {
  const pokemon = activePokemon(participant)
  return participant.volatile.powerTrick ? { ...pokemon, stats: { ...pokemon.stats, attack: pokemon.stats.defense, defense: pokemon.stats.attack } } : pokemon
}
function createParticipant(input: DoubleBattleParticipantInput, catalog: PokemonCatalog, playerTeamPolicy?: PokemonTeamPolicy): DoubleBattleParticipant {
  const party = input.party.map(cloneCanonicalPokemon)
  const pokemon = party[input.activePartyIndex]
  if (!pokemon || pokemon.isEgg || pokemon.currentHp <= 0) throw new Error(`Le combattant initial de ${input.ownerId} n'est pas utilisable.`)
  if (playerTeamPolicy) assertPokemonBattleEligibility(party, input.activePartyIndex, { format: 'double', phase: 'initial' }, playerTeamPolicy)
  const personal = catalog.personalData[pokemon.speciesId]
  if (!personal) throw new Error(`Les types ROM de ${pokemon.speciesName} sont absents.`)
  pokemon.status = resetHgssBadPoisonCounter(pokemon.status)
  return {
    ...input,
    party,
    ai: createDoubleBattleAiState(input.ai),
    types: personal.types,
    stages: { ...neutralBattleStatStages },
    volatile: createDoubleBattleVolatileState(pokemon.heldItemId !== 0),
  }
}

export function createDoubleBattleSession(options: {
  kind: 'double' | 'multi' | 'wild'
  player: readonly [DoubleBattleParticipantInput] | readonly [DoubleBattleParticipantInput, DoubleBattleParticipantInput]
  opponent: readonly [DoubleBattleParticipantInput] | readonly [DoubleBattleParticipantInput, DoubleBattleParticipantInput]
  catalog: PokemonCatalog
  initialWeather?: DoubleBattleSession['weather']['kind']
  initialTerrainId?: number
  itemCatalog?: HgssItemCatalog
  bagInventory?: Map<number, number>
  rng?: HgssLcrng
  playerTeamPolicy?: PokemonTeamPolicy
  allowSinglePlayerParticipant?: boolean
}): DoubleBattleSession {
  const singlePlayerAllowed = options.allowSinglePlayerParticipant === true && options.kind !== 'multi'
  if (options.player.length < 1 || options.player.length > 2 || options.player.length === 1 && !singlePlayerAllowed || options.opponent.length < 1 || options.opponent.length > 2) {
    throw new Error('Un combat double requiert deux participants joueur, sauf dérogation NG+ explicite, et un ou deux adversaires.')
  }
  const player = options.player.map((entry) => createParticipant(entry, options.catalog, entry.controlled ? options.playerTeamPolicy : undefined))
  const opponent = options.opponent.map((entry) => createParticipant(entry, options.catalog))
  for (const team of [player, opponent]) {
    if (team[1] && team[0].ownerId === team[1].ownerId) {
      team[1].party = team[0].party
      team[1].ai = team[0].ai
    }
  }
  const session: DoubleBattleSession = {
    kind: options.kind,
    turn: 0,
    phase: 'command',
    teams: {
      player,
      opponent,
    },
    sideConditions: {
      player: { reflectTurns: 0, lightScreenTurns: 0, tailwindTurns: 0, luckyChantTurns: 0, mistTurns: 0, safeguardTurns: 0, spikesLayers: 0, toxicSpikesLayers: 0, stealthRock: false },
      opponent: { reflectTurns: 0, lightScreenTurns: 0, tailwindTurns: 0, luckyChantTurns: 0, mistTurns: 0, safeguardTurns: 0, spikesLayers: 0, toxicSpikesLayers: 0, stealthRock: false },
    },
    weather: { kind: options.initialWeather ?? 'clear', turns: 0 },
    trickRoomTurns: 0,
    gravityTurns: 0,
    futureAttacks: [],
    wishes: [],
    healingWishes: [],
    terrainId: resolveHgssBattleTerrainId(options.initialTerrainId ?? 0),
    payDayCoins: 0,
    prizeMoneyMultiplier: player.some((participant) => options.itemCatalog?.items[activePokemon(participant).heldItemId]?.holdEffect === 58) ? 2 : 1,
    itemCatalog: options.itemCatalog,
    bagInventory: options.bagInventory,
    plannedMoves: new Map(),
    turnOrder: [],
    switchingPositions: new Set(),
    pendingReplacements: new Map(),
    experienceParticipation: new Map(),
    initialEvents: [],
  }
  const entryOrder = getDoubleBattleOccupiedPositions(session)
    .sort((left, right) => getDoubleBattlePokemon(session, right).stats.speed - getDoubleBattlePokemon(session, left).stats.speed)
  for (const position of entryOrder) applyDoubleBattleEntryAbility(session, position, session.initialEvents, options.rng)
  refreshDoubleBattleForms(session, session.initialEvents)
  recordDoubleBattleActiveMatchups(session)
  return session
}

export function consumeDoubleBattleInitialEvents(session: DoubleBattleSession): DoubleBattleEvent[] {
  return session.initialEvents.splice(0)
}

export function getDoubleBattlePokemon(session: DoubleBattleSession, position: DoubleBattlePosition): CanonicalPokemon {
  return activePokemon(participantAt(session, position))
}

export function getRequiredDoubleBattleActors(session: DoubleBattleSession): DoubleBattlePosition[] {
  return session.teams.player
    .map((participant, slot) => ({ participant, position: { side: 'player', slot: slot as DoubleBattleSlot } as const }))
    .filter(({ participant }) => participant.controlled && activePokemon(participant).currentHp > 0 && !participant.volatile.chargingMove)
    .map(({ position }) => position)
}

export function getLivingDoubleBattleTargets(session: DoubleBattleSession, side: DoubleBattleSide): DoubleBattlePosition[] {
  return session.teams[side]
    .map((participant, slot) => ({ participant, position: { side, slot: slot as DoubleBattleSlot } }))
    .filter(({ participant }) => activePokemon(participant).currentHp > 0)
    .map(({ position }) => position)
}

function participantAt(session: DoubleBattleSession, position: DoubleBattlePosition): DoubleBattleParticipant {
  return requireDoubleBattleParticipantAt(session, position)
}

function doubleBattleConfusionDamage(participant: DoubleBattleParticipant, rng: HgssLcrng): number {
  const pokemon = effectiveDoubleBattlePokemon(participant)
  const attack = Math.max(1, pokemon.stats.attack)
  const defense = Math.max(1, pokemon.stats.defense)
  let damage = Math.floor(pokemon.level * 2 / 5) + 2
  damage = Math.floor(damage * 40 * attack / defense)
  damage = Math.floor(damage / 50) + 2
  return Math.max(1, Math.floor(damage * (100 - rng.nextU16() % 16) / 100))
}

function applyDoubleStageChange(
  participant: DoubleBattleParticipant,
  position: DoubleBattlePosition,
  stat: BattleStat,
  change: number,
  events: DoubleBattleEvent[],
): void {
  const before = participant.stages[stat]
  participant.stages[stat] = Math.max(-6, Math.min(6, before + change))
  events.push({ kind: 'stat', target: position, pokemonName: activePokemon(participant).nickname ?? activePokemon(participant).speciesName, stat, change, applied: before !== participant.stages[stat] })
}

function canTransferDoubleHeldItem(session: DoubleBattleSession, pokemon: CanonicalPokemon, itemId: number): boolean {
  return itemId === 0 || (session.itemCatalog?.items[itemId]?.fieldPocket !== 5 && !(pokemon.speciesId === 487 && itemId === 112))
}

function consumeDoubleHeldItem(participant: DoubleBattleParticipant): number {
  const itemId = activePokemon(participant).heldItemId
  if (itemId !== 0) { participant.volatile.recyclableItemId = itemId; participant.volatile.canUnburden = true }
  activePokemon(participant).heldItemId = 0
  return itemId
}

function executeActionCore(
  session: DoubleBattleSession,
  action: DoubleBattleMoveAction,
  rng: HgssLcrng,
  events: DoubleBattleEvent[],
  catalog: PokemonCatalog,
  options: {
    consumeTurn: boolean
    spread: boolean
    invokedMove?: PokemonMoveData
    announceInvokedMove?: boolean
    invocationDepth?: number
    ppCost?: number
    presentationId?: number
    playerTeamPolicy?: PokemonTeamPolicy
  },
): void {
  const actor = participantAt(session, action.actor)
  const target = participantAt(session, action.target)
  const pokemon = activePokemon(actor)
  const targetPokemon = activePokemon(target)
  const activeWeather = isDoubleBattleWeatherSuppressed(session) ? 'clear' : session.weather.kind
  const actorAbilityId = activeBattleAbilityId(actor), targetAbilityId = activeBattleAbilityId(target)
  const actorHeld = getDoubleBattleHeldItemEffect(session, actor), targetHeld = getDoubleBattleHeldItemEffect(session, target)
  if (pokemon.currentHp <= 0 || targetPokemon.currentHp <= 0) return
  const invocation = options
  const continuingCharge = !invocation.invokedMove && actor.volatile.chargingMove?.moveIndex === action.moveIndex
  const usableMoveIndexes = getSelectableDoubleBattleMoveIndexes(session, action.actor)
  const usingStruggle = !invocation.invokedMove && action.moveIndex === -1 && usableMoveIndexes.length === 0
  const struggleData = usingStruggle ? catalog.moves[165] : undefined
  const move = invocation.invokedMove
    ? { moveId: invocation.invokedMove.moveId, pp: 1, maxPp: invocation.invokedMove.pp, ppUps: 0, data: invocation.invokedMove }
    : usingStruggle && struggleData
    ? { moveId: 165, pp: 1, maxPp: 1, ppUps: 0, data: struggleData }
    : pokemon.moves[action.moveIndex]
  if (!move) throw new Error(`La capacité ${action.moveIndex} de ${pokemon.speciesName} n'est pas utilisable.`)
  const movePresentationId = options.presentationId ?? events.length + 1
  const name = pokemon.nickname ?? pokemon.speciesName
  if (options.consumeTurn) applyDoubleBattleAutoHeldItem(session, action.actor, rng, events)
  const emitMoveStatus = (result: Parameters<typeof resolveHgssSynchronizeStatusChain>[0]) => { const chain = resolveHgssSynchronizeStatusChain(result, targetAbilityId, pokemon, actor.types, actorAbilityId, rng, { weather: activeWeather }); for (const entry of chain) events.push({ kind: 'status', target: entry.recipient === 'source' ? action.actor : action.target, pokemonName: entry.recipient === 'source' ? name : targetPokemon.nickname ?? targetPokemon.speciesName, status: entry.status, applied: entry.applied }); return chain.length > 0 }
  const invokeMove = (invokedMove: PokemonMoveData) => {
    const depth = invocation.invocationDepth ?? 0
    if (depth >= 4) return false
    const targets = resolveDoubleBattleMoveTargets(session, action.actor, invokedMove.range, action.target, rng, invokedMove)
    const spread = targets.length > 1 && (invokedMove.range & ((1 << 2) | (1 << 3))) !== 0
    const presentationId = events.length + 1
    targets.forEach((invokedTarget, index) => executeAction(session, { ...action, target: invokedTarget }, rng, events, catalog, { consumeTurn: false, spread, invokedMove, announceInvokedMove: index === 0, invocationDepth: depth + 1, presentationId, playerTeamPolicy: invocation.playerTeamPolicy }))
    return targets.length > 0
  }
  if (options.consumeTurn && !continuingCharge && !invocation.invokedMove && !usingStruggle && (move.pp <= 0 || !usableMoveIndexes.includes(action.moveIndex))) {
    actor.volatile.actedThisTurn = true
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (options.consumeTurn && actor.volatile.rechargeTurns > 0) {
    actor.volatile.rechargeTurns -= 1
    actor.volatile.actedThisTurn = true
    events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'recharge' })
    return
  }
  if (options.consumeTurn && activeBattleAbilityId(actor) === 54 && actor.volatile.turnsActive % 2 === 1) { actor.volatile.actedThisTurn = true; events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'truant' }); return }
  if (options.consumeTurn && actor.volatile.flinched) {
    actor.volatile.actedThisTurn = true
    actor.volatile.flinched = false
    events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'flinch' })
    if (applyHgssSteadfast(actor.stages, activeBattleAbilityId(actor))) events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'speed', change: 1, applied: true })
    return
  }
  if (options.consumeTurn) actor.volatile.actedThisTurn = true
  if (options.consumeTurn && (pokemon.status & 0x7) !== 0) {
    pokemon.status = (pokemon.status & ~0x7) | Math.max(0, (pokemon.status & 0x7) - (activeBattleAbilityId(actor) === 48 ? 2 : 1))
    if ((pokemon.status & 0x7) !== 0 && move.data.effect !== 92 && move.data.effect !== 97) { events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'sleep' }); return }
  }
  if (options.consumeTurn && (pokemon.status & 0x20) !== 0) {
    if (move.data.effect !== 125 && rng.nextU16() % 100 >= 20) { events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'freeze' }); return }
    pokemon.status &= ~0x20
  }
  if (options.consumeTurn && (pokemon.status & 0x40) !== 0 && rng.nextU16() % 4 === 0) {
    events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'paralysis' })
    return
  }
  if (options.consumeTurn && actor.volatile.infatuated && rng.nextU16() % 2 === 0) {
    events.push({ kind: 'cannotAct', actor: action.actor, pokemonName: name, reason: 'infatuation' })
    return
  }
  if (options.consumeTurn && actor.volatile.confusionTurns > 0) {
    actor.volatile.confusionTurns -= 1
    if (actor.volatile.confusionTurns === 0) events.push({ kind: 'confusion', target: action.actor, pokemonName: name, state: 'ended' })
    else {
      events.push({ kind: 'confusion', target: action.actor, pokemonName: name, state: 'active' })
      if (rng.nextU16() % 2 === 0) {
        const damage = Math.min(pokemon.currentHp, doubleBattleConfusionDamage(actor, rng))
        pokemon.currentHp -= damage
        events.push({ kind: 'selfDamage', target: action.actor, pokemonName: name, damage })
        if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
        return
      }
    }
  }
  if (options.consumeTurn && !continuingCharge && !usingStruggle) move.pp = Math.max(0, move.pp - (options.ppCost ?? 1))
  if (options.consumeTurn && !continuingCharge && [55, 115, 125].includes(actorHeld.effect) && actor.volatile.choiceMoveId === 0) actor.volatile.choiceMoveId = move.moveId
  if (options.consumeTurn && move.data.effect !== 111 && move.data.effect !== 116) actor.volatile.protectStreak = 0
  if (options.consumeTurn && move.data.effect !== 98) actor.volatile.destinyBond = false
  if (options.consumeTurn && move.data.effect !== 194) actor.volatile.grudge = false
  if (options.consumeTurn && !continuingCharge && !invocation.invokedMove && move.data.effect !== 81) actor.volatile.rage = false
  if (options.consumeTurn && !continuingCharge && !invocation.invokedMove && move.data.effect !== 119) actor.volatile.furyCutterCount = 0
  if (options.consumeTurn || invocation.announceInvokedMove) {
    if (options.consumeTurn) { actor.volatile.lastMoveData = { ...move.data }; actor.volatile.lastMoveId = move.moveId }
    const displayedType = move.data.effect === 135 ? resolveHgssHiddenPower(pokemon.individualValues).type
      : move.data.effect === 268 ? resolveHgssPlateType(pokemon.heldItemId) ?? move.data.type
        : move.data.effect === 222 ? session.itemCatalog?.items[pokemon.heldItemId]?.naturalGiftType ?? move.data.type
        : resolveHgssContextualDamageMove(move.data, { weather: activeWeather, rolloutCount: 0, defenseCurl: false, targetMinimized: false }).type
    events.push({ kind: 'move', presentationId: movePresentationId, actor: action.actor, target: action.target, pokemonName: name, actorSpeciesId: pokemon.speciesId, targetSpeciesId: targetPokemon.speciesId, moveId: move.moveId, moveName: move.moveId.toString(), moveType: displayedType, moveCategory: move.data.category })
  }
  if (options.consumeTurn && !invocation.invokedMove && move.data.effect === 246) {
    const otherMoveIds = pokemon.moves.filter((knownMove) => knownMove.moveId !== move.moveId).map((knownMove) => knownMove.moveId)
    if (otherMoveIds.length === 0 || otherMoveIds.some((moveId) => !actor.volatile.usedMoveIds.has(moveId))) {
      events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      return
    }
  }
  if (options.consumeTurn && !continuingCharge && !invocation.invokedMove) actor.volatile.usedMoveIds.add(move.moveId)
  if ((move.data.effect === 92 || move.data.effect === 97) && (pokemon.status & 0x7) === 0) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (move.data.category === 2 && (move.data.flags & 8) !== 0) {
    const snatcher = (['player', 'opponent'] as const).flatMap((side) => session.teams[side].map((participant, slot) => ({ participant, position: { side, slot: slot as DoubleBattleSlot } })))
      .find(({ participant, position }) => participant.volatile.snatch && (position.side !== action.actor.side || position.slot !== action.actor.slot))
    if (snatcher) {
      snatcher.participant.volatile.snatch = false
      executeAction(session, { actor: snatcher.position, target: snatcher.position, moveIndex: action.moveIndex }, rng, events, catalog, { consumeTurn: false, spread: false, invokedMove: move.data, announceInvokedMove: true, invocationDepth: (invocation.invocationDepth ?? 0) + 1, playerTeamPolicy: invocation.playerTeamPolicy })
      return
    }
  }
  if (move.data.category === 2 && (move.data.flags & 4) !== 0 && target.volatile.magicCoat) {
    target.volatile.magicCoat = false
    executeAction(session, { actor: action.target, target: action.actor, moveIndex: action.moveIndex }, rng, events, catalog, { consumeTurn: false, spread: false, invokedMove: move.data, announceInvokedMove: true, invocationDepth: (invocation.invocationDepth ?? 0) + 1, playerTeamPolicy: invocation.playerTeamPolicy })
    return
  }
  const chargeKind = resolveHgssChargeKind(move.data.effect, activeWeather)
  if (session.gravityTurns > 0 && (chargeKind === 'fly' || move.data.effect === 252)) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (!continuingCharge && chargeKind && actorHeld.effect === 99) { consumeDoubleHeldItem(actor); events.push({ kind: 'condition', target: action.actor, condition: 'powerHerb', applied: true }) }
  else if (!continuingCharge && chargeKind) {
    actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
    actor.volatile.semiInvulnerable = ['dig', 'dive', 'fly', 'shadow'].includes(chargeKind) ? chargeKind as SimpleBattleSemiInvulnerable : undefined
    if (chargeKind === 'skullBash') {
      const before = actor.stages.defense
      actor.stages.defense = Math.min(6, before + 1)
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'defense', change: 1, applied: before < 6 })
    }
    events.push({ kind: 'condition', target: action.actor, condition: chargeKind, applied: true })
    return
  }
  if (continuingCharge) {
    actor.volatile.chargingMove = undefined
    actor.volatile.semiInvulnerable = undefined
  }
  if (move.data.effect === 26) {
    if (!continuingCharge) {
      actor.volatile.bideTurns = 2; actor.volatile.bideDamage = 0
      actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
      events.push({ kind: 'condition', target: action.actor, condition: 'bideStore', applied: true })
      return
    }
    if (actor.volatile.bideTurns > 1) {
      actor.volatile.bideTurns -= 1
      actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
      events.push({ kind: 'condition', target: action.actor, condition: 'bideStore', applied: true })
      return
    }
    if (actor.volatile.bideDamage === 0) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); actor.volatile.bideTurns = 0; return }
  }
  if (move.data.effect === 148) {
    const occupied = session.futureAttacks.some(({ target: pendingTarget }) => pendingTarget.side === action.target.side && pendingTarget.slot === action.target.slot)
    if (occupied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    else {
      const snapshot = calculateHgssMoveDamage({ attacker: { ...pokemon, abilityId: 0 }, defender: { ...targetPokemon, abilityId: 0 }, attackerTypes: [18, 18], defenderTypes: [0, 0], attackerStages: { ...actor.stages }, defenderStages: { ...target.stages }, move: move.data, rng, criticalMultiplier: 1 })
      session.futureAttacks.push({ turns: 3, target: action.target, damage: snapshot.damage, hits: doesHgssMoveHit(move.data, actor.stages, target.stages, rng) })
      events.push({ kind: 'condition', target: action.target, condition: 'futureSight', applied: true })
    }
    return
  }
  if (move.data.effect === 173) {
    const invokedMoveId = catalog.naturePowerMoveIds?.[session.terrainId]
    const invokedMove = invokedMoveId === undefined ? undefined : catalog.moves[invokedMoveId]
    if (!invokedMove || (invocation.invocationDepth ?? 0) >= 4) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    else {
      const invokedTargets = resolveDoubleBattleMoveTargets(session, action.actor, invokedMove.range, action.target, rng, invokedMove)
      const spread = invokedTargets.length > 1 && (invokedMove.range & ((1 << 2) | (1 << 3))) !== 0
      const presentationId = events.length + 1
      invokedTargets.forEach((invokedTarget, index) => executeAction(session, { ...action, target: invokedTarget }, rng, events, catalog, {
        consumeTurn: false, spread, invokedMove, announceInvokedMove: index === 0, invocationDepth: (invocation.invocationDepth ?? 0) + 1, presentationId, playerTeamPolicy: invocation.playerTeamPolicy,
      }))
    }
    return
  }
  if (move.data.effect === 170 && actor.volatile.lastDamageTaken > 0) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (move.data.effect === 158 && actor.volatile.turnsActive > 0) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (move.data.effect === 223 && !target.volatile.protected) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (target.volatile.protected && move.data.effect !== 223 && move.data.effect !== 272) {
    if (move.data.effect === 117) { actor.volatile.rolloutCount = 0; actor.volatile.chargingMove = undefined }
    events.push({ kind: 'condition', target: action.target, condition: 'protected', applied: false })
    return
  }
  if (move.data.effect === 223) target.volatile.protected = false
  const canHitSemiInvulnerable = target.volatile.semiInvulnerable
    ? canHgssMoveHitSemiInvulnerable(move.data.effect, target.volatile.semiInvulnerable) : false
  if (target.volatile.semiInvulnerable && !canHitSemiInvulnerable) {
    events.push({ kind: 'miss', actor: action.actor, target: action.target, pokemonName: name })
    return
  }
  if (isHgssMoveBlockedBySoundproof(move.moveId, actorAbilityId, targetAbilityId)) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName }); return }
  if (move.data.effect === 7 && (['player', 'opponent'] as const).some((side) => session.teams[side].some((member) => activePokemon(member).currentHp > 0 && activeBattleAbilityId(member) === 6))) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
  if (move.data.effect === 38 && pokemon.level < targetPokemon.level) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
  const heldAccuracyMove = { ...move.data, accuracy: applyHgssHeldAccuracy(move.data.accuracy, actorHeld, targetHeld, target.volatile.actedThisTurn) }
  const rawWeatherAccuracy = resolveHgssWeatherAccuracy(move.data.effect === 38 ? { ...move.data, accuracy: 30 + pokemon.level - targetPokemon.level } : actor.volatile.micleAccuracy ? { ...heldAccuracyMove, accuracy: Math.min(100, Math.floor(heldAccuracyMove.accuracy * 6 / 5)) } : heldAccuracyMove, activeWeather)
  const weatherAccuracy = rawWeatherAccuracy === 'always-hit' || session.gravityTurns === 0 ? rawWeatherAccuracy
    : { ...rawWeatherAccuracy, accuracy: Math.min(100, Math.floor(rawWeatherAccuracy.accuracy * 5 / 3)) }
  const lockedOn = actor.volatile.lockOnTurns > 0 && actor.volatile.lockOnTarget?.side === action.target.side && actor.volatile.lockOnTarget.slot === action.target.slot
  const alwaysHits = lockedOn || move.data.effect === 17 || move.data.effect === 78 || move.data.effect === 260 && activeWeather === 'hail' || weatherAccuracy === 'always-hit'
  if (!alwaysHits && !doesHgssMoveHit(weatherAccuracy, actor.stages, target.stages, rng, { attackerAbilityId: activeBattleAbilityId(actor), targetAbilityId: activeBattleAbilityId(target), weather: activeWeather, targetConfused: target.volatile.confusionTurns > 0 })) {
    actor.volatile.micleAccuracy = false
    if (move.data.effect === 117) { actor.volatile.rolloutCount = 0; actor.volatile.chargingMove = undefined }
    events.push({ kind: 'miss', actor: action.actor, target: action.target, pokemonName: name })
    if (move.data.effect === 45) {
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 2)))
      pokemon.currentHp -= damage
      events.push({ kind: 'recoil', target: action.actor, pokemonName: name, damage })
      if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
    }
    return
  }
  actor.volatile.micleAccuracy = false; ({ moveId: actor.volatile.metronomeMoveId, turns: actor.volatile.metronomeTurns } = resolveHgssMetronomeState(actorHeld, move.moveId, actor.volatile.metronomeMoveId, actor.volatile.metronomeTurns, continuingCharge || actor.volatile.rolloutCount > 0 || actor.volatile.rampageTurns > 0 || actor.volatile.uproarTurns > 0))
  if (lockedOn && move.data.effect !== 94) { actor.volatile.lockOnTurns = 0; actor.volatile.lockOnTarget = undefined }
  if (move.data.power === 0) {
    if ((action.target.side !== action.actor.side || action.target.slot !== action.actor.slot) && target.volatile.substituteHp > 0 && move.data.effect !== 223) {
      events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      return
    }
    if (actor.volatile.healBlockTurns > 0 && [32, 37, 91, 132, 162, 193, 214, 220, 251, 270].includes(move.data.effect)) {
      events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      return
    }
    let handled = false
    const status = session.sideConditions[action.target.side].safeguardTurns === 0 ? applySupportedHgssPrimaryStatus(move.data, targetPokemon, target.types, rng, targetAbilityId, actorAbilityId, { weather: activeWeather }) : undefined
    if (emitMoveStatus(status)) handled = true
    const stagesBefore = { ...target.stages }
    const stat = applySupportedHgssStatusMoveEffect(move.data, actor.stages, target.stages, rng, actorAbilityId, targetAbilityId)
    if (stat) {
      const blocked = stat.change < 0 && session.sideConditions[action.target.side].mistTurns > 0
      if (blocked) target.stages = stagesBefore
      events.push({ kind: 'stat', target: stat.change > 0 ? action.actor : action.target, pokemonName: stat.change > 0 ? name : targetPokemon.nickname ?? targetPokemon.speciesName, ...stat, applied: blocked ? false : stat.applied })
      handled = true
    }
    if (move.data.effect === 25) {
      for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) participant.stages = { ...neutralBattleStatStages }
      events.push({ kind: 'statsReset' })
      handled = true
    } else if (move.data.effect === 37) {
      const amount = pokemon.stats.hp - pokemon.currentHp
      if (amount > 0 && (pokemon.status & 0x7) === 0) {
        pokemon.currentHp = pokemon.stats.hp
        pokemon.status = 2 + rng.nextU16() % 3
        events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount })
        events.push({ kind: 'status', target: action.actor, pokemonName: name, status: 'sleep', applied: true })
      } else events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 32 || move.data.effect === 132) {
      const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 2)))
      pokemon.currentHp += amount
      events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount })
      handled = true
    } else if (move.data.effect === 102 || move.data.effect === 193) {
      const party = move.data.effect === 102 ? actor.party : [pokemon]
      const applied = party.some((member) => member.status !== 0)
      for (const member of party) member.status = 0
      events.push({ kind: 'statusCured', target: action.actor, pokemonName: name, applied })
      handled = true
    } else if (move.data.effect === 35 || move.data.effect === 65) {
      const screen = move.data.effect === 35 ? 'lightScreen' : 'reflect'
      session.sideConditions[action.actor.side][`${screen}Turns`] = actorHeld.effect === 97 ? 8 : 5
      events.push({ kind: 'screen', side: action.actor.side, screen })
      handled = true
    } else if (move.data.effect === 46 || move.data.effect === 124) {
      const field = move.data.effect === 46 ? 'mistTurns' : 'safeguardTurns'
      const applied = session.sideConditions[action.actor.side][field] === 0
      session.sideConditions[action.actor.side][field] = 5
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 46 ? 'mist' : 'safeguard', applied })
      handled = true
    } else if (move.data.effect === 49) {
      const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbilityId, session.sideConditions[action.target.side].safeguardTurns > 0, actorAbilityId === 104)
      if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, state: applied ? 'started' : 'active' })
      handled = true
    } else if (move.data.effect === 118 || move.data.effect === 166) {
      applyDoubleStageChange(target, action.target, move.data.effect === 118 ? 'attack' : 'specialAttack', move.data.effect === 118 ? 2 : 1, events)
      const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbilityId, session.sideConditions[action.target.side].safeguardTurns > 0, actorAbilityId === 104)
      if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, state: applied ? 'started' : 'active' })
      handled = true
    } else if (move.data.effect === 120) {
      const genders = [pokemon.gender, targetPokemon.gender]
      const applied = genders[0] !== 'genderless' && genders[1] !== 'genderless' && genders[0] !== genders[1] && canHgssInfatuate(targetAbilityId, actorAbilityId === 104)
      if (applied) target.volatile.infatuated = true
      events.push({ kind: 'condition', target: action.target, condition: 'infatuation', applied }); if (applied && targetHeld.effect === 108 && !actor.volatile.infatuated && canHgssInfatuate(actorAbilityId)) { actor.volatile.infatuated = true; events.push({ kind: 'condition', target: action.actor, condition: 'item:108', applied: true }) }
      handled = true
    } else if ([115, 136, 137, 164].includes(move.data.effect)) {
      const weather = move.data.effect === 115 ? 'sandstorm' : move.data.effect === 136 ? 'rain' : move.data.effect === 137 ? 'sun' : 'hail'
      const extender = { sandstorm: 111, rain: 113, sun: 112, hail: 110 }[weather]
      session.weather = { kind: weather, turns: actorHeld.effect === extender ? 8 : 5 }
      events.push({ kind: 'weather', weather })
      handled = true
    } else if (move.data.effect === 143) {
      actor.stages = { ...target.stages }
      events.push({ kind: 'condition', target: action.actor, condition: 'psychUp', applied: true })
      handled = true
    } else if (move.data.effect === 111 || move.data.effect === 116) {
      const denominator = 1 << Math.min(3, actor.volatile.protectStreak)
      const applied = rng.nextU16() % denominator === 0
      actor.volatile.protectStreak = applied ? actor.volatile.protectStreak + 1 : 0
      if (move.data.effect === 111) actor.volatile.protected = applied
      else actor.volatile.endured = applied
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 111 ? 'protect' : 'endure', applied })
      handled = true
    } else if (move.data.effect === 156) {
      actor.volatile.defenseCurl = true
      const before = actor.stages.defense
      actor.stages.defense = Math.min(6, before + 1)
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'defense', change: 1, applied: before < 6 })
      handled = true
    } else if (move.data.effect === 47) {
      const applied = !actor.volatile.focusEnergy
      actor.volatile.focusEnergy = true
      events.push({ kind: 'condition', target: action.actor, condition: 'focusEnergy', applied })
      handled = true
    } else if (move.data.effect === 108) {
      const before = actor.stages.evasion
      actor.stages.evasion = Math.min(6, before + 2)
      actor.volatile.minimized = true
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'evasion', change: 2, applied: before < 6 })
      handled = true
    } else if (move.data.effect === 174) {
      actor.volatile.charged = true
      const before = actor.stages.specialDefense
      actor.stages.specialDefense = Math.min(6, before + 1)
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'specialDefense', change: 1, applied: before < 6 })
      events.push({ kind: 'condition', target: action.actor, condition: 'charge', applied: true })
      handled = true
    } else if (move.data.effect === 172) {
      const applied = !actor.volatile.followMe
      actor.volatile.followMe = true
      events.push({ kind: 'condition', target: action.actor, condition: 'followMe', applied })
      handled = true
    } else if (move.data.effect === 176) {
      const applied = action.target.side === action.actor.side && action.target.slot !== action.actor.slot && !target.volatile.helpingHand
      if (applied) target.volatile.helpingHand = true
      events.push({ kind: 'condition', target: action.target, condition: 'helpingHand', applied })
      handled = true
    } else if (move.data.effect === 178) {
      const abilityId = activeBattleAbilityId(target)
      const applied = abilityId > 0 && abilityId !== 121
      if (applied) {
        actor.volatile.abilityOverrideId = abilityId
        actor.volatile.abilitySuppressed = false
      }
      events.push({ kind: 'condition', target: action.actor, condition: 'rolePlay', applied })
      handled = true
    } else if (move.data.effect === 181) {
      const applied = !actor.volatile.ingrain
      actor.volatile.ingrain = true
      events.push({ kind: 'condition', target: action.actor, condition: 'ingrain', applied })
      handled = true
    } else if (move.data.effect === 187) {
      const applied = target.volatile.yawnTurns === 0 && targetPokemon.status === 0
      if (applied) target.volatile.yawnTurns = 2
      events.push({ kind: 'condition', target: action.target, condition: 'yawn', applied })
      handled = true
    } else if (move.data.effect === 211) {
      for (const statName of ['specialAttack', 'specialDefense'] as const) {
        const before = actor.stages[statName]
        actor.stages[statName] = Math.min(6, before + 1)
        events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: statName, change: 1, applied: before < 6 })
      }
      handled = true
    } else if (move.data.effect === 91) {
      const average = Math.floor((pokemon.currentHp + targetPokemon.currentHp) / 2)
      const actorBefore = pokemon.currentHp
      const targetBefore = targetPokemon.currentHp
      pokemon.currentHp = Math.min(pokemon.stats.hp, average)
      targetPokemon.currentHp = Math.min(targetPokemon.stats.hp, average)
      events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount: pokemon.currentHp - actorBefore })
      events.push({ kind: 'heal', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, amount: targetPokemon.currentHp - targetBefore })
      handled = true
    } else if (move.data.effect === 142) {
      const cost = Math.floor(pokemon.stats.hp / 2)
      if (pokemon.currentHp <= cost || actor.stages.attack >= 6) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      else {
        pokemon.currentHp -= cost
        applyDoubleStageChange(actor, action.actor, 'attack', 12, events)
      }
      handled = true
    } else if (move.data.effect === 160) {
      if (actor.volatile.stockpile >= 3) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      else {
        actor.volatile.stockpile += 1
        applyDoubleStageChange(actor, action.actor, 'defense', 1, events)
        applyDoubleStageChange(actor, action.actor, 'specialDefense', 1, events)
        events.push({ kind: 'condition', target: action.actor, condition: `stockpile:${actor.volatile.stockpile}`, applied: true })
      }
      handled = true
    } else if (move.data.effect === 162) {
      const count = actor.volatile.stockpile
      if (count === 0) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      else {
        const divisor = count === 1 ? 4 : count === 2 ? 2 : 1
        const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / divisor)))
        pokemon.currentHp += amount
        applyDoubleStageChange(actor, action.actor, 'defense', -count, events)
        applyDoubleStageChange(actor, action.actor, 'specialDefense', -count, events)
        actor.volatile.stockpile = 0
        events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount })
      }
      handled = true
    } else if (move.data.effect === 168) {
      applyDoubleStageChange(target, action.target, 'attack', -2, events)
      applyDoubleStageChange(target, action.target, 'specialAttack', -2, events)
      pokemon.currentHp = 0
      events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
      handled = true
    } else if (move.data.effect === 199) {
      const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbilityId, session.sideConditions[action.target.side].safeguardTurns > 0, actorAbilityId === 104)
      if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, state: applied ? 'started' : 'active' })
      handled = true
    } else if (move.data.effect === 97) {
      const candidates = pokemon.moves.filter((knownMove) => knownMove.moveId !== move.moveId && knownMove.data.effect !== 97)
      const invoked = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length]!.data : undefined
      if (invoked && (invocation.invocationDepth ?? 0) < 4) executeAction(session, action, rng, events, catalog, { consumeTurn: false, spread: false, invokedMove: invoked, announceInvokedMove: true, invocationDepth: (invocation.invocationDepth ?? 0) + 1, playerTeamPolicy: invocation.playerTeamPolicy })
      else events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if ([205, 206, 208, 212].includes(move.data.effect)) {
      const affected = move.data.effect === 205 ? target : actor
      const affectedPosition = move.data.effect === 205 ? action.target : action.actor
      const changes: Array<[BattleStat, number]> = move.data.effect === 205 ? [['attack', -1], ['defense', -1]]
        : move.data.effect === 206 ? [['defense', 1], ['specialDefense', 1]]
          : move.data.effect === 208 ? [['attack', 1], ['defense', 1]] : [['attack', 1], ['speed', 1]]
      for (const [statName, change] of changes) applyDoubleStageChange(affected, affectedPosition, statName, change, events)
      handled = true
    } else if (move.data.effect === 226) {
      const available = (Object.keys(target.stages) as BattleStat[]).filter((statName) => target.stages[statName] < 6)
      if (available.length > 0) applyDoubleStageChange(target, action.target, available[rng.nextU16() % available.length]!, 2, events)
      else events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 243 || move.data.effect === 244) {
      const stats: BattleStat[] = move.data.effect === 243 ? ['attack', 'specialAttack'] : ['defense', 'specialDefense']
      for (const statName of stats) [actor.stages[statName], target.stages[statName]] = [target.stages[statName], actor.stages[statName]]
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 243 ? 'powerSwap' : 'guardSwap', applied: true })
      handled = true
    } else if (move.data.effect === 250) {
      for (const statName of Object.keys(actor.stages) as BattleStat[]) [actor.stages[statName], target.stages[statName]] = [target.stages[statName], actor.stages[statName]]
      events.push({ kind: 'condition', target: action.target, condition: 'heartSwap', applied: true })
      handled = true
    } else if (move.data.effect === 265) {
      const applied = pokemon.gender !== 'genderless' && targetPokemon.gender !== 'genderless' && pokemon.gender !== targetPokemon.gender && activeBattleAbilityId(target) !== 12
      if (applied) applyDoubleStageChange(target, action.target, 'specialAttack', -2, events)
      else events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 242) {
      const copied = target.volatile.lastMoveData
      const depth = invocation.invocationDepth ?? 0
      const applied = Boolean(copied && copied.effect !== 173 && copied.effect !== 242 && depth < 4)
      if (copied && applied) executeAction(
        session,
        action,
        rng,
        events,
        catalog,
        { consumeTurn: false, spread: false, invokedMove: copied, announceInvokedMove: true, invocationDepth: depth + 1, playerTeamPolicy: invocation.playerTeamPolicy },
      )
      if (!applied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 259) {
      const applied = session.trickRoomTurns === 0
      session.trickRoomTurns = applied ? 5 : 0
      events.push({ kind: 'condition', target: action.actor, condition: 'trickRoom', applied })
      handled = true
    } else if (move.data.effect === 201 || move.data.effect === 210) {
      const field = move.data.effect === 201 ? 'mudSport' : 'waterSport'
      const applied = !actor.volatile[field]
      actor.volatile[field] = true
      events.push({ kind: 'condition', target: action.actor, condition: field, applied })
      handled = true
    } else if (move.data.effect === 215) {
      session.gravityTurns = 5
      for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) {
        participant.volatile.magnetRiseTurns = 0
        if (participant.volatile.semiInvulnerable === 'fly') {
          participant.volatile.semiInvulnerable = undefined
          participant.volatile.chargingMove = undefined
        }
      }
      events.push({ kind: 'condition', target: action.actor, condition: 'gravity', applied: true })
      handled = true
    } else if (move.data.effect === 225 || move.data.effect === 240) {
      const field = move.data.effect === 225 ? 'tailwindTurns' : 'luckyChantTurns'
      const applied = session.sideConditions[action.actor.side][field] === 0
      session.sideConditions[action.actor.side][field] = 5
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 225 ? 'tailwind' : 'luckyChant', applied })
      handled = true
    } else if (move.data.effect === 236) {
      const applied = target.volatile.healBlockTurns === 0
      target.volatile.healBlockTurns = 5
      events.push({ kind: 'condition', target: action.target, condition: 'healBlock', applied })
      handled = true
    } else if (move.data.effect === 239 || move.data.effect === 247) {
      const applied = move.data.effect === 239 ? !target.volatile.abilitySuppressed : activeBattleAbilityId(target) !== 15
      if (move.data.effect === 239) target.volatile.abilitySuppressed = true
      else { target.volatile.abilityOverrideId = 15; target.volatile.abilitySuppressed = false }
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 239 ? 'gastroAcid' : 'worrySeed', applied })
      handled = true
    } else if (move.data.effect === 251) {
      const applied = !actor.volatile.aquaRing
      actor.volatile.aquaRing = true
      events.push({ kind: 'condition', target: action.actor, condition: 'aquaRing', applied })
      handled = true
    } else if (move.data.effect === 252) {
      const applied = actor.volatile.magnetRiseTurns === 0 && session.gravityTurns === 0
      if (applied) actor.volatile.magnetRiseTurns = 5
      events.push({ kind: 'condition', target: action.actor, condition: 'magnetRise', applied })
      handled = true
    } else if (move.data.effect === 177) {
      const actorItem = pokemon.heldItemId
      const targetItem = targetPokemon.heldItemId
      const applied = actorItem !== targetItem && !isHgssHeldItemRemovalBlocked(targetAbilityId, actorAbilityId, targetItem !== 0) && canTransferDoubleHeldItem(session, pokemon, targetItem) && canTransferDoubleHeldItem(session, targetPokemon, actorItem)
      if (applied) {
        [pokemon.heldItemId, targetPokemon.heldItemId] = [targetItem, actorItem]; if (pokemon.heldItemId !== 0) actor.volatile.canUnburden = true
        if (targetPokemon.heldItemId !== 0) target.volatile.canUnburden = true }
      events.push({ kind: 'condition', target: action.target, condition: 'heldItemsSwapped', applied })
      handled = true
    } else if (move.data.effect === 184) {
      const applied = pokemon.heldItemId === 0 && actor.volatile.recyclableItemId !== 0
      if (applied) {
        pokemon.heldItemId = actor.volatile.recyclableItemId
        actor.volatile.recyclableItemId = 0
      }
      events.push({ kind: 'condition', target: action.actor, condition: 'itemRecycled', applied })
      handled = true
    } else if (move.data.effect === 86 || move.data.effect === 90) {
      const lastMoveId = target.volatile.lastMoveId
      const moveIndex = targetPokemon.moves.findIndex((knownMove) => knownMove.moveId === lastMoveId)
      const applied = lastMoveId !== 0 && moveIndex >= 0 && (move.data.effect === 86 ? target.volatile.disableTurns === 0 : target.volatile.encoreTurns === 0)
      if (applied && move.data.effect === 86) { target.volatile.disabledMoveId = lastMoveId; target.volatile.disableTurns = 4 }
      if (applied && move.data.effect === 90) { target.volatile.encoreMoveIndex = moveIndex; target.volatile.encoreTurns = 4 }
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 86 ? 'disable' : 'encore', applied })
      handled = true
    } else if (move.data.effect === 100) {
      const knownMove = targetPokemon.moves.find((candidate) => candidate.moveId === target.volatile.lastMoveId)
      const applied = Boolean(knownMove && knownMove.pp > 0)
      if (knownMove) knownMove.pp = Math.max(0, knownMove.pp - (2 + rng.nextU16() % 4))
      events.push({ kind: 'condition', target: action.target, condition: 'spite', applied })
      handled = true
    } else if (move.data.effect === 165 || move.data.effect === 175) {
      const applied = move.data.effect === 165 ? !target.volatile.tormented : target.volatile.tauntTurns === 0
      if (move.data.effect === 165) target.volatile.tormented = true
      else target.volatile.tauntTurns = 4
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 165 ? 'torment' : 'taunt', applied })
      handled = true
    } else if (move.data.effect === 192) {
      const applied = !actor.volatile.imprisoned
      actor.volatile.imprisoned = true
      events.push({ kind: 'condition', target: action.actor, condition: 'imprison', applied })
      handled = true
    } else if (move.data.effect === 30 || move.data.effect === 213) {
      const candidates = move.data.effect === 213 ? [catalog.camouflageTypeIds?.[session.terrainId]]
        : pokemon.moves.map((knownMove) => knownMove.data.type).filter((type, index, all) => type !== actor.types[0] && all.indexOf(type) === index)
      const type = candidates.filter((candidate): candidate is number => candidate !== undefined)[rng.nextU16() % Math.max(1, candidates.length)]
      const applied = type !== undefined
      if (type !== undefined) actor.types = [type, type]
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 30 ? 'conversion' : 'camouflage', applied })
      handled = true
    } else if (move.data.effect === 191) {
      const actorAbility = activeBattleAbilityId(actor)
      const targetAbility = activeBattleAbilityId(target)
      const applied = actorAbility > 0 && targetAbility > 0 && actorAbility !== targetAbility && actorAbility !== 121 && targetAbility !== 121
      if (applied) {
        actor.volatile.abilityOverrideId = targetAbility; actor.volatile.abilitySuppressed = false
        target.volatile.abilityOverrideId = actorAbility; target.volatile.abilitySuppressed = false
      }
      events.push({ kind: 'condition', target: action.target, condition: 'skillSwap', applied })
      handled = true
    } else if (move.data.effect === 234) {
      const applied = pokemon.status !== 0 && targetPokemon.status === 0
      if (applied) { targetPokemon.status = pokemon.status; pokemon.status = 0 }
      events.push({ kind: 'condition', target: action.target, condition: 'psychoShift', applied })
      handled = true
    } else if (move.data.effect === 82) {
      const copied = target.volatile.lastMoveData
      const applied = Boolean(copied && copied.effect !== 82 && invokeMove(copied))
      if (!applied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 83 || move.data.effect === 180) {
      const forbiddenEffects = new Set([9, 26, 82, 83, 89, 94, 95, 97, 98, 111, 116, 127, 144, 170, 172, 176, 177, 180, 183, 194, 195, 223, 241, 242, 248])
      const candidates = move.data.effect === 83
        ? catalog.moves.filter((candidate) => candidate && candidate.moveId !== 165 && !forbiddenEffects.has(candidate.effect))
        : actor.party.filter((member, index) => index !== actor.activePartyIndex && !member.isEgg).flatMap((member) => member.moves.map(({ data }) => data)).filter((candidate) => candidate.moveId !== move.moveId && !forbiddenEffects.has(candidate.effect))
      const invoked = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length] : undefined
      if (!invoked || !invokeMove(invoked)) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 241) {
      const planned = session.plannedMoves.get(`${action.target.side}:${action.target.slot}`)
      const applied = Boolean(planned && planned.category !== 2 && !target.volatile.actedThisTurn)
      if (planned && applied && !invokeMove({ ...planned, power: Math.floor(planned.power * 3 / 2) })) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      else if (!applied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 84) {
      const applied = !target.types.includes(12) && target.volatile.seededBy === undefined
      if (applied) target.volatile.seededBy = { ...action.actor }
      events.push({ kind: 'condition', target: action.target, condition: 'leechSeed', applied })
      handled = true
    } else if (move.data.effect === 107) {
      const applied = (targetPokemon.status & 0x7) !== 0 && !target.volatile.nightmare
      if (applied) target.volatile.nightmare = true
      events.push({ kind: 'condition', target: action.target, condition: 'nightmare', applied })
      handled = true
    } else if (move.data.effect === 114) {
      let applied = false
      for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) if (activePokemon(participant).currentHp > 0 && activeBattleAbilityId(participant) !== 43 && participant.volatile.perishTurns === 0) {
        participant.volatile.perishTurns = 3
        applied = true
      }
      events.push({ kind: 'condition', target: action.actor, condition: 'perishSong', applied })
      handled = true
    } else if (move.data.effect === 179) {
      const occupied = session.wishes.some(({ target: pending }) => pending.side === action.actor.side && pending.slot === action.actor.slot)
      if (!occupied) session.wishes.push({ turns: 2, target: { ...action.actor }, amount: Math.max(1, Math.floor(pokemon.stats.hp / 2)) })
      events.push({ kind: 'condition', target: action.actor, condition: 'wish', applied: !occupied })
      handled = true
    } else if (move.data.effect === 79) {
      const cost = Math.max(1, Math.floor(pokemon.stats.hp / 4))
      const applied = actor.volatile.substituteHp === 0 && pokemon.currentHp > cost
      if (applied) { pokemon.currentHp -= cost; actor.volatile.substituteHp = cost }
      events.push({ kind: 'condition', target: action.actor, condition: 'substitute', applied })
      handled = true
    } else if (move.data.effect === 183 || move.data.effect === 195) {
      const field = move.data.effect === 183 ? 'magicCoat' : 'snatch'
      const applied = !actor.volatile[field]
      actor.volatile[field] = true
      events.push({ kind: 'condition', target: action.actor, condition: field, applied })
      handled = true
    } else if (move.data.effect === 214) {
      const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 2)))
      pokemon.currentHp += amount
      actor.volatile.roosted = true
      events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount })
      handled = true
    } else if (move.data.effect === 94) {
      actor.volatile.lockOnTarget = { ...action.target }; actor.volatile.lockOnTurns = 2
      events.push({ kind: 'condition', target: action.target, condition: 'lockOn', applied: true })
      handled = true
    } else if (move.data.effect === 113 || move.data.effect === 216) {
      if (move.data.effect === 113) target.volatile.identifiedGhost = true
      else target.volatile.identifiedDark = true
      target.stages.evasion = 0
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 113 ? 'foresight' : 'miracleEye', applied: true })
      handled = true
    } else if (move.data.effect === 109) {
      if (actor.types.includes(7)) {
        const applied = !target.volatile.cursed && pokemon.currentHp > Math.floor(pokemon.stats.hp / 2)
        if (applied) { pokemon.currentHp -= Math.floor(pokemon.stats.hp / 2); target.volatile.cursed = true }
        events.push({ kind: 'condition', target: action.target, condition: 'curse', applied })
      } else {
        applyDoubleStageChange(actor, action.actor, 'attack', 1, events)
        applyDoubleStageChange(actor, action.actor, 'defense', 1, events)
        applyDoubleStageChange(actor, action.actor, 'speed', -1, events)
      }
      handled = true
    } else if (move.data.effect === 220 || move.data.effect === 270) {
      session.healingWishes.push({ target: { ...action.actor }, lunar: move.data.effect === 270 })
      pokemon.currentHp = 0
      events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
      handled = true
    } else if (move.data.effect === 112 || move.data.effect === 249 || move.data.effect === 266) {
      const affectedSide = action.actor.side === 'player' ? 'opponent' : 'player'
      const conditions = session.sideConditions[affectedSide]
      const before = move.data.effect === 112 ? conditions.spikesLayers : move.data.effect === 249 ? conditions.toxicSpikesLayers : Number(conditions.stealthRock)
      if (move.data.effect === 112) conditions.spikesLayers = Math.min(3, conditions.spikesLayers + 1)
      else if (move.data.effect === 249) conditions.toxicSpikesLayers = Math.min(2, conditions.toxicSpikesLayers + 1)
      else conditions.stealthRock = true
      const after = move.data.effect === 112 ? conditions.spikesLayers : move.data.effect === 249 ? conditions.toxicSpikesLayers : Number(conditions.stealthRock)
      events.push({ kind: 'condition', target: action.target, condition: move.data.effect === 112 ? 'spikes' : move.data.effect === 249 ? 'toxicSpikes' : 'stealthRock', applied: after > before })
      handled = true
    } else if (move.data.effect === 258) {
      applyDoubleStageChange(target, action.target, 'evasion', -1, events)
      for (const side of ['player', 'opponent'] as const) {
        const conditions = session.sideConditions[side]
        conditions.spikesLayers = 0; conditions.toxicSpikesLayers = 0; conditions.stealthRock = false
      }
      session.sideConditions[action.target.side].reflectTurns = 0
      session.sideConditions[action.target.side].lightScreenTurns = 0
      events.push({ kind: 'condition', target: action.target, condition: 'fieldCleared', applied: true })
      handled = true
    } else if (move.data.effect === 232) {
      const applied = target.volatile.embargoTurns === 0
      target.volatile.embargoTurns = 5
      events.push({ kind: 'condition', target: action.target, condition: 'embargo', applied })
      handled = true
    } else if (move.data.effect === 93) {
      const attackingType = actor.volatile.lastDamageMoveType
      const candidates = Array.from({ length: 18 }, (_, type) => type).filter((type) => attackingType >= 0 && calculateHgssTypeMultiplier(attackingType, [type, type]) < 10)
      const type = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length] : undefined
      if (type !== undefined) actor.types = [type, type]
      events.push({ kind: 'condition', target: action.actor, condition: 'conversion2', applied: type !== undefined })
      handled = true
    } else if (move.data.effect === 98 || move.data.effect === 194) {
      if (move.data.effect === 98) actor.volatile.destinyBond = true
      else actor.volatile.grudge = true
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 98 ? 'destinyBond' : 'grudge', applied: true })
      handled = true
    } else if (move.data.effect === 238) {
      actor.volatile.powerTrick = !actor.volatile.powerTrick
      events.push({ kind: 'condition', target: action.actor, condition: 'powerTrick', applied: true })
      handled = true
    } else if (move.data.effect === 28) {
      const reserves = getDoubleBattleReserveIndexes(session, action.target, 'forced-replacement', invocation.playerTeamPolicy)
      const next = targetAbilityId !== 21 && !target.volatile.ingrain && reserves.length > 0 ? reserves[rng.nextU16() % reserves.length] : undefined
      const applied = next !== undefined && switchDoubleBattleParticipant(session, action.target, next, catalog, rng, events, { forced: true, playerTeamPolicy: invocation.playerTeamPolicy })
      if (!applied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 106) {
      const applied = !target.volatile.cannotSwitch
      target.volatile.cannotSwitch = true
      events.push({ kind: 'condition', target: action.target, condition: 'trappedSwitch', applied })
      handled = true
    } else if (move.data.effect === 127) {
      const reserves = getDoubleBattleReserveIndexes(session, action.actor, 'forced-replacement', invocation.playerTeamPolicy)
      const next = action.switchPartyIndex !== undefined && reserves.includes(action.switchPartyIndex) ? action.switchPartyIndex : reserves[0]
      const applied = next !== undefined && switchDoubleBattleParticipant(session, action.actor, next, catalog, rng, events, { batonPass: true, playerTeamPolicy: invocation.playerTeamPolicy })
      if (!applied) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 153) {
      events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      handled = true
    } else if (move.data.effect === 9 || move.data.effect === 95) {
      const copied = target.volatile.lastMoveData
      const applied = Boolean(copied && copied.effect !== 9 && copied.effect !== 95 && action.moveIndex >= 0)
      if (copied && applied) {
        if (move.data.effect === 9 && !actor.volatile.mimicOriginalMoves.has(action.moveIndex)) actor.volatile.mimicOriginalMoves.set(action.moveIndex, { ...pokemon.moves[action.moveIndex]!, data: { ...pokemon.moves[action.moveIndex]!.data } })
        pokemon.moves[action.moveIndex] = { moveId: copied.moveId, pp: copied.pp, maxPp: copied.pp, ppUps: 0, data: { ...copied } }
      }
      events.push({ kind: 'condition', target: action.actor, condition: move.data.effect === 9 ? 'mimic' : 'sketch', applied })
      handled = true
    } else if (move.data.effect === 57) {
      const applied = !actor.volatile.transformOriginal && target.volatile.substituteHp === 0
      if (applied) {
        actor.volatile.transformOriginal = { types: actor.types, stats: { ...pokemon.stats }, moves: pokemon.moves.map((knownMove) => ({ ...knownMove, data: { ...knownMove.data } })) }
        actor.types = target.types
        pokemon.stats = { ...targetPokemon.stats, hp: pokemon.stats.hp }
        pokemon.moves = targetPokemon.moves.map((knownMove) => ({ ...knownMove, pp: Math.min(5, knownMove.maxPp), maxPp: Math.min(5, knownMove.maxPp), ppUps: 0, data: { ...knownMove.data } }))
        actor.stages = { ...target.stages }
        actor.volatile.abilityOverrideId = activeBattleAbilityId(target)
      }
      events.push({ kind: 'condition', target: action.actor, condition: 'transform', applied })
      handled = true
    }
    if (!handled) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  if (move.data.effect === 248) {
    const planned = session.plannedMoves.get(`${action.target.side}:${action.target.slot}`)
    if (!planned || planned.category === 2 || target.volatile.actedThisTurn) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
  }
  const defenderTypes: readonly [number, number] = target.volatile.roosted && target.types.includes(2)
    ? target.types[0] === 2 && target.types[1] === 2 ? [0, 0] : [target.types[0] === 2 ? target.types[1] : target.types[0], target.types[0] === 2 ? target.types[1] : target.types[0]]
    : target.types
  if (move.data.effect === 8 && (targetPokemon.status & 0x7) === 0) {
    events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
    return
  }
  let baseDamageMove = move.data
  let flungItem: { effect: number, parameter: number } | undefined
  if (move.data.effect === 122) {
    const roll = rng.nextU16() % 10
    if (roll >= 8) {
      const amount = Math.min(targetPokemon.stats.hp - targetPokemon.currentHp, Math.max(1, Math.floor(targetPokemon.stats.hp / 4)))
      targetPokemon.currentHp += amount
      events.push({ kind: 'heal', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, amount })
      return
    }
    baseDamageMove = { ...move.data, power: roll < 4 ? 40 : roll < 7 ? 80 : 120 }
  } else if (move.data.effect === 171 && (targetPokemon.status & 0x40) !== 0) baseDamageMove = { ...move.data, power: move.data.power * 2 }
  else if (move.data.effect === 222) {
    const item = session.itemCatalog?.items[pokemon.heldItemId]
    if (!item || item.fieldPocket !== 4 || item.naturalGiftPower <= 0 || actorAbilityId === 103 || actor.volatile.embargoTurns > 0) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
    baseDamageMove = { ...move.data, power: item.naturalGiftPower, type: item.naturalGiftType }
  } else if (move.data.effect === 233) {
    const item = session.itemCatalog?.items[pokemon.heldItemId]
    if (!item || item.flingPower <= 0 || actorAbilityId === 103 || actor.volatile.embargoTurns > 0 || !canTransferDoubleHeldItem(session, pokemon, pokemon.heldItemId)) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
    baseDamageMove = { ...move.data, power: item.flingPower }
    flungItem = { effect: item.flingEffect, parameter: item.holdEffectParameter }
  } else if (move.data.effect === 161) {
    if (actor.volatile.stockpile === 0) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
    baseDamageMove = { ...move.data, power: actor.volatile.stockpile * 100 }
  } else if (move.data.effect === 126) {
    const magnitude = resolveHgssMagnitudePower(rng.nextU16() % 100)
    baseDamageMove = { ...move.data, power: magnitude.power }
    events.push({ kind: 'condition', target: action.actor, condition: `magnitude:${magnitude.level}`, applied: true })
  } else if (move.data.effect === 135) baseDamageMove = { ...move.data, ...resolveHgssHiddenPower(pokemon.individualValues) }
  else if (move.data.effect === 235) baseDamageMove = { ...move.data, power: invocation.invokedMove ? 40 : resolveHgssTrumpCardPower(move.pp) }
  else if (move.data.effect === 268) baseDamageMove = { ...move.data, type: resolveHgssPlateType(pokemon.heldItemId) ?? move.data.type }
  const damageMove = resolveHgssContextualDamageMove(baseDamageMove, {
    weather: activeWeather, rolloutCount: actor.volatile.rolloutCount, defenseCurl: actor.volatile.defenseCurl,
    targetMinimized: target.volatile.minimized, targetSemiInvulnerable: target.volatile.semiInvulnerable,
    furyCutterCount: actor.volatile.furyCutterCount, attackerDamagedThisTurn: actor.volatile.lastDamageTaken > 0,
    targetActedThisTurn: target.volatile.actedThisTurn, targetDamagedThisTurn: target.volatile.lastDamageTaken > 0,
    targetSwitching: session.switchingPositions.has(`${action.target.side}:${action.target.slot}`),
  })
  if (move.data.effect === 186) {
    session.sideConditions[action.target.side].reflectTurns = 0
    session.sideConditions[action.target.side].lightScreenTurns = 0
  }
  const fixedDamage = move.data.effect === 38 ? targetPokemon.currentHp
    : move.data.effect === 40 ? Math.max(1, Math.floor(targetPokemon.currentHp / 2))
      : move.data.effect === 41 ? 40 : move.data.effect === 87 ? pokemon.level
        : move.data.effect === 101 ? Math.max(0, targetPokemon.currentHp - 1) : move.data.effect === 130 ? 10
          : move.data.effect === 88 ? Math.max(1, Math.floor(pokemon.level * (50 + rng.nextU16() % 101) / 100))
            : move.data.effect === 89 && actor.volatile.lastDamageCategory === 0 ? actor.volatile.lastDamageTaken * 2
              : move.data.effect === 144 && actor.volatile.lastDamageCategory === 1 ? actor.volatile.lastDamageTaken * 2
                : move.data.effect === 189 ? Math.max(0, targetPokemon.currentHp - pokemon.currentHp)
                  : move.data.effect === 227 && actor.volatile.lastDamageCategory !== -1 ? Math.floor(actor.volatile.lastDamageTaken * 3 / 2)
                    : move.data.effect === 26 ? actor.volatile.bideDamage * 2 : undefined
  const beatUpMembers = move.data.effect === 154 ? actor.party.filter((member) => !member.isEgg && member.currentHp > 0 && member.status === 0) : undefined
  if (beatUpMembers?.length === 0) { events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name }); return }
  const hitRoll = rng.nextU16() % 8
  const hitCount = beatUpMembers?.length ?? (move.data.effect === 44 ? 2 : move.data.effect === 104 ? 3
    : move.data.effect === 29 || move.data.effect === 77 ? actorAbilityId === 92 ? 5 : hitRoll < 3 ? 2 : hitRoll < 6 ? 3 : hitRoll === 6 ? 4 : 5 : 1
  )
  const defenderAbilityApplies = actorAbilityId !== 104
  const absorbingAbility = defenderAbilityApplies && (damageMove.type === 13 && targetAbilityId === 10
    || damageMove.type === 11 && (targetAbilityId === 11 || targetAbilityId === 87))
  if (absorbingAbility) {
    const amount = target.volatile.healBlockTurns > 0
      ? 0
      : Math.min(targetPokemon.stats.hp - targetPokemon.currentHp, Math.max(1, Math.floor(targetPokemon.stats.hp / 4)))
    targetPokemon.currentHp += amount
    events.push({ kind: 'damage', movePresentationId, target: action.target, damage: 0, critical: false, typeMultiplier: 0 })
    events.push({ kind: 'condition', target: action.target, condition: `ability:${targetAbilityId}`, applied: true })
    if (amount > 0) events.push({ kind: 'heal', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, amount })
    return
  }
  if (defenderAbilityApplies && damageMove.type === 13 && targetAbilityId === 78) {
    events.push({ kind: 'damage', movePresentationId, target: action.target, damage: 0, critical: false, typeMultiplier: 0 })
    events.push({ kind: 'condition', target: action.target, condition: `ability:${targetAbilityId}`, applied: true })
    const before = target.stages.speed
    target.stages.speed = Math.min(6, before + 1)
    events.push({ kind: 'stat', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, stat: 'speed', change: 1, applied: target.stages.speed !== before })
    return
  }
  if (defenderAbilityApplies && damageMove.type === 10 && targetAbilityId === 18) {
    const applied = !target.volatile.flashFire
    target.volatile.flashFire = true
    events.push({ kind: 'damage', movePresentationId, target: action.target, damage: 0, critical: false, typeMultiplier: 0 })
    events.push({ kind: 'condition', target: action.target, condition: 'flashFire', applied })
    return
  }
  let dealtDamage = 0
  let anyCritical = false
  let typeMultiplier = 10
  let actualHits = 0
  let substituteWasHit = false
  for (let hit = 0; hit < hitCount && targetPokemon.currentHp > 0; hit += 1) {
    const criticalStage = Math.min(4, ([39, 43, 75, 200, 209].includes(move.data.effect) ? 1 : 0) + (actor.volatile.focusEnergy ? 2 : 0) + (actorAbilityId === 105 ? 1 : 0) + resolveHgssHeldCriticalStage(actorHeld, pokemon.speciesId)), criticalDenominator = [16, 8, 4, 3, 2][criticalStage]!
    const critical = session.sideConditions[action.target.side].luckyChantTurns === 0 && targetAbilityId !== 4 && targetAbilityId !== 75 && rng.nextU16() % criticalDenominator === 0
    const beatUpMember = beatUpMembers?.[hit]
    const beatUpAttack = beatUpMember ? catalog.personalData[beatUpMember.speciesId]?.baseStats.attack : undefined
    const beatUpDefense = beatUpMember ? catalog.personalData[targetPokemon.speciesId]?.baseStats.defense : undefined
    const damage = calculateHgssMoveDamage({ attacker: beatUpMember ? { ...beatUpMember, abilityId: 0, stats: { ...beatUpMember.stats, attack: beatUpAttack ?? beatUpMember.stats.attack } } : { ...effectiveDoubleBattlePokemon(actor), stats: applyHgssHeldAttackStats(effectiveDoubleBattlePokemon(actor).stats, actorHeld, damageMove.category, pokemon.speciesId), abilityId: actorAbilityId }, defender: beatUpMember ? { ...targetPokemon, abilityId: 0, stats: { ...targetPokemon.stats, defense: beatUpDefense ?? targetPokemon.stats.defense } } : { ...effectiveDoubleBattlePokemon(target), stats: applyHgssHeldBattleStats(effectiveDoubleBattlePokemon(target).stats, targetHeld, targetPokemon.speciesId, 'defender'), abilityId: targetAbilityId }, attackerTypes: beatUpMember ? [18, 18] : actor.types, defenderTypes, attackerStages: beatUpMember ? neutralBattleStatStages : actor.stages, defenderStages: beatUpMember ? neutralBattleStatStages : target.stages, move: damageMove, rng, criticalMultiplier: critical ? actorAbilityId === 97 ? 3 : 2 : 1, defenderWeightTenthsKg: catalog.weightsTenthsKg?.[targetPokemon.speciesId], ignoreGroundImmunity: session.gravityTurns > 0 || target.volatile.roosted, grantGroundImmunity: session.gravityTurns === 0 && !target.volatile.roosted && target.volatile.magnetRiseTurns > 0, identifyGhost: target.volatile.identifiedGhost, identifyDark: target.volatile.identifiedDark, weather: activeWeather, attackerPlusMinusPartner: actorAbilityId === 57 ? hasDoubleBattleActiveAbility(session, action.actor.side, 58, actor) : actorAbilityId === 58 && hasDoubleBattleActiveAbility(session, action.actor.side, 57, actor), attackerFlowerGiftActive: hasDoubleBattleActiveAbility(session, action.actor.side, 122), defenderFlowerGiftActive: hasDoubleBattleActiveAbility(session, action.target.side, 122), attackerTurnsActive: actor.volatile.turnsActive })
    let modifiedDamage = fixedDamage ?? damage.damage
    if (fixedDamage !== undefined && (damage.typeMultiplier === 0 || move.data.effect === 38 && targetAbilityId === 5)) modifiedDamage = 0
    if (fixedDamage === undefined && activeWeather === 'rain') modifiedDamage = damageMove.type === 11
      ? Math.floor(modifiedDamage * 3 / 2) : damageMove.type === 10 ? Math.floor(modifiedDamage / 2) : modifiedDamage
    else if (fixedDamage === undefined && activeWeather === 'sun') modifiedDamage = damageMove.type === 10
      ? Math.floor(modifiedDamage * 3 / 2) : damageMove.type === 11 ? Math.floor(modifiedDamage / 2) : modifiedDamage
    if (fixedDamage === undefined && damageMove.type === 10 && actor.volatile.flashFire) modifiedDamage = Math.floor(modifiedDamage * 3 / 2)
    if (fixedDamage === undefined && damageMove.type === 13 && actor.volatile.charged) modifiedDamage *= 2
    if (fixedDamage === undefined && damageMove.type === 13 && (actor.volatile.mudSport || target.volatile.mudSport)) modifiedDamage = Math.floor(modifiedDamage / 2)
    if (fixedDamage === undefined && damageMove.type === 10 && (actor.volatile.waterSport || target.volatile.waterSport)) modifiedDamage = Math.floor(modifiedDamage / 2)
    if (fixedDamage === undefined && actor.volatile.helpingHand) modifiedDamage = Math.floor(modifiedDamage * 3 / 2)
    if (fixedDamage === undefined) modifiedDamage = applyHgssHeldDamageBoost(modifiedDamage, actorHeld, damageMove.type, damageMove.category, damage.typeMultiplier, { speciesId: pokemon.speciesId, transformed: Boolean(actor.volatile.transformOriginal), metronomeTurns: actor.volatile.metronomeTurns })
    if (fixedDamage === undefined && !critical && damageMove.category === 0 && session.sideConditions[action.target.side].reflectTurns > 0) modifiedDamage = Math.floor(modifiedDamage / 2)
    if (fixedDamage === undefined && !critical && damageMove.category === 1 && session.sideConditions[action.target.side].lightScreenTurns > 0) modifiedDamage = Math.floor(modifiedDamage / 2)
    const spreadDamage = options.spread ? Math.max(1, Math.floor(modifiedDamage * 3 / 4)) : modifiedDamage
    let hitDamage = Math.min(targetPokemon.currentHp, target.volatile.endured && spreadDamage >= targetPokemon.currentHp
      ? Math.max(0, targetPokemon.currentHp - 1)
      : spreadDamage)
    if (target.volatile.substituteHp > 0 && hitDamage > 0 && move.data.effect !== 223) {
      substituteWasHit = true
      target.volatile.substituteHp = Math.max(0, target.volatile.substituteHp - hitDamage)
      events.push({ kind: 'condition', target: action.target, condition: target.volatile.substituteHp > 0 ? 'substituteHit' : 'substituteBroken', applied: true })
      hitDamage = 0
    }
    if (hitDamage > 0) hitDamage = applyDoubleBattleIncomingHeldItem(session, action.target, hitDamage, damageMove.type, damage.typeMultiplier, hit === 0, rng, events)
    targetPokemon.currentHp = Math.max(0, targetPokemon.currentHp - hitDamage)
    if (target.volatile.bideTurns > 0) target.volatile.bideDamage += hitDamage
    dealtDamage += hitDamage
    anyCritical ||= critical
    typeMultiplier = damage.typeMultiplier
    actualHits += 1
  }
  events.push({ kind: 'damage', movePresentationId, target: action.target, damage: dealtDamage, critical: anyCritical, typeMultiplier })
  if (move.data.effect === 34 && typeMultiplier > 0 && dealtDamage > 0) {
    session.payDayCoins += pokemon.level * 5
    events.push({ kind: 'condition', target: action.actor, condition: 'payDay', applied: true })
  }
  if (dealtDamage > 0) {
    target.volatile.lastDamageTaken = dealtDamage
    target.volatile.lastDamageCategory = damageMove.category === 1 ? 1 : 0
    target.volatile.lastDamageMoveType = damageMove.type
  } else if ([38, 89, 144, 189, 227].includes(move.data.effect)) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
  if (hitCount > 1) events.push({ kind: 'multiHit', hits: actualHits })
  applyDoubleBattlePostHitAbilities({ attacker: pokemon, defender: targetPokemon, attackerState: actor, defenderState: target, attackerPosition: action.actor, defenderPosition: action.target, attackerAbilityId: actorAbilityId, defenderAbilityId: targetAbilityId, attackerHeldEffect: actorHeld.effect, defenderTypes: target.types, defenderAttackStage: target.stages.attack, move: move.data, moveType: actorAbilityId === 96 ? 0 : damageMove.type, dealtDamage, substituteWasHit, critical: anyCritical, attackerInfatuated: actor.volatile.infatuated, attackerSafeguarded: session.sideConditions[action.actor.side].safeguardTurns > 0, dampActive: (['player', 'opponent'] as const).some((side) => session.teams[side].some((member) => activePokemon(member).currentHp > 0 && activeBattleAbilityId(member) === 6)), weather: activeWeather }, rng, events); applyDoubleBattleOnHitHeldItem(session, action.actor, action.target, { damageCategory: damageMove.category, moveFlags: move.data.flags, moveEffect: move.data.effect, dealtDamage, typeMultiplier, substituteWasHit }, events)
  if (options.consumeTurn && move.data.power > 0) actor.volatile.charged = false
  if (targetPokemon.currentHp > 0 && dealtDamage > 0) {
    const status = session.sideConditions[action.target.side].safeguardTurns === 0 ? applySupportedHgssPrimaryStatus(move.data, targetPokemon, target.types, rng, targetAbilityId, actorAbilityId, { weather: activeWeather }) : undefined
    emitMoveStatus(status)
    const stat = applySupportedHgssStatusMoveEffect(move.data, actor.stages, target.stages, rng, actorAbilityId, targetAbilityId)
    if (stat) events.push({ kind: 'stat', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, ...stat })
    if (move.data.effect === 36 && session.sideConditions[action.target.side].safeguardTurns === 0 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) {
      const statusKind = (['paralysis', 'burn', 'freeze'] as const)[rng.nextU16() % 3]!
      emitMoveStatus(applyHgssPrimaryStatus(statusKind, targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
    }
    if (canHgssPokemonFlinch(targetAbilityId) && ([31, 92, 146].includes(move.data.effect) && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId) || move.data.effect === 158 && actor.volatile.turnsActive === 0)) target.volatile.flinched = true
    if (doesHgssHeldItemFlinch(actorHeld, move.data.flags, dealtDamage, targetAbilityId, rng.nextU16())) target.volatile.flinched = true
    if (move.data.effect === 76 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId) && target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbilityId, session.sideConditions[action.target.side].safeguardTurns > 0, actorAbilityId === 104)) {
      target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, state: 'started' })
    }
    if (move.data.effect === 260 && session.sideConditions[action.target.side].safeguardTurns === 0 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) {
      emitMoveStatus(applyHgssPrimaryStatus('freeze', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
    }
    if (move.data.effect === 152 && session.sideConditions[action.target.side].safeguardTurns === 0 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) {
      emitMoveStatus(applyHgssPrimaryStatus('paralysis', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
    }
    if (move.data.effect === 263 && session.sideConditions[action.target.side].safeguardTurns === 0 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) {
      emitMoveStatus(applyHgssPrimaryStatus('paralysis', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
    }
    if (session.sideConditions[action.target.side].safeguardTurns === 0) {
      if ([202, 209].includes(move.data.effect) && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) emitMoveStatus(applyHgssPrimaryStatus('poison', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
      if ([125, 200, 253, 273].includes(move.data.effect) && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) emitMoveStatus(applyHgssPrimaryStatus('burn', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
      if (move.data.effect === 274 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) emitMoveStatus(applyHgssPrimaryStatus('freeze', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
      if ([262, 275].includes(move.data.effect) && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) emitMoveStatus(applyHgssPrimaryStatus('paralysis', targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
    }
    if (canHgssPokemonFlinch(targetAbilityId) && [273, 274, 275].includes(move.data.effect) && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) target.volatile.flinched = true
    if (move.data.effect === 267 && pokemon.speciesId === 441 && doesHgssSecondaryEffectOccur(10, rng, actorAbilityId, targetAbilityId) && target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbilityId, session.sideConditions[action.target.side].safeguardTurns > 0, actorAbilityId === 104)) {
      target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, state: 'started' })
    }
    if (move.data.effect === 197 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) {
      const terrainEffect = catalog.secretPowerEffectIds?.[session.terrainId]
      const terrainStatus = terrainEffect === 1 ? 'sleep' : terrainEffect === 4 ? 'freeze' : terrainEffect === 5 ? 'paralysis' : undefined
      if (terrainStatus) emitMoveStatus(applyHgssPrimaryStatus(terrainStatus, targetPokemon, target.types, rng, targetAbilityId, { weather: activeWeather, ignoreTargetAbility: actorAbilityId === 104 }))
      else if (terrainEffect === 8 && canHgssPokemonFlinch(targetAbilityId)) target.volatile.flinched = true
      else if (terrainEffect === 0x16) applyDoubleStageChange(target, action.target, 'attack', -1, events)
      else if (terrainEffect === 0x18) applyDoubleStageChange(target, action.target, 'speed', -1, events)
      else if (terrainEffect === 0x1b) applyDoubleStageChange(target, action.target, 'accuracy', -1, events)
      else if (terrainEffect === 0x1c) applyDoubleStageChange(target, action.target, 'evasion', -1, events)
    }
    if (move.data.effect === 182) for (const statName of ['attack', 'defense'] as const) {
      const before = actor.stages[statName]
      actor.stages[statName] = Math.max(-6, before - 1)
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: statName, change: -1, applied: before > -6 })
    }
    if (move.data.effect === 138) applyDoubleStageChange(actor, action.actor, 'defense', 1, events)
    else if (move.data.effect === 139) applyDoubleStageChange(actor, action.actor, 'attack', 1, events)
    else if (move.data.effect === 140 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId)) for (const statName of ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const) applyDoubleStageChange(actor, action.actor, statName, 1, events)
    else if (move.data.effect === 204) applyDoubleStageChange(actor, action.actor, 'specialAttack', -2, events)
    else if (move.data.effect === 218) applyDoubleStageChange(actor, action.actor, 'speed', -1, events)
    else if (move.data.effect === 229) for (const statName of ['defense', 'specialDefense'] as const) applyDoubleStageChange(actor, action.actor, statName, -1, events)
    else if (move.data.effect === 271 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId, targetAbilityId)) applyDoubleStageChange(target, action.target, 'specialDefense', -2, events)
    if (move.data.effect === 276 && doesHgssSecondaryEffectOccur(move.data.effectChance, rng, actorAbilityId)) {
      const before = actor.stages.specialAttack
      actor.stages.specialAttack = Math.min(6, before + 1)
      events.push({ kind: 'stat', target: action.actor, pokemonName: name, stat: 'specialAttack', change: 1, applied: before < 6 })
    }
  }
  if ((move.data.effect === 3 || move.data.effect === 8) && dealtDamage > 0 && pokemon.currentHp > 0) {
    const drain = resolveHgssDrain({ dealtDamage, attackerCurrentHp: pokemon.currentHp, attackerMaximumHp: pokemon.stats.hp, attackerAbilityId: actorAbilityId, defenderAbilityId: targetAbilityId, healBlocked: actor.volatile.healBlockTurns > 0, leechBoostPercent: actorHeld.effect === 124 ? actorHeld.parameter : undefined })
    if (drain.kind === 'heal') { pokemon.currentHp += drain.amount; events.push({ kind: 'heal', target: action.actor, pokemonName: name, amount: drain.amount }) }
    else if (drain.kind === 'damage') { pokemon.currentHp -= drain.amount; events.push({ kind: 'condition', target: action.actor, condition: 'ability:64', applied: true }, { kind: 'recoil', target: action.actor, pokemonName: name, damage: drain.amount }); if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) }) }
  }
  applyDoubleBattlePostDamageHeldItem(session, action.actor, dealtDamage, events)
  if (move.data.effect === 217 && dealtDamage > 0) targetPokemon.status &= ~0x7
  if (move.data.effect === 171 && dealtDamage > 0) targetPokemon.status &= ~0x40
  if (move.data.effect === 81 && dealtDamage > 0) actor.volatile.rage = true
  if (move.data.effect === 117) {
    actor.volatile.rolloutCount += 1
    if (dealtDamage > 0 && targetPokemon.currentHp > 0 && actor.volatile.rolloutCount < 5) actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
    else { actor.volatile.rolloutCount = 0; actor.volatile.chargingMove = undefined }
  }
  if (move.data.effect === 119) actor.volatile.furyCutterCount = dealtDamage > 0 ? Math.min(5, actor.volatile.furyCutterCount + 1) : 0
  if (move.data.effect === 26) { actor.volatile.bideTurns = 0; actor.volatile.bideDamage = 0 }
  if (move.data.effect === 27 && dealtDamage > 0 && pokemon.currentHp > 0) {
    if (!continuingCharge) actor.volatile.rampageTurns = 1 + rng.nextU16() % 2
    else actor.volatile.rampageTurns -= 1
    if (actor.volatile.rampageTurns > 0) actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
    else if (actor.volatile.confusionTurns === 0 && canHgssConfuse(actorAbilityId)) {
      actor.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', target: action.actor, pokemonName: name, state: 'started' })
    }
  }
  if (move.data.effect === 159 && dealtDamage > 0 && pokemon.currentHp > 0) {
    for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) activePokemon(participant).status &= ~0x7
    if (!continuingCharge) actor.volatile.uproarTurns = 2
    else actor.volatile.uproarTurns -= 1
    if (actor.volatile.uproarTurns > 0) actor.volatile.chargingMove = { moveIndex: action.moveIndex, target: action.target }
  }
  if (move.data.effect === 129 && dealtDamage > 0) {
    const conditions = session.sideConditions[action.actor.side]
    conditions.spikesLayers = 0; conditions.toxicSpikesLayers = 0; conditions.stealthRock = false
    actor.volatile.trappedTurns = 0
    events.push({ kind: 'condition', target: action.actor, condition: 'rapidSpinClear', applied: true })
  }
  if (move.data.effect === 228 && dealtDamage > 0 && pokemon.currentHp > 0) {
    const reserves = getDoubleBattleReserveIndexes(session, action.actor, 'forced-replacement', invocation.playerTeamPolicy)
    const next = action.switchPartyIndex !== undefined && reserves.includes(action.switchPartyIndex) ? action.switchPartyIndex : reserves[0]
    if (next !== undefined) switchDoubleBattleParticipant(session, action.actor, next, catalog, rng, events, { phase: 'forced-replacement', playerTeamPolicy: invocation.playerTeamPolicy })
  }
  if (move.data.effect === 222 && pokemon.heldItemId !== 0) consumeDoubleHeldItem(actor)
  if (move.data.effect === 233 && pokemon.heldItemId !== 0) {
    consumeDoubleHeldItem(actor)
    if (flungItem && targetPokemon.currentHp > 0 && !substituteWasHit && target.volatile.embargoTurns === 0) applyDoubleConsumedItemEffect(session, action.target, flungItem.effect, flungItem.parameter, rng, events)
  }
  if (move.data.effect === 224 && dealtDamage > 0 && targetPokemon.currentHp > 0 && !substituteWasHit && targetPokemon.heldItemId !== 0 && !isHgssHeldItemRemovalBlocked(targetAbilityId, actorAbilityId, true)) {
    const item = session.itemCatalog?.items[targetPokemon.heldItemId]
    if (item?.fieldPocket === 4) {
      consumeDoubleHeldItem(target)
      if (actorAbilityId !== 103 && actor.volatile.embargoTurns === 0) applyDoubleConsumedItemEffect(session, action.actor, item.pluckEffect, item.holdEffectParameter, rng, events)
    }
  }
  if (move.data.effect === 105 && dealtDamage > 0 && pokemon.heldItemId === 0 && targetPokemon.heldItemId !== 0 && !isHgssHeldItemRemovalBlocked(targetAbilityId, actorAbilityId, true) && canTransferDoubleHeldItem(session, pokemon, targetPokemon.heldItemId)) {
    pokemon.heldItemId = targetPokemon.heldItemId; actor.volatile.canUnburden = true
    targetPokemon.heldItemId = 0
    events.push({ kind: 'condition', target: action.actor, condition: 'itemStolen', applied: true })
  }
  if (move.data.effect === 188 && dealtDamage > 0 && targetPokemon.heldItemId !== 0 && !isHgssHeldItemRemovalBlocked(targetAbilityId, actorAbilityId, true) && canTransferDoubleHeldItem(session, targetPokemon, targetPokemon.heldItemId)) {
    targetPokemon.heldItemId = 0
    events.push({ kind: 'condition', target: action.target, condition: 'itemKnockedOff', applied: true })
  }
  if (move.data.effect === 161) {
    const count = actor.volatile.stockpile
    applyDoubleStageChange(actor, action.actor, 'defense', -count, events)
    applyDoubleStageChange(actor, action.actor, 'specialDefense', -count, events)
    actor.volatile.stockpile = 0
  }
  if (move.data.effect === 80 && dealtDamage > 0 && pokemon.currentHp > 0) actor.volatile.rechargeTurns = 1
  if (dealtDamage > 0 && targetPokemon.currentHp > 0 && target.volatile.rage) {
    const before = target.stages.attack
    target.stages.attack = Math.min(6, before + 1)
    events.push({ kind: 'stat', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, stat: 'attack', change: 1, applied: before < 6 })
  }
  if ((move.data.effect === 42 || move.data.effect === 261) && dealtDamage > 0 && targetPokemon.currentHp > 0 && target.volatile.trappedTurns === 0) {
    target.volatile.trappedTurns = actorHeld.effect === 114 ? 6 : 3 + rng.nextU16() % 3
    events.push({ kind: 'condition', target: action.target, condition: 'trapped', applied: true })
  }
  if (move.data.effect === 7 && pokemon.currentHp > 0) {
    pokemon.currentHp = 0
    events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
  }
  if ([48, 198, 253, 262, 269].includes(move.data.effect) && dealtDamage > 0 && pokemon.currentHp > 0 && actorAbilityId !== 69) {
    const divisor = move.data.effect === 269 ? 2 : move.data.effect === 48 ? 4 : 3
    const recoil = Math.min(pokemon.currentHp, Math.max(1, Math.floor(dealtDamage / divisor)))
    pokemon.currentHp -= recoil
    events.push({ kind: 'recoil', target: action.actor, pokemonName: name, damage: recoil })
    if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
  }
  if (targetPokemon.currentHp === 0) events.push({ kind: 'faint', target: action.target, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, defeated: cloneCanonicalPokemon(targetPokemon) })
  if (targetPokemon.currentHp === 0 && target.volatile.grudge && !usingStruggle) move.pp = 0
  if (targetPokemon.currentHp === 0 && target.volatile.destinyBond && pokemon.currentHp > 0) {
    pokemon.currentHp = 0
    events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
  }
  if (options.consumeTurn && usingStruggle && pokemon.currentHp > 0) {
    const recoil = Math.max(1, Math.floor(pokemon.stats.hp / 4))
    pokemon.currentHp = Math.max(0, pokemon.currentHp - recoil)
    events.push({ kind: 'recoil', target: action.actor, pokemonName: name, damage: recoil })
    if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: action.actor, pokemonName: name, defeated: cloneCanonicalPokemon(pokemon) })
  }
}

function executeAction(session: DoubleBattleSession, action: DoubleBattleMoveAction, rng: HgssLcrng, events: DoubleBattleEvent[], catalog: PokemonCatalog, options: Parameters<typeof executeActionCore>[5]): void {
  executeActionCore(session, action, rng, events, catalog, options)
  for (const position of getDoubleBattleOccupiedPositions(session)) applyDoubleBattleAutoHeldItem(session, position, rng, events)
  refreshDoubleBattleForms(session, events)
}
function teamCanContinue(session: DoubleBattleSession, side: DoubleBattleSide): boolean {
  const owners = new Map<string, CanonicalPokemon[]>()
  for (const participant of session.teams[side]) owners.set(participant.ownerId, participant.party)
  return [...owners.values()].some((party) => party.some((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0))
}
export function executeDoubleBattleTurn(session: DoubleBattleSession, playerActions: readonly DoubleBattleAction[], catalog: PokemonCatalog, rng: HgssLcrng, playerTeamPolicy?: PokemonTeamPolicy, playerHealingPolicy?: PokemonPartyHealingPolicy): DoubleBattleEvent[] {
  if (session.phase === 'replacement') throw new Error('Le combat double attend encore un remplacement joueur.')
  if (session.phase !== 'command') throw new Error('Le combat double est terminé.')
  for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) {
    participant.volatile.protected = false
    participant.volatile.flinched = false
    participant.volatile.endured = false
    participant.volatile.actedThisTurn = false
    participant.volatile.lastDamageTaken = 0
    participant.volatile.lastDamageCategory = -1
    participant.volatile.followMe = false
    participant.volatile.helpingHand = false
    participant.volatile.magicCoat = false
    participant.volatile.snatch = false
    participant.volatile.roosted = false
  }
  const required = getRequiredDoubleBattleActors(session)
  if (required.some((actor) => !playerActions.some((action) => action.actor.side === actor.side && action.actor.slot === actor.slot))) {
    throw new Error('Toutes les commandes joueur du combat double HGSS ne sont pas renseignées.')
  }
  const actions = [...playerActions]
  const trainerItemOwners = new Set<string>()
  for (const actor of getDoubleBattleOccupiedPositions(session)) {
    const participant = participantAt(session, actor)
    if (participant.volatile.chargingMove && activePokemon(participant).currentHp > 0) actions.push({ actor, ...participant.volatile.chargingMove })
    else if (!participant.controlled && activePokemon(participant).currentHp > 0) {
      const action = chooseDoubleBattleAiAction(session, actor, catalog, rng, !trainerItemOwners.has(participant.ownerId))
      actions.push(action)
      if (action.kind === 'trainerItem') trainerItemOwners.add(participant.ownerId)
    }
  }
  const switchActions = actions.filter((action): action is DoubleBattleSwitchAction => action.kind === 'switch')
  const itemActions = actions.filter((action): action is DoubleBattleItemAction => action.kind === 'item')
  const trainerItemActions = actions.filter((action): action is DoubleBattleTrainerItemAction => action.kind === 'trainerItem')
  const passActions = actions.filter((action): action is DoubleBattlePassAction => action.kind === 'pass')
  const moveActions = actions.filter((action): action is DoubleBattleMoveAction => !['switch', 'item', 'trainerItem', 'pass'].includes(action.kind ?? 'move'))
  session.plannedMoves.clear()
  session.switchingPositions = new Set(switchActions.map((action) => `${action.actor.side}:${action.actor.slot}`))
  for (const action of moveActions) session.plannedMoves.set(`${action.actor.side}:${action.actor.slot}`, resolveActionMoveData(session, action, catalog))
  const pursuitActions = moveActions.filter((action) => resolveActionMoveData(session, action, catalog).effect === 128 && session.switchingPositions.has(`${action.target.side}:${action.target.slot}`)), priorityRolls = createDoubleBattlePriorityRolls(session, rng)
  const sortMoves = (candidates: DoubleBattleMoveAction[]) => {
    const ordered: DoubleBattleMoveAction[] = []
    for (const action of candidates) {
    let index = 0
    while (index < ordered.length) {
      const left = participantAt(session, action.actor)
      const rightAction = ordered[index]!
      const right = participantAt(session, rightAction.actor)
      const leftMove = resolveActionMoveData(session, action, catalog)
      const rightMove = resolveActionMoveData(session, rightAction, catalog)
      if (compareHgssMoveOrder(
        createDoubleBattleMoveOrderState(session, left, action.actor.side, leftMove, priorityRolls.get(`${action.actor.side}:${action.actor.slot}`) ?? -1),
        createDoubleBattleMoveOrderState(session, right, rightAction.actor.side, rightMove, priorityRolls.get(`${rightAction.actor.side}:${rightAction.actor.slot}`) ?? -1),
        rng,
        session.trickRoomTurns > 0,
      ) < 0) break
      index += 1
    }
    ordered.splice(index, 0, action)
    }
    return ordered
  }
  const pursuitSet = new Set(pursuitActions)
  const ordered: DoubleBattleAction[] = [...sortMoves(pursuitActions), ...switchActions, ...itemActions, ...trainerItemActions, ...passActions, ...sortMoves(moveActions.filter((action) => !pursuitSet.has(action)))]
  session.turnOrder = ordered.map(({ actor }) => actor)
  const events: DoubleBattleEvent[] = []
  for (const action of ordered) {
    if (action.kind === 'switch') {
      const participant = participantAt(session, action.actor)
      const name = activePokemon(participant).nickname ?? activePokemon(participant).speciesName
      if (!switchDoubleBattleParticipant(session, action.actor, action.partyIndex, catalog, rng, events, { playerTeamPolicy })) events.push({ kind: 'noEffect', actor: action.actor, pokemonName: name })
      continue
    }
    if (action.kind === 'item') { events.push(...applyDoubleBattleBagItem(session, action, catalog, action.actor.side === 'player' ? playerHealingPolicy : undefined)); continue }
    if (action.kind === 'trainerItem') { events.push(...applyDoubleBattleTrainerItem(session, action, catalog)); continue }
    if (action.kind === 'pass') { participantAt(session, action.actor).volatile.actedThisTurn = true; continue }
    const move = resolveActionMoveData(session, action, catalog)
    activateDoubleBattlePriorityItem(session, action.actor, move, priorityRolls.get(`${action.actor.side}:${action.actor.slot}`) ?? -1, events)
    const targets = resolveDoubleBattleMoveTargets(session, action.actor, move.range, action.target, rng, move)
    const spread = targets.length > 1 && (move.range & ((1 << 2) | (1 << 3))) !== 0
    const presentationId = events.length + 1
    for (let index = 0; index < targets.length; index += 1) {
      executeAction(session, { ...action, target: targets[index]! }, rng, events, catalog, { consumeTurn: index === 0, spread, ppCost: index === 0 ? resolveDoubleBattlePressureCost(session, action.actor, targets[index]!, move) : undefined, presentationId, playerTeamPolicy })
    }
  }
  applyDoubleBattleResidual(session, events, rng)
  if (!teamCanContinue(session, 'opponent') || !teamCanContinue(session, 'player')) {
    session.phase = 'ended'
    session.pendingReplacements.clear()
    session.result = teamCanContinue(session, 'player') ? 'won' : 'lost'
    events.push({ kind: 'result', result: session.result })
  } else replaceFaintedDoubleBattleParticipants(session, catalog, rng, events, playerTeamPolicy)
  session.turn += 1
  session.plannedMoves.clear()
  session.switchingPositions.clear()
  for (const event of events) if (event.kind === 'move') event.moveName = catalog.moveNames[event.moveId] ?? event.moveName
  return events
}

export function syncDoubleBattleParties(session: DoubleBattleSession): Map<string, CanonicalPokemon[]> {
  const participantsByOwner = new Map<string, DoubleBattleParticipant[]>()
  for (const side of ['player', 'opponent'] as const) for (const participant of session.teams[side]) {
    const participants = participantsByOwner.get(participant.ownerId) ?? []
    participants.push(participant)
    participantsByOwner.set(participant.ownerId, participants)
  }
  const parties = new Map<string, CanonicalPokemon[]>()
  for (const [ownerId, participants] of participantsByOwner) {
    for (const participant of participants) restoreDoubleBattleTemporaryForm(participant)
    const party = participants[0]?.party
    if (party) parties.set(ownerId, party.map(cloneCanonicalPokemon))
  }
  return parties
}
