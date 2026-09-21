import type { OnlineSignalingClient, OnlineSignalingState } from './onlineSignalingClient'
import {
  generateOnlineOpaqueId,
  isOnlineNegotiationId,
  isOnlineOpaqueId,
  isOnlineUserId,
  parseOnlineSignalPayload,
  type OnlineRealtimeEvent,
  type OnlineSignalPayload,
} from './onlineServiceProtocol'

export type RtcSignalingRouteDescriptor = Readonly<{
  peerId: string
  negotiationId: string
}>

export type RtcSignalingRouteRole = 'offerer' | 'answerer'

export type RtcSignalingInvitation = Readonly<{
  descriptor: RtcSignalingRouteDescriptor
  receivedAt: number
  expiresAt: number
}>

export type RtcSignalingInboundSignal = Readonly<{
  requestId: string
  payload: OnlineSignalPayload
}>

export type RtcSignalingRoute = Readonly<{
  descriptor: RtcSignalingRouteDescriptor
  role: RtcSignalingRouteRole
  getState: () => OnlineSignalingState
  send: (payload: OnlineSignalPayload) => Promise<string>
  subscribe: (listener: (signal: RtcSignalingInboundSignal) => void) => () => void
  subscribeState: (listener: (state: OnlineSignalingState) => void) => () => void
  close: () => void
}>

export type RtcSignalingCoordinatorOptions = Readonly<{
  signaling: OnlineSignalingClient
  invitationTtlMs?: number
  acknowledgementTimeoutMs?: number
  maximumBufferedNegotiations?: number
  maximumInvitations?: number
  maximumIceCandidatesPerNegotiation?: number
  maximumBufferedIceCandidates?: number
  maximumActiveRoutes?: number
  maximumBufferedSignalsPerRoute?: number
  maximumPendingRequests?: number
  maximumRememberedRequestIds?: number
  maximumReplayTombstones?: number
  requestIdFactory?: (serial: number) => string
  negotiationIdFactory?: (serial: number) => string
}>

export type RtcSignalingCoordinator = Readonly<{
  getInvitations: () => readonly RtcSignalingInvitation[]
  subscribeInvitations: (listener: (invitations: readonly RtcSignalingInvitation[]) => void) => () => void
  createOutboundRoute: (peerId: string, negotiationId?: string) => RtcSignalingRoute
  claimInvitation: (invitation: RtcSignalingInvitation) => RtcSignalingRoute
  declineInvitation: (invitation: RtcSignalingInvitation) => Promise<void>
  close: () => void
}>

export type RtcSignalingCoordinatorErrorCode =
  | 'rtc-coordinator-closed'
  | 'rtc-invitation-not-found'
  | 'rtc-invitation-consumed'
  | 'rtc-route-conflict'
  | 'rtc-route-closed'
  | 'rtc-route-already-subscribed'
  | 'rtc-capacity-exceeded'
  | 'rtc-acknowledgement-timeout'
  | 'rtc-signaling-rejected'
  | 'rtc-request-id-conflict'

export class RtcSignalingCoordinatorError extends Error {
  readonly code: RtcSignalingCoordinatorErrorCode
  readonly requestId?: string

  constructor(
    code: RtcSignalingCoordinatorErrorCode,
    message: string,
    options: Readonly<{ requestId?: string }> = {},
  ) {
    super(message)
    this.name = 'RtcSignalingCoordinatorError'
    this.code = code
    this.requestId = options.requestId
  }
}

const issuedRtcSignalingRoutes = new WeakSet<object>()

/** Vérifie la provenance sans exposer la marque privée portée par le module. */
export function isIssuedRtcSignalingRoute(value: unknown): value is RtcSignalingRoute {
  return value !== null && typeof value === 'object' && issuedRtcSignalingRoutes.has(value)
}

type BufferedNegotiation = {
  readonly descriptor: RtcSignalingRouteDescriptor
  readonly createdAt: number
  readonly expiresAt: number
  readonly signals: RtcSignalingInboundSignal[]
  invitation?: RtcSignalingInvitation
  iceCount: number
}

