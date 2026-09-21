import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import { cloneCanonicalPokemon, type CanonicalPokemon, type CanonicalPokemonMove } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { assertPokemonBattleEligibility, basePokemonTeamPolicy, getPokemonBattleEligibilityVeto, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { resolveHgssBattleTerrainId } from '../../rom/battle/naturePower'
import {
  applyHgssStatStage,
  applyHgssSteadfast,
  applySupportedHgssStatusMoveEffect,
  applyHgssPrimaryStatus,
  applySupportedHgssPrimaryStatus,
  calculateHgssMoveDamage,
  calculateHgssTypeMultiplier,
  canHgssPokemonFlinch,
  compareHgssMoveOrder,
  doesHgssMoveHit,
  doesHgssSecondaryEffectOccur,
  isHgssPriorityItemActive,
  neutralBattleStatStages,
  primaryStatusForMoveEffect,
  resolveHgssHiddenPower,
  type HgssAppliedStatus,
  type BattleStat,
  type BattleStatStages,
} from './hgssBattleRules'
import {
  canHgssMoveHitSemiInvulnerable,
  resolveHgssChargeKind,
  resolveHgssContextualDamageMove,
  resolveHgssMagnitudePower,
  resolveHgssPlateType,
  resolveHgssTrumpCardPower,
  resolveHgssWeatherAccuracy,
  type SimpleBattleLockKind,
  type SimpleBattleSemiInvulnerable,
} from './simpleBattleTemporalRules'
import { isHgssMoveCallableBy } from './simpleBattleInvocationRules'
import { resolveHgssConsumedItemEffect } from './hgssConsumedItemRules'
import { applyHgssSpeedBoost, isHgssWeatherDamageImmune, isHgssWeatherSuppressed, resolveHgssEndTurnAbility, resolveHgssStatusResidual } from './hgssEndTurnAbilityRules'
import { applySimpleBattlePostHitAbilities } from './hgssPostHitAbilityRules'
import { canHgssConfuse, canHgssInfatuate, isHgssHeldItemRemovalBlocked, isHgssMoveBlockedBySoundproof, resolveHgssDrain, resolveHgssLeechSeedDrain, resolveHgssPassiveRecovery, resolveHgssPressurePpCost, resolveHgssSwitchBlock, resolveHgssSynchronizeStatusChain } from './hgssAbilityMoveRules'
import { applyHgssHeldAccuracy, applyHgssHeldAttackStats, applyHgssHeldBattleStats, applyHgssHeldDamageBoost, doesHgssHeldItemFlinch, isHgssHeldSurvivalActive, isHgssResistBerryActive, resolveHgssHeldAutoUse, resolveHgssHeldCriticalStage, resolveHgssHeldEndTurn, resolveHgssHeldItemEffect, resolveHgssHeldOnHit, resolveHgssHeldPostDamage, resolveHgssMetronomeState } from './hgssHeldItemRules'
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

export type SimpleBattleKind = 'trainer' | 'wild'
export type SimpleBattleSide = 'player' | 'opponent'
export type SimpleBattleResult = 'won' | 'lost' | 'escaped' | 'captured'

export type SimpleBattleEvent =
  | { kind: 'move', presentationId: number, side: SimpleBattleSide, pokemonName: string, actorSpeciesId: number, targetSpeciesId: number, weather: SimpleBattleWeather, moveId: number, moveName: string, moveType: number, moveCategory: number }
  | { kind: 'miss', side: SimpleBattleSide, pokemonName: string }
  | { kind: 'damage', movePresentationId?: number, side: SimpleBattleSide, damage: number, critical: boolean, typeMultiplier: number }
  | { kind: 'stat', side: SimpleBattleSide, pokemonName: string, stat: BattleStat, change: number, applied: boolean }
  | { kind: 'status', side: SimpleBattleSide, pokemonName: string, status: 'sleep' | 'poison' | 'badPoison' | 'burn' | 'freeze' | 'paralysis', applied: boolean }
  | { kind: 'cannotAct', side: SimpleBattleSide, pokemonName: string, reason: 'sleep' | 'freeze' | 'paralysis' | 'truant' }
  | { kind: 'residual', side: SimpleBattleSide, pokemonName: string, status: 'poison' | 'badPoison' | 'burn' | 'futureSight', damage: number }
  | { kind: 'abilityHeal', side: SimpleBattleSide, pokemonName: string, abilityId: number, amount: number }
  | { kind: 'heal', side: SimpleBattleSide, pokemonName: string, amount: number }
  | { kind: 'recoil', side: SimpleBattleSide, pokemonName: string, damage: number }
  | { kind: 'statusCured', side: SimpleBattleSide, pokemonName: string, applied: boolean }
  | { kind: 'statsReset' }
  | { kind: 'noEffect', side: SimpleBattleSide, pokemonName: string }
  | { kind: 'confusion', side: SimpleBattleSide, pokemonName: string, state: 'started' | 'active' | 'ended' }
  | { kind: 'flinch', side: SimpleBattleSide, pokemonName: string }
  | { kind: 'selfDamage', side: SimpleBattleSide, pokemonName: string, damage: number }
  | { kind: 'multiHit', hits: number }
  | { kind: 'screen', side: SimpleBattleSide, screen: 'reflect' | 'lightScreen' }
  | { kind: 'condition', side: SimpleBattleSide, condition: string, applied: boolean }
  | { kind: 'formChange', side: SimpleBattleSide, pokemon: CanonicalPokemon, types: readonly [number, number] }
  | { kind: 'abilityReveal', side: SimpleBattleSide, pokemonName: string, abilityId: number, moveId?: number, itemId?: number }
  | { kind: 'weather', weather: SimpleBattleWeather }
  | { kind: 'weatherDamage', side: SimpleBattleSide, pokemonName: string, weather: 'sandstorm' | 'hail', damage: number }
  | { kind: 'entryHazard', side: SimpleBattleSide, pokemonName: string, hazard: 'spikes' | 'stealthRock', damage: number }
  | { kind: 'toxicSpikesAbsorbed', side: SimpleBattleSide, pokemonName: string }
  | { kind: 'trainerItem', side: 'opponent', trainerName: string, itemId: number, itemName: string }
  | { kind: 'protected', side: SimpleBattleSide, pokemonName: string, applied: boolean }
  | { kind: 'leechSeed', side: SimpleBattleSide, pokemonName: string, damage: number, healedSide: SimpleBattleSide, recovery?: 'heal' | 'damage' | 'blocked', recoveryAmount?: number }
  | { kind: 'recharge', side: SimpleBattleSide, pokemonName: string }
  | { kind: 'faint', side: SimpleBattleSide, pokemonName: string, defeated: CanonicalPokemon }
  | { kind: 'switchRequest', side: SimpleBattleSide, reason: 'batonPass' | 'pivot' }
  | { kind: 'switched', side: SimpleBattleSide, pokemon: CanonicalPokemon, types: readonly [number, number], stages: BattleStatStages, reason: 'forced' | 'batonPass' | 'pivot' | 'voluntary' }
  | { kind: 'cannotRunTrainer' }
  | { kind: 'runFailed' }
  | { kind: 'escaped' }
  | { kind: 'result', result: SimpleBattleResult }

export type SimpleBattleSideState = {
  pokemon: CanonicalPokemon
  types: readonly [number, number]
  stages: BattleStatStages
  volatile: {
    confusionTurns: number
    flinched: boolean
    protected: boolean
    protectStreak: number
    rechargeTurns: number
    seeded: boolean
    substituteHp: number
    focusEnergy: boolean
    disabledMoveId: number
    disableTurns: number
    encoreMoveId: number
    encoreTurns: number
    tauntTurns: number
    torment: boolean
    lastMoveId: number
    metronomeMoveId: number
    metronomeTurns: number
    trappedTurns: number
    cannotSwitch: boolean
    nightmare: boolean
    cursed: boolean
    perishTurns: number
    yawnTurns: number
    healBlockTurns: number
    embargoTurns: number
    magnetRiseTurns: number
    aquaRing: boolean
    stockpile: number
    lockOn: boolean
    endured: boolean
    infatuated: boolean
    flashFire: boolean
    defenseCurl: boolean
    charged: boolean
    ingrain: boolean
    wishTurns: number
    wishAmount: number
    mudSport: boolean
    waterSport: boolean
    powerTrick: boolean
    choiceMoveId: number
    lastDamageTaken: number
    lastDamageCategory: -1 | 0 | 1
    destinyBond: boolean
    grudge: boolean
    identifiedGhost: boolean
    identifiedDark: boolean
    lockedMoveIndex: number
    lockedMoveTurns: number
    lockedMoveKind?: SimpleBattleLockKind
    lockedMoveData?: PokemonMoveData
    semiInvulnerable?: SimpleBattleSemiInvulnerable
    bideDamage: number
    magicCoat: boolean
    snatch: boolean
    imprison: boolean
    rolloutCount: number
    rage: boolean
    minimized: boolean
    usedMoveIds: Set<number>
    furyCutterCount: number
    actedThisTurn: boolean
    micleAccuracy: boolean
    abilityOverrideId?: number
    abilitySuppressed: boolean
    recyclableItemId: number
    mimicMoveSlot: number
    originalMimicMove?: CanonicalPokemonMove
    transformOriginal?: CanonicalPokemon
    battleFormOriginal?: { form: number, types: readonly [number, number] }
    enteredThisTurn: boolean
    turnsActive: number
    canUnburden: boolean
  }
  screens: {
    reflectTurns: number
    lightScreenTurns: number
    mistTurns: number
    safeguardTurns: number
    tailwindTurns: number
    luckyChantTurns: number
    spikesLayers: number
    toxicSpikesLayers: number
    stealthRock: boolean
    pendingSacrificeRecovery?: 'healing-wish' | 'lunar-dance'
  }
}

export type SimpleBattleWeather = 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'

export type SimpleBattleSession = {
  kind: SimpleBattleKind
  trainerId?: number
  trainerName?: string
  opponentAiFlags: number
  itemCatalog?: HgssItemCatalog
  opponentItems: number[]
  turn: number
  runAttempts: number
  phase: 'command' | 'ended'
  result?: SimpleBattleResult
  player: SimpleBattleSideState
  opponent: SimpleBattleSideState
  weather: { kind: SimpleBattleWeather, turns: number }
  field: { gravityTurns: number, trickRoomTurns: number }
  terrainId: number
  futureAttacks: Array<{ turns: number, target: SimpleBattleSide, damage: number, hits: boolean }>
  payDayCoins: number
  prizeMoneyMultiplier: number
  lastExecutedMove?: PokemonMoveData
  plannedMoves?: Partial<Record<SimpleBattleSide, PokemonMoveData>>
  recyclableItems: Map<string, number>
  parties: Record<SimpleBattleSide, CanonicalPokemon[]>
  pendingSwitches: Partial<Record<SimpleBattleSide, 'batonPass' | 'pivot'>>
  switchingSide?: SimpleBattleSide
  initialEvents: SimpleBattleEvent[]
}

export type CreateSimpleBattleSessionOptions = {
  kind: SimpleBattleKind
  player: CanonicalPokemon
  opponent: CanonicalPokemon
  catalog: PokemonCatalog
  trainerId?: number
  trainerName?: string
  opponentAiFlags?: number
  itemCatalog?: HgssItemCatalog
  opponentItems?: readonly number[]
  /** Météo héritée de LocalFieldData au lancement du combat HGSS. */
  initialWeather?: SimpleBattleWeather
  initialTerrainId?: number
  playerParty?: readonly CanonicalPokemon[]
  opponentParty?: readonly CanonicalPokemon[]
  /**
   * Le runtime principal possède déjà une copie de travail transactionnelle.
   * Dans ce mode, la session et l'interface partagent cette unique source afin
   * que les objets utilisés sur une réserve et les switches restent cohérents.
   */
  sharePartyState?: boolean
  rng?: HgssLcrng
  playerTeamPolicy?: PokemonTeamPolicy
}

/** Mémorise l'effet de la Pièce Rune/Encens Veine dès que son porteur participe. */
function registerSimpleBattlePrizeMoneyItem(session: SimpleBattleSession, side: SimpleBattleSide): void {
  if (side === 'player' && session.itemCatalog?.items[session.player.pokemon.heldItemId]?.holdEffect === 58) session.prizeMoneyMultiplier = 2
}

function createSide(pokemon: CanonicalPokemon, catalog: PokemonCatalog, enteredThisTurn = false): SimpleBattleSideState {
  const personal = catalog.personalData[pokemon.speciesId]
  if (!personal) throw new Error(`Les types ROM de ${pokemon.speciesName} sont absents.`)
  const battlePokemon = cloneCanonicalPokemon(pokemon)
  // Le compteur progressif de Toxic est un état de combattant, pas une donnée
  // persistante du Pokémon. Il repart à 1 à chaque entrée en combat.
  battlePokemon.status = resetHgssBadPoisonCounter(battlePokemon.status)
  return {
    pokemon: battlePokemon,
    types: personal.types,
    stages: { ...neutralBattleStatStages },
    volatile: {
      confusionTurns: 0,
      flinched: false,
      protected: false,
      protectStreak: 0,
      rechargeTurns: 0,
      seeded: false,
      substituteHp: 0,
      focusEnergy: false,
      disabledMoveId: 0,
      disableTurns: 0,
      encoreMoveId: 0,
      encoreTurns: 0,
      tauntTurns: 0,
      torment: false,
      lastMoveId: 0,
      metronomeMoveId: 0,
      metronomeTurns: 0,
      trappedTurns: 0,
      cannotSwitch: false,
      nightmare: false,
      cursed: false,
      perishTurns: 0,
      yawnTurns: 0,
      healBlockTurns: 0,
      embargoTurns: 0,
      magnetRiseTurns: 0,
      aquaRing: false,
      stockpile: 0,
      lockOn: false,
      endured: false,
      infatuated: false,
      flashFire: false,
      defenseCurl: false,
      charged: false,
      ingrain: false,
      wishTurns: 0,
      wishAmount: 0,
      mudSport: false,
      waterSport: false,
      powerTrick: false,
      choiceMoveId: 0,
      lastDamageTaken: 0,
      lastDamageCategory: -1,
      destinyBond: false,
      grudge: false,
      identifiedGhost: false,
      identifiedDark: false,
      lockedMoveIndex: -1,
      lockedMoveTurns: 0,
      bideDamage: 0,
      magicCoat: false,
      snatch: false,
      imprison: false,
      rolloutCount: 0,
      rage: false,
      minimized: false,
      usedMoveIds: new Set(),
      furyCutterCount: 0,
      actedThisTurn: false,
      micleAccuracy: false,
      abilitySuppressed: false,
      recyclableItemId: 0,
      mimicMoveSlot: -1,
      enteredThisTurn,
      turnsActive: 0,
      canUnburden: battlePokemon.heldItemId !== 0,
    },
    screens: {
      reflectTurns: 0,
      lightScreenTurns: 0,
      mistTurns: 0,
      safeguardTurns: 0,
      tailwindTurns: 0,
      luckyChantTurns: 0,
      spikesLayers: 0,
      toxicSpikesLayers: 0,
      stealthRock: false,
    },
  }
}

export function createSimpleBattleSession(options: CreateSimpleBattleSessionOptions): SimpleBattleSession {
  if (options.player.isEgg || options.player.currentHp <= 0) throw new Error("Le Pokémon joueur n'est pas utilisable en combat.")
  if (options.opponent.isEgg || options.opponent.currentHp <= 0) throw new Error("Le Pokémon adverse n'est pas utilisable en combat.")
  const playerParty = options.playerParty ?? [options.player]
  const playerPartyIndex = playerParty.findIndex(({ instanceId }) => instanceId === options.player.instanceId)
  if (playerPartyIndex >= 0) assertPokemonBattleEligibility(playerParty, playerPartyIndex, { format: 'simple', phase: 'initial' }, options.playerTeamPolicy)
  const session: SimpleBattleSession = {
    kind: options.kind,
    trainerId: options.trainerId,
    trainerName: options.trainerName,
    opponentAiFlags: options.opponentAiFlags ?? 0,
    itemCatalog: options.itemCatalog,
    opponentItems: [...(options.opponentItems ?? [])].filter((itemId) => itemId > 0),
    turn: 0,
    runAttempts: 0,
    phase: 'command',
    player: createSide(options.player, options.catalog),
    opponent: createSide(options.opponent, options.catalog),
    weather: { kind: options.initialWeather ?? 'clear', turns: 0 },
    field: { gravityTurns: 0, trickRoomTurns: 0 },
    terrainId: resolveHgssBattleTerrainId(options.initialTerrainId ?? 0),
    futureAttacks: [],
    payDayCoins: 0,
    prizeMoneyMultiplier: 1,
    recyclableItems: new Map(),
    parties: options.sharePartyState ? {
      player: (options.playerParty ?? [options.player]) as CanonicalPokemon[],
      opponent: (options.opponentParty ?? [options.opponent]) as CanonicalPokemon[],
    } : {
      player: (options.playerParty ?? [options.player]).map(cloneCanonicalPokemon),
      opponent: (options.opponentParty ?? [options.opponent]).map(cloneCanonicalPokemon),
    },
    pendingSwitches: {},
    initialEvents: [],
  }
  registerSimpleBattlePrizeMoneyItem(session, 'player')
  const entryOrder: SimpleBattleSide[] = session.opponent.pokemon.stats.speed > session.player.pokemon.stats.speed
    ? ['opponent', 'player'] : ['player', 'opponent']
  for (const side of entryOrder) activateSimpleBattleEntryAbility(session, side, session.initialEvents, options.rng)
  refreshSimpleBattleForms(session, session.initialEvents)
  return session
}

export function consumeSimpleBattleInitialEvents(session: SimpleBattleSession): SimpleBattleEvent[] {
  return session.initialEvents.splice(0)
}

/** Clone persistant qui retire les substitutions strictement temporaires de Mimique. */
export function clonePersistentSimpleBattlePokemon(side: SimpleBattleSideState): CanonicalPokemon {
  let pokemon = cloneCanonicalPokemon(side.pokemon)
  if (side.volatile.transformOriginal) {
    const battle = pokemon
    pokemon = cloneCanonicalPokemon(side.volatile.transformOriginal)
    pokemon.currentHp = Math.min(pokemon.stats.hp, battle.currentHp)
    pokemon.status = battle.status
    pokemon.heldItemId = battle.heldItemId
  }
  if (side.volatile.mimicMoveSlot >= 0 && side.volatile.originalMimicMove) {
    pokemon.moves[side.volatile.mimicMoveSlot] = { ...side.volatile.originalMimicMove, data: { ...side.volatile.originalMimicMove.data } }
  }
  if (side.volatile.battleFormOriginal) pokemon.form = side.volatile.battleFormOriginal.form
  return pokemon
}

/**
 * Remplace le combattant actif. Comme dans le moteur HGSS, les boosts temporaires
 * sont perdus au changement, tandis que les PV, le statut et les PP restent sur
 * l'instance de Pokémon fournie.
 */
export function switchSimpleBattlePokemon(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  pokemon: CanonicalPokemon,
  catalog: PokemonCatalog,
  options: { forced?: boolean, phase?: 'voluntary-switch' | 'forced-replacement', playerTeamPolicy?: PokemonTeamPolicy } = {},
): SimpleBattleEvent[] {
  if (session.phase === 'ended') throw new Error('Le combat est terminé.')
  if (pokemon.isEgg || pokemon.currentHp <= 0) throw new Error("Le Pokémon choisi n'est pas utilisable en combat.")
  const previous = session[side]
  const pendingReason = session.pendingSwitches[side]
  const partyIndex = session.parties[side].findIndex(({ instanceId }) => instanceId === pokemon.instanceId)
  if (side === 'player' && partyIndex >= 0) assertPokemonBattleEligibility(session.parties.player, partyIndex, {
    format: 'simple', phase: options.phase ?? (options.forced || pendingReason ? 'forced-replacement' : 'voluntary-switch'),
  }, options.playerTeamPolicy)
  if (!options.forced && !pendingReason && !canSwitchSimpleBattlePokemon(session, side)) {
    throw new Error(`${pokemonName(previous)} ne peut pas être retiré du combat.`)
  }
  const passedStages = pendingReason === 'batonPass' ? { ...previous.stages } : undefined
  const passedVolatile = pendingReason === 'batonPass' ? {
    confusionTurns: previous.volatile.confusionTurns, seeded: previous.volatile.seeded,
    substituteHp: previous.volatile.substituteHp, focusEnergy: previous.volatile.focusEnergy,
    trappedTurns: previous.volatile.trappedTurns, nightmare: previous.volatile.nightmare,
    cursed: previous.volatile.cursed, perishTurns: previous.volatile.perishTurns,
    healBlockTurns: previous.volatile.healBlockTurns, embargoTurns: previous.volatile.embargoTurns,
    magnetRiseTurns: previous.volatile.magnetRiseTurns, aquaRing: previous.volatile.aquaRing,
    ingrain: previous.volatile.ingrain, cannotSwitch: previous.volatile.cannotSwitch,
  } : undefined
  const screens = previous.screens
  const wish = { turns: previous.volatile.wishTurns, amount: previous.volatile.wishAmount }
  if (activeBattleAbilityId(previous) === 30) previous.pokemon.status = 0 // Médic Nature agit au retrait dans le moteur, quel que soit son appelant.
  const previousPartyIndex = session.parties[side].findIndex((member) => simpleBattlePokemonKey(member) === simpleBattlePokemonKey(previous.pokemon))
  if (previousPartyIndex >= 0) session.parties[side][previousPartyIndex] = clonePersistentSimpleBattlePokemon(previous)
  session[side] = createSide(pokemon, catalog, true)
  registerSimpleBattlePrizeMoneyItem(session, side)
  session[side].volatile.recyclableItemId = session.recyclableItems.get(simpleBattlePokemonKey(pokemon)) ?? 0
  if (passedStages && passedVolatile) {
    session[side].stages = passedStages
    Object.assign(session[side].volatile, passedVolatile)
  }
  delete session.pendingSwitches[side]
  session[side].screens = screens
  session[side].volatile.wishTurns = wish.turns
  session[side].volatile.wishAmount = wish.amount
  session.phase = 'command'
  session.result = undefined
  const events: SimpleBattleEvent[] = []
  const state = session[side]
  const name = pokemonName(state)
  const sacrificeRecovery = screens.pendingSacrificeRecovery
  if (sacrificeRecovery) {
    const amount = state.pokemon.stats.hp - state.pokemon.currentHp
    state.pokemon.currentHp = state.pokemon.stats.hp
    const cured = state.pokemon.status !== 0
    state.pokemon.status = 0
    if (sacrificeRecovery === 'lunar-dance') {
      for (const move of state.pokemon.moves) move.pp = move.maxPp
    }
    screens.pendingSacrificeRecovery = undefined
    if (amount > 0) events.push({ kind: 'heal', side, pokemonName: name, amount })
    if (cured) events.push({ kind: 'statusCured', side, pokemonName: name, applied: true })
    setCondition(events, side, sacrificeRecovery, true)
  }
  const held = getHeldItemEffect(session, state)
  const activeAbility = activeBattleAbilityId(state)
  const grounded = isHgssGrounded(state.types, activeAbility, session.field.gravityTurns > 0, held.effect === 106)
  const applyHazardDamage = (hazard: 'spikes' | 'stealthRock', damage: number): void => {
    if (activeAbility === 98 || damage <= 0) return // Garde Magik
    const applied = Math.min(state.pokemon.currentHp, Math.max(1, damage))
    state.pokemon.currentHp -= applied
    events.push({ kind: 'entryHazard', side, pokemonName: name, hazard, damage: applied })
  }
  for (const hazard of resolveHgssEntryHazards({
    maxHp: state.pokemon.stats.hp, types: state.types, abilityId: activeAbility, grounded,
    spikesLayers: screens.spikesLayers, stealthRock: screens.stealthRock,
    rockTypeMultiplier: calculateHgssTypeMultiplier(5, state.types),
  })) applyHazardDamage(hazard.kind, hazard.damage)
  const toxicSpikes = state.pokemon.currentHp > 0 ? resolveHgssToxicSpikes({
    types: state.types, abilityId: activeAbility, grounded, layers: screens.toxicSpikesLayers,
    currentStatus: state.pokemon.status, safeguarded: screens.safeguardTurns > 0,
    weather: isHgssWeatherSuppressed([activeBattleAbilityId(session.player), activeBattleAbilityId(session.opponent)]) ? 'clear' : session.weather.kind,
  }) : undefined
  if (toxicSpikes === 'absorb') {
    screens.toxicSpikesLayers = 0
    events.push({ kind: 'toxicSpikesAbsorbed', side, pokemonName: name })
  } else if (toxicSpikes) {
    state.pokemon.status = toxicSpikes === 'badPoison' ? 0x180 : 0x8
    events.push({ kind: 'status', side, pokemonName: name, status: toxicSpikes, applied: true })
  }
  if (state.pokemon.currentHp === 0) {
    emitSimpleBattleFaint(events, side, state.pokemon)
    resolveSimpleBattleFaints(session, events, options.playerTeamPolicy)
  } else { activateSimpleBattleEntryAbility(session, side, events); refreshSimpleBattleForms(session, events) }
  return events
}

export function canSwitchSimpleBattlePokemon(session: SimpleBattleSession, side: SimpleBattleSide): boolean {
  const state = session[side]
  if (state.pokemon.currentHp <= 0) return true
  const opponent = session[side === 'player' ? 'opponent' : 'player']
  return !resolveHgssSwitchBlock({ selfAbilityId: activeBattleAbilityId(state), selfTypes: state.types, heldItemEffect: getHeldItemEffect(session, state).effect, magnetRise: state.volatile.magnetRiseTurns > 0, gravity: session.field.gravityTurns > 0, bound: state.volatile.trappedTurns > 0 || state.volatile.cannotSwitch, ingrained: state.volatile.ingrain, opposingAbilityIds: opponent.pokemon.currentHp > 0 ? [activeBattleAbilityId(opponent)] : [] }).blocked
}

export function isMoveSupportedBySimpleBattle(move: CanonicalPokemonMove): boolean {
  // Toutes les capacités ROM restent jouables pendant la reconstruction. La couverture
  // sémantique réelle est exposée séparément et certifiée par l'audit de la ROM.
  return move.moveId > 0
}

export function getUsableSimpleBattleMoveIndexes(
  side: Pick<SimpleBattleSideState, 'pokemon'> & Partial<Pick<SimpleBattleSideState, 'volatile'>>,
): number[] {
  const volatile = side.volatile
  if (volatile?.lockedMoveTurns && volatile.lockedMoveIndex >= 0) return [volatile.lockedMoveIndex]
  const candidates = side.pokemon.moves
    .map((move, index) => ({ move, index }))
    .filter(({ move }) => move.pp > 0
      && isMoveSupportedBySimpleBattle(move)
      && (!volatile || volatile.disabledMoveId !== move.moveId)
      && (!volatile || volatile.choiceMoveId === 0 || volatile.choiceMoveId === move.moveId)
      && (!volatile || volatile.tauntTurns === 0 || move.data.power > 0)
      && (!volatile || !volatile.torment || volatile.lastMoveId !== move.moveId))
  const encored = volatile?.encoreTurns && volatile.encoreMoveId
    ? candidates.filter(({ move }) => move.moveId === volatile.encoreMoveId)
    : candidates
  return encored
    .map(({ index }) => index)
}

/** Capacités réellement sélectionnables, y compris l'interdiction de Possessif. */
export function getSelectableSimpleBattleMoveIndexes(session: SimpleBattleSession, side: SimpleBattleSide): number[] {
  const target = session[side === 'player' ? 'opponent' : 'player']
  const forbidden = target.volatile.imprison ? new Set(target.pokemon.moves.map(({ moveId }) => moveId)) : undefined
  return getUsableSimpleBattleMoveIndexes(session[side]).filter((index) => !forbidden?.has(session[side].pokemon.moves[index]!.moveId))
}

function chooseOpponentMove(session: SimpleBattleSession, rng: HgssLcrng): number {
  const usable = getSelectableSimpleBattleMoveIndexes(session, 'opponent')
  if (usable.length === 0) return -1 // Lutte, choisie par le contrôleur HGSS quand tous les PP sont épuisés.
  // Le sélecteur overlay 10 choisit aléatoirement parmi les capacités au score maximal.
  // Pour le premier rival (AI flag 1), les capacités encore efficaces partent toutes à 100.
  const effective = usable.filter((index) => {
    const move = session.opponent.pokemon.moves[index]!
    if (move.data.effect === 18) return session.player.stages.attack > -6
    if (move.data.effect === 19) return session.player.stages.defense > -6
    return true
  })
  const baseCandidates = effective.length > 0 ? effective : usable
  if (session.opponentAiFlags === 0) return baseCandidates[rng.nextU16() % baseCandidates.length]!
  const scored = baseCandidates.map((index) => {
    const move = session.opponent.pokemon.moves[index]!
    let score = 100
    if ((session.opponentAiFlags & 1) !== 0 && move.data.power > 0) {
      const multiplier = calculateHgssTypeMultiplier(move.data.type, session.player.types)
      if (multiplier === 0) score -= 20
      else if (multiplier > 10) score += 2
      else if (multiplier < 10) score -= 1
    }
    if ((session.opponentAiFlags & 2) !== 0) {
      if (primaryStatusForMoveEffect(move.data.effect) && (session.player.pokemon.status & 0xff) !== 0) score -= 10
      if ((move.data.effect === 32 || move.data.effect === 37 || move.data.effect === 132)
        && session.opponent.pokemon.currentHp === session.opponent.pokemon.stats.hp) score -= 10
      if ((move.data.effect === 32 || move.data.effect === 132)
        && session.opponent.pokemon.currentHp * 2 <= session.opponent.pokemon.stats.hp) score += 3
    }
    return { index, score }
  })
  const maximum = Math.max(...scored.map(({ score }) => score))
  const candidates = scored.filter(({ score }) => score === maximum).map(({ index }) => index)
  return candidates[rng.nextU16() % candidates.length]!
}

function finish(session: SimpleBattleSession, result: SimpleBattleResult, events: SimpleBattleEvent[]): void {
  if (session.phase === 'ended') return
  session.phase = 'ended'
  session.result = result
  events.push({ kind: 'result', result })
}

function simpleBattleHasEnded(session: SimpleBattleSession): boolean {
  return session.phase === 'ended'
}

function pokemonName(side: SimpleBattleSideState): string {
  return side.pokemon.nickname ?? side.pokemon.speciesName
}

function emitSimpleBattleFaint(events: SimpleBattleEvent[], side: SimpleBattleSide, pokemon: CanonicalPokemon): boolean {
  if (pokemon.currentHp > 0) return false
  const key = simpleBattlePokemonKey(pokemon)
  if (!events.some((event) => event.kind === 'faint' && event.side === side && simpleBattlePokemonKey(event.defeated) === key)) {
    events.push({ kind: 'faint', side, pokemonName: pokemon.nickname ?? pokemon.speciesName, defeated: cloneCanonicalPokemon(pokemon) })
  }
  return true
}

function simpleBattlePokemonKey(pokemon: CanonicalPokemon): string {
  return pokemon.instanceId
}

function simpleBattlePartyMembers(session: SimpleBattleSession, side: SimpleBattleSide): CanonicalPokemon[] {
  const active = session[side].pokemon
  const activeKey = simpleBattlePokemonKey(active)
  return session.parties[side].map((pokemon) => simpleBattlePokemonKey(pokemon) === activeKey ? active : pokemon)
}

function simpleBattleReserve(session: SimpleBattleSession, side: SimpleBattleSide, playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy): CanonicalPokemon[] {
  const activeKey = simpleBattlePokemonKey(session[side].pokemon)
  const party = simpleBattlePartyMembers(session, side)
  return party.filter((pokemon, partyIndex) => simpleBattlePokemonKey(pokemon) !== activeKey && !pokemon.isEgg && pokemon.currentHp > 0
    && (side !== 'player' || !getPokemonBattleEligibilityVeto(party, partyIndex, { format: 'simple', phase: 'forced-replacement' }, playerTeamPolicy)))
}

function resolveSimpleBattleFaints(session: SimpleBattleSession, events: SimpleBattleEvent[], playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy): void {
  if (session.phase === 'ended') return
  const playerCanContinue = session.player.pokemon.currentHp > 0 || simpleBattleReserve(session, 'player', playerTeamPolicy).length > 0
  const opponentCanContinue = session.opponent.pokemon.currentHp > 0 || simpleBattleReserve(session, 'opponent').length > 0
  // Comme dans les jeux, un double K.O. des deux dernières équipes est une
  // défaite du joueur. Si une réserve existe, le combat reste en phase de
  // commande jusqu'au remplacement et aucun résultat transitoire n'est émis.
  if (!playerCanContinue) finish(session, 'lost', events)
  else if (!opponentCanContinue) finish(session, 'won', events)
}

function forceSimpleBattleSwitch(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  reason: 'forced' | 'batonPass' | 'pivot' | 'voluntary',
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): boolean {
  const reserve = simpleBattleReserve(session, side, playerTeamPolicy)
  if (reserve.length === 0) return false
  const replacement = reserve[rng.nextU16() % reserve.length]!
  const entryEvents = switchSimpleBattlePokemon(session, side, replacement, catalog, { forced: true, playerTeamPolicy })
  events.push({
    kind: 'switched',
    side,
    pokemon: cloneCanonicalPokemon(replacement),
    types: session[side].types,
    stages: { ...session[side].stages },
    reason,
  }, ...entryEvents)
  return true
}

function activeBattleAbilityId(side: SimpleBattleSideState): number {
  return resolveHgssActiveAbilityId(side.pokemon.abilityId, side.volatile.abilityOverrideId, side.volatile.abilitySuppressed)
}

function getHeldItemEffect(session: SimpleBattleSession, side: SimpleBattleSideState): { effect: number, parameter: number } {
  const item = session.itemCatalog?.items[side.pokemon.heldItemId]
  return resolveHgssHeldItemEffect({ holdEffect: item?.holdEffect, holdEffectParameter: item?.holdEffectParameter, abilityId: activeBattleAbilityId(side), embargoTurns: side.volatile.embargoTurns })
}

function consumeHeldItem(session: SimpleBattleSession, side: SimpleBattleSideState): void {
  if (side.pokemon.heldItemId !== 0) side.volatile.canUnburden = true
  side.volatile.recyclableItemId = side.pokemon.heldItemId
  if (side.pokemon.heldItemId !== 0) session.recyclableItems.set(simpleBattlePokemonKey(side.pokemon), side.pokemon.heldItemId)
  side.pokemon.heldItemId = 0
}

function applyConsumedItemEffect(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  effect: number,
  parameter: number,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
): void {
  const state = session[side]
  const resolved = resolveHgssConsumedItemEffect(effect, parameter, state.pokemon.stats.hp, state.pokemon.nature)
  const name = pokemonName(state)
  if (resolved.kind === 'heal') {
    if (state.volatile.healBlockTurns > 0) return
    const amount = Math.min(resolved.amount, state.pokemon.stats.hp - state.pokemon.currentHp)
    state.pokemon.currentHp += amount
    if (amount > 0) events.push({ kind: 'heal', side, pokemonName: name, amount })
    if (resolved.confuse && state.volatile.confusionTurns === 0 && canHgssConfuse(activeBattleAbilityId(state))) {
      state.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', side, pokemonName: name, state: 'started' })
    }
  } else if (resolved.kind === 'cure') {
    const previousStatus = state.pokemon.status
    const previousConfusion = state.volatile.confusionTurns
    if (resolved.status === 'all') { state.pokemon.status = 0; state.volatile.confusionTurns = 0 }
    else if (resolved.status === 'paralysis') state.pokemon.status &= ~0x40
    else if (resolved.status === 'sleep') state.pokemon.status &= ~0x7
    else if (resolved.status === 'poison') state.pokemon.status &= ~(0x8 | 0x80 | 0xf00)
    else if (resolved.status === 'burn') state.pokemon.status &= ~0x10
    else if (resolved.status === 'freeze') state.pokemon.status &= ~0x20
    else state.volatile.confusionTurns = 0
    events.push({ kind: 'statusCured', side, pokemonName: name, applied: previousStatus !== state.pokemon.status || previousConfusion !== state.volatile.confusionTurns })
  } else if (resolved.kind === 'restorePp') {
    const move = state.pokemon.moves.reduce<CanonicalPokemonMove | undefined>((best, candidate) => (
      candidate.maxPp - candidate.pp > (best ? best.maxPp - best.pp : 0) ? candidate : best
    ), undefined)
    if (move) move.pp = Math.min(move.maxPp, move.pp + resolved.amount)
    setCondition(events, side, 'consumedItemPp', Boolean(move))
  } else if (resolved.kind === 'raiseStat') applyStageChange(session, side, resolved.stat, resolved.change, events)
  else if (resolved.kind === 'raiseRandomStat') {
    const stats = (['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const).filter((stat) => state.stages[stat] < 6)
    if (stats.length > 0) applyStageChange(session, side, stats[rng.nextU16() % stats.length]!, resolved.change, events)
    else setCondition(events, side, 'consumedItemStat', false)
  } else if (resolved.kind === 'focusEnergy') {
    const applied = !state.volatile.focusEnergy
    state.volatile.focusEnergy = true
    setCondition(events, side, 'focusEnergy', applied)
  } else if (resolved.kind === 'nextMoveAccuracy') {
    state.volatile.micleAccuracy = true
    setCondition(events, side, 'consumedItemAccuracy', true)
  } else if (resolved.kind === 'restoreLoweredStats') {
    let applied = false
    for (const stat of Object.keys(state.stages) as BattleStat[]) if (state.stages[stat] < 0) { state.stages[stat] = 0; applied = true }
    setCondition(events, side, 'consumedItemStatsRestored', applied)
  } else if (resolved.kind === 'cureInfatuation') {
    const applied = state.volatile.infatuated
    state.volatile.infatuated = false
    setCondition(events, side, 'consumedItemInfatuation', applied)
  } else if (resolved.kind === 'flinch') {
    state.volatile.flinched = true
    events.push({ kind: 'flinch', side, pokemonName: name })
  } else if (resolved.kind === 'inflict' && state.screens.safeguardTurns === 0) {
    const status = applyHgssPrimaryStatus(resolved.status as HgssAppliedStatus, state.pokemon, state.types, rng, activeBattleAbilityId(state), { weather: isHgssWeatherSuppressed([activeBattleAbilityId(session.player), activeBattleAbilityId(session.opponent)]) ? 'clear' : session.weather.kind })
    events.push({ kind: 'status', side, pokemonName: name, ...status })
  }
}

function canTransferHeldItem(session: SimpleBattleSession, state: SimpleBattleSideState, itemId: number): boolean {
  return itemId === 0 || (session.itemCatalog?.items[itemId]?.fieldPocket !== 5 && !(state.pokemon.speciesId === 487 && itemId === 112))
}

function activateAutoHeldItem(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
): void {
  const state = session[side]
  const held = getHeldItemEffect(session, state)
  const use = resolveHgssHeldAutoUse({ held, abilityId: activeBattleAbilityId(state), currentHp: state.pokemon.currentHp, maximumHp: state.pokemon.stats.hp, status: state.pokemon.status, confusion: state.volatile.confusionTurns > 0, infatuated: state.volatile.infatuated, stages: state.stages, hasEmptyPp: state.pokemon.moves.some(({ moveId, pp }) => moveId > 0 && pp === 0) })
  if (!use) return
  consumeHeldItem(session, state)
  applyConsumedItemEffect(session, side, use.consumedEffect, use.parameter, rng, events)
}

function secondaryEffectOccurs(chance: number, rng: HgssLcrng, attackerAbilityId = 0, targetAbilityId = 0): boolean {
  return doesHgssSecondaryEffectOccur(chance, rng, attackerAbilityId, targetAbilityId)
}

function confusionSelfDamage(side: SimpleBattleSideState, rng: HgssLcrng): number {
  const attack = Math.max(1, side.pokemon.stats.attack)
  const defense = Math.max(1, side.pokemon.stats.defense)
  let damage = Math.floor(side.pokemon.level * 2 / 5) + 2
  damage = Math.floor(damage * 40 * attack / defense)
  damage = Math.floor(damage / 50) + 2
  return Math.max(1, Math.floor(damage * (100 - (rng.nextU16() % 16)) / 100))
}

function applyStageChange(
  session: SimpleBattleSession,
  affectedSide: SimpleBattleSide,
  stat: BattleStat,
  change: number,
  events: SimpleBattleEvent[],
): void {
  const target = session[affectedSide]
  const before = target.stages[stat]
  target.stages[stat] = Math.max(-6, Math.min(6, before + change))
  events.push({ kind: 'stat', side: affectedSide, pokemonName: pokemonName(target), stat, change, applied: before !== target.stages[stat] })
}

function beginTurn(session: SimpleBattleSession): void {
  for (const side of ['player', 'opponent'] as const) {
    session[side].volatile.protected = false
    session[side].volatile.endured = false
    session[side].volatile.lastDamageTaken = 0
    session[side].volatile.lastDamageCategory = -1
    session[side].volatile.actedThisTurn = false
    session[side].volatile.magicCoat = false
    session[side].volatile.snatch = false
  }
}

function setCondition(
  events: SimpleBattleEvent[],
  side: SimpleBattleSide,
  condition: string,
  applied: boolean,
): void {
  events.push({ kind: 'condition', side, condition, applied })
}

function refreshSimpleBattleForms(session: SimpleBattleSession, events: SimpleBattleEvent[]): void {
  const weather = isHgssWeatherSuppressed([activeBattleAbilityId(session.player), activeBattleAbilityId(session.opponent)]) ? 'clear' : session.weather.kind
  for (const side of ['player', 'opponent'] as const) {
    const state = session[side]
    const heldItemEffect = session.itemCatalog?.items[state.pokemon.heldItemId]?.holdEffect
    const form = resolveHgssBattleForm({ speciesId: state.pokemon.speciesId, abilityId: activeBattleAbilityId(state), weather, heldItemEffect })
    if (!form || form.form === state.pokemon.form && (!form.types || form.types[0] === state.types[0] && form.types[1] === state.types[1])) continue
    state.volatile.battleFormOriginal ??= { form: state.pokemon.form, types: state.types }
    state.pokemon.form = form.form
    if (form.types) state.types = form.types
    events.push({ kind: 'formChange', side, pokemon: cloneCanonicalPokemon(state.pokemon), types: state.types })
  }
}

function activateSimpleBattleEntryAbility(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  events: SimpleBattleEvent[],
  rng: HgssLcrng = { getSeed: () => 0, nextU16: () => 0 },
): void {
  const state = session[side]
  const targetSide: SimpleBattleSide = side === 'player' ? 'opponent' : 'player'
  const target = session[targetSide]
  if (state.pokemon.currentHp <= 0) return
  let stateAbility = activeBattleAbilityId(state)
  const targetAbility = activeBattleAbilityId(target)
  if (stateAbility === 36 && state.pokemon.heldItemId !== 112 && target.pokemon.currentHp > 0 && ![36, 59, 121].includes(targetAbility)) {
    state.volatile.abilityOverrideId = targetAbility
    stateAbility = targetAbility
    setCondition(events, side, `trace:${targetAbility}`, true)
  }
  const weather = resolveHgssEntryWeather(stateAbility)
  if (weather) {
    session.weather = { kind: weather, turns: 0 }
    events.push({ kind: 'weather', weather })
  }
  if (stateAbility === 22 && target.pokemon.currentHp > 0) { // Intimidation
    if (!canHgssIntimidateTarget({ abilityId: targetAbility, protectedByMist: target.screens.mistTurns > 0, substituteHp: target.volatile.substituteHp })) {
      events.push({ kind: 'stat', side: targetSide, pokemonName: pokemonName(target), stat: 'attack', change: -1, applied: false })
    } else applyStageChange(session, targetSide, 'attack', -1, events)
  }
  if (stateAbility === 88 && target.pokemon.currentHp > 0) { // Télécharge
    const stat = resolveHgssDownloadStat([{
      defense: applyHgssStatStage(target.pokemon.stats.defense, target.stages.defense),
      specialDefense: applyHgssStatStage(target.pokemon.stats.specialDefense, target.stages.specialDefense),
      substituteHp: target.volatile.substituteHp,
    }])
    if (stat) applyStageChange(session, side, stat, 1, events)
  }
  if (stateAbility === 107 && target.pokemon.currentHp > 0) {
    const moves = target.pokemon.moves.map(({ moveId, data }) => {
      const contextual = resolveHgssContextualDamageMove(data, { weather: session.weather.kind, rolloutCount: 0, defenseCurl: false, targetMinimized: false })
      const type = activeBattleAbilityId(target) === 96 ? 0 : data.effect === 135 ? resolveHgssHiddenPower(target.pokemon.individualValues).type : data.effect === 268 ? resolveHgssPlateType(target.pokemon.heldItemId) ?? contextual.type : data.effect === 222 ? session.itemCatalog?.items[target.pokemon.heldItemId]?.naturalGiftType ?? contextual.type : contextual.type
      return { moveId, effect: data.effect, power: data.power, typeMultiplier: calculateHgssTypeMultiplier(type, state.types) }
    })
    if (doesHgssAnticipationTrigger(state.pokemon.level, [{ level: target.pokemon.level, moves }])) events.push({ kind: 'abilityReveal', side, pokemonName: pokemonName(state), abilityId: 107 })
  }
  if (stateAbility === 108 && target.pokemon.currentHp > 0) {
    const moveId = resolveHgssForewarnMove([{ currentHp: target.pokemon.currentHp, moves: target.pokemon.moves.map(({ moveId, data }) => ({ moveId, effect: data.effect, power: data.power })) }], rng)
    if (moveId !== undefined) events.push({ kind: 'abilityReveal', side, pokemonName: pokemonName(state), abilityId: 108, moveId })
  }
  if (stateAbility === 119 && target.pokemon.currentHp > 0) {
    const itemId = resolveHgssFriskItem([target.pokemon.heldItemId], rng)
    if (itemId !== undefined) events.push({ kind: 'abilityReveal', side, pokemonName: pokemonName(state), abilityId: 119, itemId })
  }
}

function applyComplexStatusMoveEffect(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  targetSide: SimpleBattleSide,
  effect: number,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
  movePresentationId: number,
): boolean {
  const actor = session[side]
  const target = session[targetSide]
  const actorName = pokemonName(actor)
  const targetName = pokemonName(target)
  if (effect === 37) { // Repos
    const actorAbility = activeBattleAbilityId(actor)
    const blocked = actorAbility === 15 || actorAbility === 72
    const applied = !blocked && (actor.pokemon.currentHp < actor.pokemon.stats.hp || actor.pokemon.status !== 0)
    if (applied) {
      const amount = actor.pokemon.stats.hp - actor.pokemon.currentHp
      actor.pokemon.currentHp = actor.pokemon.stats.hp
      actor.pokemon.status = 3 // deux tours complets dans le compteur sommeil HGSS
      events.push({ kind: 'heal', side, pokemonName: actorName, amount })
      events.push({ kind: 'status', side, pokemonName: actorName, status: 'sleep', applied: true })
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 46) {
    const applied = actor.screens.mistTurns === 0
    if (applied) actor.screens.mistTurns = 5
    setCondition(events, side, 'mist', applied)
    return true
  }
  if (effect === 57) {
    const applied = !actor.volatile.transformOriginal && !target.volatile.transformOriginal && target.volatile.substituteHp === 0
    if (applied) {
      actor.volatile.transformOriginal = cloneCanonicalPokemon(actor.pokemon)
      const maximumHp = actor.pokemon.stats.hp
      actor.pokemon.speciesId = target.pokemon.speciesId
      actor.pokemon.speciesName = target.pokemon.speciesName
      actor.pokemon.form = target.pokemon.form
      actor.pokemon.gender = target.pokemon.gender
      actor.pokemon.stats = { ...target.pokemon.stats, hp: maximumHp }
      actor.pokemon.moves = target.pokemon.moves.map((knownMove) => ({ ...knownMove, pp: 5, maxPp: 5, ppUps: 0, data: { ...knownMove.data } }))
      actor.types = [target.types[0], target.types[1]]
      actor.stages = { ...target.stages }
      actor.volatile.abilityOverrideId = activeBattleAbilityId(target)
      actor.volatile.abilitySuppressed = false
    }
    setCondition(events, side, 'transform', applied)
    return true
  }
  if (effect === 108 || effect === 156) {
    applyStageChange(session, side, effect === 108 ? 'evasion' : 'defense', effect === 108 ? 2 : 1, events)
    if (effect === 156) actor.volatile.defenseCurl = true
    return true
  }
  if (effect === 47) {
    const applied = !actor.volatile.focusEnergy
    actor.volatile.focusEnergy = true
    setCondition(events, side, 'focusEnergy', applied)
    return true
  }
  if (effect === 79) {
    const cost = Math.max(1, Math.floor(actor.pokemon.stats.hp / 4))
    const applied = actor.volatile.substituteHp === 0 && actor.pokemon.currentHp > cost
    if (applied) {
      actor.pokemon.currentHp -= cost
      actor.volatile.substituteHp = cost
      events.push({ kind: 'damage', movePresentationId, side, damage: cost, critical: false, typeMultiplier: 10 })
    }
    setCondition(events, side, 'substitute', applied)
    return true
  }
  if (effect === 85) { // Trempette : échec intentionnel de la ROM.
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 30) { // Adaptation / Conversion
    const type = actor.pokemon.moves.find((move) => move.moveId > 0)?.data.type
    const applied = type !== undefined && !actor.types.includes(type)
    if (applied) actor.types = [type, type]
    setCondition(events, side, 'conversion', applied)
    return true
  }
  if (effect === 86 || effect === 90) {
    const moveId = target.volatile.lastMoveId
    const move = target.pokemon.moves.find((candidate) => candidate.moveId === moveId)
    const applied = Boolean(move && move.pp > 0)
    if (applied && effect === 86) {
      target.volatile.disabledMoveId = moveId
      target.volatile.disableTurns = 4 + rng.nextU16() % 4
    } else if (applied) {
      target.volatile.encoreMoveId = moveId
      target.volatile.encoreTurns = 3 + rng.nextU16() % 5
    }
    setCondition(events, targetSide, effect === 86 ? 'disable' : 'encore', applied)
    return true
  }
  if (effect === 91) {
    const average = Math.floor((actor.pokemon.currentHp + target.pokemon.currentHp) / 2)
    const actorBefore = actor.pokemon.currentHp
    const targetBefore = target.pokemon.currentHp
    actor.pokemon.currentHp = Math.min(actor.pokemon.stats.hp, average)
    target.pokemon.currentHp = Math.min(target.pokemon.stats.hp, average)
    const actorDelta = actor.pokemon.currentHp - actorBefore
    const targetDelta = target.pokemon.currentHp - targetBefore
    if (actorDelta >= 0) events.push({ kind: 'heal', side, pokemonName: actorName, amount: actorDelta })
    else events.push({ kind: 'damage', movePresentationId, side, damage: -actorDelta, critical: false, typeMultiplier: 10 })
    if (targetDelta >= 0) events.push({ kind: 'heal', side: targetSide, pokemonName: targetName, amount: targetDelta })
    else events.push({ kind: 'damage', movePresentationId, side: targetSide, damage: -targetDelta, critical: false, typeMultiplier: 10 })
    return true
  }
  if (effect === 93) { // Conversion 2
    const lastMove = target.pokemon.moves.find((move) => move.moveId === target.volatile.lastMoveId)
    const candidates = lastMove
      ? Array.from({ length: 18 }, (_, type) => type).filter((type) => (
          calculateHgssTypeMultiplier(lastMove.data.type, [type, type]) < 10 && !actor.types.includes(type)
        ))
      : []
    const type = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length] : undefined
    const applied = type !== undefined
    if (type !== undefined) actor.types = [type, type]
    setCondition(events, side, 'conversion2', applied)
    return true
  }
  if (effect === 94) {
    const applied = !actor.volatile.lockOn
    actor.volatile.lockOn = true
    setCondition(events, targetSide, 'lockOn', applied)
    return true
  }
  if (effect === 98 || effect === 194) {
    const key = effect === 98 ? 'destinyBond' : 'grudge'
    const applied = !actor.volatile[key]
    actor.volatile[key] = true
    setCondition(events, side, key, applied)
    return true
  }
  if (effect === 100) {
    const lastMove = target.pokemon.moves.find((move) => move.moveId === target.volatile.lastMoveId)
    const reduction = lastMove ? Math.min(lastMove.pp, 2 + rng.nextU16() % 4) : 0
    if (lastMove) lastMove.pp -= reduction
    setCondition(events, targetSide, 'spite', reduction > 0)
    return true
  }
  if (effect === 106) {
    const applied = !target.volatile.cannotSwitch
    if (applied) target.volatile.cannotSwitch = true
    setCondition(events, targetSide, 'trapped', applied)
    return true
  }
  if (effect === 107) {
    const applied = (target.pokemon.status & 0x7) !== 0 && !target.volatile.nightmare
    target.volatile.nightmare ||= applied
    setCondition(events, targetSide, 'nightmare', applied)
    return true
  }
  if (effect === 109) {
    if (actor.types.includes(7)) {
      const applied = !target.volatile.cursed && actor.pokemon.currentHp > Math.floor(actor.pokemon.stats.hp / 2)
      if (applied) {
        const cost = Math.max(1, Math.floor(actor.pokemon.stats.hp / 2))
        actor.pokemon.currentHp -= cost
        target.volatile.cursed = true
        events.push({ kind: 'damage', movePresentationId, side, damage: cost, critical: false, typeMultiplier: 10 })
      }
      setCondition(events, targetSide, 'curse', applied)
    } else {
      applyStageChange(session, side, 'attack', 1, events)
      applyStageChange(session, side, 'defense', 1, events)
      applyStageChange(session, side, 'speed', -1, events)
    }
    return true
  }
  if (effect === 112 || effect === 249 || effect === 266) {
    const conditions = target.screens
    let applied: boolean
    let condition = 'spikes'
    if (effect === 112) {
      applied = conditions.spikesLayers < 3
      if (applied) conditions.spikesLayers += 1
    } else if (effect === 249) {
      condition = 'toxicSpikes'
      applied = conditions.toxicSpikesLayers < 2
      if (applied) conditions.toxicSpikesLayers += 1
    } else {
      condition = 'stealthRock'
      applied = !conditions.stealthRock
      conditions.stealthRock ||= applied
    }
    setCondition(events, targetSide, condition, applied)
    return true
  }
  if (effect === 113 || effect === 216) {
    const key = effect === 113 ? 'identifiedGhost' : 'identifiedDark'
    const applied = !target.volatile[key]
    target.volatile[key] = true
    setCondition(events, targetSide, effect === 113 ? 'foresight' : 'miracleEye', applied)
    return true
  }
  if (effect === 114) {
    const applied = actor.volatile.perishTurns === 0 || target.volatile.perishTurns === 0
    actor.volatile.perishTurns ||= 4
    target.volatile.perishTurns ||= 4
    setCondition(events, side, 'perishSong', applied)
    return true
  }
  if (effect === 116) {
    actor.volatile.endured = true
    setCondition(events, side, 'endure', true)
    return true
  }
  if (effect === 118 || effect === 166) {
    applyStageChange(session, targetSide, effect === 118 ? 'attack' : 'specialAttack', effect === 118 ? 2 : 1, events)
    const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(activeBattleAbilityId(target), target.screens.safeguardTurns > 0, activeBattleAbilityId(actor) === 104)
    if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
    events.push(applied
      ? { kind: 'confusion', side: targetSide, pokemonName: targetName, state: 'started' }
      : { kind: 'noEffect', side: targetSide, pokemonName: targetName })
    return true
  }
  if (effect === 120) {
    const genders = [actor.pokemon.gender, target.pokemon.gender]
    const applied = genders[0] !== 'genderless' && genders[1] !== 'genderless' && genders[0] !== genders[1] && canHgssInfatuate(activeBattleAbilityId(target), activeBattleAbilityId(actor) === 104)
    if (applied) target.volatile.infatuated = true
    setCondition(events, targetSide, 'infatuation', applied)
    if (applied && getHeldItemEffect(session, target).effect === 108 && !actor.volatile.infatuated && canHgssInfatuate(activeBattleAbilityId(actor))) { actor.volatile.infatuated = true; setCondition(events, side, 'item:108', true) }
    return true
  }
  if (effect === 124 || effect === 225 || effect === 240) {
    const key = effect === 124 ? 'safeguardTurns' : effect === 225 ? 'tailwindTurns' : 'luckyChantTurns'
    const applied = actor.screens[key] === 0
    if (applied) actor.screens[key] = effect === 225 ? 4 : 5
    setCondition(events, side, effect === 124 ? 'safeguard' : effect === 225 ? 'tailwind' : 'luckyChant', applied)
    return true
  }
  if (effect === 142) {
    const cost = Math.floor(actor.pokemon.stats.hp / 2)
    const applied = actor.stages.attack < 6 && actor.pokemon.currentHp > cost
    if (applied) {
      actor.pokemon.currentHp -= cost
      actor.stages.attack = 6
      events.push({ kind: 'damage', movePresentationId, side, damage: cost, critical: false, typeMultiplier: 10 })
      events.push({ kind: 'stat', side, pokemonName: actorName, stat: 'attack', change: 12, applied: true })
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 143) {
    actor.stages = { ...target.stages }
    setCondition(events, side, 'psychUp', true)
    return true
  }
  if (effect === 160) {
    const applied = actor.volatile.stockpile < 3
    if (applied) {
      actor.volatile.stockpile += 1
      applyStageChange(session, side, 'defense', 1, events)
      applyStageChange(session, side, 'specialDefense', 1, events)
    }
    setCondition(events, side, 'stockpile', applied)
    return true
  }
  if (effect === 162) {
    const stockpile = actor.volatile.stockpile
    const divisor = stockpile === 1 ? 4 : stockpile === 2 ? 2 : stockpile === 3 ? 1 : 0
    const applied = divisor > 0 && actor.volatile.healBlockTurns === 0 && actor.pokemon.currentHp < actor.pokemon.stats.hp
    if (applied) {
      const amount = Math.min(actor.pokemon.stats.hp - actor.pokemon.currentHp, Math.max(1, Math.floor(actor.pokemon.stats.hp / divisor)))
      actor.pokemon.currentHp += amount
      actor.stages.defense = Math.max(-6, actor.stages.defense - stockpile)
      actor.stages.specialDefense = Math.max(-6, actor.stages.specialDefense - stockpile)
      actor.volatile.stockpile = 0
      events.push({ kind: 'heal', side, pokemonName: actorName, amount })
      setCondition(events, side, 'swallow', true)
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 168) {
    const applied = target.stages.attack > -6 || target.stages.specialAttack > -6
    if (applied) {
      applyStageChange(session, targetSide, 'attack', -2, events)
      applyStageChange(session, targetSide, 'specialAttack', -2, events)
      actor.pokemon.currentHp = 0
      emitSimpleBattleFaint(events, side, actor.pokemon)
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 165 || effect === 175) {
    const applied = effect === 165 ? !target.volatile.torment : target.volatile.tauntTurns === 0
    if (effect === 165) target.volatile.torment ||= applied
    else if (applied) target.volatile.tauntTurns = 3
    setCondition(events, targetSide, effect === 165 ? 'torment' : 'taunt', applied)
    return true
  }
  if (effect === 187) {
    const applied = target.volatile.yawnTurns === 0 && (target.pokemon.status & 0xff) === 0
    if (applied) target.volatile.yawnTurns = 2
    setCondition(events, targetSide, 'yawn', applied)
    return true
  }
  if (effect === 174) {
    actor.volatile.charged = true
    applyStageChange(session, side, 'specialDefense', 1, events)
    setCondition(events, side, 'charge', true)
    return true
  }
  if (effect === 179) {
    const applied = actor.volatile.wishTurns === 0
    if (applied) {
      actor.volatile.wishTurns = 2
      actor.volatile.wishAmount = Math.max(1, Math.floor(actor.pokemon.stats.hp / 2))
    }
    setCondition(events, side, 'wish', applied)
    return true
  }
  if (effect === 181) {
    const applied = !actor.volatile.ingrain
    actor.volatile.ingrain = true
    setCondition(events, side, 'ingrain', applied)
    return true
  }
  if (effect === 205 || effect === 206) {
    applyStageChange(session, effect === 205 ? targetSide : side, effect === 205 ? 'attack' : 'defense', effect === 205 ? -1 : 1, events)
    applyStageChange(session, effect === 205 ? targetSide : side, effect === 205 ? 'defense' : 'specialDefense', effect === 205 ? -1 : 1, events)
    return true
  }
  if (effect === 215 || effect === 259) {
    const key = effect === 215 ? 'gravityTurns' : 'trickRoomTurns'
    const applied = session.field[key] === 0
    if (applied) session.field[key] = 5
    setCondition(events, side, effect === 215 ? 'gravity' : 'trickRoom', applied)
    return true
  }
  if (effect === 232 || effect === 236 || effect === 252) {
    const key = effect === 232 ? 'embargoTurns' : effect === 236 ? 'healBlockTurns' : 'magnetRiseTurns'
    const recipient = effect === 252 ? actor : target
    const recipientSide = effect === 252 ? side : targetSide
    const applied = recipient.volatile[key] === 0
    if (applied) recipient.volatile[key] = 5
    setCondition(events, recipientSide, effect === 232 ? 'embargo' : effect === 236 ? 'healBlock' : 'magnetRise', applied)
    return true
  }
  if (effect === 243 || effect === 244 || effect === 250) {
    const stats: BattleStat[] = effect === 243
      ? ['attack', 'specialAttack']
      : effect === 244 ? ['defense', 'specialDefense'] : ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense', 'accuracy', 'evasion']
    for (const stat of stats) [actor.stages[stat], target.stages[stat]] = [target.stages[stat], actor.stages[stat]]
    setCondition(events, side, effect === 243 ? 'powerSwap' : effect === 244 ? 'guardSwap' : 'heartSwap', true)
    return true
  }
  if (effect === 251) {
    const applied = !actor.volatile.aquaRing
    actor.volatile.aquaRing = true
    setCondition(events, side, 'aquaRing', applied)
    return true
  }
  if (effect === 199) {
    const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(activeBattleAbilityId(target), target.screens.safeguardTurns > 0, activeBattleAbilityId(actor) === 104)
    if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
    events.push(applied
      ? { kind: 'confusion', side: targetSide, pokemonName: targetName, state: 'started' }
      : { kind: 'noEffect', side: targetSide, pokemonName: targetName })
    return true
  }
  if (effect === 201 || effect === 210) {
    setCondition(events, side, effect === 201 ? 'mudSport' : 'waterSport', true)
    actor.volatile[effect === 201 ? 'mudSport' : 'waterSport'] = true
    return true
  }
  if (effect === 214) {
    const applied = actor.volatile.healBlockTurns === 0 && actor.pokemon.currentHp < actor.pokemon.stats.hp
    if (applied) {
      const amount = Math.min(actor.pokemon.stats.hp - actor.pokemon.currentHp, Math.max(1, Math.floor(actor.pokemon.stats.hp / 2)))
      actor.pokemon.currentHp += amount
      events.push({ kind: 'heal', side, pokemonName: actorName, amount })
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 220 || effect === 270) {
    const recovery = effect === 220 ? 'healing-wish' : 'lunar-dance'
    const applied = actor.screens.pendingSacrificeRecovery === undefined
    if (applied) {
      actor.screens.pendingSacrificeRecovery = recovery
      actor.pokemon.currentHp = 0
      emitSimpleBattleFaint(events, side, actor.pokemon)
    }
    setCondition(events, side, recovery, applied)
    return true
  }
  if (effect === 226) {
    const available = (Object.keys(actor.stages) as BattleStat[]).filter((stat) => actor.stages[stat] < 6)
    if (available.length === 0) events.push({ kind: 'noEffect', side, pokemonName: actorName })
    else applyStageChange(session, side, available[rng.nextU16() % available.length]!, 2, events)
    return true
  }
  if (effect === 234) {
    const status = actor.pokemon.status & 0xff
    const applied = status !== 0 && (target.pokemon.status & 0xff) === 0
    if (applied) {
      const transferred = (status & 0x7) !== 0 ? 'sleep' : (status & 0x80) !== 0 ? 'badPoison'
        : (status & 0x8) !== 0 ? 'poison' : (status & 0x10) !== 0 ? 'burn'
          : (status & 0x20) !== 0 ? 'freeze' : 'paralysis'
      const result = applyHgssPrimaryStatus(transferred, target.pokemon, target.types, rng, activeBattleAbilityId(target), { weather: isHgssWeatherSuppressed([activeBattleAbilityId(session.player), activeBattleAbilityId(session.opponent)]) ? 'clear' : session.weather.kind, ignoreTargetAbility: activeBattleAbilityId(actor) === 104 })
      if (result.applied) actor.pokemon.status = 0
      events.push({ kind: 'status', side: targetSide, pokemonName: targetName, ...result })
    } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 238) {
    actor.volatile.powerTrick = !actor.volatile.powerTrick
    setCondition(events, side, 'powerTrick', actor.volatile.powerTrick)
    return true
  }
  if (effect === 258) {
    applyStageChange(session, targetSide, 'evasion', -1, events)
    target.screens.reflectTurns = 0
    target.screens.lightScreenTurns = 0
    target.screens.mistTurns = 0
    target.screens.safeguardTurns = 0
    target.screens.spikesLayers = 0
    target.screens.toxicSpikesLayers = 0
    target.screens.stealthRock = false
    setCondition(events, targetSide, 'defog', true)
    return true
  }
  if (effect === 265) {
    const applied = actor.pokemon.gender !== 'genderless' && target.pokemon.gender !== 'genderless' && actor.pokemon.gender !== target.pokemon.gender
    if (applied) applyStageChange(session, targetSide, 'specialAttack', -2, events)
    else events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 172 || effect === 176) {
    // Par Ici et Coup d'Main échouent volontairement sans partenaire en combat simple.
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return true
  }
  if (effect === 177) {
    const actorItem = actor.pokemon.heldItemId
    const targetItem = target.pokemon.heldItemId
    const applied = (actorItem !== 0 || targetItem !== 0)
      && !isHgssHeldItemRemovalBlocked(activeBattleAbilityId(target), activeBattleAbilityId(actor), targetItem !== 0) && canTransferHeldItem(session, actor, actorItem) && canTransferHeldItem(session, target, targetItem)
    if (applied) {
      [actor.pokemon.heldItemId, target.pokemon.heldItemId] = [targetItem, actorItem]
      if (actor.pokemon.heldItemId !== 0) actor.volatile.canUnburden = true
      if (target.pokemon.heldItemId !== 0) target.volatile.canUnburden = true
    }
    setCondition(events, side, 'heldItemsSwapped', applied)
    return true
  }
  if (effect === 178) {
    const ability = activeBattleAbilityId(target)
    const applied = ability > 0 && ability !== 25 && ability !== 121
    if (applied) {
      actor.volatile.abilityOverrideId = ability
      actor.volatile.abilitySuppressed = false
    }
    setCondition(events, side, 'rolePlay', applied)
    return true
  }
  if (effect === 184) {
    const applied = actor.pokemon.heldItemId === 0 && actor.volatile.recyclableItemId > 0
    if (applied) {
      actor.pokemon.heldItemId = actor.volatile.recyclableItemId
      actor.volatile.recyclableItemId = 0
      session.recyclableItems.delete(simpleBattlePokemonKey(actor.pokemon))
    }
    setCondition(events, side, 'recycle', applied)
    return true
  }
  if (effect === 191) {
    const actorAbility = activeBattleAbilityId(actor)
    const targetAbility = activeBattleAbilityId(target)
    const applied = actorAbility > 0 && targetAbility > 0 && actorAbility !== targetAbility
      && ![25, 121].includes(actorAbility) && ![25, 121].includes(targetAbility)
    if (applied) {
      actor.volatile.abilityOverrideId = targetAbility
      target.volatile.abilityOverrideId = actorAbility
      actor.volatile.abilitySuppressed = false
      target.volatile.abilitySuppressed = false
    }
    setCondition(events, side, 'skillSwap', applied)
    return true
  }
  if (effect === 239) {
    const applied = activeBattleAbilityId(target) > 0 && activeBattleAbilityId(target) !== 121
    if (applied) target.volatile.abilitySuppressed = true
    setCondition(events, targetSide, 'gastroAcid', applied)
    return true
  }
  if (effect === 247) {
    const applied = activeBattleAbilityId(target) !== 15 && activeBattleAbilityId(target) !== 121
    if (applied) {
      target.volatile.abilityOverrideId = 15
      target.volatile.abilitySuppressed = false
    }
    setCondition(events, targetSide, 'worrySeed', applied)
    return true
  }
  return false
}

function canAct(
  actor: SimpleBattleSideState,
  side: SimpleBattleSide,
  moveEffect: number,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
): boolean {
  const name = pokemonName(actor)
  if (actor.volatile.rechargeTurns > 0) {
    actor.volatile.rechargeTurns -= 1
    events.push({ kind: 'recharge', side, pokemonName: name })
    return false
  }
  if (activeBattleAbilityId(actor) === 54 && actor.volatile.turnsActive % 2 === 1) { events.push({ kind: 'cannotAct', side, pokemonName: name, reason: 'truant' }); return false }
  if (actor.volatile.flinched) {
    actor.volatile.flinched = false
    events.push({ kind: 'flinch', side, pokemonName: name })
    if (applyHgssSteadfast(actor.stages, activeBattleAbilityId(actor))) events.push({ kind: 'stat', side, pokemonName: name, stat: 'speed', change: 1, applied: true })
    return false
  }
  if ((actor.pokemon.status & 0x7) !== 0) {
    actor.pokemon.status = (actor.pokemon.status & ~0x7) | Math.max(0, (actor.pokemon.status & 0x7) - (activeBattleAbilityId(actor) === 48 ? 2 : 1))
    if ((actor.pokemon.status & 0x7) !== 0 && moveEffect !== 92 && moveEffect !== 97) {
      events.push({ kind: 'cannotAct', side, pokemonName: name, reason: 'sleep' })
      return false
    }
  }
  if ((actor.pokemon.status & 0x20) !== 0) {
    if (rng.nextU16() % 100 >= 20) {
      events.push({ kind: 'cannotAct', side, pokemonName: name, reason: 'freeze' })
      return false
    }
    actor.pokemon.status &= ~0x20
  }
  if ((actor.pokemon.status & 0x40) !== 0 && rng.nextU16() % 4 === 0) {
    events.push({ kind: 'cannotAct', side, pokemonName: name, reason: 'paralysis' })
    return false
  }
  if (actor.volatile.infatuated) {
    setCondition(events, side, 'infatuationActive', true)
    if (rng.nextU16() % 2 === 0) {
      setCondition(events, side, 'infatuationStopped', true)
      return false
    }
  }
  if (actor.volatile.confusionTurns > 0) {
    actor.volatile.confusionTurns -= 1
    if (actor.volatile.confusionTurns === 0) events.push({ kind: 'confusion', side, pokemonName: name, state: 'ended' })
    else {
      events.push({ kind: 'confusion', side, pokemonName: name, state: 'active' })
      if (rng.nextU16() % 2 === 0) {
        const damage = Math.min(actor.pokemon.currentHp, confusionSelfDamage(actor, rng))
        actor.pokemon.currentHp -= damage
        events.push({ kind: 'selfDamage', side, pokemonName: name, damage })
        emitSimpleBattleFaint(events, side, actor.pokemon)
        return false
      }
    }
  }
  return true
}

function executeMoveCore(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  moveIndex: number,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
  catalog: PokemonCatalog,
  invokedMove?: PokemonMoveData,
  invocationDepth = 0,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  if (session.phase === 'ended') return
  const actor = session[side]
  const targetSide: SimpleBattleSide = side === 'player' ? 'opponent' : 'player'
  const target = session[targetSide]
  const actorHeld = getHeldItemEffect(session, actor)
  const targetHeld = getHeldItemEffect(session, target)
  const actorAbility = activeBattleAbilityId(actor)
  const targetAbility = activeBattleAbilityId(target)
  const activeWeather = isHgssWeatherSuppressed([actorAbility, targetAbility]) ? 'clear' : session.weather.kind
  if (actor.pokemon.currentHp <= 0) return
  const continuingLock = !invokedMove && actor.volatile.lockedMoveTurns > 0 && actor.volatile.lockedMoveIndex >= 0
  const selectedMoveIndex = continuingLock ? actor.volatile.lockedMoveIndex : moveIndex
  const continuingLockKind = continuingLock ? actor.volatile.lockedMoveKind : undefined
  const usingStruggle = !invokedMove && selectedMoveIndex === -1 && getSelectableSimpleBattleMoveIndexes(session, side).length === 0
  const struggleData = usingStruggle ? catalog.moves[165] : undefined
  const move = invokedMove
    ? { moveId: invokedMove.moveId, pp: 1, maxPp: invokedMove.pp, ppUps: 0, data: invokedMove }
    : continuingLock && actor.volatile.lockedMoveData
    ? { moveId: actor.volatile.lockedMoveData.moveId, pp: 1, maxPp: actor.volatile.lockedMoveData.pp, ppUps: 0, data: actor.volatile.lockedMoveData }
    : usingStruggle && struggleData
    ? { moveId: 165, pp: 1, maxPp: 1, ppUps: 0, data: struggleData }
    : actor.pokemon.moves[selectedMoveIndex]
  if (!move || (!invokedMove && !continuingLock && !usingStruggle && move.pp <= 0) || !isMoveSupportedBySimpleBattle(move)) throw new Error(`La capacité de combat ${selectedMoveIndex} n'est pas utilisable.`)
  const actorName = actor.pokemon.nickname ?? actor.pokemon.speciesName
  const emitMoveStatus = (result: { status: HgssAppliedStatus, applied: boolean } | undefined) => {
    const chain = resolveHgssSynchronizeStatusChain(result, targetAbility, actor.pokemon, actor.types, actorAbility, rng, { weather: activeWeather })
    for (const entry of chain) events.push({ kind: 'status', side: entry.recipient === 'source' ? side : targetSide, pokemonName: entry.recipient === 'source' ? actorName : pokemonName(target), status: entry.status, applied: entry.applied })
    return chain.length > 0
  }
  if (!invokedMove && target.volatile.imprison && target.pokemon.moves.some(({ moveId }) => moveId === move.moveId)) {
    setCondition(events, side, 'imprisonedMove', false)
    return
  }
  if (!invokedMove) {
    activateAutoHeldItem(session, side, rng, events)
    actor.volatile.actedThisTurn = true
    if (!canAct(actor, side, move.data.effect, rng, events)) {
      if (actor.pokemon.currentHp === 0) resolveSimpleBattleFaints(session, events, playerTeamPolicy)
      return
    }
  }
  if (continuingLock) {
    actor.volatile.lockedMoveTurns -= 1
    if (actor.volatile.lockedMoveTurns === 0) {
      actor.volatile.lockedMoveIndex = -1
      actor.volatile.lockedMoveKind = undefined
      actor.volatile.lockedMoveData = undefined
      actor.volatile.semiInvulnerable = undefined
    }
  } else if (!invokedMove && !usingStruggle) move.pp = Math.max(0, move.pp - resolveHgssPressurePpCost({ moveId: move.moveId, range: move.data.range, targetIsAttacker: (move.data.range & (1 << 4)) !== 0, targetAbilityId: targetAbility, opposingAbilityIds: [targetAbility], otherAbilityIds: [targetAbility] }))
  if ((move.data.effect === 92 || move.data.effect === 97) && (actor.pokemon.status & 0x7) === 0) {
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return
  }
  if (!continuingLock && move.data.effect === 246) {
    const otherMoveIds = actor.pokemon.moves.filter((knownMove) => knownMove.moveId !== move.moveId).map((knownMove) => knownMove.moveId)
    if (otherMoveIds.length === 0 || otherMoveIds.some((moveId) => !actor.volatile.usedMoveIds.has(moveId))) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
  }
  if (!invokedMove && !continuingLock && !usingStruggle) actor.volatile.usedMoveIds.add(move.moveId)
  if (!invokedMove && !continuingLock && move.data.effect !== 81) actor.volatile.rage = false
  if (!invokedMove && !continuingLock && move.data.effect !== 119) actor.volatile.furyCutterCount = 0
  if (!invokedMove && move.data.effect !== 98) actor.volatile.destinyBond = false
  if (!invokedMove && move.data.effect !== 194) actor.volatile.grudge = false
  if (!invokedMove && [55, 115, 125].includes(actorHeld.effect) && actor.volatile.choiceMoveId === 0) actor.volatile.choiceMoveId = move.moveId
  if (!invokedMove) actor.volatile.lastMoveId = move.moveId
  if (move.data.effect !== 111) actor.volatile.protectStreak = 0
  const movePresentationId = events.length + 1
  events.push({
    kind: 'move',
    presentationId: movePresentationId,
    side,
    pokemonName: actorName,
    actorSpeciesId: actor.pokemon.speciesId,
    targetSpeciesId: target.pokemon.speciesId,
    weather: activeWeather,
    moveId: move.data.moveId,
    moveName: move.data.moveId.toString(),
    moveType: move.data.type,
    moveCategory: move.data.category,
  })
  const previousExecutedMove = session.lastExecutedMove
  session.lastExecutedMove = { ...move.data }
  const chargeKind = resolveHgssChargeKind(move.data.effect, activeWeather)
  const powerHerb = !continuingLock && Boolean(chargeKind) && actorHeld.effect === 99
  if (powerHerb) { consumeHeldItem(session, actor); setCondition(events, side, 'powerHerb', true) }
  if (!continuingLock && chargeKind && !powerHerb) {
    actor.volatile.lockedMoveIndex = selectedMoveIndex
    actor.volatile.lockedMoveTurns = 1
    actor.volatile.lockedMoveKind = 'charge'
    actor.volatile.lockedMoveData = invokedMove ? { ...move.data } : undefined
    actor.volatile.semiInvulnerable = ['dig', 'dive', 'fly', 'shadow'].includes(chargeKind) ? chargeKind as SimpleBattleSemiInvulnerable : undefined
    if (chargeKind === 'skullBash') applyStageChange(session, side, 'defense', 1, events)
    setCondition(events, side, `charge:${chargeKind}`, true)
    return
  }
  if (move.data.effect === 26) {
    if (!continuingLock) {
      actor.volatile.lockedMoveIndex = selectedMoveIndex
      actor.volatile.lockedMoveTurns = 2
      actor.volatile.lockedMoveKind = 'bide'
      actor.volatile.lockedMoveData = invokedMove ? { ...move.data } : undefined
      actor.volatile.bideDamage = 0
      setCondition(events, side, 'bideStore', true)
      return
    }
    if (continuingLockKind === 'bide' && actor.volatile.lockedMoveTurns > 0) {
      setCondition(events, side, 'bideStore', true)
      return
    }
    if (actor.volatile.bideDamage === 0) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
  }
  if (move.data.effect === 148) {
    const occupied = session.futureAttacks.some((pending) => pending.target === targetSide)
    if (occupied) events.push({ kind: 'noEffect', side, pokemonName: actorName })
    else {
      const snapshot = calculateHgssMoveDamage({
        attacker: { ...actor.pokemon, abilityId: 0 }, defender: { ...target.pokemon, abilityId: 0 },
        attackerTypes: [18, 18], defenderTypes: [0, 0], attackerStages: { ...actor.stages },
        defenderStages: { ...target.stages }, move: move.data, rng, criticalMultiplier: 1,
      })
      session.futureAttacks.push({
        turns: 3, target: targetSide, damage: snapshot.damage,
        hits: doesHgssMoveHit(move.data, actor.stages, target.stages, rng),
      })
      setCondition(events, targetSide, 'futureSight', true)
    }
    return
  }
  if (move.data.effect === 170 && actor.volatile.lastDamageTaken > 0) {
    setCondition(events, side, 'focusPunchLost', true)
    return
  }
  if (move.data.effect === 248) {
    const targetPlan = session.plannedMoves?.[targetSide]
    if (!targetPlan || targetPlan.power === 0 || target.volatile.actedThisTurn) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
  }
  const targetsOpponent = (move.data.range & ((1 << 4) | (1 << 5) | (1 << 6))) === 0
  if (move.data.power === 0 && targetsOpponent && target.volatile.magicCoat && (move.data.flags & 4) !== 0 && invocationDepth < 4) {
    target.volatile.magicCoat = false
    setCondition(events, targetSide, 'magicCoatReflected', true)
    executeMove(session, targetSide, selectedMoveIndex, rng, events, catalog, move.data, invocationDepth + 1, playerTeamPolicy)
    return
  }
  if (move.data.power === 0 && !targetsOpponent && target.volatile.snatch && (move.data.flags & 8) !== 0 && invocationDepth < 4) {
    target.volatile.snatch = false
    setCondition(events, targetSide, 'moveSnatched', true)
    executeMove(session, targetSide, selectedMoveIndex, rng, events, catalog, move.data, invocationDepth + 1, playerTeamPolicy)
    return
  }
  if (targetsOpponent && target.volatile.protected && move.data.effect !== 223 && move.data.effect !== 272) {
    events.push({ kind: 'protected', side: targetSide, pokemonName: pokemonName(target), applied: false })
    return
  }
  if (target.volatile.semiInvulnerable && !canHgssMoveHitSemiInvulnerable(move.data.effect, target.volatile.semiInvulnerable)) {
    events.push({ kind: 'miss', side, pokemonName: actorName })
    return
  }
  if (targetsOpponent && isHgssMoveBlockedBySoundproof(move.moveId, actorAbility, targetAbility)) { events.push({ kind: 'noEffect', side: targetSide, pokemonName: pokemonName(target) }); return }
  if (move.data.effect === 7 && (actorAbility === 6 || targetAbility === 6)) { events.push({ kind: 'noEffect', side, pokemonName: actorName }); return }
  let weatherAccuracy = resolveHgssWeatherAccuracy({ ...move.data, accuracy: applyHgssHeldAccuracy(move.data.accuracy, actorHeld, targetHeld, target.volatile.actedThisTurn) }, activeWeather)
  if (actor.volatile.micleAccuracy && weatherAccuracy !== 'always-hit') weatherAccuracy = { ...weatherAccuracy, accuracy: Math.min(100, Math.floor(weatherAccuracy.accuracy * 6 / 5)) }
  actor.volatile.micleAccuracy = false
  const hits = actor.volatile.lockOn || actorAbility === 99 || targetAbility === 99
    || move.data.effect === 17 || move.data.effect === 78 || (move.data.effect === 260 && activeWeather === 'hail')
    || weatherAccuracy === 'always-hit'
    ? true
    : move.data.effect === 38
      ? actor.pokemon.level >= target.pokemon.level && rng.nextU16() % 100 < move.data.accuracy + actor.pokemon.level - target.pokemon.level
      : doesHgssMoveHit(
          weatherAccuracy,
          actor.stages,
          target.volatile.identifiedGhost || target.volatile.identifiedDark
            ? { ...target.stages, evasion: 0 }
            : target.stages,
          rng,
          { attackerAbilityId: actorAbility, targetAbilityId: targetAbility, weather: activeWeather, targetConfused: target.volatile.confusionTurns > 0 },
        )
  actor.volatile.lockOn = false
  if (!hits) {
    events.push({ kind: 'miss', side, pokemonName: actor.pokemon.nickname ?? actor.pokemon.speciesName })
    if (move.data.effect === 117) {
      actor.volatile.rolloutCount = 0
      actor.volatile.lockedMoveIndex = -1
      actor.volatile.lockedMoveTurns = 0
      actor.volatile.lockedMoveKind = undefined
    }
    if (move.data.effect === 45 && actor.pokemon.currentHp > 0) {
      const damage = Math.min(actor.pokemon.currentHp, Math.max(1, Math.floor(actor.pokemon.stats.hp / 2)))
      actor.pokemon.currentHp -= damage
      events.push({ kind: 'recoil', side, pokemonName: actorName, damage })
      emitSimpleBattleFaint(events, side, actor.pokemon)
    }
    return
  }
  ({ moveId: actor.volatile.metronomeMoveId, turns: actor.volatile.metronomeTurns } = resolveHgssMetronomeState(actorHeld, move.moveId, actor.volatile.metronomeMoveId, actor.volatile.metronomeTurns, continuingLock))
  if (move.data.power === 0) {
    if (targetsOpponent && target.volatile.substituteHp > 0 && move.data.effect !== 223) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    if (actor.volatile.healBlockTurns > 0 && [32, 37, 91, 132, 162, 193, 214, 220, 251, 270].includes(move.data.effect)) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    let handled = false
    const primaryStatus = target.screens.safeguardTurns === 0
      ? applySupportedHgssPrimaryStatus(move.data, target.pokemon, target.types, rng, targetAbility, actorAbility, { weather: activeWeather })
      : undefined
    if (emitMoveStatus(primaryStatus)) handled = true
    const targetStagesBefore = { ...target.stages }
    const statEffect = applySupportedHgssStatusMoveEffect(move.data, actor.stages, target.stages, rng, actorAbility, targetAbility)
    if (statEffect) {
      const affectedSide = statEffect.change > 0 ? side : targetSide
      const affected = session[affectedSide].pokemon
      const blockedByMist = statEffect.change < 0 && target.screens.mistTurns > 0
      if (blockedByMist) target.stages = targetStagesBefore
      events.push({ kind: 'stat', side: affectedSide, pokemonName: affected.nickname ?? affected.speciesName, ...statEffect, applied: blockedByMist ? false : statEffect.applied })
      handled = true
    }
    if (move.data.effect === 108) actor.volatile.minimized = true
    if (move.data.effect === 25) {
      actor.stages = { ...neutralBattleStatStages }
      target.stages = { ...neutralBattleStatStages }
      events.push({ kind: 'statsReset' })
      handled = true
    } else if (move.data.effect === 8) {
      const amount = actor.pokemon.stats.hp - actor.pokemon.currentHp
      if (amount > 0 && (actor.pokemon.status & 0x7) === 0) {
        actor.pokemon.currentHp = actor.pokemon.stats.hp
        actor.pokemon.status = 2 + rng.nextU16() % 3
        events.push({ kind: 'heal', side, pokemonName: actorName, amount })
        events.push({ kind: 'status', side, pokemonName: actorName, status: 'sleep', applied: true })
      } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
      handled = true
    } else if (move.data.effect === 32 || move.data.effect === 132) {
      const amount = actor.volatile.healBlockTurns > 0
        ? 0
        : Math.min(actor.pokemon.stats.hp - actor.pokemon.currentHp, Math.max(1, Math.floor(actor.pokemon.stats.hp / 2)))
      actor.pokemon.currentHp += amount
      if (amount > 0) events.push({ kind: 'heal', side, pokemonName: actorName, amount })
      else events.push({ kind: 'noEffect', side, pokemonName: actorName })
      handled = true
    } else if (move.data.effect === 102 || move.data.effect === 193) {
      const applied = actor.pokemon.status !== 0
      actor.pokemon.status = 0
      events.push({ kind: 'statusCured', side, pokemonName: actorName, applied })
      handled = true
    } else if (move.data.effect === 35 || move.data.effect === 65) {
      const screen = move.data.effect === 35 ? 'lightScreen' : 'reflect'
      actor.screens[`${screen}Turns`] = actorHeld.effect === 97 ? 8 : 5
      events.push({ kind: 'screen', side, screen })
      handled = true
    } else if ([115, 136, 137, 164].includes(move.data.effect)) {
      const weather = move.data.effect === 115 ? 'sandstorm' : move.data.effect === 136 ? 'rain' : move.data.effect === 137 ? 'sun' : 'hail'
      const extender = { sandstorm: 111, rain: 113, sun: 112, hail: 110 }[weather]
      session.weather = {
        kind: weather,
        turns: actorHeld.effect === extender ? 8 : 5,
      }
      events.push({ kind: 'weather', weather: session.weather.kind })
      handled = true
    } else if (move.data.effect === 49) {
      const applied = target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbility, target.screens.safeguardTurns > 0, actorAbility === 104)
      if (applied) target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push(applied
        ? { kind: 'confusion', side: targetSide, pokemonName: pokemonName(target), state: 'started' }
        : { kind: 'noEffect', side: targetSide, pokemonName: pokemonName(target) })
      handled = true
    } else if (move.data.effect === 84) {
      const applied = !target.volatile.seeded && !target.types.includes(12)
      target.volatile.seeded ||= applied
      events.push(applied
        ? { kind: 'leechSeed', side: targetSide, pokemonName: pokemonName(target), damage: 0, healedSide: side }
        : { kind: 'noEffect', side: targetSide, pokemonName: pokemonName(target) })
      handled = true
    } else if (move.data.effect === 111) {
      const denominator = 1 << Math.min(3, actor.volatile.protectStreak)
      const applied = rng.nextU16() % denominator === 0
      actor.volatile.protected = applied
      actor.volatile.protectStreak = applied ? actor.volatile.protectStreak + 1 : 0
      events.push({ kind: 'protected', side, pokemonName: actorName, applied })
      handled = true
    } else if (move.data.effect === 183 || move.data.effect === 195) {
      const property = move.data.effect === 183 ? 'magicCoat' : 'snatch'
      const applied = !actor.volatile[property]
      actor.volatile[property] = true
      setCondition(events, side, property, applied)
      handled = true
    } else if (move.data.effect === 192) {
      const applied = !actor.volatile.imprison
      actor.volatile.imprison = true
      setCondition(events, side, 'imprison', applied)
      handled = true
    } else if (move.data.effect === 153) {
      if (session.kind === 'wild') {
        events.push({ kind: 'escaped' })
        finish(session, 'escaped', events)
      } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
      handled = true
    } else if (move.data.effect === 208) {
      applyStageChange(session, side, 'attack', 1, events)
      applyStageChange(session, side, 'defense', 1, events)
      handled = true
    } else if (move.data.effect === 211) {
      applyStageChange(session, side, 'specialAttack', 1, events)
      applyStageChange(session, side, 'specialDefense', 1, events)
      handled = true
    } else if (move.data.effect === 212) {
      applyStageChange(session, side, 'attack', 1, events)
      applyStageChange(session, side, 'speed', 1, events)
      handled = true
    } else if (move.data.effect === 28) {
      if (session.kind === 'wild') {
        events.push({ kind: 'escaped' })
        finish(session, 'escaped', events)
      } else {
        const blocked = target.volatile.ingrain || activeBattleAbilityId(target) === 21
        if (blocked || !forceSimpleBattleSwitch(session, targetSide, 'forced', catalog, rng, events, playerTeamPolicy)) {
          events.push({ kind: 'noEffect', side, pokemonName: actorName })
        }
      }
      handled = true
    } else if (move.data.effect === 127) {
      const applied = simpleBattleReserve(session, side, playerTeamPolicy).length > 0
      if (applied) {
        session.pendingSwitches[side] = 'batonPass'
        if (side === 'player') events.push({ kind: 'switchRequest', side, reason: 'batonPass' })
        else forceSimpleBattleSwitch(session, side, 'batonPass', catalog, rng, events, playerTeamPolicy)
      } else events.push({ kind: 'noEffect', side, pokemonName: actorName })
      handled = true
    } else if (move.data.effect === 9) {
      const source = target.pokemon.moves.find((candidate) => candidate.moveId === target.volatile.lastMoveId)
      const applied = Boolean(source && selectedMoveIndex >= 0 && ![0, 119, 165, 166, 448].includes(source.moveId))
      if (source && applied) {
        if (actor.volatile.mimicMoveSlot < 0) actor.volatile.originalMimicMove = { ...move, data: { ...move.data } }
        actor.volatile.mimicMoveSlot = selectedMoveIndex
        actor.pokemon.moves[selectedMoveIndex] = { moveId: source.moveId, pp: 5, maxPp: 5, ppUps: 0, data: { ...source.data } }
      }
      setCondition(events, side, 'mimic', applied)
      handled = true
    } else if (move.data.effect === 82) {
      const source = target.pokemon.moves.find((candidate) => candidate.moveId === target.volatile.lastMoveId)?.data
        ?? catalog.moves[target.volatile.lastMoveId]
      if (!source || !isHgssMoveCallableBy(source.moveId, 'mirrorMove') || invocationDepth >= 4) {
        events.push({ kind: 'noEffect', side, pokemonName: actorName })
      } else executeMove(session, side, selectedMoveIndex, rng, events, catalog, source, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 83) {
      const candidates = catalog.moves.filter((candidate) => candidate && isHgssMoveCallableBy(candidate.moveId, 'metronome'))
      const invoked = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length] : undefined
      if (!invoked || invocationDepth >= 4) events.push({ kind: 'noEffect', side, pokemonName: actorName })
      else executeMove(session, side, selectedMoveIndex, rng, events, catalog, invoked, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 97) {
      const candidates = actor.pokemon.moves.filter((candidate) => candidate.moveId !== move.moveId && isHgssMoveCallableBy(candidate.moveId, 'sleepTalk'))
      const invoked = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length]?.data : undefined
      if (!invoked || invocationDepth >= 4) events.push({ kind: 'noEffect', side, pokemonName: actorName })
      else executeMove(session, side, selectedMoveIndex, rng, events, catalog, invoked, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 173) {
      const invokedMoveId = catalog.naturePowerMoveIds?.[session.terrainId]
      const natureMove = invokedMoveId === undefined ? undefined : catalog.moves[invokedMoveId]
      if (!natureMove || invocationDepth >= 4) events.push({ kind: 'noEffect', side, pokemonName: actorName })
      else executeMove(session, side, selectedMoveIndex, rng, events, catalog, natureMove, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 180) {
      const actorKey = simpleBattlePokemonKey(actor.pokemon)
      const candidates = simpleBattlePartyMembers(session, side)
        .filter((pokemon) => simpleBattlePokemonKey(pokemon) !== actorKey)
        .flatMap((pokemon) => pokemon.moves)
        .filter((candidate) => isHgssMoveCallableBy(candidate.moveId, 'assist'))
      const invoked = candidates.length > 0 ? candidates[rng.nextU16() % candidates.length]?.data : undefined
      if (!invoked || invocationDepth >= 4) events.push({ kind: 'noEffect', side, pokemonName: actorName })
      else executeMove(session, side, selectedMoveIndex, rng, events, catalog, invoked, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 242) {
      if (!previousExecutedMove || !isHgssMoveCallableBy(previousExecutedMove.moveId, 'copycat') || invocationDepth >= 4) {
        events.push({ kind: 'noEffect', side, pokemonName: actorName })
      } else executeMove(session, side, selectedMoveIndex, rng, events, catalog, previousExecutedMove, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 241) {
      const targetPlan = session.plannedMoves?.[targetSide]
      if (!targetPlan || targetPlan.power === 0 || target.volatile.actedThisTurn || invocationDepth >= 4) {
        events.push({ kind: 'noEffect', side, pokemonName: actorName })
      } else executeMove(session, side, selectedMoveIndex, rng, events, catalog, { ...targetPlan, power: Math.floor(targetPlan.power * 3 / 2) }, invocationDepth + 1, playerTeamPolicy)
      handled = true
    } else if (move.data.effect === 213) {
      const type = catalog.camouflageTypeIds?.[session.terrainId]
      const applied = type !== undefined && (actor.types[0] !== type || actor.types[1] !== type)
      if (type !== undefined && applied) actor.types = [type, type]
      setCondition(events, side, 'camouflage', applied)
      handled = true
    } else if (move.data.effect === 95) { // Gribouille
      const copied = target.pokemon.moves.find((candidate) => candidate.moveId === target.volatile.lastMoveId)
      const forbidden = copied && [0, 165, 166, 448].includes(copied.moveId)
      const applied = Boolean(copied && !forbidden && moveIndex >= 0)
      if (copied && applied) {
        actor.pokemon.moves[moveIndex] = {
          moveId: copied.moveId,
          pp: copied.data.pp,
          maxPp: copied.data.pp,
          ppUps: 0,
          data: { ...copied.data },
        }
      }
      setCondition(events, side, 'sketch', applied)
      handled = true
    } else if (applyComplexStatusMoveEffect(session, side, targetSide, move.data.effect, rng, events, movePresentationId)) {
      handled = true
    }
    if (!handled) events.push({ kind: 'noEffect', side, pokemonName: actorName })
    if (simpleBattleHasEnded(session)) return
    activateAutoHeldItem(session, targetSide, rng, events)
    activateAutoHeldItem(session, side, rng, events)
    if (actor.pokemon.currentHp === 0) resolveSimpleBattleFaints(session, events, playerTeamPolicy)
    return
  }
  if (move.data.effect === 8 && (target.pokemon.status & 0x7) === 0) {
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return
  }
  let baseDamageMove = move.data
  let flungItemEffect: { effect: number, parameter: number } | undefined
  if (move.data.effect === 122) {
    const presentRoll = rng.nextU16() % 10
    if (presentRoll >= 8) {
      const amount = Math.min(target.pokemon.stats.hp - target.pokemon.currentHp, Math.max(1, Math.floor(target.pokemon.stats.hp / 4)))
      target.pokemon.currentHp += amount
      if (amount > 0) events.push({ kind: 'heal', side: targetSide, pokemonName: pokemonName(target), amount })
      else events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    baseDamageMove = { ...move.data, power: presentRoll < 4 ? 40 : presentRoll < 7 ? 80 : 120 }
  } else if (move.data.effect === 126) {
    const magnitude = resolveHgssMagnitudePower(rng.nextU16() % 100)
    baseDamageMove = { ...move.data, power: magnitude.power }
    setCondition(events, side, `magnitude:${magnitude.level}`, true)
  } else if (move.data.effect === 161) {
    if (actor.volatile.stockpile === 0) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    baseDamageMove = { ...move.data, power: actor.volatile.stockpile * 100 }
  } else if (move.data.effect === 135) {
    baseDamageMove = { ...move.data, ...resolveHgssHiddenPower(actor.pokemon.individualValues) }
  } else if (move.data.effect === 222) {
    const item = session.itemCatalog?.items[actor.pokemon.heldItemId]
    if (!item || item.fieldPocket !== 4 || item.naturalGiftPower <= 0) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    baseDamageMove = { ...move.data, power: item.naturalGiftPower, type: item.naturalGiftType }
  } else if (move.data.effect === 233) {
    const item = session.itemCatalog?.items[actor.pokemon.heldItemId]
    if (!item || item.flingPower <= 0 || actorAbility === 103 || !canTransferHeldItem(session, actor, actor.pokemon.heldItemId)) {
      events.push({ kind: 'noEffect', side, pokemonName: actorName })
      return
    }
    baseDamageMove = { ...move.data, power: item.flingPower }
    flungItemEffect = { effect: item.flingEffect, parameter: item.holdEffectParameter }
  } else if (move.data.effect === 235) {
    baseDamageMove = { ...move.data, power: invokedMove ? 40 : resolveHgssTrumpCardPower(move.pp) }
  } else if (move.data.effect === 268) {
    baseDamageMove = { ...move.data, type: resolveHgssPlateType(actor.pokemon.heldItemId) ?? move.data.type }
  }
  const damageMove = resolveHgssContextualDamageMove(baseDamageMove, {
    weather: activeWeather,
    rolloutCount: actor.volatile.rolloutCount,
    defenseCurl: actor.volatile.defenseCurl,
    targetMinimized: target.volatile.minimized,
    targetSemiInvulnerable: target.volatile.semiInvulnerable,
    furyCutterCount: actor.volatile.furyCutterCount,
    attackerDamagedThisTurn: actor.volatile.lastDamageTaken > 0,
    targetActedThisTurn: target.volatile.actedThisTurn,
    targetDamagedThisTurn: target.volatile.lastDamageTaken > 0,
    targetSwitching: session.switchingSide === targetSide,
  })
  // Casse-Brique détruit les écrans avant le calcul, afin que sa propre frappe
  // ne soit pas réduite par Protection ou Mur Lumière.
  if (move.data.effect === 186) {
    const removed = target.screens.reflectTurns > 0 || target.screens.lightScreenTurns > 0
    target.screens.reflectTurns = 0
    target.screens.lightScreenTurns = 0
    if (removed) setCondition(events, targetSide, 'screensBroken', true)
  }
  const highCritical = [39, 43, 75, 200, 209].includes(move.data.effect)
  const fixedDamage = move.data.effect === 38 ? target.pokemon.currentHp
    : move.data.effect === 40 ? Math.max(1, Math.floor(target.pokemon.currentHp / 2))
      : move.data.effect === 41 ? 40
        : move.data.effect === 87 ? actor.pokemon.level
          : move.data.effect === 101 ? Math.max(0, target.pokemon.currentHp - 1)
            : move.data.effect === 130 ? 10
              : move.data.effect === 88 ? Math.max(1, Math.floor(actor.pokemon.level * (50 + rng.nextU16() % 101) / 100))
                : move.data.effect === 89 && actor.volatile.lastDamageCategory === 0 ? actor.volatile.lastDamageTaken * 2
                  : move.data.effect === 144 && actor.volatile.lastDamageCategory === 1 ? actor.volatile.lastDamageTaken * 2
                    : move.data.effect === 189 ? Math.max(0, target.pokemon.currentHp - actor.pokemon.currentHp)
                      : move.data.effect === 227 && actor.volatile.lastDamageCategory !== -1 ? Math.floor(actor.volatile.lastDamageTaken * 3 / 2)
                        : move.data.effect === 26 ? actor.volatile.bideDamage * 2
              : undefined
  const beatUpMembers = move.data.effect === 154
    ? simpleBattlePartyMembers(session, side).filter((pokemon) => !pokemon.isEgg && pokemon.currentHp > 0 && pokemon.status === 0)
    : undefined
  if (beatUpMembers?.length === 0) {
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
    return
  }
  const hitRoll = rng.nextU16() % 8
  const hitCount = beatUpMembers?.length ?? (move.data.effect === 44 ? 2 : move.data.effect === 104 ? 3
    : move.data.effect === 29 || move.data.effect === 77 ? actorAbility === 92 ? 5 : hitRoll < 3 ? 2 : hitRoll < 6 ? 3 : hitRoll === 6 ? 4 : 5
      : 1)
  const defenderAbilityApplies = actorAbility !== 104
  const absorbingAbility = defenderAbilityApplies && (damageMove.type === 13 && targetAbility === 10
    || damageMove.type === 11 && (targetAbility === 11 || targetAbility === 87)
  )
  if (absorbingAbility) {
    const amount = target.volatile.healBlockTurns > 0
      ? 0
      : Math.min(target.pokemon.stats.hp - target.pokemon.currentHp, Math.max(1, Math.floor(target.pokemon.stats.hp / 4)))
    target.pokemon.currentHp += amount
    events.push({ kind: 'damage', movePresentationId, side: targetSide, damage: 0, critical: false, typeMultiplier: 0 })
    setCondition(events, targetSide, `ability:${targetAbility}`, true)
    if (amount > 0) events.push({ kind: 'abilityHeal', side: targetSide, pokemonName: pokemonName(target), abilityId: targetAbility, amount })
    return
  }
  if (defenderAbilityApplies && damageMove.type === 13 && targetAbility === 78) {
    events.push({ kind: 'damage', movePresentationId, side: targetSide, damage: 0, critical: false, typeMultiplier: 0 })
    setCondition(events, targetSide, 'ability:78', true)
    applyStageChange(session, targetSide, 'speed', 1, events)
    return
  }
  if (defenderAbilityApplies && damageMove.type === 10 && targetAbility === 18) {
    const applied = !target.volatile.flashFire
    target.volatile.flashFire = true
    events.push({ kind: 'damage', movePresentationId, side: targetSide, damage: 0, critical: false, typeMultiplier: 0 })
    setCondition(events, targetSide, 'flashFire', applied)
    return
  }
  let dealtDamage = 0
  let substituteDamage = 0
  let anyCritical = false
  let actualHits = 0
  let typeMultiplier = calculateHgssTypeMultiplier(
    damageMove.type,
    target.types,
    false,
    target.volatile.identifiedGhost,
    target.volatile.identifiedDark,
  )
  for (let hit = 0; hit < hitCount && target.pokemon.currentHp > 0; hit += 1) {
    actualHits += 1
    const heldCriticalStage = resolveHgssHeldCriticalStage(actorHeld, actor.pokemon.speciesId)
    const criticalStage = Math.min(4, (highCritical ? 1 : 0) + (actor.volatile.focusEnergy ? 2 : 0) + (actorAbility === 105 ? 1 : 0) + heldCriticalStage)
    const criticalDenominator = [16, 8, 4, 3, 2][criticalStage]!
    const critical = target.screens.luckyChantTurns === 0 && targetAbility !== 4 && targetAbility !== 75
      && rng.nextU16() % criticalDenominator === 0
    anyCritical ||= critical
    let heldStats = { ...actor.pokemon.stats }
    if (actor.volatile.powerTrick) [heldStats.attack, heldStats.defense] = [heldStats.defense, heldStats.attack]
    heldStats = applyHgssHeldAttackStats(heldStats, actorHeld, damageMove.category, actor.pokemon.speciesId)
    let defenderStats = { ...target.pokemon.stats }
    if (target.volatile.powerTrick) [defenderStats.attack, defenderStats.defense] = [defenderStats.defense, defenderStats.attack]
    defenderStats = applyHgssHeldBattleStats(defenderStats, targetHeld, target.pokemon.speciesId, 'defender')
    const beatUpMember = beatUpMembers?.[hit]
    const beatUpAttack = beatUpMember ? catalog.personalData[beatUpMember.speciesId]?.baseStats.attack : undefined
    const beatUpDefense = beatUpMember ? catalog.personalData[target.pokemon.speciesId]?.baseStats.defense : undefined
    const damageAttacker = beatUpMember
      ? { ...beatUpMember, abilityId: 0, stats: { ...beatUpMember.stats, attack: beatUpAttack ?? beatUpMember.stats.attack } }
      : { ...actor.pokemon, abilityId: actorAbility, stats: heldStats }
    const damageDefender = beatUpMember
      ? { ...target.pokemon, abilityId: 0, stats: { ...target.pokemon.stats, defense: beatUpDefense ?? target.pokemon.stats.defense } }
      : { ...target.pokemon, abilityId: targetAbility, stats: defenderStats }
    const calculatedDamage = calculateHgssMoveDamage({
      attacker: damageAttacker,
      defender: damageDefender,
      attackerTypes: beatUpMember ? [18, 18] as const : actor.types,
      defenderTypes: target.types,
      attackerStages: beatUpMember ? neutralBattleStatStages : actor.stages,
      defenderStages: beatUpMember ? neutralBattleStatStages : target.stages,
      move: damageMove,
      rng,
      defenderWeightTenthsKg: catalog.weightsTenthsKg?.[target.pokemon.speciesId],
      criticalMultiplier: critical ? actorAbility === 97 ? 3 : 2 : 1,
      ignoreGroundImmunity: session.field.gravityTurns > 0 || targetHeld.effect === 106,
      grantGroundImmunity: session.field.gravityTurns === 0 && targetHeld.effect !== 106 && target.volatile.magnetRiseTurns > 0,
      identifyGhost: target.volatile.identifiedGhost,
      identifyDark: target.volatile.identifiedDark,
      weather: activeWeather,
      attackerFlowerGiftActive: actorAbility === 122,
      defenderFlowerGiftActive: targetAbility === 122,
      attackerTurnsActive: actor.volatile.turnsActive,
    })
    typeMultiplier = calculatedDamage.typeMultiplier
    let hitDamage = fixedDamage ?? calculatedDamage.damage
    if (fixedDamage === undefined && activeWeather === 'rain') {
      if (damageMove.type === 11) hitDamage = Math.floor(hitDamage * 3 / 2)
      else if (damageMove.type === 10) hitDamage = Math.floor(hitDamage / 2)
    } else if (fixedDamage === undefined && activeWeather === 'sun') {
      if (damageMove.type === 10) hitDamage = Math.floor(hitDamage * 3 / 2)
      else if (damageMove.type === 11) hitDamage = Math.floor(hitDamage / 2)
    }
    if (fixedDamage === undefined && damageMove.type === 10 && actor.volatile.flashFire) hitDamage = Math.floor(hitDamage * 3 / 2)
    if (fixedDamage === undefined && damageMove.type === 13 && (actor.volatile.mudSport || target.volatile.mudSport)) hitDamage = Math.floor(hitDamage / 2)
    if (fixedDamage === undefined && damageMove.type === 10 && (actor.volatile.waterSport || target.volatile.waterSport)) hitDamage = Math.floor(hitDamage / 2)
    if (fixedDamage === undefined && damageMove.type === 13 && actor.volatile.charged) hitDamage *= 2
    if (fixedDamage === undefined) hitDamage = applyHgssHeldDamageBoost(hitDamage, actorHeld, damageMove.type, damageMove.category, calculatedDamage.typeMultiplier, { speciesId: actor.pokemon.speciesId, transformed: Boolean(actor.volatile.transformOriginal), metronomeTurns: actor.volatile.metronomeTurns })
    if (fixedDamage === undefined && !critical && damageMove.category === 0 && target.screens.reflectTurns > 0) hitDamage = Math.floor(hitDamage / 2)
    if (fixedDamage === undefined && !critical && damageMove.category === 1 && target.screens.lightScreenTurns > 0) hitDamage = Math.floor(hitDamage / 2)
    if (fixedDamage !== undefined && (typeMultiplier === 0 || (move.data.effect === 38 && targetAbility === 5))) hitDamage = 0
    if (fixedDamage === undefined && hit === 0 && isHgssResistBerryActive(targetHeld, damageMove.type, calculatedDamage.typeMultiplier)) {
      hitDamage = Math.floor(hitDamage / 2)
      consumeHeldItem(session, target)
      setCondition(events, targetSide, 'resistBerry', true)
    }
    if (target.volatile.substituteHp > 0 && hitDamage > 0 && move.data.effect !== 223) {
      const absorbed = Math.min(target.volatile.substituteHp, hitDamage)
      target.volatile.substituteHp -= absorbed
      substituteDamage += absorbed
      hitDamage = 0
    }
    if (target.volatile.endured && hitDamage >= target.pokemon.currentHp) hitDamage = Math.max(0, target.pokemon.currentHp - 1)
    const liveTargetHeld = getHeldItemEffect(session, target)
    const heldEndures = hitDamage >= target.pokemon.currentHp && isHgssHeldSurvivalActive(liveTargetHeld, target.pokemon.currentHp, target.pokemon.stats.hp, rng.nextU16())
    if (heldEndures) {
      hitDamage = target.pokemon.currentHp - 1
      if (liveTargetHeld.effect === 103) consumeHeldItem(session, target)
      setCondition(events, targetSide, 'heldItemEndure', true)
    }
    hitDamage = Math.min(target.pokemon.currentHp, Math.max(0, hitDamage))
    target.pokemon.currentHp -= hitDamage
    dealtDamage += hitDamage
    if (target.volatile.lockedMoveKind === 'bide') target.volatile.bideDamage += hitDamage
  }
  events.push({ kind: 'damage', movePresentationId, side: targetSide, damage: dealtDamage, critical: anyCritical, typeMultiplier })
  if (move.data.effect === 34 && typeMultiplier > 0 && dealtDamage + substituteDamage > 0) {
    session.payDayCoins += actor.pokemon.level * 5
    setCondition(events, side, 'payDay', true)
  }
  if (dealtDamage > 0) {
    target.volatile.lastDamageTaken = dealtDamage
    target.volatile.lastDamageCategory = damageMove.category === 1 ? 1 : 0
  } else if ([89, 144, 189, 227].includes(move.data.effect)) {
    events.push({ kind: 'noEffect', side, pokemonName: actorName })
  }
  if (substituteDamage > 0) setCondition(events, targetSide, target.volatile.substituteHp > 0 ? 'substituteHit' : 'substituteBroken', true)
  if (hitCount > 1) events.push({ kind: 'multiHit', hits: actualHits })
  applySimpleBattlePostHitAbilities({ attacker: actor.pokemon, defender: target.pokemon, attackerState: actor, defenderState: target, attackerSide: side, defenderSide: targetSide, attackerAbilityId: actorAbility, defenderAbilityId: targetAbility, attackerHeldEffect: actorHeld.effect, defenderTypes: target.types, defenderAttackStage: target.stages.attack, move: move.data, moveType: actorAbility === 96 ? 0 : damageMove.type, dealtDamage, substituteWasHit: substituteDamage > 0, critical: anyCritical, attackerInfatuated: actor.volatile.infatuated, attackerSafeguarded: actor.screens.safeguardTurns > 0, dampActive: activeBattleAbilityId(session.player) === 6 || activeBattleAbilityId(session.opponent) === 6, weather: activeWeather }, rng, events)
  const heldOnHit = resolveHgssHeldOnHit({ targetHeld: getHeldItemEffect(session, target), damageCategory: damageMove.category, moveFlags: move.data.flags, moveEffect: move.data.effect, dealtDamage, typeMultiplier, substituteWasHit: substituteDamage > 0, attackerCurrentHp: actor.pokemon.currentHp, attackerMaximumHp: actor.pokemon.stats.hp, attackerAbilityId: actorAbility, attackerHasItem: actor.pokemon.heldItemId !== 0, targetCurrentHp: target.pokemon.currentHp, targetMaximumHp: target.pokemon.stats.hp, targetHealBlocked: target.volatile.healBlockTurns > 0 })
  if (heldOnHit?.kind === 'healTarget') { consumeHeldItem(session, target); target.pokemon.currentHp += heldOnHit.amount; events.push({ kind: 'heal', side: targetSide, pokemonName: pokemonName(target), amount: heldOnHit.amount }) }
  else if (heldOnHit?.kind === 'damageAttacker') { consumeHeldItem(session, target); actor.pokemon.currentHp -= heldOnHit.amount; events.push({ kind: 'recoil', side, pokemonName: actorName, damage: heldOnHit.amount }); emitSimpleBattleFaint(events, side, actor.pokemon) }
  else if (heldOnHit?.kind === 'transferToAttacker') { actor.pokemon.heldItemId = target.pokemon.heldItemId; target.pokemon.heldItemId = 0; setCondition(events, side, 'stickyBarbTransfer', true) }
  if (move.data.effect === 38 && targetAbility === 5) events.push({ kind: 'noEffect', side: targetSide, pokemonName: pokemonName(target) })
  if ((move.data.effect === 222 || move.data.effect === 233) && actor.pokemon.heldItemId !== 0) {
    consumeHeldItem(session, actor)
    setCondition(events, side, move.data.effect === 222 ? 'naturalGiftConsumed' : 'flingConsumed', true)
  }
  if (move.data.effect === 233 && flungItemEffect && target.pokemon.currentHp > 0 && substituteDamage === 0 && target.volatile.embargoTurns === 0) {
    applyConsumedItemEffect(session, targetSide, flungItemEffect.effect, flungItemEffect.parameter, rng, events)
  }
  if (move.data.effect === 224 && dealtDamage > 0 && target.pokemon.currentHp > 0 && substituteDamage === 0 && target.pokemon.heldItemId !== 0 && !isHgssHeldItemRemovalBlocked(targetAbility, actorAbility, true)) {
    const item = session.itemCatalog?.items[target.pokemon.heldItemId]
    if (item?.fieldPocket === 4) {
      consumeHeldItem(session, target)
      setCondition(events, side, 'berryPlucked', true)
      if (actorAbility !== 103 && actor.volatile.embargoTurns === 0) applyConsumedItemEffect(session, side, item.pluckEffect, item.holdEffectParameter, rng, events)
    }
  }
  if (move.data.effect === 105 && dealtDamage > 0 && actor.pokemon.heldItemId === 0
    && target.pokemon.heldItemId !== 0 && target.volatile.substituteHp === 0
    && !isHgssHeldItemRemovalBlocked(targetAbility, actorAbility, true)
    && canTransferHeldItem(session, target, target.pokemon.heldItemId)) {
    actor.pokemon.heldItemId = target.pokemon.heldItemId
    actor.volatile.canUnburden = true
    target.pokemon.heldItemId = 0
    setCondition(events, side, 'heldItemStolen', true)
  }
  if (move.data.effect === 228 && dealtDamage > 0 && actor.pokemon.currentHp > 0 && simpleBattleReserve(session, side, playerTeamPolicy).length > 0) {
    if (side === 'player') {
      session.pendingSwitches.player = 'pivot'
      events.push({ kind: 'switchRequest', side, reason: 'pivot' })
    } else forceSimpleBattleSwitch(session, side, 'pivot', catalog, rng, events, playerTeamPolicy)
  }
  if (target.pokemon.currentHp > 0 && target.pokemon.currentHp * 2 <= target.pokemon.stats.hp) {
    const berry = getHeldItemEffect(session, target)
    const amount = berry.effect === 1
      ? Math.min(target.pokemon.stats.hp - target.pokemon.currentHp, berry.parameter)
      : berry.effect === 13
        ? Math.min(target.pokemon.stats.hp - target.pokemon.currentHp, Math.max(1, Math.floor(target.pokemon.stats.hp * berry.parameter / 100)))
        : 0
    if (amount > 0 && target.volatile.healBlockTurns === 0) {
      target.pokemon.currentHp += amount
      consumeHeldItem(session, target)
      events.push({ kind: 'heal', side: targetSide, pokemonName: pokemonName(target), amount })
    }
  }
  if (dealtDamage > 0 && target.pokemon.currentHp > 0) {
    const primaryStatus = target.screens.safeguardTurns === 0
      ? applySupportedHgssPrimaryStatus(move.data, target.pokemon, target.types, rng, targetAbility, actorAbility, { weather: activeWeather })
      : undefined
    emitMoveStatus(primaryStatus)
    const targetStagesBefore = { ...target.stages }
    const statEffect = applySupportedHgssStatusMoveEffect(move.data, actor.stages, target.stages, rng, actorAbility, targetAbility)
    if (statEffect) {
      const blockedByMist = statEffect.change < 0 && target.screens.mistTurns > 0
      if (blockedByMist) target.stages = targetStagesBefore
      events.push({ kind: 'stat', side: targetSide, pokemonName: target.pokemon.nickname ?? target.pokemon.speciesName, ...statEffect, applied: blockedByMist ? false : statEffect.applied })
    }
    let forcedStatus: 'poison' | 'burn' | 'freeze' | 'paralysis' | undefined
    if (move.data.effect === 36 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) {
      forcedStatus = (['paralysis', 'burn', 'freeze'] as const)[rng.nextU16() % 3]
    } else if ([125, 200, 253, 273].includes(move.data.effect) && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) forcedStatus = 'burn'
    else if ([202, 209].includes(move.data.effect) && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) forcedStatus = 'poison'
    else if (move.data.effect === 274 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) forcedStatus = 'freeze'
    else if ([262, 275].includes(move.data.effect) && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) forcedStatus = 'paralysis'
    if (move.data.effect === 197 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) {
      const terrainEffect = catalog.secretPowerEffectIds?.[session.terrainId]
      const terrainStatus = terrainEffect === 1 ? 'sleep' : terrainEffect === 4 ? 'freeze' : terrainEffect === 5 ? 'paralysis' : undefined
      if (terrainStatus && target.screens.safeguardTurns === 0) emitMoveStatus(applyHgssPrimaryStatus(terrainStatus, target.pokemon, target.types, rng, targetAbility, { weather: activeWeather, ignoreTargetAbility: actorAbility === 104 }))
      else if (terrainEffect === 8 && canHgssPokemonFlinch(targetAbility)) target.volatile.flinched = true
      else if (terrainEffect === 0x16) applyStageChange(session, targetSide, 'attack', -1, events)
      else if (terrainEffect === 0x18) applyStageChange(session, targetSide, 'speed', -1, events)
      else if (terrainEffect === 0x1b) applyStageChange(session, targetSide, 'accuracy', -1, events)
      else if (terrainEffect === 0x1c) applyStageChange(session, targetSide, 'evasion', -1, events)
    }
    if (forcedStatus && target.screens.safeguardTurns === 0) {
      emitMoveStatus(applyHgssPrimaryStatus(forcedStatus, target.pokemon, target.types, rng, targetAbility, { weather: activeWeather, ignoreTargetAbility: actorAbility === 104 }))
    }
    if (canHgssPokemonFlinch(targetAbility) && ([31, 92, 146, 273, 274, 275].includes(move.data.effect) && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)
      || move.data.effect === 158 && session.turn === 0)) target.volatile.flinched = true
    if (doesHgssHeldItemFlinch(actorHeld, move.data.flags, dealtDamage, targetAbility, rng.nextU16())) target.volatile.flinched = true
    if ((move.data.effect === 152 || move.data.effect === 263) && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)
      && target.screens.safeguardTurns === 0) {
      emitMoveStatus(applyHgssPrimaryStatus('paralysis', target.pokemon, target.types, rng, targetAbility, { weather: activeWeather, ignoreTargetAbility: actorAbility === 104 }))
    }
    if (move.data.effect === 76 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility) && target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbility, target.screens.safeguardTurns > 0, actorAbility === 104)) {
      target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', side: targetSide, pokemonName: pokemonName(target), state: 'started' })
    }
    if (move.data.effect === 267 && actor.pokemon.speciesId === 441 && !actor.volatile.transformOriginal
      && secondaryEffectOccurs(10, rng, actorAbility, targetAbility) && target.volatile.confusionTurns === 0 && canHgssConfuse(targetAbility, target.screens.safeguardTurns > 0, actorAbility === 104)) {
      target.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', side: targetSide, pokemonName: pokemonName(target), state: 'started' })
    }
    if (move.data.effect === 138) applyStageChange(session, side, 'defense', 1, events)
    else if (move.data.effect === 139) applyStageChange(session, side, 'attack', 1, events)
    else if (move.data.effect === 140 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility)) {
      for (const stat of ['attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const) applyStageChange(session, side, stat, 1, events)
    } else if (move.data.effect === 204) applyStageChange(session, side, 'specialAttack', -2, events)
    else if (move.data.effect === 205) {
      applyStageChange(session, side, 'attack', -1, events)
      applyStageChange(session, side, 'defense', -1, events)
    } else if (move.data.effect === 206) {
      applyStageChange(session, side, 'defense', 1, events)
      applyStageChange(session, side, 'speed', 1, events)
    } else if (move.data.effect === 182) {
      applyStageChange(session, side, 'attack', -1, events)
      applyStageChange(session, side, 'defense', -1, events)
    } else if (move.data.effect === 218) applyStageChange(session, side, 'speed', -1, events)
    else if (move.data.effect === 229) {
      applyStageChange(session, side, 'defense', -1, events)
      applyStageChange(session, side, 'specialDefense', -1, events)
    }
    else if (move.data.effect === 271 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility, targetAbility)) applyStageChange(session, targetSide, 'specialDefense', -2, events)
    else if (move.data.effect === 276 && secondaryEffectOccurs(move.data.effectChance, rng, actorAbility)) applyStageChange(session, side, 'specialAttack', 1, events)
  }
  if (move.data.effect === 125) actor.pokemon.status &= ~0x20
  if (move.data.effect === 171) target.pokemon.status &= ~0x40
  if (move.data.effect === 217 && dealtDamage > 0) target.pokemon.status &= ~0x7
  if (move.data.effect === 81 && dealtDamage > 0) actor.volatile.rage = true
  if (dealtDamage > 0 && target.pokemon.currentHp > 0 && target.volatile.rage) applyStageChange(session, targetSide, 'attack', 1, events)
  if (move.data.effect === 117) {
    actor.volatile.rolloutCount += 1
    if (dealtDamage > 0 && target.pokemon.currentHp > 0 && actor.volatile.rolloutCount < 5) {
      actor.volatile.lockedMoveIndex = selectedMoveIndex
      actor.volatile.lockedMoveTurns = 1
      actor.volatile.lockedMoveKind = 'rollout'
    } else actor.volatile.rolloutCount = 0
  }
  if (move.data.effect === 119) actor.volatile.furyCutterCount = dealtDamage > 0 ? Math.min(5, actor.volatile.furyCutterCount + 1) : 0
  if (move.data.effect === 26) actor.volatile.bideDamage = 0
  if (move.data.effect === 161) {
    const stockpile = actor.volatile.stockpile
    actor.stages.defense = Math.max(-6, actor.stages.defense - stockpile)
    actor.stages.specialDefense = Math.max(-6, actor.stages.specialDefense - stockpile)
    actor.volatile.stockpile = 0
    setCondition(events, side, 'spitUp', true)
  }
  if ([27, 159].includes(move.data.effect) && dealtDamage > 0 && target.pokemon.currentHp > 0) {
    if (!continuingLock) {
      actor.volatile.lockedMoveIndex = selectedMoveIndex
      actor.volatile.lockedMoveTurns = move.data.effect === 27 ? 1 + rng.nextU16() % 2 : 1 + rng.nextU16() % 4
      actor.volatile.lockedMoveKind = move.data.effect === 27 ? 'rampage' : 'uproar'
    } else if (continuingLockKind === 'rampage' && actor.volatile.lockedMoveTurns === 0 && actor.volatile.confusionTurns === 0 && canHgssConfuse(actorAbility)) {
      actor.volatile.confusionTurns = 2 + rng.nextU16() % 4
      events.push({ kind: 'confusion', side, pokemonName: actorName, state: 'started' })
    }
    if (move.data.effect === 159) {
      for (const wakeSide of ['player', 'opponent'] as const) session[wakeSide].pokemon.status &= ~0x7
      setCondition(events, side, 'uproar', true)
    }
  }
  if ((move.data.effect === 42 || move.data.effect === 261) && dealtDamage > 0 && target.volatile.trappedTurns === 0) {
    target.volatile.trappedTurns = actorHeld.effect === 114 ? 6 : 3 + rng.nextU16() % 3
    setCondition(events, targetSide, 'trapped', true)
  }
  if (move.data.effect === 129 && dealtDamage > 0) {
    actor.volatile.trappedTurns = 0
    actor.volatile.seeded = false
    actor.screens.spikesLayers = 0
    actor.screens.toxicSpikesLayers = 0
    actor.screens.stealthRock = false
    setCondition(events, side, 'rapidSpinClear', true)
  }
  if (move.data.effect === 188 && dealtDamage > 0 && target.volatile.substituteHp === 0 && target.pokemon.heldItemId !== 0 && !isHgssHeldItemRemovalBlocked(targetAbility, actorAbility, true)) {
    target.pokemon.heldItemId = 0
    setCondition(events, targetSide, 'heldItemRemoved', true)
  }
  if (move.data.power > 0) actor.volatile.charged = false
  activateAutoHeldItem(session, targetSide, rng, events)
  if (move.data.effect === 80 && target.pokemon.currentHp > 0) actor.volatile.rechargeTurns = 1
  if ((move.data.effect === 3 || move.data.effect === 8) && dealtDamage > 0 && actor.pokemon.currentHp > 0) {
    const drain = resolveHgssDrain({ dealtDamage, attackerCurrentHp: actor.pokemon.currentHp, attackerMaximumHp: actor.pokemon.stats.hp, attackerAbilityId: actorAbility, defenderAbilityId: targetAbility, healBlocked: actor.volatile.healBlockTurns > 0, leechBoostPercent: actorHeld.effect === 124 ? actorHeld.parameter : undefined })
    if (drain.kind === 'heal') { actor.pokemon.currentHp += drain.amount; events.push({ kind: 'heal', side, pokemonName: actorName, amount: drain.amount }) }
    else if (drain.kind === 'damage') { actor.pokemon.currentHp -= drain.amount; setCondition(events, side, 'ability:64', true); events.push({ kind: 'recoil', side, pokemonName: actorName, damage: drain.amount }); emitSimpleBattleFaint(events, side, actor.pokemon) }
  }
  if (actorHeld.effect === 88 && dealtDamage > 0 && actor.volatile.healBlockTurns === 0 && actor.pokemon.currentHp > 0) {
    const result = resolveHgssHeldPostDamage({ held: actorHeld, dealtDamage, currentHp: actor.pokemon.currentHp, maximumHp: actor.pokemon.stats.hp, healBlocked: false, magicGuard: actorAbility === 98 })
    if (result?.kind === 'heal') { actor.pokemon.currentHp += result.amount; events.push({ kind: 'heal', side, pokemonName: actorName, amount: result.amount }) }
  }
  if (move.data.effect === 7 && actor.pokemon.currentHp > 0) {
    actor.pokemon.currentHp = 0
    emitSimpleBattleFaint(events, side, actor.pokemon)
  }
  const recoilDivisor = move.data.effect === 269 ? 2
    : move.data.effect === 198 || move.data.effect === 253 || move.data.effect === 262 ? 3
      : move.data.effect === 48 ? 4
        : usingStruggle ? 0 : undefined
  if (recoilDivisor !== undefined && actor.pokemon.currentHp > 0 && (usingStruggle || actorAbility !== 69)) {
    const recoil = usingStruggle
      ? Math.max(1, Math.floor(actor.pokemon.stats.hp / 4))
      : Math.max(1, Math.floor(dealtDamage / recoilDivisor))
    actor.pokemon.currentHp = Math.max(0, actor.pokemon.currentHp - recoil)
    events.push({ kind: 'recoil', side, pokemonName: actorName, damage: recoil })
    emitSimpleBattleFaint(events, side, actor.pokemon)
  }
  if (actorHeld.effect === 98 && dealtDamage > 0 && actor.pokemon.currentHp > 0) {
    const result = resolveHgssHeldPostDamage({ held: actorHeld, dealtDamage, currentHp: actor.pokemon.currentHp, maximumHp: actor.pokemon.stats.hp, healBlocked: actor.volatile.healBlockTurns > 0, magicGuard: actorAbility === 98 })
    const recoil = result?.kind === 'damage' ? result.amount : 0
    actor.pokemon.currentHp -= recoil
    if (recoil > 0) events.push({ kind: 'recoil', side, pokemonName: actorName, damage: recoil })
    emitSimpleBattleFaint(events, side, actor.pokemon)
  }
  activateAutoHeldItem(session, side, rng, events)
  if (target.pokemon.currentHp === 0 && dealtDamage > 0) {
    if (target.volatile.grudge && !usingStruggle) {
      move.pp = 0
      setCondition(events, side, 'grudgePpDepleted', true)
    }
    if (target.volatile.destinyBond && actor.pokemon.currentHp > 0) {
      actor.pokemon.currentHp = 0
      setCondition(events, side, 'destinyBondFaint', true)
      emitSimpleBattleFaint(events, side, actor.pokemon)
    }
  }
  if (target.pokemon.currentHp === 0) {
    emitSimpleBattleFaint(events, targetSide, target.pokemon)
    resolveSimpleBattleFaints(session, events, playerTeamPolicy)
  } else if (actor.pokemon.currentHp === 0) {
    resolveSimpleBattleFaints(session, events, playerTeamPolicy)
  }
}

function executeMove(
  session: SimpleBattleSession,
  side: SimpleBattleSide,
  selectedMoveIndex: number,
  rng: HgssLcrng,
  events: SimpleBattleEvent[],
  catalog: PokemonCatalog,
  invokedMove?: PokemonMoveData,
  invocationDepth = 0,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): void {
  executeMoveCore(session, side, selectedMoveIndex, rng, events, catalog, invokedMove, invocationDepth, playerTeamPolicy)
  if (session.phase !== 'ended') refreshSimpleBattleForms(session, events)
}

function applyEndTurnStatus(session: SimpleBattleSession, events: SimpleBattleEvent[], rng: HgssLcrng, playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy): void {
  if (session.phase === 'ended') return
  const faintedSides = new Set<SimpleBattleSide>()
  for (const event of events) if (event.kind === 'faint') faintedSides.add(event.side)
  const emitFaint = (side: SimpleBattleSide): boolean => {
    const state = session[side]
    if (state.pokemon.currentHp > 0) return false
    if (!faintedSides.has(side)) {
      faintedSides.add(side)
      emitSimpleBattleFaint(events, side, state.pokemon)
    }
    return true
  }
  const weatherSuppressed = () => isHgssWeatherSuppressed((['player', 'opponent'] as const).flatMap((side) => session[side].pokemon.currentHp > 0 ? [activeBattleAbilityId(session[side])] : []))
  for (const side of ['player', 'opponent'] as const) {
    const state = session[side]
    const pokemon = state.pokemon
    const ability = activeBattleAbilityId(state)
    if (pokemon.currentHp <= 0) continue
    const residual = resolveHgssStatusResidual({ abilityId: ability, currentHp: pokemon.currentHp, maximumHp: pokemon.stats.hp, status: pokemon.status })
    pokemon.status = residual.nextStatus
    if (residual.kind === 'none') continue
    if (residual.kind === 'heal') {
      if (residual.amount > 0) { pokemon.currentHp += residual.amount; events.push({ kind: 'abilityHeal', side, pokemonName: pokemon.nickname ?? pokemon.speciesName, abilityId: residual.abilityId, amount: residual.amount }) }
      continue
    }
    pokemon.currentHp -= residual.amount
    const name = pokemon.nickname ?? pokemon.speciesName
    events.push({ kind: 'residual', side, pokemonName: name, status: residual.status, damage: residual.amount })
    emitFaint(side)
  }
  for (const side of ['player', 'opponent'] as const) {
    const state = session[side]
    const pokemon = state.pokemon
    const ability = activeBattleAbilityId(state)
    if (pokemon.currentHp <= 0) continue
    const applyVolatileDamage = (condition: string, divisor: number): boolean => {
      if (ability === 98) return false
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / divisor)))
      pokemon.currentHp -= damage
      setCondition(events, side, condition, true)
      events.push({ kind: 'damage', side, damage, critical: false, typeMultiplier: 10 })
      return emitFaint(side)
    }
    if (state.volatile.nightmare) {
      if ((pokemon.status & 0x7) === 0) state.volatile.nightmare = false
      else if (applyVolatileDamage('nightmareDamage', 4)) continue
    }
    if (state.volatile.cursed && applyVolatileDamage('curseDamage', 4)) continue
    if (state.volatile.trappedTurns > 0) {
      if (applyVolatileDamage('bindingDamage', 16)) continue
      state.volatile.trappedTurns -= 1
      if (state.volatile.trappedTurns === 0) setCondition(events, side, 'bindingEnded', true)
    }
    if (state.volatile.seeded && ability !== 98) {
      const targetSide = side === 'player' ? 'opponent' : 'player'
      const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 8)))
      pokemon.currentHp -= damage
      const receiverState = session[targetSide]
      const receiver = receiverState.pokemon
      const receiverHeld = getHeldItemEffect(session, receiverState)
      const drain = resolveHgssLeechSeedDrain({
        dealtDamage: damage,
        receiverCurrentHp: receiver.currentHp,
        receiverMaximumHp: receiver.stats.hp,
        receiverAbilityId: activeBattleAbilityId(receiverState),
        seededAbilityId: ability,
        healBlocked: receiverState.volatile.healBlockTurns > 0,
        leechBoostPercent: receiverHeld.effect === 124 ? receiverHeld.parameter : undefined,
      })
      if (receiver.currentHp > 0 && drain.kind === 'heal') receiver.currentHp += drain.amount
      else if (receiver.currentHp > 0 && drain.kind === 'damage') receiver.currentHp -= drain.amount
      events.push({ kind: 'leechSeed', side, pokemonName: pokemonName(state), damage, healedSide: targetSide, recovery: drain.kind, recoveryAmount: drain.amount })
      if (emitFaint(side)) continue
      if (drain.kind === 'damage') {
        setCondition(events, targetSide, 'ability:64', true)
        events.push({ kind: 'recoil', side: targetSide, pokemonName: pokemonName(receiverState), damage: drain.amount })
        if (emitFaint(targetSide)) continue
      }
    }
    const passiveHeld = getHeldItemEffect(session, state)
    const passiveRecovery = () => resolveHgssPassiveRecovery({
      baseAmount: Math.max(1, Math.floor(pokemon.stats.hp / 16)),
      currentHp: pokemon.currentHp,
      maximumHp: pokemon.stats.hp,
      healBlocked: state.volatile.healBlockTurns > 0,
      leechBoostPercent: passiveHeld.effect === 124 ? passiveHeld.parameter : undefined,
    })
    if (state.volatile.aquaRing) {
      const amount = passiveRecovery()
      pokemon.currentHp += amount
      if (amount > 0) events.push({ kind: 'heal', side, pokemonName: pokemonName(state), amount })
    }
    if (state.volatile.ingrain) {
      const amount = passiveRecovery()
      pokemon.currentHp += amount
      if (amount > 0) events.push({ kind: 'heal', side, pokemonName: pokemonName(state), amount })
    }
    if (state.volatile.wishTurns > 0) {
      state.volatile.wishTurns -= 1
      if (state.volatile.wishTurns === 0 && state.volatile.healBlockTurns === 0 && pokemon.currentHp < pokemon.stats.hp) {
        const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, state.volatile.wishAmount)
        pokemon.currentHp += amount
        state.volatile.wishAmount = 0
        events.push({ kind: 'heal', side, pokemonName: pokemonName(state), amount })
        setCondition(events, side, 'wishGranted', true)
      }
    }
    if (state.volatile.yawnTurns > 0) {
      state.volatile.yawnTurns -= 1
      if (state.volatile.yawnTurns === 0 && pokemon.status === 0) {
        const applied = applyHgssPrimaryStatus('sleep', pokemon, state.types, rng, activeBattleAbilityId(state), { weather: weatherSuppressed() ? 'clear' : session.weather.kind })
        events.push({ kind: 'status', side, pokemonName: pokemonName(state), ...applied })
      }
    }
    if (state.volatile.perishTurns > 0) {
      state.volatile.perishTurns -= 1
      setCondition(events, side, `perish:${state.volatile.perishTurns}`, true)
      if (state.volatile.perishTurns === 0) {
        pokemon.currentHp = 0
        emitFaint(side)
        continue
      }
    }
    const abilityEffect = resolveHgssEndTurnAbility({
      abilityId: ability, currentHp: pokemon.currentHp, maximumHp: pokemon.stats.hp, status: pokemon.status,
      weather: session.weather.kind, weatherSuppressed: weatherSuppressed(), healBlocked: state.volatile.healBlockTurns > 0,
      speedStage: state.stages.speed, enteredThisTurn: state.volatile.enteredThisTurn, random: ability === 61 ? rng.nextU16() : 9,
    })
    if (abilityEffect?.kind === 'heal') {
      pokemon.currentHp += abilityEffect.amount
      events.push({ kind: 'abilityHeal', side, pokemonName: pokemonName(state), abilityId: abilityEffect.abilityId, amount: abilityEffect.amount })
    } else if (abilityEffect?.kind === 'cureStatus') {
      pokemon.status = 0
      events.push({ kind: 'statusCured', side, pokemonName: pokemonName(state), applied: true })
    } else if (abilityEffect?.kind === 'raiseSpeed') {
      const applied = applyHgssSpeedBoost(state.stages)
      events.push({ kind: 'stat', side, pokemonName: pokemonName(state), stat: 'speed', change: 1, applied })
    } else if (abilityEffect?.kind === 'damage') {
      pokemon.currentHp -= abilityEffect.amount
      setCondition(events, side, `ability:${abilityEffect.abilityId}`, true)
      events.push({ kind: 'damage', side, damage: abilityEffect.amount, critical: false, typeMultiplier: 10 })
      if (emitFaint(side)) continue
    }
    if (session.weather.kind === 'sandstorm' || session.weather.kind === 'hail') {
      const immune = weatherSuppressed() || isHgssWeatherDamageImmune(session.weather.kind, state.types, activeBattleAbilityId(state))
      if (!immune) {
        const damage = Math.min(pokemon.currentHp, Math.max(1, Math.floor(pokemon.stats.hp / 16)))
        pokemon.currentHp -= damage
        events.push({ kind: 'weatherDamage', side, pokemonName: pokemonName(state), weather: session.weather.kind, damage })
        if (emitFaint(side)) continue
      }
    }
    const held = getHeldItemEffect(session, state)
    const heldResult = resolveHgssHeldEndTurn({ held, currentHp: pokemon.currentHp, maximumHp: pokemon.stats.hp, poisonType: state.types.includes(3), magicGuard: activeBattleAbilityId(state) === 98, healBlocked: state.volatile.healBlockTurns > 0 })
    if (heldResult?.kind === 'heal') {
      pokemon.currentHp += heldResult.amount
      events.push({ kind: 'heal', side, pokemonName: pokemonName(state), amount: heldResult.amount })
    } else if (heldResult?.kind === 'damage') {
      pokemon.currentHp -= heldResult.amount
      events.push({ kind: 'recoil', side, pokemonName: pokemonName(state), damage: heldResult.amount })
      if (emitFaint(side)) continue
    }
    if (pokemon.status === 0 && (heldResult?.kind === 'badPoison' || heldResult?.kind === 'burn')) {
      const result = applyHgssPrimaryStatus(heldResult.kind, pokemon, state.types, rng, activeBattleAbilityId(state), { weather: weatherSuppressed() ? 'clear' : session.weather.kind })
      if (result.applied) events.push({ kind: 'status', side, pokemonName: pokemonName(state), ...result })
    }
  }
  for (const sourceSide of ['player', 'opponent'] as const) {
    const targetSide = sourceSide === 'player' ? 'opponent' : 'player'
    const source = session[sourceSide]
    const target = session[targetSide]
    if (source.pokemon.currentHp <= 0 || activeBattleAbilityId(source) !== 123 || target.pokemon.currentHp <= 0 || (target.pokemon.status & 0x7) === 0 || activeBattleAbilityId(target) === 98) continue
    const damage = Math.min(target.pokemon.currentHp, Math.max(1, Math.floor(target.pokemon.stats.hp / 8)))
    target.pokemon.currentHp -= damage
    setCondition(events, targetSide, 'ability:123', true)
    events.push({ kind: 'damage', side: targetSide, damage, critical: false, typeMultiplier: 10 })
    emitFaint(targetSide)
  }
  for (const side of ['player', 'opponent'] as const) {
    const state = session[side]
    state.volatile.flinched = false
    state.volatile.enteredThisTurn = false
    state.volatile.turnsActive += 1
    const volatileExpirations = [
      ['disableTurns', 'disableEnded'],
      ['encoreTurns', 'encoreEnded'],
      ['tauntTurns', 'tauntEnded'],
      ['healBlockTurns', 'healBlockEnded'],
      ['embargoTurns', 'embargoEnded'],
      ['magnetRiseTurns', 'magnetRiseEnded'],
    ] as const
    for (const [key, condition] of volatileExpirations) {
      if (state.volatile[key] > 0 && --state.volatile[key] === 0) setCondition(events, side, condition, true)
    }
    if (state.volatile.disableTurns === 0) state.volatile.disabledMoveId = 0
    if (state.volatile.encoreTurns === 0) state.volatile.encoreMoveId = 0
    const screenExpirations = [
      ['reflectTurns', 'reflectEnded'],
      ['lightScreenTurns', 'lightScreenEnded'],
      ['mistTurns', 'mistEnded'],
      ['safeguardTurns', 'safeguardEnded'],
      ['tailwindTurns', 'tailwindEnded'],
      ['luckyChantTurns', 'luckyChantEnded'],
    ] as const
    for (const [key, condition] of screenExpirations) {
      if (state.screens[key] > 0 && --state.screens[key] === 0) setCondition(events, side, condition, true)
    }
  }
  if (session.weather.turns > 0) {
    session.weather.turns -= 1
    if (session.weather.turns === 0) {
      session.weather.kind = 'clear'
      events.push({ kind: 'weather', weather: 'clear' })
    }
  }
  if (session.field.gravityTurns > 0 && --session.field.gravityTurns === 0) setCondition(events, 'player', 'gravityEnded', true)
  if (session.field.trickRoomTurns > 0 && --session.field.trickRoomTurns === 0) setCondition(events, 'player', 'trickRoomEnded', true)
  for (const pending of session.futureAttacks) pending.turns -= 1
  for (const pending of session.futureAttacks.filter(({ turns }) => turns === 0)) {
    if (!pending.hits) continue
    const target = session[pending.target]
    if (target.pokemon.currentHp <= 0) continue
    const damage = Math.min(target.pokemon.currentHp, pending.damage)
    target.pokemon.currentHp -= damage
    events.push({ kind: 'residual', side: pending.target, pokemonName: pokemonName(target), status: 'futureSight', damage })
    emitFaint(pending.target)
  }
  session.futureAttacks = session.futureAttacks.filter(({ turns }) => turns > 0)
  refreshSimpleBattleForms(session, events)
  resolveSimpleBattleFaints(session, events, playerTeamPolicy)
}

