import {
  createOnlineProductController,
  type OnlineProductController,
  type OnlineProductControllerOptions,
  type OnlineProductState,
} from '../../online/onlineProductController'
import {
  readOnlineClientConfig,
  readOnlineRtcConfiguration,
} from '../../online/onlineClientConfig'
import {
  hasOnlineAccountEntitlement,
  readBrowserOnlineAccountSession,
  type OnlineAccount,
  type OnlineAccountCredentials,
  type OnlineAccountSession,
} from '../../online/onlineAccountSession'
import { OnlineServiceError } from '../../online/onlineSocialClient'
import {
  createPeerDataChannelMultiplexer,
  type PeerDataChannelMultiplexer,
} from '../../online/peerDataChannelMultiplexer'
import {
  generateOnlineOpaqueId,
  isOnlineOpaqueId,
  isOnlineUserId,
} from '../../online/onlineServiceProtocol'
import type { OnlineMatchmakingStatus } from '../../online/onlineMatchmakingProtocol'
import type {
  OnlineCoopRendezvousCurrent,
  OnlineCoopRendezvousInvitation,
  OnlineCoopRendezvousSnapshot,
} from '../../online/onlineCoopRendezvousProtocol'
import {
  consumeIssuedRtcPeerConnectionLink,
  readRtcPeerConnectionAvailability,
  type RtcPeerConnectionAvailability,
  type RtcPeerConnectionLink,
} from '../../online/rtcPeerConnectionSession'
import type { RtcSignalingInvitation } from '../../online/rtcSignalingCoordinator'
import {
  createMultiplayerUiShell,
  type MultiplayerConnectionState,
  type MultiplayerHubState,
  type MultiplayerSessionRequest,
  type MultiplayerSessionState,
  type MultiplayerTradeOfferPreview,
  type MultiplayerTradeState,
  type MultiplayerUiPorts,
  type MultiplayerUiPresentationEvent,
  type MultiplayerUiShell,
  type MultiplayerUiSnapshot,
} from '../ui/multiplayerUiShell'
import type { MultiplayerRomLabels } from '../ui/multiplayerRomLabels'
import {
  createHgssP2pTradeCoordinator,
  type HgssP2pTradeCommitResult,
  type HgssP2pTradeCoordinator,
  type HgssP2pTradeCoordinatorSnapshot,
  type HgssP2pTradeEscrowPort,
} from './hgssP2pTradeCoordinator'
import {
  decodeHgssP2pTradeFrame,
  encodeHgssP2pTradeFrame,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'
import {
  presentHgssP2pTradeOffer,
  type HgssP2pTradeOfferPresentationResources,
} from './hgssP2pTradeOfferPresentation'
import type { HgssP2pTradeJournal } from './hgssP2pTradeJournal'
import {
  classifyHgssP2pTradeRecoverySequence,
  decodeHgssP2pTradeRecoveryFrame,
  encodeHgssP2pTradeRecoveryFrame,
  hgssP2pTradeRecoveryProtocol,
  type HgssP2pTradeRecoveryFrame,
  type HgssP2pTradeRecoverySummary,
} from './hgssP2pTradeRecoveryProtocol'
import {
  decodeP2pSessionIntentFrame,
  encodeP2pSessionIntentFrame,
  isP2pSessionIntent,
  p2pSessionIntentProtocol,
  p2pSessionIntentProtocolVersion,
  type P2pSessionIntent,
  type P2pSessionIntentFrame,
  type P2pSessionIntentRejectReason,
} from './p2pSessionIntentProtocol'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  isBrowserMultiplayerCampaignConnectionReplacedError,
  type BrowserMultiplayerCampaignPort,
  type BrowserMultiplayerCampaignSession,
} from './browserMultiplayerCampaignPort'
import { createHgssCampaignPeerLogicalHostBinding } from './hgssCampaignPeerBridge'

export const browserMultiplayerSessionChannelId = 'session' as const
export const browserMultiplayerTradeChannelId = 'trade' as const
export const browserMultiplayerCampaignChannelId = 'campaign' as const
export const browserMultiplayerTradeSessionProtocol = 'pokemaster-p2p-transaction' as const
export const browserMultiplayerTradeSessionProtocolVersion = 1 as const

export type BrowserMultiplayerTradeSelection =
  | Readonly<{ kind: 'offer', pokemon: HgssP2pTradePokemonSnapshot }>
  | Readonly<{ kind: 'withdraw' }>
  | Readonly<{ kind: 'cancel' }>

export type BrowserMultiplayerRecoveryEscrowPort = Readonly<{
  listRecoveryJournals: (remoteParticipantId: string) => readonly HgssP2pTradeJournal[]
  reconcileRecovery: (
    remoteJournal: HgssP2pTradeJournal,
    localParticipantId: string,
    remoteParticipantId: string,
  ) => Promise<Readonly<{
    kind: 'missing' | 'prepared' | 'committed'
    journal?: HgssP2pTradeJournal
    commitResult?: HgssP2pTradeCommitResult
  }>>
  finalizeRecovery: (
    transactionId: string,
    remoteParticipantId: string,
    disposition: 'confirmed-committed' | 'cancel-prepared',
  ) => Promise<boolean>
}>

export type BrowserMultiplayerGamePorts = Readonly<{
  escrow: HgssP2pTradeEscrowPort & Partial<BrowserMultiplayerRecoveryEscrowPort>
  presentationResources: HgssP2pTradeOfferPresentationResources
  /** Ouvre le vrai sélecteur du jeu. `cancel` ne modifie pas l'offre courante. */
  chooseLocalTradeOffer: (request: Readonly<{
    currentPokemonId?: PokemonInstanceId
  }>) => Promise<BrowserMultiplayerTradeSelection> | BrowserMultiplayerTradeSelection
  cancelLocalTradeOfferSelection?: () => void
  onTradeCommitted?: (result: HgssP2pTradeCommitResult) => Promise<void> | void
  onTradeRecoveryRequired?: (snapshot: HgssP2pTradeCoordinatorSnapshot) => Promise<void> | void
  /** Son absence garde la Coop invisible et interdit tout faux démarrage. */
  campaign?: BrowserMultiplayerCampaignPort
  reportError?: (error: Error, area: 'connection' | 'social' | 'session' | 'trade') => void
}>

export type BrowserMultiplayerScheduler = Readonly<{
  setInterval: (callback: () => void, milliseconds: number) => unknown
  clearInterval: (handle: unknown) => void
}>

export type BrowserMultiplayerRuntimeOptions = Readonly<{
  root: HTMLElement
  game: BrowserMultiplayerGamePorts
  onlineController?: OnlineProductController
  onlineControllerOptions?: OnlineProductControllerOptions
  /** Injection d'intégration; le navigateur utilise sinon sa session de compte persistante. */
  accountSession?: OnlineAccountSession
  uiFactory?: typeof createMultiplayerUiShell
  /** La gestion du compte reste au titre lorsque cette option est fausse. */
  accountManagement?: boolean
  uiLabels?: MultiplayerRomLabels
  uiPresentation?: (event: MultiplayerUiPresentationEvent) => void
  transactionIdFactory?: () => string
  rtcLinkConsumer?: (value: unknown) => value is RtcPeerConnectionLink
  /** Capacité explicite pour les intégrateurs; le navigateur est sondé sinon. */
  rtcAvailability?: RtcPeerConnectionAvailability
  /** Politique d'intégration directe; l'intention choisie dans le hub reste prioritaire. */
  defaultSessionIntent?: P2pSessionIntent
  /** Polling HTTP du rendez-vous; distinct des timers RTC et transactionnels. */
  matchmakingPollMs?: number
  /** Délai du seul accord d'intention, avant tout protocole applicatif. */
  intentHandshakeTimeoutMs?: number
  tradeTimeoutMs?: number
  scheduler?: BrowserMultiplayerScheduler
  /** Horloge d'intégration utilisée pour borner les rendez-vous Coop directs. */
  now?: () => number
}>

export type BrowserMultiplayerRuntime = Readonly<{
  getSnapshot: () => MultiplayerUiSnapshot
  getIntentSessionState: () => BrowserMultiplayerIntentSessionState
  subscribeIntentSession: (listener: (state: BrowserMultiplayerIntentSessionState) => void) => () => void
  requestFriendSession: (userId: string, intent: P2pSessionIntent) => void
  acceptSessionInvitation: (invitationId: string, expectedIntent?: P2pSessionIntent) => void
  getOnlineController: () => OnlineProductController
  /** Draine les transactions locales puis détache le réseau avant de rendre le bail de sauvegarde. */
  prepareForPageRelease: () => Promise<void>
  destroy: () => Promise<void>
}>

export type BrowserMultiplayerIntentSessionState =
  | Readonly<{ status: 'idle' }>
  | Readonly<{ status: 'searching', intent: P2pSessionIntent }>
  | Readonly<{
    status: 'requesting'
    peerUserId: string
    intent: P2pSessionIntent
    direction: 'outbound' | 'inbound'
  }>
  | Readonly<{
    status: 'handshaking'
    peerUserId: string
    role: 'host' | 'guest'
    expectedIntent?: P2pSessionIntent
  }>
  | Readonly<{
    status: 'consent'
    peerUserId: string
    role: 'guest'
    remoteIntent: P2pSessionIntent
  }>
  | Readonly<{
    status: 'ready'
    peerUserId: string
    role: 'host' | 'guest'
    intent: P2pSessionIntent
    gameplay: 'trade-armed' | 'campaign-starting' | 'campaign-armed' | 'not-wired'
  }>
  | Readonly<{
    status: 'rejected' | 'error'
    peerUserId: string
    role: 'host' | 'guest'
    expectedIntent?: P2pSessionIntent
    remoteIntent?: P2pSessionIntent
    message: string
  }>

type PendingSessionIntent = Readonly<{
  direction: 'outbound' | 'inbound'
  source: 'friend' | 'matchmaking'
  peerUserId: string
  intent?: P2pSessionIntent
  invitationId?: string
  negotiationId?: string
}>

type TradeSessionHandshake = Readonly<{
  protocol: typeof browserMultiplayerTradeSessionProtocol
  protocolVersion: typeof browserMultiplayerTradeSessionProtocolVersion
  kind: 'open' | 'open-ack' | 'open-cancel'
  transactionId: string
}>

type PeerContext = {
  readonly link: RtcPeerConnectionLink
  readonly sessionId: string
  readonly localParticipantId: string
  readonly remoteParticipantId: string
  readonly role: 'host' | 'guest'
  readonly multiplexer: PeerDataChannelMultiplexer
  readonly intentChannel: ReturnType<PeerDataChannelMultiplexer['getChannel']>
  readonly tradeChannel: ReturnType<PeerDataChannelMultiplexer['getChannel']>
  readonly campaignChannel: ReturnType<PeerDataChannelMultiplexer['getChannel']>
  queue: Promise<void>
  callbacks: Promise<void>
  closed: boolean
  detachOperation?: Promise<void>
  tradeProtocolClosed: boolean
  tradeArmed: boolean
  tradeOpen: boolean
  pendingTransactionId?: string
  transactionId?: string
  coordinator?: HgssP2pTradeCoordinator
  detachIntentChannel?: () => void
  detachTradeChannel?: () => void
  campaignAbort?: AbortController
  campaignStart?: Promise<void>
  campaignSession?: BrowserMultiplayerCampaignSession
  intentTimer?: unknown
  timer?: unknown
  localPresentationRevision?: number
  remotePresentationRevision?: number
  localPresentation?: MultiplayerTradeOfferPreview
  remotePresentation?: MultiplayerTradeOfferPreview
  commitNotified: boolean
  tradeError?: Error
  selectionSerial: number
  recovery?: RecoveryContext
  intent: PeerIntentContext
}

type DirectCampaignContext = {
  readonly generation: number
  readonly sessionId: string
  readonly localParticipantId: string
  readonly remoteParticipantId: string
  readonly role: 'host' | 'guest'
  readonly expiresAt: number
  readonly abort: AbortController
  transferred: boolean
  phase: 'starting' | 'armed' | 'closing'
  start?: Promise<void>
  session?: BrowserMultiplayerCampaignSession
  closeOperation?: Promise<void>
}

type DirectCampaignRetry = Readonly<{
  attempts: number
  notBefore: number
  sessionId: string
}>

type PeerIntentContext = {
  phase: 'handshaking' | 'ready' | 'rejected' | 'error'
  readonly expectedIntent?: P2pSessionIntent
  negotiatedIntent?: P2pSessionIntent
  remoteOfferedIntent?: P2pSessionIntent
  localSent: boolean
  remoteSequence: number
  remoteFingerprint?: string
  settled: boolean
  readonly settle: () => void
  readonly settledPromise: Promise<void>
}

type RecoveryContext = {
  readonly escrow: BrowserMultiplayerRecoveryEscrowPort
  localSequence: number
  remoteSequence: number
  started: boolean
  active: boolean
  ready: boolean
  readonly settleReady: () => void
  readonly readyPromise: Promise<void>
  remoteSummaries?: Map<string, HgssP2pTradeRecoverySummary['phase']>
  readonly receivedInitialTransactions: Set<string>
  readonly knownTransactions: Set<string>
  readonly sentJournalFingerprints: Map<string, string>
  readonly notifiedTransactions: Set<string>
  readonly unresolvedTransactions: Set<string>
}

function createRecoveryContext(escrow: BrowserMultiplayerRecoveryEscrowPort): RecoveryContext {
  let settleReady = (): void => undefined
  const readyPromise = new Promise<void>((resolve) => { settleReady = resolve })
  return {
    escrow,
    localSequence: 0,
    remoteSequence: 0,
    started: false,
    active: false,
    ready: false,
    settleReady,
    readyPromise,
    receivedInitialTransactions: new Set<string>(),
    knownTransactions: new Set<string>(),
    sentJournalFingerprints: new Map<string, string>(),
    notifiedTransactions: new Set<string>(),
    unresolvedTransactions: new Set<string>(),
  }
}

function createPeerIntentContext(expectedIntent: P2pSessionIntent | undefined): PeerIntentContext {
  let settle = (): void => undefined
  const settledPromise = new Promise<void>((resolve) => { settle = resolve })
  return {
    phase: 'handshaking',
    ...(expectedIntent ? { expectedIntent } : {}),
    localSent: false,
    remoteSequence: 0,
    settled: false,
    settle,
    settledPromise,
  }
}

