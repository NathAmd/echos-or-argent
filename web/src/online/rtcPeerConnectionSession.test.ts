import { describe, expect, it, vi } from 'vitest'
import type { OnlineSignalingClient, OnlineSignalingState } from './onlineSignalingClient'
import { isOnlineOpaqueId, type OnlineRealtimeEvent, type OnlineSignalPayload } from './onlineServiceProtocol'
import { measurePeerDataMessageBytes, type PeerDataChannelHandlers } from './peerDataChannel'
import {
  consumeIssuedRtcPeerConnectionLink,
  createRtcPeerConnectionNegotiationId,
  createRtcPeerConnectionSession,
  rtcPeerConnectionDefaultDataChannelLabel,
  rtcPeerConnectionDefaultDataChannelProtocol,
} from './rtcPeerConnectionSession'
import { createRtcSignalingCoordinator, type RtcSignalingRoute } from './rtcSignalingCoordinator'

function opaqueId(serial: number): string {
  return `${serial.toString(36).padStart(21, '0')}A`
}

function validSdp(session: number): string {
  return [
    'v=0', `o=- ${session} 0 IN IP4 127.0.0.1`, 's=-', 't=0 0',
    'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
    'a=ice-ufrag:test', 'a=ice-pwd:0123456789012345678901',
    'a=fingerprint:sha-256 00', '',
  ].join('\r\n')
}

function validCandidate(serial: number): string {
  return `candidate:${serial} 1 udp 2122260223 192.0.2.${serial} 54321 typ host`
}

class MemorySignalingClient implements OnlineSignalingClient {
  private readonly eventListeners = new Set<(event: OnlineRealtimeEvent) => void>()
  private readonly stateListeners = new Set<(state: OnlineSignalingState) => void>()
  private serial = 0
  private state: OnlineSignalingState
  readonly userId: string
  peer?: MemorySignalingClient
  beforeAcknowledgement?: (message: Readonly<{
    to: string
    negotiationId: string
    requestId: string
    payload: OnlineSignalPayload
  }>) => void
  failNextAcknowledgement = false
  readonly sent: Array<Readonly<{
    to: string
    negotiationId: string
    requestId: string
    payload: OnlineSignalPayload
  }>> = []

  constructor(userId: string) {
    this.userId = userId
    this.state = Object.freeze({ status: 'ready', userId })
  }

  getState = (): OnlineSignalingState => this.state

  sendSignal = (to: string, negotiationId: string, payload: OnlineSignalPayload, requestId?: string): string => {
    this.serial += 1
    const id = requestId ?? `rtc:${this.userId}:${this.serial}`
    const sentMessage = Object.freeze({ to, negotiationId, requestId: id, payload })
    this.sent.push(sentMessage)
    const peer = this.peer
    const rejectAcknowledgement = this.failNextAcknowledgement
    this.failNextAcknowledgement = false
    queueMicrotask(() => {
      if (peer?.userId === to) peer.emitSignal(this.userId, negotiationId, payload, id)
      this.beforeAcknowledgement?.(sentMessage)
      this.emit(rejectAcknowledgement
        ? Object.freeze({ type: 'error', code: 'ACK_REJECTED', message: 'ack rejected', requestId: id })
        : Object.freeze({ type: 'signal-accepted', requestId: id }))
    })
    return id
  }

  subscribe = (listener: (event: OnlineRealtimeEvent) => void): (() => void) => {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }

  subscribeState = (listener: (state: OnlineSignalingState) => void): (() => void) => {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => { this.stateListeners.delete(listener) }
  }

  close = (): void => {
    this.state = Object.freeze({ status: 'closed' })
    for (const listener of this.stateListeners) listener(this.state)
  }

  emitSignal(from: string, negotiationId: string, payload: OnlineSignalPayload, requestId = `in:${from}`): void {
    const event = Object.freeze({ type: 'signal', requestId, negotiationId, from, payload } as const)
    this.emit(event)
  }

  emit(event: OnlineRealtimeEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  listenerCount(): number { return this.eventListeners.size + this.stateListeners.size }
}

class FakeRtcDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  readonly maxPacketLifeTime: number | null = null
  readonly maxRetransmits: number | null = null
  readonly sent: string[] = []
  readonly label: string
  readonly protocol: string
  readonly ordered: boolean
  peer?: FakeRtcDataChannel

