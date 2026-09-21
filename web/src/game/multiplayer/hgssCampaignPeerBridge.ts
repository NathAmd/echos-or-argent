import {
  measurePeerDataMessageBytes,
  PeerDataChannelError,
  type PeerDataChannel,
} from '../../online/peerDataChannel'
import {
  consumeIssuedPeerDataChannelMultiplexerBinding,
  type PeerDataChannelMultiplexerChannelBinding,
} from '../../online/peerDataChannelMultiplexer'
import { isOnlineNegotiationId, isOnlineUserId } from '../../online/onlineServiceProtocol'
import {
  consumeIssuedRtcPeerConnectionLink,
  type RtcPeerConnectionLink,
} from '../../online/rtcPeerConnectionSession'
import type {
  HgssCampaignClientTransport,
  HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import type { HgssCampaignClientCommand, HgssCampaignServerSnapshot } from './hgssCampaignProtocol'
import {
  createHgssCampaignPeerEnvelope,
  decodeHgssCampaignPeerFrame,
  encodeHgssCampaignPeerFrame,
  type HgssCampaignPeerRequest,
  type HgssCampaignPeerResponse,
} from './hgssCampaignPeerProtocol'
import type { HgssCampaignServerCore } from './hgssCampaignServerCore'

/** Alias de vocabulaire : cette autorité existe uniquement chez le pair hôte. */
export type PeerAuthority = HgssCampaignServerCore
export type HgssCampaignPeerAuthority = PeerAuthority

/**
 * Association autorisée entre une identité de rendez-vous WebRTC et un joueur
 * de campagne. Le pont hôte n'accepte pas les quatre valeurs séparément : cela
 * empêche de réutiliser par erreur le canal authentifié d'un ami pour piloter
 * le joueur attribué à un autre ami.
 */
export type HgssCampaignPeerHostBinding = Readonly<{
  channel: PeerDataChannel
  peerId: string
  negotiationId: string
  sessionId: string
  playerId: string
}>

export type HgssCampaignPeerHostBindingInput = Readonly<{
  link: RtcPeerConnectionLink
  sessionId: string
  playerId: string
}>

/**
 * Route déjà dérivée du lien RTC consommé par le multiplexeur officiel.
 * Le constructeur ci-dessous la marque afin qu'une simple copie structurelle
 * ne puisse jamais être remise au pont autoritaire.
 */
export type HgssCampaignPeerLogicalHostBindingInput = Readonly<{
  route: PeerDataChannelMultiplexerChannelBinding
  peerId: string
  negotiationId: string
  sessionId: string
  playerId: string
}>

export type HgssCampaignPeerHostBridgeOptions = Readonly<{
  binding: HgssCampaignPeerHostBinding
  authority: PeerAuthority
  responseCacheLimit?: number
  maximumPendingResponseBytes?: number
  onError?: (error: Error) => void
  onClose?: (reason: 'local' | 'remote' | 'error') => void
  /** Premier requestSnapshot validé : l'invité a réellement branché sa gateway. */
  onGuestReady?: () => void
}>

export type HgssCampaignPeerHostBridge = Readonly<{
  close: () => void
  isClosed: () => boolean
}>

export type HgssCampaignPeerGuestTransportOptions = Readonly<{
  channel: PeerDataChannel
  requestTimeoutMs?: number
  connectTimeoutMs?: number
  maximumPendingRequests?: number
  maximumTimedOutRequestTombstones?: number
  requestIdFactory?: (serial: number) => string
}>

export class HgssCampaignPeerTransportError extends Error {
  readonly code: string
  readonly remote: boolean
  readonly requestId?: string

  constructor(code: string, message: string, options: Readonly<{ remote?: boolean, requestId?: string }> = {}) {
    super(message)
    this.name = 'HgssCampaignPeerTransportError'
    this.code = code
    this.remote = options.remote ?? false
    this.requestId = options.requestId
  }
}

type PendingPeerRequest = {
  readonly operation: 'command' | 'snapshot' | 'ready'
  readonly resolve: (value: unknown) => void
  readonly reject: (error: Error) => void
  readonly timer: ReturnType<typeof setTimeout>
}

const peerEnvelope = createHgssCampaignPeerEnvelope()
const issuedHostBindings = new WeakSet<object>()
const consumedHostBindings = new WeakSet<object>()
let fallbackPeerTransportId = 0

function isCampaignIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
}