function trainerItemRestoreAmount(parameter: number, maximumHp: number): number {
  if (parameter === 0xff) return maximumHp
  if (parameter === 0xfe) return Math.floor(maximumHp / 2)
  if (parameter === 0xfd) return Math.floor(maximumHp / 4)
  return parameter
}

function trainerItemCanAffect(session: SimpleBattleSession, itemId: number): boolean {
  const item = session.itemCatalog?.items[itemId]
  if (!item) return false
  const pokemon = session.opponent.pokemon
  const p = item.partyParameters
  const status = pokemon.status
  const healsStatus = p.sleepHeal && (status & 0x7) !== 0
    || p.poisonHeal && (status & (0x8 | 0x80)) !== 0
    || p.burnHeal && (status & 0x10) !== 0
    || p.freezeHeal && (status & 0x20) !== 0
    || p.paralysisHeal && (status & 0x40) !== 0
    || p.confusionHeal && session.opponent.volatile.confusionTurns > 0
    || p.infatuationHeal && session.opponent.volatile.infatuated
  const healsHp = p.hpRestore && pokemon.currentHp > 0
    && pokemon.currentHp < pokemon.stats.hp && pokemon.currentHp * 2 <= pokemon.stats.hp
  const raisesStats = p.guardSpec || p.attackStages || p.defenseStages || p.specialAttackStages
    || p.specialDefenseStages || p.speedStages || p.accuracyStages || p.criticalRateStages
  return Boolean(healsStatus || healsHp || raisesStats)
}