  constructor(label: string, protocol: string, ordered: boolean) {
    super()
    this.label = label
    this.protocol = protocol
    this.ordered = ordered
  }

  send(data: string): void {
    if (this.readyState !== 'open' || this.peer?.readyState !== 'open') throw new Error('fake-data-channel-not-open')
    this.sent.push(data)
    const peer = this.peer
    queueMicrotask(() => peer.dispatchEvent(new MessageEvent('message', { data })))
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
    this.peer?.closeFromPeer()
  }

  open(): void {
    if (this.readyState !== 'connecting') return
    this.readyState = 'open'
    this.dispatchEvent(new Event('open'))
  }

  private closeFromPeer(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }
}

type FakeRtcNetworkOptions = Readonly<{
  answerLabel?: string
  answerProtocol?: string
  answerOrdered?: boolean
}>

class FakeRtcNetwork {
  readonly offerer: FakeRtcPeerConnection
  readonly answerer: FakeRtcPeerConnection
  offerChannel?: FakeRtcDataChannel
  answerChannel?: FakeRtcDataChannel
  private deliveredChannel = false
  private openedChannels = false
  private readonly options: FakeRtcNetworkOptions

  constructor(options: FakeRtcNetworkOptions = {}) {
    this.options = options
    this.offerer = new FakeRtcPeerConnection(this)
    this.answerer = new FakeRtcPeerConnection(this)
  }

  createChannel(owner: FakeRtcPeerConnection, label: string, init?: RTCDataChannelInit): FakeRtcDataChannel {
    if (owner !== this.offerer || this.offerChannel) throw new Error('fake-unexpected-data-channel')
    const offer = new FakeRtcDataChannel(label, init?.protocol ?? '', init?.ordered ?? true)
    const answer = new FakeRtcDataChannel(
      this.options.answerLabel ?? label,
      this.options.answerProtocol ?? init?.protocol ?? '',
      this.options.answerOrdered ?? init?.ordered ?? true,
    )
    offer.peer = answer
    answer.peer = offer
    this.offerChannel = offer
    this.answerChannel = answer
    return offer
  }

  remoteDescriptionSet(connection: FakeRtcPeerConnection, type: RTCSdpType): void {
    if (connection === this.answerer && type === 'offer' && !this.deliveredChannel && this.answerChannel) {
      this.deliveredChannel = true
      const event = new Event('datachannel') as RTCDataChannelEvent
      Object.defineProperty(event, 'channel', { value: this.answerChannel })
      connection.dispatchEvent(event)
    }
    this.maybeOpen()
  }

  localDescriptionSet(): void { this.maybeOpen() }

  private maybeOpen(): void {
    if (this.openedChannels || !this.offerChannel || !this.answerChannel) return
    if (this.offerer.localDescription?.type !== 'offer' || this.offerer.remoteDescription?.type !== 'answer') return
    if (this.answerer.localDescription?.type !== 'answer' || this.answerer.remoteDescription?.type !== 'offer') return
    this.openedChannels = true
    this.offerer.connectionState = 'connected'
    this.answerer.connectionState = 'connected'
    this.offerer.dispatchEvent(new Event('connectionstatechange'))
    this.answerer.dispatchEvent(new Event('connectionstatechange'))
    this.offerChannel.open()
    this.answerChannel.open()
  }
}

class FakeRtcPeerConnection extends EventTarget {
  connectionState: RTCPeerConnectionState = 'new'
  localDescription: RTCSessionDescription | null = null
  remoteDescription: RTCSessionDescription | null = null
  readonly sctp = { maxMessageSize: 1_024 }
  readonly operations: string[] = []
  readonly addedIceCandidates: RTCIceCandidateInit[] = []
  closeCalls = 0
  private readonly network: FakeRtcNetwork

  constructor(network: FakeRtcNetwork) {
    super()
    this.network = network
  }

  createDataChannel(label: string, init?: RTCDataChannelInit): RTCDataChannel {
    return this.network.createChannel(this, label, init) as unknown as RTCDataChannel
  }

  async createOffer(): Promise<RTCSessionDescriptionInit> {
    this.operations.push('create-offer')
    return { type: 'offer', sdp: validSdp(1) }
  }

