import { describe, expect, it, vi } from 'vitest'
import type {
  OnlineProductController,
  OnlineProductState,
} from '../../online/onlineProductController'
import type {
  OnlineMatchmakingActivity,
  OnlineMatchmakingStatus,
} from '../../online/onlineMatchmakingProtocol'
import type {
  OnlineCoopRendezvousInvitation,
  OnlineCoopRendezvousSnapshot,
} from '../../online/onlineCoopRendezvousProtocol'
import type {
  OnlineAccount,
  OnlineAccountAuthentication,
  OnlineAccountSession,
} from '../../online/onlineAccountSession'
import type {
  PeerDataChannel,
  PeerDataChannelHandlers,
  PeerDataChannelState,
} from '../../online/peerDataChannel'
import {
  peerDataChannelMultiplexerProtocol,
  peerDataChannelMultiplexerProtocolVersion,
} from '../../online/peerDataChannelMultiplexer'
import type {
  RtcPeerConnectionAvailability,
  RtcPeerConnectionLink,
} from '../../online/rtcPeerConnectionSession'
import type {
  MultiplayerUiPorts,
  MultiplayerUiShell,
  MultiplayerUiShellOptions,
  MultiplayerUiSnapshot,
} from '../ui/multiplayerUiShell'
import type { PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import {
  createCanonicalPokemon,
  type CanonicalPokemon,
  type PokemonTrainerIdentity,
} from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  cloneFieldScriptState,
  createFieldScriptState,
  type FieldPokemonRuntime,
  type FieldScriptState,
} from '../scripts/fieldScriptRunner'
import {
  browserMultiplayerCampaignChannelId,
  browserMultiplayerSessionChannelId,
  browserMultiplayerTradeChannelId,
  browserMultiplayerTradeSessionProtocolVersion,
  browserMultiplayerTradeSessionProtocol,
  createBrowserMultiplayerRuntime,
  type BrowserMultiplayerGamePorts,
  type BrowserMultiplayerRuntime,
  type BrowserMultiplayerScheduler,
  type BrowserMultiplayerTradeSelection,
} from './browserMultiplayerRuntime'
import {
  browserMultiplayerCampaignConnectionReplacedErrorCode,
  type BrowserMultiplayerCampaignPort,
  type BrowserMultiplayerCampaignSession,
  type BrowserMultiplayerCampaignStartContext,
} from './browserMultiplayerCampaignPort'
import type { P2pSessionIntent } from './p2pSessionIntentProtocol'
import type {
  HgssP2pTradeCommitRequest,
  HgssP2pTradeCommitResult,
  HgssP2pTradeEscrowPort,
  HgssP2pTradePrepareRequest,
  HgssP2pTradeRollbackReason,
} from './hgssP2pTradeCoordinator'
import { installBrowserTitleSavePageLifecycle } from '../menu/browserTitleSavePageLifecycle'
import {
  hgssP2pTradeProtocol,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'
import { snapshotCanonicalPokemonForP2pTrade } from './hgssP2pTradePokemonAdapter'
import {
  createHgssP2pTradeRuntimeEscrow,
  hgssInternetTradesGameStatId,
} from './hgssP2pTradeRuntimeEscrow'

const sessionId = 'S'.repeat(21) + 'A'
const aliceTransactionId = 'A'.repeat(22)
const bobTransactionId = 'B'.repeat(21) + 'Q'
const aliceSecondTransactionId = `${'C'.repeat(21)}g`
const recoverySessionId = `${'R'.repeat(21)}Q`
const remoteOnlyRecoverySessionId = `${'T'.repeat(21)}A`
const matchmakingMatchId = `${'M'.repeat(21)}Q`
const matchmakingSessionId = `${'N'.repeat(21)}g`

function pokemonId(byte: string): PokemonInstanceId {
  return `pkm:v1:r:${byte.repeat(32)}` as PokemonInstanceId
}

function pokemon(byte: string, speciesId: number): HgssP2pTradePokemonSnapshot {
  const parsed = parseHgssP2pTradePokemonSnapshot({
    instanceId: pokemonId(byte),
    speciesId,
    form: 0,
    personality: Number.parseInt(byte.repeat(8), 16) >>> 0,
    originalTrainer: {
      id: Number.parseInt(byte.repeat(8), 16) >>> 0,
      gender: 'male',
      name: `OT${byte}`,
      nameSource: 'user-text',
    },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    level: 25,
    experience: 15_625,
    individualValues: { hp: 31, attack: 30, defense: 29, speed: 28, specialAttack: 27, specialDefense: 26 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [{ moveId: 33, pp: 35, maxPp: 35, ppUps: 0 }],
    stats: { hp: 60, attack: 41, defense: 42, speed: 43, specialAttack: 44, specialDefense: 45 },
    currentHp: 60,
    status: 0,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    contestValues: [0, 0, 0, 0, 0, 0],
    ribbonIds: [],
  })
  if (!parsed) throw new Error('Fixture de transaction invalide.')
  return parsed
}

class MemoryChannel implements PeerDataChannel {
  private state: PeerDataChannelState = 'open'
  private handlers?: PeerDataChannelHandlers
  peer?: MemoryChannel
  interceptSend?: (message: string) => boolean
  readonly sent: string[] = []

  getState = (): PeerDataChannelState => this.state
  attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (this.handlers) throw new Error('physical-channel-already-attached')
    this.handlers = handlers
    queueMicrotask(handlers.onOpen)
    return () => { if (this.handlers === handlers) this.handlers = undefined }
  }
  send = (message: string): void => {
    if (this.state !== 'open' || this.peer?.state !== 'open') throw new Error('physical-channel-closed')
    this.sent.push(message)
    if (this.interceptSend?.(message)) return
    const target = this.peer.handlers
    queueMicrotask(() => target?.onMessage(message))
  }
  close = (): void => {
    if (this.state === 'closed') return
    this.state = 'closed'
    const local = this.handlers
    const remote = this.peer
    queueMicrotask(() => local?.onClose())
    remote?.closeFromPeer()
  }
  private closeFromPeer(): void {
    if (this.state === 'closed') return
    this.state = 'closed'
    const handlers = this.handlers
    queueMicrotask(() => handlers?.onClose())
  }
}

function channelPair(): readonly [MemoryChannel, MemoryChannel] {
  const left = new MemoryChannel()
  const right = new MemoryChannel()
  left.peer = right
  right.peer = left
  return [left, right]
}

function emptyOnlineState(identity: string, remote: string): OnlineProductState {
  return Object.freeze({
    configured: true,
    status: 'ready',
    identity,
    friends: Object.freeze([Object.freeze({ userId: remote, online: true })]),
    incomingFriendRequests: Object.freeze([]),
    outgoingFriendRequests: Object.freeze([]),
    invitations: Object.freeze([]),
  })
}

class FakeOnlineController implements OnlineProductController {
  protected state: OnlineProductState
  private readonly listeners = new Set<(state: OnlineProductState) => void>()
  readonly invitePeerSpy = vi.fn<(userId: string) => Promise<RtcPeerConnectionLink>>(async (userId) => {
    throw new Error(`fake-no-link:${userId}`)
  })
  readonly removeFriendSpy = vi.fn<(userId: string) => Promise<void>>(async () => undefined)
  readonly hangUpSpy = vi.fn<() => void>()
  readonly connectSpy = vi.fn<(accessToken: string) => Promise<void>>(async () => undefined)
  readonly disconnectSpy = vi.fn<() => void>()

  constructor(identity: string, remote: string) {
    this.state = emptyOnlineState(identity, remote)
  }

  getState = (): OnlineProductState => this.state
  subscribe = (listener: (state: OnlineProductState) => void): (() => void) => {
    this.listeners.add(listener)
    listener(this.state)
    return () => { this.listeners.delete(listener) }
  }
  connect = (accessToken: string): Promise<void> => this.connectSpy(accessToken)
  disconnect = (): void => {
    this.disconnectSpy()
    this.state = Object.freeze({
      configured: true,
      status: 'disconnected',
      friends: Object.freeze([]),
      incomingFriendRequests: Object.freeze([]),
      outgoingFriendRequests: Object.freeze([]),
      invitations: Object.freeze([]),
    })
    this.publish()
  }
  refreshSocial = async (): Promise<void> => undefined
  sendFriendRequest = async (): Promise<void> => undefined
  acceptFriendRequest = async (): Promise<void> => undefined
  declineFriendRequest = async (): Promise<void> => undefined
  cancelFriendRequest = async (): Promise<void> => undefined
  removeFriend = (userId: string): Promise<void> => this.removeFriendSpy(userId)
  invitePeer = (userId: string): Promise<RtcPeerConnectionLink> => this.invitePeerSpy(userId)
  acceptPeerInvitation = async (): Promise<RtcPeerConnectionLink> => {
    throw new Error('fake-no-invitation')
  }
  declinePeerInvitation = async (): Promise<void> => undefined
  hangUp = (): void => {
    this.hangUpSpy()
    const identity = this.state.identity
    const remote = this.state.activePeer?.peerId
    if (identity && remote) this.state = emptyOnlineState(identity, remote)
    this.publish()
  }

  connectLink(link: RtcPeerConnectionLink): void {
    const identity = this.state.identity
    if (!identity) throw new Error('fake-identity-missing')
    this.state = Object.freeze({
      ...emptyOnlineState(identity, link.descriptor.peerId),
      status: 'connected',
      activePeer: Object.freeze({
        peerId: link.descriptor.peerId,
        negotiationId: link.descriptor.negotiationId,
        role: link.role,
      }),
      rtcLink: link,
    })
    this.publish()
  }

  protected publish(): void {
    for (const listener of this.listeners) listener(this.state)
  }
}

const directExpiry = 8_000_000_000_000

function coopSnapshot(
  current: OnlineCoopRendezvousSnapshot['current'],
  invitations: readonly OnlineCoopRendezvousInvitation[] = [],
): OnlineCoopRendezvousSnapshot {
  return Object.freeze({
    protocolVersion: 1,
    current: Object.freeze({ ...current }) as OnlineCoopRendezvousSnapshot['current'],
    invitations: Object.freeze(invitations.map((value) => Object.freeze({ ...value }))),
  })
}

class FakeDirectCoopOnlineController extends FakeOnlineController {
  private coop = coopSnapshot({ status: 'idle' })
  readonly refreshCoopRendezvousSpy = vi.fn(async () => this.coop)
  readonly searchRandomCoopSpy = vi.fn(async () => this.coop)
  readonly inviteCoopFriendSpy = vi.fn(async (userId: string) => {
    void userId
    return this.coop
  })
  readonly acceptCoopInvitationSpy = vi.fn(async (sessionId: string) => {
    void sessionId
    return this.coop
  })
  readonly declineCoopInvitationSpy = vi.fn(async (sessionId: string) => {
    void sessionId
    return this.coop
  })
  readonly cancelCoopRendezvousSpy = vi.fn(async () => coopSnapshot({ status: 'idle' }))

  constructor(identity: string, remote: string) {
    super(identity, remote)
    this.state = Object.freeze({ ...this.state, coopRendezvous: this.coop })
  }

  private apply(value: OnlineCoopRendezvousSnapshot): OnlineCoopRendezvousSnapshot {
    this.coop = value
    this.state = Object.freeze({ ...this.state, coopRendezvous: value })
    this.publish()
    return value
  }

  setCoop(value: OnlineCoopRendezvousSnapshot): void { this.apply(value) }

  refreshCoopRendezvous = async (): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.refreshCoopRendezvousSpy())
  )
  searchRandomCoop = async (): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.searchRandomCoopSpy())
  )
  inviteCoopFriend = async (userId: string): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.inviteCoopFriendSpy(userId))
  )
  acceptCoopInvitation = async (session: string): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.acceptCoopInvitationSpy(session))
  )
  declineCoopInvitation = async (session: string): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.declineCoopInvitationSpy(session))
  )
  cancelCoopRendezvous = async (): Promise<OnlineCoopRendezvousSnapshot> => (
    this.apply(await this.cancelCoopRendezvousSpy())
  )
}

function queuedMatchmakingStatus(activity: OnlineMatchmakingActivity): OnlineMatchmakingStatus {
  return Object.freeze({
    status: 'queued',
    activity,
    joinedAt: 1_000,
    expiresAt: 60_000,
  })
}

function runtimeMatchedStatus(
  activity: OnlineMatchmakingActivity,
  role: 'offerer' | 'answerer',
  peerUserId: string,
  negotiationId = matchmakingSessionId,
): OnlineMatchmakingStatus {
  return Object.freeze({
    status: 'matched',
    activity,
    expiresAt: 60_000,
    matchId: matchmakingMatchId,
    negotiationId,
    peerUserId,
    role,
  })
}

