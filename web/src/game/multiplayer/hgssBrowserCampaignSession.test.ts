import { describe, expect, it, vi } from 'vitest'
import type {
  PeerDataChannel,
  PeerDataChannelHandlers,
  PeerDataChannelState,
} from '../../online/peerDataChannel'
import { createPeerDataChannelMultiplexer } from '../../online/peerDataChannelMultiplexer'
import type {
  BrowserMultiplayerCampaignStartContext,
  BrowserMultiplayerDirectCampaignStartContext,
} from './browserMultiplayerCampaignPort'
import {
  HgssCampaignAuthoritativeServiceError,
  type HgssCampaignAuthoritativeService,
} from './hgssCampaignAuthoritativeService'
import type {
  HgssCampaignClientTransport,
  HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import type { HgssCampaignServerSnapshot } from './hgssCampaignProtocol'
import {
  createHgssBrowserCampaignCoordinator,
  type HgssBrowserCampaignCoordinator,
  type HgssBrowserCampaignLocalPlayer,
} from './hgssBrowserCampaignSession'
import { createHgssCampaignPeerLogicalHostBinding } from './hgssCampaignPeerBridge'

class MemoryPeerDataChannel implements PeerDataChannel {
  private state: PeerDataChannelState = 'open'
  private handlers?: PeerDataChannelHandlers
  private readonly synchronous: boolean
  peer?: MemoryPeerDataChannel
  transformOutgoing: (message: string) => string = (message) => message
  dropOutgoing: (message: string) => boolean = () => false
  readonly sent: string[] = []

  constructor(synchronous = false) { this.synchronous = synchronous }

  getState = (): PeerDataChannelState => this.state

  attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (this.handlers) throw new Error('memory-channel-already-attached')
    this.handlers = handlers
    if (this.state === 'open' && this.synchronous) handlers.onOpen()
    else if (this.state === 'open') queueMicrotask(() => { if (this.handlers === handlers) handlers.onOpen() })
    else queueMicrotask(() => { if (this.handlers === handlers) handlers.onClose() })
    return () => { if (this.handlers === handlers) this.handlers = undefined }
  }

  send = (message: string): void => {
    const peer = this.peer
    if (this.state !== 'open' || !peer || peer.state !== 'open') throw new Error('memory-channel-not-open')
    this.sent.push(message)
    if (this.dropOutgoing(message)) return
    const outgoing = this.transformOutgoing(message)
    if (this.synchronous) peer.handlers?.onMessage(outgoing)
    else queueMicrotask(() => peer.handlers?.onMessage(outgoing))
  }

  close = (): void => {
    if (this.state === 'closed') return
    this.state = 'closed'
    const localHandlers = this.handlers
    queueMicrotask(() => localHandlers?.onClose())
    const peer = this.peer
    if (peer && peer.state !== 'closed') {
      peer.state = 'closed'
      const peerHandlers = peer.handlers
      queueMicrotask(() => peerHandlers?.onClose())
    }
  }
}

function memoryPair(synchronous = false) {
  const host = new MemoryPeerDataChannel(synchronous)
  const guest = new MemoryPeerDataChannel(synchronous)
  host.peer = guest
  guest.peer = host
  return { host, guest }
}

const hostLocal: HgssBrowserCampaignLocalPlayer = {
  gameCode: 'IPKF',
  gameVersion: 7,
  language: 3,
  player: {
    displayName: 'ALICE',
    gender: 'female',
    position: { mapId: 61, x: 8, z: 12, direction: 'south' },
    spriteId: 97,
    locomotion: 'walking',
  },
}

const guestLocal: HgssBrowserCampaignLocalPlayer = {
  gameCode: 'IPKF',
  gameVersion: 7,
  language: 3,
  player: {
    displayName: 'BOB',
    gender: 'male',
    position: { mapId: 61, x: 9, z: 12, direction: 'west' },
    spriteId: 0,
    locomotion: 'walking',
  },
}

function coordinator(
  local: HgssBrowserCampaignLocalPlayer,
  snapshots: number[] = [],
): HgssBrowserCampaignCoordinator {
  return createHgssBrowserCampaignCoordinator({
    readLocalPlayer: () => local,
    movement: () => ({ kind: 'accept' }),
    authorizeGuestJoin: () => ({ kind: 'accept' }),
    onSnapshot: (snapshot) => { snapshots.push(snapshot.revision) },
  })
}

function serverSnapshot(sessionId: string): HgssCampaignServerSnapshot {
  return Object.freeze({
    protocolVersion: 2,
    sessionId,
    revision: 1,
    players: Object.freeze([
      Object.freeze({
        playerId: 'alice', displayName: 'ALICE', gender: 'female' as const, state: 'active' as const,
        position: hostLocal.player.position, spriteId: 97, movementSequence: 0,
      }),
      Object.freeze({
        playerId: 'bob', displayName: 'BOB', gender: 'male' as const, state: 'active' as const,
        position: guestLocal.player.position, spriteId: 0, movementSequence: 0,
      }),
    ]),
    sharedProgression: Object.freeze({ milestoneIds: Object.freeze([]), counters: Object.freeze([]) }),
    pendingEvents: Object.freeze([]),
  })
}

