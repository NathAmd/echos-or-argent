import { describe, expect, it, vi } from 'vitest'
import type {
  PeerDataChannel,
  PeerDataChannelBackpressure,
  PeerDataChannelHandlers,
  PeerDataChannelState,
} from '../../online/peerDataChannel'
import { createPeerDataChannelMultiplexer } from '../../online/peerDataChannelMultiplexer'
import type { RtcPeerConnectionLink } from '../../online/rtcPeerConnectionSession'
import { createHgssCampaignClientGateway } from './hgssCampaignClientGateway'
import {
  createHgssCampaignPeerGuestTransport,
  createHgssCampaignPeerHostBinding,
  createHgssCampaignPeerHostBridge,
  createHgssCampaignPeerLogicalHostBinding,
} from './hgssCampaignPeerBridge'
import { hgssCampaignProtocolVersion, type HgssCampaignClientCommand } from './hgssCampaignProtocol'
import { createHgssCampaignServerCore } from './hgssCampaignServerCore'

// Le registre de provenance réel est couvert par les tests de la session RTC.
// Ici, ce double garde l'unité du pont tout en reproduisant la consommation
// unique d'un lien effectivement émis par cette dépendance.
const rtcLinkProof = vi.hoisted(() => {
  const issued = new WeakSet<object>()
  const consumed = new WeakSet<object>()
  return {
    issue(value: object) { issued.add(value) },
    consume(value: unknown) {
      if (value === null || typeof value !== 'object' || !issued.has(value) || consumed.has(value)) return false
      consumed.add(value)
      return true
    },
  }
})

vi.mock('../../online/rtcPeerConnectionSession', () => ({
  consumeIssuedRtcPeerConnectionLink: rtcLinkProof.consume,
}))

const sessionId = 'campaign:peer'
const hostPosition = { mapId: 61, x: 8, z: 12, direction: 'south' as const }
const guestPosition = { mapId: 61, x: 9, z: 12, direction: 'west' as const }
const host = { playerId: 'player:host', displayName: 'ALICE', gender: 'female' as const, position: hostPosition, spriteId: 1 }
const guest = { playerId: 'player:guest', displayName: 'BOB', gender: 'male' as const, position: guestPosition, spriteId: 2 }

class MemoryPeerDataChannel implements PeerDataChannel {
  private state: PeerDataChannelState = 'connecting'
  private handlers?: PeerDataChannelHandlers
  private backpressureListener?: Parameters<PeerDataChannelBackpressure['subscribe']>[0]
  private writable = true
  peer?: MemoryPeerDataChannel
  dropOutgoing: (message: string) => boolean = () => false
  readonly sent: string[] = []

  readonly backpressure: PeerDataChannelBackpressure = Object.freeze({
    getState: () => Object.freeze({
      channelState: this.state,
      writable: this.state === 'open' && this.writable,
      bufferedAmountBytes: this.writable ? 0 : 768 * 1_024,
      availableBufferBytes: this.writable ? 1_024 * 1_024 : 256 * 1_024,
      lowThresholdBytes: 512 * 1_024,
      maximumBufferedBytes: 1_024 * 1_024,
    }),
    subscribe: (listener) => {
      if (this.backpressureListener) throw new Error('memory-backpressure-already-attached')
      this.backpressureListener = listener
      listener(this.backpressure.getState())
      return () => { if (this.backpressureListener === listener) this.backpressureListener = undefined }
    },
  })

  getState = (): PeerDataChannelState => this.state

  attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (this.handlers) throw new Error('memory-channel-already-attached')
    this.handlers = handlers
    if (this.state === 'open') queueMicrotask(() => { if (this.handlers === handlers) handlers.onOpen() })
    else if (this.state === 'closed') queueMicrotask(() => { if (this.handlers === handlers) handlers.onClose() })
    return () => { if (this.handlers === handlers) this.handlers = undefined }
  }

  send = (message: string): void => {
    const peer = this.peer
    if (this.state !== 'open' || !peer || peer.state !== 'open') throw new Error('memory-channel-not-open')
    this.sent.push(message)
    if (!this.dropOutgoing(message)) queueMicrotask(() => peer.handlers?.onMessage(message))
  }

  close = (): void => {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.notifyBackpressure()
    const peer = this.peer
    queueMicrotask(() => this.handlers?.onClose())
    if (peer && peer.state !== 'closed') {
      peer.state = 'closed'
      peer.notifyBackpressure()
      queueMicrotask(() => peer.handlers?.onClose())
    }
  }

  open(): void {
    if (this.state !== 'connecting') return
    this.state = 'open'
    this.notifyBackpressure()
    queueMicrotask(() => this.handlers?.onOpen())
  }

  setWritable(writable: boolean): void {
    this.writable = writable
    this.notifyBackpressure()
  }

  deliver(message: string): void {
    if (this.state !== 'open') throw new Error('memory-channel-not-open')
    queueMicrotask(() => this.handlers?.onMessage(message))
  }

  private notifyBackpressure(): void {
    this.backpressureListener?.(this.backpressure.getState())
  }
}

function memoryPair() {
  const hostChannel = new MemoryPeerDataChannel()
  const guestChannel = new MemoryPeerDataChannel()
  hostChannel.peer = guestChannel
  guestChannel.peer = hostChannel
  return {
    hostChannel,
    guestChannel,
    open() { hostChannel.open(); guestChannel.open() },
  }
}

let linkSerial = 0

function bindGuest(channel: PeerDataChannel) {
  linkSerial += 1
  const link: RtcPeerConnectionLink = Object.freeze({
    channel,
    descriptor: Object.freeze({
      peerId: 'bob',
      negotiationId: `rtc:campaign:${linkSerial}`,
    }),
    role: 'offerer',
  })
  rtcLinkProof.issue(link)
  return createHgssCampaignPeerHostBinding({
    link,
    sessionId,
    playerId: guest.playerId,
  })
}

function joinedAuthority() {
  const authority = createHgssCampaignServerCore({ ports: { movement: () => ({ kind: 'accept' }) } })
  const created = authority.createSession({ sessionId, host })
  if (!created.ok) throw new Error(created.error.message)
  const joined = authority.joinSession(sessionId, guest)
  if (!joined.ok) throw new Error(joined.error.message)
  return authority
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate()) return
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error('La condition pair-à-pair ne s’est pas stabilisée.')
}

async function flushPeerMessages(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function hostMovement(
  commandId: string,
  expectedRevision: number,
  sequence: number,
  from: typeof hostPosition,
  to: typeof hostPosition,
): HgssCampaignClientCommand {
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    commandId,
    expectedRevision,
    kind: 'movement',
    sequence,
    from,
    to,
    mode: 'walk',
  }
}