  async createAnswer(): Promise<RTCSessionDescriptionInit> {
    this.operations.push('create-answer')
    return { type: 'answer', sdp: validSdp(2) }
  }

  async setLocalDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.operations.push(`local:${description.type}`)
    this.localDescription = description as RTCSessionDescription
    this.network.localDescriptionSet()
  }

  async setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> {
    this.operations.push(`remote:${description.type}`)
    this.remoteDescription = description as RTCSessionDescription
    this.network.remoteDescriptionSet(this, description.type)
  }

  async addIceCandidate(candidate?: RTCIceCandidateInit | null): Promise<void> {
    if (!this.remoteDescription) throw new Error('fake-ice-before-remote-description')
    this.operations.push(`ice:${candidate?.candidate ?? 'end'}`)
    if (candidate) this.addedIceCandidates.push(candidate)
  }

  emitIceCandidate(candidate: string): void {
    const event = new Event('icecandidate') as RTCPeerConnectionIceEvent
    Object.defineProperty(event, 'candidate', {
      value: {
        candidate,
        sdpMid: '0',
        sdpMLineIndex: 0,
        usernameFragment: null,
      } satisfies Partial<RTCIceCandidate>,
    })
    this.dispatchEvent(event)
  }

  close(): void {
    this.closeCalls += 1
    this.connectionState = 'closed'
  }
}

function signalingPair(): Readonly<{ alice: MemorySignalingClient, bob: MemorySignalingClient }> {
  const alice = new MemorySignalingClient('alice')
  const bob = new MemorySignalingClient('bob')
  alice.peer = bob
  bob.peer = alice
  return { alice, bob }
}

function channelHandlers() {
  return {
    onOpen: vi.fn<() => void>(),
    onMessage: vi.fn<(message: string) => void>(),
    onClose: vi.fn<() => void>(),
    onError: vi.fn<(error: unknown) => void>(),
  } satisfies PeerDataChannelHandlers
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0))
}

async function waitForInvitation(
  coordinator: ReturnType<typeof createRtcSignalingCoordinator>,
) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const invitation = coordinator.getInvitations()[0]
    if (invitation) return invitation
    await flushMicrotasks()
  }
  throw new Error('fake-invitation-timeout')
}