type RouteRecord = {
  readonly descriptor: RtcSignalingRouteDescriptor
  readonly role: RtcSignalingRouteRole
  readonly key: string
  readonly bufferedSignals: RtcSignalingInboundSignal[]
  signalListener?: (signal: RtcSignalingInboundSignal) => void
  stateListener?: (state: OnlineSignalingState) => void
  signalSubscriptionUsed: boolean
  stateSubscriptionUsed: boolean
  closed: boolean
  closeError?: Error
}

type PendingRequest = {
  readonly owner?: RouteRecord
  readonly expiresAt: number
  readonly resolve: (requestId: string) => void
  readonly reject: (error: Error) => void
}

const defaultInvitationTtlMs = 30_000
const defaultAcknowledgementTimeoutMs = 10_000

function coordinatorError(
  code: RtcSignalingCoordinatorErrorCode,
  message: string,
  requestId?: string,
): RtcSignalingCoordinatorError {
  return new RtcSignalingCoordinatorError(code, message, { ...(requestId ? { requestId } : {}) })
}

function positiveBound(value: number, fallback: number, maximum: number, label: string): number {
  const resolved = value ?? fallback
  if (!Number.isSafeInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new RangeError(`${label} doit etre un entier compris entre 1 et ${maximum}.`)
  }
  return resolved
}

function routeDescriptor(peerId: string, negotiationId: string): RtcSignalingRouteDescriptor {
  if (!isOnlineUserId(peerId)) throw new TypeError("L'identifiant du pair WebRTC est invalide.")
  if (!isOnlineNegotiationId(negotiationId)) throw new TypeError("L'identifiant de negociation WebRTC est invalide.")
  return Object.freeze({ peerId, negotiationId })
}

function routeKey(descriptor: RtcSignalingRouteDescriptor): string {
  return `${descriptor.peerId}\u0000${descriptor.negotiationId}`
}

function inboundRequestKey(peerId: string, requestId: string): string {
  return `${peerId}\u0000${requestId}`
}

function defaultOpaqueId(): string { return generateOnlineOpaqueId() }

function safeObserverCall<T>(listener: ((value: T) => void) | undefined, value: T): void {
  try { listener?.(value) } catch { /* Un observateur ne pilote jamais le routage. */ }
}

/**
 * Point d'entree unique et long-vivant pour la signalisation RTC d'un client.
 * Il doit etre cree juste apres OnlineSignalingClient, avant toute invitation.
 */