describe('pont de campagne pair-à-pair', () => {
  it('ne confirme ready qu\'après la requête explicite et l\'envoi effectif de son ACK', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    const onGuestReady = vi.fn()
    const bridge = createHgssCampaignPeerHostBridge({ binding, authority, onGuestReady })
    const transport = createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel })
    const connecting = transport.connect({ onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() })
    pair.open()
    await connecting

    await transport.requestSnapshot()
    expect(onGuestReady).not.toHaveBeenCalled()

    pair.hostChannel.setWritable(false)
    const ready = transport.confirmReady!()
    await flushPeerMessages()
    expect(onGuestReady).not.toHaveBeenCalled()

    pair.hostChannel.setWritable(true)
    await ready
    expect(onGuestReady).toHaveBeenCalledOnce()
    await transport.confirmReady!()
    expect(onGuestReady).toHaveBeenCalledOnce()
    bridge.close()
  })

  it('refuse ready avant toute réponse snapshot autoritaire', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    const onGuestReady = vi.fn()
    const bridge = createHgssCampaignPeerHostBridge({ binding, authority, onGuestReady })
    const transport = createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel })
    const connecting = transport.connect({ onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() })
    pair.open()
    await connecting

    await expect(transport.confirmReady!()).rejects.toMatchObject({
      code: 'ready-before-snapshot',
      remote: true,
    })
    expect(onGuestReady).not.toHaveBeenCalled()

    await transport.requestSnapshot()
    await transport.confirmReady!()
    expect(onGuestReady).toHaveBeenCalledOnce()
    bridge.close()
  })

  it('exécute les commandes invitées dans l’autorité du navigateur hôte', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    createHgssCampaignPeerHostBridge({ binding, authority })
    const gateway = createHgssCampaignClientGateway({
      transport: createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel }),
      localParticipantId: guest.playerId,
      commandIdFactory: (serial) => `guest:command:${serial}`,
    })
    const connecting = gateway.connect()
    pair.open()
    await connecting
    expect(pair.hostChannel.sent.filter((message) => (JSON.parse(message) as { kind?: string }).kind === 'snapshot')).toHaveLength(1)

    const destination = { ...guestPosition, x: 10, direction: 'east' as const }
    await gateway.send({ kind: 'movement', sequence: 1, from: guestPosition, to: destination, mode: 'walk' })
    await waitFor(() => gateway.getState().snapshot?.revision === 2)

    expect(authority.getSnapshot(sessionId)).toMatchObject({
      revision: 2,
      players: [{ playerId: host.playerId }, { playerId: guest.playerId, position: destination, movementSequence: 1 }],
    })
    expect(gateway.getState().snapshot).toEqual(authority.getSnapshot(sessionId))
  })

  it('coalesce les snapshots pendant la backpressure puis envoie seulement la dernière révision', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    const hostBridge = createHgssCampaignPeerHostBridge({ binding, authority })
    const transport = createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel })
    const handlers = { onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
    const connecting = transport.connect(handlers)
    pair.open()
    await connecting
    await flushPeerMessages()
    const baselineMessages = pair.hostChannel.sent.length
    expect(baselineMessages).toBeGreaterThanOrEqual(1)
    const baselineSnapshots = pair.hostChannel.sent.filter((message) => (
      JSON.parse(message) as { kind?: string }
    ).kind === 'snapshot').length

    pair.hostChannel.setWritable(false)
    const first = { ...hostPosition, z: 13, direction: 'south' as const }
    const second = { ...first, z: 14 }
    const third = { ...second, z: 15 }
    expect(authority.submitCommand(sessionId, host.playerId, hostMovement('host:burst:1', 1, 1, hostPosition, first))).toMatchObject({ ok: true })
    expect(authority.submitCommand(sessionId, host.playerId, hostMovement('host:burst:2', 2, 2, first, second))).toMatchObject({ ok: true })
    expect(authority.submitCommand(sessionId, host.playerId, hostMovement('host:burst:3', 3, 3, second, third))).toMatchObject({ ok: true })
    await flushPeerMessages()
    expect(pair.hostChannel.sent).toHaveLength(baselineMessages)

    pair.hostChannel.setWritable(true)
    await flushPeerMessages()
    const snapshots = pair.hostChannel.sent
      .map((message) => JSON.parse(message) as { kind?: string, snapshot?: { revision?: number } })
      .filter(({ kind }) => kind === 'snapshot')
    expect(snapshots).toHaveLength(baselineSnapshots + 1)
    expect(snapshots.at(-1)?.snapshot?.revision).toBe(4)
    expect(pair.hostChannel.getState()).toBe('open')
    expect(handlers.onError).not.toHaveBeenCalled()
    hostBridge.close()
  })

  it('priorise la réponse de commande avant le snapshot retenu à la reprise', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    const hostBridge = createHgssCampaignPeerHostBridge({ binding, authority })
    const gateway = createHgssCampaignClientGateway({
      transport: createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel }),
      localParticipantId: guest.playerId,
      commandIdFactory: (serial) => `backpressure:command:${serial}`,
    })
    const connecting = gateway.connect()
    pair.open()
    await connecting
    await flushPeerMessages()
    const baselineMessages = pair.hostChannel.sent.length
    expect(baselineMessages).toBeGreaterThanOrEqual(1)

    pair.hostChannel.setWritable(false)
    const destination = { ...guestPosition, x: 10, direction: 'east' as const }
    const sending = gateway.send({ kind: 'movement', sequence: 1, from: guestPosition, to: destination, mode: 'walk' })
    await flushPeerMessages()
    expect(pair.hostChannel.sent).toHaveLength(baselineMessages)

    pair.hostChannel.setWritable(true)
    await sending
    await flushPeerMessages()
    expect(pair.hostChannel.sent.slice(baselineMessages).map((message) => (
      JSON.parse(message) as { kind?: string }
    ).kind)).toEqual(['response', 'snapshot'])
    expect(gateway.getState().snapshot?.revision).toBe(2)
    hostBridge.close()
  })

  it('récupère par requête un snapshot manqué après un trou de diffusion', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    pair.hostChannel.dropOutgoing = (message) => {
      const frame = JSON.parse(message) as { kind?: string, snapshot?: { revision?: number } }
      return frame.kind === 'snapshot' && frame.snapshot?.revision === 2
    }
    const binding = bindGuest(pair.hostChannel)
    createHgssCampaignPeerHostBridge({ binding, authority })
    const gateway = createHgssCampaignClientGateway({
      transport: createHgssCampaignPeerGuestTransport({ channel: pair.guestChannel }),
      localParticipantId: guest.playerId,
    })
    const statuses: string[] = []
    gateway.subscribe((state) => { statuses.push(state.status) })
    const connecting = gateway.connect()
    pair.open()
    await connecting

    const first = { ...hostPosition, z: 13, direction: 'south' as const }
    const second = { ...first, z: 14 }
    expect(authority.submitCommand(sessionId, host.playerId, hostMovement('host:move:1', 1, 1, hostPosition, first))).toMatchObject({ ok: true })
    expect(authority.submitCommand(sessionId, host.playerId, hostMovement('host:move:2', 2, 2, first, second))).toMatchObject({ ok: true })
    await waitFor(() => gateway.getState().snapshot?.revision === 3)

    expect(statuses).toContain('resyncing')
    expect(gateway.getState()).toMatchObject({ status: 'connected', snapshot: { revision: 3 } })
    expect(gateway.getState().snapshot).toEqual(authority.getSnapshot(sessionId))
  })

  it('expire les requêtes sans fuite puis nettoie les deux extrémités', async () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)
    const hostBridge = createHgssCampaignPeerHostBridge({ binding, authority })
    const transport = createHgssCampaignPeerGuestTransport({
      channel: pair.guestChannel,
      requestTimeoutMs: 5,
      maximumPendingRequests: 1,
    })
    const handlers = { onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
    const connecting = transport.connect(handlers)
    pair.open()
    await connecting
    await transport.requestSnapshot()
    pair.hostChannel.dropOutgoing = (message) => (JSON.parse(message) as { kind?: string }).kind === 'response'

    await expect(transport.requestSnapshot()).rejects.toMatchObject({ code: 'peer-request-timeout' })
    await expect(transport.requestSnapshot()).rejects.toMatchObject({ code: 'peer-request-timeout' })
    await transport.disconnect()
    await waitFor(hostBridge.isClosed)
    const sentAfterCleanup = pair.hostChannel.sent.length
    expect(authority.submitCommand(
      sessionId,
      host.playerId,
      hostMovement('host:cleanup', 1, 1, hostPosition, { ...hostPosition, z: 13, direction: 'south' }),
    )).toMatchObject({ ok: true })
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(hostBridge.isClosed()).toBe(true)
    expect(pair.hostChannel.sent).toHaveLength(sentAfterCleanup)
    expect(handlers.onError).not.toHaveBeenCalled()
  })

  it('tolère comme Safari une réponse snapshot livrée après le timeout puis reste utilisable', async () => {
    vi.useFakeTimers()
    try {
      const authority = joinedAuthority()
      const pair = memoryPair()
      const binding = bindGuest(pair.hostChannel)
      createHgssCampaignPeerHostBridge({ binding, authority })
      let delayedResponse: string | undefined
      pair.hostChannel.dropOutgoing = (message) => {
        const frame = JSON.parse(message) as { kind?: string }
        if (frame.kind !== 'response' || delayedResponse) return false
        delayedResponse = message
        return true
      }
      const transport = createHgssCampaignPeerGuestTransport({
        channel: pair.guestChannel,
        requestTimeoutMs: 5,
        requestIdFactory: (serial) => `safari:request:${serial}`,
      })
      const handlers = { onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
      const connecting = transport.connect(handlers)
      pair.open()
      await connecting

      const firstRequest = transport.requestSnapshot()
      await flushPeerMessages()
      expect(delayedResponse).toBeTypeOf('string')
      const timeoutAssertion = expect(firstRequest).rejects.toMatchObject({
        code: 'peer-request-timeout', requestId: 'safari:request:1',
      })
      await vi.advanceTimersByTimeAsync(5)
      await timeoutAssertion

      pair.guestChannel.deliver(delayedResponse!)
      await flushPeerMessages()
      expect(handlers.onError).not.toHaveBeenCalled()
      expect(pair.guestChannel.getState()).toBe('open')

      await expect(transport.requestSnapshot()).resolves.toMatchObject({
        sessionId,
        players: expect.arrayContaining([expect.objectContaining({ playerId: guest.playerId })]),
      })
      expect(handlers.onError).not.toHaveBeenCalled()
      await transport.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('reste fatal si une réponse tardive réutilise le requestId avec une autre opération', async () => {
    vi.useFakeTimers()
    try {
      const authority = joinedAuthority()
      const pair = memoryPair()
      const binding = bindGuest(pair.hostChannel)
      createHgssCampaignPeerHostBridge({ binding, authority })
      let delayedResponse: string | undefined
      pair.hostChannel.dropOutgoing = (message) => {
        if ((JSON.parse(message) as { kind?: string }).kind !== 'response') return false
        delayedResponse = message
        return true
      }
      const transport = createHgssCampaignPeerGuestTransport({
        channel: pair.guestChannel,
        requestTimeoutMs: 5,
        requestIdFactory: () => 'late:mismatched-operation',
      })
      const handlers = { onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
      const connecting = transport.connect(handlers)
      pair.open()
      await connecting

      const request = transport.requestSnapshot()
      await flushPeerMessages()
      const timeoutAssertion = expect(request).rejects.toMatchObject({ code: 'peer-request-timeout' })
      await vi.advanceTimersByTimeAsync(5)
      await timeoutAssertion
      const decoded = JSON.parse(delayedResponse!) as Record<string, unknown>
      pair.guestChannel.deliver(JSON.stringify({
        protocol: decoded.protocol,
        protocolVersion: decoded.protocolVersion,
        kind: 'response',
        requestId: decoded.requestId,
        operation: 'command',
        ok: true,
      }))
      await flushPeerMessages()

      expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'peer-protocol-error' }))
      expect(pair.guestChannel.getState()).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('borne les tombstones et redevient fatal pour une réponse évincée donc inconnue', async () => {
    vi.useFakeTimers()
    try {
      const authority = joinedAuthority()
      const pair = memoryPair()
      const binding = bindGuest(pair.hostChannel)
      createHgssCampaignPeerHostBridge({ binding, authority })
      const delayedResponses: string[] = []
      pair.hostChannel.dropOutgoing = (message) => {
        if ((JSON.parse(message) as { kind?: string }).kind !== 'response') return false
        delayedResponses.push(message)
        return true
      }
      expect(() => createHgssCampaignPeerGuestTransport({
        channel: pair.guestChannel,
        maximumTimedOutRequestTombstones: 0,
      })).toThrowError(/réponses tardives/)
      const transport = createHgssCampaignPeerGuestTransport({
        channel: pair.guestChannel,
        requestTimeoutMs: 1,
        maximumTimedOutRequestTombstones: 2,
        requestIdFactory: (serial) => `bounded:timeout:${serial}`,
      })
      const handlers = { onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn() }
      const connecting = transport.connect(handlers)
      pair.open()
      await connecting

      for (let serial = 1; serial <= 3; serial += 1) {
        const request = transport.requestSnapshot()
        await flushPeerMessages()
        const timeoutAssertion = expect(request).rejects.toMatchObject({
          code: 'peer-request-timeout', requestId: `bounded:timeout:${serial}`,
        })
        await vi.advanceTimersByTimeAsync(1)
        await timeoutAssertion
      }
      expect(delayedResponses).toHaveLength(3)

      pair.guestChannel.deliver(delayedResponses[0]!)
      await flushPeerMessages()
      expect(handlers.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'peer-protocol-error' }))
      expect(pair.guestChannel.getState()).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('fige ensemble le pair authentifié, la négociation, la session et le joueur autorisé', () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const binding = bindGuest(pair.hostChannel)

    expect(binding).toEqual({
      channel: pair.hostChannel,
      peerId: 'bob',
      negotiationId: expect.stringMatching(/^rtc:campaign:/),
      sessionId,
      playerId: guest.playerId,
    })
    expect(Object.isFrozen(binding)).toBe(true)
    expect(() => createHgssCampaignPeerHostBridge({
      authority,
      binding: { ...binding },
    })).toThrowError(/association de pair/)
    expect(() => createHgssCampaignPeerHostBinding({
      link: Object.freeze({
        channel: pair.hostChannel,
        descriptor: Object.freeze({ peerId: 'bob', negotiationId: 'rtc:forged' }),
        role: 'answerer',
      }),
      sessionId,
      playerId: guest.playerId,
    })).toThrowError(/émis par une session RTC/)
    expect(() => createHgssCampaignPeerHostBinding({
      link: Object.freeze({
        channel: pair.hostChannel,
        descriptor: Object.freeze({ peerId: 'bob', negotiationId: 'rtc:other' }),
        role: 'answerer',
      }),
      sessionId,
      playerId: 'identifiant invalide',
    })).toThrowError(/joueur/)

    const bridge = createHgssCampaignPeerHostBridge({ authority, binding })
    expect(() => createHgssCampaignPeerHostBridge({ authority, binding })).toThrowError(/association de pair/)
    bridge.close()
  })

  it('émet un binding logique immuable et à usage unique sans reconsommer le lien physique', () => {
    const authority = joinedAuthority()
    const pair = memoryPair()
    const mux = createPeerDataChannelMultiplexer(pair.hostChannel, { channelIds: ['campaign'] })
    const channel = mux.getChannel('campaign')
    const binding = createHgssCampaignPeerLogicalHostBinding({
      route: mux.issueChannelBinding('campaign'),
      peerId: 'bob',
      negotiationId: 'rtc:campaign:logical',
      sessionId,
      playerId: guest.playerId,
    })

    expect(binding).toEqual({
      channel,
      peerId: 'bob',
      negotiationId: 'rtc:campaign:logical',
      sessionId,
      playerId: guest.playerId,
    })
    expect(Object.isFrozen(binding)).toBe(true)
    expect(() => createHgssCampaignPeerHostBridge({ authority, binding: { ...binding } }))
      .toThrowError(/association de pair/)

    const bridge = createHgssCampaignPeerHostBridge({ authority, binding })
    expect(() => createHgssCampaignPeerHostBridge({ authority, binding })).toThrowError(/association de pair/)
    bridge.close()
  })

  it('rejette les routes logiques non authentifiables avant émission du binding', () => {
    const pair = memoryPair()
    const mux = createPeerDataChannelMultiplexer(pair.hostChannel, { channelIds: ['campaign', 'trade'] })
    const route = mux.issueChannelBinding('campaign')
    const valid = {
      route,
      peerId: 'bob',
      negotiationId: 'rtc:campaign:logical',
      sessionId,
      playerId: guest.playerId,
    }
    expect(() => createHgssCampaignPeerLogicalHostBinding({ ...valid, peerId: 'bob interdit' }))
      .toThrowError(/pair/)
    expect(() => createHgssCampaignPeerLogicalHostBinding({ ...valid, negotiationId: 'rtc interdit!' }))
      .toThrowError(/négociation/)
    expect(() => createHgssCampaignPeerLogicalHostBinding({
      ...valid,
      route: { ...route },
    })).toThrowError(/multiplexeur/)
    expect(() => createHgssCampaignPeerLogicalHostBinding({
      ...valid,
      route: mux.issueChannelBinding('trade'),
    })).toThrowError(/multiplexeur/)
  })
})