function applyTrainerItem(session: SimpleBattleSession, itemIndex: number, events: SimpleBattleEvent[]): void {
  const itemId = session.opponentItems[itemIndex]!
  const item = session.itemCatalog?.items[itemId]
  if (!item) return
  session.opponentItems.splice(itemIndex, 1)
  const state = session.opponent
  const pokemon = state.pokemon
  const p = item.partyParameters
  events.push({
    kind: 'trainerItem', side: 'opponent', trainerName: session.trainerName ?? 'Le Dresseur',
    itemId, itemName: item.name,
  })
  const previousStatus = pokemon.status
  if (p.sleepHeal) pokemon.status &= ~0x7
  if (p.poisonHeal) pokemon.status &= ~(0x8 | 0x80 | 0xf00)
  if (p.burnHeal) pokemon.status &= ~0x10
  if (p.freezeHeal) pokemon.status &= ~0x20
  if (p.paralysisHeal) pokemon.status &= ~0x40
  if (p.confusionHeal) state.volatile.confusionTurns = 0
  if (p.infatuationHeal) state.volatile.infatuated = false
  if (pokemon.status !== previousStatus || p.confusionHeal || p.infatuationHeal) {
    events.push({ kind: 'statusCured', side: 'opponent', pokemonName: pokemonName(state), applied: true })
  }
  if (p.hpRestore && pokemon.currentHp > 0 && pokemon.currentHp < pokemon.stats.hp) {
    const amount = Math.min(pokemon.stats.hp - pokemon.currentHp, trainerItemRestoreAmount(p.hpRestoreParameter, pokemon.stats.hp))
    pokemon.currentHp += amount
    if (amount > 0) events.push({ kind: 'heal', side: 'opponent', pokemonName: pokemonName(state), amount })
  }
  const statItems: readonly [BattleStat, number][] = [
    ['attack', p.attackStages], ['defense', p.defenseStages], ['specialAttack', p.specialAttackStages],
    ['specialDefense', p.specialDefenseStages], ['speed', p.speedStages], ['accuracy', p.accuracyStages],
  ]
  for (const [stat, stages] of statItems) if (stages > 0) applyStageChange(session, 'opponent', stat, stages, events)
  if (p.guardSpec) {
    state.screens.mistTurns = 5
    setCondition(events, 'opponent', 'mist', true)
  }
  if (p.criticalRateStages > 0) {
    state.volatile.focusEnergy = true
    setCondition(events, 'opponent', 'focusEnergy', true)
  }
}