type HandshakeDecode =
  | Readonly<{ kind: 'not-handshake' }>
  | Readonly<{ kind: 'invalid-handshake' }>
  | Readonly<{ kind: 'handshake', value: TradeSessionHandshake }>

function exactRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => {
    if (typeof key !== 'string') return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  return value as Record<string, unknown>
}

function decodeHandshake(message: string): HandshakeDecode {
  let decoded: unknown
  try { decoded = JSON.parse(message) } catch { return { kind: 'not-handshake' } }
  const record = exactRecord(decoded)
  if (!record || record.protocol !== browserMultiplayerTradeSessionProtocol) return { kind: 'not-handshake' }
  if (new TextEncoder().encode(message).byteLength > 1_024) return { kind: 'invalid-handshake' }
  const keys = Object.keys(record).sort()
  if (
    keys.length !== 4
    || keys[0] !== 'kind'
    || keys[1] !== 'protocol'
    || keys[2] !== 'protocolVersion'
    || keys[3] !== 'transactionId'
    || record.protocolVersion !== browserMultiplayerTradeSessionProtocolVersion
    || record.kind !== 'open' && record.kind !== 'open-ack' && record.kind !== 'open-cancel'
    || !isOnlineOpaqueId(record.transactionId)
  ) return { kind: 'invalid-handshake' }
  return {
    kind: 'handshake',
    value: Object.freeze({
      protocol: browserMultiplayerTradeSessionProtocol,
      protocolVersion: browserMultiplayerTradeSessionProtocolVersion,
      kind: record.kind,
      transactionId: record.transactionId,
    }),
  }
}

function encodeHandshake(kind: TradeSessionHandshake['kind'], transactionId: string): string {
  if (!isOnlineOpaqueId(transactionId)) throw new TypeError("L'identifiant de transaction P2P est invalide.")
  return JSON.stringify({
    protocol: browserMultiplayerTradeSessionProtocol,
    protocolVersion: browserMultiplayerTradeSessionProtocolVersion,
    kind,
    transactionId,
  })
}

function asError(value: unknown, fallback: string): Error {
  return value instanceof Error ? value : new Error(fallback)
}

const directCoopInvitationPrefix = 'coop:'

function directCoopInvitationId(sessionId: string): string {
  return `${directCoopInvitationPrefix}${sessionId}`
}

function validateTradeTimeout(value: number | undefined): number {
  const resolved = value ?? 60_000
  if (!Number.isSafeInteger(resolved) || resolved < 1_000 || resolved > 86_400_000) {
    throw new RangeError("Le délai d'expiration d'un échange doit être compris entre 1 000 ms et 24 heures.")
  }
  return resolved
}

function validateMatchmakingPoll(value: number | undefined): number {
  const resolved = value ?? 350
  if (!Number.isSafeInteger(resolved) || resolved < 250 || resolved > 500) {
    throw new RangeError('Le polling du matchmaking doit être compris entre 250 et 500 ms.')
  }
  return resolved
}

function validateIntentHandshakeTimeout(value: number | undefined): number {
  const resolved = value ?? 10_000
  if (!Number.isSafeInteger(resolved) || resolved < 1_000 || resolved > 60_000) {
    throw new RangeError("Le délai d'accord d'intention P2P doit être compris entre 1 000 et 60 000 ms.")
  }
  return resolved
}

function defaultScheduler(): BrowserMultiplayerScheduler {
  return Object.freeze({
    setInterval: (callback, milliseconds) => globalThis.setInterval(callback, milliseconds),
    clearInterval: (handle) => globalThis.clearInterval(handle as ReturnType<typeof globalThis.setInterval>),
  })
}

function isTerminalTrade(snapshot: HgssP2pTradeCoordinatorSnapshot): boolean {
  return snapshot.status === 'committed' || snapshot.status === 'cancelled'
}

function recoveryEscrowFrom(
  escrow: HgssP2pTradeEscrowPort & Partial<BrowserMultiplayerRecoveryEscrowPort>,
): BrowserMultiplayerRecoveryEscrowPort | undefined {
  const methods = [escrow.listRecoveryJournals, escrow.reconcileRecovery, escrow.finalizeRecovery]
  if (methods.every((method) => method === undefined)) return undefined
  if (methods.some((method) => typeof method !== 'function')) {
    throw new TypeError("Le port de reprise durable de l'échange P2P est incomplet.")
  }
  return escrow as HgssP2pTradeEscrowPort & BrowserMultiplayerRecoveryEscrowPort
}

function coordinatorRequiresLock(snapshot: HgssP2pTradeCoordinatorSnapshot): boolean {
  return snapshot.needsRecovery
    || snapshot.status === 'preparing'
    || snapshot.status === 'prepared'
    || snapshot.status === 'commit-pending'
}

function recoveryWireProtocol(message: string): boolean {
  try {
    const value = JSON.parse(message) as unknown
    return value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Reflect.get(value, 'protocol') === hgssP2pTradeRecoveryProtocol
  } catch {
    return false
  }
}

function intentWireProtocol(message: string): boolean {
  try {
    const value = JSON.parse(message) as unknown
    return value !== null
      && typeof value === 'object'
      && !Array.isArray(value)
      && Reflect.get(value, 'protocol') === p2pSessionIntentProtocol
  } catch {
    return false
  }
}

function createBrowserMultiplayerHubState(
  randomAvailable: boolean,
  rtcAvailability: RtcPeerConnectionAvailability,
  campaignAvailable: boolean,
  directCoopAvailable: boolean,
): MultiplayerHubState {
  const activity = (label: string) => Object.freeze({
    random: rtcAvailability.available && randomAvailable,
    friends: rtcAvailability.available,
    ...(!rtcAvailability.available
      ? { reason: rtcAvailability.reason ?? "Le pair-à-pair WebRTC n'est pas disponible sur cet appareil." }
      : randomAvailable ? {} : { reason: `Le matchmaking aléatoire ${label} n'est pas configuré.` }),
  })
  return Object.freeze({
    leaderboard: Object.freeze({
      status: 'unavailable',
      reason: "Le classement attend encore son service de résultats attestés.",
    }),
    activities: Object.freeze({
      trade: activity("d'échange"),
      pvp: Object.freeze({ ...activity('PvP'), visible: false }),
      coop: campaignAvailable
        ? directCoopAvailable
          ? Object.freeze({ random: true, friends: true })
          : activity('coop')
        : Object.freeze({ ...activity('coop'), visible: false }),
    }),
  })
}

function safeIntentListener(
  listener: (state: BrowserMultiplayerIntentSessionState) => void,
  state: BrowserMultiplayerIntentSessionState,
): void {
  try { listener(state) } catch { /* Un observateur ne pilote jamais la session. */ }
}

function tradeCancellationMessage(snapshot: HgssP2pTradeCoordinatorSnapshot): string {
  switch (snapshot.cancelReason) {
    case 'timeout': return "L'échange a expiré."
    case 'disconnect': return "L'autre joueur s'est déconnecté pendant l'échange."
    case 'local-rejected': return "L'autre sauvegarde a refusé la préparation de l'échange."
    case 'protocol-error': return "L'échange a été interrompu car les données reçues étaient invalides."
    case 'offer-withdrawn': return "L'autre joueur a retiré son offre."
    case 'user': return "L'autre joueur a annulé l'échange."
    case undefined: return "L'échange a été annulé."
  }
}

/**
 * Composition navigateur du social, de la RTC et de l'échange transactionnel.
 * Les messages réseau ne transportent que les identifiants protocolaires et
 * les snapshots fonctionnels validés. Leurs IDs et statistiques numériques
 * sont portables; seuls les libellés ROM, textes, images et autres assets de
 * présentation sont résolus localement.
 */
