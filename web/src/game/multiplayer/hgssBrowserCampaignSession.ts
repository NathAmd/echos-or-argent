import type { PeerDataChannelHandlers } from '../../online/peerDataChannel'
import {
  isOnlineNegotiationId,
  isOnlineOpaqueId,
  isOnlineUserId,
} from '../../online/onlineServiceProtocol'
import type {
  BrowserMultiplayerCampaignPort,
  BrowserMultiplayerCampaignSession,
  BrowserMultiplayerCampaignStartContext,
  BrowserMultiplayerDirectCampaignStartContext,
  BrowserMultiplayerPeerCampaignStartContext,
} from './browserMultiplayerCampaignPort'
import {
  createHgssCampaignClientGateway,
  type HgssCampaignClientGateway,
} from './hgssCampaignClientGateway'
import {
  HgssCampaignAuthoritativeServiceError,
  type HgssCampaignAuthoritativeCompatibility,
  type HgssCampaignAuthoritativePlayer,
  type HgssCampaignAuthoritativeService,
  type HgssCampaignGuestJoinAdmissionPort,
  type HgssCampaignSharedEventAdmissionPort,
} from './hgssCampaignAuthoritativeService'
import { createHgssCampaignInMemoryTransport } from './hgssCampaignInMemoryTransport'
import {
  createHgssCampaignPeerBootstrapEnvelope,
  decodeHgssCampaignPeerBootstrapFrame,
  encodeHgssCampaignPeerBootstrapFrame,
  type HgssCampaignPeerBootstrapHello,
  type HgssCampaignPeerBootstrapRejectCode,
  type HgssCampaignPeerBootstrapPlayer,
} from './hgssCampaignPeerBootstrapProtocol'
import {
  createHgssCampaignPeerGuestTransport,
  createHgssCampaignPeerHostBridge,
  type HgssCampaignPeerHostBridge,
} from './hgssCampaignPeerBridge'
import {
  parseHgssCampaignSharedProgression,
  type HgssCampaignServerSnapshot,
  type HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import {
  createHgssCampaignServerCore,
  type HgssCampaignServerCore,
  type HgssCampaignServerMovementPort,
} from './hgssCampaignServerCore'

export type HgssBrowserCampaignLocalPlayer = Readonly<{
  gameCode: string
  gameVersion: number
  language: number
  player: HgssCampaignPeerBootstrapPlayer
  /** Baseline durable envoyée uniquement lors de la création par l'hôte. */
  sharedProgression?: HgssCampaignSharedProgression
}>

export type HgssBrowserCampaignGuestAdmission =
  | Readonly<{ kind: 'accept' }>
  | Readonly<{
    kind: 'reject'
    code: Extract<
      HgssCampaignPeerBootstrapRejectCode,
      'position-occupied' | 'position-invalid' | 'campaign-unavailable'
    >
    message: string
  }>

export type HgssBrowserCampaignState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'connecting', role: 'host' | 'guest', remoteParticipantId: string }>
  | Readonly<{ status: 'closing', role: 'host' | 'guest', remoteParticipantId: string }>
  | Readonly<{
    status: 'connected'
    role: 'host' | 'guest'
    remoteParticipantId: string
    snapshot: HgssCampaignServerSnapshot
  }>
  | Readonly<{
    status: 'failed'
    role: 'host' | 'guest'
    remoteParticipantId: string
    error: Error
  }>

export type HgssBrowserCampaignCoordinatorOptions = Readonly<{
  readLocalPlayer: () => HgssBrowserCampaignLocalPlayer | undefined
  movement: HgssCampaignServerMovementPort
  /** Oracle ROM du propriétaire pour les transactions scénario proposées par les deux joueurs. */
  sharedEventAdmission?: HgssCampaignSharedEventAdmissionPort
  /** Présent dans le navigateur publié : le serveur devient l'unique état partagé. */
  authoritativeService?: HgssCampaignAuthoritativeService
  /** Validation fiable de la case initiale invitée dans le monde de l'hôte. */
  authorizeGuestJoin: (request: Readonly<{
    sessionId: string
    local: HgssBrowserCampaignLocalPlayer
    guest: HgssCampaignPeerBootstrapHello
  }>) => HgssBrowserCampaignGuestAdmission
  bootstrapTimeoutMs?: number
  onSnapshot?: (
    snapshot: HgssCampaignServerSnapshot,
    localParticipantId: string,
  ) => void | Promise<void>
  onError?: (error: Error) => void
}>

export type HgssBrowserCampaignCoordinator = Readonly<{
  port: BrowserMultiplayerCampaignPort
  getState: () => HgssBrowserCampaignState
  getGateway: () => HgssCampaignClientGateway | undefined
  subscribe: (listener: (state: HgssBrowserCampaignState) => void) => () => void
  close: () => Promise<void>
}>

export type HgssBrowserCampaignErrorCode =
  | 'campaign-already-active'
  | 'campaign-route-invalid'
  | 'campaign-local-unavailable'
  | 'campaign-bootstrap-timeout'
  | 'campaign-bootstrap-invalid'
  | 'campaign-peer-rejected'
  | 'campaign-authority-failed'
  | 'campaign-disconnected'

export class HgssBrowserCampaignError extends Error {
  readonly code: HgssBrowserCampaignErrorCode
  readonly peerCode?: HgssCampaignPeerBootstrapRejectCode

  constructor(
    code: HgssBrowserCampaignErrorCode,
    message: string,
    options: Readonly<{ peerCode?: HgssCampaignPeerBootstrapRejectCode }> = {},
  ) {
    super(message)
    this.name = 'HgssBrowserCampaignError'
    this.code = code
    this.peerCode = options.peerCode
  }
}

type ActiveCampaign = {
  readonly generation: number
  readonly context: BrowserMultiplayerCampaignStartContext
  readonly gateway: HgssCampaignClientGateway
  readonly authority?: HgssCampaignServerCore
  readonly hostBridge?: HgssCampaignPeerHostBridge
  unsubscribeGateway?: () => void
  detachAbort?: () => void
  appliedSnapshotRevision?: number
  queuedSnapshotRevision?: number
  snapshotApplication: Promise<void>
  flushInitialSnapshotOnConnected: boolean
  closing: boolean
  closeOperation?: Promise<void>
}

type BootstrapWaiter = Readonly<{
  promise: Promise<HgssCampaignPeerBootstrapHello | void>
  detach: () => void
}>

type GuestReadyGate = Readonly<{
  promise: Promise<void>
  notify: () => void
  fail: (error: Error) => void
  detach: () => void
}>

type CompleteRosterWaiter = Readonly<{
  promise: Promise<HgssCampaignServerSnapshot>
  detach: () => void
}>

