import { describe, expect, it, vi } from 'vitest'
import type {
  PeerDataChannel,
  PeerDataChannelBackpressure,
  PeerDataChannelHandlers,
  PeerDataChannelState,
} from './peerDataChannel'
import {
  consumeIssuedPeerDataChannelMultiplexerBinding,
  createPeerDataChannelMultiplexer,
  peerDataChannelMultiplexerProtocol,
  peerDataChannelMultiplexerProtocolVersion,
} from './peerDataChannelMultiplexer'

class MemoryChannel implements PeerDataChannel {
  private state: PeerDataChannelState = 'connecting'
  private handlers?: PeerDataChannelHandlers
  private backpressureListener?: Parameters<PeerDataChannelBackpressure['subscribe']>[0]
  peer?: MemoryChannel
  readonly sent: string[] = []

  readonly backpressure: PeerDataChannelBackpressure = Object.freeze({
    getState: () => Object.freeze({
      channelState: this.state,
      writable: this.state === 'open',
      bufferedAmountBytes: 0,
      availableBufferBytes: 1_024 * 1_024,
      lowThresholdBytes: 512 * 1_024,
      maximumBufferedBytes: 1_024 * 1_024,
    }),
    subscribe: (listener) => {
      if (this.backpressureListener) throw new Error('backpressure-already-attached')
      this.backpressureListener = listener
      listener(this.backpressure.getState())
      return () => { if (this.backpressureListener === listener) this.backpressureListener = undefined }
    },
  })

  getState = (): PeerDataChannelState => this.state

  attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (this.handlers) throw new Error('physical-already-attached')
    this.handlers = handlers
    if (this.state === 'open') queueMicrotask(handlers.onOpen)
    if (this.state === 'closed') queueMicrotask(handlers.onClose)
    return () => { if (this.handlers === handlers) this.handlers = undefined }
  }

  send = (message: string): void => {
    if (this.state !== 'open' || this.peer?.state !== 'open') throw new Error('physical-not-open')
    this.sent.push(message)
    const target = this.peer.handlers
    queueMicrotask(() => target?.onMessage(message))
  }

  close = (): void => {
    if (this.state === 'closed') return
    this.state = 'closed'
    this.backpressureListener?.(this.backpressure.getState())
    queueMicrotask(() => this.handlers?.onClose())
  }

  open(): void {
    this.state = 'open'
    this.backpressureListener?.(this.backpressure.getState())
    queueMicrotask(() => this.handlers?.onOpen())
  }

  inject(message: string): void { this.handlers?.onMessage(message) }
}

function pair(): readonly [MemoryChannel, MemoryChannel] {
  const left = new MemoryChannel()
  const right = new MemoryChannel()
  left.peer = right
  right.peer = left
  return [left, right]
}

function handlers() {
  return {
    onOpen: vi.fn(),
    onMessage: vi.fn(),
    onClose: vi.fn(),
    onError: vi.fn(),
  } satisfies PeerDataChannelHandlers
}