class FakeMatchmakingOnlineController extends FakeOnlineController {
  readonly joinMatchmakingSpy = vi.fn<(
    activity: OnlineMatchmakingActivity,
  ) => Promise<OnlineMatchmakingStatus>>(async (activity) => queuedMatchmakingStatus(activity))
  readonly refreshMatchmakingSpy = vi.fn<() => Promise<OnlineMatchmakingStatus>>(
    async () => Object.freeze({ status: 'idle' }),
  )
  readonly cancelMatchmakingSpy = vi.fn<() => Promise<void>>(async () => undefined)
  readonly consumeMatchmakingMatchSpy = vi.fn<(
    status: Extract<OnlineMatchmakingStatus, { status: 'matched' }>,
  ) => Promise<RtcPeerConnectionLink | undefined>>(async () => undefined)

  joinMatchmaking = (activity: OnlineMatchmakingActivity): Promise<OnlineMatchmakingStatus> => (
    this.joinMatchmakingSpy(activity)
  )
  refreshMatchmaking = (): Promise<OnlineMatchmakingStatus> => this.refreshMatchmakingSpy()
  cancelMatchmaking = (): Promise<void> => this.cancelMatchmakingSpy()
  consumeMatchmakingMatch = (
    status: Extract<OnlineMatchmakingStatus, { status: 'matched' }>,
  ): Promise<RtcPeerConnectionLink | undefined> => this.consumeMatchmakingMatchSpy(status)
}

class MemoryEscrow implements HgssP2pTradeEscrowPort {
  readonly preparations: HgssP2pTradePrepareRequest[] = []
  readonly commits: HgssP2pTradeCommitRequest[] = []
  readonly rollbacks: Array<Readonly<{
    request: HgssP2pTradePrepareRequest
    reason: HgssP2pTradeRollbackReason
  }>> = []
  private readonly participantId: string
  failCommitCount = 0

  constructor(participantId: string) { this.participantId = participantId }

  prepare = (request: HgssP2pTradePrepareRequest) => {
    this.preparations.push(request)
    return { reservationId: `${this.participantId}:reservation` }
  }
  commit = (request: HgssP2pTradeCommitRequest): HgssP2pTradeCommitResult => {
    this.commits.push(request)
    if (this.failCommitCount > 0) {
      this.failCommitCount -= 1
      throw new Error('transient-persistence-failure')
    }
    const evolves = request.incoming.speciesId === 155
    return {
      status: 'committed',
      receipt: {
        transactionId: request.transactionId,
        sentPokemonInstanceId: request.outgoing.instanceId,
        receivedPokemonInstanceId: request.incoming.instanceId,
      },
      outgoingPokemonId: request.outgoing.instanceId,
      incomingPokemonId: request.incoming.instanceId,
      receivedSpeciesId: evolves ? 156 : request.incoming.speciesId,
      destination: { kind: 'party', slot: 0 },
      ...(evolves ? {
        evolution: {
          sourceSpeciesId: 155,
          targetSpeciesId: 156,
          learnedMoveIds: [43],
          skippedMoveIds: [],
        },
      } : {}),
    }
  }
  rollback = (
    request: HgssP2pTradePrepareRequest,
    _reservation: { reservationId: string },
    reason: HgssP2pTradeRollbackReason,
  ): void => { this.rollbacks.push({ request, reason }) }
}

type FakeView = Readonly<{
  ports: MultiplayerUiPorts
  shell: MultiplayerUiShell
  getSnapshot: () => MultiplayerUiSnapshot | undefined
}>

function createViewFactory(): Readonly<{
  factory: (options: MultiplayerUiShellOptions) => MultiplayerUiShell
  getView: () => FakeView
}> {
  let ports: MultiplayerUiPorts | undefined
  let current: MultiplayerUiSnapshot | undefined
  let shell: MultiplayerUiShell | undefined
  return {
    factory(options) {
      ports = options.ports
      shell = Object.freeze({
        update: (snapshot) => { current = snapshot },
        destroy: () => { current = undefined },
      })
      return shell
    },
    getView() {
      if (!ports || !shell) throw new Error('fake-view-not-created')
      return { ports, shell, getSnapshot: () => current }
    },
  }
}

const scheduler: BrowserMultiplayerScheduler = Object.freeze({
  setInterval: () => Object.freeze({ kind: 'fake-interval' }),
  clearInterval: () => undefined,
})

function createControlledScheduler(): BrowserMultiplayerScheduler & Readonly<{ run: () => void }> {
  const callbacks = new Map<object, () => void>()
  return Object.freeze({
    setInterval(callback) {
      const handle = Object.freeze({ kind: 'controlled-interval' })
      callbacks.set(handle, callback)
      return handle
    },
    clearInterval(handle) {
      if (typeof handle === 'object' && handle !== null) callbacks.delete(handle)
    },
    run() {
      for (const callback of [...callbacks.values()]) callback()
    },
  })
}

function deferred<Value>(): Readonly<{
  promise: Promise<Value>
  resolve: (value: Value) => void
  reject: (reason?: unknown) => void
}> {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

class PageCacheWindow {
  private readonly listeners = new Map<string, Set<EventListener>>()

  addEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener !== 'function') return
    const bucket = this.listeners.get(type) ?? new Set<EventListener>()
    bucket.add(listener)
    this.listeners.set(type, bucket)
  }

  removeEventListener(type: string, listener: EventListenerOrEventListenerObject): void {
    if (typeof listener === 'function') this.listeners.get(type)?.delete(listener)
  }

  dispatchPageHide(persisted: boolean): void {
    const event = { persisted } as PageTransitionEvent
    for (const listener of this.listeners.get('pagehide') ?? []) listener(event)
  }
}

function deferredCampaignPort() {
  const session = deferred<BrowserMultiplayerCampaignSession>()
  const contexts: BrowserMultiplayerCampaignStartContext[] = []
  const close = vi.fn(async () => undefined)
  const start = vi.fn((context: BrowserMultiplayerCampaignStartContext) => {
    contexts.push(context)
    return session.promise
  })
  return Object.freeze({
    port: Object.freeze({ start }) satisfies BrowserMultiplayerCampaignPort,
    contexts,
    start,
    close,
    arm: () => session.resolve(Object.freeze({ close })),
  })
}

class TestRtcLinkAuthority {
  private readonly issued = new WeakSet<object>()
  private readonly consumed = new WeakSet<object>()

  issue(link: RtcPeerConnectionLink): RtcPeerConnectionLink {
    this.issued.add(link)
    return link
  }

  consume = (value: unknown): value is RtcPeerConnectionLink => {
    if (
      value === null
      || typeof value !== 'object'
      || !this.issued.has(value)
      || this.consumed.has(value)
    ) return false
    this.consumed.add(value)
    return true
  }
}

type PeerHarness = Readonly<{
  runtime: BrowserMultiplayerRuntime
  controller: FakeOnlineController
  view: FakeView
  escrow: MemoryEscrow
  selections: Array<BrowserMultiplayerTradeSelection | Promise<BrowserMultiplayerTradeSelection>>
  committed: ReturnType<typeof vi.fn<(result: HgssP2pTradeCommitResult) => void>>
  cancelSelection: ReturnType<typeof vi.fn<() => void>>
  issueLink: (link: RtcPeerConnectionLink) => RtcPeerConnectionLink
}>

function createPeerHarness(
  identity: string,
  remote: string,
  transactionId: string | (() => string),
  runtimeScheduler: BrowserMultiplayerScheduler = scheduler,
  defaultSessionIntent: P2pSessionIntent | null = 'trade',
  controllerOverride?: FakeOnlineController,
  accountSession?: OnlineAccountSession,
  accountManagement?: boolean,
  rtcAvailability?: RtcPeerConnectionAvailability,
  campaign?: BrowserMultiplayerCampaignPort,
  now?: () => number,
): PeerHarness {
  const controller = controllerOverride ?? new FakeOnlineController(identity, remote)
  const viewFactory = createViewFactory()
  const escrow = new MemoryEscrow(identity)
  const selections: Array<BrowserMultiplayerTradeSelection | Promise<BrowserMultiplayerTradeSelection>> = []
  const committed = vi.fn<(result: HgssP2pTradeCommitResult) => void>()
  const cancelSelection = vi.fn<() => void>()
  const linkAuthority = new TestRtcLinkAuthority()
  const runtime = createBrowserMultiplayerRuntime({
    root: {} as HTMLElement,
    onlineController: controller,
    ...(accountSession ? { accountSession } : {}),
    ...(accountManagement === undefined ? {} : { accountManagement }),
    uiFactory: viewFactory.factory,
    transactionIdFactory: typeof transactionId === 'function' ? transactionId : () => transactionId,
    rtcLinkConsumer: linkAuthority.consume,
    ...(rtcAvailability ? { rtcAvailability } : {}),
    ...(defaultSessionIntent === null ? {} : { defaultSessionIntent }),
    tradeTimeoutMs: 10_000,
    scheduler: runtimeScheduler,
    ...(now ? { now } : {}),
    game: {
      escrow,
      presentationResources: { pokemonCatalog: createPokemonTestCatalog() },
      chooseLocalTradeOffer: () => selections.shift() ?? { kind: 'cancel' },
      cancelLocalTradeOfferSelection: cancelSelection,
      onTradeCommitted: committed,
      ...(campaign ? { campaign } : {}),
    },
  })
  return {
    runtime,
    controller,
    view: viewFactory.getView(),
    escrow,
    selections,
    committed,
    cancelSelection,
    issueLink: (link) => linkAuthority.issue(link),
  }
}

function connectPeers(
  alice: PeerHarness,
  bob: PeerHarness,
  channels: readonly [MemoryChannel, MemoryChannel],
  negotiationId = sessionId,
): void {
  const descriptorForAlice = Object.freeze({ peerId: 'bob', negotiationId })
  const descriptorForBob = Object.freeze({ peerId: 'alice', negotiationId })
  alice.controller.connectLink(alice.issueLink(Object.freeze({
    channel: channels[0], descriptor: descriptorForAlice, role: 'offerer',
  })))
  bob.controller.connectLink(bob.issueLink(Object.freeze({
    channel: channels[1], descriptor: descriptorForBob, role: 'answerer',
  })))
}

function physicalPayloads(channel: MemoryChannel): string[] {
  return channel.sent.flatMap((message) => {
    const frame = JSON.parse(message) as { payload?: unknown }
    return typeof frame.payload === 'string' ? [frame.payload] : []
  })
}

function testAccount(
  username: string,
  role: OnlineAccount['role'] = 'user',
  entitlements: readonly string[] = ['online'],
): OnlineAccount {
  return Object.freeze({ id: username, username, role, entitlements: Object.freeze([...entitlements]) })
}

function accountAuthentication(account: OnlineAccount, accessToken: string): OnlineAccountAuthentication {
  return Object.freeze({
    account,
    session: Object.freeze({ accessToken, expiresAt: Date.now() + 60_000 }),
  })
}

function fakeAccountSession(options: Readonly<{
  account?: OnlineAccount
  accessToken?: string
  persisted?: boolean
  restore?: () => Promise<OnlineAccount | undefined>
  login?: OnlineAccountSession['login']
  register?: OnlineAccountSession['register']
}> = {}): OnlineAccountSession {
  let account = options.account
  let accessToken = options.accessToken
  const listeners = new Set<(snapshot: ReturnType<OnlineAccountSession['getAccessSnapshot']>) => void>()
  const accessSnapshot = (): ReturnType<OnlineAccountSession['getAccessSnapshot']> => Object.freeze({
    signedIn: account !== undefined,
    ...(account ? { account } : {}),
    isAdmin: account?.role === 'admin',
    online: account?.role === 'admin' || account?.entitlements.includes('online') === true
      || account?.entitlements.includes('development') === true,
    premiumClient: account?.role === 'admin' || account?.entitlements.includes('premium-client') === true
      || account?.entitlements.includes('development') === true,
    cloudStorage: account?.role === 'admin' || account?.entitlements.includes('cloud-storage') === true
      || account?.entitlements.includes('development') === true,
    development: account?.entitlements.includes('development') === true,
  })
  const publish = (): void => { for (const listener of listeners) listener(accessSnapshot()) }
  const login = options.login ?? vi.fn(async () => {
    if (!account || !accessToken) throw new Error('fake-account-login-missing')
    return accountAuthentication(account, accessToken)
  })
  const register = options.register ?? login
  return Object.freeze({
    configured: true,
    getAccount: () => account,
    getAccessSnapshot: accessSnapshot,
    subscribeAccess(listener) {
      listeners.add(listener)
      listener(accessSnapshot())
      return () => { listeners.delete(listener) }
    },
    hasPersistedSession: () => options.persisted === true && accessToken !== undefined,
    readAccessToken: () => accessToken,
    login: async (credentials) => {
      const result = await login(credentials)
      account = result.account
      accessToken = result.session.accessToken
      publish()
      return result
    },
    register: async (credentials) => {
      const result = await register(credentials)
      account = result.account
      accessToken = result.session.accessToken
      publish()
      return result
    },
    async restore() {
      const restored = options.restore ? await options.restore() : account
      account = restored
      publish()
      return restored
    },
    logout: vi.fn(async () => {
      account = undefined
      accessToken = undefined
      publish()
    }),
    clear() {
      account = undefined
      accessToken = undefined
      publish()
    },
  })
}

