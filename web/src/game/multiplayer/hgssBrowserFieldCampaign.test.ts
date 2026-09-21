import { describe, expect, it, vi } from 'vitest'
import type {
  PeerDataChannel,
  PeerDataChannelHandlers,
  PeerDataChannelState,
} from '../../online/peerDataChannel'
import { createPeerDataChannelMultiplexer } from '../../online/peerDataChannelMultiplexer'
import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssSharedCampaignSaveExtensionV1 } from '../save/hgssSharedCampaignSaveExtension'
import type {
  AuthoritativePlayerMoveResult,
  AuthoritativePlayerStep,
  AuthoritativePlayerTransition,
  AuthoritativePlayerTransitionResult,
  FollowerWorldState,
  PlayerTileInspection,
  WorldMoveResult,
  WorldSession,
  WorldState,
} from '../world/worldSession'
import type {
  BrowserMultiplayerCampaignStartContext,
  BrowserMultiplayerDirectCampaignStartContext,
} from './browserMultiplayerCampaignPort'
import {
  createHgssBrowserFieldCampaign,
  type HgssBrowserFieldCampaign,
  type HgssBrowserFieldCampaignOptions,
} from './hgssBrowserFieldCampaign'
import type { HgssCampaignAuthoritativeService } from './hgssCampaignAuthoritativeService'
import type {
  HgssCampaignClientTransport,
  HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import { createHgssCampaignPeerLogicalHostBinding } from './hgssCampaignPeerBridge'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignClientCommand,
  type HgssCampaignFieldPosition,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import { createHgssSharedCampaignProgressionSeed } from './hgssSharedCampaignProgression'
import type { HgssCampaignWorldMovementProbeFactory } from './hgssCampaignWorldMovementPort'

type HeldMessage = Readonly<{ peer: MemoryPeerDataChannel, message: string }>

class MemoryPeerDataChannel implements PeerDataChannel {
  private state: PeerDataChannelState = 'open'
  private handlers?: PeerDataChannelHandlers
  private held: HeldMessage[] = []
  peer?: MemoryPeerDataChannel
  holdOutgoing: (message: string) => boolean = () => false
  readonly sent: string[] = []

  getState = (): PeerDataChannelState => this.state

  attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (this.handlers) throw new Error('memory-channel-already-attached')
    this.handlers = handlers
    if (this.state === 'open') queueMicrotask(() => { if (this.handlers === handlers) handlers.onOpen() })
    else queueMicrotask(() => { if (this.handlers === handlers) handlers.onClose() })
    return () => { if (this.handlers === handlers) this.handlers = undefined }
  }

  private deliver({ peer, message }: HeldMessage): void {
    if (this.state !== 'open' || peer.state !== 'open') return
    queueMicrotask(() => {
      if (this.state === 'open' && peer.state === 'open') peer.handlers?.onMessage(message)
    })
  }

  send = (message: string): void => {
    const peer = this.peer
    if (this.state !== 'open' || !peer || peer.state !== 'open') throw new Error('memory-channel-not-open')
    this.sent.push(message)
    const outbound = Object.freeze({ peer, message })
    if (this.holdOutgoing(message)) this.held.push(outbound)
    else this.deliver(outbound)
  }

  heldCount(): number { return this.held.length }

  flushHeld(): void {
    const held = this.held
    this.held = []
    for (const message of held) this.deliver(message)
  }

  flushHeldSynchronously(): void {
    const held = this.held
    this.held = []
    for (const { peer, message } of held) {
      if (this.state === 'open' && peer.state === 'open') peer.handlers?.onMessage(message)
    }
  }

  transformHeld(transform: (message: string) => string): void {
    this.held = this.held.map(({ peer, message }) => Object.freeze({
      peer,
      message: transform(message),
    }))
  }

  close = (): void => {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.held = []
    const localHandlers = this.handlers
    queueMicrotask(() => localHandlers?.onClose())
    const peer = this.peer
    if (peer && peer.state !== 'closed') {
      peer.state = 'closed'
      peer.held = []
      const peerHandlers = peer.handlers
      queueMicrotask(() => peerHandlers?.onClose())
    }
  }
}

function memoryPair() {
  const host = new MemoryPeerDataChannel()
  const guest = new MemoryPeerDataChannel()
  host.peer = guest
  guest.peer = host
  return { host, guest }
}

function innerCampaignFrame(message: string): Record<string, unknown> | undefined {
  try {
    const outer = JSON.parse(message) as Record<string, unknown>
    if (outer.kind !== 'data' || outer.channel !== 'campaign' || typeof outer.payload !== 'string') return undefined
    const inner = JSON.parse(outer.payload) as Record<string, unknown>
    return inner.protocol === 'pokemaster-hgss-campaign-peer' ? inner : undefined
  } catch {
    return undefined
  }
}

function isCommandRequest(message: string): boolean {
  const frame = innerCampaignFrame(message)
  return frame?.kind === 'request' && frame.operation === 'command'
}

function isCommandResponse(message: string): boolean {
  const frame = innerCampaignFrame(message)
  return frame?.kind === 'response' && frame.operation === 'command'
}

function replaceCommandResponseWithRevisionConflict(message: string): string {
  const outer = JSON.parse(message) as Record<string, unknown>
  if (typeof outer.payload !== 'string') throw new Error('Trame multiplexée sans payload.')
  const inner = JSON.parse(outer.payload) as Record<string, unknown>
  if (inner.kind !== 'response' || inner.operation !== 'command') {
    throw new Error('La trame retenue n’est pas un ACK de commande.')
  }
  const replacement = { ...inner }
  delete replacement.appliedRevision
  delete replacement.replayed
  delete replacement.snapshot
  replacement.ok = false
  replacement.error = { code: 'revision-conflict', message: 'Acquittement perdu après commit.' }
  return JSON.stringify({ ...outer, payload: JSON.stringify(replacement) })
}

