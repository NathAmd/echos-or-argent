import {
  assertHgssP2pTradeIdentifier,
  assertHgssP2pTradeOpaqueId,
  createHgssP2pTradeOfferPair,
  getHgssP2pTradeOfferPairKey,
  hgssP2pTradeProtocol,
  hgssP2pTradeProtocolVersion,
  parseHgssP2pTradeFrame,
  parseHgssP2pTradePokemonSnapshot,
  projectHgssP2pTradeOfferPreview,
  type HgssP2pTradeCancelReason,
  type HgssP2pTradeFrame,
  type HgssP2pTradeOfferPair,
  type HgssP2pTradeOfferPreview,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'
import { parsePortablePokemonInstanceId, type PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { parseHgssP2pTradeReceipt, type HgssP2pTradeReceipt } from './hgssP2pTradeReceipt'

export type HgssP2pTradePrepareRequest = Readonly<{
  sessionId: string
  transactionId: string
  pair: HgssP2pTradeOfferPair
  outgoing: HgssP2pTradePokemonSnapshot
  incoming: HgssP2pTradePokemonSnapshot
}>

export type HgssP2pTradeReservation = Readonly<{
  reservationId: string
}>

export type HgssP2pTradeCommitRequest = HgssP2pTradePrepareRequest & Readonly<{
  reservation: HgssP2pTradeReservation
}>

export type HgssP2pTradeEvolutionEffect = Readonly<{
  sourceSpeciesId: number
  targetSpeciesId: number
  consumedHeldItemId?: number
  learnedMoveIds: readonly number[]
  skippedMoveIds: readonly number[]
}>

export type HgssP2pTradeCommitResult = Readonly<{
  status: 'committed' | 'already-committed'
  receipt: HgssP2pTradeReceipt
  outgoingPokemonId: PokemonInstanceId
  incomingPokemonId: PokemonInstanceId
  receivedSpeciesId: number
  destination:
    | Readonly<{ kind: 'party', slot: number }>
    | Readonly<{ kind: 'storage', box: number, slot: number }>
  evolution?: HgssP2pTradeEvolutionEffect
}>

export type HgssP2pTradeRollbackReason =
  | 'offer-changed'
  | 'cancelled'
  | 'timeout'
  | 'disconnect'
  | 'protocol-error'

/**
 * Transaction locale durable injectée par le runtime de jeu.
 *
 * `prepare` doit vérifier que le Pokémon sortant est toujours exactement celui
 * de l'offre, réserver sa destination et le placer en escrow afin qu'il ne
 * puisse plus combattre, être déplacé ou être offert ailleurs. `commit` doit,
 * dans une seule transaction persistée et dédupliquée par transactionId/paire,
 * remplacer l'instance, marquer l'OT reçu comme externe au joueur courant,
 * appliquer Pokédex/statistiques puis l'évolution d'échange. `rollback` remet
 * l'escrow dans son état initial tant qu'aucune décision de commit n'existe.
 */
export type HgssP2pTradeEscrowPort = Readonly<{
  prepare: (request: HgssP2pTradePrepareRequest) => Promise<HgssP2pTradeReservation> | HgssP2pTradeReservation
  commit: (request: HgssP2pTradeCommitRequest) => Promise<HgssP2pTradeCommitResult> | HgssP2pTradeCommitResult
  rollback: (
    request: HgssP2pTradePrepareRequest,
    reservation: HgssP2pTradeReservation,
    reason: HgssP2pTradeRollbackReason,
  ) => Promise<void> | void
}>

export type HgssP2pTradeCoordinatorStatus =
  | 'negotiating'
  | 'accepted'
  | 'preparing'
  | 'prepared'
  | 'commit-pending'
  | 'committed'
  | 'cancelled'

export type HgssP2pTradeCoordinatorSnapshot = Readonly<{
  status: HgssP2pTradeCoordinatorStatus
  authorityId: string
  localOffer?: Readonly<{ revision: number, preview: HgssP2pTradeOfferPreview }>
  remoteOffer?: Readonly<{ revision: number, preview: HgssP2pTradeOfferPreview }>
  pair?: HgssP2pTradeOfferPair
  localAccepted: boolean
  remoteAccepted: boolean
  localPrepared: boolean
  remotePrepared: boolean
  commitResult?: HgssP2pTradeCommitResult
  cancelReason?: HgssP2pTradeCancelReason
  needsRecovery: boolean
}>

export type HgssP2pTradeReceiveDecision = Readonly<{
  kind: 'applied' | 'duplicate' | 'stale' | 'ignored'
  reason?: 'invalid-frame' | 'foreign-transaction' | 'unexpected-sender' | 'stale-pair' | 'terminal'
}>

export type HgssP2pTradeCoordinatorOptions = Readonly<{
  sessionId: string
  transactionId: string
  localParticipantId: string
  remoteParticipantId: string
  timeoutMs: number
  escrow: HgssP2pTradeEscrowPort
  send: (frame: HgssP2pTradeFrame) => Promise<void> | void
  now?: () => number
}>

export type HgssP2pTradeCoordinator = Readonly<{
  offer: (pokemon: HgssP2pTradePokemonSnapshot) => Promise<void>
  withdrawOffer: () => Promise<void>
  accept: () => Promise<void>
  cancel: (reason?: Extract<HgssP2pTradeCancelReason, 'user' | 'offer-withdrawn'>) => Promise<boolean>
  receive: (frame: unknown) => Promise<HgssP2pTradeReceiveDecision>
  tick: (now?: number) => Promise<boolean>
  disconnect: () => Promise<void>
  resume: () => Promise<void>
  getSnapshot: () => HgssP2pTradeCoordinatorSnapshot
}>

type Preparation = Readonly<{
  pairKey: string
  request: HgssP2pTradePrepareRequest
  reservation: HgssP2pTradeReservation
}>

type InternalOffer = Readonly<{
  revision: number
  pokemon: HgssP2pTradePokemonSnapshot
}>

const reservationPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/

function parseReservation(value: unknown): HgssP2pTradeReservation {
  if (
    value === null
    || typeof value !== 'object'
    || Array.isArray(value)
    || Object.getPrototypeOf(value) !== Object.prototype
    || Reflect.ownKeys(value).length !== 1
    || !Object.hasOwn(value, 'reservationId')
  ) throw new TypeError("La réservation locale de l'échange P2P est invalide.")
  const reservationId = Reflect.get(value, 'reservationId')
  if (typeof reservationId !== 'string' || !reservationPattern.test(reservationId)) {
    throw new TypeError("L'identifiant de réservation locale de l'échange P2P est invalide.")
  }
  return Object.freeze({ reservationId })
}

function freezeDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezeDeep(nested)
  return Object.freeze(value)
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function validateIdList(value: unknown): value is readonly number[] {
  return Array.isArray(value) && value.length <= 4 && value.every((entry) => boundedInteger(entry, 1, 0xffff))
}

function parseCommitResult(
  value: unknown,
  transactionId: string,
  outgoingPokemonId: PokemonInstanceId,
  incomingPokemonId: PokemonInstanceId,
): HgssP2pTradeCommitResult {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) {
    throw new TypeError("Le reçu local de l'échange P2P est invalide.")
  }
  const result = value as Partial<HgssP2pTradeCommitResult>
  if (result.status !== 'committed' && result.status !== 'already-committed') throw new TypeError("Le statut du reçu d'échange P2P est invalide.")
  const receipt = parseHgssP2pTradeReceipt(result.receipt)
  if (parsePortablePokemonInstanceId(result.outgoingPokemonId) !== outgoingPokemonId
    || parsePortablePokemonInstanceId(result.incomingPokemonId) !== incomingPokemonId) {
    throw new TypeError("Le reçu d'échange P2P ne correspond pas aux instances engagées.")
  }
  if (receipt.transactionId !== transactionId
    || receipt.sentPokemonInstanceId !== outgoingPokemonId
    || receipt.receivedPokemonInstanceId !== incomingPokemonId) {
    throw new TypeError("Le reçu persisté ne correspond pas aux instances engagées.")
  }
  if (!boundedInteger(result.receivedSpeciesId, 1, 0xffff) || !result.destination) throw new TypeError("Le résultat fonctionnel de l'échange P2P est invalide.")
  if (result.destination.kind === 'party') {
    if (!boundedInteger(result.destination.slot, 0, 5)) throw new TypeError("Le slot d'équipe reçu est invalide.")
  } else if (result.destination.kind === 'storage') {
    if (!boundedInteger(result.destination.box, 0, 17) || !boundedInteger(result.destination.slot, 0, 29)) {
      throw new TypeError("Le slot de stockage reçu est invalide.")
    }
  } else throw new TypeError("La destination du Pokémon reçu est invalide.")
  if (result.evolution) {
    if (
      !boundedInteger(result.evolution.sourceSpeciesId, 1, 0xffff)
      || !boundedInteger(result.evolution.targetSpeciesId, 1, 0xffff)
      || result.evolution.consumedHeldItemId !== undefined && !boundedInteger(result.evolution.consumedHeldItemId, 1, 0xffff)
      || !validateIdList(result.evolution.learnedMoveIds)
      || !validateIdList(result.evolution.skippedMoveIds)
    ) throw new TypeError("L'effet d'évolution du reçu d'échange P2P est invalide.")
  }
  return freezeDeep({
    status: result.status,
    receipt,
    outgoingPokemonId,
    incomingPokemonId,
    receivedSpeciesId: result.receivedSpeciesId,
    destination: { ...result.destination },
    ...(result.evolution ? {
      evolution: {
        sourceSpeciesId: result.evolution.sourceSpeciesId,
        targetSpeciesId: result.evolution.targetSpeciesId,
        ...(result.evolution.consumedHeldItemId === undefined ? {} : { consumedHeldItemId: result.evolution.consumedHeldItemId }),
        learnedMoveIds: [...result.evolution.learnedMoveIds],
        skippedMoveIds: [...result.evolution.skippedMoveIds],
      },
    } : {}),
  })
}

function validTime(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) throw new TypeError(`${label} d'échange P2P est invalide.`)
  return value
}