type DurableTradeStore = {
  current: FieldScriptState
  persisted: FieldScriptState
  persistCount: number
  functionalCommitCount: number
}

type DurablePeerHarness = Readonly<{
  runtime: BrowserMultiplayerRuntime
  controller: FakeOnlineController
  view: FakeView
  escrow: ReturnType<typeof createHgssP2pTradeRuntimeEscrow>
  selections: BrowserMultiplayerTradeSelection[]
  committed: ReturnType<typeof vi.fn<(result: HgssP2pTradeCommitResult) => void>>
  issueLink: (link: RtcPeerConnectionLink) => RtcPeerConnectionLink
}>

function canonicalTradePokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  trainer: PokemonTrainerIdentity,
  speciesId: number,
  byte: string,
): CanonicalPokemon {
  return createCanonicalPokemon(catalog, {
    instanceId: pokemonId(byte),
    speciesId,
    level: 25,
    rng: createHgssLcrng(Number.parseInt(byte, 16) || 1),
    personality: { kind: 'fixed', value: (Number.parseInt(byte, 16) * 0x11111111) >>> 0 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { ...trainer },
    origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 },
    ballId: 4,
  })
}

function durableTradeStore(state: FieldScriptState): DurableTradeStore {
  return {
    current: state,
    persisted: cloneFieldScriptState(state),
    persistCount: 0,
    functionalCommitCount: 0,
  }
}

function createDurablePeerHarness(
  identity: string,
  remote: string,
  transactionId: string | (() => string),
  store: DurableTradeStore,
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  onTradeRecoveryRequired?: BrowserMultiplayerGamePorts['onTradeRecoveryRequired'],
): DurablePeerHarness {
  const controller = new FakeOnlineController(identity, remote)
  const viewFactory = createViewFactory()
  const selections: BrowserMultiplayerTradeSelection[] = []
  const committed = vi.fn<(result: HgssP2pTradeCommitResult) => void>()
  const linkAuthority = new TestRtcLinkAuthority()
  const escrow = createHgssP2pTradeRuntimeEscrow({
    getState: () => store.current,
    persistState: (next) => {
      if (next.p2pTradeReceipts.length > store.persisted.p2pTradeReceipts.length) {
        store.functionalCommitCount += 1
      }
      store.persisted = cloneFieldScriptState(next)
      store.persistCount += 1
    },
    publishState: (next) => { store.current = next },
  })
  const runtime = createBrowserMultiplayerRuntime({
    root: {} as HTMLElement,
    onlineController: controller,
    uiFactory: viewFactory.factory,
    transactionIdFactory: typeof transactionId === 'function' ? transactionId : () => transactionId,
    rtcLinkConsumer: linkAuthority.consume,
    defaultSessionIntent: 'trade',
    tradeTimeoutMs: 10_000,
    scheduler,
    game: {
      escrow,
      presentationResources: { pokemonCatalog: catalog },
      chooseLocalTradeOffer: () => selections.shift() ?? { kind: 'cancel' },
      onTradeCommitted: committed,
      ...(onTradeRecoveryRequired ? { onTradeRecoveryRequired } : {}),
    },
  })
  return {
    runtime,
    controller,
    view: viewFactory.getView(),
    escrow,
    selections,
    committed,
    issueLink: (link) => linkAuthority.issue(link),
  }
}

function connectDurablePeers(
  alice: DurablePeerHarness,
  bob: DurablePeerHarness,
  channels: readonly [MemoryChannel, MemoryChannel],
  negotiationId: string,
): void {
  alice.controller.connectLink(alice.issueLink(Object.freeze({
    channel: channels[0],
    descriptor: Object.freeze({ peerId: 'bob', negotiationId }),
    role: 'offerer',
  })))
  bob.controller.connectLink(bob.issueLink(Object.freeze({
    channel: channels[1],
    descriptor: Object.freeze({ peerId: 'alice', negotiationId }),
    role: 'answerer',
  })))
}