function routeContexts(pair: ReturnType<typeof memoryPair>, sessionId: string) {
  const hostMux = createPeerDataChannelMultiplexer(pair.host, { channelIds: ['campaign'] })
  const guestMux = createPeerDataChannelMultiplexer(pair.guest, { channelIds: ['campaign'] })
  const hostChannel = hostMux.getChannel('campaign')
  const guestChannel = guestMux.getChannel('campaign')
  const hostAbort = new AbortController()
  const guestAbort = new AbortController()
  const hostTerminated = vi.fn()
  const guestTerminated = vi.fn()
  const host: BrowserMultiplayerCampaignStartContext = {
    channel: hostChannel,
    sessionId,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    role: 'host',
    signal: hostAbort.signal,
    onTerminated: hostTerminated,
    hostBinding: createHgssCampaignPeerLogicalHostBinding({
      route: hostMux.issueChannelBinding('campaign'),
      peerId: 'bob',
      negotiationId: sessionId,
      sessionId,
      playerId: 'bob',
    }),
  }
  const guest: BrowserMultiplayerCampaignStartContext = {
    channel: guestChannel,
    sessionId,
    localParticipantId: 'bob',
    remoteParticipantId: 'alice',
    role: 'guest',
    signal: guestAbort.signal,
    onTerminated: guestTerminated,
  }
  return { host, guest, hostAbort, guestAbort, hostTerminated, guestTerminated }
}

function testMap(id = 61): OpeningMapPreview {
  return { id } as OpeningMapPreview
}

type WorldHarness = Readonly<{
  world: WorldSession
  applyAuthoritativePlayerStep: ReturnType<typeof vi.fn<(step: AuthoritativePlayerStep) => AuthoritativePlayerMoveResult | undefined>>
  applyAuthoritativePlayerTransition: ReturnType<typeof vi.fn<(transition: AuthoritativePlayerTransition) => AuthoritativePlayerTransitionResult | undefined>>
  inspectPlayerTile: ReturnType<typeof vi.fn<(mapId: number, tileX: number, tileZ: number) => PlayerTileInspection | undefined>>
  setFollowerEnabled: ReturnType<typeof vi.fn<(enabled: boolean) => void>>
  restoreFollowerState: ReturnType<typeof vi.fn>
  setDirection: ReturnType<typeof vi.fn<(direction: PlayerDirection) => void>>
  getState: () => WorldState
  setAdmissionBlocked: (blocked: boolean) => void
}>

function createWorldHarness(
  tileX: number,
  tileZ: number,
  direction: PlayerDirection,
  onApply?: () => void,
): WorldHarness {
  const map = testMap()
  let state: WorldState = { map, tileX, tileZ, direction, locomotion: 'walking' }
  let admissionBlocked = false
  let follower: FollowerWorldState | undefined = {
    map,
    tileX: tileX - 1,
    tileZ,
    direction: 'east',
    movement: 7,
  }
  const applyAuthoritativePlayerStep = vi.fn((step: AuthoritativePlayerStep): AuthoritativePlayerMoveResult | undefined => {
    onApply?.()
    state = {
      ...state,
      tileX: step.to.x,
      tileZ: step.to.z,
      direction: step.to.direction,
    }
    return { kind: 'moved', state, movement: step.movement }
  })
  const applyAuthoritativePlayerTransition = vi.fn((transition: AuthoritativePlayerTransition): AuthoritativePlayerTransitionResult | undefined => {
    onApply?.()
    state = {
      ...state,
      map: testMap(transition.to.mapId),
      tileX: transition.to.x,
      tileZ: transition.to.z,
      direction: transition.to.direction,
    }
    return { kind: 'transitioned', state, movement: transition.movement }
  })
  const inspectPlayerTile = vi.fn((mapId: number, inspectedX: number, inspectedZ: number): PlayerTileInspection | undefined => ({
    mapId,
    tileX: inspectedX,
    tileZ: inspectedZ,
    insideBounds: true,
    terrainBlocked: admissionBlocked,
    npcOccupied: false,
    dynamicActorOccupied: false,
    blocked: admissionBlocked,
    ...(admissionBlocked ? { blockedReason: 'terrain' as const } : {}),
  }))
  const setFollowerEnabled = vi.fn((enabled: boolean): void => {
    if (!enabled) {
      follower = undefined
      return
    }
    const behind = ({
      north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0],
    } satisfies Record<PlayerDirection, readonly [number, number]>)[state.direction]
    follower = {
      map: state.map,
      tileX: state.tileX + behind[0],
      tileZ: state.tileZ + behind[1],
      direction: state.direction,
    }
  })
  const restoreFollowerState = vi.fn((saved) => {
    follower = { map: state.map, ...saved }
    return follower
  })
  const setDirection = vi.fn((next: PlayerDirection) => { state = { ...state, direction: next } })
  const loadMap = vi.fn((
    mapId: number,
    tileX: number,
    tileZ: number,
    direction: PlayerDirection = 'south',
    locomotion: WorldState['locomotion'] = 'walking',
  ) => {
    state = { ...state, map: testMap(mapId), tileX, tileZ, direction, locomotion }
    return state
  })
  const world = {
    loadMap,
    getState: () => state,
    applyAuthoritativePlayerStep,
    applyAuthoritativePlayerTransition,
    inspectPlayerTile,
    setFollowerEnabled,
    getFollowerState: () => follower,
    restoreFollowerState,
    setDirection,
  } as unknown as WorldSession
  return Object.freeze({
    world,
    applyAuthoritativePlayerStep,
    applyAuthoritativePlayerTransition,
    inspectPlayerTile,
    setFollowerEnabled,
    restoreFollowerState,
    setDirection,
    loadMap,
    getState: () => state,
    setAdmissionBlocked: (blocked) => { admissionBlocked = blocked },
  })
}