function campaignError(
  code: HgssBrowserCampaignErrorCode,
  message: string,
  peerCode?: HgssCampaignPeerBootstrapRejectCode,
): HgssBrowserCampaignError {
  return new HgssBrowserCampaignError(code, message, peerCode ? { peerCode } : {})
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

function validateBootstrapTimeout(value = 10_000): number {
  if (!Number.isSafeInteger(value) || value < 1_000 || value > 60_000) {
    throw new RangeError('Le délai bootstrap de campagne doit être compris entre 1 000 et 60 000 ms.')
  }
  return value
}

function isSameTile(
  left: HgssCampaignPeerBootstrapPlayer['position'],
  right: HgssCampaignPeerBootstrapPlayer['position'],
): boolean {
  return left.mapId === right.mapId && left.x === right.x && left.z === right.z
}

function isDirectContext(
  context: BrowserMultiplayerCampaignStartContext,
): context is BrowserMultiplayerDirectCampaignStartContext {
  return context.transport === 'server'
}

function validateContext(context: BrowserMultiplayerCampaignStartContext): void {
  if (
    !context
    || !isOnlineNegotiationId(context.sessionId)
    || !isOnlineUserId(context.localParticipantId)
    || !isOnlineUserId(context.remoteParticipantId)
    || context.localParticipantId === context.remoteParticipantId
    || context.role !== 'host' && context.role !== 'guest'
    || !context.signal
    || typeof context.signal.addEventListener !== 'function'
    || typeof context.signal.removeEventListener !== 'function'
    || typeof context.onTerminated !== 'function'
  ) throw campaignError('campaign-route-invalid', 'La route logique de campagne est invalide.')
  if (isDirectContext(context)) {
    if (!isOnlineOpaqueId(context.sessionId)
      || !Number.isSafeInteger(context.rendezvousExpiresAt)
      || context.rendezvousExpiresAt < 1
      || context.rendezvousExpiresAt > 8_640_000_000_000_000
      || Object.hasOwn(context, 'channel')
      || Object.hasOwn(context, 'hostBinding')) {
      throw campaignError('campaign-route-invalid', 'La route serveur directe de campagne est invalide.')
    }
    return
  }
  if (context.transport !== undefined && context.transport !== 'peer'
    || Object.hasOwn(context, 'rendezvousExpiresAt')
    || !context.channel
    || typeof context.channel.attach !== 'function'
    || typeof context.channel.send !== 'function'
    || typeof context.channel.close !== 'function'
    || typeof context.channel.getState !== 'function') {
    throw campaignError('campaign-route-invalid', 'La route pair-à-pair de campagne est invalide.')
  }
  const binding = context.hostBinding
  if (context.role === 'guest' && binding !== undefined) {
    throw campaignError('campaign-route-invalid', "Le pair invité ne peut pas recevoir de binding d'autorité.")
  }
  if (context.role === 'host' && (
    !binding
    || binding.channel !== context.channel
    || binding.peerId !== context.remoteParticipantId
    || binding.playerId !== context.remoteParticipantId
    || binding.negotiationId !== context.sessionId
    || binding.sessionId !== context.sessionId
  )) throw campaignError('campaign-route-invalid', "Le binding logique de l'hôte ne correspond pas à la route attestée.")
}

function localHello(
  context: BrowserMultiplayerCampaignStartContext,
  local: HgssBrowserCampaignLocalPlayer,
): HgssCampaignPeerBootstrapHello {
  const envelope = createHgssCampaignPeerBootstrapEnvelope({
    sessionId: context.sessionId,
    senderId: context.localParticipantId,
    receiverId: context.remoteParticipantId,
  })
  const serialized = encodeHgssCampaignPeerBootstrapFrame({
    ...envelope,
    kind: 'hello',
    gameCode: local.gameCode,
    gameVersion: local.gameVersion,
    language: local.language,
    player: local.player,
  })
  const parsed = decodeHgssCampaignPeerBootstrapFrame(serialized)
  if (!parsed || parsed.kind !== 'hello') {
    throw campaignError('campaign-local-unavailable', 'Le profil local ne peut pas rejoindre une campagne coopérative.')
  }
  return parsed
}

function canonicalLocalPlayer(
  context: BrowserMultiplayerCampaignStartContext,
  candidate: HgssBrowserCampaignLocalPlayer,
): HgssBrowserCampaignLocalPlayer {
  const hello = localHello(context, candidate)
  const sharedProgression = candidate.sharedProgression === undefined
    ? undefined
    : parseHgssCampaignSharedProgression(candidate.sharedProgression)
  if (candidate.sharedProgression !== undefined && !sharedProgression) {
    throw campaignError(
      'campaign-local-unavailable',
      'La progression locale ne peut pas initialiser une campagne coopérative.',
    )
  }
  return Object.freeze({
    gameCode: hello.gameCode,
    gameVersion: hello.gameVersion,
    language: hello.language,
    player: hello.player,
    ...(sharedProgression ? { sharedProgression } : {}),
  })
}

function routeMatches(
  context: BrowserMultiplayerPeerCampaignStartContext,
  frame: Readonly<{ sessionId: string, senderId: string, receiverId: string }>,
): boolean {
  return frame.sessionId === context.sessionId
    && frame.senderId === context.remoteParticipantId
    && frame.receiverId === context.localParticipantId
}

function sendBootstrapReject(
  context: BrowserMultiplayerPeerCampaignStartContext,
  code: HgssCampaignPeerBootstrapRejectCode,
  message: string,
): void {
  context.channel.send(encodeHgssCampaignPeerBootstrapFrame({
    ...createHgssCampaignPeerBootstrapEnvelope({
      sessionId: context.sessionId,
      senderId: context.localParticipantId,
      receiverId: context.remoteParticipantId,
    }),
    kind: 'reject',
    code,
    message,
  }))
}

function sendBootstrapReady(context: BrowserMultiplayerPeerCampaignStartContext): void {
  context.channel.send(encodeHgssCampaignPeerBootstrapFrame({
    ...createHgssCampaignPeerBootstrapEnvelope({
      sessionId: context.sessionId,
      senderId: context.localParticipantId,
      receiverId: context.remoteParticipantId,
    }),
    kind: 'ready',
  }))
}

function waitForHostHello(
  context: BrowserMultiplayerPeerCampaignStartContext,
  timeoutMs: number,
): BootstrapWaiter {
  let detachChannel: (() => void) | undefined
  let detachRequested = false
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = (): void => undefined
  const promise = new Promise<HgssCampaignPeerBootstrapHello>((resolve, reject) => {
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      context.signal.removeEventListener('abort', abort)
      const detach = detachChannel
      detachChannel = undefined
      if (detach) detach()
      else detachRequested = true
    }
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      operation()
    }
    abort = (): void => finish(() => reject(campaignError(
      'campaign-disconnected',
      'La campagne a été fermée pendant son bootstrap.',
    )))
    const handlers: PeerDataChannelHandlers = {
      onOpen: () => undefined,
      onMessage(message) {
        const frame = decodeHgssCampaignPeerBootstrapFrame(message)
        if (!frame || frame.kind !== 'hello' || !routeMatches(context, frame)) {
          finish(() => reject(campaignError(
            'campaign-bootstrap-invalid',
            'Le pair invité a envoyé un bootstrap de campagne invalide.',
          )))
          return
        }
        finish(() => resolve(frame))
      },
      onClose: () => finish(() => reject(campaignError(
        'campaign-disconnected',
        "Le pair invité s'est déconnecté pendant le bootstrap de campagne.",
      ))),
      onError: (error) => finish(() => reject(asError(error, 'Le canal bootstrap de campagne a échoué.'))),
    }
    timer = setTimeout(() => finish(() => reject(campaignError(
      'campaign-bootstrap-timeout',
      "Le pair invité n'a pas rejoint la campagne à temps.",
    ))), timeoutMs)
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) abort()
    if (!settled) {
      try {
        const detach = context.channel.attach(handlers)
        detachChannel = detach
        if (detachRequested || settled) cleanup()
      } catch (error) {
        finish(() => reject(asError(error, "L'écoute du bootstrap de campagne a échoué.")))
      }
    }
  })
  return Object.freeze({
    promise,
    detach: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      context.signal.removeEventListener('abort', abort)
      const detach = detachChannel
      detachChannel = undefined
      if (detach) detach()
      else detachRequested = true
    },
  })
}