describe('runtime navigateur multijoueur et échange', () => {
  it('désactive le rendez-vous P2P avec une raison présentable sans WebRTC', async () => {
    const reason = "Le pair-à-pair WebRTC n'est pas disponible sur cette console."
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      undefined,
      undefined,
      undefined,
      Object.freeze({ available: false, reason }),
    )

    expect(peer.runtime.getSnapshot().hub?.activities.trade).toEqual({
      random: false,
      friends: false,
      reason,
    })
    peer.view.ports.requestSession?.({ intent: 'trade', target: { kind: 'friend', userId: 'bob' } })
    await vi.waitFor(() => expect(peer.runtime.getSnapshot().session).toEqual({
      status: 'error',
      message: reason,
    }))
    expect(peer.controller.invitePeerSpy).not.toHaveBeenCalled()
    await peer.runtime.destroy()
  })

  it('restaure un compte persistant sans placer le secret de session dans le snapshot', async () => {
    const secret = 'persistent-account-access-token'
    const controller = new FakeOnlineController('alice', 'bob')
    controller.disconnect()
    const account = testAccount('alice')
    const restore = vi.fn(async () => account)
    const session = fakeAccountSession({
      accessToken: secret,
      persisted: true,
      restore,
    })
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      controller,
      session,
    )

    await vi.waitFor(() => expect(controller.connectSpy).toHaveBeenCalledWith(secret))
    expect(restore).toHaveBeenCalledOnce()
    expect(peer.runtime.getSnapshot().connection).toMatchObject({ account: { username: 'alice' } })
    expect(JSON.stringify(peer.runtime.getSnapshot())).not.toContain(secret)
    expect(peer.view.getSnapshot()).not.toBeUndefined()
    expect(JSON.stringify(peer.view.getSnapshot())).not.toContain(secret)

    peer.view.ports.logout()
    await vi.waitFor(() => expect(session.logout).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.getState().status).toBe('disconnected'))
    expect(peer.runtime.getSnapshot().connection.status).toBe('signed-out')
    await peer.runtime.destroy()
  })

  it('en partie connecte uniquement le compte et le jeton déjà établis au titre', async () => {
    const secret = 'title-established-access-token'
    const controller = new FakeOnlineController('alice', 'bob')
    controller.disconnect()
    const account = testAccount('alice')
    const restore = vi.fn(async () => account)
    const login = vi.fn(async () => accountAuthentication(account, secret))
    const register = vi.fn(async () => accountAuthentication(account, secret))
    const session = fakeAccountSession({
      account,
      accessToken: secret,
      persisted: true,
      restore,
      login,
      register,
    })
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      controller,
      session,
      false,
    )

    await vi.waitFor(() => expect(controller.connectSpy).toHaveBeenCalledWith(secret))
    expect(restore).not.toHaveBeenCalled()

    peer.view.ports.login({ username: 'other', password: 'long-password' })
    peer.view.ports.register({ username: 'other', password: 'long-password' })
    peer.view.ports.logout()
    await Promise.resolve()

    expect(login).not.toHaveBeenCalled()
    expect(register).not.toHaveBeenCalled()
    expect(session.logout).not.toHaveBeenCalled()
    expect(peer.runtime.getSnapshot().connection).toMatchObject({ account: { username: 'alice' } })
    await peer.runtime.destroy()
  })

  it('en partie ne restaure jamais une session persistée sans compte déjà chargé', async () => {
    const secret = 'persisted-but-not-restored-token'
    const controller = new FakeOnlineController('alice', 'bob')
    controller.disconnect()
    const restore = vi.fn(async () => testAccount('alice'))
    const session = fakeAccountSession({ accessToken: secret, persisted: true, restore })
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      controller,
      session,
      false,
    )

    await Promise.resolve()
    await Promise.resolve()

    expect(restore).not.toHaveBeenCalled()
    expect(controller.connectSpy).not.toHaveBeenCalled()
    expect(peer.runtime.getSnapshot().connection.status).toBe('signed-out')
    await peer.runtime.destroy()
  })

  it('connecte un compte créé avec droit online et laisse un administrateur contourner les droits', async () => {
    const secret = 'server-side-account-token'
    const controller = new FakeOnlineController('alice', 'bob')
    controller.disconnect()
    const account = testAccount('alice', 'admin', [])
    const register = vi.fn(async () => accountAuthentication(account, secret))
    const session = fakeAccountSession({ register })
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      controller,
      session,
    )

    expect(peer.runtime.getSnapshot().connection.status).toBe('signed-out')
    peer.view.ports.register({ username: 'alice', password: 'long-password' })

    await vi.waitFor(() => expect(controller.connectSpy).toHaveBeenCalledWith(secret))
    expect(register).toHaveBeenCalledWith({ username: 'alice', password: 'long-password' })
    expect(peer.runtime.getSnapshot().connection).toMatchObject({ account: { role: 'admin' } })
    expect(JSON.stringify(peer.runtime.getSnapshot())).not.toContain(secret)
    expect(JSON.stringify(peer.view.getSnapshot())).not.toContain(secret)
    await peer.runtime.destroy()
  })

  it('garde un compte ordinaire connecté mais bloque le multijoueur sans droit online', async () => {
    const secret = 'denied-account-token'
    const controller = new FakeOnlineController('alice', 'bob')
    controller.disconnect()
    const account = testAccount('alice', 'user', [])
    const login = vi.fn(async () => accountAuthentication(account, secret))
    const session = fakeAccountSession({ login })
    const peer = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      'trade',
      controller,
      session,
    )

    peer.view.ports.login({ username: 'alice', password: 'long-password' })
    await vi.waitFor(() => expect(login).toHaveBeenCalledOnce())
    expect(controller.connectSpy).not.toHaveBeenCalled()
    expect(peer.runtime.getSnapshot().connection).toMatchObject({
      status: 'access-denied',
      account: { username: 'alice' },
    })
    expect(JSON.stringify(peer.runtime.getSnapshot())).not.toContain(secret)
    await peer.runtime.destroy()
  })

  it('refuse un faux lien RTC et le rejeu d’un lien déjà consommé', async () => {
    const untrustedController = new FakeOnlineController('alice', 'bob')
    const untrustedViewFactory = createViewFactory()
    const untrustedRuntime = createBrowserMultiplayerRuntime({
      root: {} as HTMLElement,
      onlineController: untrustedController,
      uiFactory: untrustedViewFactory.factory,
      scheduler,
      game: {
        escrow: new MemoryEscrow('alice'),
        presentationResources: { pokemonCatalog: createPokemonTestCatalog() },
        chooseLocalTradeOffer: () => ({ kind: 'cancel' }),
      },
    })
    const [fakeChannel] = channelPair()
    untrustedController.connectLink(Object.freeze({
      channel: fakeChannel,
      descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
      role: 'offerer',
    }))
    await vi.waitFor(() => expect(untrustedRuntime.getSnapshot().session).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/émis|consommé/),
    }))
    expect(fakeChannel.sent).toEqual([])
    await untrustedRuntime.destroy()

    const trusted = createPeerHarness('alice', 'bob', aliceTransactionId)
    const [trustedChannel] = channelPair()
    const link = trusted.issueLink(Object.freeze({
      channel: trustedChannel,
      descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
      role: 'offerer',
    }))
    trusted.controller.connectLink(link)
    expect(trusted.runtime.getSnapshot().session.status).toBe('negotiating')
    trusted.controller.hangUp()
    await vi.waitFor(() => expect(trusted.runtime.getSnapshot().session.status).toBe('idle'))

    trusted.controller.connectLink(link)
    await vi.waitFor(() => expect(trusted.runtime.getSnapshot().session).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/déjà été consommé/),
    }))
    await trusted.runtime.destroy()
  })

  it("n'arme qu'une intention amie PvP confirmée et expose le gameplay non raccordé", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId, scheduler, null)
    const channels = channelPair()
    const states: ReturnType<BrowserMultiplayerRuntime['getIntentSessionState']>[] = []
    const detachState = alice.runtime.subscribeIntentSession((state) => { states.push(state) })
    alice.controller.invitePeerSpy.mockImplementationOnce(async () => {
      const aliceLink = alice.issueLink(Object.freeze({
        channel: channels[0],
        descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
        role: 'offerer',
      }))
      alice.controller.connectLink(aliceLink)
      bob.controller.connectLink(bob.issueLink(Object.freeze({
        channel: channels[1],
        descriptor: Object.freeze({ peerId: 'alice', negotiationId: sessionId }),
        role: 'answerer',
      })))
      return aliceLink
    })

    expect(alice.runtime.getSnapshot().hub?.activities.pvp).toMatchObject({
      friends: true,
      random: false,
      visible: false,
    })
    alice.view.ports.requestSession?.({
      intent: 'pvp',
      target: { kind: 'friend', userId: 'bob' },
    })
    await vi.waitFor(() => expect(bob.runtime.getIntentSessionState()).toEqual({
      status: 'consent',
      peerUserId: 'alice',
      role: 'guest',
      remoteIntent: 'pvp',
    }))
    expect(bob.runtime.getSnapshot().session).toEqual({
      status: 'consent',
      peerUserId: 'alice',
      intent: 'pvp',
    })
    bob.view.ports.acceptSessionIntent?.({ peerUserId: 'alice', intent: 'pvp' })
    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState()).toEqual({
        status: 'ready',
        peerUserId: 'bob',
        role: 'host',
        intent: 'pvp',
        gameplay: 'not-wired',
      })
      expect(bob.runtime.getIntentSessionState()).toEqual({
        status: 'ready',
        peerUserId: 'alice',
        role: 'guest',
        intent: 'pvp',
        gameplay: 'not-wired',
      })
    })
    expect(states.filter(({ status }) => status === 'ready')).toHaveLength(1)
    expect(alice.runtime.getSnapshot().session).toEqual({
      status: 'connected',
      peerUserId: 'bob',
      role: 'host',
      intent: 'pvp',
      gameplay: 'not-wired',
    })
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(bob.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(physicalPayloads(channels[0]).some((payload) => (
      (JSON.parse(payload) as { protocol?: unknown }).protocol === browserMultiplayerTradeSessionProtocol
    ))).toBe(false)

    detachState()
    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('arme une campagne concrète après consentement puis ferme les deux côtés sans fuite', async () => {
    const withoutCampaign = createPeerHarness('eve', 'mallory', aliceTransactionId)
    expect(withoutCampaign.runtime.getSnapshot().hub?.activities.coop.visible).toBe(false)
    await withoutCampaign.runtime.destroy()
    const aliceCampaign = deferredCampaignPort()
    const bobCampaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, 'coop', undefined,
      undefined, undefined, undefined, aliceCampaign.port,
    )
    const bob = createPeerHarness(
      'bob', 'alice', bobTransactionId, scheduler, null, undefined,
      undefined, undefined, undefined, bobCampaign.port,
    )
    const channels = channelPair()
    alice.controller.invitePeerSpy.mockImplementationOnce(async () => {
      const aliceLink = alice.issueLink(Object.freeze({
        channel: channels[0],
        descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
        role: 'offerer',
      }))
      alice.controller.connectLink(aliceLink)
      bob.controller.connectLink(bob.issueLink(Object.freeze({
        channel: channels[1],
        descriptor: Object.freeze({ peerId: 'alice', negotiationId: sessionId }),
        role: 'answerer',
      })))
      return aliceLink
    })

    expect(alice.runtime.getSnapshot().hub?.activities.coop.friends).toBe(true)
    expect(alice.runtime.getSnapshot().hub?.activities.coop.visible).toBeUndefined()
    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'friend', userId: 'bob' } })
    await vi.waitFor(() => expect(bob.runtime.getIntentSessionState()).toMatchObject({
      status: 'consent', remoteIntent: 'coop',
    }))
    expect(aliceCampaign.start).not.toHaveBeenCalled()
    expect(bobCampaign.start).not.toHaveBeenCalled()

    bob.view.ports.acceptSessionIntent?.({ peerUserId: 'alice', intent: 'coop' })
    await vi.waitFor(() => {
      expect(aliceCampaign.start).toHaveBeenCalledOnce()
      expect(bobCampaign.start).toHaveBeenCalledOnce()
      expect(alice.runtime.getIntentSessionState()).toMatchObject({
        status: 'ready', intent: 'coop', gameplay: 'campaign-starting',
      })
      expect(bob.runtime.getIntentSessionState()).toMatchObject({
        status: 'ready', intent: 'coop', gameplay: 'campaign-starting',
      })
    })
    expect(aliceCampaign.contexts[0]).toMatchObject({
      sessionId,
      localParticipantId: 'alice',
      remoteParticipantId: 'bob',
      role: 'host',
      channel: expect.objectContaining({ getState: expect.any(Function) }),
      hostBinding: expect.objectContaining({
        negotiationId: sessionId,
        sessionId,
        peerId: 'bob',
        playerId: 'bob',
      }),
    })
    expect(bobCampaign.contexts[0]).toMatchObject({
      sessionId,
      localParticipantId: 'bob',
      remoteParticipantId: 'alice',
      role: 'guest',
    })
    expect(aliceCampaign.contexts[0]?.channel).not.toBe(channels[0])
    expect(aliceCampaign.contexts[0]?.hostBinding?.channel).toBe(aliceCampaign.contexts[0]?.channel)
    expect(Object.isFrozen(aliceCampaign.contexts[0]?.hostBinding)).toBe(true)
    expect(bobCampaign.contexts[0]?.hostBinding).toBeUndefined()
    expect(channels[0].sent.some((message) => (
      (JSON.parse(message) as { channel?: unknown }).channel === browserMultiplayerCampaignChannelId
    ))).toBe(false)

    aliceCampaign.arm()
    bobCampaign.arm()
    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState()).toMatchObject({ gameplay: 'campaign-armed' })
      expect(bob.runtime.getIntentSessionState()).toMatchObject({ gameplay: 'campaign-armed' })
    })

    bob.view.ports.leaveSession()
    await vi.waitFor(() => {
      expect(bobCampaign.close).toHaveBeenCalledOnce()
      expect(bobCampaign.contexts[0]?.signal.aborted).toBe(true)
      expect(channels[0].getState()).toBe('closed')
    })
    aliceCampaign.contexts[0]?.onTerminated()
    await vi.waitFor(() => {
      expect(aliceCampaign.close).toHaveBeenCalledOnce()
      expect(aliceCampaign.contexts[0]?.signal.aborted).toBe(true)
    })
    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('démarre la Coop directement sur le serveur même lorsque WebRTC est absent', async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    const campaign = deferredCampaignPort()
    controller.searchRandomCoopSpy.mockResolvedValue(coopSnapshot({
      status: 'ready',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    const alice = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      scheduler,
      null,
      controller,
      undefined,
      undefined,
      { available: false, reason: 'RTCPeerConnection absent.' },
      campaign.port,
    )

    expect(alice.runtime.getSnapshot().hub?.activities.coop).toMatchObject({
      random: true,
      friends: true,
    })
    expect(alice.runtime.getSnapshot().hub?.activities.trade).toMatchObject({
      random: false,
      friends: false,
    })
    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })

    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    expect(controller.searchRandomCoopSpy).toHaveBeenCalledOnce()
    expect(controller.invitePeerSpy).not.toHaveBeenCalled()
    expect(campaign.contexts[0]).toMatchObject({
      transport: 'server',
      sessionId,
      localParticipantId: 'alice',
      remoteParticipantId: 'bob',
      role: 'host',
      rendezvousExpiresAt: directExpiry,
    })
    expect(campaign.contexts[0]).not.toHaveProperty('channel')
    expect(alice.runtime.getIntentSessionState()).toMatchObject({
      status: 'ready',
      intent: 'coop',
      gameplay: 'campaign-starting',
    })

    campaign.arm()
    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState()).toMatchObject({
      gameplay: 'campaign-armed',
    }))
    alice.view.ports.leaveSession()
    await vi.waitFor(() => {
      expect(campaign.close).toHaveBeenCalledOnce()
      expect(campaign.contexts[0]?.signal.aborted).toBe(true)
      expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce()
    })
    expect(controller.hangUpSpy).not.toHaveBeenCalled()
    await alice.runtime.destroy()
    expect(campaign.close).toHaveBeenCalledOnce()
  })

  it.each([
    ['en attente', coopSnapshot({
      status: 'queued' as const,
      mode: 'random' as const,
      joinedAt: 1_000,
      expiresAt: directExpiry,
    })],
    ['prêt', coopSnapshot({
      status: 'ready' as const,
      mode: 'random' as const,
      sessionId,
      peerUserId: 'bob',
      role: 'host' as const,
      expiresAt: directExpiry,
    })],
  ])('acquitte le rendez-vous Coop %s sans campagne directe avant disconnect', async (_label, current) => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.setCoop(current)
    const cancellation = deferred<OnlineCoopRendezvousSnapshot>()
    controller.cancelCoopRendezvousSpy.mockReturnValue(cancellation.promise)
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
    )

    const release = alice.runtime.prepareForPageRelease()
    await vi.waitFor(() => expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce())
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    cancellation.resolve(coopSnapshot({ status: 'idle' }))
    await release

    expect(controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.disconnectSpy.mock.invocationCallOrder[0]!,
    )
    await alice.runtime.destroy()
  })

  it('ferme puis annule une campagne Coop directe avant disconnect', async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.searchRandomCoopSpy.mockResolvedValue(coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    const cancellation = deferred<OnlineCoopRendezvousSnapshot>()
    controller.cancelCoopRendezvousSpy.mockReturnValue(cancellation.promise)
    const campaign = deferredCampaignPort()
    const close = deferred<undefined>()
    campaign.close.mockReturnValue(close.promise)
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      undefined, undefined, { available: false }, campaign.port,
    )

    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    campaign.arm()
    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState()).toMatchObject({
      gameplay: 'campaign-armed',
    }))

    const release = alice.runtime.prepareForPageRelease()
    await vi.waitFor(() => expect(campaign.close).toHaveBeenCalledOnce())
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    close.resolve(undefined)
    await vi.waitFor(() => expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce())
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    cancellation.resolve(coopSnapshot({ status: 'idle' }))
    await release

    expect(campaign.close.mock.invocationCallOrder[0]).toBeLessThan(
      controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]!,
    )
    expect(controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.disconnectSpy.mock.invocationCallOrder[0]!,
    )
    await alice.runtime.destroy()
  })

  it("n'annule jamais une campagne reprise après sa capture par la release", async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.searchRandomCoopSpy.mockResolvedValue(coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    const campaign = deferredCampaignPort()
    const close = deferred<undefined>()
    campaign.close.mockReturnValue(close.promise)
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      undefined, undefined, { available: false }, campaign.port,
    )
    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    campaign.arm()
    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState()).toMatchObject({
      gameplay: 'campaign-armed',
    }))

    const release = alice.runtime.prepareForPageRelease()
    const replaced = Object.assign(
      new Error('Cette campagne a été reprise sur un autre appareil.'),
      { code: browserMultiplayerCampaignConnectionReplacedErrorCode },
    )
    campaign.contexts[0]?.onTerminated(replaced)
    await vi.waitFor(() => expect(campaign.close).toHaveBeenCalledOnce())
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()

    close.resolve(undefined)
    await release

    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).toHaveBeenCalledOnce()
    await alice.runtime.destroy()
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
  })

  it('attend une recherche Coop commitée tardivement puis son cancel avant la release', async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    const search = deferred<OnlineCoopRendezvousSnapshot>()
    const cancellation = deferred<OnlineCoopRendezvousSnapshot>()
    controller.searchRandomCoopSpy.mockReturnValue(search.promise)
    controller.cancelCoopRendezvousSpy.mockReturnValue(cancellation.promise)
    const campaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      undefined, undefined, { available: false }, campaign.port,
    )
    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(controller.searchRandomCoopSpy).toHaveBeenCalledOnce())

    const release = alice.runtime.prepareForPageRelease()
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    search.resolve(coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    await vi.waitFor(() => expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce())
    expect(campaign.start).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    cancellation.resolve(coopSnapshot({ status: 'idle' }))
    await release

    expect(controller.searchRandomCoopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]!,
    )
    expect(controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.disconnectSpy.mock.invocationCallOrder[0]!,
    )
    await alice.runtime.destroy()
  })

  it('attend la mutation puis le cancel Coop avant logout et disconnect', async () => {
    const accountSession = fakeAccountSession({
      account: testAccount('alice'),
      accessToken: 'logout-after-coop-cancel',
    })
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    const search = deferred<OnlineCoopRendezvousSnapshot>()
    const cancellation = deferred<OnlineCoopRendezvousSnapshot>()
    controller.searchRandomCoopSpy.mockReturnValue(search.promise)
    controller.cancelCoopRendezvousSpy.mockReturnValue(cancellation.promise)
    const campaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      accountSession, undefined, { available: false }, campaign.port,
    )
    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(controller.searchRandomCoopSpy).toHaveBeenCalledOnce())

    alice.view.ports.logout()
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
    expect(accountSession.logout).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    search.resolve(coopSnapshot({
      status: 'ready',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    await vi.waitFor(() => expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce())
    expect(campaign.start).not.toHaveBeenCalled()
    expect(accountSession.logout).not.toHaveBeenCalled()
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    cancellation.resolve(coopSnapshot({ status: 'idle' }))
    await vi.waitFor(() => expect(accountSession.logout).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(controller.disconnectSpy).toHaveBeenCalledOnce())

    const logout = vi.mocked(accountSession.logout)
    expect(controller.searchRandomCoopSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]!,
    )
    expect(controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]).toBeLessThan(
      logout.mock.invocationCallOrder[0]!,
    )
    expect(logout.mock.invocationCallOrder[0]).toBeLessThan(
      controller.disconnectSpy.mock.invocationCallOrder[0]!,
    )
    await alice.runtime.destroy()
  })

  it('acquitte aussi le matchmaking classique avant disconnect', async () => {
    const controller = new FakeMatchmakingOnlineController('alice', 'bob')
    const cancellation = deferred<void>()
    controller.cancelMatchmakingSpy.mockReturnValue(cancellation.promise)
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
    )
    alice.view.ports.requestSession?.({ intent: 'pvp', target: { kind: 'random' } })
    await vi.waitFor(() => expect(controller.joinMatchmakingSpy).toHaveBeenCalledOnce())

    const release = alice.runtime.prepareForPageRelease()
    await vi.waitFor(() => expect(controller.cancelMatchmakingSpy).toHaveBeenCalledOnce())
    expect(controller.disconnectSpy).not.toHaveBeenCalled()

    cancellation.resolve(undefined)
    await release

    expect(controller.cancelMatchmakingSpy.mock.invocationCallOrder[0]).toBeLessThan(
      controller.disconnectSpy.mock.invocationCallOrder[0]!,
    )
    await alice.runtime.destroy()
  })

  it('libère la campagne Coop avec le jeton encore valide avant de déconnecter le compte', async () => {
    const accessToken = 'account-token-kept-until-coop-cleanup'
    const accountSession = fakeAccountSession({
      account: testAccount('alice'),
      accessToken,
    })
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.searchRandomCoopSpy.mockResolvedValue(coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    controller.cancelCoopRendezvousSpy.mockImplementation(async () => {
      expect(accountSession.readAccessToken()).toBe(accessToken)
      return coopSnapshot({ status: 'idle' })
    })
    const campaign = deferredCampaignPort()
    campaign.close.mockImplementation(async () => {
      expect(accountSession.readAccessToken()).toBe(accessToken)
    })
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      accountSession, undefined, { available: false }, campaign.port,
    )

    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    campaign.arm()
    await vi.waitFor(() => expect(alice.runtime.getSnapshot().session).toMatchObject({
      status: 'connected', gameplay: 'campaign-armed',
    }))

    alice.view.ports.logout()
    await vi.waitFor(() => expect(accountSession.logout).toHaveBeenCalledOnce())
    await vi.waitFor(() => expect(alice.runtime.getSnapshot().connection.status).toBe('signed-out'))

    const logoutSpy = vi.mocked(accountSession.logout)
    expect(campaign.close.mock.invocationCallOrder[0]).toBeLessThan(
      controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]!,
    )
    expect(controller.cancelCoopRendezvousSpy.mock.invocationCallOrder[0]).toBeLessThan(
      logoutSpy.mock.invocationCallOrder[0]!,
    )
    expect(accountSession.readAccessToken()).toBeUndefined()
    await alice.runtime.destroy()
  })

  it("n'arme jamais une Coop restaurée pendant une session RTC déjà engagée", async () => {
    const aliceController = new FakeDirectCoopOnlineController('alice', 'bob')
    const bobController = new FakeDirectCoopOnlineController('bob', 'alice')
    const campaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, 'trade', aliceController,
      undefined, undefined, { available: true }, campaign.port,
    )
    const bob = createPeerHarness(
      'bob', 'alice', bobTransactionId, scheduler, 'trade', bobController,
    )
    connectPeers(alice, bob, channelPair())
    await vi.waitFor(() => expect(alice.runtime.getSnapshot().connection.status).toBe('connected'))

    aliceController.setCoop(coopSnapshot({
      status: 'active',
      mode: 'friend',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    await new Promise<void>((resolve) => queueMicrotask(resolve))

    expect(campaign.start).not.toHaveBeenCalled()
    expect(alice.runtime.getSnapshot().connection.status).toBe('connected')
    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('conserve le rendez-vous durable et réessaie une ouverture Coop transitoirement échouée', async () => {
    let clock = 10_000
    const controlledScheduler = createControlledScheduler()
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.searchRandomCoopSpy.mockResolvedValue(coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    const close = vi.fn(async () => undefined)
    const contexts: BrowserMultiplayerCampaignStartContext[] = []
    const start = vi.fn(async (context: BrowserMultiplayerCampaignStartContext) => {
      contexts.push(context)
      if (contexts.length === 1) throw new Error('temporary-network-loss')
      return Object.freeze({ close })
    })
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, controlledScheduler, null, controller,
      undefined, undefined, { available: false }, Object.freeze({ start }), () => clock,
    )

    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(start).toHaveBeenCalledOnce())
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
    expect(alice.runtime.getSnapshot().session).toMatchObject({
      status: 'error',
      message: 'temporary-network-loss',
    })

    controlledScheduler.run()
    await vi.waitFor(() => expect(
      controller.refreshCoopRendezvousSpy.mock.calls.length,
    ).toBeGreaterThanOrEqual(2))
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(start).toHaveBeenCalledOnce()
    clock += 500
    controlledScheduler.run()
    await vi.waitFor(() => expect(start).toHaveBeenCalledTimes(2))
    expect(contexts[1]).toMatchObject({ transport: 'server', sessionId })
    expect(alice.runtime.getSnapshot().session).toMatchObject({
      status: 'connected',
      gameplay: 'campaign-armed',
    })
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()

    await alice.runtime.destroy()
    expect(close).toHaveBeenCalledOnce()
  })

  it("détache l'ancien appareil remplacé sans reprendre ni annuler sa campagne serveur", async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    const active = coopSnapshot({
      status: 'active',
      mode: 'random',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    })
    controller.searchRandomCoopSpy.mockResolvedValue(active)
    const campaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      undefined, undefined, { available: false }, campaign.port,
    )

    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    campaign.arm()
    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState()).toMatchObject({
      gameplay: 'campaign-armed',
    }))

    const replaced = Object.assign(
      new Error('Cette campagne a été reprise sur un autre appareil.'),
      { code: browserMultiplayerCampaignConnectionReplacedErrorCode },
    )
    campaign.contexts[0]?.onTerminated(replaced)
    await vi.waitFor(() => {
      expect(campaign.close).toHaveBeenCalledOnce()
      expect(alice.runtime.getIntentSessionState()).toMatchObject({
        status: 'error',
        message: replaced.message,
      })
    })
    expect(campaign.contexts[0]?.signal.aborted).toBe(true)
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()

    controller.setCoop(active)
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(campaign.start).toHaveBeenCalledOnce()

    await alice.runtime.destroy()
    expect(controller.cancelCoopRendezvousSpy).not.toHaveBeenCalled()
  })

  it('route une invitation Coop typée sans invitation SDP ni lien RTC', async () => {
    const controller = new FakeDirectCoopOnlineController('bob', 'alice')
    controller.setCoop(coopSnapshot({ status: 'idle' }, [{
      sessionId,
      fromUserId: 'alice',
      intent: 'coop',
      expiresAt: directExpiry,
    }]))
    controller.acceptCoopInvitationSpy.mockResolvedValue(coopSnapshot({
      status: 'ready',
      mode: 'friend',
      sessionId,
      peerUserId: 'alice',
      role: 'guest',
      expiresAt: directExpiry,
    }))
    const campaign = deferredCampaignPort()
    const bob = createPeerHarness(
      'bob',
      'alice',
      bobTransactionId,
      scheduler,
      null,
      controller,
      undefined,
      undefined,
      { available: false, reason: 'RTCPeerConnection absent.' },
      campaign.port,
    )
    const invitation = bob.runtime.getSnapshot().invitations[0]
    expect(invitation).toMatchObject({
      fromUserId: 'alice',
      transport: 'server',
      intent: 'coop',
    })
    if (!invitation) throw new Error("L'invitation Coop de test est absente.")

    bob.view.ports.joinInvitation(invitation.invitationId)
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())
    expect(controller.acceptCoopInvitationSpy).toHaveBeenCalledWith(sessionId)
    expect(controller.acceptPeerInvitation).toBeDefined()
    expect(controller.invitePeerSpy).not.toHaveBeenCalled()
    expect(campaign.contexts[0]).toMatchObject({
      transport: 'server',
      role: 'guest',
      sessionId,
    })
    campaign.arm()
    await vi.waitFor(() => expect(bob.runtime.getSnapshot().session).toMatchObject({
      status: 'connected',
      role: 'guest',
      intent: 'coop',
      gameplay: 'campaign-armed',
    }))
    await bob.runtime.destroy()
  })

  it('annule un démarrage Coop direct en vol et ferme exactement le handle tardif', async () => {
    const controller = new FakeDirectCoopOnlineController('alice', 'bob')
    controller.inviteCoopFriendSpy.mockResolvedValue(coopSnapshot({
      status: 'ready',
      mode: 'friend',
      sessionId,
      peerUserId: 'bob',
      role: 'host',
      expiresAt: directExpiry,
    }))
    const campaign = deferredCampaignPort()
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, scheduler, null, controller,
      undefined, undefined, { available: false }, campaign.port,
    )
    alice.view.ports.requestSession?.({
      intent: 'coop',
      target: { kind: 'friend', userId: 'bob' },
    })
    await vi.waitFor(() => expect(campaign.start).toHaveBeenCalledOnce())

    alice.view.ports.leaveSession()
    expect(campaign.contexts[0]?.signal.aborted).toBe(true)
    campaign.arm()
    await vi.waitFor(() => {
      expect(campaign.close).toHaveBeenCalledOnce()
      expect(controller.cancelCoopRendezvousSpy).toHaveBeenCalledOnce()
    })
    campaign.contexts[0]?.onTerminated(new Error('late-generation'))
    await new Promise<void>((resolve) => queueMicrotask(resolve))
    expect(campaign.close).toHaveBeenCalledOnce()
    expect(alice.runtime.getSnapshot().session).toEqual({ status: 'idle' })
    await alice.runtime.destroy()
  })

  it("attend le consentement d'une invitation amie puis propage un refus explicite", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId, scheduler, null)
    const channels = channelPair()
    connectPeers(alice, bob, channels)

    await vi.waitFor(() => expect(bob.runtime.getIntentSessionState()).toMatchObject({
      status: 'consent',
      peerUserId: 'alice',
      remoteIntent: 'trade',
    }))
    expect(alice.runtime.getIntentSessionState().status).toBe('handshaking')
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(bob.runtime.getSnapshot().trade).toEqual({ status: 'closed' })

    bob.view.ports.declineSessionIntent?.({ peerUserId: 'alice', intent: 'trade' })
    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState().status).toBe('rejected')
      expect(bob.runtime.getIntentSessionState().status).toBe('rejected')
      expect(channels[0].getState()).toBe('closed')
    })
    const rejection = physicalPayloads(channels[1]).find((payload) => {
      const frame = JSON.parse(payload) as { kind?: unknown, reason?: unknown }
      return frame.kind === 'reject' && frame.reason === 'user-declined'
    })
    expect(rejection).toBeDefined()
    expect(alice.controller.hangUpSpy).toHaveBeenCalled()
    expect(bob.controller.hangUpSpy).toHaveBeenCalled()

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it("expire un pair silencieux et raccroche le transport d'intention", async () => {
    const controlledScheduler = createControlledScheduler()
    const alice = createPeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      controlledScheduler,
      'trade',
    )
    const channels = channelPair()
    alice.controller.connectLink(alice.issueLink(Object.freeze({
      channel: channels[0],
      descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
      role: 'offerer',
    })))
    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState().status).toBe('handshaking'))

    controlledScheduler.run()

    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState()).toMatchObject({
        status: 'error',
        message: expect.stringMatching(/expiré/),
      })
      expect(alice.controller.hangUpSpy).toHaveBeenCalledOnce()
      expect(channels[0].getState()).toBe('closed')
    })
    await alice.runtime.destroy()
  })

  it('apparie deux recherches aléatoires avec le match exact puis négocie leur intention', async () => {
    const controlledScheduler = createControlledScheduler()
    const aliceController = new FakeMatchmakingOnlineController('alice', 'bob')
    const bobController = new FakeMatchmakingOnlineController('bob', 'alice')
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, controlledScheduler, null, aliceController,
    )
    const bob = createPeerHarness(
      'bob', 'alice', bobTransactionId, controlledScheduler, null, bobController,
    )
    const channels = channelPair()
    const aliceMatch = runtimeMatchedStatus('pvp', 'offerer', 'bob')
    const bobMatch = runtimeMatchedStatus('pvp', 'answerer', 'alice')
    aliceController.refreshMatchmakingSpy.mockResolvedValue(aliceMatch)
    bobController.refreshMatchmakingSpy.mockResolvedValue(bobMatch)
    const aliceLink = alice.issueLink(Object.freeze({
      channel: channels[0],
      descriptor: Object.freeze({ peerId: 'bob', negotiationId: matchmakingSessionId }),
      role: 'offerer',
    }))
    const bobLink = bob.issueLink(Object.freeze({
      channel: channels[1],
      descriptor: Object.freeze({ peerId: 'alice', negotiationId: matchmakingSessionId }),
      role: 'answerer',
    }))
    const aliceConsume = deferred<RtcPeerConnectionLink | undefined>()
    const bobConsume = deferred<RtcPeerConnectionLink | undefined>()
    let aliceWaiting = false
    let bobWaiting = false
    let connected = false
    const connectWhenBothAreAuthorized = (): void => {
      if (connected || !aliceWaiting || !bobWaiting) return
      connected = true
      aliceController.connectLink(aliceLink)
      bobController.connectLink(bobLink)
      aliceConsume.resolve(aliceLink)
      bobConsume.resolve(bobLink)
    }
    aliceController.consumeMatchmakingMatchSpy.mockImplementation(async () => {
      aliceWaiting = true
      connectWhenBothAreAuthorized()
      return aliceConsume.promise
    })
    bobController.consumeMatchmakingMatchSpy.mockImplementation(async () => {
      bobWaiting = true
      connectWhenBothAreAuthorized()
      return bobConsume.promise
    })

    expect(alice.runtime.getSnapshot().hub?.activities.pvp.random).toBe(true)
    alice.view.ports.requestSession?.({ intent: 'pvp', target: { kind: 'random' } })
    bob.view.ports.requestSession?.({ intent: 'pvp', target: { kind: 'random' } })
    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().session).toEqual({ status: 'searching', intent: 'pvp' })
      expect(bob.runtime.getSnapshot().session).toEqual({ status: 'searching', intent: 'pvp' })
      expect(aliceController.joinMatchmakingSpy).toHaveBeenCalledWith('pvp')
      expect(bobController.joinMatchmakingSpy).toHaveBeenCalledWith('pvp')
    })
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    controlledScheduler.run()

    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState()).toMatchObject({
        status: 'ready', intent: 'pvp', gameplay: 'not-wired',
      })
      expect(bob.runtime.getIntentSessionState()).toMatchObject({
        status: 'ready', intent: 'pvp', gameplay: 'not-wired',
      })
    })
    expect(aliceController.consumeMatchmakingMatchSpy).toHaveBeenCalledWith(aliceMatch)
    expect(bobController.consumeMatchmakingMatchSpy).toHaveBeenCalledWith(bobMatch)
    expect(bob.runtime.getIntentSessionState().status).not.toBe('consent')
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    const refreshCounts = [
      aliceController.refreshMatchmakingSpy.mock.calls.length,
      bobController.refreshMatchmakingSpy.mock.calls.length,
    ]
    controlledScheduler.run()
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(aliceController.refreshMatchmakingSpy).toHaveBeenCalledTimes(refreshCounts[0])
    expect(bobController.refreshMatchmakingSpy).toHaveBeenCalledTimes(refreshCounts[1])

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('coalesce le polling aléatoire puis annule proprement une requête encore en vol', async () => {
    const controlledScheduler = createControlledScheduler()
    const controller = new FakeMatchmakingOnlineController('alice', 'bob')
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, controlledScheduler, null, controller,
    )
    const pendingRefresh = deferred<OnlineMatchmakingStatus>()
    controller.refreshMatchmakingSpy.mockReturnValue(pendingRefresh.promise)

    alice.view.ports.requestSession?.({ intent: 'coop', target: { kind: 'random' } })
    await vi.waitFor(() => expect(controller.joinMatchmakingSpy).toHaveBeenCalledOnce())
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    controlledScheduler.run()
    controlledScheduler.run()
    await vi.waitFor(() => expect(controller.refreshMatchmakingSpy).toHaveBeenCalledOnce())

    alice.view.ports.leaveSession()
    await vi.waitFor(() => {
      expect(controller.cancelMatchmakingSpy).toHaveBeenCalledOnce()
      expect(alice.runtime.getIntentSessionState()).toEqual({ status: 'idle' })
      expect(alice.runtime.getSnapshot().session).toEqual({ status: 'idle' })
    })
    pendingRefresh.resolve(queuedMatchmakingStatus('coop'))
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    controlledScheduler.run()
    expect(controller.refreshMatchmakingSpy).toHaveBeenCalledOnce()
    await alice.runtime.destroy()
  })

  it("refuse un lien RTC dont le negotiationId diverge du match aléatoire", async () => {
    const controlledScheduler = createControlledScheduler()
    const controller = new FakeMatchmakingOnlineController('alice', 'bob')
    const alice = createPeerHarness(
      'alice', 'bob', aliceTransactionId, controlledScheduler, null, controller,
    )
    const matched = runtimeMatchedStatus('trade', 'offerer', 'bob')
    controller.refreshMatchmakingSpy.mockResolvedValue(matched)
    controller.consumeMatchmakingMatchSpy.mockImplementation(async () => {
      const wrongLink = alice.issueLink(Object.freeze({
        channel: channelPair()[0],
        descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
        role: 'offerer',
      }))
      controller.connectLink(wrongLink)
      return wrongLink
    })

    alice.view.ports.requestSession?.({ intent: 'trade', target: { kind: 'random' } })
    await vi.waitFor(() => expect(controller.joinMatchmakingSpy).toHaveBeenCalledOnce())
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    controlledScheduler.run()

    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().session).toMatchObject({
        status: 'error',
        message: expect.stringMatching(/lien RTC|activité P2P/),
      })
      expect(controller.hangUpSpy).toHaveBeenCalled()
      expect(controller.cancelMatchmakingSpy).toHaveBeenCalled()
    })
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    await alice.runtime.destroy()
  })

  it("refuse un désaccord d'intention sans lancer le protocole d'échange", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId, scheduler, 'pvp')
    const bob = createPeerHarness('bob', 'alice', bobTransactionId, scheduler, 'trade')
    const channels = channelPair()
    connectPeers(alice, bob, channels)

    await vi.waitFor(() => {
      expect(alice.runtime.getIntentSessionState()).toMatchObject({
        status: 'rejected',
        expectedIntent: 'pvp',
        remoteIntent: 'pvp',
      })
      expect(bob.runtime.getIntentSessionState()).toMatchObject({
        status: 'rejected',
        expectedIntent: 'trade',
        remoteIntent: 'pvp',
      })
    })
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(bob.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    const payloads = [...physicalPayloads(channels[0]), ...physicalPayloads(channels[1])]
      .filter((payload) => payload.length > 0)
      .map((payload) => JSON.parse(payload) as { protocol?: unknown, kind?: unknown })
    expect(payloads).toContainEqual(expect.objectContaining({
      protocol: 'pokemaster-p2p-session-intent',
      kind: 'reject',
    }))
    expect(payloads.some(({ protocol }) => protocol === browserMultiplayerTradeSessionProtocol)).toBe(false)

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it("ignore le replay exact de l'accord d'intention sans réémettre d'événement", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId)
    const channels = channelPair()
    const bobStates: ReturnType<BrowserMultiplayerRuntime['getIntentSessionState']>[] = []
    const detachState = bob.runtime.subscribeIntentSession((state) => { bobStates.push(state) })
    connectPeers(alice, bob, channels)
    await vi.waitFor(() => expect(bob.runtime.getIntentSessionState()).toMatchObject({
      status: 'ready',
      intent: 'trade',
    }))

    const replay = channels[0].sent.find((message) => {
      const outer = JSON.parse(message) as { channel?: unknown, payload?: unknown }
      if (outer.channel !== browserMultiplayerSessionChannelId || typeof outer.payload !== 'string') return false
      const inner = JSON.parse(outer.payload) as { kind?: unknown }
      return inner.kind === 'offer'
    })
    if (!replay) throw new Error("L'offre d'intention à rejouer est absente.")
    channels[0].send(replay)
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(bob.runtime.getIntentSessionState()).toMatchObject({ status: 'ready', intent: 'trade' })
    expect(bobStates.filter(({ status }) => status === 'ready')).toHaveLength(1)
    expect(channels[0].getState()).toBe('open')

    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(bob.runtime.getSnapshot().trade.status).toBe('negotiating'))
    detachState()
    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it("raccroche une session non verrouillée après un rejeu d'intention tardif altéré", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId)
    const channels = channelPair()
    connectPeers(alice, bob, channels)
    await vi.waitFor(() => expect(bob.runtime.getIntentSessionState()).toMatchObject({
      status: 'ready',
      intent: 'trade',
    }))

    const offerMessage = channels[0].sent.find((message) => {
      const outer = JSON.parse(message) as { channel?: unknown, payload?: unknown }
      if (outer.channel !== browserMultiplayerSessionChannelId || typeof outer.payload !== 'string') return false
      const inner = JSON.parse(outer.payload) as { kind?: unknown }
      return inner.kind === 'offer'
    })
    if (!offerMessage) throw new Error("L'offre d'intention initiale est absente.")
    const outer = JSON.parse(offerMessage) as Record<string, unknown> & { payload: string }
    const altered = JSON.stringify({
      ...outer,
      payload: JSON.stringify({
        ...(JSON.parse(outer.payload) as Record<string, unknown>),
        intent: 'pvp',
      }),
    })
    channels[0].send(altered)

    await vi.waitFor(() => {
      expect(bob.runtime.getIntentSessionState()).toMatchObject({
        status: 'error',
        message: expect.stringMatching(/rejouée/),
      })
      expect(bob.controller.hangUpSpy).toHaveBeenCalled()
      expect(channels[1].getState()).toBe('closed')
    })
    expect(bob.runtime.getSnapshot().trade).toEqual({ status: 'closed' })

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it("bloque un pair legacy qui ouvre directement l'ancien protocole trade", async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const channels = channelPair()
    alice.controller.connectLink(alice.issueLink(Object.freeze({
      channel: channels[0],
      descriptor: Object.freeze({ peerId: 'bob', negotiationId: sessionId }),
      role: 'offerer',
    })))
    channels[1].send(JSON.stringify({
      protocol: peerDataChannelMultiplexerProtocol,
      protocolVersion: peerDataChannelMultiplexerProtocolVersion,
      channel: browserMultiplayerTradeChannelId,
      kind: 'data',
      payload: JSON.stringify({
        protocol: browserMultiplayerTradeSessionProtocol,
        protocolVersion: browserMultiplayerTradeSessionProtocolVersion,
        kind: 'open',
        transactionId: bobTransactionId,
      }),
    }))

    await vi.waitFor(() => expect(alice.runtime.getIntentSessionState()).toMatchObject({
      status: 'error',
      message: expect.stringMatching(/ancien protocole/),
    }))
    expect(alice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(alice.escrow.preparations).toEqual([])
    expect(alice.escrow.commits).toEqual([])

    await alice.runtime.destroy()
  })

  it('partage le transactionId, prévisualise localement puis commit après deux acceptations', async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId)
    const channels = channelPair()
    connectPeers(alice, bob, channels)

    // Les deux clics simultanés produisent deux IDs; la règle d'autorité doit
    // converger vers celui d'alice avant la moindre offre fonctionnelle.
    alice.view.ports.openTrade()
    bob.view.ports.openTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade.status).toBe('negotiating'))

    const aliceHandshakes = physicalPayloads(channels[0])
      .map((payload) => JSON.parse(payload) as Record<string, unknown>)
      .filter(({ protocol }) => protocol === browserMultiplayerTradeSessionProtocol)
    const bobHandshakes = physicalPayloads(channels[1])
      .map((payload) => JSON.parse(payload) as Record<string, unknown>)
      .filter(({ protocol }) => protocol === browserMultiplayerTradeSessionProtocol)
    expect(aliceHandshakes).toContainEqual(expect.objectContaining({
      kind: 'open', transactionId: aliceTransactionId,
    }))
    expect(bobHandshakes).toContainEqual(expect.objectContaining({
      kind: 'open-ack', transactionId: aliceTransactionId,
    }))

    alice.selections.push({ kind: 'offer', pokemon: pokemon('1', 152) })
    bob.selections.push({ kind: 'offer', pokemon: pokemon('2', 155) })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toMatchObject({
        localOffer: { primaryLabel: 'GERMIGNON' },
        remoteOffer: { primaryLabel: 'HERICENDRE' },
      })
      expect(bob.view.getSnapshot()?.trade).toMatchObject({
        localOffer: { primaryLabel: 'HERICENDRE' },
        remoteOffer: { primaryLabel: 'GERMIGNON' },
      })
    })
    expect(alice.view.getSnapshot()?.trade.status).toBe('negotiating')
    expect(alice.view.getSnapshot()?.trade).toMatchObject({
      localAccepted: false,
      remoteAccepted: false,
      localOffer: {
        details: expect.arrayContaining([
          { label: 'Statistiques', value: 'Atk 41 · Déf 42 · Vit 43 · Atq.Spé 44 · Déf.Spé 45' },
        ]),
      },
    })

    alice.selections.push({ kind: 'withdraw' })
    alice.view.ports.changeTradeOffer()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).not.toHaveProperty('remoteOffer'))
    alice.selections.push({ kind: 'offer', pokemon: pokemon('1', 152) })
    alice.view.ports.chooseTradeOffer()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).toMatchObject({
      remoteOffer: { primaryLabel: 'GERMIGNON' },
    }))

    alice.view.ports.acceptTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).toMatchObject({
      localAccepted: false,
      remoteAccepted: true,
    }))
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade.status).toBe('committed')
      expect(bob.view.getSnapshot()?.trade.status).toBe('committed')
    })
    expect(alice.view.getSnapshot()?.trade).not.toHaveProperty('locked')
    expect(bob.view.getSnapshot()?.trade).not.toHaveProperty('locked')

    expect(alice.escrow.preparations).toHaveLength(1)
    expect(bob.escrow.preparations).toHaveLength(1)
    expect(alice.escrow.commits).toHaveLength(1)
    expect(bob.escrow.commits).toHaveLength(1)
    expect(alice.committed).toHaveBeenCalledWith(expect.objectContaining({
      receivedSpeciesId: 156,
      evolution: expect.objectContaining({ sourceSpeciesId: 155, targetSpeciesId: 156 }),
    }))
    expect(bob.committed).toHaveBeenCalledWith(expect.objectContaining({ receivedSpeciesId: 152 }))

    const wire = [...channels[0].sent, ...channels[1].sent].join('\n')
    expect(wire).not.toContain('GERMIGNON')
    expect(wire).not.toContain('HERICENDRE')
    expect(wire).not.toContain('CAPACITE')
    expect(wire).not.toContain('Statistiques')

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('enchaîne deux commits avec des transactionId distincts sur la même session P2P', async () => {
    const aliceTransactionIds = [aliceTransactionId, aliceSecondTransactionId]
    const alice = createPeerHarness('alice', 'bob', () => {
      const transactionId = aliceTransactionIds.shift()
      if (!transactionId) throw new Error("Aucun identifiant de transaction de test n'est disponible.")
      return transactionId
    })
    const bob = createPeerHarness('bob', 'alice', bobTransactionId)
    const channels = channelPair()
    connectPeers(alice, bob, channels)

    const waitForHandshake = async (
      channel: MemoryChannel,
      kind: 'open' | 'open-ack',
      transactionId: string,
    ): Promise<void> => {
      await vi.waitFor(() => {
        const handshakes = physicalPayloads(channel)
          .map((payload) => JSON.parse(payload) as Record<string, unknown>)
          .filter(({ protocol, kind: receivedKind }) => (
            protocol === browserMultiplayerTradeSessionProtocol && receivedKind === kind
          ))
        expect(handshakes).toContainEqual(expect.objectContaining({ transactionId }))
      })
    }

    alice.view.ports.openTrade()
    await waitForHandshake(channels[1], 'open-ack', aliceTransactionId)
    alice.selections.push({ kind: 'offer', pokemon: pokemon('1', 152) })
    bob.selections.push({ kind: 'offer', pokemon: pokemon('2', 155) })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
      expect(bob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
    })
    alice.view.ports.acceptTrade()
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade.status).toBe('committed')
      expect(bob.view.getSnapshot()?.trade.status).toBe('committed')
    })

    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(alice.view.getSnapshot()?.trade).toMatchObject({
      status: 'negotiating',
      localAccepted: false,
      remoteAccepted: false,
    }))
    await waitForHandshake(channels[0], 'open', aliceSecondTransactionId)
    await waitForHandshake(channels[1], 'open-ack', aliceSecondTransactionId)
    expect(alice.view.getSnapshot()?.trade).toMatchObject({
      status: 'negotiating',
      localAccepted: false,
      remoteAccepted: false,
    })
    expect(alice.view.getSnapshot()?.trade).not.toHaveProperty('localOffer')
    expect(alice.view.getSnapshot()?.trade).not.toHaveProperty('remoteOffer')

    alice.selections.push({ kind: 'offer', pokemon: pokemon('3', 158) })
    bob.selections.push({ kind: 'offer', pokemon: pokemon('4', 159) })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
      expect(bob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
    })
    alice.view.ports.acceptTrade()
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade.status).toBe('committed')
      expect(bob.view.getSnapshot()?.trade.status).toBe('committed')
    })

    expect(alice.escrow.commits.map(({ transactionId }) => transactionId)).toEqual([
      aliceTransactionId,
      aliceSecondTransactionId,
    ])
    expect(bob.escrow.commits.map(({ transactionId }) => transactionId)).toEqual([
      aliceTransactionId,
      aliceSecondTransactionId,
    ])
    expect(alice.committed).toHaveBeenCalledTimes(2)
    expect(bob.committed).toHaveBeenCalledTimes(2)
    expect(alice.runtime.getSnapshot().session.status).toBe('connected')
    expect(bob.runtime.getSnapshot().session.status).toBe('connected')

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('reprend automatiquement un commit après une erreur transitoire et quitte l état error', async () => {
    const controlledScheduler = createControlledScheduler()
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId, controlledScheduler)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId, controlledScheduler)
    const channels = channelPair()
    connectPeers(alice, bob, channels)
    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade.status).toBe('negotiating'))

    alice.selections.push({ kind: 'offer', pokemon: pokemon('1', 152) })
    bob.selections.push({ kind: 'offer', pokemon: pokemon('2', 155) })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toMatchObject({ remoteOffer: expect.any(Object) })
      expect(bob.view.getSnapshot()?.trade).toMatchObject({ remoteOffer: expect.any(Object) })
    })

    alice.escrow.failCommitCount = 1
    alice.view.ports.acceptTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).toMatchObject({ remoteAccepted: true }))
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => expect(alice.view.getSnapshot()?.trade).toMatchObject({
      status: 'error',
      errorMessage: 'transient-persistence-failure',
    }))
    expect(alice.escrow.commits).toHaveLength(1)
    expect(bob.escrow.commits).toHaveLength(0)

    controlledScheduler.run()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade.status).toBe('committed')
      expect(bob.view.getSnapshot()?.trade.status).toBe('committed')
    })
    expect(alice.escrow.commits).toHaveLength(2)
    expect(bob.escrow.commits).toHaveLength(1)
    expect(alice.committed).toHaveBeenCalledTimes(1)
    expect(bob.committed).toHaveBeenCalledTimes(1)

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('libère les deux journaux après un échange de rosters solo et autorise aussitôt le Pokémon reçu', async () => {
    const catalog = createPokemonTestCatalog()
    const aliceTrainer: PokemonTrainerIdentity = {
      id: 0x11112222,
      name: 'ALICE',
      gender: 'female',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const bobTrainer: PokemonTrainerIdentity = {
      id: 0x33334444,
      name: 'BOB',
      gender: 'male',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const alicePokemon = canonicalTradePokemon(catalog, aliceTrainer, 152, '5')
    const bobPokemon = canonicalTradePokemon(catalog, bobTrainer, 155, '6')
    const pokemonRuntime = (
      trainer: PokemonTrainerIdentity,
      seed: number,
    ): FieldPokemonRuntime => ({
      catalog,
      rng: createHgssLcrng(seed),
      trainer,
      language: 2,
      gameVersion: 7,
      now: () => new Date('2026-08-27T12:00:00.000Z'),
    })
    const aliceStore = durableTradeStore(createFieldScriptState('female', 'ALICE', {
      party: [alicePokemon],
      pokemonRuntime: pokemonRuntime(aliceTrainer, 111),
    }))
    const bobStore = durableTradeStore(createFieldScriptState('male', 'BOB', {
      party: [bobPokemon],
      pokemonRuntime: pokemonRuntime(bobTrainer, 222),
    }))
    const aliceTransactionIds = [aliceTransactionId, aliceSecondTransactionId]
    const alice = createDurablePeerHarness('alice', 'bob', () => {
      const transactionId = aliceTransactionIds.shift()
      if (!transactionId) throw new Error("Aucun identifiant durable n'est disponible.")
      return transactionId
    }, aliceStore, catalog)
    const bob = createDurablePeerHarness('bob', 'alice', bobTransactionId, bobStore, catalog)
    const channels = channelPair()
    connectDurablePeers(alice, bob, channels, sessionId)
    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().trade.status).toBe('closed')
      expect(bob.runtime.getSnapshot().trade.status).toBe('closed')
    })

    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade.status).toBe('negotiating'))
    alice.selections.push({
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(alicePokemon, { catalog, trainer: aliceTrainer }),
    })
    bob.selections.push({
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(bobPokemon, { catalog, trainer: bobTrainer }),
    })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
      expect(bob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
    })
    alice.view.ports.acceptTrade()
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().trade.status).toBe('committed')
      expect(bob.runtime.getSnapshot().trade.status).toBe('committed')
      expect(aliceStore.current.p2pTradeJournals).toEqual([])
      expect(bobStore.current.p2pTradeJournals).toEqual([])
    })

    expect(aliceStore.current.party.members).toHaveLength(1)
    expect(bobStore.current.party.members).toHaveLength(1)
    expect(aliceStore.current.party.members[0]?.instanceId).toBe(bobPokemon.instanceId)
    expect(bobStore.current.party.members[0]?.instanceId).toBe(alicePokemon.instanceId)
    expect(alice.escrow.isPokemonReserved(bobPokemon.instanceId)).toBe(false)
    expect(bob.escrow.isPokemonReserved(alicePokemon.instanceId)).toBe(false)

    alice.view.ports.openTrade()
    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().trade.status).toBe('negotiating')
      expect(bob.runtime.getSnapshot().trade.status).toBe('negotiating')
    })
    alice.selections.push({
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(aliceStore.current.party.members[0]!, {
        catalog,
        trainer: aliceTrainer,
      }),
    })
    alice.view.ports.chooseTradeOffer()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer'))

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('draine la reprise d’un Trade préparé avant de rendre le bail au bfcache', async () => {
    const catalog = createPokemonTestCatalog()
    const aliceTrainer: PokemonTrainerIdentity = {
      id: 0x11112222,
      name: 'ALICE',
      gender: 'female',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const bobTrainer: PokemonTrainerIdentity = {
      id: 0x33334444,
      name: 'BOB',
      gender: 'male',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const alicePokemon = canonicalTradePokemon(catalog, aliceTrainer, 152, '5')
    const bobPokemon = canonicalTradePokemon(catalog, bobTrainer, 155, '6')
    const aliceStore = durableTradeStore(createFieldScriptState('female', 'ALICE', {
      party: [alicePokemon],
      pokemonRuntime: {
        catalog,
        rng: createHgssLcrng(111),
        trainer: aliceTrainer,
        language: 2,
        gameVersion: 7,
        now: () => new Date('2026-08-26T12:00:00.000Z'),
      },
    }))
    const bobStore = durableTradeStore(createFieldScriptState('male', 'BOB', {
      party: [bobPokemon],
      pokemonRuntime: {
        catalog,
        rng: createHgssLcrng(222),
        trainer: bobTrainer,
        language: 2,
        gameVersion: 7,
        now: () => new Date('2026-08-26T12:00:00.000Z'),
      },
    }))
    const recoveryGate = deferred<void>()
    const recoveryStarted = deferred<void>()
    let authorizationReleased = false
    let recoveryCallbacksAfterRelease = 0
    const alice = createDurablePeerHarness(
      'alice',
      'bob',
      aliceTransactionId,
      aliceStore,
      catalog,
      async (snapshot) => {
        expect(snapshot.needsRecovery).toBe(true)
        recoveryStarted.resolve(undefined)
        await recoveryGate.promise
        if (authorizationReleased) recoveryCallbacksAfterRelease += 1
      },
    )
    const bob = createDurablePeerHarness(
      'bob', 'alice', bobTransactionId, bobStore, catalog,
    )
    const channels = channelPair()
    let commitCut = false
    channels[0].interceptSend = (message) => {
      const outer = JSON.parse(message) as { payload?: unknown }
      if (typeof outer.payload !== 'string') return false
      const inner = JSON.parse(outer.payload) as { protocol?: unknown, kind?: unknown }
      if (inner.protocol !== hgssP2pTradeProtocol || inner.kind !== 'commit') return false
      commitCut = true
      return true
    }
    connectDurablePeers(alice, bob, channels, sessionId)

    await vi.waitFor(() => {
      expect(alice.runtime.getSnapshot().trade.status).toBe('closed')
      expect(bob.runtime.getSnapshot().trade.status).toBe('closed')
    })
    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade.status).toBe('negotiating'))
    alice.selections.push({
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(alicePokemon, { catalog, trainer: aliceTrainer }),
    })
    bob.selections.push({
      kind: 'offer',
      pokemon: snapshotCanonicalPokemonForP2pTrade(bobPokemon, { catalog, trainer: bobTrainer }),
    })
    alice.view.ports.chooseTradeOffer()
    bob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(alice.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
      expect(bob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
    })
    alice.view.ports.acceptTrade()
    bob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(commitCut).toBe(true)
      expect(aliceStore.current.p2pTradeJournals).toMatchObject([{ phase: 'committed' }])
      expect(bobStore.current.p2pTradeJournals).toMatchObject([{ phase: 'prepared' }])
    })

    const window = new PageCacheWindow()
    const releaseAuthorization = vi.fn(() => { authorizationReleased = true })
    const lifecycle = installBrowserTitleSavePageLifecycle({
      window: window as unknown as Window,
      beforeRelease: alice.runtime.prepareForPageRelease,
      releaseAuthorization,
      restoreTitle: vi.fn(),
    })
    window.dispatchPageHide(true)
    await recoveryStarted.promise

    expect(releaseAuthorization).not.toHaveBeenCalled()
    expect(channels[0].getState()).toBe('open')

    recoveryGate.resolve(undefined)
    await vi.waitFor(() => expect(releaseAuthorization).toHaveBeenCalledOnce())

    expect(recoveryCallbacksAfterRelease).toBe(0)
    expect(channels[0].getState()).toBe('closed')
    expect(aliceStore.current.p2pTradeJournals).toMatchObject([{ phase: 'committed' }])
    expect(bobStore.current.p2pTradeJournals).toMatchObject([{ phase: 'prepared' }])
    expect(alice.runtime.getSnapshot().connection.status).toBe('error')

    lifecycle.destroy()
    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })

  it('réconcilie exactement une fois après coupure, recréation durable et nouvelle session RTC', async () => {
    const catalog = createPokemonTestCatalog()
    const aliceTrainer: PokemonTrainerIdentity = {
      id: 0x11112222,
      name: 'ALICE',
      gender: 'female',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const bobTrainer: PokemonTrainerIdentity = {
      id: 0x33334444,
      name: 'BOB',
      gender: 'male',
      nameSource: 'user-text',
      isPlayer: true,
    }
    const alicePokemon = canonicalTradePokemon(catalog, aliceTrainer, 152, '5')
    const bobPokemon = canonicalTradePokemon(catalog, bobTrainer, 155, '6')
    const alicePokemonRuntime: FieldPokemonRuntime = {
      catalog,
      rng: createHgssLcrng(111),
      trainer: aliceTrainer,
      language: 2,
      gameVersion: 7,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
    }
    const bobPokemonRuntime: FieldPokemonRuntime = {
      catalog,
      rng: createHgssLcrng(222),
      trainer: bobTrainer,
      language: 2,
      gameVersion: 7,
      now: () => new Date('2026-08-26T12:00:00.000Z'),
    }
    const aliceStore = durableTradeStore(createFieldScriptState('female', 'ALICE', {
      party: [alicePokemon],
      pokemonRuntime: alicePokemonRuntime,
    }))
    const bobStore = durableTradeStore(createFieldScriptState('male', 'BOB', {
      party: [bobPokemon],
      pokemonRuntime: bobPokemonRuntime,
    }))
    const bobStateWithoutPreparedJournal = cloneFieldScriptState(bobStore.current)
    const aliceSnapshot = snapshotCanonicalPokemonForP2pTrade(alicePokemon, {
      catalog,
      trainer: aliceTrainer,
    })
    const bobSnapshot = snapshotCanonicalPokemonForP2pTrade(bobPokemon, {
      catalog,
      trainer: bobTrainer,
    })

    const firstAlice = createDurablePeerHarness(
      'alice', 'bob', aliceTransactionId, aliceStore, catalog,
    )
    const firstBob = createDurablePeerHarness(
      'bob', 'alice', bobTransactionId, bobStore, catalog,
    )
    const firstChannels = channelPair()
    let commitCut = false
    firstChannels[0].interceptSend = (message) => {
      const outer = JSON.parse(message) as { payload?: unknown }
      if (typeof outer.payload !== 'string') return false
      const inner = JSON.parse(outer.payload) as { protocol?: unknown, kind?: unknown }
      if (inner.protocol !== hgssP2pTradeProtocol || inner.kind !== 'commit') return false
      commitCut = true
      return true
    }
    connectDurablePeers(firstAlice, firstBob, firstChannels, sessionId)
    await vi.waitFor(() => {
      expect(firstAlice.runtime.getSnapshot().trade.status).toBe('closed')
      expect(firstBob.runtime.getSnapshot().trade.status).toBe('closed')
    })

    firstAlice.view.ports.openTrade()
    await vi.waitFor(() => expect(firstBob.view.getSnapshot()?.trade.status).toBe('negotiating'))
    firstAlice.selections.push({ kind: 'offer', pokemon: aliceSnapshot })
    firstBob.selections.push({ kind: 'offer', pokemon: bobSnapshot })
    firstAlice.view.ports.chooseTradeOffer()
    firstBob.view.ports.chooseTradeOffer()
    await vi.waitFor(() => {
      expect(firstAlice.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
      expect(firstBob.view.getSnapshot()?.trade).toHaveProperty('remoteOffer')
    })
    firstAlice.view.ports.acceptTrade()
    firstBob.view.ports.acceptTrade()
    await vi.waitFor(() => {
      expect(commitCut).toBe(true)
      expect(firstChannels[0].getState()).toBe('open')
      expect(aliceStore.current.p2pTradeJournals).toMatchObject([{ phase: 'committed' }])
      expect(bobStore.current.p2pTradeJournals).toMatchObject([{ phase: 'prepared' }])
    })
    expect(firstAlice.runtime.getSnapshot().trade).toMatchObject({ locked: true })
    firstAlice.view.ports.cancelTrade()
    firstAlice.view.ports.logout()
    firstAlice.view.ports.leaveSession()
    firstAlice.view.ports.removeFriend('bob')
    await vi.waitFor(() => expect(firstAlice.runtime.getSnapshot().trade).toMatchObject({
      status: 'error',
      locked: true,
      errorMessage: expect.stringMatching(/irréversible|confirmation durable/),
    }))
    expect(firstChannels[0].getState()).toBe('open')
    expect(firstAlice.controller.getState().status).toBe('connected')
    expect(firstAlice.controller.removeFriendSpy).not.toHaveBeenCalled()

    const aliceRemoteCommittedState = cloneFieldScriptState(aliceStore.persisted)
    firstChannels[0].close()
    await vi.waitFor(() => expect(firstChannels[0].getState()).toBe('closed'))
    expect(aliceStore.current.p2pTradeReceipts).toHaveLength(1)
    expect(bobStore.current.p2pTradeReceipts).toHaveLength(0)
    expect(aliceStore.functionalCommitCount).toBe(1)
    expect(bobStore.functionalCommitCount).toBe(0)

    await firstAlice.runtime.destroy()
    await firstBob.runtime.destroy()
    aliceStore.current = cloneFieldScriptState(aliceStore.persisted)
    bobStore.current = cloneFieldScriptState(bobStore.persisted)

    const recoveredAlice = createDurablePeerHarness(
      'alice', 'bob', aliceSecondTransactionId, aliceStore, catalog,
    )
    const recoveredBob = createDurablePeerHarness(
      'bob', 'alice', bobTransactionId, bobStore, catalog,
    )
    const recoveryChannels = channelPair()
    connectDurablePeers(recoveredAlice, recoveredBob, recoveryChannels, recoverySessionId)
    await vi.waitFor(() => {
      expect(aliceStore.current.p2pTradeJournals).toEqual([])
      expect(bobStore.current.p2pTradeJournals).toEqual([])
      expect(recoveredAlice.runtime.getSnapshot().trade.status).toBe('closed')
      expect(recoveredBob.runtime.getSnapshot().trade.status).toBe('closed')
    }, { timeout: 3_000 })
    expect(recoveredAlice.runtime.getSnapshot().trade).toEqual({ status: 'closed' })
    expect(recoveredBob.runtime.getSnapshot().trade).toEqual({ status: 'closed' })

    expect(aliceStore.current.p2pTradeReceipts).toHaveLength(1)
    expect(bobStore.current.p2pTradeReceipts).toHaveLength(1)
    expect(aliceStore.current.party.members[0]?.instanceId).toBe(bobPokemon.instanceId)
    expect(bobStore.current.party.members[0]?.instanceId).toBe(alicePokemon.instanceId)
    expect(aliceStore.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(bobStore.current.gameStats.get(hgssInternetTradesGameStatId)).toBe(1)
    expect(aliceStore.functionalCommitCount).toBe(1)
    expect(bobStore.functionalCommitCount).toBe(1)
    expect(firstAlice.committed).toHaveBeenCalledTimes(1)
    expect(firstBob.committed).not.toHaveBeenCalled()
    expect(recoveredAlice.committed).not.toHaveBeenCalled()
    expect(recoveredBob.committed).toHaveBeenCalledTimes(1)

    const recoveryPayloads = [...physicalPayloads(recoveryChannels[0]), ...physicalPayloads(recoveryChannels[1])]
      .map((payload) => JSON.parse(payload) as { kind?: unknown, disposition?: unknown })
    expect(recoveryPayloads.filter(({ kind, disposition }) => (
      kind === 'confirm' && disposition === 'confirmed-committed'
    ))).toHaveLength(2)

    const replay = recoveryChannels[0].sent.find((message) => {
      const outer = JSON.parse(message) as { payload?: unknown }
      if (typeof outer.payload !== 'string') return false
      const inner = JSON.parse(outer.payload) as { protocol?: unknown, kind?: unknown }
      return inner.protocol === 'pokemaster-hgss-p2p-trade-recovery' && inner.kind === 'journal'
    })
    if (!replay) throw new Error('Frame de journal de reprise attendue.')
    recoveryChannels[0].send(replay)
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(aliceStore.functionalCommitCount).toBe(1)
    expect(bobStore.functionalCommitCount).toBe(1)
    expect(aliceStore.current.p2pTradeJournals).toEqual([])
    expect(bobStore.current.p2pTradeJournals).toEqual([])

    await recoveredAlice.runtime.destroy()
    await recoveredBob.runtime.destroy()

    const remoteCommittedAliceStore = durableTradeStore(aliceRemoteCommittedState)
    const unpreparedBobStore = durableTradeStore(bobStateWithoutPreparedJournal)
    const remoteCommittedAlice = createDurablePeerHarness(
      'alice', 'bob', aliceSecondTransactionId, remoteCommittedAliceStore, catalog,
    )
    const unpreparedBob = createDurablePeerHarness(
      'bob', 'alice', bobTransactionId, unpreparedBobStore, catalog,
    )
    const failSafeChannels = channelPair()
    connectDurablePeers(
      remoteCommittedAlice,
      unpreparedBob,
      failSafeChannels,
      remoteOnlyRecoverySessionId,
    )
    await vi.waitFor(() => expect(unpreparedBob.runtime.getSnapshot().trade).toMatchObject({
      status: 'error',
      locked: true,
      errorMessage: expect.stringMatching(/aucun journal préparé ni reçu local/),
    }))
    expect(remoteCommittedAlice.runtime.getSnapshot().trade).toMatchObject({ locked: true })
    expect(unpreparedBobStore.current.p2pTradeReceipts).toEqual([])
    expect(unpreparedBobStore.current.p2pTradeJournals).toEqual([])
    expect(unpreparedBobStore.current.party.members[0]?.instanceId).toBe(bobPokemon.instanceId)
    expect(unpreparedBobStore.functionalCommitCount).toBe(0)
    expect(unpreparedBob.committed).not.toHaveBeenCalled()
    const failSafePayloads = [...physicalPayloads(failSafeChannels[0]), ...physicalPayloads(failSafeChannels[1])]
      .map((payload) => JSON.parse(payload) as { kind?: unknown, disposition?: unknown })
    expect(failSafePayloads.some(({ kind, disposition }) => (
      kind === 'confirm' && disposition === 'confirmed-committed'
    ))).toBe(false)

    await remoteCommittedAlice.runtime.destroy()
    await unpreparedBob.runtime.destroy()
    await remoteCommittedAlice.escrow.finalizeRecovery(
      aliceTransactionId,
      'bob',
      'confirmed-committed',
    )
  })

  it('nettoie le mux, la transaction et la vue lors de la déconnexion', async () => {
    const alice = createPeerHarness('alice', 'bob', aliceTransactionId)
    const bob = createPeerHarness('bob', 'alice', bobTransactionId)
    const channels = channelPair()
    connectPeers(alice, bob, channels)
    alice.view.ports.openTrade()
    await vi.waitFor(() => expect(alice.view.getSnapshot()?.trade.status).toBe('negotiating'))

    alice.selections.push({ kind: 'offer', pokemon: pokemon('1', 152) })
    alice.view.ports.chooseTradeOffer()
    await vi.waitFor(() => expect(bob.view.getSnapshot()?.trade).toMatchObject({
      remoteOffer: { primaryLabel: 'GERMIGNON' },
    }))

    let resolveLateSelection: ((selection: BrowserMultiplayerTradeSelection) => void) | undefined
    alice.selections.push(new Promise((resolve) => { resolveLateSelection = resolve }))
    alice.view.ports.changeTradeOffer()
    await vi.waitFor(() => expect(alice.selections).toHaveLength(0))
    alice.view.ports.logout()
    await vi.waitFor(() => {
      expect(channels[0].getState()).toBe('closed')
      expect(alice.runtime.getSnapshot().connection.status).toBe('signed-out')
      expect(alice.runtime.getSnapshot().trade.status).toBe('closed')
    })
    const messagesAfterDisconnect = channels[0].sent.length
    resolveLateSelection?.({ kind: 'offer', pokemon: pokemon('3', 158) })
    await new Promise<void>((resolve) => queueMicrotask(() => queueMicrotask(resolve)))
    expect(channels[0].sent).toHaveLength(messagesAfterDisconnect)
    expect(alice.escrow.commits).toEqual([])
    expect(bob.escrow.commits).toEqual([])
    expect(alice.cancelSelection).toHaveBeenCalledTimes(1)

    await alice.runtime.destroy()
    await bob.runtime.destroy()
  })
})