export function executeSimpleBattleTurn(
  session: SimpleBattleSession,
  playerMoveIndex: number,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): SimpleBattleEvent[] {
  if (session.phase !== 'command') throw new Error('Le combat est terminé.')
  beginTurn(session)
  const resolvedPlayerMoveIndex = session.player.volatile.lockedMoveTurns > 0
    ? session.player.volatile.lockedMoveIndex : playerMoveIndex
  const playerMove = resolvedPlayerMoveIndex === -1 && getSelectableSimpleBattleMoveIndexes(session, 'player').length === 0
    ? { data: catalog.moves[165] }
    : session.player.pokemon.moves[resolvedPlayerMoveIndex]
  if (!playerMove) throw new Error(`La capacité joueur ${resolvedPlayerMoveIndex} est absente.`)
  if (!playerMove.data) throw new Error('Les données ROM de Lutte sont absentes.')
  const trainerItemIndex = session.kind === 'trainer'
    ? session.opponentItems.findIndex((itemId) => trainerItemCanAffect(session, itemId))
    : -1
  if (trainerItemIndex >= 0) {
    const events: SimpleBattleEvent[] = []
    session.plannedMoves = { player: playerMove.data }
    applyTrainerItem(session, trainerItemIndex, events)
    executeMove(session, 'player', resolvedPlayerMoveIndex, rng, events, catalog, undefined, 0, playerTeamPolicy)
    applyEndTurnStatus(session, events, rng, playerTeamPolicy)
    session.turn += 1
    for (const event of events) if (event.kind === 'move') event.moveName = catalog.moveNames[event.moveId] ?? event.moveName
    return events
  }
  const opponentMoveIndex = chooseOpponentMove(session, rng)
  const opponentMove = opponentMoveIndex === -1
    ? { data: catalog.moves[165] }
    : session.opponent.pokemon.moves[opponentMoveIndex]
  if (!opponentMove?.data) throw new Error('Les données ROM de Lutte sont absentes.')
  session.plannedMoves = { player: playerMove.data, opponent: opponentMove.data }
  const moveOrderState = (side: SimpleBattleSideState, move: PokemonMoveData, priorityItemRoll: number) => {
    const held = getHeldItemEffect(session, side)
    return {
      pokemon: side.pokemon, stages: side.stages, move, abilityId: activeBattleAbilityId(side), heldItemEffect: held.effect, heldItemParameter: held.parameter, priorityItemRoll,
      weather: session.weather.kind, weatherSuppressed: isHgssWeatherSuppressed([activeBattleAbilityId(session.player), activeBattleAbilityId(session.opponent)]),
      turnsActive: side.volatile.turnsActive, canUnburden: side.volatile.canUnburden, speedMultiplier: side.screens.tailwindTurns > 0 ? 2 : 1,
    }
  }
  const playerOrderState = moveOrderState(session.player, playerMove.data, rng.nextU16())
  const opponentOrderState = moveOrderState(session.opponent, opponentMove.data, rng.nextU16())
  const order = compareHgssMoveOrder(
    playerOrderState,
    opponentOrderState,
    rng,
    session.field.trickRoomTurns > 0,
  )
  const events: SimpleBattleEvent[] = []
  const actions: [SimpleBattleSide, number][] = order < 0
    ? [['player', resolvedPlayerMoveIndex], ['opponent', opponentMoveIndex]]
    : [['opponent', opponentMoveIndex], ['player', resolvedPlayerMoveIndex]]
  for (const [side, index] of actions) {
    const state = side === 'player' ? playerOrderState : opponentOrderState
    if (isHgssPriorityItemActive(state)) { setCondition(events, side, `itemPriority:${state.heldItemEffect}`, true); if (state.heldItemEffect === 45) consumeHeldItem(session, session[side]) }
    executeMove(session, side, index, rng, events, catalog, undefined, 0, playerTeamPolicy)
    if (simpleBattleHasEnded(session) || session.player.pokemon.currentHp <= 0 || session.opponent.pokemon.currentHp <= 0) break
  }
  applyEndTurnStatus(session, events, rng, playerTeamPolicy)
  session.turn += 1
  // Remplace les identifiants temporaires par les noms réellement issus de la ROM.
  for (const event of events) {
    if (event.kind !== 'move') continue
    event.moveName = catalog.moveNames[event.moveId] ?? event.moveName
  }
  return events
}