async function flush(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

describe('multiplexeur PeerDataChannel', () => {
  it('émet une preuve opaque et consommable une seule fois pour un canal déclaré', () => {
    const [physical] = pair()
    const mux = createPeerDataChannelMultiplexer(physical, { channelIds: ['campaign', 'trade'] })
    const binding = mux.issueChannelBinding('campaign')

    expect(binding).toEqual({ channel: mux.getChannel('campaign'), channelId: 'campaign' })
    expect(Object.isFrozen(binding)).toBe(true)
    expect(mux.issueChannelBinding('campaign')).toBe(binding)
    expect(consumeIssuedPeerDataChannelMultiplexerBinding({ ...binding }, 'campaign')).toBe(false)
    expect(consumeIssuedPeerDataChannelMultiplexerBinding(binding, 'trade')).toBe(false)
    expect(consumeIssuedPeerDataChannelMultiplexerBinding(binding, 'campaign')).toBe(true)
    expect(consumeIssuedPeerDataChannelMultiplexerBinding(binding, 'campaign')).toBe(false)
  })

  it('isole les protocoles campagne et échange sur le même canal physique', async () => {
    const [leftPhysical, rightPhysical] = pair()
    const left = createPeerDataChannelMultiplexer(leftPhysical, { channelIds: ['campaign', 'trade'] })
    const right = createPeerDataChannelMultiplexer(rightPhysical, { channelIds: ['campaign', 'trade'] })
    const leftCampaign = handlers()
    const leftTrade = handlers()
    const rightCampaign = handlers()
    const rightTrade = handlers()
    left.getChannel('campaign').attach(leftCampaign)
    left.getChannel('trade').attach(leftTrade)
    right.getChannel('campaign').attach(rightCampaign)
    right.getChannel('trade').attach(rightTrade)

    leftPhysical.open()
    rightPhysical.open()
    await flush()
    expect(leftCampaign.onOpen).toHaveBeenCalledOnce()
    expect(leftTrade.onOpen).toHaveBeenCalledOnce()

    left.getChannel('trade').send('{"offer":1}')
    right.getChannel('campaign').send('{"movement":2}')
    await flush()
    expect(rightTrade.onMessage).toHaveBeenCalledWith('{"offer":1}')
    expect(rightCampaign.onMessage).not.toHaveBeenCalled()
    expect(leftCampaign.onMessage).toHaveBeenCalledWith('{"movement":2}')
    expect(leftTrade.onMessage).not.toHaveBeenCalled()
  })

  it('borne et restitue les messages arrivés avant le branchement logique', async () => {
    const [leftPhysical, rightPhysical] = pair()
    const left = createPeerDataChannelMultiplexer(leftPhysical, { channelIds: ['trade'] })
    const right = createPeerDataChannelMultiplexer(rightPhysical, {
      channelIds: ['trade'],
      maximumPendingMessagesPerChannel: 2,
      maximumPendingBytesPerChannel: 32,
    })
    leftPhysical.open()
    rightPhysical.open()
    await flush()
    left.getChannel('trade').send('avant')
    await flush()
    const listener = handlers()
    right.getChannel('trade').attach(listener)
    expect(listener.onOpen).toHaveBeenCalledOnce()
    expect(listener.onMessage).toHaveBeenCalledWith('avant')
  })

  it('ferme une route sans tuer les autres et partage la backpressure', async () => {
    const [leftPhysical, rightPhysical] = pair()
    const left = createPeerDataChannelMultiplexer(leftPhysical, { channelIds: ['campaign', 'trade'] })
    const right = createPeerDataChannelMultiplexer(rightPhysical, { channelIds: ['campaign', 'trade'] })
    const rightTrade = handlers()
    const rightCampaign = handlers()
    right.getChannel('trade').attach(rightTrade)
    right.getChannel('campaign').attach(rightCampaign)
    leftPhysical.open()
    rightPhysical.open()
    await flush()

    const tradeStates = vi.fn()
    const campaignStates = vi.fn()
    left.getChannel('trade').backpressure!.subscribe(tradeStates)
    left.getChannel('campaign').backpressure!.subscribe(campaignStates)
    expect(tradeStates).toHaveBeenCalled()
    expect(campaignStates).toHaveBeenCalled()

    left.getChannel('trade').close()
    await flush()
    expect(rightTrade.onClose).toHaveBeenCalledOnce()
    expect(rightCampaign.onClose).not.toHaveBeenCalled()
    left.getChannel('campaign').send('encore-ouvert')
    await flush()
    expect(rightCampaign.onMessage).toHaveBeenCalledWith('encore-ouvert')
  })

  it('refuse une route inconnue ou une enveloppe permissive et termine le transport', () => {
    const [physical] = pair()
    const mux = createPeerDataChannelMultiplexer(physical, { channelIds: ['trade'] })
    const listener = handlers()
    mux.getChannel('trade').attach(listener)
    physical.open()

    expect(() => physical.inject(JSON.stringify({
      protocol: peerDataChannelMultiplexerProtocol,
      protocolVersion: peerDataChannelMultiplexerProtocolVersion,
      channel: 'campaign',
      kind: 'data',
      payload: 'x',
    }))).toThrowError(expect.objectContaining({ code: 'peer-channel-invalid-message' }))
    expect(physical.getState()).toBe('closed')
    expect(listener.onError).toHaveBeenCalledOnce()
  })

  it('valide les identifiants et conserve un consommateur unique par route', () => {
    const [physical] = pair()
    expect(() => createPeerDataChannelMultiplexer(physical, { channelIds: ['Trade'] })).toThrow(TypeError)
    expect(() => createPeerDataChannelMultiplexer(physical, { channelIds: ['trade', 'trade'] })).toThrow(TypeError)

    const mux = createPeerDataChannelMultiplexer(physical, { channelIds: ['trade'] })
    mux.getChannel('trade').attach(handlers())
    expect(() => mux.getChannel('trade').attach(handlers())).toThrowError(expect.objectContaining({
      code: 'peer-channel-already-attached',
    }))
    expect(() => mux.getChannel('absent')).toThrow(TypeError)
  })
})