function waitForHostDecision(
  context: BrowserMultiplayerPeerCampaignStartContext,
  hello: HgssCampaignPeerBootstrapHello,
  timeoutMs: number,
): BootstrapWaiter {
  let detachChannel: (() => void) | undefined
  let detachRequested = false
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = (): void => undefined
  let hostReady = false
  let helloSent = false
  const promise = new Promise<void>((resolve, reject) => {
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      context.signal.removeEventListener('abort', abort)
      const detach = detachChannel
      detachChannel = undefined
      if (detach) detach()
      else detachRequested = true
    }
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      operation()
    }
    abort = (): void => finish(() => reject(campaignError(
      'campaign-disconnected',
      'La campagne a été fermée pendant son bootstrap.',
    )))
    const handlers: PeerDataChannelHandlers = {
      onOpen: () => undefined,
      onMessage(message) {
        const frame = decodeHgssCampaignPeerBootstrapFrame(message)
        if (!frame || frame.kind === 'hello' || !routeMatches(context, frame)) {
          finish(() => reject(campaignError(
            'campaign-bootstrap-invalid',
            "L'hôte a envoyé une décision bootstrap de campagne invalide.",
          )))
          return
        }
        if (frame.kind === 'ready') {
          if (hostReady || helloSent) {
            finish(() => reject(campaignError(
              'campaign-bootstrap-invalid',
              "L'hôte a répété sa barrière bootstrap de campagne.",
            )))
            return
          }
          hostReady = true
          helloSent = true
          try { context.channel.send(encodeHgssCampaignPeerBootstrapFrame(hello)) }
          catch (error) { finish(() => reject(asError(error, "L'envoi du bootstrap de campagne a échoué."))) }
          return
        }
        if (!hostReady || !helloSent) {
          finish(() => reject(campaignError(
            'campaign-bootstrap-invalid',
            "L'hôte a décidé la campagne avant sa barrière bootstrap.",
          )))
          return
        }
        if (frame.kind === 'reject') {
          finish(() => reject(campaignError('campaign-peer-rejected', frame.message, frame.code)))
          return
        }
        finish(resolve)
      },
      onClose: () => finish(() => reject(campaignError(
        'campaign-disconnected',
        "L'hôte s'est déconnecté pendant le bootstrap de campagne.",
      ))),
      onError: (error) => finish(() => reject(asError(error, 'Le canal bootstrap de campagne a échoué.'))),
    }
    timer = setTimeout(() => finish(() => reject(campaignError(
      'campaign-bootstrap-timeout',
      "L'hôte n'a pas confirmé la campagne à temps.",
    ))), timeoutMs)
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) abort()
    if (!settled) {
      try {
        const detach = context.channel.attach(handlers)
        detachChannel = detach
        if (detachRequested || settled) cleanup()
      } catch (error) {
        finish(() => reject(asError(error, "L'écoute du bootstrap de campagne a échoué.")))
      }
    }
  })
  return Object.freeze({
    promise,
    detach: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      context.signal.removeEventListener('abort', abort)
      const detach = detachChannel
      detachChannel = undefined
      if (detach) detach()
      else detachRequested = true
    },
  })
}

function waitForGuestReady(
  context: BrowserMultiplayerPeerCampaignStartContext,
  timeoutMs: number,
): GuestReadyGate {
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let resolveReady = (): void => undefined
  let rejectReady: (error: Error) => void = () => undefined
  const cleanup = (): void => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    context.signal.removeEventListener('abort', abort)
  }
  const complete = (operation: () => void): void => {
    if (settled) return
    settled = true
    cleanup()
    operation()
  }
  const abort = (): void => complete(() => rejectReady(campaignError(
    'campaign-disconnected',
    "L'invité a quitté la campagne avant sa synchronisation.",
  )))
  const promise = new Promise<void>((resolve, reject) => {
    resolveReady = resolve
    rejectReady = reject
  })
  timer = setTimeout(() => complete(() => rejectReady(campaignError(
    'campaign-bootstrap-timeout',
    "L'invité n'a pas confirmé son snapshot autoritaire à temps.",
  ))), timeoutMs)
  context.signal.addEventListener('abort', abort, { once: true })
  if (context.signal.aborted) abort()
  return Object.freeze({
    promise,
    notify: () => complete(resolveReady),
    fail: (error) => complete(() => rejectReady(error)),
    detach: cleanup,
  })
}

function validateAdmission(value: unknown): HgssBrowserCampaignGuestAdmission {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError("La décision d'admission de campagne est invalide.")
  }
  const decision = value as Record<string, unknown>
  const keys = Object.keys(decision)
  if (decision.kind === 'accept' && keys.length === 1) return Object.freeze({ kind: 'accept' })
  if (
    decision.kind !== 'reject'
    || keys.length !== 3
    || !keys.includes('code')
    || !keys.includes('message')
    || decision.code !== 'position-occupied'
      && decision.code !== 'position-invalid'
      && decision.code !== 'campaign-unavailable'
    || typeof decision.message !== 'string'
    || decision.message.length < 1
  ) throw new TypeError("La décision d'admission de campagne est invalide.")
  return Object.freeze({
    kind: 'reject',
    code: decision.code,
    message: decision.message,
  })
}

function validateInitialSnapshotRoute(
  context: BrowserMultiplayerCampaignStartContext,
  snapshot: HgssCampaignServerSnapshot,
): void {
  const participantIds = snapshot.players.map(({ playerId }) => playerId)
  if (
    snapshot.sessionId !== context.sessionId
    || participantIds.length !== 2
    || new Set(participantIds).size !== 2
    || !participantIds.includes(context.localParticipantId)
    || !participantIds.includes(context.remoteParticipantId)
  ) throw campaignError(
    'campaign-authority-failed',
    "Le snapshot initial ne correspond pas à la session et aux deux participants négociés.",
  )
}

function isCompleteSnapshotRoute(
  context: BrowserMultiplayerCampaignStartContext,
  snapshot: HgssCampaignServerSnapshot,
): boolean {
  const participantIds = snapshot.players.map(({ playerId }) => playerId)
  return snapshot.sessionId === context.sessionId
    && participantIds.length === 2
    && new Set(participantIds).size === 2
    && participantIds.includes(context.localParticipantId)
    && participantIds.includes(context.remoteParticipantId)
}

function validateProvisionalHostSnapshotRoute(
  context: BrowserMultiplayerCampaignStartContext,
  snapshot: HgssCampaignServerSnapshot,
): void {
  const participantIds = snapshot.players.map(({ playerId }) => playerId)
  if (snapshot.sessionId !== context.sessionId
    || participantIds.length !== 1
    || participantIds[0] !== context.localParticipantId) {
    throw campaignError(
      'campaign-authority-failed',
      "Le snapshot provisoire de l'hôte direct est incohérent.",
    )
  }
}