export function createHgssP2pTradeCoordinator(
  options: HgssP2pTradeCoordinatorOptions,
): HgssP2pTradeCoordinator {
  const sessionId = assertHgssP2pTradeOpaqueId(options.sessionId, 'La session')
  const transactionId = assertHgssP2pTradeOpaqueId(options.transactionId, 'La transaction')
  const localParticipantId = assertHgssP2pTradeIdentifier(options.localParticipantId, 'Le participant local')
  const remoteParticipantId = assertHgssP2pTradeIdentifier(options.remoteParticipantId, 'Le participant distant')
  if (localParticipantId === remoteParticipantId) throw new TypeError("Les deux participants de l'échange P2P doivent être distincts.")
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1 || options.timeoutMs > 86_400_000) {
    throw new TypeError("Le délai d'expiration de l'échange P2P est invalide.")
  }
  if (!options.escrow || typeof options.escrow.prepare !== 'function'
    || typeof options.escrow.commit !== 'function' || typeof options.escrow.rollback !== 'function') {
    throw new TypeError("Le port d'escrow de l'échange P2P est invalide.")
  }
  if (typeof options.send !== 'function') throw new TypeError("Le transport de l'échange P2P est invalide.")
  const now = options.now ?? Date.now
  const authorityId = [localParticipantId, remoteParticipantId].sort()[0]!

  let localRevision = 0
  let remoteRevision = 0
  let localOffer: InternalOffer | undefined
  let remoteOffer: InternalOffer | undefined
  let remoteRevisionPayload: HgssP2pTradePokemonSnapshot | null | undefined
  let localAcceptanceKey: string | undefined
  let remoteAcceptanceKey: string | undefined
  let remotePreparedKey: string | undefined
  let preparation: Preparation | undefined
  let preparing = false
  let commitDecisionKey: string | undefined
  let commitResult: HgssP2pTradeCommitResult | undefined
  let peerCommitAcknowledged = false
  let completed = false
  let cancelReason: HgssP2pTradeCancelReason | undefined
  let lastActivityAt = validTime(now(), "L'horodatage initial")
  let queue: Promise<void> = Promise.resolve()

  const enqueue = <Result>(operation: () => Promise<Result>): Promise<Result> => {
    const result = queue.then(operation, operation)
    queue = result.then(() => undefined, () => undefined)
    return result
  }

  const envelope = () => ({
    protocol: hgssP2pTradeProtocol,
    protocolVersion: hgssP2pTradeProtocolVersion,
    sessionId,
    transactionId,
    senderId: localParticipantId,
  }) as const

  const send = async (frame: HgssP2pTradeFrame): Promise<void> => {
    const parsed = parseHgssP2pTradeFrame(frame)
    if (!parsed) throw new TypeError("Le coordinateur a produit une trame d'échange P2P invalide.")
    await options.send(parsed)
  }

  const touch = (at = now()): void => {
    const next = validTime(at, "L'horodatage courant")
    lastActivityAt = Math.max(lastActivityAt, next)
  }

  const pair = (): HgssP2pTradeOfferPair | undefined => {
    if (!localOffer || !remoteOffer || localOffer.pokemon.instanceId === remoteOffer.pokemon.instanceId) return undefined
    return createHgssP2pTradeOfferPair(
      { participantId: localParticipantId, revision: localOffer.revision, pokemonId: localOffer.pokemon.instanceId },
      { participantId: remoteParticipantId, revision: remoteOffer.revision, pokemonId: remoteOffer.pokemon.instanceId },
    )
  }

  const currentPairKey = (): string | undefined => {
    const current = pair()
    return current ? getHgssP2pTradeOfferPairKey(current) : undefined
  }

  const isTerminal = (): boolean => completed || cancelReason !== undefined

  const prepareRequest = (currentPair: HgssP2pTradeOfferPair): HgssP2pTradePrepareRequest => {
    if (!localOffer || !remoteOffer) throw new Error("Les deux offres de l'échange P2P sont requises.")
    return freezeDeep({
      sessionId,
      transactionId,
      pair: currentPair,
      outgoing: localOffer.pokemon,
      incoming: remoteOffer.pokemon,
    })
  }

  const rollback = async (reason: HgssP2pTradeRollbackReason): Promise<void> => {
    if (!preparation) return
    const retained = preparation
    await options.escrow.rollback(retained.request, retained.reservation, reason)
    if (preparation === retained) preparation = undefined
  }

  const invalidateAgreement = async (reason: HgssP2pTradeRollbackReason): Promise<void> => {
    await rollback(reason)
    localAcceptanceKey = undefined
    remoteAcceptanceKey = undefined
    remotePreparedKey = undefined
    preparing = false
  }

  const status = (): HgssP2pTradeCoordinatorStatus => {
    if (cancelReason) return 'cancelled'
    if (completed) return 'committed'
    if (commitDecisionKey) return 'commit-pending'
    if (preparing) return 'preparing'
    const key = currentPairKey()
    if (preparation || (key !== undefined && remotePreparedKey === key)) return 'prepared'
    if (key && localAcceptanceKey === key && remoteAcceptanceKey === key) return 'accepted'
    return 'negotiating'
  }

  const cancelInternal = async (
    reason: HgssP2pTradeCancelReason,
    rollbackReason: HgssP2pTradeRollbackReason,
    notifyPeer: boolean,
  ): Promise<boolean> => {
    if (commitDecisionKey) return false
    if (cancelReason) return true
    cancelReason = reason
    localAcceptanceKey = undefined
    remoteAcceptanceKey = undefined
    remotePreparedKey = undefined
    preparing = false
    let sendFailure: unknown
    if (notifyPeer) {
      try { await send({ ...envelope(), kind: 'cancel', reason }) } catch (error) { sendFailure = error }
    }
    await rollback(rollbackReason)
    if (sendFailure) throw sendFailure
    return true
  }

  const protocolFailure = async (): Promise<void> => {
    await cancelInternal('protocol-error', 'protocol-error', true)
  }

  const validatePairFrame = (framePair: HgssP2pTradeOfferPair): string | undefined => {
    const key = currentPairKey()
    return key && getHgssP2pTradeOfferPairKey(framePair) === key ? key : undefined
  }

  const commitLocally = async (): Promise<void> => {
    if (commitResult) return
    if (!commitDecisionKey || !preparation || preparation.pairKey !== commitDecisionKey) {
      throw new Error("La décision de commit P2P ne possède plus son escrow exact.")
    }
    const rawResult = await options.escrow.commit({
      ...preparation.request,
      reservation: preparation.reservation,
    })
    commitResult = parseCommitResult(
      rawResult,
      transactionId,
      preparation.request.outgoing.instanceId,
      preparation.request.incoming.instanceId,
    )
  }

  const sendCommitAsAuthority = async (): Promise<void> => {
    if (authorityId !== localParticipantId || !commitDecisionKey) return
    const currentPair = pair()
    if (!currentPair || getHgssP2pTradeOfferPairKey(currentPair) !== commitDecisionKey) {
      throw new Error("La paire engagée par l'autorité P2P a changé.")
    }
    await commitLocally()
    await send({ ...envelope(), kind: 'commit', pair: currentPair })
  }

  const maybeAuthorizeCommit = async (): Promise<void> => {
    if (authorityId !== localParticipantId || commitDecisionKey || isTerminal()) return
    const currentPair = pair()
    if (!currentPair) return
    const key = getHgssP2pTradeOfferPairKey(currentPair)
    if (preparation?.pairKey !== key || remotePreparedKey !== key) return
    // La décision devient irréversible avant la première mutation locale. Une
    // coupure ultérieure passe donc en reprise, jamais en rollback de l'escrow.
    commitDecisionKey = key
    await sendCommitAsAuthority()
  }

  const maybePrepare = async (): Promise<void> => {
    if (preparation || preparing || commitDecisionKey || isTerminal()) return
    const currentPair = pair()
    if (!currentPair) return
    const key = getHgssP2pTradeOfferPairKey(currentPair)
    if (localAcceptanceKey !== key || remoteAcceptanceKey !== key) return
    preparing = true
    const request = prepareRequest(currentPair)
    try {
      const reservation = parseReservation(await options.escrow.prepare(request))
      preparation = Object.freeze({ pairKey: key, request, reservation })
      await send({ ...envelope(), kind: 'prepared', pair: currentPair })
      await maybeAuthorizeCommit()
    } catch (error) {
      if (preparation) await rollback('cancelled')
      await cancelInternal('local-rejected', 'cancelled', true).catch(() => undefined)
      throw error
    } finally {
      preparing = false
    }
  }

  const receiveOffer = async (
    frame: Extract<HgssP2pTradeFrame, { kind: 'offer' }>,
  ): Promise<HgssP2pTradeReceiveDecision> => {
    if (commitDecisionKey || completed || cancelReason) return { kind: 'ignored', reason: 'terminal' }
    if (frame.revision < remoteRevision) return { kind: 'stale' }
    if (frame.revision === remoteRevision) {
      const previous = remoteRevisionPayload === undefined ? undefined : JSON.stringify(remoteRevisionPayload)
      return previous === JSON.stringify(frame.pokemon) ? { kind: 'duplicate' } : (await protocolFailure(), { kind: 'applied' })
    }
    if (frame.revision !== remoteRevision + 1) {
      await protocolFailure()
      return { kind: 'applied' }
    }
    if (frame.pokemon && localOffer?.pokemon.instanceId === frame.pokemon.instanceId) {
      await protocolFailure()
      return { kind: 'applied' }
    }
    await invalidateAgreement('offer-changed')
    remoteRevision = frame.revision
    remoteRevisionPayload = frame.pokemon
    remoteOffer = frame.pokemon ? { revision: frame.revision, pokemon: frame.pokemon } : undefined
    return { kind: 'applied' }
  }

  const receiveAccepted = async (
    frame: Extract<HgssP2pTradeFrame, { kind: 'accept' }>,
  ): Promise<HgssP2pTradeReceiveDecision> => {
    if (isTerminal() || commitDecisionKey) return { kind: 'ignored', reason: 'terminal' }
    const key = validatePairFrame(frame.pair)
    if (!key) return { kind: 'stale', reason: 'stale-pair' }
    if (remoteAcceptanceKey === key) return { kind: 'duplicate' }
    remoteAcceptanceKey = key
    await maybePrepare()
    return { kind: 'applied' }
  }

  const receivePrepared = async (
    frame: Extract<HgssP2pTradeFrame, { kind: 'prepared' }>,
  ): Promise<HgssP2pTradeReceiveDecision> => {
    if (isTerminal() || commitDecisionKey) return { kind: 'ignored', reason: 'terminal' }
    const key = validatePairFrame(frame.pair)
    if (!key) return { kind: 'stale', reason: 'stale-pair' }
    if (localAcceptanceKey !== key || remoteAcceptanceKey !== key) {
      await protocolFailure()
      return { kind: 'applied' }
    }
    if (remotePreparedKey === key) return { kind: 'duplicate' }
    remotePreparedKey = key
    await maybePrepare()
    await maybeAuthorizeCommit()
    return { kind: 'applied' }
  }

  const receiveCommit = async (
    frame: Extract<HgssP2pTradeFrame, { kind: 'commit' }>,
  ): Promise<HgssP2pTradeReceiveDecision> => {
    if (authorityId !== remoteParticipantId) {
      if (!commitDecisionKey) await protocolFailure()
      return { kind: 'ignored', reason: 'unexpected-sender' }
    }
    const key = validatePairFrame(frame.pair)
    if (!key) return { kind: 'stale', reason: 'stale-pair' }
    if (!preparation || preparation.pairKey !== key || remotePreparedKey !== key) {
      if (!commitDecisionKey) await protocolFailure()
      return { kind: 'ignored', reason: 'terminal' }
    }
    const duplicate = commitDecisionKey === key && commitResult !== undefined
    commitDecisionKey = key
    await commitLocally()
    await send({ ...envelope(), kind: 'commit-ack', pair: frame.pair })
    completed = true
    return { kind: duplicate ? 'duplicate' : 'applied' }
  }

  const receiveCommitAck = async (
    frame: Extract<HgssP2pTradeFrame, { kind: 'commit-ack' }>,
  ): Promise<HgssP2pTradeReceiveDecision> => {
    if (authorityId !== localParticipantId || !commitDecisionKey) return { kind: 'ignored', reason: 'unexpected-sender' }
    if (getHgssP2pTradeOfferPairKey(frame.pair) !== commitDecisionKey) return { kind: 'stale', reason: 'stale-pair' }
    if (peerCommitAcknowledged) return { kind: 'duplicate' }
    peerCommitAcknowledged = true
    completed = true
    return { kind: 'applied' }
  }

  const offer = (pokemon: HgssP2pTradePokemonSnapshot): Promise<void> => enqueue(async () => {
    if (isTerminal() || commitDecisionKey) throw new Error("La transaction d'échange P2P est déjà terminale.")
    const parsed = parseHgssP2pTradePokemonSnapshot(pokemon)
    if (!parsed) throw new TypeError("Le Pokémon proposé à l'échange P2P est invalide.")
    if (parsed.instanceId === remoteOffer?.pokemon.instanceId) throw new Error("La même instance ne peut pas être proposée des deux côtés.")
    await invalidateAgreement('offer-changed')
    localRevision += 1
    localOffer = { revision: localRevision, pokemon: parsed }
    touch()
    await send({ ...envelope(), kind: 'offer', revision: localRevision, pokemon: parsed })
  })

  const withdrawOffer = (): Promise<void> => enqueue(async () => {
    if (isTerminal() || commitDecisionKey) throw new Error("La transaction d'échange P2P est déjà terminale.")
    await invalidateAgreement('offer-changed')
    localRevision += 1
    localOffer = undefined
    touch()
    await send({ ...envelope(), kind: 'offer', revision: localRevision, pokemon: null })
  })

  const accept = (): Promise<void> => enqueue(async () => {
    if (isTerminal() || commitDecisionKey) throw new Error("La transaction d'échange P2P est déjà terminale.")
    const currentPair = pair()
    if (!currentPair) throw new Error("Les deux offres exactes sont requises avant l'acceptation.")
    const key = getHgssP2pTradeOfferPairKey(currentPair)
    if (localAcceptanceKey === key) return
    localAcceptanceKey = key
    touch()
    await send({ ...envelope(), kind: 'accept', pair: currentPair })
    await maybePrepare()
  })

  const cancel = (
    reason: Extract<HgssP2pTradeCancelReason, 'user' | 'offer-withdrawn'> = 'user',
  ): Promise<boolean> => enqueue(async () => {
    touch()
    return cancelInternal(reason, 'cancelled', true)
  })

  const receive = (value: unknown): Promise<HgssP2pTradeReceiveDecision> => enqueue(async () => {
    const frame = parseHgssP2pTradeFrame(value)
    if (!frame) return { kind: 'ignored', reason: 'invalid-frame' }
    if (frame.sessionId !== sessionId || frame.transactionId !== transactionId) {
      return { kind: 'ignored', reason: 'foreign-transaction' }
    }
    if (frame.senderId !== remoteParticipantId) return { kind: 'ignored', reason: 'unexpected-sender' }
    touch()
    switch (frame.kind) {
      case 'offer': return receiveOffer(frame)
      case 'accept': return receiveAccepted(frame)
      case 'prepared': return receivePrepared(frame)
      case 'commit': return receiveCommit(frame)
      case 'commit-ack': return receiveCommitAck(frame)
      case 'cancel': {
        if (commitDecisionKey || completed) return { kind: 'ignored', reason: 'terminal' }
        if (cancelReason) return { kind: 'duplicate' }
        cancelReason = frame.reason
        await rollback(frame.reason === 'timeout' ? 'timeout' : frame.reason === 'disconnect' ? 'disconnect' : 'cancelled')
        return { kind: 'applied' }
      }
    }
  })

  const tick = (at = now()): Promise<boolean> => enqueue(async () => {
    const current = validTime(at, "L'horodatage d'expiration")
    if (completed || cancelReason || current - lastActivityAt < options.timeoutMs) return false
    if (commitDecisionKey) return false
    await cancelInternal('timeout', 'timeout', true)
    return true
  })

  const disconnect = (): Promise<void> => enqueue(async () => {
    touch()
    if (completed || cancelReason || commitDecisionKey) return
    cancelReason = 'disconnect'
    await rollback('disconnect')
  })

  const resume = (): Promise<void> => enqueue(async () => {
    touch()
    if (cancelReason) {
      if (preparation) await rollback(cancelReason === 'disconnect' ? 'disconnect' : 'cancelled')
      return
    }
    if (completed) {
      if (authorityId !== localParticipantId && commitDecisionKey) {
        const currentPair = pair()
        if (currentPair) await send({ ...envelope(), kind: 'commit-ack', pair: currentPair })
      }
      return
    }
    if (commitDecisionKey) {
      if (authorityId === localParticipantId) await sendCommitAsAuthority()
      else {
        await commitLocally()
        const currentPair = pair()
        if (!currentPair) throw new Error("La paire de reprise de l'échange P2P est absente.")
        await send({ ...envelope(), kind: 'commit-ack', pair: currentPair })
        completed = true
      }
      return
    }
    if (localRevision > 0) {
      await send({ ...envelope(), kind: 'offer', revision: localRevision, pokemon: localOffer?.pokemon ?? null })
    }
    const currentPair = pair()
    const key = currentPair && getHgssP2pTradeOfferPairKey(currentPair)
    if (currentPair && localAcceptanceKey === key) await send({ ...envelope(), kind: 'accept', pair: currentPair })
    if (currentPair && preparation?.pairKey === key) await send({ ...envelope(), kind: 'prepared', pair: currentPair })
  })

  const getSnapshot = (): HgssP2pTradeCoordinatorSnapshot => {
    const currentPair = pair()
    const key = currentPair && getHgssP2pTradeOfferPairKey(currentPair)
    return freezeDeep({
      status: status(),
      authorityId,
      ...(localOffer ? { localOffer: { revision: localOffer.revision, preview: projectHgssP2pTradeOfferPreview(localOffer.pokemon) } } : {}),
      ...(remoteOffer ? { remoteOffer: { revision: remoteOffer.revision, preview: projectHgssP2pTradeOfferPreview(remoteOffer.pokemon) } } : {}),
      ...(currentPair ? { pair: currentPair } : {}),
      localAccepted: Boolean(key && localAcceptanceKey === key),
      remoteAccepted: Boolean(key && remoteAcceptanceKey === key),
      localPrepared: Boolean(key && preparation?.pairKey === key),
      remotePrepared: Boolean(key && remotePreparedKey === key),
      ...(commitResult ? { commitResult } : {}),
      ...(cancelReason ? { cancelReason } : {}),
      needsRecovery: Boolean(commitDecisionKey && !completed || cancelReason && preparation),
    })
  }

  return Object.freeze({ offer, withdrawOffer, accept, cancel, receive, tick, disconnect, resume, getSnapshot })
}