type ProbeHarness = Readonly<{
  createProbe: HgssCampaignWorldMovementProbeFactory
  rejectNext: () => void
  setTransitionArrival: (arrival: HgssCampaignFieldPosition | undefined) => void
  calls: ReturnType<typeof vi.fn>
}>

function createProbeHarness(): ProbeHarness {
  let shouldRejectNext = false
  let transitionArrival: HgssCampaignFieldPosition | undefined
  const calls = vi.fn()
  const createProbe: HgssCampaignWorldMovementProbeFactory = ({ command }) => {
    calls(command)
    const initial: WorldState = {
      map: testMap(command.from.mapId),
      tileX: command.from.x,
      tileZ: command.from.z,
      direction: command.from.direction,
      locomotion: 'walking',
    }
    return Object.freeze({
      getState: () => initial,
      isModeAllowed: () => true,
      transitionTo: (): ReturnType<WorldSession['transitionTo']> => transitionArrival
        ? {
            kind: 'transitioned',
            state: {
              ...initial,
              map: testMap(transitionArrival.mapId),
              tileX: transitionArrival.x,
              tileZ: transitionArrival.z,
              direction: transitionArrival.direction,
            },
          }
        : { kind: 'missing-map', mapId: 0xffff },
      tryMove: (deltaX, deltaZ, direction, context): WorldMoveResult => {
        if (shouldRejectNext) {
          shouldRejectNext = false
          return {
            kind: 'blocked',
            reason: 'terrain',
            tileX: initial.tileX + deltaX,
            tileZ: initial.tileZ + deltaZ,
          }
        }
        const moved = {
          kind: 'moved',
          state: {
            ...initial,
            tileX: initial.tileX + deltaX,
            tileZ: initial.tileZ + deltaZ,
            direction,
          },
          movement: context?.running ? 'run' : 'walk',
        } as const
        return transitionArrival ? {
          ...moved,
          warp: { kind: 'warp', header: transitionArrival.mapId, anchor: 0 },
          warpActivation: {
            trigger: 'completed-step', behavior: 103, transition: 'panel', direction: transitionArrival.direction,
          },
        } : moved
      },
    })
  }
  return Object.freeze({
    createProbe,
    rejectNext: () => { shouldRejectNext = true },
    setTransitionArrival: (arrival) => { transitionArrival = arrival },
    calls,
  })
}

type CampaignSide = Readonly<{
  campaign: HgssBrowserFieldCampaign
  world: WorldHarness
  probe: ProbeHarness
  publishedActors: Array<readonly unknown[]>
  onLocalTurn: ReturnType<typeof vi.fn>
  onLocalStep: ReturnType<typeof vi.fn>
  onLocalTransition: ReturnType<typeof vi.fn>
  onMovementRejected: ReturnType<typeof vi.fn>
  onError: ReturnType<typeof vi.fn>
  onFieldLockChanged: ReturnType<typeof vi.fn>
}>

type HarnessOptions = Readonly<{
  guestOnLocalStep?: HgssBrowserFieldCampaignOptions['onLocalStep']
  guestOnApply?: () => void
  guestOnPublish?: () => void
  guestSpriteId?: number
}>

let sessionSerial = 0

function createSide(
  identity: Readonly<{
    displayName: string
    gender: 'male' | 'female'
    spriteId: number
    tileX: number
    tileZ: number
    direction: PlayerDirection
  }>,
  options: Readonly<{
    onLocalStep?: HgssBrowserFieldCampaignOptions['onLocalStep']
    onApply?: () => void
    onPublish?: () => void
  }> = {},
): CampaignSide {
  const world = createWorldHarness(identity.tileX, identity.tileZ, identity.direction, options.onApply)
  const probe = createProbeHarness()
  const publishedActors: Array<readonly unknown[]> = []
  const onLocalTurn = vi.fn()
  const onLocalStep = vi.fn(options.onLocalStep ?? (() => undefined))
  const onLocalTransition = vi.fn()
  const onMovementRejected = vi.fn()
  const onError = vi.fn()
  const onFieldLockChanged = vi.fn()
  const campaign = createHgssBrowserFieldCampaign({
    readContext: () => ({
      gameCode: 'IPKF',
      gameVersion: 7,
      language: 3,
      displayName: identity.displayName,
      gender: identity.gender,
      spriteId: identity.spriteId,
      world: world.world,
    }),
    createMovementProbe: probe.createProbe,
    publishActors: (actors) => {
      publishedActors.push([...actors])
      options.onPublish?.()
    },
    onLocalTurn,
    onLocalStep,
    onLocalTransition,
    onMovementRejected,
    onError,
    onFieldLockChanged,
  })
  return Object.freeze({
    campaign,
    world,
    probe,
    publishedActors,
    onLocalTurn,
    onLocalStep,
    onLocalTransition,
    onMovementRejected,
    onError,
    onFieldLockChanged,
  })
}

function campaignHarness(options: HarnessOptions = {}) {
  const pair = memoryPair()
  const host = createSide({
    displayName: 'ALICE', gender: 'female', spriteId: 97, tileX: 8, tileZ: 12, direction: 'south',
  })
  const guest = createSide({
    displayName: 'BOB', gender: 'male', spriteId: options.guestSpriteId ?? 0, tileX: 9, tileZ: 12, direction: 'west',
  }, {
    onLocalStep: options.guestOnLocalStep,
    onApply: options.guestOnApply,
    onPublish: options.guestOnPublish,
  })
  sessionSerial += 1
  const route = routeContexts(pair, `rtc:field-campaign:${sessionSerial}`)
  const start = () => Promise.all([
    host.campaign.port.start(route.host),
    guest.campaign.port.start(route.guest),
  ])
  const close = async (): Promise<void> => {
    await Promise.allSettled([guest.campaign.close(), host.campaign.close()])
  }
  return { pair, host, guest, route, start, close }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('La campagne terrain de test ne s’est pas stabilisée.')
}