function isPeerChannel(value: unknown): value is PeerDataChannel {
  return value !== null
    && typeof value === 'object'
    && typeof Reflect.get(value, 'attach') === 'function'
    && typeof Reflect.get(value, 'send') === 'function'
    && typeof Reflect.get(value, 'close') === 'function'
    && typeof Reflect.get(value, 'getState') === 'function'
}

function issueHostBinding(input: HgssCampaignPeerHostBinding): HgssCampaignPeerHostBinding {
  if (!isPeerChannel(input.channel)) throw new TypeError('Le canal logique de campagne est invalide.')
  if (!isOnlineUserId(input.peerId)) throw new TypeError("L'identifiant du pair de campagne est invalide.")
  if (!isOnlineNegotiationId(input.negotiationId)) {
    throw new TypeError("L'identifiant de négociation de campagne est invalide.")
  }
  if (!isCampaignIdentifier(input.sessionId)) throw new TypeError("L'identifiant de campagne pair-à-pair est invalide.")
  if (!isCampaignIdentifier(input.playerId)) throw new TypeError("L'identifiant de joueur pair-à-pair est invalide.")
  const binding = Object.freeze({ ...input })
  issuedHostBindings.add(binding)
  return binding
}

/**
 * Fige la décision d'autorisation prise par l'hôte après l'acceptation d'une
 * invitation. `peerId` vient exclusivement de la route de signalisation
 * authentifiée ; `playerId` est l'acteur de campagne que l'hôte lui attribue.
 */
export function createHgssCampaignPeerHostBinding(
  input: HgssCampaignPeerHostBindingInput,
): HgssCampaignPeerHostBinding {
  const { link, playerId, sessionId } = input
  if (
    !link
    || (link.role !== 'offerer' && link.role !== 'answerer')
    || !isPeerChannel(link.channel)
    || !isOnlineUserId(link.descriptor?.peerId)
    || !isOnlineNegotiationId(link.descriptor?.negotiationId)
  ) throw new TypeError('Le lien WebRTC à associer à la campagne est invalide.')
  if (!isCampaignIdentifier(sessionId)) throw new TypeError("L'identifiant de campagne pair-à-pair est invalide.")
  if (!isCampaignIdentifier(playerId)) throw new TypeError("L'identifiant de joueur pair-à-pair est invalide.")
  if (!consumeIssuedRtcPeerConnectionLink(link)) {
    throw new TypeError("Le lien WebRTC doit être émis par une session RTC et ne peut être associé qu'une fois.")
  }

  return issueHostBinding({
    channel: link.channel,
    peerId: link.descriptor.peerId,
    negotiationId: link.descriptor.negotiationId,
    sessionId,
    playerId,
  })
}

/**
 * Émet une association pour un canal logique créé après consommation du lien
 * physique par `browserMultiplayerRuntime`. L'appelant doit être ce point de
 * composition attesté; le pont vérifie ensuite la provenance et l'usage unique
 * de l'objet retourné, exactement comme pour l'association RTC historique.
 */
export function createHgssCampaignPeerLogicalHostBinding(
  input: HgssCampaignPeerLogicalHostBindingInput,
): HgssCampaignPeerHostBinding {
  if (!isOnlineUserId(input.peerId)) throw new TypeError("L'identifiant du pair de campagne est invalide.")
  if (!isOnlineNegotiationId(input.negotiationId)) {
    throw new TypeError("L'identifiant de négociation de campagne est invalide.")
  }
  if (!isCampaignIdentifier(input.sessionId)) throw new TypeError("L'identifiant de campagne pair-à-pair est invalide.")
  if (!isCampaignIdentifier(input.playerId)) throw new TypeError("L'identifiant de joueur pair-à-pair est invalide.")
  if (!consumeIssuedPeerDataChannelMultiplexerBinding(input.route, 'campaign')) {
    throw new TypeError("Le canal logique de campagne ne provient pas du multiplexeur actif ou a déjà été associé.")
  }
  return issueHostBinding({
    channel: input.route.channel,
    peerId: input.peerId,
    negotiationId: input.negotiationId,
    sessionId: input.sessionId,
    playerId: input.playerId,
  })
}

