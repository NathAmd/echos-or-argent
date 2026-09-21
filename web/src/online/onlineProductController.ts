import {
  parseOnlineClientConfig,
  type OnlineClientConfig,
} from './onlineClientConfig'
import {
  createOnlineRuntimeAccessToken,
  type OnlineRuntimeAccessToken,
} from './onlineRuntimeAccessToken'
import {
  createOnlineSignalingClient,
  type OnlineSignalingClient,
  type OnlineSignalingState,
} from './onlineSignalingClient'
import {
  createOnlineSocialClient,
  type OnlineSocialClient,
} from './onlineSocialClient'
import {
  createOnlineMatchmakingClient,
  type OnlineMatchmakingClient,
} from './onlineMatchmakingClient'
import {
  createOnlineCoopRendezvousClient,
  type OnlineCoopRendezvousClient,
} from './onlineCoopRendezvousClient'
import type { OnlineCoopRendezvousSnapshot } from './onlineCoopRendezvousProtocol'
import {
  isOnlineMatchmakingActivity,
  type OnlineMatchmakingActivity,
  type OnlineMatchmakingStatus,
} from './onlineMatchmakingProtocol'
import {
  isOnlineUserId,
  type OnlineFriend,
  type OnlineRealtimeEvent,
  type OnlineSocialSnapshot,
} from './onlineServiceProtocol'
import {
  createRtcPeerConnectionSession,
  type RtcPeerConnectionLink,
  type RtcPeerConnectionSession,
  type RtcPeerConnectionSessionState,
} from './rtcPeerConnectionSession'
import {
  createRtcSignalingCoordinator,
  type RtcSignalingCoordinator,
  type RtcSignalingInvitation,
  type RtcSignalingRoute,
  type RtcSignalingRouteRole,
} from './rtcSignalingCoordinator'

export type OnlineProductStatus =
  | 'disconnected'
  | 'connecting'
  | 'ready'
  | 'negotiating'
  | 'connected'
  | 'failed'

export type OnlineProductActivePeer = Readonly<{
  peerId: string
  negotiationId: string
  role: RtcSignalingRouteRole
}>

/** Snapshot directement consommable par une future interface amis/coop. */
export type OnlineProductState = Readonly<{
  configured: boolean
  status: OnlineProductStatus
  identity?: string
  friends: readonly OnlineFriend[]
  incomingFriendRequests: readonly string[]
  outgoingFriendRequests: readonly string[]
  invitations: readonly RtcSignalingInvitation[]
  matchmaking?: OnlineMatchmakingStatus
  coopRendezvous?: OnlineCoopRendezvousSnapshot
  activePeer?: OnlineProductActivePeer
  rtcLink?: RtcPeerConnectionLink
  error?: Error
}>

export type OnlineProductControllerErrorCode =
  | 'online-not-configured'
  | 'online-invalid-state'
  | 'online-connection-cancelled'
  | 'online-identity-mismatch'
  | 'online-peer-not-friend'
  | 'online-invitation-not-found'

export class OnlineProductControllerError extends Error {
  readonly code: OnlineProductControllerErrorCode

  constructor(code: OnlineProductControllerErrorCode, message: string) {
    super(message)
    this.name = 'OnlineProductControllerError'
    this.code = code
  }
}

export type OnlineProductControllerOptions = Readonly<{
  config?: OnlineClientConfig
  rtcConfiguration?: RTCConfiguration
  realtimeReadyTimeoutMs?: number
  socialClientFactory?: typeof createOnlineSocialClient
  matchmakingClientFactory?: typeof createOnlineMatchmakingClient
  coopRendezvousClientFactory?: typeof createOnlineCoopRendezvousClient
  signalingClientFactory?: typeof createOnlineSignalingClient
  signalingCoordinatorFactory?: typeof createRtcSignalingCoordinator
  peerConnectionSessionFactory?: typeof createRtcPeerConnectionSession
  now?: () => number
}>

export type OnlineProductController = Readonly<{
  getState: () => OnlineProductState
  subscribe: (listener: (state: OnlineProductState) => void) => () => void
  connect: (accessToken: string) => Promise<void>
  disconnect: () => void
  refreshSocial: () => Promise<void>
  sendFriendRequest: (userId: string) => Promise<void>
  acceptFriendRequest: (userId: string) => Promise<void>
  declineFriendRequest: (userId: string) => Promise<void>
  cancelFriendRequest: (userId: string) => Promise<void>
  removeFriend: (userId: string) => Promise<void>
  joinMatchmaking?: (activity: OnlineMatchmakingActivity) => Promise<OnlineMatchmakingStatus>
  refreshMatchmaking?: () => Promise<OnlineMatchmakingStatus>
  cancelMatchmaking?: () => Promise<void>
  consumeMatchmakingMatch?: (
    match: Extract<OnlineMatchmakingStatus, { status: 'matched' }>,
  ) => Promise<RtcPeerConnectionLink | undefined>
  refreshCoopRendezvous?: () => Promise<OnlineCoopRendezvousSnapshot>
  searchRandomCoop?: () => Promise<OnlineCoopRendezvousSnapshot>
  inviteCoopFriend?: (userId: string) => Promise<OnlineCoopRendezvousSnapshot>
  acceptCoopInvitation?: (sessionId: string) => Promise<OnlineCoopRendezvousSnapshot>
  declineCoopInvitation?: (sessionId: string) => Promise<OnlineCoopRendezvousSnapshot>
  cancelCoopRendezvous?: () => Promise<OnlineCoopRendezvousSnapshot>
  invitePeer: (userId: string) => Promise<RtcPeerConnectionLink>
  acceptPeerInvitation: (invitation: RtcSignalingInvitation) => Promise<RtcPeerConnectionLink>
  declinePeerInvitation: (invitation: RtcSignalingInvitation) => Promise<void>
  hangUp: () => void
}>

type ActivePeerRecord = {
  readonly route: RtcSignalingRoute
  readonly descriptor: OnlineProductActivePeer
  session?: RtcPeerConnectionSession
  link?: RtcPeerConnectionLink
}