function authoritativePreparation(
  context: BrowserMultiplayerCampaignStartContext,
  local: HgssBrowserCampaignLocalPlayer,
  movementAdmission?: HgssCampaignServerMovementPort,
  sharedEventAdmission?: HgssCampaignSharedEventAdmissionPort,
  guestJoinAdmission?: HgssCampaignGuestJoinAdmissionPort,
) {
  return Object.freeze({
    sessionId: context.sessionId,
    localParticipantId: context.localParticipantId,
    remoteParticipantId: context.remoteParticipantId,
    compatibility: Object.freeze({
      applicationId: local.gameCode,
      release: local.gameVersion,
      locale: local.language,
    }),
    player: Object.freeze({
      displayName: local.player.displayName,
      gender: local.player.gender,
      position: local.player.position,
      spriteId: local.player.spriteId,
    }),
    ...(context.role === 'host' && local.sharedProgression
      ? { sharedProgression: local.sharedProgression }
      : {}),
    ...(movementAdmission ? { movementAdmission } : {}),
    ...(sharedEventAdmission ? { sharedEventAdmission } : {}),
    ...(guestJoinAdmission ? { guestJoinAdmission } : {}),
    ...(isDirectContext(context) && context.role === 'host'
      ? { allowProvisionalHostSnapshot: true as const }
      : {}),
    ...(isDirectContext(context) ? { durableRendezvous: true as const } : {}),
    signal: context.signal,
  })
}

function authoritativeGuestHello(
  context: BrowserMultiplayerCampaignStartContext,
  compatibility: HgssCampaignAuthoritativeCompatibility,
  player: HgssCampaignAuthoritativePlayer,
): HgssCampaignPeerBootstrapHello {
  const serialized = encodeHgssCampaignPeerBootstrapFrame({
    ...createHgssCampaignPeerBootstrapEnvelope({
      sessionId: context.sessionId,
      senderId: context.remoteParticipantId,
      receiverId: context.localParticipantId,
    }),
    kind: 'hello',
    gameCode: compatibility.applicationId,
    gameVersion: compatibility.release,
    language: compatibility.locale,
    player: Object.freeze({ ...player, locomotion: 'walking' as const }),
  })
  const parsed = decodeHgssCampaignPeerBootstrapFrame(serialized)
  if (!parsed || parsed.kind !== 'hello') {
    throw campaignError('campaign-bootstrap-invalid', "Le profil serveur de l'invité est invalide.")
  }
  return parsed
}

function sameBootstrapPlayer(
  left: HgssCampaignPeerBootstrapPlayer,
  right: HgssCampaignPeerBootstrapPlayer,
): boolean {
  return left.displayName === right.displayName
    && left.gender === right.gender
    && left.spriteId === right.spriteId
    && left.locomotion === right.locomotion
    && left.position.mapId === right.position.mapId
    && left.position.x === right.position.x
    && left.position.z === right.position.z
    && left.position.direction === right.position.direction
}

/** Réacquitte côté serveur uniquement le hello RTC déjà admis par la ROM hôte. */
function peerGuestJoinAdmission(
  context: BrowserMultiplayerPeerCampaignStartContext,
  admittedGuest: HgssCampaignPeerBootstrapHello,
): HgssCampaignGuestJoinAdmissionPort {
  return (request) => {
    try {
      if (request.sessionId !== context.sessionId
        || request.playerId !== context.remoteParticipantId) {
        throw campaignError('campaign-route-invalid', "L'invité serveur ne correspond pas au pair admis.")
      }
      validateProvisionalHostSnapshotRoute(context, request.snapshot)
      const candidate = authoritativeGuestHello(context, request.compatibility, request.player)
      if (candidate.gameCode !== admittedGuest.gameCode
        || candidate.gameVersion !== admittedGuest.gameVersion
        || candidate.language !== admittedGuest.language
        || !sameBootstrapPlayer(candidate.player, admittedGuest.player)) {
        throw campaignError('campaign-bootstrap-invalid', "Le profil serveur diverge du pair admis.")
      }
      return Object.freeze({ kind: 'accept' as const })
    } catch {
      return Object.freeze({
        kind: 'reject' as const,
        code: 'campaign-unavailable' as const,
        message: "Le profil serveur de l'invité ne correspond pas au bootstrap admis.",
      })
    }
  }
}

const directGuestRetryableCodes = new Set([
  'session-not-found',
  'session-mutation-in-progress',
  'join-unattested',
])
const directGuestRetryDelaysMs = Object.freeze([100, 250, 500, 1_000])

function isRetryableDirectGuestError(value: unknown): boolean {
  return value instanceof HgssCampaignAuthoritativeServiceError
    && directGuestRetryableCodes.has(value.code)
}

function waitForDirectRetry(signal: AbortSignal, milliseconds: number): Promise<void> {
  if (signal.aborted) return Promise.reject(campaignError(
    'campaign-disconnected',
    'La campagne directe a été annulée pendant son rendez-vous.',
  ))
  return new Promise((resolve, reject) => {
    let settled = false
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal.removeEventListener('abort', abort)
      operation()
    }
    const abort = (): void => finish(() => reject(campaignError(
      'campaign-disconnected',
      'La campagne directe a été annulée pendant son rendez-vous.',
    )))
    const timer = setTimeout(() => finish(resolve), milliseconds)
    signal.addEventListener('abort', abort, { once: true })
    if (signal.aborted) abort()
  })
}

function waitForCompleteRoster(
  context: BrowserMultiplayerDirectCampaignStartContext,
  gateway: HgssCampaignClientGateway,
): CompleteRosterWaiter {
  let detachGateway: (() => void) | undefined
  let detachRequested = false
  let settled = false
  let timer: ReturnType<typeof setTimeout> | undefined
  let abort = (): void => undefined
  const promise = new Promise<HgssCampaignServerSnapshot>((resolve, reject) => {
    const cleanup = (): void => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      context.signal.removeEventListener('abort', abort)
      const detach = detachGateway
      detachGateway = undefined
      if (detach) detach()
      else detachRequested = true
    }
    const finish = (operation: () => void): void => {
      if (settled) return
      settled = true
      cleanup()
      operation()
    }
    abort = (): void => finish(() => reject(campaignError(
      'campaign-disconnected',
      'La campagne directe a été fermée avant son roster complet.',
    )))
    const remaining = context.rendezvousExpiresAt - Date.now()
    if (remaining <= 0) {
      finish(() => reject(campaignError(
        'campaign-bootstrap-timeout',
        "Le rendez-vous direct a expiré avant l'arrivée de l'invité.",
      )))
      return
    }
    timer = setTimeout(() => finish(() => reject(campaignError(
      'campaign-bootstrap-timeout',
      "Le rendez-vous direct a expiré avant l'arrivée de l'invité.",
    ))), Math.min(remaining, 2_147_483_647))
    context.signal.addEventListener('abort', abort, { once: true })
    if (context.signal.aborted) abort()
    if (!settled) {
      detachGateway = gateway.subscribe((state) => {
        if (state.status === 'connected' && state.snapshot
          && isCompleteSnapshotRoute(context, state.snapshot)) {
          finish(() => resolve(state.snapshot!))
        } else if (state.status === 'failed') {
          finish(() => reject(state.error ?? campaignError(
            'campaign-authority-failed',
            "L'autorité directe a échoué avant l'arrivée de l'invité.",
          )))
        } else if (state.status === 'disconnected') {
          finish(() => reject(campaignError(
            'campaign-disconnected',
            "L'autorité directe s'est fermée avant l'arrivée de l'invité.",
          )))
        }
      })
      if (detachRequested || settled) cleanup()
    }
  })
  return Object.freeze({ promise, detach: () => {
    if (timer !== undefined) clearTimeout(timer)
    timer = undefined
    context.signal.removeEventListener('abort', abort)
    const detach = detachGateway
    detachGateway = undefined
    if (detach) detach()
    else detachRequested = true
  } })
}