function transportId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackPeerTransportId += 1
  return `${Date.now().toString(36)}-${fallbackPeerTransportId.toString(36)}`
}

function boundedInteger(value: number, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${label} doit être un entier compris entre 1 et ${maximum}.`)
  }
  return resolved
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

function peerFailure(code: string, message: string, requestId?: string): HgssCampaignPeerTransportError {
  return new HgssCampaignPeerTransportError(code, message, { requestId })
}

function hasGuest(snapshot: HgssCampaignServerSnapshot, guestPlayerId: string): boolean {
  return snapshot.players.some(({ playerId }) => playerId === guestPlayerId)
}

/**
 * Termine le protocole dans le navigateur hôte. Aucun serveur de rendez-vous
 * n'est consulté et le noyau autoritaire n'est jamais transféré au pair.
 */
export function createHgssCampaignPeerHostBridge(
  options: HgssCampaignPeerHostBridgeOptions,
): HgssCampaignPeerHostBridge {
  if (!issuedHostBindings.has(options.binding) || consumedHostBindings.has(options.binding)) {
    throw new TypeError('Le pont hôte exige une association de pair créée par le module de campagne.')
  }
  const { authority } = options
  const {
    channel,
    playerId: guestPlayerId,
    sessionId,
  } = options.binding
  const responseCacheLimit = boundedInteger(options.responseCacheLimit ?? 256, 256, 1_024, 'La limite du cache de réponses')
  const maximumPendingResponseBytes = boundedInteger(
    options.maximumPendingResponseBytes ?? 2 * 1_024 * 1_024,
    2 * 1_024 * 1_024,
    4 * 1_024 * 1_024,
    'La taille maximale de la file de réponses',
  )
  consumedHostBindings.add(options.binding)
  // Les réponses de commande sont petites et doivent rester idempotentes. Une
  // réponse snapshot peut dépasser 100 Kio : on mémorise seulement son
  // empreinte de requête et on régénère la lecture, sans retenir 256 snapshots.
  const responseCache = new Map<string, Readonly<{
    fingerprint: string
    response?: HgssCampaignPeerResponse
  }>>()
  const pendingResponses: Array<Readonly<{
    message: string
    bytes: number
    onSent?: () => void
  }>> = []
  let pendingResponseBytes = 0
  let unsubscribe: (() => void) | undefined
  let guestSnapshotSent = false
  let guestReadyNotified = false
  let guestReadyPending = false
  let detach: (() => void) | undefined
  let detachBackpressure: (() => void) | undefined
  let pendingSnapshot: string | undefined
  let flushScheduled = false
  let closed = false

  const cleanup = (reason: 'local' | 'remote' | 'error'): void => {
    if (closed) return
    closed = true
    unsubscribe?.()
    unsubscribe = undefined
    detach?.()
    detach = undefined
    detachBackpressure?.()
    detachBackpressure = undefined
    pendingResponses.length = 0
    pendingResponseBytes = 0
    pendingSnapshot = undefined
    responseCache.clear()
    try { options.onClose?.(reason) } catch { /* Le callback ne pilote jamais le transport. */ }
  }
  const fail = (error: unknown): void => {
    if (closed) return
    const failure = asError(error, 'Le pont de campagne pair-à-pair hôte a échoué.')
    try { options.onError?.(failure) } catch { /* Le callback ne doit pas retenir les ressources du pair. */ }
    cleanup('error')
    try { channel.close() } catch { /* Le pont est déjà terminal. */ }
  }
  const trySend = (message: string): boolean => {
    try {
      channel.send(message)
      return true
    } catch (error) {
      if (error instanceof PeerDataChannelError
        && error.code === 'peer-channel-buffer-limit'
        && channel.backpressure) {
        const state = channel.backpressure.getState()
        // Sous le seuil bas, aucun nouvel événement `bufferedamountlow` ne sera
        // émis : un refus à cet instant est donc permanent pour cette trame.
        if (state.writable) fail(error)
        return false
      }
      fail(error)
      return false
    }
  }
  const flushOutbound = (): void => {
    if (closed || channel.getState() !== 'open') return
    while (pendingResponses.length > 0) {
      if (channel.backpressure && !channel.backpressure.getState().writable) return
      const response = pendingResponses[0]!
      if (!trySend(response.message)) return
      pendingResponses.shift()
      pendingResponseBytes -= response.bytes
      try { response.onSent?.() } catch { /* L'observateur ne pilote jamais le pont. */ }
    }
    if (!pendingSnapshot) return
    if (channel.backpressure && !channel.backpressure.getState().writable) return
    const snapshot = pendingSnapshot
    if (trySend(snapshot) && pendingSnapshot === snapshot) pendingSnapshot = undefined
  }
  const scheduleFlush = (): void => {
    if (closed || flushScheduled) return
    flushScheduled = true
    queueMicrotask(() => {
      flushScheduled = false
      flushOutbound()
    })
  }
  const enqueueResponse = (frame: HgssCampaignPeerResponse, onSent?: () => void): void => {
    if (closed) return
    let message: string
    try { message = encodeHgssCampaignPeerFrame(frame) } catch (error) { fail(error); return }
    const bytes = measurePeerDataMessageBytes(message)
    if (pendingResponses.length >= responseCacheLimit
      || pendingResponseBytes > maximumPendingResponseBytes - bytes) {
      fail(peerFailure('peer-outbound-buffer-limit', 'La file de réponses de campagne pair-à-pair est saturée.'))
      return
    }
    pendingResponses.push(Object.freeze({ message, bytes, ...(onSent ? { onSent } : {}) }))
    pendingResponseBytes += bytes
    scheduleFlush()
  }
  const sendSnapshot = (snapshot: HgssCampaignServerSnapshot): void => {
    if (!hasGuest(snapshot, guestPlayerId)) {
      fail(peerFailure('player-not-found', `Le joueur ${guestPlayerId} ne fait plus partie de la campagne.`))
      return
    }
    try {
      // Un déplacement rapide peut produire plusieurs révisions avant que
      // Safari draine SCTP : seule la plus récente doit encore être envoyée.
      pendingSnapshot = encodeHgssCampaignPeerFrame({ ...peerEnvelope, kind: 'snapshot', snapshot })
    } catch (error) { fail(error); return }
    scheduleFlush()
  }
  const readGuestSnapshot = (): HgssCampaignServerSnapshot | HgssCampaignPeerResponse => {
    const snapshot = authority.getSnapshot(sessionId)
    if (!snapshot) return {
      ...peerEnvelope, kind: 'response', requestId: 'unbound', operation: 'snapshot', ok: false,
      error: { code: 'session-not-found', message: `La session de campagne ${sessionId} n'existe pas.` },
    }
    if (!hasGuest(snapshot, guestPlayerId)) return {
      ...peerEnvelope, kind: 'response', requestId: 'unbound', operation: 'snapshot', ok: false,
      error: { code: 'player-not-found', message: `Le joueur ${guestPlayerId} ne fait pas partie de la campagne.` },
    }
    return snapshot
  }
  const cacheResponse = (request: HgssCampaignPeerRequest, response: HgssCampaignPeerResponse): void => {
    responseCache.set(request.requestId, {
      fingerprint: JSON.stringify(request),
      ...(request.operation !== 'snapshot' ? { response } : {}),
    })
    if (responseCache.size > responseCacheLimit) responseCache.delete(responseCache.keys().next().value!)
  }
  const handleRequest = (request: HgssCampaignPeerRequest): void => {
    const fingerprint = JSON.stringify(request)
    const cached = responseCache.get(request.requestId)
    if (cached) {
      if (cached.fingerprint !== fingerprint) {
        fail(peerFailure('peer-request-id-conflict', `La requête ${request.requestId} a été réutilisée avec un autre contenu.`))
        return
      }
      if (cached.response) {
        enqueueResponse(cached.response)
        return
      }
    }
    let response: HgssCampaignPeerResponse
    if (request.operation === 'ready') {
      response = guestSnapshotSent
        ? {
          ...peerEnvelope,
          kind: 'response',
          requestId: request.requestId,
          operation: 'ready',
          ok: true,
        }
        : {
          ...peerEnvelope,
          kind: 'response',
          requestId: request.requestId,
          operation: 'ready',
          ok: false,
          error: {
            code: 'ready-before-snapshot',
            message: "L'invité doit appliquer un snapshot autoritaire avant de confirmer ready.",
          },
        }
    } else if (request.operation === 'snapshot') {
      const snapshot = readGuestSnapshot()
      response = 'kind' in snapshot
        ? { ...snapshot, requestId: request.requestId }
        : { ...peerEnvelope, kind: 'response', requestId: request.requestId, operation: 'snapshot', ok: true, snapshot }
    } else {
      const result = authority.submitCommand(sessionId, guestPlayerId, request.command)
      response = result.ok
        ? {
          ...peerEnvelope,
          kind: 'response',
          requestId: request.requestId,
          operation: 'command',
          ok: true,
          appliedRevision: result.appliedRevision,
          replayed: result.kind === 'replayed',
          snapshot: result.snapshot,
        }
        : { ...peerEnvelope, kind: 'response', requestId: request.requestId, operation: 'command', ok: false,
            error: { code: result.error.code, message: result.error.message } }
    }
    cacheResponse(request, response)
    const confirmsGuestReady = request.operation === 'ready'
      && response.ok
      && !guestReadyNotified
      && !guestReadyPending
    if (confirmsGuestReady) guestReadyPending = true
    const confirmsSnapshotDelivery = request.operation === 'snapshot' && response.ok
    enqueueResponse(response, confirmsGuestReady || confirmsSnapshotDelivery ? () => {
      if (confirmsSnapshotDelivery) guestSnapshotSent = true
      if (!confirmsGuestReady) return
      guestReadyPending = false
      if (guestReadyNotified || closed) return
      guestReadyNotified = true
      try { options.onGuestReady?.() } catch { /* L'observateur ne pilote jamais le pont. */ }
    } : undefined)
  }
  const start = (): void => {
    if (closed || unsubscribe) return
    const subscription = authority.subscribe(sessionId, sendSnapshot)
    if (!subscription.ok) { fail(peerFailure(subscription.error.code, subscription.error.message)); return }
    if (closed) { subscription.unsubscribe(); return }
    if (!hasGuest(subscription.snapshot, guestPlayerId)) {
      subscription.unsubscribe()
      fail(peerFailure('player-not-found', `Le joueur ${guestPlayerId} ne fait pas partie de la campagne.`))
      return
    }
    unsubscribe = subscription.unsubscribe
  }

  const attached = channel.attach({
    onOpen: start,
    onMessage(message) {
      const frame = decodeHgssCampaignPeerFrame(message)
      if (!frame || frame.kind !== 'request') {
        fail(peerFailure('peer-protocol-error', 'Le pair invité a envoyé une trame de campagne invalide.'))
        return
      }
      handleRequest(frame)
    },
    onClose: () => { cleanup('remote') },
    onError: fail,
  })
  if (closed) attached()
  else detach = attached
  if (!closed && channel.backpressure) {
    try {
      const backpressureSubscription = channel.backpressure.subscribe((state) => {
        if (state.writable) scheduleFlush()
      })
      if (closed) backpressureSubscription()
      else detachBackpressure = backpressureSubscription
    } catch (error) { fail(error) }
  }

  return Object.freeze({
    close() { cleanup('local'); channel.close() },
    isClosed: () => closed,
  })
}