type CoopRendezvousActiveMutation = {
  readonly generation: number
  readonly kind: 'mutating'
  cancelOperation?: Promise<OnlineCoopRendezvousSnapshot>
  operation?: Promise<OnlineCoopRendezvousSnapshot>
}

type CoopRendezvousCancelMutation = {
  readonly generation: number
  readonly kind: 'cancelling'
  operation?: Promise<OnlineCoopRendezvousSnapshot>
}

type CoopRendezvousMutation = CoopRendezvousActiveMutation | CoopRendezvousCancelMutation

type MatchmakingJoinMutation = {
  readonly activity: OnlineMatchmakingActivity
  readonly generation: number
  readonly kind: 'joining'
  cancelOperation?: Promise<void>
  operation?: Promise<OnlineMatchmakingStatus>
}

type MatchmakingCancelMutation = {
  readonly generation: number
  readonly kind: 'cancelling'
  operation?: Promise<void>
}

type MatchmakingMutation = MatchmakingJoinMutation | MatchmakingCancelMutation

const emptySocialSnapshot: OnlineSocialSnapshot = Object.freeze({
  friends: Object.freeze([]),
  incoming: Object.freeze([]),
  outgoing: Object.freeze([]),
})

const emptyCoopRendezvous: OnlineCoopRendezvousSnapshot = Object.freeze({
  protocolVersion: 1,
  current: Object.freeze({ status: 'idle' }),
  invitations: Object.freeze([]),
})