/** Exécute le tour adverse consommé par une action Sac ou un changement volontaire. */
export function executeSimpleBattleOpponentTurn(
  session: SimpleBattleSession,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): SimpleBattleEvent[] {
  if (session.phase !== 'command') throw new Error('Le combat est terminé.')
  beginTurn(session)
  const events: SimpleBattleEvent[] = []
  const opponentMoveIndex = chooseOpponentMove(session, rng)
  const opponentMove = opponentMoveIndex === -1 ? catalog.moves[165] : session.opponent.pokemon.moves[opponentMoveIndex]?.data
  session.plannedMoves = opponentMove ? { opponent: opponentMove } : undefined
  executeMove(session, 'opponent', opponentMoveIndex, rng, events, catalog, undefined, 0, playerTeamPolicy)
  applyEndTurnStatus(session, events, rng, playerTeamPolicy)
  session.turn += 1
  for (const event of events) {
    if (event.kind !== 'move') continue
    event.moveName = catalog.moveNames[event.moveId] ?? event.moveName
  }
  return events
}

/**
 * Résout un changement volontaire et la réponse adverse dans une chronologie
 * atomique HGSS : Poursuite touche le sortant, toute autre capacité l'entrant.
 */
export function executeSimpleBattlePlayerSwitchTurn(
  session: SimpleBattleSession,
  replacement: CanonicalPokemon,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
): SimpleBattleEvent[] {
  if (session.phase !== 'command') throw new Error('Le combat est terminé.')
  const replacementIndex = session.parties.player.findIndex(({ instanceId }) => instanceId === replacement.instanceId)
  if (replacementIndex >= 0) assertPokemonBattleEligibility(session.parties.player, replacementIndex, { format: 'simple', phase: 'voluntary-switch' }, playerTeamPolicy)
  beginTurn(session)
  const events: SimpleBattleEvent[] = []
  const opponentMoveIndex = chooseOpponentMove(session, rng)
  const opponentMove = opponentMoveIndex === -1 ? catalog.moves[165] : session.opponent.pokemon.moves[opponentMoveIndex]?.data
  if (!opponentMove) throw new Error("La capacité adverse planifiée est absente de la ROM.")
  session.plannedMoves = { opponent: opponentMove }
  session.switchingSide = 'player'
  const pursuit = opponentMove.effect === 128
  if (pursuit) executeMove(session, 'opponent', opponentMoveIndex, rng, events, catalog, undefined, 0, playerTeamPolicy)
  if (session.phase === 'command' && session.player.pokemon.currentHp > 0) {
    const enteringPokemon = cloneCanonicalPokemon(replacement)
    const entryEvents = switchSimpleBattlePokemon(session, 'player', replacement, catalog, { playerTeamPolicy })
    events.push({
      kind: 'switched',
      side: 'player',
      pokemon: enteringPokemon,
      types: catalog.personalData[enteringPokemon.speciesId]?.types ?? session.player.types,
      stages: { ...neutralBattleStatStages },
      reason: 'voluntary',
    }, ...entryEvents)
  }
  session.switchingSide = undefined
  if (!pursuit && session.phase === 'command') executeMove(session, 'opponent', opponentMoveIndex, rng, events, catalog, undefined, 0, playerTeamPolicy)
  applyEndTurnStatus(session, events, rng, playerTeamPolicy)
  session.turn += 1
  for (const event of events) if (event.kind === 'move') event.moveName = catalog.moveNames[event.moveId] ?? event.moveName
  return events
}