describe('session RTCPeerConnection pair-à-pair', () => {
  it('génère un identifiant de négociation opaque conforme au protocole', () => {
    expect(isOnlineOpaqueId(createRtcPeerConnectionNegotiationId())).toBe(true)
  })

  it('refuse une route structurellement valide qui ne vient pas du coordinateur', () => {
    const descriptor = Object.freeze({ peerId: 'bob', negotiationId: 'rtc-forged-route' })
    const forgedRoute = Object.freeze({
      descriptor,
      role: 'offerer' as const,
      getState: () => Object.freeze({ status: 'ready' as const, userId: 'alice' }),
      send: async () => 'forged-request',
      subscribe: () => () => undefined,
      subscribeState: () => () => undefined,
      close: () => undefined,
    }) satisfies RtcSignalingRoute

    expect(() => createRtcPeerConnectionSession({ route: forgedRoute })).toThrow(
      'La route WebRTC doit être émise par le coordinateur',
    )
  })

  it("échoue proprement avec une raison présentable quand RTCPeerConnection est absent", async () => {
    const signaling = new MemorySignalingClient('alice')
    const coordinator = createRtcSignalingCoordinator({ signaling })
    const session = createRtcPeerConnectionSession({
      route: coordinator.createOutboundRoute('bob', opaqueId(9)),
    })
    vi.stubGlobal('RTCPeerConnection', undefined)
    try {
      await expect(session.connect()).rejects.toMatchObject({
        code: 'rtc-peer-connection-unavailable',
        message: "Le pair-à-pair WebRTC n'est pas disponible sur cet appareil.",
      })
      expect(session.getState()).toMatchObject({
        status: 'failed',
        error: { code: 'rtc-peer-connection-unavailable' },
      })
      expect(signaling.sent).toEqual([])
    } finally {
      vi.unstubAllGlobals()
      coordinator.close()
    }
  })

  it("récupère une offre arrivée avant l'answerer, vide ICE après le SDP et conserve l'identité avec le canal", async () => {
    const signaling = signalingPair()
    const aliceCoordinator = createRtcSignalingCoordinator({ signaling: signaling.alice })
    const bobCoordinator = createRtcSignalingCoordinator({ signaling: signaling.bob })
    const network = new FakeRtcNetwork()
    const negotiationId = opaqueId(10)
    const earlyCandidate = validCandidate(10)
    const outboundRoute = aliceCoordinator.createOutboundRoute('bob', negotiationId)
    const offerer = createRtcPeerConnectionSession({
      route: outboundRoute,
      peerConnectionFactory: () => network.offerer as unknown as RTCPeerConnection,
    })

    signaling.bob.emitSignal('mallory', negotiationId, { type: 'hangup' }, 'mallory-hangup')
    signaling.bob.emitSignal('alice', 'old-rtc-session', { type: 'hangup' }, 'alice-old-hangup')
    signaling.bob.emitSignal('alice', negotiationId, {
      type: 'ice', candidate: earlyCandidate, sdpMid: '0', sdpMLineIndex: 0,
    }, 'alice-early-ice')
    const offerLinkPromise = offerer.connect()
    const invitation = await waitForInvitation(bobCoordinator)
    const inboundRoute = bobCoordinator.claimInvitation(invitation)
    const answerer = createRtcPeerConnectionSession({
      route: inboundRoute,
      peerConnectionFactory: () => network.answerer as unknown as RTCPeerConnection,
    })
    const [offerLink, answerLink] = await Promise.all([offerLinkPromise, answerer.connect()])

    expect(network.answerer.operations.indexOf('remote:offer')).toBeLessThan(
      network.answerer.operations.indexOf(`ice:${earlyCandidate}`),
    )
    expect(network.answerer.addedIceCandidates).toEqual([{
      candidate: earlyCandidate, sdpMid: '0', sdpMLineIndex: 0,
    }])
    expect(offerer.getState().status).toBe('connected')
    expect(answerer.getState().status).toBe('connected')
    expect(network.offerChannel).toMatchObject({
      label: rtcPeerConnectionDefaultDataChannelLabel,
      protocol: rtcPeerConnectionDefaultDataChannelProtocol,
      ordered: true,
    })
    expect(offerLink).toMatchObject({ descriptor: { peerId: 'bob', negotiationId }, role: 'offerer' })
    expect(answerLink).toMatchObject({ descriptor: { peerId: 'alice', negotiationId }, role: 'answerer' })
    expect(offerLink.descriptor).toBe(outboundRoute.descriptor)
    expect(answerLink.descriptor).toBe(invitation.descriptor)
    expect(Object.isFrozen(offerLink)).toBe(true)
    expect(Object.isFrozen(answerLink.descriptor)).toBe(true)
    expect(consumeIssuedRtcPeerConnectionLink(Object.freeze({ ...offerLink }))).toBe(false)
    expect(consumeIssuedRtcPeerConnectionLink(offerLink)).toBe(true)
    expect(consumeIssuedRtcPeerConnectionLink(offerLink)).toBe(false)

    const offerHandlers = channelHandlers(), answerHandlers = channelHandlers()
    offerLink.channel.attach(offerHandlers)
    answerLink.channel.attach(answerHandlers)
    await flushMicrotasks()
    offerLink.channel.send('{"kind":"snapshot","revision":3}')
    await flushMicrotasks()

    expect(answerHandlers.onMessage).toHaveBeenCalledWith('{"kind":"snapshot","revision":3}')
    const largeSnapshot = JSON.stringify({ kind: 'snapshot', payload: 'x'.repeat(16 * 1_024) })
    offerLink.channel.send(largeSnapshot)
    await flushMicrotasks()
    expect(network.offerChannel!.sent.every((frame) => measurePeerDataMessageBytes(frame) <= 1_024)).toBe(true)
    expect(answerHandlers.onMessage).toHaveBeenCalledWith(largeSnapshot)
    expect([...signaling.alice.sent, ...signaling.bob.sent].map(({ payload }) => payload.type)).toEqual([
      'offer', 'answer',
    ])

    signaling.alice.failNextAcknowledgement = true
    network.offerer.emitIceCandidate(validCandidate(11))
    await flushMicrotasks()
    expect(offerer.getState().status).toBe('connected')
    expect(network.offerChannel?.readyState).toBe('open')

    offerer.close('détail local confidentiel')
    await flushMicrotasks()
    expect(offerHandlers.onClose).toHaveBeenCalledOnce()
    expect(answerHandlers.onClose).toHaveBeenCalledOnce()
    expect(answerer.getState().status).toBe('closed')
    expect(signaling.alice.sent.at(-1)?.payload).toEqual({ type: 'hangup' })
    await expect(offerer.connect()).rejects.toMatchObject({ code: 'rtc-session-closed' })
    aliceCoordinator.close()
    bobCoordinator.close()
  })

  it('rejette un DataChannel distant dont le protocole ne correspond pas', async () => {
    const signaling = signalingPair()
    const aliceCoordinator = createRtcSignalingCoordinator({ signaling: signaling.alice })
    const bobCoordinator = createRtcSignalingCoordinator({ signaling: signaling.bob })
    const network = new FakeRtcNetwork({ answerProtocol: 'protocole-intrus' })
    const outboundRoute = aliceCoordinator.createOutboundRoute('bob', opaqueId(20))
    const offerer = createRtcPeerConnectionSession({
      route: outboundRoute,
      peerConnectionFactory: () => network.offerer as unknown as RTCPeerConnection,
    })

    const offerResult = offerer.connect()
    const invitation = await waitForInvitation(bobCoordinator)
    const answerer = createRtcPeerConnectionSession({
      route: bobCoordinator.claimInvitation(invitation),
      peerConnectionFactory: () => network.answerer as unknown as RTCPeerConnection,
    })
    const results = await Promise.allSettled([offerResult, answerer.connect()])

    expect(results[1]).toMatchObject({ status: 'rejected', reason: { code: 'rtc-data-channel-invalid' } })
    expect(answerer.getState()).toMatchObject({ status: 'failed', error: { code: 'rtc-data-channel-invalid' } })
    expect(network.answerer.closeCalls).toBeGreaterThan(0)
    expect(signaling.bob.sent.some(({ payload }) => payload.type === 'hangup')).toBe(true)
    aliceCoordinator.close()
    bobCoordinator.close()
  })

  it("accepte une réponse revenue avant l'accusé serveur de son offre", async () => {
    const signaling = new MemorySignalingClient('alice')
    const coordinator = createRtcSignalingCoordinator({ signaling })
    const network = new FakeRtcNetwork()
    signaling.beforeAcknowledgement = ({ negotiationId, payload }) => {
      if (payload.type !== 'offer') return
      signaling.emitSignal('bob', negotiationId, { type: 'answer', sdp: validSdp(3) }, 'bob-fast-answer')
    }
    const session = createRtcPeerConnectionSession({
      route: coordinator.createOutboundRoute('bob', opaqueId(30)),
      peerConnectionFactory: () => network.offerer as unknown as RTCPeerConnection,
    })

    const connecting = session.connect()
    await flushMicrotasks()
    await flushMicrotasks()

    expect(network.offerer.remoteDescription?.type).toBe('answer')
    expect(session.getState().status).toBe('connecting')
    session.close()
    await expect(connecting).rejects.toMatchObject({ code: 'rtc-session-closed' })
    coordinator.close()
  })

  it('expire proprement une offre sans réponse et envoie un hangup borné', async () => {
    vi.useFakeTimers()
    try {
      const signaling = new MemorySignalingClient('alice')
      const coordinator = createRtcSignalingCoordinator({ signaling })
      const network = new FakeRtcNetwork()
      const session = createRtcPeerConnectionSession({
        route: coordinator.createOutboundRoute('bob', opaqueId(40)),
        connectTimeoutMs: 5,
        peerConnectionFactory: () => network.offerer as unknown as RTCPeerConnection,
      })

      const connecting = session.connect()
      const rejected = expect(connecting).rejects.toMatchObject({ code: 'rtc-session-timeout' })
      await vi.advanceTimersByTimeAsync(5)

      await rejected
      expect(session.getState()).toMatchObject({ status: 'failed', error: { code: 'rtc-session-timeout' } })
      expect(network.offerChannel?.readyState).toBe('closed')
      expect(network.offerer.closeCalls).toBeGreaterThan(0)
      expect(signaling.listenerCount()).toBe(2)
      expect(signaling.sent.map(({ payload }) => payload.type)).toEqual(['offer', 'hangup'])
      coordinator.close()
      expect(signaling.listenerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })
})