async function connectGatewayUntilAborted(
  context: BrowserMultiplayerCampaignStartContext,
  gateway: HgssCampaignClientGateway,
): Promise<void> {
  if (context.signal.aborted) throw campaignError(
    'campaign-disconnected',
    'La campagne a été fermée avant sa connexion autoritaire.',
  )
  let rejectAbort: (error: Error) => void = () => undefined
  const cancellation = new Promise<never>((_resolve, reject) => { rejectAbort = reject })
  const abort = (): void => {
    const error = campaignError(
      'campaign-disconnected',
      'La campagne a été fermée pendant sa connexion autoritaire.',
    )
    void gateway.disconnect().catch(() => undefined)
    rejectAbort(error)
  }
  context.signal.addEventListener('abort', abort, { once: true })
  if (context.signal.aborted) abort()
  try { await Promise.race([gateway.connect(), cancellation]) }
  finally { context.signal.removeEventListener('abort', abort) }
}

/**
 * Cycle applicatif de la campagne coopérative. Le canal pair-à-pair atteste
 * encore l'invitation et la compatibilité ; lorsqu'il est fourni, le service
 * autoritaire porte ensuite l'état, les commandes et les snapshots.
 */
export function createHgssBrowserCampaignCoordinator(
  options: HgssBrowserCampaignCoordinatorOptions,
): HgssBrowserCampaignCoordinator {
  if (typeof options.readLocalPlayer !== 'function'
    || typeof options.movement !== 'function'
    || typeof options.authorizeGuestJoin !== 'function') {
    throw new TypeError('Les ports de campagne navigateur sont incomplets.')
  }
  const timeoutMs = validateBootstrapTimeout(options.bootstrapTimeoutMs)
  const listeners = new Set<(state: HgssBrowserCampaignState) => void>()
  let state: HgssBrowserCampaignState = Object.freeze({ status: 'idle' })
  let active: ActiveCampaign | undefined
  let closing: ActiveCampaign | undefined
  let starting: Promise<BrowserMultiplayerCampaignSession> | undefined
  let startingContext: BrowserMultiplayerCampaignStartContext | undefined
  let startingAbort: AbortController | undefined
  let generation = 0

  const publish = (next: HgssBrowserCampaignState): void => {
    state = Object.freeze({ ...next }) as HgssBrowserCampaignState
    for (const listener of listeners) {
      try { listener(state) } catch { /* Un observateur ne pilote jamais la campagne. */ }
    }
  }

  const publishGateway = (
    campaign: ActiveCampaign,
    gatewayState: ReturnType<HgssCampaignClientGateway['getState']>,
  ): void => {
    if (active !== campaign || campaign.closing) return
    if (gatewayState.status === 'connected' && gatewayState.snapshot) {
      const incoming = gatewayState.snapshot
      if (campaign.appliedSnapshotRevision === incoming.revision) {
        if (campaign.flushInitialSnapshotOnConnected) {
          campaign.flushInitialSnapshotOnConnected = false
          const application = campaign.snapshotApplication.then(async () => {
            if (active !== campaign || campaign.closing) return
            await options.onSnapshot?.(incoming, campaign.context.localParticipantId)
            if (active !== campaign || campaign.closing) return
            publish(Object.freeze({
              status: 'connected',
              role: campaign.context.role,
              remoteParticipantId: campaign.context.remoteParticipantId,
              snapshot: incoming,
            }))
          })
          campaign.snapshotApplication = application.catch((error) => {
            const failure = asError(error, "L'application du snapshot de campagne a échoué.")
            void closeCampaign(campaign, failure)
          })
          return
        }
        publish(Object.freeze({
          status: 'connected',
          role: campaign.context.role,
          remoteParticipantId: campaign.context.remoteParticipantId,
          snapshot: incoming,
        }))
        return
      }
      const alreadyQueued = campaign.queuedSnapshotRevision ?? campaign.appliedSnapshotRevision ?? -1
      if (incoming.revision <= alreadyQueued) return
      campaign.queuedSnapshotRevision = incoming.revision
      const application = campaign.snapshotApplication.then(async () => {
        if (active !== campaign || campaign.closing) return
        await options.onSnapshot?.(incoming, campaign.context.localParticipantId)
        if (active !== campaign || campaign.closing) return
        campaign.appliedSnapshotRevision = incoming.revision
        publish(Object.freeze({
          status: 'connected',
          role: campaign.context.role,
          remoteParticipantId: campaign.context.remoteParticipantId,
          snapshot: incoming,
        }))
      })
      campaign.snapshotApplication = application.catch((error) => {
        const failure = asError(error, "L'application du snapshot de campagne a échoué.")
        void closeCampaign(campaign, failure)
      })
      return
    }
    if (gatewayState.status === 'disconnected') void closeCampaign(campaign)
    else if (gatewayState.status === 'failed') void closeCampaign(
      campaign,
      gatewayState.error ?? campaignError('campaign-disconnected', 'La campagne autoritaire a échoué.'),
    )
  }

  const closeCampaign = (
    campaign: ActiveCampaign,
    failure?: Error,
  ): Promise<void> => {
    if (campaign.closing) return campaign.closeOperation ?? Promise.resolve()
    const notifyTermination = active === campaign
    campaign.closing = true
    campaign.detachAbort?.()
    campaign.detachAbort = undefined
    campaign.unsubscribeGateway?.()
    campaign.unsubscribeGateway = undefined
    if (notifyTermination) {
      closing = campaign
      active = undefined
      publish(Object.freeze({
        status: 'closing',
        role: campaign.context.role,
        remoteParticipantId: campaign.context.remoteParticipantId,
      }))
    }
    const operation = (async (): Promise<void> => {
      try { await campaign.gateway.disconnect() } catch { /* Le canal reste terminal. */ }
      try { campaign.hostBridge?.close() } catch { /* Le canal reste terminal. */ }
      if (campaign.authority) {
        try { campaign.authority.leaveSession(campaign.context.sessionId, campaign.context.remoteParticipantId) }
        catch { /* La destruction ci-dessous reste l'autorité de nettoyage. */ }
        try { campaign.authority.destroySession(campaign.context.sessionId) }
        catch { /* Déjà détruite. */ }
      } else if (!isDirectContext(campaign.context)) {
        try { campaign.context.channel.close() } catch { /* Déjà fermé. */ }
      }
      if (notifyTermination) {
        if (closing === campaign) {
          closing = undefined
          if (failure) {
            publish(Object.freeze({
              status: 'failed',
              role: campaign.context.role,
              remoteParticipantId: campaign.context.remoteParticipantId,
              error: failure,
            }))
            try { options.onError?.(failure) } catch { /* Le rapporteur ne pilote jamais la campagne. */ }
          } else publish(Object.freeze({ status: 'idle' }))
        }
        try { campaign.context.onTerminated(failure) }
        catch { /* Le runtime appelant reste propriétaire du transport. */ }
      }
    })()
    campaign.closeOperation = operation
    return operation
  }

  const hostStart = async (
    context: BrowserMultiplayerPeerCampaignStartContext,
    local: HgssBrowserCampaignLocalPlayer,
    currentGeneration: number,
  ): Promise<ActiveCampaign> => {
    const waiter = waitForHostHello(context, timeoutMs)
    let guest: HgssCampaignPeerBootstrapHello
    try {
      sendBootstrapReady(context)
      guest = await waiter.promise as HgssCampaignPeerBootstrapHello
    }
    finally { waiter.detach() }
    const reject = (code: HgssCampaignPeerBootstrapRejectCode, message: string): never => {
      try { sendBootstrapReject(context, code, message) } finally {
        try { context.channel.close() } catch { /* La décision a déjà été envoyée. */ }
      }
      throw campaignError('campaign-peer-rejected', message, code)
    }
    if (
      guest.gameCode !== local.gameCode
      || guest.gameVersion !== local.gameVersion
      || guest.language !== local.language
    ) reject('game-mismatch', 'Les deux joueurs doivent utiliser la même version de la ROM HGSS.')
    if (isSameTile(guest.player.position, local.player.position)) {
      reject('position-occupied', "La position de l'invité est déjà occupée par l'hôte.")
    }
    const admission = (() => {
      try {
        return validateAdmission(options.authorizeGuestJoin({
          sessionId: context.sessionId,
          local,
          guest,
        }))
      } catch {
        return reject('campaign-unavailable', "L'hôte ne peut pas valider la position de départ de la campagne.")
      }
    })()
    if (admission.kind === 'reject') reject(admission.code, admission.message)

    if (options.authoritativeService) {
      let gateway: HgssCampaignClientGateway | undefined
      let campaign: ActiveCampaign | undefined
      let appliedSnapshotRevision: number | undefined
      try {
        const transport = await options.authoritativeService.prepareHost(
          authoritativePreparation(
            context,
            local,
            options.movement,
            options.sharedEventAdmission,
            peerGuestJoinAdmission(context, guest),
          ),
        )
        gateway = createHgssCampaignClientGateway({
          transport,
          localParticipantId: context.localParticipantId,
          applyInitialSnapshot: async (snapshot) => {
            if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
              'campaign-disconnected',
              'La campagne a été fermée avant l\'application de son snapshot initial.',
            )
            validateInitialSnapshotRoute(context, snapshot)
            await options.onSnapshot?.(snapshot, context.localParticipantId)
            appliedSnapshotRevision = snapshot.revision
          },
        })
        context.channel.send(encodeHgssCampaignPeerBootstrapFrame({
          ...createHgssCampaignPeerBootstrapEnvelope({
            sessionId: context.sessionId,
            senderId: context.localParticipantId,
            receiverId: context.remoteParticipantId,
          }),
          kind: 'accept',
        }))
        campaign = {
          generation: currentGeneration,
          context,
          gateway,
          appliedSnapshotRevision,
          snapshotApplication: Promise.resolve(),
          flushInitialSnapshotOnConnected: options.onSnapshot !== undefined,
          closing: false,
        }
        await connectGatewayUntilAborted(context, gateway)
        campaign.appliedSnapshotRevision = appliedSnapshotRevision
        return campaign
      } catch (error) {
        if (campaign) await closeCampaign(campaign)
        else {
          try { await gateway?.disconnect() } catch { /* Le TTL serveur reste le dernier recours. */ }
        }
        throw error
      }
    }

    let authority: HgssCampaignServerCore | undefined
    let hostBridge: HgssCampaignPeerHostBridge | undefined
    let gateway: HgssCampaignClientGateway | undefined
    let campaign: ActiveCampaign | undefined
    let guestReady: GuestReadyGate | undefined
    let appliedSnapshotRevision: number | undefined
    try {
      authority = createHgssCampaignServerCore({ ports: { movement: options.movement } })
      const created = authority.createSession({
        sessionId: context.sessionId,
        host: {
          playerId: context.localParticipantId,
          displayName: local.player.displayName,
          gender: local.player.gender,
          position: local.player.position,
          spriteId: local.player.spriteId,
        },
      })
      if (!created.ok) reject('campaign-unavailable', created.error.message)
      const joined = authority.joinSession(context.sessionId, {
        playerId: context.remoteParticipantId,
        displayName: guest.player.displayName,
        gender: guest.player.gender,
        position: guest.player.position,
        spriteId: guest.player.spriteId,
      })
      if (!joined.ok) reject('campaign-unavailable', joined.error.message)

      context.channel.send(encodeHgssCampaignPeerBootstrapFrame({
        ...createHgssCampaignPeerBootstrapEnvelope({
          sessionId: context.sessionId,
          senderId: context.localParticipantId,
          receiverId: context.remoteParticipantId,
        }),
        kind: 'accept',
      }))
      guestReady = waitForGuestReady(context, timeoutMs)
      hostBridge = createHgssCampaignPeerHostBridge({
        binding: context.hostBinding!,
        authority,
        onError: (error) => {
          guestReady?.fail(error)
          if (campaign) void closeCampaign(campaign, error)
        },
        onClose: (reason) => {
          if (reason === 'remote') guestReady?.fail(campaignError(
            'campaign-disconnected',
            "L'invité a fermé la campagne avant sa synchronisation.",
          ))
          if (campaign && reason === 'remote') void closeCampaign(campaign)
        },
        onGuestReady: guestReady.notify,
      })
      gateway = createHgssCampaignClientGateway({
        transport: createHgssCampaignInMemoryTransport({
          server: authority,
          sessionId: context.sessionId,
          playerId: context.localParticipantId,
        }),
        localParticipantId: context.localParticipantId,
        applyInitialSnapshot: async (snapshot) => {
          if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
            'campaign-disconnected',
            'La campagne a été fermée avant l\'application de son snapshot initial.',
          )
          validateInitialSnapshotRoute(context, snapshot)
          await options.onSnapshot?.(snapshot, context.localParticipantId)
          appliedSnapshotRevision = snapshot.revision
        },
      })
      campaign = {
        generation: currentGeneration,
        context,
        gateway,
        authority,
        hostBridge,
        appliedSnapshotRevision,
        snapshotApplication: Promise.resolve(),
        flushInitialSnapshotOnConnected: options.onSnapshot !== undefined,
        closing: false,
      }
      if (hostBridge.isClosed()) throw campaignError(
        'campaign-disconnected',
        "L'invité a fermé la campagne avant sa synchronisation.",
      )
      await connectGatewayUntilAborted(context, gateway)
      campaign.appliedSnapshotRevision = appliedSnapshotRevision
      await guestReady.promise
      guestReady.detach()
      guestReady = undefined
      return campaign
    } catch (error) {
      guestReady?.detach()
      if (campaign) await closeCampaign(campaign)
      else {
        try { await gateway?.disconnect() } catch { /* La route reste terminale. */ }
        try { hostBridge?.close() } catch { /* La route reste terminale. */ }
        if (authority) {
          try { authority.leaveSession(context.sessionId, context.remoteParticipantId) } catch { /* Absente. */ }
          try { authority.destroySession(context.sessionId) } catch { /* Absente. */ }
        }
      }
      throw error
    }
  }

  const guestStart = async (
    context: BrowserMultiplayerPeerCampaignStartContext,
    local: HgssBrowserCampaignLocalPlayer,
    currentGeneration: number,
  ): Promise<ActiveCampaign> => {
    const hello = localHello(context, local)
    const waiter = waitForHostDecision(context, hello, timeoutMs)
    try { await waiter.promise } finally { waiter.detach() }
    let campaign: ActiveCampaign | undefined
    try {
      let appliedSnapshotRevision: number | undefined
      const authoritativeTransport = options.authoritativeService
        ? await options.authoritativeService.prepareGuest(authoritativePreparation(context, local))
        : undefined
      const gateway = createHgssCampaignClientGateway({
        transport: authoritativeTransport
          ?? createHgssCampaignPeerGuestTransport({ channel: context.channel }),
        localParticipantId: context.localParticipantId,
        applyInitialSnapshot: async (snapshot) => {
          if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
            'campaign-disconnected',
            'La campagne a été fermée avant l\'application de son snapshot initial.',
          )
          validateInitialSnapshotRoute(context, snapshot)
          await options.onSnapshot?.(snapshot, context.localParticipantId)
          appliedSnapshotRevision = snapshot.revision
        },
      })
      campaign = {
        generation: currentGeneration,
        context,
        gateway,
        appliedSnapshotRevision,
        snapshotApplication: Promise.resolve(),
        flushInitialSnapshotOnConnected: options.onSnapshot !== undefined,
        closing: false,
      }
      await connectGatewayUntilAborted(context, gateway)
      campaign.appliedSnapshotRevision = appliedSnapshotRevision
      return campaign
    } catch (error) {
      if (campaign) await closeCampaign(campaign)
      throw error
    }
  }

  const directGuestJoinAdmission = (
    context: BrowserMultiplayerDirectCampaignStartContext,
    local: HgssBrowserCampaignLocalPlayer,
  ): HgssCampaignGuestJoinAdmissionPort => (request) => {
    try {
      if (request.sessionId !== context.sessionId
        || request.playerId !== context.remoteParticipantId) {
        throw campaignError(
          'campaign-route-invalid',
          "La demande serveur ne correspond pas à l'invité négocié.",
        )
      }
      validateProvisionalHostSnapshotRoute(context, request.snapshot)
      const guest = authoritativeGuestHello(context, request.compatibility, request.player)
      if (guest.gameCode !== local.gameCode
        || guest.gameVersion !== local.gameVersion
        || guest.language !== local.language) {
        return Object.freeze({
          kind: 'reject' as const,
          code: 'campaign-unavailable',
          message: 'Les deux joueurs doivent utiliser la même version de la ROM HGSS.',
        })
      }
      if (isSameTile(guest.player.position, local.player.position)) {
        return Object.freeze({
          kind: 'reject' as const,
          code: 'position-occupied',
          message: "La position de l'invité est déjà occupée par l'hôte.",
        })
      }
      return validateAdmission(options.authorizeGuestJoin({
        sessionId: request.sessionId,
        local,
        guest,
      }))
    } catch {
      return Object.freeze({
        kind: 'reject' as const,
        code: 'campaign-unavailable',
        message: "L'hôte ne peut pas valider la position de départ de la campagne.",
      })
    }
  }

  const directHostStart = async (
    context: BrowserMultiplayerDirectCampaignStartContext,
    local: HgssBrowserCampaignLocalPlayer,
    currentGeneration: number,
  ): Promise<ActiveCampaign> => {
    const service = options.authoritativeService
    if (!service) throw campaignError(
      'campaign-authority-failed',
      "L'autorité serveur est obligatoire pour une campagne directe.",
    )
    let gateway: HgssCampaignClientGateway | undefined
    let rosterWaiter: CompleteRosterWaiter | undefined
    let appliedSnapshotRevision: number | undefined
    try {
      const transport = await service.prepareHost(authoritativePreparation(
        context,
        local,
        options.movement,
        options.sharedEventAdmission,
        directGuestJoinAdmission(context, local),
      ))
      gateway = createHgssCampaignClientGateway({
        transport,
        localParticipantId: context.localParticipantId,
        applyInitialSnapshot: async (snapshot) => {
          if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
            'campaign-disconnected',
            "La campagne directe a été fermée avant l'application de son snapshot initial.",
          )
          if (isCompleteSnapshotRoute(context, snapshot)) {
            await options.onSnapshot?.(snapshot, context.localParticipantId)
            appliedSnapshotRevision = snapshot.revision
            return
          }
          validateProvisionalHostSnapshotRoute(context, snapshot)
        },
      })
      await connectGatewayUntilAborted(context, gateway)
      if (appliedSnapshotRevision === undefined) {
        rosterWaiter = waitForCompleteRoster(context, gateway)
        const complete = await rosterWaiter.promise
        if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
          'campaign-disconnected',
          "La campagne directe a été fermée avant l'application du roster complet.",
        )
        await options.onSnapshot?.(complete, context.localParticipantId)
        appliedSnapshotRevision = complete.revision
      }
      return {
        generation: currentGeneration,
        context,
        gateway,
        appliedSnapshotRevision,
        snapshotApplication: Promise.resolve(),
        flushInitialSnapshotOnConnected: options.onSnapshot !== undefined,
        closing: false,
      }
    } catch (error) {
      try { await gateway?.disconnect() } catch { /* Le serveur garde son TTL de secours. */ }
      throw error
    } finally {
      rosterWaiter?.detach()
    }
  }

  const directGuestStart = async (
    context: BrowserMultiplayerDirectCampaignStartContext,
    local: HgssBrowserCampaignLocalPlayer,
    currentGeneration: number,
  ): Promise<ActiveCampaign> => {
    const service = options.authoritativeService
    if (!service) throw campaignError(
      'campaign-authority-failed',
      "L'autorité serveur est obligatoire pour une campagne directe.",
    )
    let transport: Awaited<ReturnType<HgssCampaignAuthoritativeService['prepareGuest']>> | undefined
    let retryIndex = 0
    while (!transport) {
      if (context.signal.aborted) throw campaignError(
        'campaign-disconnected',
        'La campagne directe a été fermée avant son admission.',
      )
      if (Date.now() >= context.rendezvousExpiresAt) throw campaignError(
        'campaign-bootstrap-timeout',
        "Le rendez-vous direct a expiré avant l'admission de l'invité.",
      )
      try {
        const prepared = await service.prepareGuest(authoritativePreparation(context, local))
        if (Date.now() >= context.rendezvousExpiresAt) {
          try { await prepared.disconnect() } catch { /* Le TTL serveur reste le dernier recours. */ }
          throw campaignError(
            'campaign-bootstrap-timeout',
            "Le rendez-vous direct a expiré avant l'admission de l'invité.",
          )
        }
        transport = prepared
      } catch (error) {
        if (context.signal.aborted) throw campaignError(
          'campaign-disconnected',
          'La campagne directe a été fermée pendant son admission.',
        )
        const remaining = context.rendezvousExpiresAt - Date.now()
        if (!isRetryableDirectGuestError(error)) throw error
        if (remaining <= 0) throw campaignError(
          'campaign-bootstrap-timeout',
          "Le rendez-vous direct a expiré avant l'admission de l'invité.",
        )
        const delay = directGuestRetryDelaysMs[Math.min(
          retryIndex,
          directGuestRetryDelaysMs.length - 1,
        )]!
        retryIndex += 1
        await waitForDirectRetry(context.signal, Math.min(delay, remaining))
      }
    }
    let gateway: HgssCampaignClientGateway | undefined
    let appliedSnapshotRevision: number | undefined
    try {
      gateway = createHgssCampaignClientGateway({
        transport,
        localParticipantId: context.localParticipantId,
        applyInitialSnapshot: async (snapshot) => {
          if (currentGeneration !== generation || context.signal.aborted) throw campaignError(
            'campaign-disconnected',
            "La campagne directe a été fermée avant l'application de son snapshot initial.",
          )
          validateInitialSnapshotRoute(context, snapshot)
          await options.onSnapshot?.(snapshot, context.localParticipantId)
          appliedSnapshotRevision = snapshot.revision
        },
      })
      await connectGatewayUntilAborted(context, gateway)
      return {
        generation: currentGeneration,
        context,
        gateway,
        appliedSnapshotRevision,
        snapshotApplication: Promise.resolve(),
        flushInitialSnapshotOnConnected: options.onSnapshot !== undefined,
        closing: false,
      }
    } catch (error) {
      try { await gateway?.disconnect() } catch { /* Le serveur garde son TTL de secours. */ }
      throw error
    }
  }

  const start = (
    context: BrowserMultiplayerCampaignStartContext,
  ): Promise<BrowserMultiplayerCampaignSession> => {
    if (starting || active || closing) {
      return Promise.reject(campaignError('campaign-already-active', 'Une campagne coopérative est déjà active.'))
    }
    let local: HgssBrowserCampaignLocalPlayer
    try {
      validateContext(context)
      if (context.signal.aborted) throw campaignError(
        'campaign-disconnected',
        'La campagne a été fermée avant son bootstrap.',
      )
      const candidate = options.readLocalPlayer()
      if (!candidate) throw campaignError(
        'campaign-local-unavailable',
        'La partie locale doit être prête avant de rejoindre une campagne coopérative.',
      )
      local = canonicalLocalPlayer(context, candidate)
    } catch (error) {
      return Promise.reject(error)
    }
    generation += 1
    const currentGeneration = generation
    const operationAbort = new AbortController()
    const operationContext: BrowserMultiplayerCampaignStartContext = isDirectContext(context)
      ? Object.freeze({ ...context, signal: operationAbort.signal })
      : Object.freeze({ ...context, signal: operationAbort.signal })
    let abortAttached = true
    const detachAbort = (): void => {
      if (!abortAttached) return
      abortAttached = false
      context.signal.removeEventListener('abort', abortLifecycle)
    }
    const abortLifecycle = (): void => {
      if (!operationAbort.signal.aborted) operationAbort.abort(context.signal.reason)
      if (currentGeneration === generation) generation += 1
      const campaign = active
      if (campaign?.generation === currentGeneration) void closeCampaign(campaign)
      else if (!isDirectContext(operationContext)) {
        try { operationContext.channel.close() } catch { /* La route est déjà terminale. */ }
      }
    }
    context.signal.addEventListener('abort', abortLifecycle, { once: true })
    if (context.signal.aborted) abortLifecycle()
    startingContext = operationContext
    startingAbort = operationAbort
    publish(Object.freeze({
      status: 'connecting',
      role: context.role,
      remoteParticipantId: context.remoteParticipantId,
    }))
    const operation = (async (): Promise<BrowserMultiplayerCampaignSession> => {
      let provisional: ActiveCampaign | undefined
      try {
        const campaign = isDirectContext(operationContext)
          ? operationContext.role === 'host'
            ? await directHostStart(operationContext, local, currentGeneration)
            : await directGuestStart(operationContext, local, currentGeneration)
          : operationContext.role === 'host'
            ? await hostStart(operationContext, local, currentGeneration)
            : await guestStart(operationContext, local, currentGeneration)
        provisional = campaign
        campaign.detachAbort = detachAbort
        if (currentGeneration !== generation) {
          await closeCampaign(campaign)
          provisional = undefined
          throw campaignError('campaign-disconnected', 'La campagne a été fermée pendant sa connexion.')
        }
        active = campaign
        const unsubscribeGateway = campaign.gateway.subscribe((next) => {
          publishGateway(campaign, next)
        })
        campaign.unsubscribeGateway = unsubscribeGateway
        if (campaign.closing) {
          unsubscribeGateway()
          campaign.unsubscribeGateway = undefined
        }
        const gatewayState = campaign.gateway.getState()
        if (gatewayState.status !== 'connected' || !gatewayState.snapshot) {
          throw campaignError('campaign-authority-failed', "La campagne n'a fourni aucun snapshot autoritaire.")
        }
        // L'ouverture n'est réellement terminée qu'après la seconde
        // application du snapshot initial en état `connected`. Cette barrière
        // permet au journal durable de reprendre ses ACK sans rendre au jeu un
        // handle encore inutilisable.
        await campaign.snapshotApplication
        if (campaign.closing || active !== campaign || state.status !== 'connected') {
          throw campaignError(
            'campaign-authority-failed',
            "Le snapshot initial n'a pas terminé son application durable.",
          )
        }
        let handleClosed = false
        return Object.freeze({
          async close() {
            if (handleClosed) return
            handleClosed = true
            await closeCampaign(campaign)
          },
        })
      } catch (value) {
        if (provisional && !provisional.closing) await closeCampaign(provisional)
        detachAbort()
        const error = asError(value, "L'ouverture de la campagne coopérative a échoué.")
        if (!isDirectContext(operationContext)) {
          try { operationContext.channel.close() } catch { /* La route est déjà terminale. */ }
        }
        const cancelled = currentGeneration !== generation || operationContext.signal.aborted
        if (cancelled) publish(Object.freeze({ status: 'idle' }))
        else {
          publish(Object.freeze({
            status: 'failed',
            role: context.role,
            remoteParticipantId: context.remoteParticipantId,
            error,
          }))
          try { options.onError?.(error) } catch { /* Le rapporteur ne pilote jamais la campagne. */ }
        }
        throw error
      }
    })()
    starting = operation
    void operation.then(
      () => {
        if (starting === operation) starting = undefined
        if (startingContext === operationContext) startingContext = undefined
        if (startingAbort === operationAbort) startingAbort = undefined
      },
      () => {
        if (starting === operation) starting = undefined
        if (startingContext === operationContext) startingContext = undefined
        if (startingAbort === operationAbort) startingAbort = undefined
      },
    )
    return operation
  }

  const port: BrowserMultiplayerCampaignPort = Object.freeze({ start })
  return Object.freeze({
    port,
    getState: () => state,
    getGateway: () => active?.gateway,
    subscribe(listener) {
      listeners.add(listener)
      try { listener(state) } catch { /* Un observateur ne pilote jamais la campagne. */ }
      return () => { listeners.delete(listener) }
    },
    async close() {
      generation += 1
      const campaign = active
      const closingCampaign = closing
      const pending = starting
      if (campaign) await closeCampaign(campaign)
      else if (closingCampaign) await closeCampaign(closingCampaign)
      else if (pending) {
        startingAbort?.abort(campaignError(
          'campaign-disconnected',
          'La campagne a été fermée pendant sa connexion.',
        ))
        if (startingContext && !isDirectContext(startingContext)) {
          try { startingContext.channel.close() } catch { /* La route est déjà terminale. */ }
        }
        await pending.catch(() => undefined)
      } else publish(Object.freeze({ status: 'idle' }))
    },
  })
}