export function createBrowserMultiplayerRuntime(
  options: BrowserMultiplayerRuntimeOptions,
): BrowserMultiplayerRuntime {
  if (options.onlineController && options.onlineControllerOptions) {
    throw new TypeError('Injectez soit un contrôleur online, soit ses options, jamais les deux.')
  }
  if (options.defaultSessionIntent !== undefined && !isP2pSessionIntent(options.defaultSessionIntent)) {
    throw new TypeError("L'intention P2P par défaut est invalide.")
  }
  const timeoutMs = validateTradeTimeout(options.tradeTimeoutMs)
  const matchmakingPollMs = validateMatchmakingPoll(options.matchmakingPollMs)
  const intentHandshakeTimeoutMs = validateIntentHandshakeTimeout(options.intentHandshakeTimeoutMs)
  const scheduler = options.scheduler ?? defaultScheduler()
  const now = options.now ?? Date.now
  const createTransactionId = options.transactionIdFactory ?? generateOnlineOpaqueId
  const consumeRtcLink = options.rtcLinkConsumer ?? consumeIssuedRtcPeerConnectionLink
  const rtcAvailability = options.rtcAvailability
    ?? (options.onlineController
      ? Object.freeze({ available: true })
      : readRtcPeerConnectionAvailability())
  const controller = options.onlineController ?? createOnlineProductController(
    options.onlineControllerOptions ?? {
      config: readOnlineClientConfig(),
      rtcConfiguration: readOnlineRtcConfiguration(),
    },
  )
  const accountSession = options.accountSession ?? readBrowserOnlineAccountSession()
  const matchmakingPorts = controller.joinMatchmaking
    && controller.refreshMatchmaking
    && controller.cancelMatchmaking
    && controller.consumeMatchmakingMatch
    ? Object.freeze({
      join: controller.joinMatchmaking,
      refresh: controller.refreshMatchmaking,
      cancel: controller.cancelMatchmaking,
      consume: controller.consumeMatchmakingMatch,
    })
    : undefined
  const coopPorts = controller.refreshCoopRendezvous
    && controller.searchRandomCoop
    && controller.inviteCoopFriend
    && controller.acceptCoopInvitation
    && controller.declineCoopInvitation
    && controller.cancelCoopRendezvous
    ? Object.freeze({
      refresh: controller.refreshCoopRendezvous,
      searchRandom: controller.searchRandomCoop,
      inviteFriend: controller.inviteCoopFriend,
      acceptInvitation: controller.acceptCoopInvitation,
      declineInvitation: controller.declineCoopInvitation,
      cancel: controller.cancelCoopRendezvous,
    })
    : undefined
  const recoveryEscrow = recoveryEscrowFrom(options.game.escrow)
  const createUi = options.uiFactory ?? createMultiplayerUiShell
  const accountManagement = options.accountManagement !== false
  let onlineState = controller.getState()
  let account = accountSession.getAccount()
  if (!account && options.onlineController && onlineState.identity) {
    account = Object.freeze({
      id: onlineState.identity,
      username: onlineState.identity,
      role: 'user' as const,
      entitlements: Object.freeze(['development']),
    })
  }
  let peer: PeerContext | undefined
  let directCampaign: DirectCampaignContext | undefined
  let directCampaignGeneration = 0
  let directCampaignRetry: DirectCampaignRetry | undefined
  let transferredCampaignSessionId: string | undefined
  let sessionError: Error | undefined
  let connectionError: Error | undefined
  let accountOperation: 'login' | 'register' | 'restore' | undefined
  let logoutOperation: Promise<void> | undefined
  let pageReleaseOperation: Promise<void> | undefined
  let pageReleaseInProgress = false
  let coopRendezvousMutation: Promise<OnlineCoopRendezvousSnapshot> | undefined
  let coopCancellationOperation: Promise<void> | undefined
  let destroyed = false
  let snapshot: MultiplayerUiSnapshot
  let detachOnline: (() => void) | undefined
  let pendingSessionIntent: PendingSessionIntent | undefined
  let intentSessionState: BrowserMultiplayerIntentSessionState = Object.freeze({ status: 'idle' })
  const intentSessionListeners = new Set<(state: BrowserMultiplayerIntentSessionState) => void>()
  let matchmakingTimer: unknown
  let matchmakingGeneration = 0
  let matchmakingIntent: P2pSessionIntent | undefined
  let matchmakingPollInFlight: Promise<void> | undefined
  let coopPollTimer: unknown
  let coopPollInFlight: Promise<void> | undefined
  let coopPollGeneration = 0

  const publishIntentSession = (next: BrowserMultiplayerIntentSessionState): void => {
    intentSessionState = Object.freeze({ ...next }) as BrowserMultiplayerIntentSessionState
    for (const listener of intentSessionListeners) safeIntentListener(listener, intentSessionState)
  }

  const report = (error: Error, area: 'connection' | 'social' | 'session' | 'trade'): void => {
    try { options.game.reportError?.(error, area) } catch { /* Le rapporteur ne pilote jamais la session. */ }
  }

  const connectionSnapshot = (): MultiplayerConnectionState => {
    if (accountOperation) return Object.freeze({ status: 'authenticating', operation: accountOperation })
    if (!account) {
      return connectionError
        ? Object.freeze({ status: 'error', message: connectionError.message })
        : Object.freeze({ status: 'signed-out' })
    }
    if (!hasOnlineAccountEntitlement(account, 'online')) {
      return Object.freeze({
        status: 'access-denied',
        account,
        message: "Ce compte n'a pas encore accès au multijoueur.",
      })
    }
    if (onlineState.status === 'connecting') return Object.freeze({ status: 'connecting', account })
    if (onlineState.status === 'failed') {
      return Object.freeze({
        status: 'error',
        account,
        message: onlineState.error?.message ?? 'Connexion en ligne impossible.',
      })
    }
    if (onlineState.status === 'disconnected') {
      return connectionError
        ? Object.freeze({ status: 'error', account, message: connectionError.message })
        : Object.freeze({ status: 'error', account, message: 'Le multijoueur est déconnecté.' })
    }
    return onlineState.identity
      ? Object.freeze({ status: 'connected', userId: onlineState.identity, account })
      : Object.freeze({ status: 'error', account, message: "L'identité en ligne est absente." })
  }

  const sessionSnapshot = (): MultiplayerSessionState => {
    if (sessionError && (
      intentSessionState.status === 'error'
      || intentSessionState.status === 'rejected'
      || onlineState.status !== 'negotiating' && onlineState.status !== 'connected'
    )) {
      return Object.freeze({ status: 'error', message: sessionError.message })
    }
    const direct = directCampaign
    if (direct && direct.phase !== 'closing') {
      return Object.freeze({
        status: 'connected',
        peerUserId: direct.remoteParticipantId,
        role: direct.role,
        intent: 'coop',
        gameplay: direct.phase === 'armed' ? 'campaign-armed' : 'campaign-starting',
      })
    }
    if (intentSessionState.status === 'searching') {
      return Object.freeze({ status: 'searching', intent: intentSessionState.intent })
    }
    if (intentSessionState.status === 'consent') {
      return Object.freeze({
        status: 'consent',
        peerUserId: intentSessionState.peerUserId,
        intent: intentSessionState.remoteIntent,
      })
    }
    if (intentSessionState.status === 'requesting' && onlineState.status === 'ready') {
      return Object.freeze({ status: 'inviting', peerUserId: intentSessionState.peerUserId })
    }
    if (onlineState.status === 'negotiating' && onlineState.activePeer) {
      return onlineState.activePeer.role === 'offerer'
        ? Object.freeze({ status: 'inviting', peerUserId: onlineState.activePeer.peerId })
        : Object.freeze({
          status: 'negotiating',
          peerUserId: onlineState.activePeer.peerId,
          role: 'guest',
        })
    }
    if (onlineState.status === 'connected' && onlineState.activePeer) {
      if (intentSessionState.status === 'handshaking') {
        return Object.freeze({
          status: 'negotiating',
          peerUserId: onlineState.activePeer.peerId,
          role: intentSessionState.role,
        })
      }
      if (intentSessionState.status === 'ready') {
        return Object.freeze({
          status: 'connected',
          peerUserId: onlineState.activePeer.peerId,
          role: intentSessionState.role,
          intent: intentSessionState.intent,
          gameplay: intentSessionState.gameplay,
        })
      }
      return Object.freeze({
        status: 'connected',
        peerUserId: onlineState.activePeer.peerId,
        role: onlineState.activePeer.role === 'offerer' ? 'host' : 'guest',
      })
    }
    return Object.freeze({ status: 'idle' })
  }

  const tradeSnapshot = (): MultiplayerTradeState => {
    const current = peer
    if (!current) return Object.freeze({ status: 'closed' })
    const coordinatorSnapshot = current?.coordinator?.getSnapshot()
    const locked = Boolean(
      current?.recovery?.active
      || coordinatorSnapshot && coordinatorRequiresLock(coordinatorSnapshot),
    )
    if (!current.tradeOpen && !locked) return Object.freeze({ status: 'closed' })
    const common = {
      ...(current.localPresentation ? { localOffer: current.localPresentation } : {}),
      ...(current.remotePresentation ? { remoteOffer: current.remotePresentation } : {}),
      localAccepted: coordinatorSnapshot?.localAccepted ?? false,
      remoteAccepted: coordinatorSnapshot?.remoteAccepted ?? false,
      ...(locked ? { locked: true } : {}),
    }
    if (current.tradeError) {
      return Object.freeze({ status: 'error', ...common, errorMessage: current.tradeError.message })
    }
    if (!coordinatorSnapshot) {
      return Object.freeze({ status: locked ? 'committing' : 'negotiating', ...common })
    }
    if (coordinatorSnapshot.status === 'cancelled') {
      return Object.freeze({ status: 'error', ...common, errorMessage: tradeCancellationMessage(coordinatorSnapshot) })
    }
    if (coordinatorSnapshot.status === 'committed') return Object.freeze({ status: 'committed', ...common })
    if (
      coordinatorSnapshot.status === 'preparing'
      || coordinatorSnapshot.status === 'prepared' && coordinatorSnapshot.pair !== undefined
      || coordinatorSnapshot.status === 'commit-pending'
    ) return Object.freeze({ status: 'committing', ...common })
    return Object.freeze({ status: 'negotiating', ...common })
  }

  const createSnapshot = (): MultiplayerUiSnapshot => {
    return Object.freeze({
      connection: connectionSnapshot(),
      social: Object.freeze({
        friends: Object.freeze(onlineState.friends.map((friend) => Object.freeze({ ...friend }))),
        incoming: Object.freeze([...onlineState.incomingFriendRequests]),
        outgoing: Object.freeze([...onlineState.outgoingFriendRequests]),
      }),
      invitations: Object.freeze([
        ...onlineState.invitations.map((invitation) => Object.freeze({
          invitationId: invitation.descriptor.negotiationId,
          fromUserId: invitation.descriptor.peerId,
          transport: 'peer' as const,
        })),
        ...(onlineState.coopRendezvous?.invitations ?? []).map((invitation) => Object.freeze({
          invitationId: directCoopInvitationId(invitation.sessionId),
          fromUserId: invitation.fromUserId,
          transport: 'server' as const,
          intent: 'coop' as const,
        })),
      ]),
      session: sessionSnapshot(),
      trade: tradeSnapshot(),
      hub: createBrowserMultiplayerHubState(
        Boolean(onlineState.configured && matchmakingPorts),
        rtcAvailability,
        options.game.campaign !== undefined,
        Boolean(onlineState.configured && coopPorts),
      ),
    })
  }

  const render = (): void => {
    if (destroyed) return
    snapshot = createSnapshot()
    shell.update(snapshot)
  }

  const directCampaignReadyState = (
    context: DirectCampaignContext,
    gameplay: 'campaign-starting' | 'campaign-armed',
  ): BrowserMultiplayerIntentSessionState => Object.freeze({
    status: 'ready',
    peerUserId: context.remoteParticipantId,
    role: context.role,
    intent: 'coop',
    gameplay,
  })

  const detachDirectCampaign = (context: DirectCampaignContext): Promise<void> => {
    if (context.closeOperation) return context.closeOperation
    context.phase = 'closing'
    try { context.abort.abort() } catch { /* L'annulation est déjà terminale. */ }
    const operation = (async (): Promise<void> => {
      await context.start?.catch(() => undefined)
      const session = context.session
      context.session = undefined
      if (session) {
        try { await session.close() }
        catch (value) {
          report(asError(value, 'La fermeture de la campagne Coop a échoué.'), 'session')
        }
      }
      if (directCampaign === context) directCampaign = undefined
      render()
    })()
    context.closeOperation = operation
    return operation
  }

  const terminateDirectCampaign = async (
    context: DirectCampaignContext,
    error?: Error,
  ): Promise<void> => {
    if (directCampaign !== context || context.phase === 'closing') return
    const transferred = isBrowserMultiplayerCampaignConnectionReplacedError(error)
    if (transferred) {
      context.transferred = true
      transferredCampaignSessionId = context.sessionId
      directCampaignRetry = undefined
    }
    await detachDirectCampaign(context)
    if (error) {
      sessionError = error
      report(error, 'session')
      publishIntentSession(Object.freeze({
        status: 'error',
        peerUserId: context.remoteParticipantId,
        role: context.role,
        expectedIntent: 'coop',
        message: error.message,
      }))
    } else {
      sessionError = undefined
      publishIntentSession(Object.freeze({ status: 'idle' }))
    }
    render()
    if (transferred) return
    try { await coopPorts?.cancel() }
    catch (value) {
      report(asError(value, "La libération du rendez-vous Coop a échoué."), 'session')
    }
  }

  const startDirectCampaign = (
    current: Extract<OnlineCoopRendezvousCurrent, { status: 'ready' | 'active' }>,
  ): void => {
    if (pageReleaseInProgress || logoutOperation || coopCancellationOperation) return
    const campaign = options.game.campaign
    const localParticipantId = onlineState.identity
    if (!campaign || !coopPorts || !localParticipantId) return
    if (transferredCampaignSessionId === current.sessionId) return
    transferredCampaignSessionId = undefined
    if (peer || pendingSessionIntent || matchmakingIntent) {
      report(new Error(
        'La campagne Coop attend la fin de la session Trade/PvP déjà engagée.',
      ), 'session')
      return
    }
    if (
      !isOnlineOpaqueId(current.sessionId)
      || !isOnlineUserId(current.peerUserId)
      || current.peerUserId === localParticipantId
      || current.expiresAt <= now()
    ) {
      const error = new Error('Le rendez-vous Coop reçu est invalide ou a expiré.')
      sessionError = error
      report(error, 'session')
      publishIntentSession(Object.freeze({ status: 'idle' }))
      render()
      void coopPorts.cancel().then(applyCoopRendezvous).catch(() => undefined)
      return
    }
    const retry = directCampaignRetry
    if (retry?.sessionId === current.sessionId && retry.notBefore > now()) return
    if (retry && retry.sessionId !== current.sessionId) directCampaignRetry = undefined
    const existing = directCampaign
    if (existing) {
      if (
        existing.sessionId === current.sessionId
        && existing.localParticipantId === localParticipantId
        && existing.remoteParticipantId === current.peerUserId
        && existing.role === current.role
      ) return
      const error = new Error('Le serveur a proposé une autre campagne pendant une session active.')
      sessionError = error
      report(error, 'session')
      render()
      return
    }

    directCampaignGeneration += 1
    const generation = directCampaignGeneration
    const abort = new AbortController()
    const context: DirectCampaignContext = {
      generation,
      sessionId: current.sessionId,
      localParticipantId,
      remoteParticipantId: current.peerUserId,
      role: current.role,
      expiresAt: current.expiresAt,
      abort,
      transferred: false,
      phase: 'starting',
    }
    directCampaign = context
    sessionError = undefined
    publishIntentSession(directCampaignReadyState(context, 'campaign-starting'))
    render()

    const start = Promise.resolve().then(() => campaign.start(Object.freeze({
      transport: 'server' as const,
      sessionId: context.sessionId,
      localParticipantId: context.localParticipantId,
      remoteParticipantId: context.remoteParticipantId,
      role: context.role,
      rendezvousExpiresAt: context.expiresAt,
      signal: context.abort.signal,
      onTerminated: (error?: Error) => {
        if (
          directCampaign !== context
          || context.generation !== generation
        ) return
        if (isBrowserMultiplayerCampaignConnectionReplacedError(error)) {
          context.transferred = true
          transferredCampaignSessionId = context.sessionId
          directCampaignRetry = undefined
        }
        if (context.phase === 'closing') return
        void terminateDirectCampaign(context, error)
      },
    }))).then(async (session) => {
      if (!session || typeof session.close !== 'function') {
        throw new TypeError('Le port de campagne a retourné une session directe invalide.')
      }
      if (
        directCampaign !== context
        || context.generation !== generation
        || context.abort.signal.aborted
        || context.phase === 'closing'
        || destroyed
      ) {
        await session.close()
        return
      }
      context.session = session
      context.phase = 'armed'
      directCampaignRetry = undefined
      publishIntentSession(directCampaignReadyState(context, 'campaign-armed'))
      render()
    }).catch((value: unknown) => {
      if (
        directCampaign !== context
        || context.generation !== generation
        || context.phase === 'closing'
        || context.abort.signal.aborted
      ) return
      directCampaign = undefined
      const error = asError(value, "L'ouverture de la campagne Coop a échoué.")
      if (isBrowserMultiplayerCampaignConnectionReplacedError(error)) {
        transferredCampaignSessionId = context.sessionId
        directCampaignRetry = undefined
        sessionError = error
        report(error, 'session')
        publishIntentSession(Object.freeze({
          status: 'error',
          peerUserId: context.remoteParticipantId,
          role: context.role,
          expectedIntent: 'coop',
          message: error.message,
        }))
        render()
        return
      }
      const previousAttempts = directCampaignRetry?.sessionId === context.sessionId
        ? directCampaignRetry.attempts
        : 0
      const attempts = previousAttempts + 1
      const retryDelayMs = Math.min(5_000, 500 * (2 ** Math.min(attempts - 1, 4)))
      directCampaignRetry = Object.freeze({
        attempts,
        notBefore: Math.min(context.expiresAt, now() + retryDelayMs),
        sessionId: context.sessionId,
      })
      sessionError = error
      report(error, 'session')
      publishIntentSession(Object.freeze({
        status: 'error',
        peerUserId: context.remoteParticipantId,
        role: context.role,
        expectedIntent: 'coop',
        message: error.message,
      }))
      render()
    })
    context.start = start
  }

  const applyCoopRendezvous = (value: OnlineCoopRendezvousSnapshot | undefined): void => {
    if (!value || !coopPorts || !options.game.campaign || destroyed) return
    const current = value.current
    if (current.status === 'ready' || current.status === 'active') {
      startDirectCampaign(current)
      return
    }
    transferredCampaignSessionId = undefined
    if (directCampaign) return
    if (current.status === 'idle') directCampaignRetry = undefined
    if (current.status === 'queued') {
      sessionError = undefined
      publishIntentSession(Object.freeze({ status: 'searching', intent: 'coop' }))
      render()
      return
    }
    if (current.status === 'offered') {
      sessionError = undefined
      publishIntentSession(Object.freeze({
        status: 'requesting',
        peerUserId: current.peerUserId,
        intent: 'coop',
        direction: 'outbound',
      }))
      render()
      return
    }
    if (
      intentSessionState.status === 'searching' && intentSessionState.intent === 'coop'
      || intentSessionState.status === 'requesting' && intentSessionState.intent === 'coop'
    ) {
      publishIntentSession(Object.freeze({ status: 'idle' }))
      render()
    }
  }

  const clearCoopPoll = (): void => {
    coopPollGeneration += 1
    if (coopPollTimer !== undefined) scheduler.clearInterval(coopPollTimer)
    coopPollTimer = undefined
    coopPollInFlight = undefined
  }

  const pollCoopRendezvous = (): Promise<void> => {
    if (coopPollInFlight) return coopPollInFlight
    if (!coopPorts || destroyed) return Promise.resolve()
    const generation = coopPollGeneration
    const operation = coopPorts.refresh()
      .then((value) => {
        if (generation === coopPollGeneration && !destroyed) applyCoopRendezvous(value)
      })
      .catch((value: unknown) => {
        if (generation !== coopPollGeneration || destroyed) return
        const activeCoop = directCampaign
          || intentSessionState.status === 'searching' && intentSessionState.intent === 'coop'
          || intentSessionState.status === 'requesting' && intentSessionState.intent === 'coop'
        if (activeCoop) report(asError(value, 'Le rendez-vous Coop est temporairement indisponible.'), 'session')
      })
      .finally(() => {
        if (coopPollInFlight === operation) coopPollInFlight = undefined
      })
    coopPollInFlight = operation
    return operation
  }

  const syncCoopPolling = (): void => {
    const connected = onlineState.status === 'ready'
      || onlineState.status === 'negotiating'
      || onlineState.status === 'connected'
    if (
      !connected
      || !coopPorts
      || !options.game.campaign
      || destroyed
      || pageReleaseInProgress
      || logoutOperation
    ) {
      clearCoopPoll()
      return
    }
    if (coopPollTimer !== undefined) return
    coopPollGeneration += 1
    coopPollTimer = scheduler.setInterval(() => { void pollCoopRendezvous() }, matchmakingPollMs)
    void pollCoopRendezvous()
  }

  const clearTimer = (context: PeerContext): void => {
    if (context.timer === undefined) return
    scheduler.clearInterval(context.timer)
    context.timer = undefined
  }

  const clearIntentTimer = (context: PeerContext): void => {
    if (context.intentTimer === undefined) return
    scheduler.clearInterval(context.intentTimer)
    context.intentTimer = undefined
  }

  const cancelOfferSelection = (context: PeerContext): void => {
    context.selectionSerial += 1
    try { options.game.cancelLocalTradeOfferSelection?.() }
    catch (value) { report(asError(value, "La fermeture du sélecteur d'échange a échoué."), 'trade') }
  }

  const syncCoordinator = (context: PeerContext): void => {
    if (peer !== context || context.closed || !context.coordinator) return
    const current = context.coordinator.getSnapshot()
    if (current.localOffer?.revision !== context.localPresentationRevision) {
      context.localPresentationRevision = current.localOffer?.revision
      context.localPresentation = current.localOffer
        ? presentHgssP2pTradeOffer(current.localOffer.preview, options.game.presentationResources)
        : undefined
    }
    if (current.remoteOffer?.revision !== context.remotePresentationRevision) {
      context.remotePresentationRevision = current.remoteOffer?.revision
      context.remotePresentation = current.remoteOffer
        ? presentHgssP2pTradeOffer(current.remoteOffer.preview, options.game.presentationResources)
        : undefined
    }
    if (current.commitResult && !context.commitNotified) {
      context.commitNotified = true
      const notification = context.callbacks.then(async () => {
        await options.game.onTradeCommitted?.(current.commitResult!)
      })
      context.callbacks = notification.catch((value: unknown) => {
        report(asError(value, "La notification locale de l'échange a échoué."), 'trade')
      })
    }
    if (current.status === 'committed' && context.transactionId && context.recovery?.ready) {
      const journal = context.recovery.escrow.listRecoveryJournals(context.remoteParticipantId)
        .find((candidate) => candidate.transactionId === context.transactionId && candidate.phase === 'committed')
      if (journal) {
        try { sendRecoveryJournal(context, journal) }
        catch (value) { setTradeError(context, value) }
      }
    }
    render()
  }

  const setTradeError = (context: PeerContext, value: unknown): Error => {
    const error = asError(value, "L'échange pair-à-pair a échoué.")
    if (peer === context && !context.closed) {
      context.tradeError = error
      context.tradeOpen = true
      report(error, 'trade')
      render()
    }
    return error
  }

  const enqueue = <Result>(context: PeerContext, operation: () => Promise<Result>): Promise<Result> => {
    const result = context.queue.then(async () => {
      if (context.closed || peer !== context) throw new Error('La session pair-à-pair est fermée.')
      return operation()
    })
    context.queue = result.then(() => undefined, () => undefined)
    return result
  }

  const publishPeerIntent = (
    context: PeerContext,
    state: BrowserMultiplayerIntentSessionState,
  ): void => {
    if (peer !== context || context.closed) return
    publishIntentSession(state)
    render()
  }

  const intentErrorState = (
    context: PeerContext,
    status: 'rejected' | 'error',
    message: string,
    remoteIntent?: P2pSessionIntent,
  ): BrowserMultiplayerIntentSessionState => Object.freeze({
    status,
    peerUserId: context.remoteParticipantId,
    role: context.role,
    ...(context.intent.expectedIntent ? { expectedIntent: context.intent.expectedIntent } : {}),
    ...(remoteIntent ? { remoteIntent } : {}),
    message,
  })

  const settlePeerIntent = (context: PeerContext): void => {
    if (context.intent.settled) return
    context.intent.settled = true
    context.intent.settle()
  }

  const terminateIntentTransport = (context: PeerContext): void => {
    queueMicrotask(() => {
      if (peer !== context || context.closed || peerIsLocked(context)) return
      void detachPeer(context, true)
      try { controller.hangUp() } catch { /* Le transport local est déjà détaché. */ }
    })
  }

  const failIntentSession = (context: PeerContext, value: unknown): Error => {
    const error = asError(value, "La négociation de l'intention P2P a échoué.")
    if (context.intent.phase === 'ready' && peerIsLocked(context)) {
      report(error, 'session')
      try { context.intentChannel.close() } catch { /* Le canal de contrôle est déjà fermé. */ }
      return error
    }
    if (context.intent.phase !== 'error' && context.intent.phase !== 'rejected') {
      clearIntentTimer(context)
      context.intent.phase = 'error'
      settlePeerIntent(context)
      sessionError = error
      report(error, 'session')
      publishPeerIntent(context, intentErrorState(context, 'error', error.message))
      try { context.tradeChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      try { context.campaignChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      try { context.intentChannel.close() } catch { /* Le canal de contrôle est déjà fermé. */ }
      terminateIntentTransport(context)
    }
    return error
  }

  const sendIntentFrame = (
    context: PeerContext,
    frame:
      | Readonly<{ kind: 'offer' | 'accept', intent: P2pSessionIntent }>
      | Readonly<{ kind: 'reject', intent: P2pSessionIntent, reason: P2pSessionIntentRejectReason }>,
  ): void => {
    context.intentChannel.send(encodeP2pSessionIntentFrame({
      protocol: p2pSessionIntentProtocol,
      protocolVersion: p2pSessionIntentProtocolVersion,
      sessionId: context.sessionId,
      senderId: context.localParticipantId,
      receiverId: context.remoteParticipantId,
      sequence: 1,
      ...frame,
    } as P2pSessionIntentFrame))
  }

  const campaignReadyState = (
    context: PeerContext,
    gameplay: 'campaign-starting' | 'campaign-armed',
  ): BrowserMultiplayerIntentSessionState => Object.freeze({
    status: 'ready',
    peerUserId: context.remoteParticipantId,
    role: context.role,
    intent: 'coop',
    gameplay,
  })

  const armCampaignProtocol = (context: PeerContext): void => {
    const campaign = options.game.campaign
    if (!campaign || context.closed || peer !== context || context.campaignStart || context.campaignSession) return
    const abort = new AbortController()
    context.campaignAbort = abort
    try {
      const hostBinding = context.role === 'host'
        ? createHgssCampaignPeerLogicalHostBinding({
          route: context.multiplexer.issueChannelBinding(browserMultiplayerCampaignChannelId),
          peerId: context.remoteParticipantId,
          negotiationId: context.sessionId,
          sessionId: context.sessionId,
          playerId: context.remoteParticipantId,
        })
        : undefined
      const start = Promise.resolve(campaign.start(Object.freeze({
        transport: 'peer' as const,
        channel: context.campaignChannel,
        sessionId: context.sessionId,
        localParticipantId: context.localParticipantId,
        remoteParticipantId: context.remoteParticipantId,
        role: context.role,
        signal: abort.signal,
        onTerminated: (error?: Error) => {
          if (context.closed || peer !== context) return
          if (error) {
            sessionError = error
            report(error, 'session')
          }
          void detachPeer(context, true)
          try { controller.hangUp() } catch { /* Le transport est déjà terminal. */ }
        },
        ...(hostBinding ? { hostBinding } : {}),
      }))).then(async (session) => {
        if (!session || typeof session.close !== 'function') {
          throw new TypeError('Le port de campagne a retourné une session invalide.')
        }
        if (context.closed || peer !== context || abort.signal.aborted) {
          await session.close()
          return
        }
        context.campaignSession = session
        publishPeerIntent(context, campaignReadyState(context, 'campaign-armed'))
      }).catch((value: unknown) => {
        if (!context.closed && peer === context) failIntentSession(context, value)
      })
      context.campaignStart = start
      void start.finally(() => {
        if (context.campaignStart === start) context.campaignStart = undefined
      })
    } catch (value) {
      failIntentSession(context, value)
    }
  }

  const markIntentReady = (context: PeerContext, intent: P2pSessionIntent): void => {
    if (context.intent.phase !== 'handshaking') {
      throw new Error("L'intention P2P ne peut plus être confirmée dans cet état.")
    }
    clearIntentTimer(context)
    context.intent.phase = 'ready'
    context.intent.negotiatedIntent = intent
    sessionError = undefined
    settlePeerIntent(context)
    const campaignAvailable = intent === 'coop' && options.game.campaign !== undefined
    if (intent === 'trade') {
      try { context.campaignChannel.close() } catch { /* Le canal non utilisé est déjà fermé. */ }
      armTradeProtocol(context)
    } else {
      try { context.tradeChannel.close() } catch { /* Le canal non utilisé est déjà fermé. */ }
      if (!campaignAvailable) {
        try { context.campaignChannel.close() } catch { /* Le canal non utilisé est déjà fermé. */ }
      }
    }
    publishPeerIntent(context, Object.freeze({
      status: 'ready',
      peerUserId: context.remoteParticipantId,
      role: context.role,
      intent,
      gameplay: intent === 'trade'
        ? 'trade-armed'
        : campaignAvailable ? 'campaign-starting' : 'not-wired',
    }))
    if (campaignAvailable) armCampaignProtocol(context)
  }

  const rejectIntentMismatch = (
    context: PeerContext,
    remoteIntent: P2pSessionIntent,
  ): void => {
    clearIntentTimer(context)
    context.intent.localSent = true
    sendIntentFrame(context, { kind: 'reject', intent: remoteIntent, reason: 'intent-mismatch' })
    context.intent.phase = 'rejected'
    settlePeerIntent(context)
    const message = `L'intention distante ${remoteIntent} ne correspond pas à l'activité demandée.`
    sessionError = new Error(message)
    publishPeerIntent(context, intentErrorState(context, 'rejected', message, remoteIntent))
    try { context.tradeChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
    try { context.campaignChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
    terminateIntentTransport(context)
  }

  const receiveIntentMessage = async (context: PeerContext, message: string): Promise<void> => {
    const frame = decodeP2pSessionIntentFrame(message)
    if (!frame) {
      throw new Error(intentWireProtocol(message)
        ? "Une trame d'intention P2P est invalide."
        : "Le canal de contrôle a reçu un protocole P2P ancien ou inconnu.")
    }
    if (frame.sessionId !== context.sessionId
      || frame.senderId !== context.remoteParticipantId
      || frame.receiverId !== context.localParticipantId) {
      throw new Error("La trame d'intention ne correspond pas à la session RTC active.")
    }
    const fingerprint = JSON.stringify(frame)
    if (context.intent.remoteSequence === frame.sequence) {
      if (context.intent.remoteFingerprint === fingerprint) return
      throw new Error("La décision distante d'intention P2P a été rejouée avec un autre contenu.")
    }
    if (context.intent.remoteSequence !== 0 || frame.sequence !== 1) {
      throw new Error("La séquence distante d'intention P2P est invalide.")
    }

    if (context.role === 'host') {
      if (frame.kind === 'offer') throw new Error("Le pair invité ne peut pas proposer l'intention de l'hôte.")
      const expected = context.intent.expectedIntent
      if (!expected || frame.intent !== expected) {
        throw new Error("La réponse distante ne correspond pas à l'intention proposée.")
      }
    } else if (frame.kind !== 'offer') {
      throw new Error("Le pair hôte doit commencer par proposer une intention de session.")
    }

    context.intent.remoteSequence = frame.sequence
    context.intent.remoteFingerprint = fingerprint
    if (frame.kind === 'reject') {
      clearIntentTimer(context)
      context.intent.phase = 'rejected'
      settlePeerIntent(context)
      const message = `Le pair a refusé l'intention ${frame.intent}.`
      sessionError = new Error(message)
      publishPeerIntent(context, intentErrorState(context, 'rejected', message, frame.intent))
      try { context.tradeChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      try { context.campaignChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      terminateIntentTransport(context)
      return
    }
    if (frame.kind === 'accept') {
      markIntentReady(context, frame.intent)
      return
    }

    const expected = context.intent.expectedIntent
    if (expected && expected !== frame.intent) {
      rejectIntentMismatch(context, frame.intent)
      return
    }
    context.intent.remoteOfferedIntent = frame.intent
    if (!expected) {
      publishPeerIntent(context, Object.freeze({
        status: 'consent',
        peerUserId: context.remoteParticipantId,
        role: 'guest',
        remoteIntent: frame.intent,
      }))
      return
    }
    context.intent.localSent = true
    sendIntentFrame(context, { kind: 'accept', intent: frame.intent })
    markIntentReady(context, frame.intent)
  }

  const acceptSessionIntentConsent = async (
    peerUserId: string,
    intent: P2pSessionIntent,
  ): Promise<void> => {
    const context = peer
    if (!context
      || context.role !== 'guest'
      || context.remoteParticipantId !== peerUserId
      || context.intent.phase !== 'handshaking'
      || context.intent.remoteOfferedIntent !== intent
      || intentSessionState.status !== 'consent') {
      throw new Error("Cette proposition d'activité P2P n'est plus active.")
    }
    await enqueue(context, async () => {
      if (context.intent.localSent || context.intent.remoteOfferedIntent !== intent) {
        throw new Error("Une décision a déjà été prise pour cette activité P2P.")
      }
      context.intent.localSent = true
      try { sendIntentFrame(context, { kind: 'accept', intent }) }
      catch (value) { throw failIntentSession(context, value) }
      markIntentReady(context, intent)
    })
  }

  const declineSessionIntentConsent = async (
    peerUserId: string,
    intent: P2pSessionIntent,
  ): Promise<void> => {
    const context = peer
    if (!context
      || context.role !== 'guest'
      || context.remoteParticipantId !== peerUserId
      || context.intent.phase !== 'handshaking'
      || context.intent.remoteOfferedIntent !== intent
      || intentSessionState.status !== 'consent') {
      throw new Error("Cette proposition d'activité P2P n'est plus active.")
    }
    await enqueue(context, async () => {
      if (context.intent.localSent || context.intent.remoteOfferedIntent !== intent) {
        throw new Error("Une décision a déjà été prise pour cette activité P2P.")
      }
      clearIntentTimer(context)
      context.intent.localSent = true
      try { sendIntentFrame(context, { kind: 'reject', intent, reason: 'user-declined' }) }
      catch (value) { throw failIntentSession(context, value) }
      context.intent.phase = 'rejected'
      settlePeerIntent(context)
      const message = `Vous avez refusé l'intention ${intent}.`
      sessionError = new Error(message)
      publishPeerIntent(context, intentErrorState(context, 'rejected', message, intent))
      try { context.tradeChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      try { context.campaignChannel.close() } catch { /* Le canal applicatif est déjà fermé. */ }
      terminateIntentTransport(context)
    })
  }

  const startIntentHandshake = async (context: PeerContext): Promise<void> => {
    if (context.intent.phase !== 'handshaking' || context.intent.localSent) return
    if (context.role === 'guest') return
    const intent = context.intent.expectedIntent
    if (!intent) throw new Error("L'hôte ne possède aucune intention P2P à proposer.")
    context.intent.localSent = true
    sendIntentFrame(context, { kind: 'offer', intent })
  }

  const awaitTradeIntent = async (context: PeerContext): Promise<void> => {
    if (context.intent.phase === 'handshaking') await context.intent.settledPromise
    if (context.closed || peer !== context) throw new Error('La session pair-à-pair est fermée.')
    if (context.intent.phase !== 'ready' || context.intent.negotiatedIntent !== 'trade') {
      throw new Error("Cette session pair-à-pair n'a pas confirmé l'intention d'échange.")
    }
  }

  const peerIsLocked = (context: PeerContext): boolean => {
    if (context.recovery?.active) return true
    const coordinatorSnapshot = context.coordinator?.getSnapshot()
    return coordinatorSnapshot ? coordinatorRequiresLock(coordinatorSnapshot) : false
  }

  const nextRecoveryEnvelope = (context: PeerContext) => {
    const recovery = context.recovery
    if (!recovery) throw new Error("La reprise durable n'est pas disponible pour cette session.")
    if (recovery.localSequence >= Number.MAX_SAFE_INTEGER) {
      throw new Error('La séquence locale de réconciliation P2P est épuisée.')
    }
    recovery.localSequence += 1
    return {
      protocol: hgssP2pTradeRecoveryProtocol,
      protocolVersion: 1 as const,
      recoverySessionId: context.sessionId,
      senderId: context.localParticipantId,
      receiverId: context.remoteParticipantId,
      sequence: recovery.localSequence,
    }
  }

  const sendRecoveryStart = (
    context: PeerContext,
    journals: readonly HgssP2pTradeRecoverySummary[],
  ): void => {
    context.tradeChannel.send(encodeHgssP2pTradeRecoveryFrame({
      ...nextRecoveryEnvelope(context),
      kind: 'sync-start',
      journals,
    }))
  }

  const sendRecoveryJournal = (context: PeerContext, journal: HgssP2pTradeJournal): boolean => {
    const recovery = context.recovery
    if (!recovery) return false
    if (journal.localParticipantId !== context.localParticipantId
      || journal.remoteParticipantId !== context.remoteParticipantId) {
      throw new Error("Le journal local n'appartient pas aux participants de la session de reprise.")
    }
    const fingerprint = JSON.stringify(journal)
    if (recovery.sentJournalFingerprints.get(journal.transactionId) === fingerprint) return false
    context.tradeChannel.send(encodeHgssP2pTradeRecoveryFrame({
      ...nextRecoveryEnvelope(context),
      kind: 'journal',
      journal,
    }))
    recovery.sentJournalFingerprints.set(journal.transactionId, fingerprint)
    recovery.knownTransactions.add(journal.transactionId)
    return true
  }

  const sendRecoveryConfirmation = (
    context: PeerContext,
    transactionId: string,
    disposition: 'confirmed-committed' | 'cancel-prepared',
  ): void => {
    context.tradeChannel.send(encodeHgssP2pTradeRecoveryFrame({
      ...nextRecoveryEnvelope(context),
      kind: 'confirm',
      transactionId,
      disposition,
    }))
  }

  const refreshRecoveryLock = (context: PeerContext): void => {
    const recovery = context.recovery
    if (!recovery) return
    const wasActive = recovery.active
    const remoteComplete = recovery.remoteSummaries !== undefined
      && recovery.receivedInitialTransactions.size === recovery.remoteSummaries.size
    recovery.active = !remoteComplete
      || recovery.unresolvedTransactions.size > 0
      || recovery.escrow.listRecoveryJournals(context.remoteParticipantId).length > 0
    if (!recovery.active && !recovery.ready) {
      recovery.ready = true
      recovery.settleReady()
    }
    if (wasActive && !recovery.active) {
      context.tradeError = undefined
      if (!context.coordinator && !context.pendingTransactionId) context.tradeOpen = false
    }
    render()
  }

  const finishInitialRecovery = async (context: PeerContext): Promise<void> => {
    const recovery = context.recovery
    if (!recovery?.remoteSummaries
      || recovery.receivedInitialTransactions.size !== recovery.remoteSummaries.size) return
    const remoteTransactions = new Set(recovery.remoteSummaries.keys())
    const localJournals = recovery.escrow.listRecoveryJournals(context.remoteParticipantId)
    for (const journal of localJournals) {
      if (remoteTransactions.has(journal.transactionId)) continue
      if (journal.phase === 'prepared') {
        const removed = await recovery.escrow.finalizeRecovery(
          journal.transactionId,
          context.remoteParticipantId,
          'cancel-prepared',
        )
        if (removed) sendRecoveryConfirmation(context, journal.transactionId, 'cancel-prepared')
      } else {
        sendRecoveryJournal(context, journal)
      }
    }
    refreshRecoveryLock(context)
  }

  const notifyRecoveryCommit = async (
    context: PeerContext,
    transactionId: string,
    result: HgssP2pTradeCommitResult | undefined,
  ): Promise<void> => {
    const recovery = context.recovery
    if (!recovery || !result || result.status !== 'committed'
      || recovery.notifiedTransactions.has(transactionId)) return
    recovery.notifiedTransactions.add(transactionId)
    try { await options.game.onTradeCommitted?.(result) }
    catch (value) { report(asError(value, "La notification locale de la reprise d'échange a échoué."), 'trade') }
  }

  const receiveRecoveryJournal = async (
    context: PeerContext,
    remoteJournal: HgssP2pTradeJournal,
  ): Promise<void> => {
    const recovery = context.recovery
    if (!recovery?.remoteSummaries) throw new Error("Un journal de reprise a précédé l'inventaire distant.")
    const { transactionId } = remoteJournal
    const advertisedPhase = recovery.remoteSummaries.get(transactionId)
    const firstInitialCopy = advertisedPhase !== undefined
      && !recovery.receivedInitialTransactions.has(transactionId)
    if (firstInitialCopy) {
      if (advertisedPhase !== remoteJournal.phase) {
        throw new Error("Le journal de reprise ne correspond pas à l'inventaire annoncé.")
      }
      recovery.receivedInitialTransactions.add(transactionId)
    } else if (!recovery.knownTransactions.has(transactionId)) {
      throw new Error("Un journal de reprise non annoncé vise une transaction inconnue.")
    }
    recovery.knownTransactions.add(transactionId)
    const result = await recovery.escrow.reconcileRecovery(
      remoteJournal,
      context.localParticipantId,
      context.remoteParticipantId,
    )
    if (remoteJournal.phase === 'committed' && result.kind === 'missing') {
      recovery.unresolvedTransactions.add(transactionId)
      setTradeError(
        context,
        new Error("Le commit distant ne possède aucun journal préparé ni reçu local; aucune mutation n'a été appliquée."),
      )
    } else if (result.kind !== 'missing') {
      recovery.unresolvedTransactions.delete(transactionId)
    }
    if (result.journal) sendRecoveryJournal(context, result.journal)
    await notifyRecoveryCommit(context, transactionId, result.commitResult)
    if (remoteJournal.phase === 'committed' && result.kind === 'committed') {
      if (result.journal && result.journal.phase !== 'committed') {
        throw new Error("La reprise locale commitée n'a pas produit son journal durable.")
      }
      if (result.journal) sendRecoveryJournal(context, result.journal)
      await recovery.escrow.finalizeRecovery(
        transactionId,
        context.remoteParticipantId,
        'confirmed-committed',
      )
      sendRecoveryConfirmation(context, transactionId, 'confirmed-committed')
    }
    if (firstInitialCopy) await finishInitialRecovery(context)
    refreshRecoveryLock(context)
  }

  const receiveRecoveryFrame = async (
    context: PeerContext,
    frame: HgssP2pTradeRecoveryFrame,
  ): Promise<void> => {
    const recovery = context.recovery
    if (!recovery) throw new Error("Le pair local ne prend pas en charge la reprise durable.")
    // Une frame capturée sur une ancienne connexion ne pilote jamais la nouvelle.
    if (frame.recoverySessionId !== context.sessionId) return
    if (frame.senderId !== context.remoteParticipantId || frame.receiverId !== context.localParticipantId) {
      throw new Error("La frame de reprise ne correspond pas aux participants RTC actifs.")
    }
    const sequence = classifyHgssP2pTradeRecoverySequence(recovery.remoteSequence, frame.sequence)
    if (sequence === 'replay') return
    if (sequence === 'gap') throw new Error('La séquence distante de réconciliation P2P contient un trou.')
    recovery.remoteSequence = frame.sequence

    if (frame.kind === 'sync-start') {
      if (frame.sequence !== 1 || recovery.remoteSummaries) {
        throw new Error("L'inventaire de reprise distant a été envoyé plusieurs fois.")
      }
      recovery.remoteSummaries = new Map(frame.journals.map(({ transactionId, phase }) => [transactionId, phase]))
      for (const { transactionId } of frame.journals) recovery.knownTransactions.add(transactionId)
      await finishInitialRecovery(context)
      return
    }
    if (!recovery.remoteSummaries) throw new Error("Une frame de reprise a précédé l'inventaire distant.")
    if (frame.kind === 'journal') {
      await receiveRecoveryJournal(context, frame.journal)
      return
    }
    if (!recovery.knownTransactions.has(frame.transactionId)) {
      throw new Error("Une confirmation de reprise vise une transaction inconnue.")
    }
    if (frame.disposition === 'confirmed-committed') {
      await recovery.escrow.finalizeRecovery(
        frame.transactionId,
        context.remoteParticipantId,
        'confirmed-committed',
      )
    }
    refreshRecoveryLock(context)
  }

  const startRecovery = async (context: PeerContext): Promise<void> => {
    const recovery = context.recovery
    if (!recovery || recovery.started || context.closed) return
    recovery.started = true
    recovery.active = true
    const journals = [...recovery.escrow.listRecoveryJournals(context.remoteParticipantId)]
      .sort((left, right) => left.transactionId < right.transactionId ? -1 : left.transactionId > right.transactionId ? 1 : 0)
    for (const journal of journals) recovery.knownTransactions.add(journal.transactionId)
    sendRecoveryStart(context, journals.map(({ transactionId, phase }) => ({ transactionId, phase })))
    for (const journal of journals) sendRecoveryJournal(context, journal)
    render()
  }

  const stopCoordinator = async (context: PeerContext): Promise<void> => {
    cancelOfferSelection(context)
    clearTimer(context)
    const coordinator = context.coordinator
    context.coordinator = undefined
    context.transactionId = undefined
    context.pendingTransactionId = undefined
    context.localPresentationRevision = undefined
    context.remotePresentationRevision = undefined
    context.localPresentation = undefined
    context.remotePresentation = undefined
    context.commitNotified = false
    if (!coordinator) return
    const beforeDisconnect = coordinator.getSnapshot()
    if (beforeDisconnect.needsRecovery) {
      try { await options.game.onTradeRecoveryRequired?.(beforeDisconnect) }
      catch (value) { report(asError(value, 'La préparation de la reprise locale a échoué.'), 'trade') }
    }
    try { await coordinator.disconnect() }
    catch (value) {
      const error = asError(value, "Le rollback local de l'échange a échoué.")
      report(error, 'trade')
      throw error
    }
  }

  const startTimer = (context: PeerContext): void => {
    clearTimer(context)
    const intervalMs = Math.max(250, Math.min(1_000, Math.floor(timeoutMs / 4)))
    context.timer = scheduler.setInterval(() => {
      const coordinator = context.coordinator
      if (!coordinator || context.closed || peer !== context) return
      void enqueue(context, async () => {
        if (coordinator.getSnapshot().needsRecovery) {
          await coordinator.resume()
          context.tradeError = undefined
        } else {
          await coordinator.tick()
        }
        syncCoordinator(context)
      }).catch((value: unknown) => { setTradeError(context, value) })
    }, intervalMs)
  }

  const establishCoordinator = async (context: PeerContext, transactionId: string): Promise<boolean> => {
    if (!isOnlineOpaqueId(transactionId)) throw new TypeError("L'identifiant de transaction reçu est invalide.")
    if (context.coordinator) {
      const active = context.coordinator.getSnapshot()
      if (context.transactionId === transactionId) return true
      if (!isTerminalTrade(active)) return false
      await stopCoordinator(context)
    }
    const coordinator = createHgssP2pTradeCoordinator({
      sessionId: context.sessionId,
      transactionId,
      localParticipantId: context.localParticipantId,
      remoteParticipantId: context.remoteParticipantId,
      timeoutMs,
      escrow: options.game.escrow,
      send: (frame) => {
        if (context.closed || context.tradeProtocolClosed || peer !== context) {
          throw new Error("Le canal logique d'échange est fermé.")
        }
        context.tradeChannel.send(encodeHgssP2pTradeFrame(frame))
      },
    })
    context.coordinator = coordinator
    context.transactionId = transactionId
    context.recovery?.knownTransactions.add(transactionId)
    context.pendingTransactionId = undefined
    context.tradeError = undefined
    context.commitNotified = false
    startTimer(context)
    syncCoordinator(context)
    return true
  }

  const sendHandshake = (
    context: PeerContext,
    kind: TradeSessionHandshake['kind'],
    transactionId: string,
  ): void => {
    if (context.tradeProtocolClosed) throw new Error("Le canal logique d'échange est fermé.")
    context.tradeChannel.send(encodeHandshake(kind, transactionId))
  }

  const failTradeProtocol = async (context: PeerContext, message: string): Promise<void> => {
    if (context.tradeProtocolClosed) return
    context.tradeProtocolClosed = true
    if (context.recovery && !context.recovery.ready) {
      context.recovery.ready = true
      context.recovery.settleReady()
    }
    setTradeError(context, new Error(message))
    await stopCoordinator(context).catch((value: unknown) => {
      report(asError(value, "Le rollback local de l'échange a échoué."), 'trade')
    })
    try { context.tradeChannel.close() } catch { /* Le canal est déjà terminal. */ }
  }

  const acceptIncomingOpen = async (context: PeerContext, transactionId: string): Promise<boolean> => {
    if (context.coordinator) {
      const active = context.coordinator.getSnapshot()
      if (context.transactionId === transactionId) return true
      if (!isTerminalTrade(active)) {
        setTradeError(context, new Error("Une autre transaction d'échange est déjà active."))
        return false
      }
    }
    const pending = context.pendingTransactionId
    if (pending && pending !== transactionId) {
      // En ouverture simultanée, le participant lexicalement le plus petit
      // conserve sa proposition; l'autre adopte la sienne. Aucun libellé métier
      // n'entre dans cette décision déterministe.
      if (context.localParticipantId < context.remoteParticipantId) {
        sendHandshake(context, 'open', pending)
        return false
      }
      context.pendingTransactionId = undefined
    }
    return establishCoordinator(context, transactionId)
  }

  const receiveTradeMessage = async (context: PeerContext, message: string): Promise<void> => {
    const recoveryFrame = decodeHgssP2pTradeRecoveryFrame(message)
    if (recoveryFrame) {
      try { await receiveRecoveryFrame(context, recoveryFrame) }
      catch (value) {
        await failTradeProtocol(
          context,
          asError(value, "La réconciliation durable reçue est invalide.").message,
        )
      }
      return
    }
    if (recoveryWireProtocol(message)) {
      await failTradeProtocol(context, "Une frame de réconciliation durable reçue est invalide.")
      return
    }
    if (context.recovery?.active) {
      await failTradeProtocol(context, "Une transaction ordinaire a précédé la fin de la réconciliation durable.")
      return
    }
    const handshake = decodeHandshake(message)
    if (handshake.kind === 'invalid-handshake') {
      await failTradeProtocol(context, "L'ouverture de transaction reçue est invalide.")
      return
    }
    if (handshake.kind === 'handshake') {
      const { kind, transactionId } = handshake.value
      if (kind === 'open') {
        if (!await acceptIncomingOpen(context, transactionId)) return
        context.tradeOpen = true
        sendHandshake(context, 'open-ack', transactionId)
        syncCoordinator(context)
        return
      }
      if (kind === 'open-ack') {
        if (context.pendingTransactionId !== transactionId) {
          if (context.transactionId === transactionId) return
          setTradeError(context, new Error("L'accusé d'ouverture ne correspond à aucune transaction locale."))
          return
        }
        await establishCoordinator(context, transactionId)
        context.tradeOpen = true
        syncCoordinator(context)
        return
      }
      if (context.pendingTransactionId === transactionId && !context.coordinator) {
        context.pendingTransactionId = undefined
        context.tradeOpen = false
        render()
      } else if (context.transactionId === transactionId && context.coordinator) {
        await stopCoordinator(context)
        context.tradeOpen = false
        render()
      }
      return
    }

    const frame = decodeHgssP2pTradeFrame(message)
    if (!frame) {
      await failTradeProtocol(context, "Une trame d'échange reçue est invalide.")
      return
    }
    if (!context.coordinator || frame.transactionId !== context.transactionId) {
      setTradeError(context, new Error("Une trame vise une transaction d'échange qui n'est pas active."))
      return
    }
    const decision = await context.coordinator.receive(frame)
    if (
      decision.reason === 'foreign-transaction'
      || decision.reason === 'unexpected-sender'
      || decision.reason === 'invalid-frame'
    ) {
      await failTradeProtocol(context, "Une trame d'échange ne correspond pas à la session courante.")
      return
    }
    syncCoordinator(context)
  }

  const detachPeer = (context: PeerContext, closeTransport: boolean): Promise<void> => {
    if (context.detachOperation) return context.detachOperation
    if (context.closed) return Promise.resolve()
    context.closed = true
    cancelOfferSelection(context)
    settlePeerIntent(context)
    if (context.recovery && !context.recovery.ready) {
      context.recovery.ready = true
      context.recovery.settleReady()
    }
    if (peer === context) {
      peer = undefined
      if (context.intent.phase !== 'error' && context.intent.phase !== 'rejected') {
        publishIntentSession(Object.freeze({ status: 'idle' }))
      }
    }
    clearTimer(context)
    clearIntentTimer(context)
    const campaignStart = context.campaignStart
    try { context.campaignAbort?.abort() } catch { /* L'annulation est déjà terminale. */ }
    context.campaignAbort = undefined
    try { context.detachIntentChannel?.() } catch { /* Déjà détaché. */ }
    context.detachIntentChannel = undefined
    try { context.detachTradeChannel?.() } catch { /* Déjà détaché. */ }
    context.detachTradeChannel = undefined
    const operation = (async (): Promise<void> => {
      await context.queue.catch(() => undefined)
      await context.callbacks.catch(() => undefined)
      await campaignStart?.catch(() => undefined)
      const campaignSession = context.campaignSession
      context.campaignSession = undefined
      if (campaignSession) {
        try { await campaignSession.close() }
        catch (value) { report(asError(value, 'La fermeture de la campagne coopérative a échoué.'), 'session') }
      }
      const coordinator = context.coordinator
      if (coordinator) {
        const beforeDisconnect = coordinator.getSnapshot()
        if (beforeDisconnect.needsRecovery) {
          try { await options.game.onTradeRecoveryRequired?.(beforeDisconnect) }
          catch (value) { report(asError(value, 'La reprise locale de transaction a échoué.'), 'trade') }
        }
        try { await coordinator.disconnect() }
        catch (value) { report(asError(value, "Le rollback de déconnexion de l'échange a échoué."), 'trade') }
      }
      context.coordinator = undefined
      if (closeTransport) {
        try { context.multiplexer.close() } catch { /* Le lien RTC est déjà fermé. */ }
      }
    })()
    context.detachOperation = operation
    return operation
  }

  const armTradeProtocol = (context: PeerContext): void => {
    if (context.tradeArmed || context.closed || peer !== context) return
    context.detachTradeChannel?.()
    context.detachTradeChannel = undefined
    context.tradeArmed = true
    context.detachTradeChannel = context.tradeChannel.attach({
      onOpen: () => {
        void enqueue(context, () => startRecovery(context)).catch((value: unknown) => {
          setTradeError(context, value)
        })
      },
      onMessage: (message) => {
        void enqueue(context, () => receiveTradeMessage(context, message)).catch((value: unknown) => {
          setTradeError(context, value)
        })
      },
      onClose: () => {
        if (!context.closed && !context.tradeProtocolClosed) {
          void failTradeProtocol(context, "Le canal logique d'échange a été fermé par l'autre joueur.")
        }
      },
      onError: (value) => {
        if (!context.closed) setTradeError(context, value)
      },
    })
  }

  const expectedIntentForLink = (link: RtcPeerConnectionLink): P2pSessionIntent | undefined => {
    const pending = pendingSessionIntent
    const outbound = link.role === 'offerer'
    if (!pending) return outbound ? options.defaultSessionIntent ?? 'trade' : options.defaultSessionIntent
    const directionMatches = pending.direction === (outbound ? 'outbound' : 'inbound')
    const invitationMatches = outbound
      ? pending.invitationId === undefined
      : pending.invitationId === link.descriptor.negotiationId
    const negotiationMatches = pending.source !== 'matchmaking'
      || pending.negotiationId === link.descriptor.negotiationId
    if (!directionMatches
      || !invitationMatches
      || !negotiationMatches
      || pending.peerUserId !== link.descriptor.peerId) {
      pendingSessionIntent = undefined
      throw new Error("Le lien RTC reçu ne correspond pas à l'activité P2P demandée.")
    }
    pendingSessionIntent = undefined
    return pending.intent
  }

  const setupPeer = (link: RtcPeerConnectionLink, state: OnlineProductState): void => {
    if (!consumeRtcLink(link)) {
      throw new TypeError("Le lien RTC n'a pas été émis par la négociation active ou a déjà été consommé.")
    }
    if (pageReleaseInProgress) {
      try { link.channel.close() } catch { /* La page quitte déjà sa session. */ }
      return
    }
    const identity = state.identity
    const remoteParticipantId = link.descriptor.peerId
    const sessionId = link.descriptor.negotiationId
    if (!identity || !isOnlineOpaqueId(sessionId)) {
      sessionError = new Error("Le lien RTC ne fournit pas une identité de transaction compatible.")
      report(sessionError, 'session')
      controller.hangUp()
      return
    }
    const expectedIntent = expectedIntentForLink(link)
    const multiplexer = createPeerDataChannelMultiplexer(link.channel, {
      channelIds: [
        browserMultiplayerSessionChannelId,
        browserMultiplayerTradeChannelId,
        browserMultiplayerCampaignChannelId,
      ],
    })
    const intentChannel = multiplexer.getChannel(browserMultiplayerSessionChannelId)
    const tradeChannel = multiplexer.getChannel(browserMultiplayerTradeChannelId)
    const campaignChannel = multiplexer.getChannel(browserMultiplayerCampaignChannelId)
    const context: PeerContext = {
      link,
      sessionId,
      localParticipantId: identity,
      remoteParticipantId,
      role: link.role === 'offerer' ? 'host' : 'guest',
      multiplexer,
      intentChannel,
      tradeChannel,
      campaignChannel,
      queue: Promise.resolve(),
      callbacks: Promise.resolve(),
      closed: false,
      tradeProtocolClosed: false,
      tradeArmed: false,
      tradeOpen: false,
      commitNotified: false,
      selectionSerial: 0,
      intent: createPeerIntentContext(expectedIntent),
      ...(recoveryEscrow ? { recovery: createRecoveryContext(recoveryEscrow) } : {}),
    }
    peer = context
    context.detachTradeChannel = tradeChannel.attach({
      onOpen: () => undefined,
      onMessage: () => { failIntentSession(
        context,
        new Error("Un pair incompatible a lancé l'ancien protocole d'échange avant l'accord d'intention."),
      ) },
      onClose: () => undefined,
      onError: (value) => {
        if (!context.closed) failIntentSession(context, value)
      },
    })
    sessionError = undefined
    context.detachIntentChannel = intentChannel.attach({
      onOpen: () => {
        void enqueue(context, () => startIntentHandshake(context)).catch((value: unknown) => {
          failIntentSession(context, value)
        })
      },
      onMessage: (message) => {
        void enqueue(context, () => receiveIntentMessage(context, message)).catch((value: unknown) => {
          failIntentSession(context, value)
        })
      },
      onClose: () => {
        if (!context.closed && context.intent.phase === 'handshaking') {
          failIntentSession(context, new Error("Le canal d'intention P2P a été fermé avant l'accord."))
        }
      },
      onError: (value) => {
        if (!context.closed) failIntentSession(context, value)
      },
    })
    context.intentTimer = scheduler.setInterval(() => {
      clearIntentTimer(context)
      if (!context.closed && context.intent.phase === 'handshaking') {
        failIntentSession(context, new Error("L'accord d'intention P2P a expiré."))
      }
    }, intentHandshakeTimeoutMs)
    publishPeerIntent(context, Object.freeze({
      status: 'handshaking',
      peerUserId: context.remoteParticipantId,
      role: context.role,
      ...(expectedIntent ? { expectedIntent } : {}),
    }))
  }

  const initiateTrade = async (): Promise<void> => {
    const context = peer
    if (!context || onlineState.status !== 'connected') throw new Error('Une session P2P doit être connectée avant un échange.')
    await awaitTradeIntent(context)
    if (context.recovery && !context.recovery.ready) await context.recovery.readyPromise
    if (context.closed || context.tradeProtocolClosed || context.recovery?.active) {
      throw new Error("La réconciliation d'un échange précédent n'est pas terminée.")
    }
    await enqueue(context, async () => {
      if (context.recovery?.active) {
        throw new Error("La réconciliation d'un échange précédent doit se terminer avant un nouvel échange.")
      }
      if (context.tradeProtocolClosed) throw new Error("Le canal logique d'échange est fermé.")
      if (context.coordinator && !isTerminalTrade(context.coordinator.getSnapshot())) {
        context.tradeOpen = true
        context.tradeError = undefined
        syncCoordinator(context)
        return
      }
      if (context.coordinator) await stopCoordinator(context)
      const transactionId = context.pendingTransactionId ?? createTransactionId()
      if (!isOnlineOpaqueId(transactionId)) throw new TypeError("L'identifiant de transaction généré est invalide.")
      context.pendingTransactionId = transactionId
      context.tradeOpen = true
      context.tradeError = undefined
      context.localPresentation = undefined
      context.remotePresentation = undefined
      sendHandshake(context, 'open', transactionId)
      render()
    })
  }

  const chooseTradeOffer = async (): Promise<void> => {
    const context = peer
    const coordinator = context?.coordinator
    if (!context || !coordinator || !context.tradeOpen) throw new Error("La transaction d'échange n'est pas encore prête.")
    if (peerIsLocked(context)) throw new Error("L'offre ne peut plus changer pendant la finalisation durable.")
    context.selectionSerial += 1
    const selectionSerial = context.selectionSerial
    const currentPokemonId = coordinator.getSnapshot().localOffer?.preview.pokemonId
    const selection = await options.game.chooseLocalTradeOffer({
      ...(currentPokemonId ? { currentPokemonId } : {}),
    })
    if (peer !== context || context.closed || selectionSerial !== context.selectionSerial) return
    if (selection.kind === 'cancel') return
    await enqueue(context, async () => {
      if (context.coordinator !== coordinator) throw new Error("La transaction d'échange a changé pendant la sélection.")
      if (selection.kind === 'withdraw') await coordinator.withdrawOffer()
      else {
        const pokemon = parseHgssP2pTradePokemonSnapshot(selection.pokemon)
        if (!pokemon) throw new TypeError("Le Pokémon sélectionné ne possède pas de snapshot d'échange valide.")
        await coordinator.offer(pokemon)
      }
      context.tradeError = undefined
      syncCoordinator(context)
    })
  }

  const acceptTrade = async (): Promise<void> => {
    const context = peer
    const coordinator = context?.coordinator
    if (!context || !coordinator || !context.tradeOpen) throw new Error("La transaction d'échange n'est pas prête.")
    if (context.recovery?.active) throw new Error("Une reprise durable est déjà en cours.")
    await enqueue(context, async () => {
      if (context.coordinator !== coordinator) throw new Error("La transaction d'échange a changé.")
      await coordinator.accept()
      context.tradeError = undefined
      syncCoordinator(context)
    })
  }

  const cancelTrade = async (): Promise<void> => {
    const context = peer
    if (!context) return
    if (context.recovery?.active) throw new Error("Une reprise durable ne peut pas être annulée localement.")
    cancelOfferSelection(context)
    await enqueue(context, async () => {
      if (context.coordinator) {
        const cancelled = await context.coordinator.cancel('user')
        if (!cancelled) {
          syncCoordinator(context)
          throw new Error("La décision de commit est irréversible; l'échange doit être repris jusqu'à confirmation.")
        }
      } else if (context.pendingTransactionId) {
        sendHandshake(context, 'open-cancel', context.pendingTransactionId)
        context.pendingTransactionId = undefined
      }
      context.tradeOpen = false
      context.tradeError = undefined
      context.localPresentation = undefined
      context.remotePresentation = undefined
      render()
    })
  }

  const findInvitation = (invitationId: string): RtcSignalingInvitation | undefined => (
    onlineState.invitations.find(({ descriptor }) => descriptor.negotiationId === invitationId)
  )

  const findCoopInvitation = (
    invitationId: string,
  ): OnlineCoopRendezvousInvitation | undefined => {
    const sessionId = invitationId.startsWith(directCoopInvitationPrefix)
      ? invitationId.slice(directCoopInvitationPrefix.length)
      : invitationId
    if (!isOnlineOpaqueId(sessionId)) return undefined
    return onlineState.coopRendezvous?.invitations.find((value) => value.sessionId === sessionId)
  }

  const assertRtcAvailable = (): void => {
    if (!rtcAvailability.available) {
      throw new Error(
        rtcAvailability.reason ?? "Le pair-à-pair WebRTC n'est pas disponible sur cet appareil.",
      )
    }
  }

  const hasDirectCoopEngagement = (): boolean => {
    const current = onlineState.coopRendezvous?.current
    return current !== undefined && current.status !== 'idle'
  }

  const runCoopRendezvousMutation = (
    operation: () => Promise<OnlineCoopRendezvousSnapshot>,
  ): Promise<OnlineCoopRendezvousSnapshot> => {
    if (coopRendezvousMutation) {
      return Promise.reject(new Error('Une mutation de rendez-vous Coop est déjà en cours.'))
    }
    const tracked = Promise.resolve().then(operation).finally(() => {
      if (coopRendezvousMutation === tracked) coopRendezvousMutation = undefined
    })
    coopRendezvousMutation = tracked
    return tracked
  }

  const assertDirectCoopAvailable = (): NonNullable<typeof coopPorts> => {
    if (!options.game.campaign || !coopPorts || !onlineState.configured) {
      throw new Error("La campagne Coop du serveur n'est pas configurée sur ce client.")
    }
    if (onlineState.status !== 'ready') {
      throw new Error("Le compte doit être connecté au serveur avant d'ouvrir une campagne Coop.")
    }
    if (
      directCampaign
      || peer
      || pendingSessionIntent
      || matchmakingIntent
      || hasDirectCoopEngagement()
    ) {
      throw new Error('Une autre session multijoueur est déjà active.')
    }
    return coopPorts
  }

  const requestCoopFriendSession = async (userId: string): Promise<void> => {
    if (!isOnlineUserId(userId)) throw new TypeError("L'identité de l'ami Coop est invalide.")
    const direct = assertDirectCoopAvailable()
    sessionError = undefined
    publishIntentSession(Object.freeze({
      status: 'requesting',
      peerUserId: userId,
      intent: 'coop',
      direction: 'outbound',
    }))
    render()
    try {
      applyCoopRendezvous(await runCoopRendezvousMutation(() => direct.inviteFriend(userId)))
    } catch (value) {
      const error = asError(value, "L'invitation Coop a échoué.")
      publishIntentSession(Object.freeze({
        status: 'error',
        peerUserId: userId,
        role: 'host',
        expectedIntent: 'coop',
        message: error.message,
      }))
      throw error
    }
  }

  const acceptCoopInvitationOperation = async (
    invitation: OnlineCoopRendezvousInvitation,
  ): Promise<void> => {
    const direct = assertDirectCoopAvailable()
    if (invitation.expiresAt <= now()) throw new Error("Cette invitation Coop a expiré.")
    sessionError = undefined
    publishIntentSession(Object.freeze({
      status: 'requesting',
      peerUserId: invitation.fromUserId,
      intent: 'coop',
      direction: 'inbound',
    }))
    render()
    try {
      applyCoopRendezvous(await runCoopRendezvousMutation(
        () => direct.acceptInvitation(invitation.sessionId),
      ))
    } catch (value) {
      const error = asError(value, "L'acceptation de la campagne Coop a échoué.")
      publishIntentSession(Object.freeze({
        status: 'error',
        peerUserId: invitation.fromUserId,
        role: 'guest',
        expectedIntent: 'coop',
        message: error.message,
      }))
      throw error
    }
  }

  const requestFriendSessionOperation = async (
    userId: string,
    intent: P2pSessionIntent,
  ): Promise<void> => {
    if (!isP2pSessionIntent(intent)) throw new TypeError("L'activité P2P demandée est invalide.")
    if (intent === 'coop' && coopPorts) return requestCoopFriendSession(userId)
    assertRtcAvailable()
    if (
      pendingSessionIntent
      || peer
      || directCampaign
      || hasDirectCoopEngagement()
    ) {
      throw new Error('Une autre session pair-à-pair est déjà active.')
    }
    const request: PendingSessionIntent = Object.freeze({
      direction: 'outbound',
      source: 'friend',
      peerUserId: userId,
      intent,
    })
    pendingSessionIntent = request
    publishIntentSession(Object.freeze({
      status: 'requesting',
      peerUserId: userId,
      intent,
      direction: 'outbound',
    }))
    render()
    try { await controller.invitePeer(userId) }
    catch (value) {
      if (pendingSessionIntent === request) {
        pendingSessionIntent = undefined
        const error = asError(value, "L'invitation P2P a échoué.")
        publishIntentSession(Object.freeze({
          status: 'error',
          peerUserId: userId,
          role: 'host',
          expectedIntent: intent,
          message: error.message,
        }))
      }
      throw value
    }
  }

  const acceptSessionInvitationOperation = async (
    invitationId: string,
    expectedIntent?: P2pSessionIntent,
  ): Promise<void> => {
    if (expectedIntent !== undefined && !isP2pSessionIntent(expectedIntent)) {
      throw new TypeError("L'activité P2P attendue est invalide.")
    }
    const coopInvitation = findCoopInvitation(invitationId)
    if (coopInvitation || invitationId.startsWith(directCoopInvitationPrefix) || expectedIntent === 'coop') {
      if (!coopInvitation) throw new Error("Cette invitation Coop n'est plus active.")
      return acceptCoopInvitationOperation(coopInvitation)
    }
    assertRtcAvailable()
    if (
      pendingSessionIntent
      || peer
      || directCampaign
      || hasDirectCoopEngagement()
    ) {
      throw new Error('Une autre session pair-à-pair est déjà active.')
    }
    const invitation = findInvitation(invitationId)
    if (!invitation) throw new Error("Cette invitation n'est plus active.")
    const request: PendingSessionIntent = Object.freeze({
      direction: 'inbound',
      source: 'friend',
      peerUserId: invitation.descriptor.peerId,
      invitationId,
      ...(expectedIntent ? { intent: expectedIntent } : {}),
    })
    pendingSessionIntent = request
    if (expectedIntent) {
      publishIntentSession(Object.freeze({
        status: 'requesting',
        peerUserId: invitation.descriptor.peerId,
        intent: expectedIntent,
        direction: 'inbound',
      }))
      render()
    }
    try { await controller.acceptPeerInvitation(invitation) }
    catch (value) {
      if (pendingSessionIntent === request) pendingSessionIntent = undefined
      throw value
    }
  }

  const clearMatchmakingTimer = (): void => {
    if (matchmakingTimer === undefined) return
    scheduler.clearInterval(matchmakingTimer)
    matchmakingTimer = undefined
  }

  const cancelMatchmakingSearch = async (reportFailure: boolean): Promise<void> => {
    const wasSearching = matchmakingIntent !== undefined
      || intentSessionState.status === 'searching' && intentSessionState.intent !== 'coop'
      || pendingSessionIntent?.source === 'matchmaking'
    matchmakingGeneration += 1
    clearMatchmakingTimer()
    matchmakingPollInFlight = undefined
    matchmakingIntent = undefined
    if (pendingSessionIntent?.source === 'matchmaking') pendingSessionIntent = undefined
    if (wasSearching && !peer) {
      sessionError = undefined
      publishIntentSession(Object.freeze({ status: 'idle' }))
      render()
    }
    if (!wasSearching || !matchmakingPorts) return
    try { await matchmakingPorts.cancel() }
    catch (value) {
      if (reportFailure) report(asError(value, "L'annulation du matchmaking a échoué."), 'session')
    }
  }

  const failMatchmakingSearch = (generation: number, value: unknown): void => {
    if (generation !== matchmakingGeneration || !matchmakingIntent) return
    const error = asError(value, 'La recherche multijoueur a échoué.')
    matchmakingGeneration += 1
    clearMatchmakingTimer()
    matchmakingPollInFlight = undefined
    matchmakingIntent = undefined
    if (pendingSessionIntent?.source === 'matchmaking') pendingSessionIntent = undefined
    sessionError = error
    publishIntentSession(Object.freeze({ status: 'idle' }))
    report(error, 'session')
    render()
    void matchmakingPorts?.cancel().catch(() => undefined)
  }

  const applyRuntimeMatchmakingStatus = async (
    value: OnlineMatchmakingStatus,
    generation: number,
  ): Promise<void> => {
    if (generation !== matchmakingGeneration || !matchmakingIntent || destroyed) return
    const intent = matchmakingIntent
    if (value.status === 'idle') {
      throw new Error('La recherche multijoueur a expiré ou a été annulée avant appariement.')
    }
    if (value.activity !== intent) {
      throw new Error("Le match reçu ne correspond pas à l'activité recherchée.")
    }
    if (value.status === 'queued') return
    if (!matchmakingPorts) throw new Error("Le contrôleur ne peut pas consommer le match reçu.")
    const expected: PendingSessionIntent = Object.freeze({
      direction: value.role === 'offerer' ? 'outbound' : 'inbound',
      source: 'matchmaking',
      peerUserId: value.peerUserId,
      intent,
      negotiationId: value.negotiationId,
      ...(value.role === 'answerer' ? { invitationId: value.negotiationId } : {}),
    })
    if (pendingSessionIntent && (
      pendingSessionIntent.source !== 'matchmaking'
      || pendingSessionIntent.direction !== expected.direction
      || pendingSessionIntent.peerUserId !== expected.peerUserId
      || pendingSessionIntent.intent !== expected.intent
      || pendingSessionIntent.invitationId !== expected.invitationId
      || pendingSessionIntent.negotiationId !== expected.negotiationId
    )) {
      throw new Error("Le match reçu diverge d'une autorisation P2P déjà en attente.")
    }
    pendingSessionIntent = expected
    const link = await matchmakingPorts.consume(value)
    if (generation !== matchmakingGeneration || destroyed) return
    if (!link) return
    if (!peer || peer.link !== link) {
      throw new Error("Le lien RTC du match n'a pas été remis au runtime attendu.")
    }
    clearMatchmakingTimer()
    matchmakingIntent = undefined
    matchmakingPollInFlight = undefined
  }

  const pollMatchmaking = (): Promise<void> => {
    if (matchmakingPollInFlight) return matchmakingPollInFlight
    if (!matchmakingPorts || !matchmakingIntent || destroyed) return Promise.resolve()
    const generation = matchmakingGeneration
    const operation = matchmakingPorts.refresh()
      .then((status) => applyRuntimeMatchmakingStatus(status, generation))
      .catch((value: unknown) => { failMatchmakingSearch(generation, value) })
      .finally(() => {
        if (matchmakingPollInFlight === operation) matchmakingPollInFlight = undefined
      })
    matchmakingPollInFlight = operation
    return operation
  }

  const requestRandomCoopSession = async (): Promise<void> => {
    const direct = assertDirectCoopAvailable()
    sessionError = undefined
    publishIntentSession(Object.freeze({ status: 'searching', intent: 'coop' }))
    render()
    try {
      applyCoopRendezvous(await runCoopRendezvousMutation(direct.searchRandom))
    } catch (value) {
      const error = asError(value, 'La recherche de campagne Coop a échoué.')
      publishIntentSession(Object.freeze({ status: 'idle' }))
      throw error
    }
  }

  const requestRandomSessionOperation = async (intent: P2pSessionIntent): Promise<void> => {
    if (!isP2pSessionIntent(intent)) throw new TypeError("L'activité de matchmaking est invalide.")
    if (intent === 'coop' && coopPorts) return requestRandomCoopSession()
    assertRtcAvailable()
    if (!onlineState.configured || !matchmakingPorts) {
      throw new Error("Le matchmaking aléatoire n'est pas configuré sur ce client.")
    }
    if (
      onlineState.status !== 'ready'
      || peer
      || directCampaign
      || pendingSessionIntent
      || matchmakingIntent
      || hasDirectCoopEngagement()
    ) {
      throw new Error('Une autre session ou recherche pair-à-pair est déjà active.')
    }
    matchmakingGeneration += 1
    const generation = matchmakingGeneration
    matchmakingIntent = intent
    sessionError = undefined
    publishIntentSession(Object.freeze({ status: 'searching', intent }))
    render()
    try {
      const initial = await matchmakingPorts.join(intent)
      await applyRuntimeMatchmakingStatus(initial, generation)
      if (generation === matchmakingGeneration && matchmakingIntent && !peer) {
        matchmakingTimer = scheduler.setInterval(() => { void pollMatchmaking() }, matchmakingPollMs)
      }
    } catch (value) {
      failMatchmakingSearch(generation, value)
    }
  }

  const transferredCoopRendezvousIsCurrent = (): boolean => {
    const current = onlineState.coopRendezvous?.current
    return current !== undefined
      && 'sessionId' in current
      && current.sessionId === transferredCampaignSessionId
  }

  const cancelPendingCoopRendezvous = (reportFailure: boolean): Promise<void> => {
    if (coopCancellationOperation) return coopCancellationOperation
    if (transferredCoopRendezvousIsCurrent()) return Promise.resolve()
    const current = onlineState.coopRendezvous?.current
    const mutation = coopRendezvousMutation
    const pending = current !== undefined && current.status !== 'idle'
      || intentSessionState.status === 'searching' && intentSessionState.intent === 'coop'
      || intentSessionState.status === 'requesting' && intentSessionState.intent === 'coop'
      || mutation !== undefined
    if (!pending || !coopPorts) return Promise.resolve()
    const operation = (async (): Promise<void> => {
      await mutation?.catch(() => undefined)
      // Une réponse de mutation peut révéler entre-temps que cette incarnation
      // a été remplacée. L'ancien appareil ne supprime jamais cette session.
      if (transferredCoopRendezvousIsCurrent()) return
      try { applyCoopRendezvous(await coopPorts.cancel()) }
      catch (value) {
        if (reportFailure) {
          report(asError(value, "L'annulation du rendez-vous Coop a échoué."), 'session')
        }
      }
    })().finally(() => {
      if (coopCancellationOperation === operation) coopCancellationOperation = undefined
    })
    coopCancellationOperation = operation
    return operation
  }

  const run = (
    operation: () => Promise<unknown> | unknown,
    area: 'connection' | 'social' | 'session' | 'trade',
  ): void => {
    void Promise.resolve().then(operation).catch((value: unknown) => {
      const error = asError(value, 'Une opération multijoueur a échoué.')
      report(error, area)
      if (area === 'connection') connectionError = error
      else if (area === 'session') sessionError = error
      else if (area === 'trade' && peer) {
        peer.tradeError = error
        peer.tradeOpen = true
      }
      render()
    })
  }

  const blockUnsafeExit = (context: PeerContext | undefined): boolean => {
    if (!context || !peerIsLocked(context)) return false
    setTradeError(
      context,
      new Error("La session doit rester ouverte jusqu'à la confirmation durable de l'échange."),
    )
    return true
  }

  const closeAndCancelDirectCampaign = (
    context: DirectCampaignContext,
    reportFailure: boolean,
  ): Promise<void> => {
    const wasTransferred = (): boolean => context.transferred
      || transferredCampaignSessionId === context.sessionId
    if (wasTransferred()) return detachDirectCampaign(context)
    if (coopCancellationOperation) {
      return detachDirectCampaign(context).then(() => coopCancellationOperation)
    }
    const operation = (async (): Promise<void> => {
      await detachDirectCampaign(context)
      // `ConnectionReplaced` peut arriver pendant la fermeture locale. La
      // revalidation est collée au DELETE afin de protéger la session reprise.
      if (wasTransferred() || !coopPorts) return
      try { applyCoopRendezvous(await coopPorts.cancel()) }
      catch (value) {
        if (reportFailure) {
          report(asError(value, "La libération de la campagne Coop a échoué."), 'session')
        }
      }
    })().finally(() => {
      if (coopCancellationOperation === operation) coopCancellationOperation = undefined
    })
    coopCancellationOperation = operation
    return operation
  }

  const disconnectOnline = (): void => {
    if (!accountManagement || logoutOperation) return
    const context = peer
    const direct = directCampaign
    if (blockUnsafeExit(context)) return
    accountOperation = undefined
    pendingSessionIntent = undefined
    publishIntentSession(Object.freeze({ status: 'idle' }))
    connectionError = undefined
    sessionError = undefined
    render()

    const operation = (async (): Promise<void> => {
      // Toutes les libérations authentifiées doivent finir avant que logout()
      // n'efface et ne révoque le jeton du compte.
      await cancelMatchmakingSearch(true)
      if (direct) await closeAndCancelDirectCampaign(direct, true)
      else await cancelPendingCoopRendezvous(true)
      if (context) await detachPeer(context, true)
      await accountSession.logout()
    })().catch((value: unknown) => {
      report(asError(value, 'La déconnexion du compte a échoué.'), 'connection')
      accountSession.clear()
    }).finally(() => {
      account = undefined
      controller.disconnect()
      if (logoutOperation === operation) logoutOperation = undefined
      render()
    })
    logoutOperation = operation
  }

  const connectAccount = async (authenticatedAccount: OnlineAccount): Promise<void> => {
    account = authenticatedAccount
    if (!hasOnlineAccountEntitlement(authenticatedAccount, 'online')) return
    const accessToken = accountSession.readAccessToken()
    if (!accessToken) {
      if (accountManagement) accountSession.clear()
      account = undefined
      throw new Error('La session du compte a expiré. Reconnectez-vous.')
    }
    await controller.connect(accessToken)
  }

  const authenticateAccount = async (
    operation: 'login' | 'register',
    credentials: OnlineAccountCredentials,
  ): Promise<void> => {
    if (!accountManagement) return
    accountOperation = operation
    connectionError = undefined
    render()
    try {
      const authenticated = operation === 'login'
        ? await accountSession.login(credentials)
        : await accountSession.register(credentials)
      await connectAccount(authenticated.account)
    } finally {
      accountOperation = undefined
      render()
    }
  }

  const retryAccountConnection = async (): Promise<void> => {
    if (!account) throw new Error('Aucun compte connecté.')
    connectionError = undefined
    await connectAccount(account)
  }

  const ports: MultiplayerUiPorts = Object.freeze({
    login: accountManagement
      ? (credentials) => run(() => authenticateAccount('login', credentials), 'connection')
      : () => undefined,
    register: accountManagement
      ? (credentials) => run(() => authenticateAccount('register', credentials), 'connection')
      : () => undefined,
    retryConnection: () => run(retryAccountConnection, 'connection'),
    logout: accountManagement ? disconnectOnline : () => undefined,
    refreshSocial: () => run(async () => {
      await Promise.all([
        controller.refreshSocial(),
        coopPorts?.refresh().then(applyCoopRendezvous),
      ])
    }, 'social'),
    sendFriendRequest: (userId) => run(() => controller.sendFriendRequest(userId), 'social'),
    acceptFriendRequest: (userId) => run(() => controller.acceptFriendRequest(userId), 'social'),
    declineFriendRequest: (userId) => run(() => controller.declineFriendRequest(userId), 'social'),
    cancelFriendRequest: (userId) => run(() => controller.cancelFriendRequest(userId), 'social'),
    removeFriend(userId) {
      const context = peer
      if (context?.remoteParticipantId === userId && blockUnsafeExit(context)) return
      run(() => controller.removeFriend(userId), 'social')
    },
    inviteFriend(userId) {
      sessionError = undefined
      run(() => requestFriendSessionOperation(userId, 'trade'), 'session')
    },
    joinInvitation(invitationId) {
      const invitation = findInvitation(invitationId)
      const coopInvitation = findCoopInvitation(invitationId)
      if (!invitation && !coopInvitation) {
        sessionError = new Error("Cette invitation n'est plus active.")
        render()
        return
      }
      sessionError = undefined
      run(() => acceptSessionInvitationOperation(invitationId), 'session')
    },
    declineInvitation(invitationId) {
      const coopInvitation = findCoopInvitation(invitationId)
      if (coopInvitation && coopPorts) {
        run(async () => {
          applyCoopRendezvous(await coopPorts.declineInvitation(coopInvitation.sessionId))
        }, 'session')
        return
      }
      const invitation = findInvitation(invitationId)
      if (!invitation) return
      run(() => controller.declinePeerInvitation(invitation), 'session')
    },
    leaveSession() {
      const context = peer
      const direct = directCampaign
      if (blockUnsafeExit(context)) return
      void cancelMatchmakingSearch(true)
      if (!direct) void cancelPendingCoopRendezvous(true)
      pendingSessionIntent = undefined
      publishIntentSession(Object.freeze({ status: 'idle' }))
      if (context) void detachPeer(context, true)
      if (direct) void closeAndCancelDirectCampaign(direct, true)
      else controller.hangUp()
      sessionError = undefined
    },
    openTrade: () => run(initiateTrade, 'trade'),
    chooseTradeOffer: () => run(chooseTradeOffer, 'trade'),
    changeTradeOffer: () => run(chooseTradeOffer, 'trade'),
    cancelTrade: () => run(cancelTrade, 'trade'),
    acceptTrade: () => run(acceptTrade, 'trade'),
    requestSession(request: MultiplayerSessionRequest) {
      sessionError = undefined
      if (request.target.kind === 'random') {
        run(() => requestRandomSessionOperation(request.intent), 'session')
        return
      }
      const userId = request.target.userId
      run(() => requestFriendSessionOperation(userId, request.intent), 'session')
    },
    acceptSessionIntent(consent) {
      sessionError = undefined
      run(() => acceptSessionIntentConsent(consent.peerUserId, consent.intent), 'session')
    },
    declineSessionIntent(consent) {
      run(() => declineSessionIntentConsent(consent.peerUserId, consent.intent), 'session')
    },
  })

  const shell: MultiplayerUiShell = createUi({
    root: options.root,
    ports,
    accountManagement,
    ...(options.uiLabels ? { labels: options.uiLabels } : {}),
    ...(options.uiPresentation ? { present: options.uiPresentation } : {}),
  })
  snapshot = createSnapshot()
  detachOnline = controller.subscribe((next) => {
    if (destroyed) return
    const previous = peer
    onlineState = next
    applyCoopRendezvous(next.coopRendezvous)
    syncCoopPolling()
    if (next.status === 'failed' && next.error instanceof OnlineServiceError && next.error.status === 401) {
      if (accountManagement) accountSession.clear()
      account = undefined
      connectionError = new Error('La session du compte a expiré. Reconnectez-vous.')
    }
    if ((next.status === 'disconnected' || next.status === 'failed') && matchmakingIntent) {
      matchmakingGeneration += 1
      clearMatchmakingTimer()
      matchmakingPollInFlight = undefined
      matchmakingIntent = undefined
      if (pendingSessionIntent?.source === 'matchmaking') pendingSessionIntent = undefined
      publishIntentSession(Object.freeze({ status: 'idle' }))
    }
    const link = next.rtcLink
    if (previous && previous.link !== link) {
      void detachPeer(previous, link === undefined)
    }
    if (link && !pageReleaseInProgress && (!peer || peer.link !== link)) {
      try { setupPeer(link, next) }
      catch (value) {
        sessionError = asError(value, "L'initialisation du lien multijoueur a échoué.")
        report(sessionError, 'session')
        controller.hangUp()
      }
    } else if (!link && previous && next.error) {
      sessionError = next.error
    }
    render()
  })
  if (onlineState.status === 'disconnected' || onlineState.status === 'failed') {
    const establishedAccount = accountSession.getAccount()
    if (!accountManagement && establishedAccount) {
      run(() => connectAccount(establishedAccount), 'connection')
    } else if (accountManagement && accountSession.hasPersistedSession()) {
      run(() => {
        const restoredAccount = accountSession.getAccount()
        if (restoredAccount) return connectAccount(restoredAccount)
        accountOperation = 'restore'
        connectionError = undefined
        render()
        return accountSession.restore()
          .then(async (restored) => {
            if (!restored) {
              account = undefined
              return
            }
            await connectAccount(restored)
          })
          .finally(() => {
            accountOperation = undefined
            render()
          })
      }, 'connection')
    }
  }

  const prepareForPageRelease = (): Promise<void> => {
    if (pageReleaseOperation) return pageReleaseOperation
    pageReleaseInProgress = true
    clearCoopPoll()
    const context = peer
    // `detachPeer` ferme synchroniquement l'admission de nouvelles callbacks,
    // puis sa promesse draine la queue transactionnelle et le journal de reprise.
    const peerRelease = context ? detachPeer(context, true) : Promise.resolve()
    const direct = directCampaign
    const operation = (async (): Promise<void> => {
      await peerRelease
      // Les rendez-vous REST appartiennent encore au jeton de cette page :
      // les libérer avant de couper le contrôleur évite de bloquer un autre
      // appareil jusqu'au TTL serveur.
      await cancelMatchmakingSearch(false)
      if (direct) await closeAndCancelDirectCampaign(direct, false)
      else await cancelPendingCoopRendezvous(false)
      controller.disconnect()
    })().finally(() => {
      pageReleaseInProgress = false
      if (pageReleaseOperation === operation) pageReleaseOperation = undefined
    })
    pageReleaseOperation = operation
    return operation
  }

  return Object.freeze({
    getSnapshot: () => snapshot,
    getIntentSessionState: () => intentSessionState,
    subscribeIntentSession(listener) {
      intentSessionListeners.add(listener)
      safeIntentListener(listener, intentSessionState)
      return () => { intentSessionListeners.delete(listener) }
    },
    requestFriendSession(userId, intent) {
      sessionError = undefined
      run(() => requestFriendSessionOperation(userId, intent), 'session')
    },
    acceptSessionInvitation(invitationId, expectedIntent) {
      sessionError = undefined
      run(() => acceptSessionInvitationOperation(invitationId, expectedIntent), 'session')
    },
    getOnlineController: () => controller,
    prepareForPageRelease,
    async destroy() {
      if (destroyed) return
      await cancelMatchmakingSearch(false)
      clearCoopPoll()
      const direct = directCampaign
      if (direct) await closeAndCancelDirectCampaign(direct, false)
      else await cancelPendingCoopRendezvous(false)
      destroyed = true
      clearCoopPoll()
      pendingSessionIntent = undefined
      intentSessionListeners.clear()
      try { detachOnline?.() } catch { /* Déjà détaché. */ }
      detachOnline = undefined
      const context = peer
      if (context) await detachPeer(context, true)
      controller.disconnect()
      shell.destroy()
    },
  })
}