export function tryRunFromSimpleBattle(session: SimpleBattleSession, catalog: PokemonCatalog, rng: HgssLcrng, playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy): SimpleBattleEvent[] {
  if (session.phase !== 'command') throw new Error('Le combat est terminé.')
  if (session.kind === 'trainer') return [{ kind: 'cannotRunTrainer' }]
  const playerSpeed = session.player.pokemon.stats.speed
  const opponentSpeed = session.opponent.pokemon.stats.speed
  const held = getHeldItemEffect(session, session.player)
  const trapped = resolveHgssSwitchBlock({ selfAbilityId: activeBattleAbilityId(session.player), selfTypes: session.player.types, heldItemEffect: held.effect, magnetRise: session.player.volatile.magnetRiseTurns > 0, gravity: session.field.gravityTurns > 0, bound: session.player.volatile.trappedTurns > 0, ingrained: session.player.volatile.ingrain, opposingAbilityIds: session.opponent.pokemon.currentHp > 0 ? [activeBattleAbilityId(session.opponent)] : [] }).blocked
  let escaped = activeBattleAbilityId(session.player) === 50 || held.effect === 63 || !trapped && playerSpeed >= opponentSpeed
  if (!escaped && !trapped) {
    const chance = Math.floor(playerSpeed * 128 / opponentSpeed) + session.runAttempts * 30
    escaped = chance > rng.nextU16() % 256
  }
  session.runAttempts += 1
  if (escaped) {
    const events: SimpleBattleEvent[] = [{ kind: 'escaped' }]
    finish(session, 'escaped', events)
    return events
  }
  const events: SimpleBattleEvent[] = [{ kind: 'runFailed' }]
  beginTurn(session)
  const opponentMoveIndex = chooseOpponentMove(session, rng)
  const opponentMove = opponentMoveIndex === -1 ? catalog.moves[165] : session.opponent.pokemon.moves[opponentMoveIndex]?.data
  session.plannedMoves = opponentMove ? { opponent: opponentMove } : undefined
  executeMove(session, 'opponent', opponentMoveIndex, rng, events, catalog, undefined, 0, playerTeamPolicy)
  applyEndTurnStatus(session, events, rng, playerTeamPolicy)
  session.turn += 1
  return events
}

export function completeSimpleBattleCapture(session: SimpleBattleSession): void {
  if (session.kind !== 'wild' || session.phase !== 'command') throw new Error("Cette capture n'est pas possible dans ce combat.")
  session.phase = 'ended'
  session.result = 'captured'
}

export function escapeSimpleBattleWithItem(session: SimpleBattleSession): SimpleBattleEvent[] {
  if (session.phase !== 'command') throw new Error('Le combat est terminé.')
  if (session.kind === 'trainer') return [{ kind: 'cannotRunTrainer' }]
  const events: SimpleBattleEvent[] = [{ kind: 'escaped' }]
  finish(session, 'escaped', events)
  return events
}