export function createRtcSignalingCoordinator(
  options: RtcSignalingCoordinatorOptions,
): RtcSignalingCoordinator {
  const invitationTtlMs = positiveBound(
    options.invitationTtlMs ?? defaultInvitationTtlMs,
    defaultInvitationTtlMs,
    5 * 60_000,
    "Le TTL d'une invitation RTC",
  )
  const acknowledgementTimeoutMs = positiveBound(
    options.acknowledgementTimeoutMs ?? defaultAcknowledgementTimeoutMs,
    defaultAcknowledgementTimeoutMs,
    60_000,
    "Le delai d'accuse de signalisation",
  )
  const maximumBufferedNegotiations = positiveBound(
    options.maximumBufferedNegotiations ?? 64, 64, 512, 'La limite des negociations RTC en attente',
  )
  const maximumInvitations = positiveBound(
    options.maximumInvitations ?? 32, 32, 256, 'La limite des invitations RTC',
  )
  const maximumIceCandidatesPerNegotiation = positiveBound(
    options.maximumIceCandidatesPerNegotiation ?? 64, 64, 512, 'La limite ICE par negociation RTC',
  )
  const maximumBufferedIceCandidates = positiveBound(
    options.maximumBufferedIceCandidates ?? 256, 256, 2_048, 'La limite ICE globale',
  )
  const maximumActiveRoutes = positiveBound(
    options.maximumActiveRoutes ?? 32, 32, 256, 'La limite des routes RTC actives',
  )
  const maximumBufferedSignalsPerRoute = positiveBound(
    options.maximumBufferedSignalsPerRoute ?? 128, 128, 1_024, 'La limite des signaux par route RTC',
  )
  const maximumPendingRequests = positiveBound(
    options.maximumPendingRequests ?? 256, 256, 1_024, 'La limite des requetes de signalisation actives',
  )
  const maximumRememberedRequestIds = positiveBound(
    options.maximumRememberedRequestIds ?? 2_048, 2_048, 8_192, 'La limite des identifiants RTC memorises',
  )
  const maximumReplayTombstones = positiveBound(
    options.maximumReplayTombstones ?? 256, 256, 2_048, 'La limite des anti-rejeux RTC',
  )
  if (maximumInvitations > maximumBufferedNegotiations) {
    throw new RangeError("La limite d'invitations RTC ne peut pas depasser celle des negociations en attente.")
  }
  if (maximumPendingRequests > maximumRememberedRequestIds) {
    throw new RangeError('La memoire des identifiants RTC doit couvrir toutes les requetes actives.')
  }

  const bufferedNegotiations = new Map<string, BufferedNegotiation>()
  const activeRoutes = new Map<string, RouteRecord>()
  const replayTombstones = new Map<string, number>()
  const inboundRequestIds = new Map<string, number>()
  const outgoingRequestIds = new Map<string, number>()
  const pendingRequests = new Map<string, PendingRequest>()
  const invitationListeners = new Set<(invitations: readonly RtcSignalingInvitation[]) => void>()
  let signalingState = options.signaling.getState()
  let totalBufferedIceCandidates = 0
  let requestSerial = 0
  let negotiationSerial = 0
  let replayBarrierUntil: number | undefined
  let expirationTimer: ReturnType<typeof setTimeout> | undefined
  let detachEvents: (() => void) | undefined
  let detachState: (() => void) | undefined
  let closed = false

  const invitationSnapshot = (): readonly RtcSignalingInvitation[] => Object.freeze(
    [...bufferedNegotiations.values()]
      .flatMap((entry) => entry.invitation ? [entry.invitation] : [])
      .sort((left, right) => left.receivedAt - right.receivedAt),
  )
  const publishInvitations = (): void => {
    const snapshot = invitationSnapshot()
    for (const listener of invitationListeners) safeObserverCall(listener, snapshot)
  }
  const removeBuffered = (key: string): BufferedNegotiation | undefined => {
    const entry = bufferedNegotiations.get(key)
    if (!entry) return undefined
    bufferedNegotiations.delete(key)
    totalBufferedIceCandidates -= entry.iceCount
    return entry
  }
  const addTombstone = (key: string, now = Date.now()): void => {
    if (replayTombstones.has(key)) return
    if (replayTombstones.size >= maximumReplayTombstones) {
      replayBarrierUntil = Math.max(replayBarrierUntil ?? 0, now + invitationTtlMs)
      return
    }
    replayTombstones.set(key, now + invitationTtlMs)
  }
  const rejectPendingForRoute = (route: RouteRecord, error: Error): void => {
    for (const [requestId, request] of pendingRequests) {
      if (request.owner !== route) continue
      pendingRequests.delete(requestId)
      request.reject(error)
    }
  }
  const closeRoute = (route: RouteRecord, error?: Error): void => {
    if (route.closed) return
    route.closed = true
    route.closeError = error
    activeRoutes.delete(route.key)
    route.bufferedSignals.length = 0
    route.signalListener = undefined
    rejectPendingForRoute(route, error ?? coordinatorError('rtc-route-closed', 'La route de signalisation RTC est fermee.'))
    safeObserverCall(route.stateListener, Object.freeze({ status: 'closed', ...(error ? { error } : {}) }))
    route.stateListener = undefined
    addTombstone(route.key)
  }
  const sweepExpired = (): void => {
    if (closed) return
    const now = Date.now()
    let invitationsChanged = false
    for (const [key, entry] of bufferedNegotiations) {
      if (entry.expiresAt > now) continue
      if (entry.invitation) invitationsChanged = true
      removeBuffered(key)
      addTombstone(key, now)
    }
    for (const [key, expiry] of replayTombstones) if (expiry <= now) replayTombstones.delete(key)
    if (replayBarrierUntil !== undefined && replayBarrierUntil <= now) replayBarrierUntil = undefined
    for (const [key, expiry] of inboundRequestIds) if (expiry <= now) inboundRequestIds.delete(key)
    for (const [requestId, expiry] of outgoingRequestIds) if (expiry <= now) outgoingRequestIds.delete(requestId)
    for (const [requestId, request] of pendingRequests) {
      if (request.expiresAt > now) continue
      pendingRequests.delete(requestId)
      request.reject(coordinatorError(
        'rtc-acknowledgement-timeout',
        `Le service de signalisation n'a pas accuse la requete ${requestId}.`,
        requestId,
      ))
    }
    if (invitationsChanged) publishInvitations()
  }
  const nextExpiry = (): number | undefined => {
    let result = Number.POSITIVE_INFINITY
    const include = (expiry: number): void => { if (expiry < result) result = expiry }
    for (const entry of bufferedNegotiations.values()) include(entry.expiresAt)
    for (const expiry of replayTombstones.values()) include(expiry)
    if (replayBarrierUntil !== undefined) include(replayBarrierUntil)
    for (const expiry of inboundRequestIds.values()) include(expiry)
    for (const expiry of outgoingRequestIds.values()) include(expiry)
    for (const request of pendingRequests.values()) include(request.expiresAt)
    return Number.isFinite(result) ? result : undefined
  }
  const scheduleExpiration = (): void => {
    if (expirationTimer !== undefined) clearTimeout(expirationTimer)
    expirationTimer = undefined
    if (closed) return
    const expiry = nextExpiry()
    if (expiry === undefined) return
    expirationTimer = setTimeout(() => {
      expirationTimer = undefined
      sweepExpired()
      scheduleExpiration()
    }, Math.max(0, expiry - Date.now()))
  }
  const rememberInbound = (peerId: string, requestId: string): boolean => {
    sweepExpired()
    const key = inboundRequestKey(peerId, requestId)
    if (inboundRequestIds.has(key) || inboundRequestIds.size >= maximumRememberedRequestIds) return false
    inboundRequestIds.set(key, Date.now() + invitationTtlMs)
    return true
  }
  const allocateRequestId = (): string => {
    sweepExpired()
    if (outgoingRequestIds.size >= maximumRememberedRequestIds) {
      throw coordinatorError('rtc-capacity-exceeded', "La memoire d'identifiants de signalisation RTC est pleine.")
    }
    requestSerial += 1
    const requestId = (options.requestIdFactory ?? defaultOpaqueId)(requestSerial)
    if (!isOnlineOpaqueId(requestId)) throw new TypeError("L'identifiant opaque de requete RTC genere est invalide.")
    if (outgoingRequestIds.has(requestId)) {
      throw coordinatorError('rtc-request-id-conflict', `L'identifiant RTC ${requestId} a deja ete utilise.`, requestId)
    }
    if (pendingRequests.has(requestId)) {
      throw coordinatorError('rtc-request-id-conflict', `L'identifiant RTC ${requestId} est deja actif.`, requestId)
    }
    outgoingRequestIds.set(requestId, Date.now() + Math.max(invitationTtlMs, acknowledgementTimeoutMs))
    return requestId
  }
  const sendTracked = (
    descriptor: RtcSignalingRouteDescriptor,
    payload: OnlineSignalPayload,
    owner?: RouteRecord,
  ): Promise<string> => {
    if (closed) return Promise.reject(coordinatorError('rtc-coordinator-closed', 'Le coordinateur RTC est ferme.'))
    if (owner?.closed) return Promise.reject(owner.closeError ?? coordinatorError('rtc-route-closed', 'La route RTC est fermee.'))
    const parsedPayload = parseOnlineSignalPayload(payload)
    if (!parsedPayload) return Promise.reject(new TypeError('Le signal RTC sortant est invalide.'))
    sweepExpired()
    if (pendingRequests.size >= maximumPendingRequests) {
      return Promise.reject(coordinatorError('rtc-capacity-exceeded', 'Trop de requetes de signalisation RTC sont actives.'))
    }
    let requestId: string
    try { requestId = allocateRequestId() } catch (error) { return Promise.reject(error) }
    const promise = new Promise<string>((resolve, reject) => {
      pendingRequests.set(requestId, {
        owner,
        expiresAt: Date.now() + acknowledgementTimeoutMs,
        resolve,
        reject,
      })
    })
    try {
      const returnedRequestId = options.signaling.sendSignal(
        descriptor.peerId,
        descriptor.negotiationId,
        parsedPayload,
        requestId,
      )
      if (returnedRequestId !== requestId) {
        throw coordinatorError(
          'rtc-request-id-conflict',
          'Le client de signalisation a remplace l\'identifiant de requete RTC.',
          requestId,
        )
      }
    } catch (error) {
      const pending = pendingRequests.get(requestId)
      pendingRequests.delete(requestId)
      pending?.reject(error instanceof Error ? error : new Error('La signalisation RTC a echoue.'))
    }
    scheduleExpiration()
    return promise
  }
  const routeState = (route: RouteRecord): OnlineSignalingState => route.closed
    ? Object.freeze({ status: 'closed', ...(route.closeError ? { error: route.closeError } : {}) })
    : signalingState
  const createRoute = (
    descriptor: RtcSignalingRouteDescriptor,
    role: RtcSignalingRouteRole,
    bufferedSignals: readonly RtcSignalingInboundSignal[] = [],
  ): RtcSignalingRoute => {
    if (closed) throw coordinatorError('rtc-coordinator-closed', 'Le coordinateur RTC est ferme.')
    const key = routeKey(descriptor)
    if (activeRoutes.has(key) || replayTombstones.has(key)) {
      throw coordinatorError('rtc-route-conflict', 'Cette negociation RTC est deja active ou consommee.')
    }
    if (activeRoutes.size >= maximumActiveRoutes) {
      throw coordinatorError('rtc-capacity-exceeded', 'Trop de routes RTC sont actives.')
    }
    if (bufferedSignals.length > maximumBufferedSignalsPerRoute) {
      throw coordinatorError('rtc-capacity-exceeded', 'La route RTC contient trop de signaux en attente.')
    }
    const record: RouteRecord = {
      descriptor,
      role,
      key,
      bufferedSignals: [...bufferedSignals],
      signalSubscriptionUsed: false,
      stateSubscriptionUsed: false,
      closed: false,
    }
    const route: RtcSignalingRoute = Object.freeze({
      descriptor,
      role,
      getState: () => routeState(record),
      send: (payload) => sendTracked(descriptor, payload, record),
      subscribe(listener) {
        if (record.closed) throw record.closeError ?? coordinatorError('rtc-route-closed', 'La route RTC est fermee.')
        if (record.signalSubscriptionUsed) {
          throw coordinatorError('rtc-route-already-subscribed', 'La route RTC ne peut etre consommee que par une session.')
        }
        record.signalSubscriptionUsed = true
        record.signalListener = listener
        const queued = record.bufferedSignals.splice(0)
        for (const signal of queued) {
          if (record.closed || record.signalListener !== listener) break
          safeObserverCall(listener, signal)
        }
        return () => { if (record.signalListener === listener) record.signalListener = undefined }
      },
      subscribeState(listener) {
        if (record.closed) throw record.closeError ?? coordinatorError('rtc-route-closed', 'La route RTC est fermee.')
        if (record.stateSubscriptionUsed) {
          throw coordinatorError('rtc-route-already-subscribed', "L'etat de la route RTC est deja observe.")
        }
        record.stateSubscriptionUsed = true
        record.stateListener = listener
        safeObserverCall(listener, routeState(record))
        return () => { if (record.stateListener === listener) record.stateListener = undefined }
      },
      close: () => {
        closeRoute(record)
        scheduleExpiration()
      },
    })
    issuedRtcSignalingRoutes.add(route)
    activeRoutes.set(key, record)
    return route
  }
  const routeInbound = (route: RouteRecord, signal: RtcSignalingInboundSignal): void => {
    if (route.closed) return
    if (route.signalListener) {
      safeObserverCall(route.signalListener, signal)
      return
    }
    if (route.bufferedSignals.length >= maximumBufferedSignalsPerRoute) {
      closeRoute(route, coordinatorError('rtc-capacity-exceeded', 'La file de signaux de la route RTC est pleine.'))
      return
    }
    route.bufferedSignals.push(signal)
  }
  const invitationCount = (): number => {
    let count = 0
    for (const entry of bufferedNegotiations.values()) if (entry.invitation) count += 1
    return count
  }
  const removeOldestIceOnlyNegotiation = (): boolean => {
    for (const [key, entry] of bufferedNegotiations) {
      if (entry.invitation) continue
      removeBuffered(key)
      addTombstone(key)
      return true
    }
    return false
  }
  const createBufferedNegotiation = (
    descriptor: RtcSignalingRouteDescriptor,
  ): BufferedNegotiation | undefined => {
    if (bufferedNegotiations.size >= maximumBufferedNegotiations) {
      if (!removeOldestIceOnlyNegotiation()) return undefined
      if (replayBarrierUntil !== undefined && replayBarrierUntil > Date.now()) return undefined
    }
    const now = Date.now()
    const entry: BufferedNegotiation = {
      descriptor,
      createdAt: now,
      expiresAt: now + invitationTtlMs,
      signals: [],
      iceCount: 0,
    }
    bufferedNegotiations.set(routeKey(descriptor), entry)
    return entry
  }
  const bufferInvitationSignal = (
    descriptor: RtcSignalingRouteDescriptor,
    signal: RtcSignalingInboundSignal,
  ): void => {
    const key = routeKey(descriptor)
    let entry = bufferedNegotiations.get(key)
    if (signal.payload.type === 'hangup') {
      const invitationRemoved = Boolean(entry?.invitation)
      if (entry) removeBuffered(key)
      addTombstone(key)
      if (invitationRemoved) publishInvitations()
      return
    }
    if (signal.payload.type === 'answer') return
    if (!entry) {
      entry = createBufferedNegotiation(descriptor)
      if (!entry) { addTombstone(key); return }
    }
    if (signal.payload.type === 'ice') {
      if (
        entry.iceCount >= maximumIceCandidatesPerNegotiation
        || totalBufferedIceCandidates >= maximumBufferedIceCandidates
      ) return
      entry.signals.push(signal)
      entry.iceCount += 1
      totalBufferedIceCandidates += 1
      return
    }
    if (entry.invitation) return
    if (invitationCount() >= maximumInvitations) {
      removeBuffered(key)
      addTombstone(key)
      return
    }
    entry.signals.push(signal)
    entry.invitation = Object.freeze({
      descriptor: entry.descriptor,
      receivedAt: Date.now(),
      expiresAt: entry.expiresAt,
    })
    publishInvitations()
  }
  const receiveEvent = (event: OnlineRealtimeEvent): void => {
    if (closed) return
    sweepExpired()
    if (event.type === 'signal-accepted') {
      const pending = pendingRequests.get(event.requestId)
      if (!pending) return
      pendingRequests.delete(event.requestId)
      pending.resolve(event.requestId)
      scheduleExpiration()
      return
    }
    if (event.type === 'error' && event.requestId) {
      const pending = pendingRequests.get(event.requestId)
      if (!pending) return
      pendingRequests.delete(event.requestId)
      pending.reject(coordinatorError(
        'rtc-signaling-rejected',
        `La signalisation RTC a refuse la requete : ${event.message}`,
        event.requestId,
      ))
      scheduleExpiration()
      return
    }
    if (event.type !== 'signal' || !rememberInbound(event.from, event.requestId)) return
    if (signalingState.status === 'ready' && event.from === signalingState.userId) return
    const descriptor = routeDescriptor(event.from, event.negotiationId)
    const key = routeKey(descriptor)
    if (replayTombstones.has(key)) return
    const signal = Object.freeze({ requestId: event.requestId, payload: event.payload })
    const route = activeRoutes.get(key)
    if (!route && !bufferedNegotiations.has(key)
      && replayBarrierUntil !== undefined && replayBarrierUntil > Date.now()) return
    if (route) routeInbound(route, signal)
    else bufferInvitationSignal(descriptor, signal)
    scheduleExpiration()
  }
  const receiveState = (state: OnlineSignalingState): void => {
    if (closed) return
    signalingState = state
    for (const route of activeRoutes.values()) safeObserverCall(route.stateListener, state)
  }

  try {
    detachEvents = options.signaling.subscribe(receiveEvent)
    detachState = options.signaling.subscribeState(receiveState)
  } catch (error) {
    try { detachEvents?.() } catch { /* L'initialisation a deja echoue. */ }
    throw error
  }

  return Object.freeze({
    getInvitations() {
      sweepExpired()
      scheduleExpiration()
      return invitationSnapshot()
    },
    subscribeInvitations(listener) {
      if (closed) throw coordinatorError('rtc-coordinator-closed', 'Le coordinateur RTC est ferme.')
      invitationListeners.add(listener)
      safeObserverCall(listener, invitationSnapshot())
      return () => { invitationListeners.delete(listener) }
    },
    createOutboundRoute(peerId, negotiationId) {
      sweepExpired()
      if (replayBarrierUntil !== undefined && replayBarrierUntil > Date.now()) {
        throw coordinatorError(
          'rtc-capacity-exceeded',
          "La protection anti-rejeu RTC est saturee jusqu'a expiration de sa fenetre.",
        )
      }
      negotiationSerial += 1
      const generatedNegotiationId = negotiationId
        ?? (options.negotiationIdFactory ?? defaultOpaqueId)(negotiationSerial)
      if (!isOnlineOpaqueId(generatedNegotiationId)) {
        throw new TypeError("L'identifiant opaque de negociation WebRTC genere est invalide.")
      }
      const descriptor = routeDescriptor(peerId, generatedNegotiationId)
      if (signalingState.status === 'ready' && signalingState.userId === peerId) {
        throw new TypeError('Une route RTC ne peut pas cibler sa propre identite.')
      }
      const key = routeKey(descriptor)
      if (bufferedNegotiations.has(key)) {
        throw coordinatorError('rtc-route-conflict', 'Des signaux entrants existent deja pour cette negociation RTC.')
      }
      const route = createRoute(descriptor, 'offerer')
      scheduleExpiration()
      return route
    },
    claimInvitation(invitation) {
      sweepExpired()
      if (!invitation?.descriptor || !isOnlineUserId(invitation.descriptor.peerId)
        || !isOnlineNegotiationId(invitation.descriptor.negotiationId)) {
        throw new TypeError("L'invitation RTC est invalide.")
      }
      const key = routeKey(invitation.descriptor)
      const entry = bufferedNegotiations.get(key)
      if (!entry?.invitation) {
        if (activeRoutes.has(key) || replayTombstones.has(key)) {
          throw coordinatorError('rtc-invitation-consumed', "L'invitation RTC a deja ete consommee.")
        }
        throw coordinatorError('rtc-invitation-not-found', "L'invitation RTC n'existe plus ou a expire.")
      }
      if (entry.invitation !== invitation) {
        throw coordinatorError('rtc-invitation-consumed', "Cette version de l'invitation RTC n'est plus valide.")
      }
      const route = createRoute(entry.descriptor, 'answerer', entry.signals)
      removeBuffered(key)
      publishInvitations()
      scheduleExpiration()
      return route
    },
    async declineInvitation(invitation) {
      sweepExpired()
      if (!invitation?.descriptor || !isOnlineUserId(invitation.descriptor.peerId)
        || !isOnlineNegotiationId(invitation.descriptor.negotiationId)) {
        throw new TypeError("L'invitation RTC est invalide.")
      }
      const key = routeKey(invitation.descriptor)
      const entry = bufferedNegotiations.get(key)
      if (!entry?.invitation) {
        if (activeRoutes.has(key) || replayTombstones.has(key)) {
          throw coordinatorError('rtc-invitation-consumed', "L'invitation RTC a deja ete consommee.")
        }
        throw coordinatorError('rtc-invitation-not-found', "L'invitation RTC n'existe plus ou a expire.")
      }
      if (entry.invitation !== invitation) {
        throw coordinatorError('rtc-invitation-consumed', "Cette version de l'invitation RTC n'est plus valide.")
      }
      removeBuffered(key)
      addTombstone(key)
      publishInvitations()
      scheduleExpiration()
      await sendTracked(entry.descriptor, { type: 'hangup' })
    },
    close() {
      if (closed) return
      closed = true
      if (expirationTimer !== undefined) clearTimeout(expirationTimer)
      expirationTimer = undefined
      try { detachEvents?.() } catch { /* Le coordinateur est deja terminal. */ }
      try { detachState?.() } catch { /* Le coordinateur est deja terminal. */ }
      detachEvents = undefined
      detachState = undefined
      const error = coordinatorError('rtc-coordinator-closed', 'Le coordinateur RTC est ferme.')
      for (const route of [...activeRoutes.values()]) closeRoute(route, error)
      for (const request of pendingRequests.values()) request.reject(error)
      pendingRequests.clear()
      bufferedNegotiations.clear()
      replayTombstones.clear()
      replayBarrierUntil = undefined
      inboundRequestIds.clear()
      outgoingRequestIds.clear()
      totalBufferedIceCandidates = 0
      if (invitationListeners.size > 0) {
        const empty = Object.freeze([]) as readonly RtcSignalingInvitation[]
        for (const listener of invitationListeners) safeObserverCall(listener, empty)
      }
      invitationListeners.clear()
    },
  })
}