function controllerError(code: OnlineProductControllerErrorCode, message: string): OnlineProductControllerError {
  return new OnlineProductControllerError(code, message)
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

function normalizedPublicConfig(config: OnlineClientConfig | undefined): OnlineClientConfig | undefined {
  if (!config) return undefined
  const parsed = parseOnlineClientConfig(config.httpBaseUrl, false, config.identityBaseUrl)
  if (!parsed || parsed.webSocketBaseUrl !== config.webSocketBaseUrl) {
    throw new TypeError('La configuration publique du service en ligne est incohérente.')
  }
  return parsed
}

function normalizedSocialSnapshot(snapshot: OnlineSocialSnapshot): OnlineSocialSnapshot {
  return Object.freeze({
    friends: Object.freeze(snapshot.friends.map((friend) => Object.freeze({
      userId: friend.userId,
      online: friend.online,
    }))),
    incoming: Object.freeze([...snapshot.incoming]),
    outgoing: Object.freeze([...snapshot.outgoing]),
  })
}

function timeoutBound(value: number | undefined): number {
  const resolved = value ?? 15_000
  if (!Number.isSafeInteger(resolved) || resolved < 1_000 || resolved > 60_000) {
    throw new RangeError('Le délai de connexion temps réel doit être compris entre 1 000 et 60 000 ms.')
  }
  return resolved
}

function safeListenerCall(listener: (state: OnlineProductState) => void, state: OnlineProductState): void {
  try { listener(state) } catch { /* Une vue ne pilote jamais le transport. */ }
}

/**
 * Compose le produit en ligne sans dépendre du jeu. Les messages applicatifs
 * ne passent ici qu'après la remise d'un PeerDataChannel déjà négocié.
 */
export function createOnlineProductController(
  options: OnlineProductControllerOptions,
): OnlineProductController {
  const config = normalizedPublicConfig(options.config)
  const realtimeReadyTimeoutMs = timeoutBound(options.realtimeReadyTimeoutMs)
  const token: OnlineRuntimeAccessToken = createOnlineRuntimeAccessToken()
  const listeners = new Set<(state: OnlineProductState) => void>()
  const createSocialClient = options.socialClientFactory ?? createOnlineSocialClient
  const createMatchmakingClient = options.matchmakingClientFactory ?? createOnlineMatchmakingClient
  const createCoopRendezvousClient = options.coopRendezvousClientFactory
    ?? createOnlineCoopRendezvousClient
  const createSignalingClient = options.signalingClientFactory ?? createOnlineSignalingClient
  const createSignalingCoordinator = options.signalingCoordinatorFactory ?? createRtcSignalingCoordinator
  const createPeerConnectionSession = options.peerConnectionSessionFactory ?? createRtcPeerConnectionSession
  const now = options.now ?? Date.now

  let status: OnlineProductStatus = 'disconnected'
  let identity: string | undefined
  let social = emptySocialSnapshot
  let invitations: readonly RtcSignalingInvitation[] = Object.freeze([])
  let matchmaking: OnlineMatchmakingStatus = Object.freeze({ status: 'idle' })
  let coopRendezvous = emptyCoopRendezvous
  let activePeer: ActivePeerRecord | undefined
  let productError: Error | undefined
  let state: OnlineProductState
  let generation = 0
  let socialRequestSerial = 0
  let lastAppliedSocialRequest = 0
  let lifecycleAbort: AbortController | undefined
  let socialClient: OnlineSocialClient | undefined
  let matchmakingClient: OnlineMatchmakingClient | undefined
  let coopRendezvousClient: OnlineCoopRendezvousClient | undefined
  let signalingClient: OnlineSignalingClient | undefined
  let signalingCoordinator: RtcSignalingCoordinator | undefined
  let detachRealtimeEvents: (() => void) | undefined
  let detachSignalingState: (() => void) | undefined
  let detachInvitations: (() => void) | undefined
  let realtimeReadyTimer: ReturnType<typeof setTimeout> | undefined
  let resolveRealtimeReady: (() => void) | undefined
  let rejectRealtimeReady: ((error: Error) => void) | undefined
  let matchmakingRequestSerial = 0
  let coopRendezvousRequestSerial = 0
  let coopRendezvousMutation: CoopRendezvousMutation | undefined
  let matchmakingMutation: MatchmakingMutation | undefined
  let consumingMatchId: string | undefined
  let consumingMatch: Extract<OnlineMatchmakingStatus, { status: 'matched' }> | undefined
  let consumingMatchPromise: Promise<RtcPeerConnectionLink | undefined> | undefined

  const createState = (): OnlineProductState => Object.freeze({
    configured: config !== undefined,
    status,
    friends: social.friends,
    incomingFriendRequests: social.incoming,
    outgoingFriendRequests: social.outgoing,
    invitations,
    ...(config ? { matchmaking } : {}),
    ...(config ? { coopRendezvous } : {}),
    ...(identity ? { identity } : {}),
    ...(activePeer ? { activePeer: activePeer.descriptor } : {}),
    ...(activePeer?.link ? { rtcLink: activePeer.link } : {}),
    ...(productError ? { error: productError } : {}),
  })
  const publish = (): void => {
    const next = createState()
    state = next
    for (const listener of listeners) safeListenerCall(listener, next)
  }
  state = createState()

  const clearRealtimeReady = (): void => {
    if (realtimeReadyTimer !== undefined) clearTimeout(realtimeReadyTimer)
    realtimeReadyTimer = undefined
    resolveRealtimeReady = undefined
    rejectRealtimeReady = undefined
  }
  const stopActivePeer = (reason: string): void => {
    const current = activePeer
    activePeer = undefined
    if (!current) return
    try {
      if (current.session) current.session.close(reason)
      else current.route.close()
    } catch { /* La fermeture de produit reste idempotente. */ }
  }
  const releaseResources = (reason: string, readyError?: Error): void => {
    const queuedMatchmaking = matchmakingClient
    const pendingMatchmakingMutation = matchmakingMutation
    matchmakingMutation = undefined
    if (queuedMatchmaking && (
      matchmaking.status !== 'idle'
      || pendingMatchmakingMutation !== undefined
      || consumingMatchId !== undefined
    )) {
      void queuedMatchmaking.cancel().catch(() => undefined)
      if (pendingMatchmakingMutation?.kind === 'joining' && pendingMatchmakingMutation.operation) {
        void pendingMatchmakingMutation.operation
          .catch(() => undefined)
          .then(() => queuedMatchmaking.cancel())
          .catch(() => undefined)
      }
    }
    matchmakingRequestSerial += 1
    coopRendezvousRequestSerial += 1
    coopRendezvousMutation = undefined
    consumingMatchId = undefined
    consumingMatch = undefined
    consumingMatchPromise = undefined
    matchmaking = Object.freeze({ status: 'idle' })
    coopRendezvous = emptyCoopRendezvous
    lifecycleAbort?.abort()
    lifecycleAbort = undefined
    rejectRealtimeReady?.(readyError ?? controllerError(
      'online-connection-cancelled',
      'La connexion au service en ligne a été annulée.',
    ))
    clearRealtimeReady()
    stopActivePeer(reason)
    try { detachInvitations?.() } catch { /* Ressource déjà terminale. */ }
    try { detachRealtimeEvents?.() } catch { /* Ressource déjà terminale. */ }
    try { detachSignalingState?.() } catch { /* Ressource déjà terminale. */ }
    detachInvitations = undefined
    detachRealtimeEvents = undefined
    detachSignalingState = undefined
    try { signalingCoordinator?.close() } catch { /* Ressource déjà terminale. */ }
    try { signalingClient?.close() } catch { /* Ressource déjà terminale. */ }
    signalingCoordinator = undefined
    signalingClient = undefined
    socialClient = undefined
    matchmakingClient = undefined
    coopRendezvousClient = undefined
    token.clear()
    invitations = Object.freeze([])
  }
  const resetPrivateState = (): void => {
    identity = undefined
    social = emptySocialSnapshot
    invitations = Object.freeze([])
    activePeer = undefined
    socialRequestSerial = 0
    lastAppliedSocialRequest = 0
    matchmakingRequestSerial = 0
    coopRendezvousRequestSerial = 0
    coopRendezvousMutation = undefined
    matchmakingMutation = undefined
  }
  const failProduct = (value: unknown, expectedGeneration: number): Error => {
    const error = asError(value, 'La connexion au service en ligne a échoué.')
    if (generation !== expectedGeneration || status === 'disconnected') return error
    releaseResources('Connexion en ligne interrompue.', error)
    resetPrivateState()
    status = 'failed'
    productError = error
    publish()
    return error
  }
  const ensureActiveProduct = (): Readonly<{
    client: OnlineSocialClient
    signal: AbortSignal
    generation: number
  }> => {
    if (
      !socialClient
      || !lifecycleAbort
      || (status !== 'ready' && status !== 'negotiating' && status !== 'connected')
    ) {
      throw controllerError('online-invalid-state', "Le service en ligne n'est pas connecté.")
    }
    return { client: socialClient, signal: lifecycleAbort.signal, generation }
  }
  const ensureMatchmaking = (): Readonly<{
    client: OnlineMatchmakingClient
    signal: AbortSignal
    generation: number
  }> => {
    const active = ensureActiveProduct()
    if (!matchmakingClient) {
      throw controllerError('online-invalid-state', "Le client de matchmaking n'est pas disponible.")
    }
    return { client: matchmakingClient, signal: active.signal, generation: active.generation }
  }
  const ensureCoopRendezvous = (): Readonly<{
    client: OnlineCoopRendezvousClient
    signal: AbortSignal
    generation: number
  }> => {
    const active = ensureActiveProduct()
    if (!coopRendezvousClient) {
      throw controllerError('online-invalid-state', "Le rendez-vous Coop n'est pas disponible.")
    }
    return { client: coopRendezvousClient, signal: active.signal, generation: active.generation }
  }
  const hasCoopEngagement = (): boolean => coopRendezvous.current.status !== 'idle'
    || coopRendezvousMutation !== undefined
  const hasPeerEngagement = (): boolean => activePeer !== undefined
    || matchmaking.status !== 'idle'
    || matchmakingMutation !== undefined
    || consumingMatchId !== undefined
  const readCoopRendezvous = async (
    operation: (
      client: OnlineCoopRendezvousClient,
      signal: AbortSignal,
    ) => Promise<OnlineCoopRendezvousSnapshot>,
  ): Promise<OnlineCoopRendezvousSnapshot> => {
    const active = ensureCoopRendezvous()
    coopRendezvousRequestSerial += 1
    const serial = coopRendezvousRequestSerial
    const next = await operation(active.client, active.signal)
    if (
      generation !== active.generation
      || active.signal.aborted
      || serial !== coopRendezvousRequestSerial
    ) {
      throw controllerError('online-connection-cancelled', 'Une réponse Coop plus récente existe déjà.')
    }
    if (next.current.status !== 'idle' && hasPeerEngagement()) {
      throw controllerError(
        'online-invalid-state',
        'Un rendez-vous Coop ne peut pas armer une session pendant un engagement Trade/PvP.',
      )
    }
    coopRendezvous = next
    publish()
    return next
  }
  const mutateCoopRendezvous = (
    operation: (
      client: OnlineCoopRendezvousClient,
      signal: AbortSignal,
    ) => Promise<OnlineCoopRendezvousSnapshot>,
  ): Promise<OnlineCoopRendezvousSnapshot> => {
    if (coopRendezvousMutation) {
      return Promise.reject(controllerError(
        'online-invalid-state',
        'Une autre mutation de campagne Coop est déjà en cours.',
      ))
    }
    const reservation: CoopRendezvousActiveMutation = {
      generation,
      kind: 'mutating',
    }
    coopRendezvousMutation = reservation
    const pending = (async (): Promise<OnlineCoopRendezvousSnapshot> => {
      try { return await readCoopRendezvous(operation) }
      finally {
        if (coopRendezvousMutation === reservation && !reservation.cancelOperation) {
          coopRendezvousMutation = undefined
        }
      }
    })()
    reservation.operation = pending
    return pending
  }
  const applyCoopCancellation = (
    next: OnlineCoopRendezvousSnapshot,
    active: ReturnType<typeof ensureCoopRendezvous>,
  ): OnlineCoopRendezvousSnapshot => {
    if (generation !== active.generation || active.signal.aborted) {
      throw controllerError(
        'online-connection-cancelled',
        "L'annulation du rendez-vous Coop a été interrompue.",
      )
    }
    coopRendezvous = next
    publish()
    return next
  }
  const activeMatchmakingActivity = (
    value: OnlineMatchmakingStatus,
  ): OnlineMatchmakingActivity | undefined => value.status === 'idle' ? undefined : value.activity
  const sameMatch = (
    left: Extract<OnlineMatchmakingStatus, { status: 'matched' }>,
    right: Extract<OnlineMatchmakingStatus, { status: 'matched' }>,
  ): boolean => left.activity === right.activity
    && left.expiresAt === right.expiresAt
    && left.matchId === right.matchId
    && left.negotiationId === right.negotiationId
    && left.peerUserId === right.peerUserId
    && left.role === right.role
  const rejectMatchmakingStatus = (
    active: ReturnType<typeof ensureMatchmaking>,
    message: string,
  ): never => {
    matchmaking = Object.freeze({ status: 'idle' })
    publish()
    void active.client.cancel(active.signal).catch(() => undefined)
    throw new Error(message)
  }
  const applyMatchmakingStatus = async (
    next: OnlineMatchmakingStatus,
    active: ReturnType<typeof ensureMatchmaking>,
    expectedActivity?: OnlineMatchmakingActivity,
  ): Promise<OnlineMatchmakingStatus> => {
    if (generation !== active.generation || active.signal.aborted) {
      throw controllerError('online-connection-cancelled', 'La recherche multijoueur a été annulée.')
    }
    const nextActivity = activeMatchmakingActivity(next)
    const currentActivity = activeMatchmakingActivity(matchmaking)
    if (
      next.status !== 'idle'
      && (status !== 'ready' || activePeer !== undefined || consumingMatchId !== undefined
        || hasCoopEngagement())
    ) {
      return rejectMatchmakingStatus(
        active,
        "Une réponse de matchmaking active a été ignorée car une session pair-à-pair est déjà engagée.",
      )
    }
    if (nextActivity && expectedActivity && nextActivity !== expectedActivity) {
      return rejectMatchmakingStatus(active, "Le serveur a répondu avec une autre activité de matchmaking.")
    }
    if (nextActivity && !expectedActivity && currentActivity && nextActivity !== currentActivity) {
      return rejectMatchmakingStatus(active, "Le serveur a changé l'activité d'une recherche en cours.")
    }
    if (next.status === 'matched' && next.peerUserId === identity) {
      return rejectMatchmakingStatus(active, 'Le matchmaking ne peut pas associer un joueur avec lui-même.')
    }
    if (next.status !== 'idle' && next.expiresAt <= now()) {
      matchmaking = Object.freeze({ status: 'idle' })
      publish()
      void active.client.cancel(active.signal).catch(() => undefined)
      return matchmaking
    }
    matchmaking = next
    publish()
    return matchmaking
  }
  const readMatchmaking = async (
    operation: (client: OnlineMatchmakingClient, signal: AbortSignal) => Promise<OnlineMatchmakingStatus>,
    expectedActivity?: OnlineMatchmakingActivity,
  ): Promise<OnlineMatchmakingStatus> => {
    const active = ensureMatchmaking()
    matchmakingRequestSerial += 1
    const serial = matchmakingRequestSerial
    const next = await operation(active.client, active.signal)
    if (serial !== matchmakingRequestSerial) {
      throw controllerError('online-connection-cancelled', 'Une réponse de matchmaking plus récente existe déjà.')
    }
    return applyMatchmakingStatus(next, active, expectedActivity)
  }
  const refreshSocialFor = async (
    client: OnlineSocialClient,
    signal: AbortSignal,
    expectedGeneration: number,
  ): Promise<void> => {
    socialRequestSerial += 1
    const requestSerial = socialRequestSerial
    const snapshot = await client.getSocial(signal)
    if (
      generation !== expectedGeneration
      || signal.aborted
      || status === 'disconnected'
      || status === 'failed'
    ) {
      throw controllerError('online-connection-cancelled', 'La mise à jour sociale a été annulée.')
    }
    if (requestSerial < lastAppliedSocialRequest) return
    lastAppliedSocialRequest = requestSerial
    social = normalizedSocialSnapshot(snapshot)
    publish()
  }
  const updatePresence = (userId: string, online: boolean): void => {
    const index = social.friends.findIndex((friend) => friend.userId === userId)
    if (index < 0 || social.friends[index]?.online === online) return
    const friends = social.friends.map((friend, friendIndex) => Object.freeze({
      userId: friend.userId,
      online: friendIndex === index ? online : friend.online,
    }))
    social = Object.freeze({ ...social, friends: Object.freeze(friends) })
    publish()
  }
  const replaceRealtimePresence = (onlineFriends: readonly string[]): void => {
    const online = new Set(onlineFriends)
    const friends = social.friends.map((friend) => Object.freeze({
      userId: friend.userId,
      online: online.has(friend.userId),
    }))
    social = Object.freeze({ ...social, friends: Object.freeze(friends) })
    publish()
  }
  const signalingIsReady = (): boolean => signalingClient?.getState().status === 'ready'
  const currentStatus = (): OnlineProductStatus => status
  const finishActivePeer = (record: ActivePeerRecord, error?: Error): void => {
    if (activePeer !== record) return
    activePeer = undefined
    if (signalingIsReady()) {
      status = 'ready'
      productError = error
      publish()
      return
    }
    failProduct(error ?? new Error('La signalisation en ligne est fermée.'), generation)
  }
  const observePeerSession = (record: ActivePeerRecord, next: RtcPeerConnectionSessionState): void => {
    if (activePeer !== record || (next.status !== 'closed' && next.status !== 'failed')) return
    finishActivePeer(record, next.error)
  }
  const beginPeerSession = async (route: RtcSignalingRoute): Promise<RtcPeerConnectionLink> => {
    if (activePeer || status !== 'ready' || hasCoopEngagement()) {
      try { route.close() } catch { /* La route n'a pas encore été consommée. */ }
      throw controllerError('online-invalid-state', 'Une autre session pair-à-pair est déjà active.')
    }
    const record: ActivePeerRecord = {
      route,
      descriptor: Object.freeze({
        peerId: route.descriptor.peerId,
        negotiationId: route.descriptor.negotiationId,
        role: route.role,
      }),
    }
    activePeer = record
    status = 'negotiating'
    productError = undefined
    publish()
    try {
      const session = createPeerConnectionSession({
        route,
        rtcConfiguration: options.rtcConfiguration,
        onStateChange: (next) => observePeerSession(record, next),
      })
      if (activePeer !== record) {
        session.close('La session en ligne a été annulée pendant son initialisation.')
        throw controllerError('online-connection-cancelled', 'La session pair-à-pair a été annulée.')
      }
      record.session = session
      const link = await session.connect()
      if (activePeer !== record || status !== 'negotiating') {
        session.close('La session en ligne a été annulée avant sa remise au jeu.')
        throw controllerError('online-connection-cancelled', 'La session pair-à-pair a été annulée.')
      }
      record.link = link
      status = 'connected'
      productError = undefined
      publish()
      if (activePeer !== record || status !== 'connected') {
        session.close('La session en ligne a été annulée pendant sa remise au jeu.')
        throw controllerError('online-connection-cancelled', 'La session pair-à-pair a été annulée.')
      }
      return link
    } catch (value) {
      const error = asError(value, 'La session pair-à-pair a échoué.')
      if (activePeer === record) {
        activePeer = undefined
        try {
          if (record.session) record.session.close('La négociation pair-à-pair a échoué.')
          else record.route.close()
        } catch { /* La route peut déjà être terminale. */ }
        if (signalingIsReady()) {
          status = 'ready'
          productError = error
          publish()
        } else {
          failProduct(error, generation)
        }
      }
      throw error
    }
  }
  const runSocialMutation = async (
    operation: (client: OnlineSocialClient, signal: AbortSignal) => Promise<void>,
  ): Promise<void> => {
    const active = ensureActiveProduct()
    await operation(active.client, active.signal)
    if (generation !== active.generation || active.signal.aborted) {
      throw controllerError('online-connection-cancelled', "L'opération sociale a été annulée.")
    }
    await refreshSocialFor(active.client, active.signal, active.generation)
  }

  return Object.freeze({
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener)
      safeListenerCall(listener, state)
      return () => { listeners.delete(listener) }
    },
    async connect(accessToken) {
      if (!config) {
        throw controllerError('online-not-configured', "Aucun serveur en ligne public n'est configuré.")
      }
      if (status !== 'disconnected' && status !== 'failed') {
        throw controllerError('online-invalid-state', 'Une connexion au service en ligne est déjà active.')
      }
      token.replace(accessToken)
      generation += 1
      const expectedGeneration = generation
      releaseResources('Remplacement de la connexion en ligne.')
      token.replace(accessToken)
      resetPrivateState()
      const connectionAbort = new AbortController()
      lifecycleAbort = connectionAbort
      status = 'connecting'
      productError = undefined
      publish()

      try {
        if (generation !== expectedGeneration || status !== 'connecting') {
          throw controllerError('online-connection-cancelled', 'La connexion au service en ligne a été annulée.')
        }
        const client = createSocialClient({ config, readAccessToken: token.read })
        socialClient = client
        matchmakingClient = createMatchmakingClient({ config, readAccessToken: token.read })
        coopRendezvousClient = createCoopRendezvousClient({ config, readAccessToken: token.read })
        const [resolvedIdentity, initialSocial, ticket] = await Promise.all([
          client.getIdentity(connectionAbort.signal),
          client.getSocial(connectionAbort.signal),
          client.issueRealtimeTicket(connectionAbort.signal),
        ])
        if (
          generation !== expectedGeneration
          || connectionAbort.signal.aborted
          || status !== 'connecting'
        ) {
          throw controllerError('online-connection-cancelled', 'La connexion au service en ligne a été annulée.')
        }
        identity = resolvedIdentity
        social = normalizedSocialSnapshot(initialSocial)
        publish()
        if (generation !== expectedGeneration || status !== 'connecting') {
          throw controllerError('online-connection-cancelled', 'La connexion au service en ligne a été annulée.')
        }

        const readyPromise = new Promise<void>((resolve, reject) => {
          resolveRealtimeReady = resolve
          rejectRealtimeReady = reject
        })
        // Une factory injectée peut lever avant le `await`; ce garde-fou évite
        // alors une rejection runtime non observée pendant le nettoyage.
        void readyPromise.catch(() => undefined)
        const realtime = createSignalingClient({ config, ticket })
        signalingClient = realtime
        detachRealtimeEvents = realtime.subscribe((event: OnlineRealtimeEvent) => {
          if (generation !== expectedGeneration || status === 'disconnected' || status === 'failed') return
          if (event.type === 'ready') {
            if (event.userId !== identity) {
              failProduct(controllerError(
                'online-identity-mismatch',
                "L'identité REST et l'identité temps réel ne correspondent pas.",
              ), expectedGeneration)
              return
            }
            replaceRealtimePresence(event.onlineFriends)
          } else if (event.type === 'presence') {
            updatePresence(event.userId, event.online)
          } else if (event.type === 'social-changed') {
            const currentClient = socialClient
            const signal = lifecycleAbort?.signal
            if (currentClient && signal) {
              void refreshSocialFor(currentClient, signal, expectedGeneration).catch(() => undefined)
            }
          } else if (event.type === 'error' && !event.requestId) {
            productError = new Error(event.message)
            publish()
          }
        })
        const coordinator = createSignalingCoordinator({ signaling: realtime })
        signalingCoordinator = coordinator
        const stopObservingInvitations = coordinator.subscribeInvitations((next) => {
          if (generation !== expectedGeneration || status === 'disconnected' || status === 'failed') return
          invitations = Object.freeze([...next])
          publish()
        })
        if (
          generation !== expectedGeneration
          || currentStatus() === 'disconnected'
          || currentStatus() === 'failed'
        ) {
          stopObservingInvitations()
          throw controllerError('online-connection-cancelled', 'La connexion au service en ligne a été annulée.')
        }
        detachInvitations = stopObservingInvitations
        const stopObservingSignalingState = realtime.subscribeState((next: OnlineSignalingState) => {
          if (generation !== expectedGeneration || status === 'disconnected' || status === 'failed') return
          if (next.status === 'ready') {
            if (!next.userId || next.userId !== identity) {
              failProduct(controllerError(
                'online-identity-mismatch',
                "L'identité REST et l'identité temps réel ne correspondent pas.",
              ), expectedGeneration)
              return
            }
            if (status === 'connecting') {
              status = 'ready'
              productError = undefined
              publish()
            }
            resolveRealtimeReady?.()
            return
          }
          if (next.status !== 'closed' && next.status !== 'failed') return
          if (status === 'connected' && activePeer?.link) {
            productError = next.error
            publish()
            return
          }
          failProduct(next.error ?? new Error('La signalisation temps réel a été fermée.'), expectedGeneration)
        })
        if (currentStatus() === 'failed' || currentStatus() === 'disconnected') {
          stopObservingSignalingState()
          throw productError ?? new Error('La signalisation temps réel a été fermée.')
        }
        detachSignalingState = stopObservingSignalingState
        realtimeReadyTimer = setTimeout(() => failProduct(
          new Error('La connexion au service temps réel a expiré.'),
          expectedGeneration,
        ), Math.min(realtimeReadyTimeoutMs, ticket.expiresInMs))
        await readyPromise
        clearRealtimeReady()
        if (generation !== expectedGeneration || currentStatus() !== 'ready') {
          throw controllerError('online-connection-cancelled', 'La connexion au service en ligne a été annulée.')
        }
      } catch (value) {
        const error = asError(value, 'La connexion au service en ligne a échoué.')
        if (
          generation === expectedGeneration
          && currentStatus() !== 'failed'
          && currentStatus() !== 'disconnected'
        ) {
          failProduct(error, expectedGeneration)
        }
        throw error
      }
    },
    disconnect() {
      generation += 1
      releaseResources('Déconnexion locale du service en ligne.')
      resetPrivateState()
      status = 'disconnected'
      productError = undefined
      publish()
    },
    async refreshSocial() {
      const active = ensureActiveProduct()
      await refreshSocialFor(active.client, active.signal, active.generation)
    },
    sendFriendRequest(userId) {
      return runSocialMutation((client, signal) => client.sendFriendRequest(userId, signal))
    },
    acceptFriendRequest(userId) {
      return runSocialMutation((client, signal) => client.acceptFriendRequest(userId, signal))
    },
    declineFriendRequest(userId) {
      return runSocialMutation((client, signal) => client.declineFriendRequest(userId, signal))
    },
    cancelFriendRequest(userId) {
      return runSocialMutation((client, signal) => client.cancelFriendRequest(userId, signal))
    },
    removeFriend(userId) {
      return runSocialMutation((client, signal) => client.removeFriend(userId, signal))
    },
    refreshCoopRendezvous() {
      if (coopRendezvousMutation?.kind === 'mutating') {
        return coopRendezvousMutation.cancelOperation
          ?? coopRendezvousMutation.operation
          ?? Promise.reject(controllerError(
            'online-invalid-state',
            'La mutation de campagne Coop est encore en cours de démarrage.',
          ))
      }
      if (coopRendezvousMutation?.kind === 'cancelling') {
        return coopRendezvousMutation.operation ?? Promise.reject(controllerError(
          'online-invalid-state',
          "La campagne Coop est encore en cours d'annulation.",
        ))
      }
      return readCoopRendezvous((client, signal) => client.getSnapshot(signal))
    },
    searchRandomCoop() {
      if (hasPeerEngagement()) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une session pair-à-pair est déjà active.',
        ))
      }
      if (coopRendezvous.current.status === 'queued') {
        return Promise.resolve(coopRendezvous)
      }
      if (coopRendezvous.current.status !== 'idle') {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une autre campagne Coop est déjà engagée.',
        ))
      }
      return mutateCoopRendezvous((client, signal) => client.searchRandom(signal))
    },
    inviteCoopFriend(userId) {
      if (!isOnlineUserId(userId) || !social.friends.some((friend) => friend.userId === userId)) {
        return Promise.reject(controllerError(
          'online-peer-not-friend',
          'Une campagne Coop ne peut être proposée qu’à un ami.',
        ))
      }
      if (hasPeerEngagement()) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une session pair-à-pair est déjà active.',
        ))
      }
      if (
        coopRendezvous.current.status === 'offered'
        && coopRendezvous.current.peerUserId === userId
      ) return Promise.resolve(coopRendezvous)
      if (coopRendezvous.current.status !== 'idle') {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une autre campagne Coop est déjà engagée.',
        ))
      }
      return mutateCoopRendezvous((client, signal) => client.inviteFriend(userId, signal))
    },
    acceptCoopInvitation(sessionId) {
      if (hasPeerEngagement()) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une session pair-à-pair est déjà active.',
        ))
      }
      if (
        (coopRendezvous.current.status === 'ready'
          || coopRendezvous.current.status === 'active')
        && coopRendezvous.current.sessionId === sessionId
      ) return Promise.resolve(coopRendezvous)
      if (coopRendezvous.current.status !== 'idle') {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une autre campagne Coop est déjà engagée.',
        ))
      }
      return mutateCoopRendezvous((client, signal) => client.acceptInvitation(sessionId, signal))
    },
    declineCoopInvitation(sessionId) {
      return mutateCoopRendezvous((client, signal) => client.declineInvitation(sessionId, signal))
    },
    cancelCoopRendezvous() {
      let active: ReturnType<typeof ensureCoopRendezvous>
      try { active = ensureCoopRendezvous() }
      catch (value) { return Promise.reject(value) }

      if (coopRendezvousMutation?.kind === 'cancelling' && coopRendezvousMutation.operation) {
        return coopRendezvousMutation.operation
      }
      if (coopRendezvousMutation?.kind === 'mutating') {
        const reservation = coopRendezvousMutation
        if (reservation.cancelOperation) return reservation.cancelOperation
        coopRendezvousRequestSerial += 1
        let immediateCancel: Promise<OnlineCoopRendezvousSnapshot>
        try { immediateCancel = active.client.cancelCurrent(active.signal) }
        catch (value) { immediateCancel = Promise.reject(value) }
        void immediateCancel.catch(() => undefined)

        const operation = (async (): Promise<OnlineCoopRendezvousSnapshot> => {
          try {
            await reservation.operation?.catch(() => undefined)
            const next = await active.client.cancelCurrent(active.signal)
            return applyCoopCancellation(next, active)
          } finally {
            if (coopRendezvousMutation === reservation) coopRendezvousMutation = undefined
          }
        })()
        reservation.cancelOperation = operation
        return operation
      }

      const reservation: CoopRendezvousCancelMutation = {
        generation,
        kind: 'cancelling',
      }
      coopRendezvousMutation = reservation
      coopRendezvousRequestSerial += 1
      const operation = (async (): Promise<OnlineCoopRendezvousSnapshot> => {
        try {
          const next = await active.client.cancelCurrent(active.signal)
          return applyCoopCancellation(next, active)
        } finally {
          if (coopRendezvousMutation === reservation) coopRendezvousMutation = undefined
        }
      })()
      reservation.operation = operation
      return operation
    },
    joinMatchmaking(activity) {
      if (!isOnlineMatchmakingActivity(activity)) {
        return Promise.reject(new TypeError("L'activité de matchmaking est invalide."))
      }
      if (
        status !== 'ready'
        || activePeer
        || hasCoopEngagement()
        || matchmaking.status !== 'idle'
        || matchmakingMutation
        || consumingMatchId
      ) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Une autre session ou recherche pair-à-pair est déjà active.',
        ))
      }
      const reservation: MatchmakingJoinMutation = {
        activity,
        generation,
        kind: 'joining',
      }
      matchmakingMutation = reservation
      const operation = (async (): Promise<OnlineMatchmakingStatus> => {
        try {
          return await readMatchmaking((client, signal) => client.join(activity, signal), activity)
        } finally {
          if (matchmakingMutation === reservation && !reservation.cancelOperation) {
            matchmakingMutation = undefined
          }
        }
      })()
      reservation.operation = operation
      return operation
    },
    refreshMatchmaking() {
      if (matchmakingMutation?.kind === 'joining') {
        return matchmakingMutation.operation ?? Promise.reject(controllerError(
          'online-invalid-state',
          'La recherche multijoueur est encore en cours de démarrage.',
        ))
      }
      if (matchmakingMutation?.kind === 'cancelling') {
        return Promise.reject(controllerError(
          'online-invalid-state',
          "La recherche multijoueur est en cours d'annulation.",
        ))
      }
      return readMatchmaking((client, signal) => client.getStatus(signal))
    },
    cancelMatchmaking() {
      let active: ReturnType<typeof ensureMatchmaking>
      try { active = ensureMatchmaking() }
      catch (value) { return Promise.reject(value) }
      if (consumingMatchId) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          "Le rendez-vous ne peut pas être supprimé pendant l'établissement de la session pair-à-pair.",
        ))
      }

      if (matchmakingMutation?.kind === 'cancelling' && matchmakingMutation.operation) {
        return matchmakingMutation.operation
      }
      if (matchmakingMutation?.kind === 'joining') {
        const reservation = matchmakingMutation
        if (reservation.cancelOperation) return reservation.cancelOperation
        matchmakingRequestSerial += 1
        let immediateCancel: Promise<void>
        try { immediateCancel = active.client.cancel(active.signal) }
        catch (value) { immediateCancel = Promise.reject(value) }
        void immediateCancel.catch(() => undefined)

        const operation = (async (): Promise<void> => {
          try {
            await reservation.operation?.catch(() => undefined)
            await active.client.cancel(active.signal)
            if (generation !== active.generation || active.signal.aborted) {
              throw controllerError('online-connection-cancelled', "L'annulation du matchmaking a été interrompue.")
            }
            matchmaking = Object.freeze({ status: 'idle' })
            consumingMatchId = undefined
            consumingMatch = undefined
            consumingMatchPromise = undefined
            publish()
          } finally {
            if (matchmakingMutation === reservation) matchmakingMutation = undefined
          }
        })()
        reservation.cancelOperation = operation
        return operation
      }

      const reservation: MatchmakingCancelMutation = {
        generation,
        kind: 'cancelling',
      }
      matchmakingMutation = reservation
      matchmakingRequestSerial += 1
      const operation = (async (): Promise<void> => {
        try {
          await active.client.cancel(active.signal)
          if (generation !== active.generation || active.signal.aborted) {
            throw controllerError('online-connection-cancelled', "L'annulation du matchmaking a été interrompue.")
          }
          matchmaking = Object.freeze({ status: 'idle' })
          consumingMatchId = undefined
          consumingMatch = undefined
          consumingMatchPromise = undefined
          publish()
        } finally {
          if (matchmakingMutation === reservation) matchmakingMutation = undefined
        }
      })()
      reservation.operation = operation
      return operation
    },
    consumeMatchmakingMatch(match) {
      if (consumingMatch && sameMatch(consumingMatch, match) && consumingMatchPromise) {
        return consumingMatchPromise
      }
      if (consumingMatchId) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          'Un autre match est déjà en cours de consommation.',
        ))
      }
      const current = matchmaking
      if (current.status !== 'matched' || !sameMatch(current, match)) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          "Le match demandé n'est plus le match courant.",
        ))
      }
      if (current.expiresAt <= now()) {
        matchmaking = Object.freeze({ status: 'idle' })
        publish()
        const client = matchmakingClient
        if (client) void client.cancel().catch(() => undefined)
        return Promise.reject(controllerError('online-invalid-state', 'Le match courant a expiré.'))
      }
      if (
        !identity
        || current.peerUserId === identity
        || status !== 'ready'
        || activePeer
        || hasCoopEngagement()
      ) {
        return Promise.reject(controllerError(
          'online-invalid-state',
          "Le match courant ne peut pas être consommé dans cet état.",
        ))
      }
      if (!signalingCoordinator) {
        return Promise.reject(controllerError('online-invalid-state', "La signalisation RTC n'est pas prête."))
      }
      let route: RtcSignalingRoute
      if (current.role === 'offerer') {
        try { route = signalingCoordinator.createOutboundRoute(current.peerUserId, current.negotiationId) }
        catch (value) { return Promise.reject(value) }
      } else {
        const invitation = invitations.find(({ descriptor }) => (
          descriptor.peerId === current.peerUserId
          && descriptor.negotiationId === current.negotiationId
        ))
        if (!invitation) return Promise.resolve(undefined)
        try { route = signalingCoordinator.claimInvitation(invitation) }
        catch (value) { return Promise.reject(value) }
      }
      if (route.role !== current.role
        || route.descriptor.peerId !== current.peerUserId
        || route.descriptor.negotiationId !== current.negotiationId) {
        try { route.close() } catch { /* La route divergente est déjà fermée. */ }
        return Promise.reject(new Error("La route RTC ne correspond pas exactement au match autorisé."))
      }

      consumingMatchId = current.matchId
      consumingMatch = current
      matchmakingRequestSerial += 1
      matchmaking = Object.freeze({ status: 'idle' })
      const matchedClient = matchmakingClient
      const cleanup = async (): Promise<void> => {
        try { await matchedClient?.cancel() }
        catch { /* Le résultat RTC reste prioritaire sur ce nettoyage best-effort. */ }
      }
      const operation = beginPeerSession(route).then(
        async (link) => {
          await cleanup()
          return link
        },
        async (error: unknown) => {
          await cleanup()
          throw error
        },
      ).finally(() => {
        if (consumingMatchId === current.matchId) {
          consumingMatchId = undefined
          consumingMatch = undefined
          consumingMatchPromise = undefined
        }
      })
      consumingMatchPromise = operation
      return operation
    },
    invitePeer(userId) {
      if (!isOnlineUserId(userId) || !social.friends.some((friend) => friend.userId === userId)) {
        return Promise.reject(controllerError(
          'online-peer-not-friend',
          'Une session pair-à-pair ne peut être proposée qu’à un ami.',
        ))
      }
      if (
        !signalingCoordinator
        || status !== 'ready'
        || hasCoopEngagement()
        || hasPeerEngagement()
      ) {
        return Promise.reject(controllerError('online-invalid-state', "Le rendez-vous pair-à-pair n'est pas prêt."))
      }
      let route: RtcSignalingRoute
      try { route = signalingCoordinator.createOutboundRoute(userId) }
      catch (value) { return Promise.reject(value) }
      return beginPeerSession(route)
    },
    acceptPeerInvitation(invitation) {
      if (
        !signalingCoordinator
        || status !== 'ready'
        || hasCoopEngagement()
        || hasPeerEngagement()
      ) {
        return Promise.reject(controllerError('online-invalid-state', "Le rendez-vous pair-à-pair n'est pas prêt."))
      }
      if (!invitations.includes(invitation)) {
        return Promise.reject(controllerError('online-invitation-not-found', "L'invitation pair-à-pair n'est plus active."))
      }
      let route: RtcSignalingRoute
      try { route = signalingCoordinator.claimInvitation(invitation) }
      catch (value) { return Promise.reject(value) }
      return beginPeerSession(route)
    },
    declinePeerInvitation(invitation) {
      if (!signalingCoordinator || (status !== 'ready' && status !== 'negotiating' && status !== 'connected')) {
        return Promise.reject(controllerError('online-invalid-state', "Le rendez-vous pair-à-pair n'est pas prêt."))
      }
      if (!invitations.includes(invitation)) {
        return Promise.reject(controllerError('online-invitation-not-found', "L'invitation pair-à-pair n'est plus active."))
      }
      return signalingCoordinator.declineInvitation(invitation)
    },
    hangUp() {
      const current = activePeer
      if (!current) return
      activePeer = undefined
      try {
        if (current.session) current.session.close('Session pair-à-pair fermée localement.')
        else current.route.close()
      } catch { /* Fermeture locale idempotente. */ }
      if (signalingIsReady()) {
        status = 'ready'
        productError = undefined
        publish()
      } else {
        failProduct(new Error('La signalisation en ligne est fermée.'), generation)
      }
    },
  })
}