function deferred<Value>() {
  let resolve!: (value: Value) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<Value>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function sharedProgressionState(flags: readonly number[] = []): FieldScriptState {
  const state = createFieldScriptState('male', 'BOB')
  state.flags = new Set(flags)
  return state
}

function connectedRevision(campaign: HgssBrowserFieldCampaign): number | undefined {
  const state = campaign.getState()
  return state.status === 'connected' ? state.snapshot.revision : undefined
}

const eastStep = Object.freeze({ deltaX: 1, deltaZ: 0, direction: 'east' as const, running: false })
const southStep = Object.freeze({ deltaX: 0, deltaZ: 1, direction: 'south' as const, running: false })

describe('campagne HGSS branchée sur le terrain navigateur', () => {
  for (const role of ['host', 'guest'] as const) {
    it(`reprend la position serveur, la checkpoint puis autorise le mouvement (${role})`, async () => {
      const localId = role === 'host' ? 'alice' : 'bob'
      const remoteId = role === 'host' ? 'bob' : 'alice'
      const sessionId = role === 'host' ? 'c3Nzc3Nzc3Nzc3Nzc3Nzcw' : 'dHR0dHR0dHR0dHR0dHR0dA'
      const progression = createHgssSharedCampaignProgressionSeed(
        createFieldScriptState(localId === 'alice' ? 'female' : 'male', localId.toUpperCase()),
        role === 'host' ? 'a'.repeat(32) : 'b'.repeat(32),
      )
      const profile = (playerId: string, x: number) => Object.freeze({
        playerId,
        displayName: playerId === 'alice' ? 'ALICE' : 'BOB',
        gender: playerId === 'alice' ? 'female' as const : 'male' as const,
        state: 'active' as const,
        position: Object.freeze({ mapId: 61, x, z: 12, direction: 'east' as const }),
        spriteId: playerId === 'alice' ? 97 : 0,
        movementSequence: 0,
      })
      let authoritative: HgssCampaignServerSnapshot = Object.freeze({
        protocolVersion: hgssCampaignProtocolVersion,
        sessionId,
        revision: 4,
        players: Object.freeze([profile(localId, 10), profile(remoteId, 20)]),
        sharedProgression: progression,
        pendingEvents: Object.freeze([]),
      })
      const sent = vi.fn(async (command: HgssCampaignClientCommand) => {
        expect(command).toMatchObject({ kind: 'movement', from: { x: 10 }, to: { x: 11 } })
        authoritative = Object.freeze({
          ...authoritative,
          revision: 5,
          players: Object.freeze(authoritative.players.map((player) => player.playerId === localId
            ? Object.freeze({
                ...player,
                movementSequence: 1,
                position: Object.freeze({ ...player.position, x: 11 }),
              })
            : player)),
        })
        return Object.freeze({ appliedRevision: 5, replayed: false, snapshot: authoritative })
      })
      const transport: HgssCampaignClientTransport = Object.freeze({
        transportKind: 'authoritative-websocket',
        connect: (handlers) => { handlers.onSnapshot(authoritative) },
        requestSnapshot: async () => authoritative,
        send: sent,
        disconnect: async () => undefined,
      })
      const service: HgssCampaignAuthoritativeService = Object.freeze({
        prepareHost: vi.fn(async () => transport),
        prepareGuest: vi.fn(async () => transport),
      })
      const world = createWorldHarness(9, 12, 'east')
      const checkpoint = vi.fn(async () => {
        expect(world.getState()).toMatchObject({ tileX: 10, tileZ: 12, direction: 'east' })
      })
      const campaign = createHgssBrowserFieldCampaign({
        readContext: () => ({
          gameCode: 'IPKF', gameVersion: 7, language: 3,
          displayName: localId === 'alice' ? 'ALICE' : 'BOB',
          gender: localId === 'alice' ? 'female' : 'male',
          spriteId: localId === 'alice' ? 97 : 0,
          world: world.world,
        }),
        createMovementProbe: createProbeHarness().createProbe,
        authoritativeService: service,
        inspectPlayerPosition: (position) => world.inspectPlayerTile(
          position.mapId,
          position.x,
          position.z,
        ),
        persistAuthoritativePosition: checkpoint,
      })
      const abort = new AbortController()
      const route: BrowserMultiplayerDirectCampaignStartContext = Object.freeze({
        transport: 'server', sessionId, localParticipantId: localId, remoteParticipantId: remoteId,
        role, rendezvousExpiresAt: Date.now() + 60_000, signal: abort.signal, onTerminated: vi.fn(),
      })
      const handle = await campaign.port.start(route)
      expect(checkpoint).toHaveBeenCalledOnce()
      expect(world.getState()).toMatchObject({ tileX: 10, tileZ: 12 })
      expect(campaign.getState().status).toBe('connected')
      expect(campaign.consumeMovement({ deltaX: 1, deltaZ: 0, direction: 'east', running: false })).toBe(true)
      await waitFor(() => sent.mock.calls.length === 1)
      await waitFor(() => world.getState().tileX === 11)
      await handle.close()
    })
  }

  it.each([0, 97, 221, 222])('préserve le sprite MapObject officiel %i du joueur distant', async (spriteId) => {
    const runtime = campaignHarness({ guestSpriteId: spriteId })
    try {
      await runtime.start()

      expect(runtime.host.campaign.registry.list()).toEqual([
        expect.objectContaining({
          id: 'campaign-player:bob',
          kind: 'remote-player',
          spriteId,
        }),
      ])
    } finally {
      await runtime.close()
    }
  })

  it('consomme une rotation localement sans commande réseau ni commit de pas', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      const commandCount = runtime.pair.guest.sent.filter(isCommandRequest).length

      expect(runtime.guest.campaign.consumeMovement(eastStep)).toBe(true)
      await Promise.resolve()

      expect(runtime.guest.world.setDirection).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalTurn).toHaveBeenCalledWith('east')
      expect(runtime.pair.guest.sent.filter(isCommandRequest)).toHaveLength(commandCount)
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalStep).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })

  it('consomme une seconde entrée pendant la commande en vol sans envoyer un deuxième pas', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.pair.host.holdOutgoing = isCommandResponse
      expect(runtime.guest.campaign.consumeMovement(eastStep)).toBe(true)
      await waitFor(() => runtime.pair.host.heldCount() === 1)
      const commandCount = runtime.pair.guest.sent.filter(isCommandRequest).length

      expect(runtime.guest.campaign.consumeMovement(eastStep)).toBe(true)
      await Promise.resolve()

      expect(runtime.pair.guest.sent.filter(isCommandRequest)).toHaveLength(commandCount)
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      runtime.pair.host.flushHeld()
      await waitFor(() => runtime.guest.world.applyAuthoritativePlayerStep.mock.calls.length === 1)
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
    } finally {
      await runtime.close()
    }
  })

  it('applique le snapshot acquitté avant exactement un commit et un onLocalStep', async () => {
    const journal: string[] = []
    const runtime = campaignHarness({
      guestOnApply: () => { journal.push('commit') },
      guestOnLocalStep: () => { journal.push('local-step') },
      guestOnPublish: () => { journal.push('snapshot') },
    })
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.guest.publishedActors.length = 0
      journal.length = 0
      const originalPublishLength = runtime.guest.publishedActors.length
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.onLocalStep.mock.calls.length === 1)

      expect(runtime.guest.publishedActors.length).toBeGreaterThan(originalPublishLength)
      expect(journal.indexOf('snapshot')).toBeGreaterThanOrEqual(0)
      expect(journal.indexOf('commit')).toBeGreaterThan(journal.indexOf('snapshot'))
      expect(journal.indexOf('local-step')).toBeGreaterThan(journal.indexOf('commit'))
      expect(runtime.guest.world.applyAuthoritativePlayerStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
      expect(runtime.guest.world.getState()).toMatchObject({ tileX: 10, tileZ: 12, direction: 'east' })
    } finally {
      await runtime.close()
    }
  })

  it('rattrape exactement un pas déjà autorisé lorsque son ACK est devenu incertain', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.pair.host.holdOutgoing = isCommandResponse

      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.pair.host.heldCount() === 1)
      await waitFor(() => connectedRevision(runtime.guest.campaign) === 2)
      runtime.pair.host.transformHeld(replaceCommandResponseWithRevisionConflict)
      runtime.pair.host.flushHeld()
      await waitFor(() => runtime.guest.world.applyAuthoritativePlayerStep.mock.calls.length === 1)

      expect(runtime.guest.world.getState()).toMatchObject({ tileX: 10, tileZ: 12, direction: 'east' })
      expect(runtime.guest.world.applyAuthoritativePlayerStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onMovementRejected).not.toHaveBeenCalled()
      expect(runtime.guest.onError).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })

  it('atteste un warp avant envoi, applique son ACK puis diffuse la nouvelle carte au pair distant', async () => {
    const runtime = campaignHarness()
    const arrival = Object.freeze({ mapId: 62, x: 3, z: 2, direction: 'south' as const })
    try {
      await runtime.start()
      runtime.host.probe.setTransitionArrival(arrival)

      expect(runtime.host.campaign.consumeMovement(southStep)).toBe(true)
      await waitFor(() => runtime.host.onLocalTransition.mock.calls.length === 1)
      await waitFor(() => runtime.guest.campaign.registry.list().some((actor) => actor.mapId === 62))

      expect(runtime.host.probe.calls.mock.calls.at(-1)?.[0]).toMatchObject({
        kind: 'movement',
        to: { mapId: 61, x: 8, z: 13, direction: 'south' },
        arrival,
      })
      expect(runtime.host.world.applyAuthoritativePlayerTransition).toHaveBeenCalledWith({
        from: { mapId: 61, x: 8, z: 12, direction: 'south' },
        to: arrival,
        movement: 'walk',
      })
      expect(runtime.host.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.host.world.getState()).toMatchObject({ map: { id: 62 }, tileX: 3, tileZ: 2 })
      expect(runtime.host.onLocalTransition).toHaveBeenCalledWith(
        expect.objectContaining({ kind: 'transitioned', state: expect.objectContaining({ map: { id: 62 } }) }),
        expect.objectContaining({
          kind: 'warp',
          triggerPosition: { mapId: 61, x: 8, z: 13, direction: 'south' },
          authoritativePosition: arrival,
        }),
      )
      expect(runtime.guest.campaign.registry.list()).toEqual([
        expect.objectContaining({ id: 'campaign-player:alice', mapId: 62, tileX: 3, tileZ: 2 }),
      ])
      expect(runtime.guest.campaign.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 2 } })
      const guestState = runtime.guest.campaign.getState()
      expect(guestState.status === 'connected'
        ? guestState.snapshot.players.find(({ playerId }) => playerId === 'alice')
        : undefined).toMatchObject({ position: arrival })
    } finally {
      await runtime.close()
    }
  })

  it('rattrape une transition déjà autorisée sans doubler monde ni présentation si son ACK est perdu', async () => {
    const runtime = campaignHarness()
    const arrival = Object.freeze({ mapId: 62, x: 3, z: 2, direction: 'south' as const })
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.guest.probe.setTransitionArrival(arrival)
      runtime.host.probe.setTransitionArrival(arrival)
      runtime.pair.host.holdOutgoing = isCommandResponse

      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.pair.host.heldCount() === 1)
      await waitFor(() => connectedRevision(runtime.guest.campaign) === 2)
      runtime.pair.host.transformHeld(replaceCommandResponseWithRevisionConflict)
      runtime.pair.host.flushHeld()
      await waitFor(() => runtime.guest.world.applyAuthoritativePlayerTransition.mock.calls.length === 1)

      expect(runtime.guest.world.getState()).toMatchObject({ map: { id: 62 }, tileX: 3, tileZ: 2, direction: 'south' })
      expect(runtime.guest.world.applyAuthoritativePlayerTransition).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalTransition).toHaveBeenCalledOnce()
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onMovementRejected).not.toHaveBeenCalled()
      expect(runtime.guest.onError).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })

  it('refuse une arrivée qui diverge du probe ROM hôte sans muter le monde local', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.guest.probe.setTransitionArrival({ mapId: 62, x: 3, z: 2, direction: 'south' })
      runtime.host.probe.setTransitionArrival({ mapId: 62, x: 4, z: 2, direction: 'south' })

      expect(runtime.guest.campaign.consumeMovement(eastStep)).toBe(true)
      await waitFor(() => runtime.guest.onMovementRejected.mock.calls.length === 1)

      expect(runtime.guest.campaign.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })
      expect(runtime.guest.world.getState()).toMatchObject({ map: { id: 61 }, tileX: 9, tileZ: 12 })
      expect(runtime.guest.world.applyAuthoritativePlayerTransition).not.toHaveBeenCalled()
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalTransition).not.toHaveBeenCalled()
      expect(runtime.guest.onError).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })

  it('traite un rejet de collision comme récupérable puis accepte le mouvement suivant', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.host.probe.rejectNext()

      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.onMovementRejected.mock.calls.length === 1)

      expect(runtime.guest.campaign.getState().status).toBe('connected')
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onError).not.toHaveBeenCalled()

      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.world.applyAuthoritativePlayerStep.mock.calls.length === 1)
      expect(runtime.guest.campaign.getState().status).toBe('connected')
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
    } finally {
      await runtime.close()
    }
  })

  it("ne prend jamais la révision avancée par l'autre joueur pour l'ACK du mouvement local", async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.host.campaign.consumeMovement(southStep)
      await waitFor(() => runtime.host.world.applyAuthoritativePlayerStep.mock.calls.length === 1)
      await waitFor(() => connectedRevision(runtime.guest.campaign) === 2)
      runtime.host.probe.rejectNext()

      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.onMovementRejected.mock.calls.length === 1)

      expect(runtime.guest.campaign.getState()).toMatchObject({
        status: 'connected',
        snapshot: {
          revision: 2,
          players: expect.arrayContaining([
            expect.objectContaining({
              playerId: 'bob',
              movementSequence: 0,
              position: expect.objectContaining({ x: 9, z: 12 }),
            }),
          ]),
        },
      })
      expect(runtime.guest.world.getState()).toMatchObject({ tileX: 9, tileZ: 12 })
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.world.applyAuthoritativePlayerTransition).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalStep).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalTransition).not.toHaveBeenCalled()
      expect(runtime.guest.onError).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })

  it('draine un ACK de mouvement déjà reçu avant close', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.pair.host.holdOutgoing = isCommandResponse
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.pair.host.heldCount() === 1)

      runtime.pair.host.flushHeldSynchronously()
      await runtime.guest.campaign.close()
      await Promise.resolve()
      await Promise.resolve()

      expect(runtime.guest.world.applyAuthoritativePlayerStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
      expect(runtime.guest.campaign.getState().status).toBe('idle')
    } finally {
      await runtime.close()
    }
  })

  it('applique le pas accepté et son snapshot avant la fermeture de page', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.pair.host.holdOutgoing = isCommandResponse
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.pair.host.heldCount() === 1)

      let released = false
      const release = runtime.guest.campaign.prepareForPageRelease().then(() => { released = true })
      await Promise.resolve()
      await Promise.resolve()

      expect(released).toBe(false)
      expect(runtime.guest.campaign.getState().status).toBe('connected')
      expect(runtime.guest.campaign.isFieldLocked()).toBe(true)
      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalStep).not.toHaveBeenCalled()

      runtime.pair.host.flushHeldSynchronously()
      await release

      expect(runtime.guest.world.getState()).toMatchObject({ tileX: 10, tileZ: 12, direction: 'east' })
      expect(runtime.guest.world.applyAuthoritativePlayerStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalStep).toHaveBeenCalledOnce()
      expect(runtime.route.guestTerminated).toHaveBeenCalledOnce()
      expect(runtime.guest.onLocalStep.mock.invocationCallOrder[0])
        .toBeLessThan(runtime.route.guestTerminated.mock.invocationCallOrder[0]!)
      expect(runtime.guest.campaign.getState().status).toBe('idle')
    } finally {
      await runtime.close()
    }
  })

  it('nettoie immédiatement une campagne annulée par le signal runtime avant la fermeture du handle', async () => {
    const runtime = campaignHarness()
    try {
      const [, guestHandle] = await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.pair.host.holdOutgoing = isCommandResponse
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.pair.host.heldCount() === 1)

      runtime.route.guestAbort.abort()
      expect(['closing', 'idle']).toContain(runtime.guest.campaign.getState().status)
      await guestHandle.close()
      await waitFor(() => runtime.guest.campaign.getState().status === 'idle')

      expect(runtime.guest.world.applyAuthoritativePlayerStep).not.toHaveBeenCalled()
      expect(runtime.guest.onLocalStep).not.toHaveBeenCalled()
      expect(runtime.guest.campaign.isFieldLocked()).toBe(false)
      expect(runtime.guest.campaign.registry.size()).toBe(0)
      expect(runtime.guest.publishedActors.at(-1)).toEqual([])
      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenCalledTimes(1)
      expect(runtime.guest.world.restoreFollowerState).toHaveBeenCalledWith({
        tileX: 8,
        tileZ: 12,
        direction: 'east',
        movement: 7,
      })
    } finally {
      await runtime.close()
    }
  })

  it('draine un événement déjà accepté par le serveur avant de persister puis fermer la page', async () => {
    const branchId = '0123456789abcdef0123456789abcdef'
    const sessionId = 'AAAAAAAAAAAAAAAAAAAAAA'
    const eventId = createHgssSharedCampaignFieldEventId({
      rom: { gameCode: 'IPKF', gameVersion: 7, language: 3 },
      mapId: 61,
      source: { kind: 'object', objectId: 4 },
      scriptId: 9,
    })
    const before = sharedProgressionState()
    const after = sharedProgressionState([0x70])
    const initialProgression = createHgssSharedCampaignProgressionSeed(before, branchId, 0)
    const acceptedSeed = createHgssSharedCampaignProgressionSeed(after, branchId, 1)
    const acceptedProgression = Object.freeze({
      ...acceptedSeed,
      milestoneIds: Object.freeze([...acceptedSeed.milestoneIds, eventId]),
    })
    const players = Object.freeze([
      Object.freeze({
        playerId: 'alice', displayName: 'ALICE', gender: 'female' as const, state: 'active' as const,
        position: Object.freeze({ mapId: 61, x: 8, z: 12, direction: 'south' as const }),
        spriteId: 97, movementSequence: 0,
      }),
      Object.freeze({
        playerId: 'bob', displayName: 'BOB', gender: 'male' as const, state: 'active' as const,
        position: Object.freeze({ mapId: 61, x: 9, z: 12, direction: 'west' as const }),
        spriteId: 0, movementSequence: 0,
      }),
    ])
    const initial: HgssCampaignServerSnapshot = Object.freeze({
      protocolVersion: hgssCampaignProtocolVersion,
      sessionId,
      revision: 1,
      players,
      sharedProgression: initialProgression,
      pendingEvents: Object.freeze([]),
    })
    const accepted: HgssCampaignServerSnapshot = Object.freeze({
      ...initial,
      revision: 2,
      sharedProgression: acceptedProgression,
      pendingEvents: Object.freeze([Object.freeze({
        eventId,
        eventRevision: 2,
        pendingPlayerIds: Object.freeze(['alice', 'bob']),
      })]),
    })
    const acknowledged: HgssCampaignServerSnapshot = Object.freeze({
      ...accepted,
      revision: 3,
      pendingEvents: Object.freeze([]),
    })
    const delayedAcceptance = deferred<Readonly<{
      appliedRevision: number
      replayed: boolean
      snapshot: HgssCampaignServerSnapshot
    }>>()
    const journal: string[] = []
    let authoritative = initial
    let handlers: HgssCampaignClientTransportHandlers | undefined
    const disconnect = vi.fn(async () => { journal.push('close') })
    const send = vi.fn((command: HgssCampaignClientCommand) => {
      journal.push(`send:${command.kind}`)
      if (command.kind === 'shared-event') {
        authoritative = accepted
        journal.push('server:accepted')
        return delayedAcceptance.promise
      }
      authoritative = acknowledged
      return Promise.resolve({
        appliedRevision: acknowledged.revision,
        replayed: false,
        snapshot: acknowledged,
      })
    })
    const transport: HgssCampaignClientTransport = Object.freeze({
      transportKind: 'authoritative-websocket',
      connect(nextHandlers) {
        handlers = nextHandlers
        nextHandlers.onSnapshot(authoritative)
      },
      requestSnapshot: async () => authoritative,
      send,
      disconnect,
    })
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(async () => transport),
      prepareGuest: vi.fn(async () => transport),
    })
    const world = createWorldHarness(9, 12, 'west')
    const probe = createProbeHarness()
    let current = before
    let savedCampaign: HgssSharedCampaignSaveExtensionV1 | undefined
    const persistState = vi.fn(async (
      _candidate: FieldScriptState,
      campaign: HgssSharedCampaignSaveExtensionV1,
    ) => {
      journal.push('persist')
      savedCampaign = campaign
    })
    const publishState = vi.fn((candidate: FieldScriptState) => {
      journal.push('publish')
      current = candidate
    })
    const campaign = createHgssBrowserFieldCampaign({
      readContext: () => ({
        gameCode: 'IPKF', gameVersion: 7, language: 3,
        displayName: 'BOB', gender: 'male', spriteId: 0, world: world.world,
      }),
      createMovementProbe: probe.createProbe,
      authoritativeService: service,
      progression: {
        readFieldState: () => current,
        readSeed: () => initialProgression,
        readSavedCampaign: () => savedCampaign,
        persistState,
        publishState,
      },
    })
    const abort = new AbortController()
    const route: BrowserMultiplayerDirectCampaignStartContext = Object.freeze({
      transport: 'server',
      sessionId,
      localParticipantId: 'bob',
      remoteParticipantId: 'alice',
      role: 'guest',
      rendezvousExpiresAt: Date.now() + 60_000,
      signal: abort.signal,
      onTerminated: vi.fn(),
    })

    try {
      await campaign.port.start(route)
      expect(handlers).toBeDefined()
      journal.length = 0
      persistState.mockClear()
      publishState.mockClear()
      disconnect.mockClear()

      const commit = campaign.commitSharedEvent(eventId, before, after)
      await waitFor(() => journal.includes('server:accepted'))
      // The public close path must share the same durability barrier as an
      // explicit page release. Historically it disconnected immediately and
      // could strand this already-authoritative event before local persistence.
      const release = campaign.close()

      expect(campaign.prepareForPageRelease()).toBe(release)
      expect(campaign.close()).toBe(release)
      expect(campaign.consumeMovement(eastStep)).toBe(true)
      await expect(campaign.commitSharedEvent(eventId, before, after))
        .rejects.toThrow('cours de fermeture')
      await Promise.resolve()
      expect(persistState).not.toHaveBeenCalled()
      expect(publishState).not.toHaveBeenCalled()
      expect(disconnect).not.toHaveBeenCalled()

      delayedAcceptance.resolve({ appliedRevision: 2, replayed: false, snapshot: accepted })
      await Promise.all([commit, release])

      expect([...current.flags]).toEqual([0x70])
      expect(persistState.mock.calls.length).toBeGreaterThanOrEqual(1)
      expect(publishState).toHaveBeenCalledOnce()
      expect(disconnect).toHaveBeenCalledOnce()
      expect(journal.indexOf('persist')).toBeLessThan(journal.indexOf('publish'))
      expect(journal.indexOf('publish')).toBeLessThan(journal.indexOf('close'))
      expect(journal.lastIndexOf('persist')).toBeLessThan(journal.indexOf('close'))
      expect(campaign.getState().status).toBe('idle')
    } finally {
      await campaign.close()
    }
  })

  it('réancre le follower derrière la position autoritaire après plusieurs pas avant le checkpoint de leave', async () => {
    const runtime = campaignHarness()
    try {
      await runtime.start()
      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenCalledWith(false)
      expect(runtime.guest.campaign.registry.size()).toBe(1)
      expect(runtime.guest.publishedActors.at(-1)).toEqual([
        expect.objectContaining({ kind: 'remote-player', id: 'campaign-player:alice' }),
      ])

      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.onLocalStep.mock.calls.length === 1)
      runtime.guest.campaign.consumeMovement(eastStep)
      await waitFor(() => runtime.guest.onLocalStep.mock.calls.length === 2)

      await runtime.guest.campaign.prepareForPageRelease()
      expect(runtime.guest.campaign.isFieldLocked()).toBe(false)
      expect(runtime.guest.world.getState()).toMatchObject({ tileX: 11, tileZ: 12, direction: 'east' })
      expect(runtime.guest.world.world.getFollowerState()).toMatchObject({
        tileX: 10,
        tileZ: 12,
        direction: 'east',
      })
      expect(runtime.guest.world.world.getFollowerState()).not.toHaveProperty('movement')
      expect(runtime.guest.world.restoreFollowerState).not.toHaveBeenCalled()
      expect(runtime.guest.onFieldLockChanged).toHaveBeenLastCalledWith(false)

      await waitFor(() => runtime.guest.campaign.getState().status === 'idle')
      const publicationCount = runtime.guest.publishedActors.length

      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenNthCalledWith(1, false)
      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenNthCalledWith(2, true)
      expect(runtime.guest.campaign.registry.size()).toBe(0)
      expect(runtime.guest.publishedActors.at(-1)).toEqual([])

      await runtime.guest.campaign.close()
      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenCalledTimes(2)
      expect(runtime.guest.publishedActors).toHaveLength(publicationCount)
    } finally {
      await runtime.close()
    }
  })

  it('refuse le bootstrap lorsque l’admission hôte voit la case invitée bloquée', async () => {
    const runtime = campaignHarness()
    runtime.host.world.setAdmissionBlocked(true)
    try {
      const results = await Promise.allSettled([
        runtime.host.campaign.port.start(runtime.route.host),
        runtime.guest.campaign.port.start(runtime.route.guest),
      ])

      expect(results.every(({ status }) => status === 'rejected')).toBe(true)
      expect(runtime.host.world.inspectPlayerTile).toHaveBeenCalledWith(61, 9, 12, { locomotion: 'walking' })
      expect([runtime.host.campaign.getState(), runtime.guest.campaign.getState()]).toEqual([
        expect.objectContaining({ status: 'failed' }),
        expect.objectContaining({ status: 'failed' }),
      ])
      expect(runtime.host.campaign.registry.size()).toBe(0)
      expect(runtime.guest.campaign.registry.size()).toBe(0)
    } finally {
      await runtime.close()
    }
  })

  it('ferme la campagne si onLocalStep échoue après le commit autoritaire', async () => {
    const callbackError = new Error('local-step-presentation-failed')
    const runtime = campaignHarness({ guestOnLocalStep: () => { throw callbackError } })
    try {
      await runtime.start()
      runtime.guest.campaign.consumeMovement(eastStep)
      runtime.guest.campaign.consumeMovement(eastStep)

      await waitFor(() => runtime.guest.campaign.getState().status === 'idle')

      expect(runtime.guest.world.applyAuthoritativePlayerStep).toHaveBeenCalledOnce()
      expect(runtime.guest.onError).toHaveBeenCalledWith(callbackError)
      expect(runtime.guest.campaign.isFieldLocked()).toBe(false)
      expect(runtime.guest.campaign.registry.size()).toBe(0)
      expect(runtime.guest.world.setFollowerEnabled).toHaveBeenLastCalledWith(true)
      expect(runtime.guest.world.restoreFollowerState).not.toHaveBeenCalled()
    } finally {
      await runtime.close()
    }
  })
})