/** Expose au pair invité uniquement le transport attendu par la passerelle cliente. */
export function createHgssCampaignPeerGuestTransport(
  options: HgssCampaignPeerGuestTransportOptions,
): HgssCampaignClientTransport {
  const { channel } = options
  const requestTimeoutMs = boundedInteger(options.requestTimeoutMs ?? 5_000, 5_000, 120_000, 'Le délai d’une requête pair-à-pair')
  const connectTimeoutMs = boundedInteger(options.connectTimeoutMs ?? 10_000, 10_000, 120_000, 'Le délai de connexion pair-à-pair')
  const maximumPendingRequests = boundedInteger(options.maximumPendingRequests ?? 32, 32, 256, 'La limite des requêtes pair-à-pair')
  const maximumTimedOutRequestTombstones = boundedInteger(
    options.maximumTimedOutRequestTombstones ?? 256,
    256,
    1_024,
    'La limite des réponses tardives mémorisées',
  )
  const idPrefix = transportId()
  const requestIdFactory = options.requestIdFactory ?? ((serial: number) => `campaign-peer:${idPrefix}:${serial}`)
  const pending = new Map<string, PendingPeerRequest>()
  const recentRequestIds = new Set<string>()
  const recentRequestIdOrder: string[] = []
  const timedOutRequests = new Map<string, PendingPeerRequest['operation']>()
  let handlers: HgssCampaignClientTransportHandlers | undefined
  let detach: (() => void) | undefined
  let connectPromise: Promise<void> | undefined
  let resolveConnect: (() => void) | undefined
  let rejectConnect: ((error: Error) => void) | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let requestSerial = 0
  let connected = false
  let terminal = false
  let failed = false

  const rememberRequestId = (requestId: string): void => {
    if (recentRequestIds.has(requestId) || timedOutRequests.has(requestId)) {
      throw peerFailure('peer-request-id-conflict', `L'identifiant ${requestId} a déjà été utilisé.`)
    }
    recentRequestIds.add(requestId)
    recentRequestIdOrder.push(requestId)
    if (recentRequestIdOrder.length > 256) recentRequestIds.delete(recentRequestIdOrder.shift()!)
  }
  const rememberTimedOutRequest = (requestId: string, operation: PendingPeerRequest['operation']): void => {
    timedOutRequests.set(requestId, operation)
    if (timedOutRequests.size > maximumTimedOutRequestTombstones) {
      timedOutRequests.delete(timedOutRequests.keys().next().value!)
    }
  }
  const clearConnect = (): void => {
    if (connectTimer !== undefined) clearTimeout(connectTimer)
    connectTimer = undefined
    resolveConnect = undefined
    rejectConnect = undefined
    connectPromise = undefined
  }
  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
    timedOutRequests.clear()
    recentRequestIds.clear()
    recentRequestIdOrder.length = 0
  }
  const fatal = (error: unknown): void => {
    if (terminal || failed) return
    failed = true
    const failure = asError(error, 'Le transport de campagne pair-à-pair a échoué.')
    rejectConnect?.(failure)
    rejectPending(failure)
    try { handlers?.onError(failure) } catch { /* Le callback ne doit pas interrompre le nettoyage. */ }
    clearConnect()
    detach?.()
    detach = undefined
    try { channel.close() } catch { /* Le transport est déjà terminal. */ }
  }
  const closeFromPeer = (): void => {
    if (terminal) return
    terminal = true
    connected = false
    const failure = peerFailure('peer-closed', 'Le pair hôte a fermé le canal de campagne.')
    rejectConnect?.(failure)
    rejectPending(failure)
    const notify = handlers
    clearConnect()
    detach?.()
    detach = undefined
    handlers = undefined
    if (!failed) {
      try { notify?.onDisconnect() } catch { /* La fermeture distante reste terminale. */ }
    }
  }
  const receive = (message: string): void => {
    const frame = decodeHgssCampaignPeerFrame(message)
    if (!frame || frame.kind === 'request') {
      fatal(peerFailure('peer-protocol-error', 'Le pair hôte a envoyé une trame de campagne invalide.'))
      return
    }
    if (frame.kind === 'snapshot') {
      try { handlers?.onSnapshot(frame.snapshot) } catch (error) { fatal(error) }
      return
    }
    const request = pending.get(frame.requestId)
    if (!request) {
      const timedOutOperation = timedOutRequests.get(frame.requestId)
      if (timedOutOperation === frame.operation) return
      fatal(peerFailure('peer-protocol-error', `La réponse ${frame.requestId} ne correspond à aucune requête active.`))
      return
    }
    if (request.operation !== frame.operation) {
      fatal(peerFailure('peer-protocol-error', `La réponse ${frame.requestId} ne correspond à aucune requête active.`))
      return
    }
    pending.delete(frame.requestId)
    clearTimeout(request.timer)
    if (!frame.ok) {
      request.reject(new HgssCampaignPeerTransportError(frame.error.code, frame.error.message, {
        remote: true,
        requestId: frame.requestId,
      }))
    } else if (frame.operation === 'snapshot') request.resolve(frame.snapshot)
    else if (frame.operation === 'command') request.resolve(Object.freeze({
      appliedRevision: frame.appliedRevision,
      replayed: frame.replayed,
      snapshot: frame.snapshot,
    }))
    else request.resolve(undefined)
  }
  const sendRequest = (
    operation: 'command' | 'snapshot' | 'ready',
    command?: HgssCampaignClientCommand,
  ): Promise<unknown> => {
    if (!connected || terminal || failed || channel.getState() !== 'open') {
      return Promise.reject(peerFailure('peer-not-connected', "Le transport de campagne pair-à-pair n'est pas connecté."))
    }
    if (pending.size >= maximumPendingRequests) {
      return Promise.reject(peerFailure('peer-pending-limit', 'Trop de requêtes de campagne pair-à-pair sont en attente.'))
    }
    if (requestSerial === Number.MAX_SAFE_INTEGER) {
      return Promise.reject(peerFailure('peer-request-id-exhausted', 'Les identifiants de requête pair-à-pair sont épuisés.'))
    }
    requestSerial += 1
    let requestId: string
    let serialized: string
    try {
      requestId = requestIdFactory(requestSerial)
      rememberRequestId(requestId)
      const frame: HgssCampaignPeerRequest = operation === 'command'
        ? { ...peerEnvelope, kind: 'request', requestId, operation, command: command! }
        : { ...peerEnvelope, kind: 'request', requestId, operation }
      serialized = encodeHgssCampaignPeerFrame(frame)
    } catch (error) {
      return Promise.reject(asError(error, "L'identifiant de requête pair-à-pair est invalide."))
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (!pending.delete(requestId)) return
        rememberTimedOutRequest(requestId, operation)
        reject(peerFailure('peer-request-timeout', `La requête ${requestId} a expiré.`, requestId))
      }, requestTimeoutMs)
      pending.set(requestId, { operation, resolve, reject, timer })
      try { channel.send(serialized) } catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(asError(error, "L'envoi de la requête pair-à-pair a échoué."))
      }
    })
  }

  return Object.freeze({
    transportKind: 'rtc-data-channel' as const,
    connect(nextHandlers) {
      if (connected) return
      if (connectPromise) return connectPromise
      if (handlers || terminal || failed) {
        throw peerFailure('peer-already-connected', 'Le transport de campagne pair-à-pair ne peut pas être reconnecté.')
      }
      handlers = nextHandlers
      connectPromise = new Promise<void>((resolve, reject) => {
        resolveConnect = resolve
        rejectConnect = reject
        connectTimer = setTimeout(() => fatal(peerFailure('peer-connect-timeout', 'Le canal de campagne pair-à-pair ne s’est pas ouvert à temps.')), connectTimeoutMs)
        try {
          const attached = channel.attach({
            onOpen() {
              if (terminal || failed || connected) return
              connected = true
              const complete = resolveConnect
              clearConnect()
              complete?.()
            },
            onMessage: receive,
            onClose: closeFromPeer,
            onError: fatal,
          })
          if (terminal || failed) attached()
          else detach = attached
        } catch (error) { fatal(error) }
      })
      return connectPromise
    },
    disconnect() {
      if (terminal) return
      terminal = true
      connected = false
      const failure = peerFailure('peer-closed', 'Le transport de campagne pair-à-pair a été fermé.')
      rejectConnect?.(failure)
      rejectPending(failure)
      clearConnect()
      detach?.()
      detach = undefined
      handlers = undefined
      channel.close()
    },
    send(command) { return sendRequest('command', command) },
    requestSnapshot() { return sendRequest('snapshot') },
    confirmReady() { return sendRequest('ready').then(() => undefined) },
  })
}
