import type { PokemonCatalog } from '../../ndsTypes'
import { cloneCanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { basePokemonTeamPolicy, getPokemonBattleEligibilityVeto, type PokemonBattleEligibilityIntent, type PokemonTeamPolicy, type PokemonTeamVeto } from '../pokemon/pokemonTeamPolicy'
import { applyHgssPrimaryStatus, applyHgssStatStage, calculateHgssTypeMultiplier, neutralBattleStatStages, resolveHgssHiddenPower } from './hgssBattleRules'
import {
  canHgssIntimidateTarget,
  doesHgssAnticipationTrigger,
  isHgssGrounded,
  resetHgssBadPoisonCounter,
  resolveHgssActiveAbilityId,
  resolveHgssBattleForm,
  resolveHgssDownloadStat,
  resolveHgssEntryHazards,
  resolveHgssEntryWeather,
  resolveHgssForewarnMove,
  resolveHgssFriskItem,
  resolveHgssToxicSpikes,
} from './hgssBattleEntryRules'
import { createDoubleBattleVolatileState, restoreDoubleBattleTemporaryForm } from './doubleBattleState'
import { isHgssWeatherSuppressed } from './hgssEndTurnAbilityRules'
import { resolveHgssSwitchBlock } from './hgssAbilityMoveRules'
import type { DoubleBattleEvent, DoubleBattlePosition, DoubleBattleSession } from './doubleBattleSession'
import { resolveHgssContextualDamageMove, resolveHgssPlateType } from './simpleBattleTemporalRules'
import { chooseDoubleBattleAiReplacement } from './doubleBattleAi'
import { recordDoubleBattleActiveMatchups } from './doubleBattleParticipation'
import { getDoubleBattleOccupiedPositions, requireDoubleBattleParticipantAt } from './doubleBattleRoster'

function activePokemon(session: DoubleBattleSession, position: DoubleBattlePosition) {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}

function activeIndexesForOwner(session: DoubleBattleSession, ownerId: string): Set<number> {
  return new Set((['player', 'opponent'] as const).flatMap((side) => session.teams[side]).filter((participant) => participant.ownerId === ownerId).map((participant) => participant.activePartyIndex))
}

function doubleBattleTeamCanContinue(session: DoubleBattleSession, side: 'player' | 'opponent', playerTeamPolicy: PokemonTeamPolicy): boolean {
  if (session.teams[side].some((participant) => (participant.party[participant.activePartyIndex]?.currentHp ?? 0) > 0)) return true
  const owners = new Set<string>()
  return session.teams[side].some((participant, slot) => {
    if (owners.has(participant.ownerId)) return false
    owners.add(participant.ownerId)
    return getDoubleBattleReserveIndexes(session, { side, slot: slot as 0 | 1 }, 'forced-replacement', playerTeamPolicy).length > 0
  })
}

function activeAbilityId(session: DoubleBattleSession, position: DoubleBattlePosition): number {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(session, position)
  return resolveHgssActiveAbilityId(pokemon.abilityId, participant.volatile.abilityOverrideId, participant.volatile.abilitySuppressed)
}

function activeWeather(session: DoubleBattleSession) {
  const abilities = getDoubleBattleOccupiedPositions(session).flatMap((position) => {
    return activePokemon(session, position).currentHp > 0 ? [activeAbilityId(session, position)] : []
  })
  return isHgssWeatherSuppressed(abilities) ? 'clear' : session.weather.kind
}

export function refreshDoubleBattleForms(session: DoubleBattleSession, events: DoubleBattleEvent[]): void {
  const weather = activeWeather(session)
  for (const position of getDoubleBattleOccupiedPositions(session)) {
    const participant = requireDoubleBattleParticipantAt(session, position), pokemon = activePokemon(session, position)
    const heldItemEffect = session.itemCatalog?.items[pokemon.heldItemId]?.holdEffect
    const form = resolveHgssBattleForm({ speciesId: pokemon.speciesId, abilityId: activeAbilityId(session, position), weather, heldItemEffect })
    if (!form || form.form === pokemon.form && (!form.types || form.types[0] === participant.types[0] && form.types[1] === participant.types[1])) continue
    participant.volatile.battleFormOriginal ??= { form: pokemon.form, types: participant.types }
    pokemon.form = form.form
    if (form.types) participant.types = form.types
    events.push({ kind: 'formChange', target: position, pokemon: cloneCanonicalPokemon(pokemon), types: participant.types, stages: { ...participant.stages } })
  }
}

export function applyDoubleBattleEntryAbility(session: DoubleBattleSession, position: DoubleBattlePosition, events: DoubleBattleEvent[], rng?: HgssLcrng): void {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(session, position)
  if (pokemon.currentHp <= 0) return
  const opposingSide = position.side === 'player' ? 'opponent' : 'player'
  const opponents = session.teams[opposingSide]
    .map((target, slot) => {
      const targetPosition: DoubleBattlePosition = { side: opposingSide, slot: slot as 0 | 1 }
      return { target, targetPosition, pokemon: activePokemon(session, targetPosition) }
    })
    .filter(({ pokemon: targetPokemon }) => targetPokemon.currentHp > 0)
  let abilityId = activeAbilityId(session, position)
  if (abilityId === 36 && pokemon.heldItemId !== 112) {
    const traceable = opponents.filter(({ targetPosition }) => ![36, 59, 121].includes(activeAbilityId(session, targetPosition)))
    if (traceable.length > 1 && !rng) throw new Error('Le tirage ROM de Calque requiert le RNG du combat double.')
    const copied = traceable.length === 0 ? undefined : traceable[(rng?.nextU16() ?? 0) % traceable.length]
    if (copied) { participant.volatile.abilityOverrideId = activeAbilityId(session, copied.targetPosition); abilityId = activeAbilityId(session, position); events.push({ kind: 'condition', target: position, condition: `trace:${abilityId}`, applied: true }) }
  }
  const weather = resolveHgssEntryWeather(abilityId)
  if (weather) {
    session.weather = { kind: weather, turns: 0 }
    events.push({ kind: 'weather', weather })
  }
  if (abilityId === 22) for (const { target, targetPosition, pokemon: targetPokemon } of opponents) {
    const applied = canHgssIntimidateTarget({
      abilityId: activeAbilityId(session, targetPosition),
      protectedByMist: session.sideConditions[opposingSide].mistTurns > 0,
      substituteHp: target.volatile.substituteHp,
    })
    const before = target.stages.attack
    if (applied) target.stages.attack = Math.max(-6, before - 1)
    events.push({ kind: 'stat', target: targetPosition, pokemonName: targetPokemon.nickname ?? targetPokemon.speciesName, stat: 'attack', change: -1, applied: applied && before > -6 })
  }
  if (abilityId === 88) {
    const stat = resolveHgssDownloadStat(opponents.map(({ target, pokemon: targetPokemon }) => ({
      defense: applyHgssStatStage(targetPokemon.stats.defense, target.stages.defense),
      specialDefense: applyHgssStatStage(targetPokemon.stats.specialDefense, target.stages.specialDefense),
      substituteHp: target.volatile.substituteHp,
    })))
    if (stat) {
      const before = participant.stages[stat]
      participant.stages[stat] = Math.min(6, before + 1)
      events.push({ kind: 'stat', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, stat, change: 1, applied: before < 6 })
    }
  }
  const battleRng = rng ?? { getSeed: () => 0, nextU16: () => 0 }
  if (abilityId === 107) {
    const threats = opponents.map(({ pokemon: source, targetPosition }) => ({ level: source.level, moves: source.moves.map(({ moveId, data }) => {
      const contextual = resolveHgssContextualDamageMove(data, { weather: activeWeather(session), rolloutCount: 0, defenseCurl: false, targetMinimized: false })
      const sourceAbility = activeAbilityId(session, targetPosition)
      const type = sourceAbility === 96 ? 0 : data.effect === 135 ? resolveHgssHiddenPower(source.individualValues).type : data.effect === 268 ? resolveHgssPlateType(source.heldItemId) ?? contextual.type : data.effect === 222 ? session.itemCatalog?.items[source.heldItemId]?.naturalGiftType ?? contextual.type : contextual.type
      return { moveId, effect: data.effect, power: data.power, typeMultiplier: calculateHgssTypeMultiplier(type, participant.types) }
    }) }))
    if (doesHgssAnticipationTrigger(pokemon.level, threats)) events.push({ kind: 'abilityReveal', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, abilityId })
  }
  if (abilityId === 108) {
    const moveId = resolveHgssForewarnMove(opponents.map(({ pokemon: source }) => ({ currentHp: source.currentHp, moves: source.moves.map(({ moveId, data }) => ({ moveId, effect: data.effect, power: data.power })) })), battleRng)
    if (moveId !== undefined) events.push({ kind: 'abilityReveal', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, abilityId, moveId })
  }
  if (abilityId === 119) {
    const itemId = resolveHgssFriskItem(opponents.map(({ pokemon: source }) => source.heldItemId), battleRng)
    if (itemId !== undefined) events.push({ kind: 'abilityReveal', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, abilityId, itemId })
  }
}

export function getDoubleBattleTeamPolicyVeto(
  session: DoubleBattleSession,
  position: DoubleBattlePosition,
  partyIndex: number,
  phase: PokemonBattleEligibilityIntent['phase'],
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): PokemonTeamVeto | undefined {
  const participant = requireDoubleBattleParticipantAt(session, position)
  return position.side === 'player' && participant.controlled
    ? getPokemonBattleEligibilityVeto(participant.party, partyIndex, { format: 'double', phase }, playerTeamPolicy)
    : undefined
}

export function getDoubleBattleReserveIndexes(
  session: DoubleBattleSession,
  position: DoubleBattlePosition,
  phase: PokemonBattleEligibilityIntent['phase'] = 'voluntary-switch',
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): number[] {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const activeIndexes = activeIndexesForOwner(session, participant.ownerId)
  return participant.party.map((pokemon, index) => ({ pokemon, index })).filter(({ pokemon, index }) => !activeIndexes.has(index) && !pokemon.isEgg && pokemon.currentHp > 0
    && !getDoubleBattleTeamPolicyVeto(session, position, index, phase, playerTeamPolicy)).map(({ index }) => index)
}

export function canSwitchDoubleBattleParticipant(session: DoubleBattleSession, position: DoubleBattlePosition): boolean {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(session, position)
  if (pokemon.currentHp <= 0) return true
  const abilityId = activeAbilityId(session, position)
  const item = participant.volatile.embargoTurns > 0 || abilityId === 103 ? undefined : session.itemCatalog?.items[pokemon.heldItemId]
  const opposingSide = position.side === 'player' ? 'opponent' : 'player'
  const opposingAbilityIds = getDoubleBattleOccupiedPositions(session, opposingSide).flatMap((target) => {
    return activePokemon(session, target).currentHp > 0 ? [activeAbilityId(session, target)] : []
  })
  return !resolveHgssSwitchBlock({ selfAbilityId: abilityId, selfTypes: participant.types, heldItemEffect: item?.holdEffect ?? 0, magnetRise: participant.volatile.magnetRiseTurns > 0, gravity: session.gravityTurns > 0, bound: participant.volatile.trappedTurns > 0 || participant.volatile.cannotSwitch, ingrained: participant.volatile.ingrain, opposingAbilityIds }).blocked
}

function applyEntryEffects(session: DoubleBattleSession, position: DoubleBattlePosition, rng: HgssLcrng, events: DoubleBattleEvent[]): void {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const pokemon = activePokemon(session, position)
  const conditions = session.sideConditions[position.side]
  const abilityId = activeAbilityId(session, position)
  const grounded = isHgssGrounded(participant.types, abilityId, session.gravityTurns > 0)
  for (const hazard of resolveHgssEntryHazards({
    maxHp: pokemon.stats.hp, types: participant.types, abilityId, grounded,
    spikesLayers: conditions.spikesLayers, stealthRock: conditions.stealthRock,
    rockTypeMultiplier: calculateHgssTypeMultiplier(5, participant.types),
  })) {
    const applied = Math.min(pokemon.currentHp, hazard.damage)
    pokemon.currentHp -= applied
    events.push({ kind: 'residual', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, status: 'trap', damage: applied })
    if (pokemon.currentHp === 0) events.push({ kind: 'faint', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, defeated: cloneCanonicalPokemon(pokemon) })
    if (pokemon.currentHp === 0) break
  }
  const toxicSpikes = pokemon.currentHp > 0 ? resolveHgssToxicSpikes({
    types: participant.types, abilityId, grounded, layers: conditions.toxicSpikesLayers,
    currentStatus: pokemon.status, safeguarded: conditions.safeguardTurns > 0, weather: activeWeather(session),
  }) : undefined
  if (toxicSpikes === 'absorb') conditions.toxicSpikesLayers = 0
  else if (toxicSpikes) events.push({ kind: 'status', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, ...applyHgssPrimaryStatus(toxicSpikes, pokemon, participant.types, rng, abilityId, { weather: activeWeather(session) }) })
  if (pokemon.currentHp > 0) { applyDoubleBattleEntryAbility(session, position, events, rng); refreshDoubleBattleForms(session, events) }
}

export function switchDoubleBattleParticipant(session: DoubleBattleSession, position: DoubleBattlePosition, partyIndex: number, catalog: PokemonCatalog, rng: HgssLcrng, events: DoubleBattleEvent[], options: { forced?: boolean, batonPass?: boolean, phase?: PokemonBattleEligibilityIntent['phase'], playerTeamPolicy?: PokemonTeamPolicy } = {}): boolean {
  const participant = requireDoubleBattleParticipantAt(session, position)
  const phase = options.phase ?? (options.forced || options.batonPass ? 'forced-replacement' : 'voluntary-switch')
  if (!getDoubleBattleReserveIndexes(session, position, phase, options.playerTeamPolicy).includes(partyIndex) || !options.forced && !options.batonPass && !canSwitchDoubleBattleParticipant(session, position)) return false
  const passedStages = { ...participant.stages }
  const passedVolatile = options.batonPass ? {
    confusionTurns: participant.volatile.confusionTurns, seededBy: participant.volatile.seededBy,
    substituteHp: participant.volatile.substituteHp, focusEnergy: participant.volatile.focusEnergy,
    trappedTurns: participant.volatile.trappedTurns, nightmare: participant.volatile.nightmare,
    cursed: participant.volatile.cursed, perishTurns: participant.volatile.perishTurns,
    healBlockTurns: participant.volatile.healBlockTurns, embargoTurns: participant.volatile.embargoTurns,
    magnetRiseTurns: participant.volatile.magnetRiseTurns, aquaRing: participant.volatile.aquaRing,
    ingrain: participant.volatile.ingrain, cannotSwitch: participant.volatile.cannotSwitch,
  } : undefined
  if (activeAbilityId(session, position) === 30) activePokemon(session, position).status = 0
  restoreDoubleBattleTemporaryForm(participant)
  participant.activePartyIndex = partyIndex
  participant.stages = options.batonPass ? passedStages : { ...neutralBattleStatStages }
  participant.volatile = createDoubleBattleVolatileState(activePokemon(session, position).heldItemId !== 0)
  participant.volatile.enteredThisTurn = true
  if (passedVolatile) Object.assign(participant.volatile, passedVolatile)
  const pokemon = activePokemon(session, position)
  pokemon.status = resetHgssBadPoisonCounter(pokemon.status)
  const personal = catalog.personalData[pokemon.speciesId]
  if (!personal) throw new Error(`Les types ROM du remplaçant ${pokemon.speciesName} sont absents.`)
  participant.types = personal.types
  events.push({ kind: 'sendOut', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, partyIndex, pokemon: cloneCanonicalPokemon(pokemon), types: participant.types, stages: { ...participant.stages } })
  const healingWish = session.healingWishes.find(({ target }) => target.side === position.side && target.slot === position.slot)
  if (healingWish) {
    const amount = pokemon.stats.hp - pokemon.currentHp
    pokemon.currentHp = pokemon.stats.hp; pokemon.status = 0
    if (healingWish.lunar) for (const move of pokemon.moves) move.pp = move.maxPp
    events.push({ kind: 'heal', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, amount })
    events.push({ kind: 'statusCured', target: position, pokemonName: pokemon.nickname ?? pokemon.speciesName, applied: true })
    session.healingWishes = session.healingWishes.filter(({ target }) => target.side !== position.side || target.slot !== position.slot)
  }
  applyEntryEffects(session, position, rng, events)
  recordDoubleBattleActiveMatchups(session)
  return true
}

export function replaceFaintedDoubleBattleParticipants(session: DoubleBattleSession, catalog: PokemonCatalog, rng: HgssLcrng, events: DoubleBattleEvent[], playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy): void {
  for (const [key, position] of session.pendingReplacements) {
    if (activePokemon(session, position).currentHp > 0 || getDoubleBattleReserveIndexes(session, position, 'forced-replacement', playerTeamPolicy).length === 0) {
      session.pendingReplacements.delete(key)
    }
  }
  // Les participants IA sont relevés sans interaction. Le choix utilise les
  // mêmes options tactiques structurées que leurs capacités.
  for (const position of getDoubleBattleOccupiedPositions(session)) {
    const { side } = position
    const participant = requireDoubleBattleParticipantAt(session, position)
    if (participant.controlled) continue
    while (activePokemon(session, position).currentHp <= 0) {
      const reserves = getDoubleBattleReserveIndexes(session, position, 'forced-replacement', playerTeamPolicy)
      if (reserves.length === 0) break
      const opposingSide = side === 'player' ? 'opponent' : 'player'
      const opposingTypes = session.teams[opposingSide].flatMap((opponent, opponentSlot) => {
        const opponentPokemon = activePokemon(session, { side: opposingSide, slot: opponentSlot as 0 | 1 })
        return opponentPokemon.currentHp > 0 ? [opponent.types] : []
      })
      const next = chooseDoubleBattleAiReplacement(reserves.map((partyIndex) => {
        const pokemon = participant.party[partyIndex]!
        const bestTypeMultiplier = Math.max(10, ...pokemon.moves.flatMap((move) => (
          move.data.power > 0 ? opposingTypes.map((types) => calculateHgssTypeMultiplier(move.data.type, types)) : []
        )))
        return {
          partyIndex,
          currentHp: pokemon.currentHp,
          maximumHp: pokemon.stats.hp,
          speed: pokemon.stats.speed,
          bestTypeMultiplier,
        }
      }), participant.ai.aiFlags, rng)
      if (!switchDoubleBattleParticipant(session, position, next, catalog, rng, events, { forced: true, playerTeamPolicy })) break
    }
  }
  const playerCanContinue = doubleBattleTeamCanContinue(session, 'player', playerTeamPolicy)
  const opponentCanContinue = doubleBattleTeamCanContinue(session, 'opponent', playerTeamPolicy)
  if (!playerCanContinue || !opponentCanContinue) {
    session.pendingReplacements.clear()
    session.phase = 'ended'
    session.result = playerCanContinue ? 'won' : 'lost'
    if (!events.some((event) => event.kind === 'result')) events.push({ kind: 'result', result: session.result })
    return
  }
  if (session.pendingReplacements.size > 0) {
    session.phase = 'replacement'
    return
  }
  // Les choix contrôlés sont demandés un par un : cela évite que deux slots
  // revendiquent la même réserve lors d'un double K.O.
  for (const position of getDoubleBattleOccupiedPositions(session)) {
    const { side, slot } = position
    const participant = requireDoubleBattleParticipantAt(session, position)
    if (!participant.controlled || activePokemon(session, position).currentHp > 0) continue
    const reserveIndexes = getDoubleBattleReserveIndexes(session, position, 'forced-replacement', playerTeamPolicy)
    if (reserveIndexes.length === 0) continue
    const key = `${side}:${slot}`
    session.pendingReplacements.set(key, position)
    session.phase = 'replacement'
    events.push({ kind: 'replacementRequest', target: position, reserveIndexes })
    return
  }
  if (session.phase !== 'ended') session.phase = 'command'
}

export function getRequiredDoubleBattleReplacementPositions(session: DoubleBattleSession): DoubleBattlePosition[] {
  return [...session.pendingReplacements.values()].map((position) => ({ ...position }))
}

export function submitDoubleBattleReplacement(
  session: DoubleBattleSession,
  position: DoubleBattlePosition,
  partyIndex: number,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): DoubleBattleEvent[] {
  const key = `${position.side}:${position.slot}`
  const pending = session.pendingReplacements.get(key)
  if (!pending) throw new Error("Ce combattant double n'attend aucun remplacement.")
  if (!getDoubleBattleReserveIndexes(session, position, 'forced-replacement', playerTeamPolicy).includes(partyIndex)) {
    const veto = getDoubleBattleTeamPolicyVeto(session, position, partyIndex, 'forced-replacement', playerTeamPolicy)
    throw new Error(veto?.reason ?? "Le Pokémon choisi n'est plus une réserve utilisable.")
  }
  const events: DoubleBattleEvent[] = []
  session.pendingReplacements.delete(key)
  if (!switchDoubleBattleParticipant(session, position, partyIndex, catalog, rng, events, { forced: true, playerTeamPolicy })) {
    throw new Error("Le remplacement contrôlé du combat double a échoué.")
  }
  replaceFaintedDoubleBattleParticipants(session, catalog, rng, events, playerTeamPolicy)
  return events
}