function provisionalHostSnapshot(sessionId: string): HgssCampaignServerSnapshot {
  const complete = serverSnapshot(sessionId)
  return Object.freeze({
    ...complete,
    revision: 0,
    players: Object.freeze([complete.players[0]!]),
  })
}

function fakeAuthoritativeTransport(snapshot: HgssCampaignServerSnapshot) {
  let handlers: HgssCampaignClientTransportHandlers | undefined
  const disconnect = vi.fn(async () => undefined)
  const send = vi.fn(async () => ({ appliedRevision: snapshot.revision, replayed: false, snapshot }))
  const transport: HgssCampaignClientTransport = Object.freeze({
    transportKind: 'authoritative-websocket',
    async connect(nextHandlers) {
      handlers = nextHandlers
      nextHandlers.onSnapshot(snapshot)
    },
    requestSnapshot: async () => snapshot,
    send,
    disconnect,
  })
  return { transport, disconnect, send, readHandlers: () => handlers }
}

function contexts(pair: ReturnType<typeof memoryPair>, sessionId = 'rtc:campaign:browser') {
  const hostMux = createPeerDataChannelMultiplexer(pair.host, { channelIds: ['campaign'] })
  const guestMux = createPeerDataChannelMultiplexer(pair.guest, { channelIds: ['campaign'] })
  const hostChannel = hostMux.getChannel('campaign')
  const guestChannel = guestMux.getChannel('campaign')
  const hostAbort = new AbortController()
  const guestAbort = new AbortController()
  const hostTerminated = vi.fn()
  const guestTerminated = vi.fn()
  const binding = createHgssCampaignPeerLogicalHostBinding({
    route: hostMux.issueChannelBinding('campaign'),
    peerId: 'bob',
    negotiationId: sessionId,
    sessionId,
    playerId: 'bob',
  })
  const host: BrowserMultiplayerCampaignStartContext = {
    channel: hostChannel,
    sessionId,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    role: 'host',
    signal: hostAbort.signal,
    onTerminated: hostTerminated,
    hostBinding: binding,
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

function directContexts(sessionId = 'AAAAAAAAAAAAAAAAAAAAAA') {
  const hostAbort = new AbortController()
  const guestAbort = new AbortController()
  const hostTerminated = vi.fn()
  const guestTerminated = vi.fn()
  const rendezvousExpiresAt = Date.now() + 60_000
  const host: BrowserMultiplayerDirectCampaignStartContext = {
    transport: 'server',
    sessionId,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    role: 'host',
    rendezvousExpiresAt,
    signal: hostAbort.signal,
    onTerminated: hostTerminated,
  }
  const guest: BrowserMultiplayerDirectCampaignStartContext = {
    transport: 'server',
    sessionId,
    localParticipantId: 'bob',
    remoteParticipantId: 'alice',
    role: 'guest',
    rendezvousExpiresAt,
    signal: guestAbort.signal,
    onTerminated: guestTerminated,
  }
  return { host, guest, hostAbort, guestAbort, hostTerminated, guestTerminated }
}

function rewriteCampaignSnapshots(
  message: string,
  rewrite: (snapshot: Record<string, unknown>) => Record<string, unknown>,
): string {
  const outer = JSON.parse(message) as Record<string, unknown>
  if (outer.kind !== 'data' || outer.channel !== 'campaign' || typeof outer.payload !== 'string') return message
  const inner = JSON.parse(outer.payload) as Record<string, unknown>
  if (inner.protocol !== 'pokemaster-hgss-campaign-peer') return message
  if ((inner.kind === 'snapshot' || inner.kind === 'response')
    && inner.snapshot !== null && typeof inner.snapshot === 'object') {
    inner.snapshot = rewrite(inner.snapshot as Record<string, unknown>)
    outer.payload = JSON.stringify(inner)
  }
  return JSON.stringify(outer)
}

function isCampaignReadyRequest(message: string): boolean {
  const outer = JSON.parse(message) as Record<string, unknown>
  if (outer.kind !== 'data' || outer.channel !== 'campaign' || typeof outer.payload !== 'string') return false
  const inner = JSON.parse(outer.payload) as Record<string, unknown>
  return inner.protocol === 'pokemaster-hgss-campaign-peer'
    && inner.kind === 'request'
    && inner.operation === 'ready'
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('La campagne de test ne s’est pas stabilisée.')
}

describe('session navigateur de campagne HGSS', () => {
  it('exige un sessionId opaque serveur pour une route directe', async () => {
    const route = directContexts()
    const prepareHost = vi.fn()
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: Object.freeze({ prepareHost, prepareGuest: vi.fn() }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const forged: BrowserMultiplayerDirectCampaignStartContext = {
      ...route.host,
      sessionId: 'rtc:campaign:not-opaque',
    }

    await expect(host.port.start(forged)).rejects.toMatchObject({ code: 'campaign-route-invalid' })
    expect(prepareHost).not.toHaveBeenCalled()
    expect(host.getState()).toEqual({ status: 'idle' })
  })

  it("garde l'hôte direct en connexion sur le snapshot provisoire et arme le terrain au roster complet", async () => {
    const route = directContexts()
    const provisional = provisionalHostSnapshot(route.host.sessionId)
    const complete = serverSnapshot(route.host.sessionId)
    const hostTransport = fakeAuthoritativeTransport(provisional)
    const prepareHost = vi.fn<HgssCampaignAuthoritativeService['prepareHost']>(
      async () => hostTransport.transport,
    )
    const authorizeGuestJoin = vi.fn(() => ({ kind: 'accept' as const }))
    const appliedRevisions: number[] = []
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: Object.freeze({ prepareHost, prepareGuest: vi.fn() }),
      authorizeGuestJoin,
      onSnapshot: (snapshot) => { appliedRevisions.push(snapshot.revision) },
    })

    const opening = host.port.start(route.host)
    await waitFor(() => hostTransport.readHandlers() !== undefined)

    expect(host.getState()).toEqual({
      status: 'connecting', role: 'host', remoteParticipantId: 'bob',
    })
    expect(appliedRevisions).toEqual([])
    expect(prepareHost).toHaveBeenCalledWith(expect.objectContaining({
      allowProvisionalHostSnapshot: true,
      localParticipantId: 'alice',
      remoteParticipantId: 'bob',
      sessionId: route.host.sessionId,
      guestJoinAdmission: expect.any(Function),
    }))
    const preparation = prepareHost.mock.calls[0]![0]
    expect(preparation.guestJoinAdmission?.({
      sessionId: route.host.sessionId,
      playerId: 'bob',
      compatibility: { applicationId: 'IPKF', release: 7, locale: 3 },
      player: {
        displayName: 'BOB',
        gender: 'male',
        position: guestLocal.player.position,
        spriteId: 0,
      },
      snapshot: provisional,
    })).toEqual({ kind: 'accept' })
    expect(authorizeGuestJoin).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: route.host.sessionId,
      guest: expect.objectContaining({
        senderId: 'bob', receiverId: 'alice', gameCode: 'IPKF',
        player: expect.objectContaining({ locomotion: 'walking' }),
      }),
    }))

    hostTransport.readHandlers()?.onSnapshot(complete)
    const handle = await opening

    expect(appliedRevisions.length).toBeGreaterThan(0)
    expect(appliedRevisions).not.toContain(0)
    expect(appliedRevisions.every((revision) => revision === complete.revision)).toBe(true)
    expect(host.getState()).toMatchObject({
      status: 'connected', role: 'host', snapshot: { revision: complete.revision },
    })

    await handle.close()
    expect(hostTransport.disconnect).toHaveBeenCalledOnce()
    expect(route.hostTerminated).toHaveBeenCalledOnce()
  })

  it("réessaie seulement une admission invitée directe transitoire jusqu'au rendez-vous", async () => {
    vi.useFakeTimers()
    try {
      const route = directContexts()
      const complete = serverSnapshot(route.guest.sessionId)
      const guestTransport = fakeAuthoritativeTransport(complete)
      const prepareGuest = vi.fn()
        .mockRejectedValueOnce(new HgssCampaignAuthoritativeServiceError(
          'join-unattested',
          "L'hôte n'est pas encore attaché.",
          { status: 409 },
        ))
        .mockResolvedValueOnce(guestTransport.transport)
      const guest = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => guestLocal,
        movement: () => ({ kind: 'accept' }),
        authoritativeService: Object.freeze({ prepareHost: vi.fn(), prepareGuest }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
      })

      const opening = guest.port.start(route.guest)
      await vi.advanceTimersByTimeAsync(0)
      expect(prepareGuest).toHaveBeenCalledTimes(1)
      await vi.advanceTimersByTimeAsync(100)
      const handle = await opening

      expect(prepareGuest).toHaveBeenCalledTimes(2)
      expect(prepareGuest.mock.calls[0]?.[0]).not.toHaveProperty('guestJoinAdmission')
      expect(guest.getState()).toMatchObject({ status: 'connected', role: 'guest' })
      await handle.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it("ne réessaie pas un refus métier de l'admission directe invitée", async () => {
    const route = directContexts()
    const refusal = new HgssCampaignAuthoritativeServiceError(
      'join-rejected',
      "L'hôte a refusé l'admission.",
      { status: 409 },
    )
    const prepareGuest = vi.fn(async () => { throw refusal })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: Object.freeze({ prepareHost: vi.fn(), prepareGuest }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })

    await expect(guest.port.start(route.guest)).rejects.toBe(refusal)
    expect(prepareGuest).toHaveBeenCalledOnce()
  })

  it("arrête les retries invités à l'expiration exacte du rendez-vous", async () => {
    vi.useFakeTimers()
    try {
      const base = directContexts()
      const route: BrowserMultiplayerDirectCampaignStartContext = {
        ...base.guest,
        rendezvousExpiresAt: Date.now() + 150,
      }
      const prepareGuest = vi.fn(async () => {
        throw new HgssCampaignAuthoritativeServiceError(
          'session-not-found',
          'La création hôte est encore en vol.',
          { status: 404 },
        )
      })
      const guest = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => guestLocal,
        movement: () => ({ kind: 'accept' }),
        authoritativeService: Object.freeze({ prepareHost: vi.fn(), prepareGuest }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
      })
      const opening = guest.port.start(route)
      const rejection = expect(opening).rejects.toMatchObject({
        code: 'campaign-bootstrap-timeout',
      })

      await vi.advanceTimersByTimeAsync(150)
      await rejection

      expect(prepareGuest).toHaveBeenCalledTimes(2)
      expect(guest.getState()).toMatchObject({ status: 'failed' })
    } finally {
      vi.useRealTimers()
    }
  })

  it("interrompt les retries invités dès l'annulation du runtime", async () => {
    vi.useFakeTimers()
    try {
      const route = directContexts()
      const prepareGuest = vi.fn(async () => {
        throw new HgssCampaignAuthoritativeServiceError(
          'join-unattested',
          "L'hôte n'est pas encore attaché.",
          { status: 409 },
        )
      })
      const guest = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => guestLocal,
        movement: () => ({ kind: 'accept' }),
        authoritativeService: Object.freeze({ prepareHost: vi.fn(), prepareGuest }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
      })
      const opening = guest.port.start(route.guest)
      const rejection = expect(opening).rejects.toMatchObject({ code: 'campaign-disconnected' })
      await vi.advanceTimersByTimeAsync(0)

      route.guestAbort.abort()
      await rejection

      expect(prepareGuest).toHaveBeenCalledOnce()
      expect(guest.getState()).toEqual({ status: 'idle' })
    } finally {
      vi.useRealTimers()
    }
  })

  it("annule l'attente directe sans DataChannel et sans fallback en mémoire", async () => {
    const route = directContexts()
    const provisional = provisionalHostSnapshot(route.host.sessionId)
    const hostTransport = fakeAuthoritativeTransport(provisional)
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: Object.freeze({
        prepareHost: vi.fn(async () => hostTransport.transport),
        prepareGuest: vi.fn(),
      }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const opening = host.port.start(route.host)
    const rejection = expect(opening).rejects.toMatchObject({ code: 'campaign-disconnected' })
    await waitFor(() => hostTransport.readHandlers() !== undefined)

    await host.close()
    await rejection

    expect(hostTransport.disconnect).toHaveBeenCalledOnce()
    expect(host.getGateway()).toBeUndefined()
    expect(host.getState()).toEqual({ status: 'idle' })

    const unavailable = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    await expect(unavailable.port.start(directContexts().host)).rejects.toMatchObject({
      code: 'campaign-authority-failed',
    })
    expect(unavailable.getGateway()).toBeUndefined()
  })

  it('fait emprunter le serveur aux deux rôles et nettoie les deux transports sans autorité navigateur', async () => {
    const pair = memoryPair()
    const sessionId = 'rtc:campaign:server-authority'
    const route = contexts(pair, sessionId)
    const snapshot = serverSnapshot(sessionId)
    const hostTransport = fakeAuthoritativeTransport(snapshot)
    const guestTransport = fakeAuthoritativeTransport(snapshot)
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(async () => hostTransport.transport),
      prepareGuest: vi.fn(async () => guestTransport.transport),
    })
    const sharedProgression = {
      milestoneIds: ['field.schema.v1', 'field.branch.heartgold'],
      counters: [{ id: 'field.progression.revision', value: 7 }],
    }
    const hostMovement = vi.fn(() => ({ kind: 'accept' as const }))
    const hostSharedEventAdmission = vi.fn(() => ({ kind: 'accept' as const }))
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => ({ ...hostLocal, sharedProgression }),
      movement: hostMovement,
      sharedEventAdmission: hostSharedEventAdmission,
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => ({ ...guestLocal, sharedProgression }),
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })

    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(service.prepareHost).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      localParticipantId: 'alice',
      remoteParticipantId: 'bob',
      movementAdmission: hostMovement,
      sharedEventAdmission: hostSharedEventAdmission,
      sharedProgression,
    }))
    expect(service.prepareGuest).toHaveBeenCalledWith(expect.objectContaining({
      sessionId,
      localParticipantId: 'bob',
      remoteParticipantId: 'alice',
    }))
    expect((service.prepareGuest as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      .not.toHaveProperty('movementAdmission')
    expect((service.prepareGuest as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      .not.toHaveProperty('sharedEventAdmission')
    expect((service.prepareGuest as ReturnType<typeof vi.fn>).mock.calls[0]?.[0])
      .not.toHaveProperty('sharedProgression')
    const preparedHostRequest = (service.prepareHost as ReturnType<typeof vi.fn>)
      .mock.calls[0]?.[0] as Parameters<HgssCampaignAuthoritativeService['prepareHost']>[0]
    const forwarded = preparedHostRequest.sharedProgression
    expect(forwarded).toEqual(sharedProgression)
    expect(forwarded).not.toBe(sharedProgression)
    expect(Object.isFrozen(forwarded)).toBe(true)
    const peerAdmission = preparedHostRequest.guestJoinAdmission
    if (!peerAdmission) throw new Error("Le port d'admission serveur du pair est absent.")
    expect(peerAdmission({
      sessionId,
      playerId: 'bob',
      compatibility: { applicationId: 'IPKF', release: 7, locale: 3 },
      player: {
        displayName: 'BOB', gender: 'male', position: guestLocal.player.position, spriteId: 0,
      },
      snapshot: provisionalHostSnapshot(sessionId),
    })).toEqual({ kind: 'accept' })
    expect(peerAdmission({
      sessionId,
      playerId: 'bob',
      compatibility: { applicationId: 'IPKF', release: 7, locale: 3 },
      player: {
        displayName: 'BOB', gender: 'male',
        position: { ...guestLocal.player.position, x: guestLocal.player.position.x + 1 },
        spriteId: 0,
      },
      snapshot: provisionalHostSnapshot(sessionId),
    })).toMatchObject({ kind: 'reject', code: 'campaign-unavailable' })
    expect(host.getGateway()?.getState().status).toBe('connected')
    expect(guest.getGateway()?.getState().status).toBe('connected')

    await Promise.all([hostHandle.close(), guestHandle.close()])
    expect(hostTransport.disconnect).toHaveBeenCalledOnce()
    expect(guestTransport.disconnect).toHaveBeenCalledOnce()
    expect(route.host.channel.getState()).toBe('closed')
    expect(route.guest.channel.getState()).toBe('closed')
  })

  it('rejette une baseline locale non canonique avant de contacter le service', async () => {
    const pair = memoryPair()
    const route = contexts(pair, 'rtc:campaign:invalid-baseline')
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(),
      prepareGuest: vi.fn(),
    })
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => ({
        ...hostLocal,
        sharedProgression: { milestoneIds: ['duplicate', 'duplicate'], counters: [] },
      }),
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })

    await expect(host.port.start(route.host)).rejects.toMatchObject({
      code: 'campaign-local-unavailable',
    })
    expect(service.prepareHost).not.toHaveBeenCalled()
  })

  it('sérialise les snapshots live et ne publie une révision qu’après son application asynchrone', async () => {
    const pair = memoryPair()
    const sessionId = 'rtc:campaign:async-snapshots'
    const route = contexts(pair, sessionId)
    const initial = serverSnapshot(sessionId)
    const hostTransport = fakeAuthoritativeTransport(initial)
    const guestTransport = fakeAuthoritativeTransport(initial)
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(async () => hostTransport.transport),
      prepareGuest: vi.fn(async () => guestTransport.transport),
    })
    let releaseTwo = (): void => undefined
    let releaseThree = (): void => undefined
    const revisionTwo = new Promise<void>((resolve) => { releaseTwo = resolve })
    const revisionThree = new Promise<void>((resolve) => { releaseThree = resolve })
    const applications: number[] = []
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
      onSnapshot: (snapshot) => {
        applications.push(snapshot.revision)
        if (snapshot.revision === 2) return revisionTwo
        if (snapshot.revision === 3) return revisionThree
        if (snapshot.revision === 4) throw new Error('live-snapshot-apply-failed')
      },
    })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])
    await waitFor(() => applications.filter((revision) => revision === 1).length === 2)

    hostTransport.readHandlers()?.onSnapshot({ ...initial, revision: 2 })
    hostTransport.readHandlers()?.onSnapshot({ ...initial, revision: 3 })
    await waitFor(() => applications.includes(2))
    expect(applications).not.toContain(3)
    expect(host.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })

    releaseTwo()
    await waitFor(() => applications.includes(3))
    expect(host.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 2 } })

    releaseThree()
    await waitFor(() => {
      const current = host.getState()
      return current.status === 'connected' && current.snapshot.revision === 3
    })

    hostTransport.readHandlers()?.onSnapshot({ ...initial, revision: 4 })
    await waitFor(() => host.getState().status === 'failed')
    expect(host.getState()).toMatchObject({
      status: 'failed',
      error: expect.objectContaining({ message: 'live-snapshot-apply-failed' }),
    })
    expect(hostTransport.disconnect).toHaveBeenCalledOnce()

    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('ne retombe pas sur une autorité navigateur si le serveur configuré refuse la création', async () => {
    const pair = memoryPair()
    const route = contexts(pair, 'rtc:campaign:server-refusal')
    const serverFailure = new Error('server-session-refused')
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(async () => { throw serverFailure }),
      prepareGuest: vi.fn(async () => { throw new Error('guest-must-not-join') }),
    })
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })

    const results = await Promise.allSettled([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(results[0]).toEqual({ status: 'rejected', reason: serverFailure })
    expect(results[1]).toEqual(expect.objectContaining({ status: 'rejected' }))
    expect(service.prepareHost).toHaveBeenCalledOnce()
    expect(service.prepareGuest).not.toHaveBeenCalled()
    expect(host.getGateway()).toBeUndefined()
    expect(guest.getGateway()).toBeUndefined()
  })

  it('annule immédiatement une connexion serveur encore pendante et nettoie son transport', async () => {
    const pair = memoryPair()
    const sessionId = 'rtc:campaign:server-connect-abort'
    const route = contexts(pair, sessionId)
    const snapshot = serverSnapshot(sessionId)
    const hostTransport = fakeAuthoritativeTransport(snapshot)
    const guestDisconnect = vi.fn(async () => undefined)
    const guestConnect = vi.fn(() => new Promise<void>(() => undefined))
    const guestTransport: HgssCampaignClientTransport = Object.freeze({
      transportKind: 'authoritative-websocket',
      connect: guestConnect,
      requestSnapshot: async () => snapshot,
      send: async () => ({ appliedRevision: snapshot.revision, replayed: false, snapshot }),
      disconnect: guestDisconnect,
    })
    const service: HgssCampaignAuthoritativeService = Object.freeze({
      prepareHost: vi.fn(async () => hostTransport.transport),
      prepareGuest: vi.fn(async () => guestTransport),
    })
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authoritativeService: service,
      authorizeGuestJoin: () => ({ kind: 'accept' }),
    })

    const hostStart = host.port.start(route.host)
    const guestStart = guest.port.start(route.guest)
    await waitFor(() => guestConnect.mock.calls.length === 1)
    route.guestAbort.abort()

    await expect(guestStart).rejects.toMatchObject({ code: 'campaign-disconnected' })
    expect(guestDisconnect).toHaveBeenCalled()
    expect(guest.getGateway()).toBeUndefined()
    const hostHandle = await hostStart
    await hostHandle.close()
  })

  it('libère le consumer bootstrap même quand attach et les réponses sont synchrones', async () => {
    const pair = memoryPair(true)
    const host = coordinator(hostLocal)
    const guest = coordinator(guestLocal)
    const route = contexts(pair, 'rtc:campaign:synchronous-attach')

    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host),
      guest.port.start(route.guest),
    ])

    expect(host.getState().status).toBe('connected')
    expect(guest.getState().status).toBe('connected')
    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('bootstrappe deux joueurs compatibles et partage le snapshot autoritaire', async () => {
    const pair = memoryPair()
    const hostSnapshots: number[] = []
    const guestSnapshots: number[] = []
    const host = coordinator(hostLocal, hostSnapshots)
    const guest = coordinator(guestLocal, guestSnapshots)
    const route = contexts(pair)

    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host),
      guest.port.start(route.guest),
    ])

    expect(host.getState()).toMatchObject({
      status: 'connected', role: 'host', remoteParticipantId: 'bob',
      snapshot: { revision: 1, players: [{ playerId: 'alice' }, { playerId: 'bob' }] },
    })
    expect(guest.getState()).toMatchObject({
      status: 'connected', role: 'guest', remoteParticipantId: 'alice',
      snapshot: { revision: 1, players: [{ playerId: 'alice' }, { playerId: 'bob' }] },
    })
    expect(hostSnapshots).toContain(1)
    expect(guestSnapshots).toContain(1)

    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('réadmet une session sur des cartes différentes et conserve les deux positions attestées', async () => {
    const pair = memoryPair()
    const reconnectingGuest: HgssBrowserCampaignLocalPlayer = {
      ...guestLocal,
      player: {
        ...guestLocal.player,
        position: { ...guestLocal.player.position, mapId: 62, x: 3, z: 2 },
      },
    }
    const authorizeGuestJoin = vi.fn(() => ({ kind: 'accept' as const }))
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin,
    })
    const guest = coordinator(reconnectingGuest)
    const route = contexts(pair, 'rtc:campaign:inter-map-reconnect')

    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(authorizeGuestJoin).toHaveBeenCalledWith(expect.objectContaining({
      guest: expect.objectContaining({ player: expect.objectContaining({ position: { mapId: 62, x: 3, z: 2, direction: 'west' } }) }),
    }))
    for (const state of [host.getState(), guest.getState()]) {
      expect(state).toMatchObject({
        status: 'connected',
        snapshot: {
          players: [
            { playerId: 'alice', position: { mapId: 61, x: 8, z: 12 } },
            { playerId: 'bob', position: { mapId: 62, x: 3, z: 2 } },
          ],
        },
      })
    }
    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('arme l\'hôte seulement après application live du snapshot initial invité', async () => {
    const pair = memoryPair()
    const journal: string[] = []
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
      onSnapshot: () => { journal.push('host-applied') },
    })
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
      onSnapshot: () => { journal.push('guest-applied') },
    })
    host.subscribe((state) => { if (state.status === 'connected') journal.push('host-connected') })
    guest.subscribe((state) => { if (state.status === 'connected') journal.push('guest-connected') })
    const route = contexts(pair, 'rtc:campaign:applied-ready-order')

    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(journal.indexOf('guest-applied')).toBeGreaterThanOrEqual(0)
    expect(journal.indexOf('host-connected')).toBeGreaterThan(journal.indexOf('guest-applied'))
    expect(pair.guest.sent.filter(isCampaignReadyRequest)).toHaveLength(1)
    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('ne publie jamais connected si l\'application invitée du premier snapshot échoue', async () => {
    const pair = memoryPair()
    const hostStatuses: string[] = []
    const host = coordinator(hostLocal)
    const guest = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => guestLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin: () => ({ kind: 'accept' }),
      onSnapshot: () => { throw new Error('field-snapshot-apply-failed') },
    })
    host.subscribe(({ status }) => { hostStatuses.push(status) })
    const route = contexts(pair, 'rtc:campaign:apply-failure')

    const results = await Promise.allSettled([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(results.every(({ status }) => status === 'rejected')).toBe(true)
    expect(hostStatuses).not.toContain('connected')
    expect(pair.guest.sent.filter(isCampaignReadyRequest)).toHaveLength(0)
  })

  it.each([
    ['mauvaise session', (snapshot: Record<string, unknown>) => ({ ...snapshot, sessionId: 'rtc:campaign:other' })],
    ['mauvais participants', (snapshot: Record<string, unknown>) => ({
      ...snapshot,
      players: (snapshot.players as Array<Record<string, unknown>>).map((player, index) => ({
        ...player,
        playerId: index === 0 ? 'mallory' : 'trent',
      })),
    })],
    ['un seul participant', (snapshot: Record<string, unknown>) => ({
      ...snapshot,
      players: (snapshot.players as Array<Record<string, unknown>>).slice(0, 1),
    })],
  ] as const)('refuse le snapshot initial lié à une %s avant ready', async (_label, rewrite) => {
    const pair = memoryPair()
    pair.host.transformOutgoing = (message) => rewriteCampaignSnapshots(message, rewrite)
    const hostStatuses: string[] = []
    const host = coordinator(hostLocal)
    const guest = coordinator(guestLocal)
    host.subscribe(({ status }) => { hostStatuses.push(status) })
    const route = contexts(pair, `rtc:campaign:invalid-initial-${_label.replaceAll(' ', '-')}`)

    const results = await Promise.allSettled([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    expect(results.every(({ status }) => status === 'rejected')).toBe(true)
    expect(hostStatuses).not.toContain('connected')
    expect(pair.guest.sent.filter(isCampaignReadyRequest)).toHaveLength(0)
  })

  it('rejette immédiatement la gate hôte si le bridge ferme pendant l\'attente de ready', async () => {
    vi.useFakeTimers()
    try {
      const pair = memoryPair()
      pair.guest.dropOutgoing = isCampaignReadyRequest
      let guestApplied = false
      const host = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => hostLocal,
        movement: () => ({ kind: 'accept' }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
        bootstrapTimeoutMs: 1_000,
      })
      const guest = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => guestLocal,
        movement: () => ({ kind: 'accept' }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
        bootstrapTimeoutMs: 1_000,
        onSnapshot: () => { guestApplied = true },
      })
      const route = contexts(pair, 'rtc:campaign:bridge-close-before-ready')
      const hostStart = host.port.start(route.host)
      const guestStart = guest.port.start(route.guest)
      for (let turn = 0; turn < 20 && !guestApplied; turn += 1) await Promise.resolve()
      expect(guestApplied).toBe(true)

      pair.guest.close()

      await expect(hostStart).rejects.toMatchObject({ code: 'campaign-disconnected' })
      await expect(guestStart).rejects.toBeInstanceOf(Error)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('fait décider et diffuser un pas invité uniquement par l’autorité hôte', async () => {
    const pair = memoryPair()
    const host = coordinator(hostLocal)
    const guest = coordinator(guestLocal)
    const route = contexts(pair, 'rtc:campaign:movement')
    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host),
      guest.port.start(route.guest),
    ])
    const guestGateway = guest.getGateway()!

    await guestGateway.send({
      kind: 'movement',
      sequence: 1,
      from: guestLocal.player.position,
      to: { ...guestLocal.player.position, x: 10, direction: 'east' },
      mode: 'walk',
    })
    await waitFor(() => {
      const hostState = host.getState()
      const guestState = guest.getState()
      return hostState.status === 'connected'
        && hostState.snapshot.revision === 2
        && guestState.status === 'connected'
        && guestState.snapshot.revision === 2
    })

    for (const state of [host.getState(), guest.getState()]) {
      expect(state).toMatchObject({
        status: 'connected',
        snapshot: {
          revision: 2,
          players: [{ playerId: 'alice' }, {
            playerId: 'bob', movementSequence: 1,
            position: { mapId: 61, x: 10, z: 12, direction: 'east' },
          }],
        },
      })
    }

    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it('garde les variantes V2 réservées fermées sans terminer la session locale', async () => {
    const pair = memoryPair()
    const hostSnapshots: number[] = []
    const host = coordinator(hostLocal, hostSnapshots)
    const guest = coordinator(guestLocal)
    const route = contexts(pair, 'rtc:campaign:closed-domains')
    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host),
      guest.port.start(route.guest),
    ])

    await expect(guest.getGateway()!.send({
      kind: 'interaction',
      direction: 'west',
      target: { kind: 'coordinate', mapId: 61, x: 8, z: 12 },
    })).rejects.toMatchObject({ code: 'unsupported-command' })
    expect(host.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })
    expect(guest.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 1 } })
    expect(hostSnapshots).toEqual(expect.arrayContaining([1]))
    expect(hostSnapshots).not.toContain(2)

    await Promise.all([hostHandle.close(), guestHandle.close()])
  })

  it.each([
    ['game-mismatch', { ...guestLocal, gameCode: 'IPGF' }],
    ['position-occupied', {
      ...guestLocal,
      player: { ...guestLocal.player, position: { ...hostLocal.player.position } },
    }],
  ] as const)('refuse le bootstrap incompatible %s avant toute session', async (peerCode, local) => {
    const pair = memoryPair()
    const host = coordinator(hostLocal)
    const guest = coordinator(local)
    const route = contexts(pair, `rtc:campaign:${peerCode}`)

    const results = await Promise.allSettled([
      host.port.start(route.host),
      guest.port.start(route.guest),
    ])
    expect(results).toEqual([
      expect.objectContaining({ status: 'rejected' }),
      expect.objectContaining({ status: 'rejected' }),
    ])
    const failures = [host.getState(), guest.getState()]
    expect(failures.every(({ status }) => status === 'failed')).toBe(true)
    expect(failures.some((state) => state.status === 'failed'
      && state.error instanceof Error
      && 'peerCode' in state.error
      && state.error.peerCode === peerCode)).toBe(true)
  })

  it('applique la validation fiable de la case invitée côté hôte', async () => {
    const pair = memoryPair()
    const host = createHgssBrowserCampaignCoordinator({
      readLocalPlayer: () => hostLocal,
      movement: () => ({ kind: 'accept' }),
      authorizeGuestJoin: () => ({
        kind: 'reject', code: 'position-invalid', message: 'Case bloquée dans le monde hôte.',
      }),
    })
    const guest = coordinator(guestLocal)
    const route = contexts(pair, 'rtc:campaign:invalid-position')

    await expect(Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])).rejects.toMatchObject({ peerCode: 'position-invalid' })
    expect(host.getGateway()).toBeUndefined()
    expect(guest.getGateway()).toBeUndefined()
  })

  it('ferme proprement les deux côtés et rend la sortie idempotente', async () => {
    const pair = memoryPair()
    const host = coordinator(hostLocal)
    const guest = coordinator(guestLocal)
    const route = contexts(pair, 'rtc:campaign:leave')
    const [hostHandle, guestHandle] = await Promise.all([
      host.port.start(route.host), guest.port.start(route.guest),
    ])

    await guestHandle.close()
    await guestHandle.close()
    await waitFor(() => host.getState().status === 'idle' && guest.getState().status === 'idle')
    expect(host.getGateway()).toBeUndefined()
    expect(guest.getGateway()).toBeUndefined()
    expect(route.hostTerminated).toHaveBeenCalledOnce()
    expect(route.guestTerminated).toHaveBeenCalledOnce()
    await hostHandle.close()
    await host.close()
    expect(host.getState()).toEqual({ status: 'idle' })
  })

  it('rejette un binding hôte qui ne correspond pas à la route attestée', async () => {
    const pair = memoryPair()
    const host = coordinator(hostLocal)
    const route = contexts(pair, 'rtc:campaign:binding')
    const forgedRoute = {
      ...route.host,
      remoteParticipantId: 'mallory',
    } satisfies BrowserMultiplayerCampaignStartContext

    await expect(host.port.start(forgedRoute)).rejects.toMatchObject({ code: 'campaign-route-invalid' })
    expect(host.getState()).toEqual({ status: 'idle' })
  })

  it('borne le bootstrap quand le pair ne répond pas', async () => {
    vi.useFakeTimers()
    try {
      const pair = memoryPair()
      const host = createHgssBrowserCampaignCoordinator({
        readLocalPlayer: () => hostLocal,
        movement: () => ({ kind: 'accept' }),
        authorizeGuestJoin: () => ({ kind: 'accept' }),
        bootstrapTimeoutMs: 1_000,
      })
      const route = contexts(pair, 'rtc:campaign:timeout')
      const operation = host.port.start(route.host)
      const rejection = expect(operation).rejects.toMatchObject({ code: 'campaign-bootstrap-timeout' })
      await vi.advanceTimersByTimeAsync(1_000)
      await rejection
      expect(host.getState()).toMatchObject({ status: 'failed' })
    } finally {
      vi.useRealTimers()
    }
  })

  it('annule immédiatement un bootstrap quand le runtime quitte la session', async () => {
    const pair = memoryPair()
    const host = coordinator(hostLocal)
    const route = contexts(pair, 'rtc:campaign:abort')
    const operation = host.port.start(route.host)

    route.hostAbort.abort()

    await expect(operation).rejects.toMatchObject({ code: 'campaign-disconnected' })
    expect(host.getGateway()).toBeUndefined()
  })
})
