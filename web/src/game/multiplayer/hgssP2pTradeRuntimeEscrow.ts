import { cloneCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import {
  createPokemonEvolutionIdentity,
  evolveCanonicalPokemon,
  resolveTradeEvolution,
} from '../pokemon/pokemonEvolution'
import { evolveCanonicalPokemonPartyMemberAfterTrade } from '../pokemon/pokemonEvolutionTransaction'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  assertPokemonPartyMutationAllowed,
  basePokemonTeamPolicy,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'
import { markPokemonCaught } from '../pokedex/hgssPokedex'
import { cloneFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { resetPokemonPartyPokeathlonModifiers } from '../pokemon/pokemonParty'
import {
  type HgssP2pTradeCommitRequest,
  type HgssP2pTradeCommitResult,
  type HgssP2pTradeEscrowPort,
  type HgssP2pTradeEvolutionEffect,
  type HgssP2pTradePrepareRequest,
  type HgssP2pTradeReservation,
  type HgssP2pTradeRollbackReason,
} from './hgssP2pTradeCoordinator'
import {
  assertHgssP2pTradeOpaqueId,
  getHgssP2pTradeOfferPairKey,
  parseHgssP2pTradeOfferPair,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'
import {
  materializeCanonicalPokemonFromP2pTrade,
  snapshotCanonicalPokemonForP2pTrade,
  type HgssP2pTradePokemonLocalContext,
} from './hgssP2pTradePokemonAdapter'
import {
  appendHgssP2pTradeReceipt,
  parseHgssP2pTradeReceipts,
  type HgssP2pTradeReceipt,
} from './hgssP2pTradeReceipt'
import {
  areHgssP2pTradeJournalsMirrored,
  parseHgssP2pTradeJournal,
  parseHgssP2pTradeJournals,
  removeHgssP2pTradeJournal,
  upsertHgssP2pTradeJournal,
  type HgssP2pTradeJournal,
} from './hgssP2pTradeJournal'

export const hgssInternetTradesGameStatId = 25 as const
export const hgssInternetTradeAuxiliaryGameStatId = 114 as const
export const hgssLinkTradeScoreIncrease = 10 as const

const hgssWordGameStatMaximum = 999_999_999
const hgssHalfwordGameStatMaximum = 65_535
const hgssGameScoreMaximum = 99_999_999
const reservationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/

export type HgssP2pTradeRuntimeEscrowOptions = Readonly<{
  /** État actuellement publié et utilisé par le jeu. */
  getState: () => FieldScriptState
  /** Sauvegarde durable du clone candidat, appelée avant toute publication. */
  persistState: (nextState: FieldScriptState) => Promise<void> | void
  /** Rend visible le clone déjà persisté au reste du runtime. */
  publishState: (nextState: FieldScriptState) => void
  teamPolicy?: PokemonTeamPolicy
  /** Libellé résolu localement pour un Œuf reçu; il ne traverse jamais le réseau. */
  eggDisplayName?: string
}>

export type HgssP2pTradeRuntimeEscrow = HgssP2pTradeEscrowPort & Readonly<{
  /** Permet aux contrôleurs équipe/PC/combat de respecter le verrou pré-commit. */
  isPokemonReserved: (instanceId: PokemonInstanceId) => boolean
  /** Transactions locales à resynchroniser, filtrées par le même pair distant. */
  listRecoveryJournals: (remoteParticipantId: string) => readonly HgssP2pTradeJournal[]
  /** Réconcilie une preuve durable du pair sans faire confiance à son résultat mécanique. */
  reconcileRecovery: (
    remoteJournal: unknown,
    localParticipantId: string,
    remoteParticipantId: string,
  ) => Promise<HgssP2pTradeRecoveryResult>
  /** Nettoie une réservation seulement après accord durable des deux côtés. */
  finalizeRecovery: (
    transactionId: string,
    remoteParticipantId: string,
    disposition: HgssP2pTradeRecoveryDisposition,
  ) => Promise<boolean>
}>

export type HgssP2pTradeRecoveryDisposition = 'confirmed-committed' | 'cancel-prepared'

export type HgssP2pTradeRecoveryResult = Readonly<{
  kind: 'missing' | 'prepared' | 'committed'
  journal?: HgssP2pTradeJournal
  commitResult?: HgssP2pTradeCommitResult
}>

type TradeDestination = HgssP2pTradeCommitResult['destination']

type LocatedPokemon = Readonly<{
  destination: TradeDestination
  pokemon: CanonicalPokemon
}>

type NormalizedPrepareRequest = Readonly<{
  sessionId: string
  transactionId: string
  pair: NonNullable<ReturnType<typeof parseHgssP2pTradeOfferPair>>
  pairKey: string
  outgoing: HgssP2pTradePokemonSnapshot
  incoming: HgssP2pTradePokemonSnapshot
  fingerprint: string
}>

type RuntimeReservation = Readonly<{
  reservationId: string
  transactionId: string
  requestFingerprint: string
  outgoingPokemonId: PokemonInstanceId
  incomingPokemonId: PokemonInstanceId
  destination: TradeDestination
  recovery: boolean
}>

type CandidateCommit = Readonly<{
  state: FieldScriptState
  result: Omit<HgssP2pTradeCommitResult, 'status'>
}>

function normalizeRequest(request: HgssP2pTradePrepareRequest): NormalizedPrepareRequest {
  const sessionId = assertHgssP2pTradeOpaqueId(request.sessionId, 'La session')
  const transactionId = assertHgssP2pTradeOpaqueId(request.transactionId, 'La transaction')
  const pair = parseHgssP2pTradeOfferPair(request.pair)
  const outgoing = parseHgssP2pTradePokemonSnapshot(request.outgoing)
  const incoming = parseHgssP2pTradePokemonSnapshot(request.incoming)
  if (!pair || !outgoing || !incoming) throw new Error("La préparation locale de l'échange P2P est invalide.")
  if (outgoing.instanceId === incoming.instanceId) {
    throw new Error("Un échange P2P ne peut pas envoyer et recevoir la même instance Pokémon.")
  }
  const pairPokemonIds = new Set(pair.map(({ pokemonId }) => pokemonId))
  if (!pairPokemonIds.has(outgoing.instanceId) || !pairPokemonIds.has(incoming.instanceId)) {
    throw new Error("La paire acceptée ne correspond pas aux Pokémon de l'échange P2P.")
  }
  const pairKey = getHgssP2pTradeOfferPairKey(pair)
  const fingerprint = JSON.stringify({ sessionId, transactionId, pair, outgoing, incoming })
  return { sessionId, transactionId, pair, pairKey, outgoing, incoming, fingerprint }
}

function requestParticipantIds(request: NormalizedPrepareRequest): Readonly<{
  localParticipantId: string
  remoteParticipantId: string
}> {
  const local = request.pair.find(({ pokemonId }) => pokemonId === request.outgoing.instanceId)
  const remote = request.pair.find(({ pokemonId }) => pokemonId === request.incoming.instanceId)
  if (!local || !remote || local.participantId === remote.participantId) {
    throw new Error("La direction locale de la paire d'échange P2P est ambiguë.")
  }
  return { localParticipantId: local.participantId, remoteParticipantId: remote.participantId }
}

function normalizeJournalRequest(journal: HgssP2pTradeJournal): NormalizedPrepareRequest {
  return normalizeRequest({
    sessionId: journal.sessionId,
    transactionId: journal.transactionId,
    pair: journal.pair,
    outgoing: journal.outgoing,
    incoming: journal.incoming,
  })
}

function createPreparedJournal(
  request: NormalizedPrepareRequest,
  destination: TradeDestination,
): HgssP2pTradeJournal {
  const participants = requestParticipantIds(request)
  return parseHgssP2pTradeJournal({
    schemaVersion: 1,
    sessionId: request.sessionId,
    transactionId: request.transactionId,
    ...participants,
    pair: request.pair,
    outgoing: request.outgoing,
    incoming: request.incoming,
    destination,
    phase: 'prepared',
  })
}

function createCommittedJournal(
  prepared: HgssP2pTradeJournal,
  result: Omit<HgssP2pTradeCommitResult, 'status'>,
): HgssP2pTradeJournal {
  return parseHgssP2pTradeJournal({
    ...prepared,
    phase: 'committed',
    result: {
      receivedSpeciesId: result.receivedSpeciesId,
      ...(result.evolution ? {
        evolution: {
          ...result.evolution,
          learnedMoveIds: [...result.evolution.learnedMoveIds],
          skippedMoveIds: [...result.evolution.skippedMoveIds],
        },
      } : {}),
    },
  })
}

function assertJournalMatchesRequest(
  journal: HgssP2pTradeJournal,
  request: NormalizedPrepareRequest,
): void {
  const expected = createPreparedJournal(request, journal.destination)
  const withoutResult: Record<string, unknown> = { ...journal, phase: 'prepared' }
  delete withoutResult.result
  if (JSON.stringify(withoutResult) !== JSON.stringify(expected)) {
    throw new Error("Le journal durable P2P ne correspond pas à la transaction demandée.")
  }
}

function requireReservationId(reservation: HgssP2pTradeReservation): string {
  if (!reservation || typeof reservation.reservationId !== 'string'
    || !reservationIdPattern.test(reservation.reservationId)) {
    throw new Error("La réservation locale de l'échange P2P est invalide.")
  }
  return reservation.reservationId
}

function createLocalContext(
  state: FieldScriptState,
  eggDisplayName: string | undefined,
): HgssP2pTradePokemonLocalContext {
  const runtime = state.pokemonRuntime
  if (!runtime) throw new Error("Le runtime Pokémon local requis par l'échange P2P est absent.")
  return {
    catalog: runtime.catalog,
    trainer: runtime.trainer,
    npcTradeCatalog: runtime.npcTradeCatalog,
    itemCatalog: runtime.itemCatalog,
    ...(eggDisplayName === undefined ? {} : { eggDisplayName }),
  }
}

function findTradeablePokemon(state: FieldScriptState, instanceId: PokemonInstanceId): LocatedPokemon | undefined {
  const matches: LocatedPokemon[] = []
  state.party.members.forEach((pokemon, slot) => {
    if (pokemon.instanceId === instanceId) matches.push({ destination: { kind: 'party', slot }, pokemon })
  })
  state.pokemonStorage.boxes.forEach((box, boxIndex) => box.forEach((pokemon, slot) => {
    if (pokemon?.instanceId === instanceId) {
      matches.push({ destination: { kind: 'storage', box: boxIndex, slot }, pokemon })
    }
  }))
  if (matches.length > 1) throw new Error(`L'instance Pokémon ${instanceId} est dupliquée dans les emplacements échangeables.`)
  return matches[0]
}

function ownershipLocations(state: FieldScriptState, instanceId: PokemonInstanceId): string[] {
  const locations: string[] = []
  state.party.members.forEach((pokemon, slot) => {
    if (pokemon.instanceId === instanceId) locations.push(`party/${slot}`)
  })
  state.pokemonStorage.boxes.forEach((box, boxIndex) => box.forEach((pokemon, slot) => {
    if (pokemon?.instanceId === instanceId) locations.push(`storage/${boxIndex}/${slot}`)
  }))
  state.daycare.mons.forEach((entry, slot) => {
    if (entry?.pokemon.instanceId === instanceId) locations.push(`daycare/${slot}`)
  })
  state.palPark.migratedPokemon.forEach((pokemon, slot) => {
    if (pokemon.instanceId === instanceId) locations.push(`pal-park/${slot}`)
  })
  if (state.bugContest?.caughtPokemon?.instanceId === instanceId) locations.push('bug-contest')
  state.roamers.roamers.forEach((roamer, slot) => {
    if (roamer?.instanceId === instanceId) locations.push(`roamer/${slot}`)
  })
  return locations
}

function requireSingleOutgoingLocation(
  state: FieldScriptState,
  outgoing: HgssP2pTradePokemonSnapshot,
  context: HgssP2pTradePokemonLocalContext,
): LocatedPokemon {
  const locations = ownershipLocations(state, outgoing.instanceId)
  if (locations.length !== 1) {
    throw new Error(locations.length === 0
      ? "Le Pokémon proposé n'est plus possédé localement."
      : "Le Pokémon proposé possède une identité locale dupliquée.")
  }
  const located = findTradeablePokemon(state, outgoing.instanceId)
  if (!located) throw new Error("Le Pokémon proposé n'est pas dans l'équipe ou le PC.")
  const currentSnapshot = snapshotCanonicalPokemonForP2pTrade(located.pokemon, context)
  if (JSON.stringify(currentSnapshot) !== JSON.stringify(outgoing)) {
    throw new Error("Le Pokémon proposé a changé depuis l'acceptation de l'échange.")
  }
  return located
}

function requireIncomingIdentityAvailable(state: FieldScriptState, incomingId: PokemonInstanceId): void {
  if (ownershipLocations(state, incomingId).length > 0) {
    throw new Error("L'identité du Pokémon reçu existe déjà dans la sauvegarde locale.")
  }
}

function destinationEquals(left: TradeDestination, right: TradeDestination): boolean {
  return left.kind === 'party'
    ? right.kind === 'party' && left.slot === right.slot
    : right.kind === 'storage' && left.box === right.box && left.slot === right.slot
}

function replaceAtDestination(
  state: FieldScriptState,
  destination: TradeDestination,
  outgoingId: PokemonInstanceId,
  incoming: CanonicalPokemon,
): CanonicalPokemon {
  if (destination.kind === 'party') {
    const current = state.party.members[destination.slot]
    if (current?.instanceId !== outgoingId) throw new Error("Le slot d'équipe réservé a changé avant le commit.")
    state.party.members[destination.slot] = cloneCanonicalPokemon(incoming)
    resetPokemonPartyPokeathlonModifiers(state.party, destination.slot)
    return state.party.members[destination.slot]!
  }
  const current = state.pokemonStorage.boxes[destination.box]?.[destination.slot]
  if (current?.instanceId !== outgoingId) throw new Error('Le slot PC réservé a changé avant le commit.')
  state.pokemonStorage.boxes[destination.box]![destination.slot] = cloneCanonicalPokemon(incoming)
  return state.pokemonStorage.boxes[destination.box]![destination.slot]!
}

function pokemonAtDestination(state: FieldScriptState, destination: TradeDestination): CanonicalPokemon | undefined {
  return destination.kind === 'party'
    ? state.party.members[destination.slot]
    : state.pokemonStorage.boxes[destination.box]?.[destination.slot]
}

function incrementGameStat(state: FieldScriptState, statId: number, maximum: number): void {
  const current = state.gameStats.get(statId) ?? 0
  if (!Number.isSafeInteger(current) || current < 0) throw new Error(`Le compteur GameStats ${statId} est invalide.`)
  state.gameStats.set(statId, Math.min(maximum, current + 1))
}

function evolveReceivedPokemon(
  state: FieldScriptState,
  destination: TradeDestination,
): HgssP2pTradeEvolutionEffect | undefined {
  const runtime = state.pokemonRuntime!
  const received = pokemonAtDestination(state, destination)!
  if (destination.kind === 'party') {
    const transaction = evolveCanonicalPokemonPartyMemberAfterTrade(
      state.party.members,
      destination.slot,
      createPokemonEvolutionIdentity(received),
      runtime.catalog,
      runtime.itemCatalog,
    )
    if (!transaction) return undefined
    const evolution = transaction.primary
    return {
      sourceSpeciesId: evolution.sourceSpeciesId,
      targetSpeciesId: evolution.targetSpeciesId,
      ...(evolution.consumedHeldItemId === undefined ? {} : { consumedHeldItemId: evolution.consumedHeldItemId }),
      learnedMoveIds: [...evolution.learnedMoveIds],
      skippedMoveIds: [...evolution.skippedMoveIds],
    }
  }

  const rule = resolveTradeEvolution(received, runtime.catalog, { itemCatalog: runtime.itemCatalog })
  if (!rule) return undefined
  const mutation = evolveCanonicalPokemon(received, rule.targetSpeciesId, runtime.catalog, rule)
  return {
    sourceSpeciesId: mutation.sourceSpeciesId,
    targetSpeciesId: mutation.targetSpeciesId,
    ...(mutation.consumedHeldItemId === undefined ? {} : { consumedHeldItemId: mutation.consumedHeldItemId }),
    learnedMoveIds: [...mutation.learnedMoveIds],
    skippedMoveIds: [...mutation.skippedMoveIds],
  }
}

function createReceipt(request: NormalizedPrepareRequest): HgssP2pTradeReceipt {
  return {
    transactionId: request.transactionId,
    sentPokemonInstanceId: request.outgoing.instanceId,
    receivedPokemonInstanceId: request.incoming.instanceId,
  }
}

function findReceipt(state: FieldScriptState, transactionId: string): HgssP2pTradeReceipt | undefined {
  return parseHgssP2pTradeReceipts(state.p2pTradeReceipts)
    .find((receipt) => receipt.transactionId === transactionId)
}

function assertReceiptMatches(receipt: HgssP2pTradeReceipt, request: NormalizedPrepareRequest): void {
  if (receipt.sentPokemonInstanceId !== request.outgoing.instanceId
    || receipt.receivedPokemonInstanceId !== request.incoming.instanceId) {
    throw new Error("La transaction P2P existe déjà avec une autre paire de Pokémon.")
  }
}

function buildCandidateCommit(
  current: FieldScriptState,
  request: NormalizedPrepareRequest,
  destination: TradeDestination,
  teamPolicy: PokemonTeamPolicy,
  eggDisplayName: string | undefined,
): CandidateCommit {
  const context = createLocalContext(current, eggDisplayName)
  const located = requireSingleOutgoingLocation(current, request.outgoing, context)
  if (!destinationEquals(located.destination, destination)) {
    throw new Error("Le Pokémon proposé a changé d'emplacement depuis la préparation.")
  }
  requireIncomingIdentityAvailable(current, request.incoming.instanceId)
  const incoming = materializeCanonicalPokemonFromP2pTrade(request.incoming, context)

  const next = cloneFieldScriptState(current)
  const receivedBeforeEvolution = replaceAtDestination(
    next,
    destination,
    request.outgoing.instanceId,
    incoming,
  )
  markPokemonCaught(next.pokedex, receivedBeforeEvolution, next.pokemonRuntime!.language)
  // La transaction d'évolution travaille sur le clone candidat. Conserver une
  // équipe indépendante permet aux politiques NG+ de comparer précisément la
  // réception pré-évolution et son résultat, sans observer d'objet déjà muté.
  const partyBeforeEvolution = next.party.members.map(cloneCanonicalPokemon)
  const evolution = evolveReceivedPokemon(next, destination)
  const received = pokemonAtDestination(next, destination)!
  if (evolution) {
    assertPokemonPartyMutationAllowed('evolution', partyBeforeEvolution, next.party.members, teamPolicy)
    markPokemonCaught(next.pokedex, received, next.pokemonRuntime!.language)
  }

  // Le veto d'échange porte lui aussi sur le résultat final, évolution comprise.
  assertPokemonPartyMutationAllowed('player-trade', current.party.members, next.party.members, teamPolicy)
  incrementGameStat(next, hgssInternetTradesGameStatId, hgssWordGameStatMaximum)
  incrementGameStat(next, hgssInternetTradeAuxiliaryGameStatId, hgssHalfwordGameStatMaximum)
  next.gameScore = Math.min(hgssGameScoreMaximum, next.gameScore + hgssLinkTradeScoreIncrease)
  const receipt = createReceipt(request)
  next.p2pTradeReceipts = appendHgssP2pTradeReceipt(next.p2pTradeReceipts, receipt)
  for (const journal of parseHgssP2pTradeJournals(next.p2pTradeJournals)) {
    if (journal.phase === 'committed'
      && !next.p2pTradeReceipts.some(({ transactionId }) => transactionId === journal.transactionId)) {
      throw new Error("La limite des reçus empêcherait de conserver une preuve de reprise P2P active.")
    }
  }

  return {
    state: next,
    result: {
      receipt,
      outgoingPokemonId: request.outgoing.instanceId,
      incomingPokemonId: request.incoming.instanceId,
      receivedSpeciesId: received.speciesId,
      destination: { ...destination },
      ...(evolution ? { evolution } : {}),
    },
  }
}

function cloneCommitResult(
  result: HgssP2pTradeCommitResult,
  status: HgssP2pTradeCommitResult['status'],
): HgssP2pTradeCommitResult {
  return {
    ...result,
    status,
    receipt: { ...result.receipt },
    destination: { ...result.destination },
    ...(result.evolution ? {
      evolution: {
        ...result.evolution,
        learnedMoveIds: [...result.evolution.learnedMoveIds],
        skippedMoveIds: [...result.evolution.skippedMoveIds],
      },
    } : {}),
  }
}

function commitResultFromJournal(
  state: FieldScriptState,
  journal: Extract<HgssP2pTradeJournal, { phase: 'committed' }>,
  status: HgssP2pTradeCommitResult['status'],
): HgssP2pTradeCommitResult {
  const receipt = findReceipt(state, journal.transactionId)
  if (!receipt) throw new Error("Le journal P2P commité ne possède pas son reçu local durable.")
  const request = normalizeJournalRequest(journal)
  assertReceiptMatches(receipt, request)
  return {
    status,
    receipt: { ...receipt },
    outgoingPokemonId: journal.outgoing.instanceId,
    incomingPokemonId: journal.incoming.instanceId,
    receivedSpeciesId: journal.result.receivedSpeciesId,
    destination: { ...journal.destination },
    ...(journal.result.evolution ? {
      evolution: {
        ...journal.result.evolution,
        learnedMoveIds: [...journal.result.evolution.learnedMoveIds],
        skippedMoveIds: [...journal.result.evolution.skippedMoveIds],
      },
    } : {}),
  }
}

function findJournal(state: FieldScriptState, transactionId: string): HgssP2pTradeJournal | undefined {
  return parseHgssP2pTradeJournals(state.p2pTradeJournals)
    .find((journal) => journal.transactionId === transactionId)
}

function assertJournalPokemonIdsAvailable(
  state: FieldScriptState,
  request: NormalizedPrepareRequest,
): void {
  const conflict = parseHgssP2pTradeJournals(state.p2pTradeJournals).find((journal) => (
    journal.transactionId !== request.transactionId
    && [journal.outgoing.instanceId, journal.incoming.instanceId]
      .some((instanceId) => instanceId === request.outgoing.instanceId || instanceId === request.incoming.instanceId)
  ))
  if (conflict) throw new Error("Un Pokémon de l'échange est déjà réservé par une transaction durable.")
}

/** Escrow local transactionnel dont toute décision survivant au RTC est persistée avant publication. */
export function createHgssP2pTradeRuntimeEscrow(
  options: HgssP2pTradeRuntimeEscrowOptions,
): HgssP2pTradeRuntimeEscrow {
  if (typeof options.getState !== 'function'
    || typeof options.persistState !== 'function'
    || typeof options.publishState !== 'function') {
    throw new TypeError("Les callbacks d'état et de persistance de l'escrow P2P sont requis.")
  }
  const teamPolicy = options.teamPolicy ?? basePokemonTeamPolicy
  const reservations = new Map<string, RuntimeReservation>()
  const reservationByTransaction = new Map<string, string>()
  const reservationByPokemon = new Map<PokemonInstanceId, string>()
  const committedResults = new Map<string, HgssP2pTradeCommitResult>()
  let reservationSequence = 0
  let operationQueue: Promise<void> = Promise.resolve()

  const enqueue = <Value>(operation: () => Promise<Value> | Value): Promise<Value> => {
    const result = operationQueue.then(() => operation(), () => operation())
    operationQueue = result.then(() => undefined, () => undefined)
    return result
  }

  const releaseReservation = (runtimeReservation: RuntimeReservation): void => {
    reservations.delete(runtimeReservation.reservationId)
    if (reservationByTransaction.get(runtimeReservation.transactionId) === runtimeReservation.reservationId) {
      reservationByTransaction.delete(runtimeReservation.transactionId)
    }
    for (const pokemonId of [runtimeReservation.outgoingPokemonId, runtimeReservation.incomingPokemonId]) {
      if (reservationByPokemon.get(pokemonId) === runtimeReservation.reservationId) {
        reservationByPokemon.delete(pokemonId)
      }
    }
  }

  const releaseTransactionReservation = (transactionId: string): void => {
    const reservationId = reservationByTransaction.get(transactionId)
    const reservation = reservationId ? reservations.get(reservationId) : undefined
    if (reservation) releaseReservation(reservation)
  }

  const assertRuntimePokemonIdsAvailable = (request: NormalizedPrepareRequest): void => {
    for (const pokemonId of [request.outgoing.instanceId, request.incoming.instanceId]) {
      const reservationId = reservationByPokemon.get(pokemonId)
      const reservation = reservationId ? reservations.get(reservationId) : undefined
      if (reservation && reservation.transactionId !== request.transactionId) {
        throw new Error("Un Pokémon de l'échange est déjà réservé par une autre transaction.")
      }
    }
  }

  const addReservation = (
    request: NormalizedPrepareRequest,
    destination: TradeDestination,
    recovery: boolean,
  ): HgssP2pTradeReservation => {
    const existingId = reservationByTransaction.get(request.transactionId)
    if (existingId) {
      const existing = reservations.get(existingId)!
      if (existing.requestFingerprint !== request.fingerprint || !destinationEquals(existing.destination, destination)) {
        throw new Error("La transaction P2P possède déjà une autre réservation locale.")
      }
      return { reservationId: existing.reservationId }
    }
    assertRuntimePokemonIdsAvailable(request)
    reservationSequence += 1
    const reservationId = `trade:${request.transactionId}:${reservationSequence}`
    const runtimeReservation: RuntimeReservation = {
      reservationId,
      transactionId: request.transactionId,
      requestFingerprint: request.fingerprint,
      outgoingPokemonId: request.outgoing.instanceId,
      incomingPokemonId: request.incoming.instanceId,
      destination: { ...destination },
      recovery,
    }
    reservations.set(reservationId, runtimeReservation)
    reservationByTransaction.set(request.transactionId, reservationId)
    reservationByPokemon.set(request.outgoing.instanceId, reservationId)
    reservationByPokemon.set(request.incoming.instanceId, reservationId)
    return { reservationId }
  }

  const persistCommittedJournal = async (
    current: FieldScriptState,
    prepared: HgssP2pTradeJournal,
  ): Promise<HgssP2pTradeCommitResult> => {
    if (prepared.phase !== 'prepared') throw new Error("La transaction P2P locale est déjà commitée.")
    const request = normalizeJournalRequest(prepared)
    const candidate = buildCandidateCommit(
      current,
      request,
      prepared.destination,
      teamPolicy,
      options.eggDisplayName,
    )
    const result: HgssP2pTradeCommitResult = { status: 'committed', ...candidate.result }
    const committedJournal = createCommittedJournal(prepared, candidate.result)
    candidate.state.p2pTradeJournals = upsertHgssP2pTradeJournal(
      candidate.state.p2pTradeJournals,
      committedJournal,
    )
    await options.persistState(candidate.state)
    options.publishState(candidate.state)
    committedResults.set(request.transactionId, cloneCommitResult(result, 'committed'))
    releaseTransactionReservation(request.transactionId)
    return cloneCommitResult(result, 'committed')
  }

  const prepareInternal = async (
    rawRequest: HgssP2pTradePrepareRequest,
  ): Promise<HgssP2pTradeReservation> => {
    const request = normalizeRequest(rawRequest)
    const current = options.getState()
    assertJournalPokemonIdsAvailable(current, request)
    assertRuntimePokemonIdsAvailable(request)
    const receipt = findReceipt(current, request.transactionId)
    const journal = findJournal(current, request.transactionId)
    if (receipt) {
      assertReceiptMatches(receipt, request)
      if (journal) {
        assertJournalMatchesRequest(journal, request)
        if (journal.phase !== 'committed') {
          throw new Error("Le reçu P2P local contredit un journal encore préparé.")
        }
        return addReservation(request, journal.destination, true)
      }
      const received = findTradeablePokemon(current, request.incoming.instanceId)
      if (!received) throw new Error("Le Pokémon déjà reçu n'est plus dans un emplacement échangeable.")
      return addReservation(request, received.destination, true)
    }
    if (journal) {
      assertJournalMatchesRequest(journal, request)
      if (journal.phase !== 'prepared') throw new Error("Le journal P2P commité ne possède pas son reçu durable.")
      const context = createLocalContext(current, options.eggDisplayName)
      const located = requireSingleOutgoingLocation(current, request.outgoing, context)
      if (!destinationEquals(located.destination, journal.destination)) {
        throw new Error("Le Pokémon proposé a changé d'emplacement depuis sa journalisation.")
      }
      requireIncomingIdentityAvailable(current, request.incoming.instanceId)
      buildCandidateCommit(current, request, journal.destination, teamPolicy, options.eggDisplayName)
      return addReservation(request, journal.destination, false)
    }

    const context = createLocalContext(current, options.eggDisplayName)
    const located = requireSingleOutgoingLocation(current, request.outgoing, context)
    requireIncomingIdentityAvailable(current, request.incoming.instanceId)
    // Matérialisation, évolution, Pokédex et politiques sont prévalidés sans publication.
    buildCandidateCommit(current, request, located.destination, teamPolicy, options.eggDisplayName)
    const prepared = createPreparedJournal(request, located.destination)
    const next = cloneFieldScriptState(current)
    next.p2pTradeJournals = upsertHgssP2pTradeJournal(next.p2pTradeJournals, prepared)
    await options.persistState(next)
    options.publishState(next)
    return addReservation(request, located.destination, false)
  }

  const commitInternal = async (
    rawRequest: HgssP2pTradeCommitRequest,
  ): Promise<HgssP2pTradeCommitResult> => {
    const request = normalizeRequest(rawRequest)
    const reservationId = requireReservationId(rawRequest.reservation)
    const current = options.getState()
    const receipt = findReceipt(current, request.transactionId)
    const journal = findJournal(current, request.transactionId)
    if (receipt) {
      assertReceiptMatches(receipt, request)
      const runtimeReservation = reservations.get(reservationId)
      if (runtimeReservation
        && (runtimeReservation.transactionId !== request.transactionId
          || runtimeReservation.requestFingerprint !== request.fingerprint)) {
        throw new Error("Le commit P2P ne correspond pas à sa réservation locale exacte.")
      }
      if (runtimeReservation) releaseReservation(runtimeReservation)
      const cached = committedResults.get(request.transactionId)
      if (cached) return cloneCommitResult(cached, 'already-committed')
      if (journal) {
        assertJournalMatchesRequest(journal, request)
        if (journal.phase !== 'committed') throw new Error("Le reçu P2P local contredit son journal durable.")
        return commitResultFromJournal(current, journal, 'already-committed')
      }
      const received = findTradeablePokemon(current, request.incoming.instanceId)
      if (!received) throw new Error("Le Pokémon déjà reçu n'est plus dans un emplacement échangeable.")
      return {
        status: 'already-committed',
        receipt: { ...receipt },
        outgoingPokemonId: request.outgoing.instanceId,
        incomingPokemonId: request.incoming.instanceId,
        receivedSpeciesId: received.pokemon.speciesId,
        destination: { ...received.destination },
      }
    }

    const runtimeReservation = reservations.get(reservationId)
    if (!runtimeReservation
      || runtimeReservation.recovery
      || runtimeReservation.transactionId !== request.transactionId
      || runtimeReservation.requestFingerprint !== request.fingerprint) {
      throw new Error("Le commit P2P ne correspond pas à sa réservation locale exacte.")
    }
    if (!journal) throw new Error("Le journal préparé requis par le commit P2P est absent.")
    assertJournalMatchesRequest(journal, request)
    if (journal.phase !== 'prepared' || !destinationEquals(journal.destination, runtimeReservation.destination)) {
      throw new Error("Le commit P2P ne correspond pas au journal local préparé.")
    }
    return persistCommittedJournal(current, journal)
  }

  const rollbackInternal = async (
    rawRequest: HgssP2pTradePrepareRequest,
    reservation: HgssP2pTradeReservation,
    reason: HgssP2pTradeRollbackReason,
  ): Promise<void> => {
    const request = normalizeRequest(rawRequest)
    const reservationId = requireReservationId(reservation)
    const runtimeReservation = reservations.get(reservationId)
    if (runtimeReservation
      && (runtimeReservation.transactionId !== request.transactionId
        || runtimeReservation.requestFingerprint !== request.fingerprint)) {
      throw new Error("Le rollback P2P ne correspond pas à sa réservation locale exacte.")
    }
    const current = options.getState()
    const journal = findJournal(current, request.transactionId)
    if (journal) {
      assertJournalMatchesRequest(journal, request)
      if (journal.phase === 'committed') {
        if (runtimeReservation) releaseReservation(runtimeReservation)
        return
      }
      // Une coupure, un timeout ou une erreur de protocole ne prouvent jamais
      // que le pair n'a pas déjà décidé le commit après notre `prepared`.
      if (reason === 'disconnect' || reason === 'timeout' || reason === 'protocol-error') {
        if (runtimeReservation) releaseReservation(runtimeReservation)
        return
      }
      const next = cloneFieldScriptState(current)
      next.p2pTradeJournals = removeHgssP2pTradeJournal(next.p2pTradeJournals, request.transactionId)
      await options.persistState(next)
      options.publishState(next)
    }
    if (runtimeReservation) releaseReservation(runtimeReservation)
  }

  const prepare = (request: HgssP2pTradePrepareRequest): Promise<HgssP2pTradeReservation> => (
    enqueue(() => prepareInternal(request))
  )
  const commit = (request: HgssP2pTradeCommitRequest): Promise<HgssP2pTradeCommitResult> => (
    enqueue(() => commitInternal(request))
  )
  const rollback = (
    request: HgssP2pTradePrepareRequest,
    reservation: HgssP2pTradeReservation,
    reason: HgssP2pTradeRollbackReason,
  ): Promise<void> => enqueue(() => rollbackInternal(request, reservation, reason))

  const listRecoveryJournals = (remoteParticipantId: string): readonly HgssP2pTradeJournal[] => {
    if (!reservationIdPattern.test(remoteParticipantId)) throw new Error("L'identité du pair P2P est invalide.")
    return Object.freeze(parseHgssP2pTradeJournals(options.getState().p2pTradeJournals)
      .filter((journal) => journal.remoteParticipantId === remoteParticipantId)
      .map((journal) => parseHgssP2pTradeJournal(journal)))
  }

  const reconcileRecoveryInternal = async (
    rawRemoteJournal: unknown,
    localParticipantId: string,
    remoteParticipantId: string,
  ): Promise<HgssP2pTradeRecoveryResult> => {
    if (!reservationIdPattern.test(localParticipantId) || !reservationIdPattern.test(remoteParticipantId)) {
      throw new Error("Les identités de reprise P2P sont invalides.")
    }
    const remote = parseHgssP2pTradeJournal(rawRemoteJournal)
    if (remote.localParticipantId !== remoteParticipantId || remote.remoteParticipantId !== localParticipantId) {
      throw new Error("Le journal de reprise P2P n'appartient pas au pair attendu.")
    }
    const current = options.getState()
    const local = findJournal(current, remote.transactionId)
    if (local && !areHgssP2pTradeJournalsMirrored(local, remote)) {
      throw new Error("Les journaux locaux et distants décrivent des transactions divergentes.")
    }

    // Après une confirmation perdue, le journal peut déjà avoir été nettoyé.
    // Le reçu à trois IDs prouve alors le no-op sans autoriser une remutation.
    if (!local) {
      const receipt = findReceipt(current, remote.transactionId)
      if (receipt) {
        if (receipt.sentPokemonInstanceId !== remote.incoming.instanceId
          || receipt.receivedPokemonInstanceId !== remote.outgoing.instanceId) {
          throw new Error("Le journal distant diverge du reçu P2P local déjà commité.")
        }
        const received = findTradeablePokemon(current, receipt.receivedPokemonInstanceId)
        if (!received) throw new Error("Le Pokémon reçu du commit P2P n'est plus échangeable localement.")
        return {
          kind: 'committed',
          commitResult: {
            status: 'already-committed',
            receipt: { ...receipt },
            outgoingPokemonId: receipt.sentPokemonInstanceId,
            incomingPokemonId: receipt.receivedPokemonInstanceId,
            receivedSpeciesId: received.pokemon.speciesId,
            destination: { ...received.destination },
          },
        }
      }
      // Un journal distant seul n'est jamais une autorisation locale. Puisque
      // `prepare` est durable avant émission, son absence prouve que cette
      // sauvegarde n'a pas accepté la transaction (ou l'a déjà annulée).
      return { kind: 'missing' }
    }

    if (local?.phase === 'committed') {
      return {
        kind: 'committed',
        journal: local,
        commitResult: commitResultFromJournal(current, local, 'already-committed'),
      }
    }
    if (local?.phase === 'prepared') {
      if (remote.phase === 'committed' || localParticipantId < remoteParticipantId) {
        const commitResult = await persistCommittedJournal(current, local)
        const committed = findJournal(options.getState(), local.transactionId)
        if (!committed || committed.phase !== 'committed') throw new Error("Le commit de reprise P2P n'a pas été publié.")
        return { kind: 'committed', journal: committed, commitResult }
      }
      return { kind: 'prepared', journal: local }
    }
    return { kind: 'missing' }
  }

  const reconcileRecovery = (
    remoteJournal: unknown,
    localParticipantId: string,
    remoteParticipantId: string,
  ): Promise<HgssP2pTradeRecoveryResult> => (
    enqueue(() => reconcileRecoveryInternal(remoteJournal, localParticipantId, remoteParticipantId))
  )

  const finalizeRecovery = (
    transactionId: string,
    remoteParticipantId: string,
    disposition: HgssP2pTradeRecoveryDisposition,
  ): Promise<boolean> => enqueue(async () => {
    const normalizedTransactionId = assertHgssP2pTradeOpaqueId(transactionId, 'La transaction')
    if (!reservationIdPattern.test(remoteParticipantId)) throw new Error("L'identité du pair P2P est invalide.")
    if (disposition !== 'confirmed-committed' && disposition !== 'cancel-prepared') {
      throw new Error("La finalisation de reprise P2P est invalide.")
    }
    const current = options.getState()
    const journal = findJournal(current, normalizedTransactionId)
    if (!journal) return false
    if (journal.remoteParticipantId !== remoteParticipantId) {
      throw new Error("La transaction P2P durable appartient à un autre pair.")
    }
    const allowed = disposition === 'confirmed-committed'
      ? journal.phase === 'committed'
      : journal.phase === 'prepared'
    if (!allowed) return false
    const next = cloneFieldScriptState(current)
    next.p2pTradeJournals = removeHgssP2pTradeJournal(next.p2pTradeJournals, normalizedTransactionId)
    await options.persistState(next)
    options.publishState(next)
    releaseTransactionReservation(normalizedTransactionId)
    return true
  })

  return Object.freeze({
    prepare,
    commit,
    rollback,
    listRecoveryJournals,
    reconcileRecovery,
    finalizeRecovery,
    isPokemonReserved: (instanceId) => reservationByPokemon.has(instanceId)
      || parseHgssP2pTradeJournals(options.getState().p2pTradeJournals)
        .some((journal) => journal.outgoing.instanceId === instanceId || journal.incoming.instanceId === instanceId),
  })
}
