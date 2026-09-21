import { describe, expect, it, vi } from 'vitest'
import {
  measurePeerDataMessageBytes,
  PeerDataChannelError,
  peerDataChannelDefaultMaximumFrameBytes,
  type PeerDataChannelHandlers,
} from './peerDataChannel'
import { createRtcPeerDataChannelAdapter } from './rtcDataChannelAdapter'

class FakeRtcDataChannel extends EventTarget {
  readyState: RTCDataChannelState = 'connecting'
  bufferedAmount = 0
  bufferedAmountLowThreshold = 0
  readonly sent: string[] = []

  open(): void {
    this.readyState = 'open'
    this.dispatchEvent(new Event('open'))
  }

  receive(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }))
  }

  send(data: string): void { this.sent.push(data) }

  setBufferedAmount(value: number): void {
    const previous = this.bufferedAmount
    this.bufferedAmount = value
    if (previous > this.bufferedAmountLowThreshold && value <= this.bufferedAmountLowThreshold) {
      this.dispatchEvent(new Event('bufferedamountlow'))
    }
  }

  close(): void {
    if (this.readyState === 'closed') return
    this.readyState = 'closed'
    this.dispatchEvent(new Event('close'))
  }
}

function handlers() {
  return {
    onOpen: vi.fn<() => void>(),
    onMessage: vi.fn<(message: string) => void>(),
    onClose: vi.fn<() => void>(),
    onError: vi.fn<(error: unknown) => void>(),
  } satisfies PeerDataChannelHandlers
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve()
  await Promise.resolve()
}

function deliverFrames(sender: FakeRtcDataChannel, receiver: FakeRtcDataChannel, from = 0): number {
  for (let index = from; index < sender.sent.length; index += 1) receiver.receive(sender.sent[index])
  return sender.sent.length
}

describe('adaptateur RTCDataChannel pair-à-pair', () => {
  it('expose une backpressure bornée et reprend sur bufferedamountlow', () => {
    const rtc = new FakeRtcDataChannel()
    const channel = createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel, {
      maximumBufferedBytes: 1_024,
      bufferedAmountLowThresholdBytes: 256,
    })
    const backpressure = channel.backpressure
    if (!backpressure) throw new Error('backpressure absente')
    const states: ReturnType<typeof backpressure.getState>[] = []
    const unsubscribe = backpressure.subscribe((state) => { states.push(state) })

    expect(rtc.bufferedAmountLowThreshold).toBe(256)
    expect(states).toEqual([expect.objectContaining({
      channelState: 'connecting',
      writable: false,
      bufferedAmountBytes: 0,
      availableBufferBytes: 1_024,
      lowThresholdBytes: 256,
      maximumBufferedBytes: 1_024,
    })])

    rtc.open()
    expect(states.at(-1)).toEqual(expect.objectContaining({ channelState: 'open', writable: true }))

    // RTCDataChannel ne possède pas d'événement « high » : l'adaptateur observe
    // la hausse juste après son propre envoi.
    rtc.setBufferedAmount(512)
    channel.send('charge')
    expect(states.at(-1)).toEqual(expect.objectContaining({
      channelState: 'open',
      writable: false,
      bufferedAmountBytes: 512,
      availableBufferBytes: 512,
    }))

    rtc.setBufferedAmount(256)
    expect(states.at(-1)).toEqual(expect.objectContaining({
      channelState: 'open',
      writable: true,
      bufferedAmountBytes: 256,
    }))
    const notificationsBeforeDuplicate = states.length
    rtc.dispatchEvent(new Event('bufferedamountlow'))
    expect(states).toHaveLength(notificationsBeforeDuplicate)

    unsubscribe()
    rtc.setBufferedAmount(512)
    channel.send('après-détachement')
    rtc.setBufferedAmount(0)
    expect(states).toHaveLength(notificationsBeforeDuplicate)
  })

  it('limite l’observateur de backpressure et le nettoie à la fermeture', () => {
    const rtc = new FakeRtcDataChannel()
    const channel = createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel)
    const backpressure = channel.backpressure
    if (!backpressure) throw new Error('backpressure absente')
    const states: ReturnType<typeof backpressure.getState>[] = []
    const unsubscribe = backpressure.subscribe((state) => { states.push(state) })

    expect(() => backpressure.subscribe(() => undefined)).toThrowError(expect.objectContaining({
      code: 'peer-channel-already-attached',
    }))
    rtc.open()
    rtc.close()
    expect(states.at(-1)).toEqual(expect.objectContaining({ channelState: 'closed', writable: false }))
    const notificationsAfterClose = states.length
    rtc.dispatchEvent(new Event('bufferedamountlow'))
    expect(states).toHaveLength(notificationsAfterClose)
    expect(() => unsubscribe()).not.toThrow()

    const terminalStates: ReturnType<typeof backpressure.getState>[] = []
    expect(() => backpressure.subscribe((state) => { terminalStates.push(state) })).not.toThrow()
    expect(terminalStates).toEqual([expect.objectContaining({ channelState: 'closed', writable: false })])
    expect(() => backpressure.subscribe(() => undefined)).not.toThrow()
  })

  it('valide strictement le seuil bas sans modifier les limites d’envoi', () => {
    const rtc = new FakeRtcDataChannel()
    expect(() => createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel, {
      maximumBufferedBytes: 1_024,
      bufferedAmountLowThresholdBytes: -1,
    })).toThrow(RangeError)
    expect(() => createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel, {
      maximumBufferedBytes: 1_024,
      bufferedAmountLowThresholdBytes: 1_024,
    })).toThrow(RangeError)
  })

  it('borne les envois, le tampon et l’attachement au consommateur unique', async () => {
    const rtc = new FakeRtcDataChannel()
    const channel = createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel, {
      maximumMessageBytes: 8,
      maximumBufferedBytes: 1_024,
    })
    const listener = handlers()
    const detach = channel.attach(listener)

    expect(() => channel.attach(handlers())).toThrowError(expect.objectContaining({
      code: 'peer-channel-already-attached',
    }))
    rtc.open()
    await flushMicrotasks()
    expect(listener.onOpen).toHaveBeenCalledOnce()
    channel.send('évoli')
    expect(rtc.sent).toHaveLength(1)
    expect(rtc.sent[0]).not.toBe('évoli')
    expect(() => channel.send('message trop long')).toThrowError(expect.objectContaining({
      code: 'peer-channel-message-too-large',
    }))
    rtc.bufferedAmount = 1_010
    expect(() => channel.send('a')).toThrowError(expect.objectContaining({
      code: 'peer-channel-buffer-limit',
    }))

    detach()
    expect(() => channel.attach(handlers())).not.toThrow()
  })

  it('ferme le canal sur une charge binaire, brute ou applicative hors limite', async () => {
    const payloads: unknown[] = [new Uint8Array([1]), 'texte-brut-sans-enveloppe']
    for (const payload of payloads) {
      const rtc = new FakeRtcDataChannel()
      const channel = createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel)
      const listener = handlers()
      channel.attach(listener)
      rtc.open()
      await flushMicrotasks()
      rtc.receive(payload)

      expect(listener.onError).toHaveBeenCalledWith(expect.any(PeerDataChannelError))
      expect(listener.onClose).toHaveBeenCalledOnce()
      expect(channel.getState()).toBe('closed')
    }

    const senderRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel)
    senderRtc.open()
    sender.send('123456789')
    const receiverRtc = new FakeRtcDataChannel()
    const receiver = createRtcPeerDataChannelAdapter(receiverRtc as unknown as RTCDataChannel, {
      maximumMessageBytes: 8,
    })
    const listener = handlers()
    receiver.attach(listener)
    receiverRtc.open()
    await flushMicrotasks()
    deliverFrames(senderRtc, receiverRtc)

    expect(listener.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'peer-channel-invalid-message' }))
    expect(receiver.getState()).toBe('closed')
  })

  it('nettoie le canal même si un callback consommateur échoue', async () => {
    const rtc = new FakeRtcDataChannel()
    const channel = createRtcPeerDataChannelAdapter(rtc as unknown as RTCDataChannel)
    const listener = handlers()
    listener.onOpen.mockImplementation(() => { throw new Error('consumer-failure') })
    channel.attach(listener)

    expect(() => rtc.open()).not.toThrow()
    await flushMicrotasks()
    expect(listener.onError).toHaveBeenCalledWith(expect.objectContaining({ message: 'consumer-failure' }))
    expect(listener.onClose).toHaveBeenCalledOnce()
    expect(channel.getState()).toBe('closed')
  })

  it('fragmente et réassemble un snapshot de 128 Kio sans dépasser 16 Kio par trame', async () => {
    const senderRtc = new FakeRtcDataChannel()
    const receiverRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel)
    const receiver = createRtcPeerDataChannelAdapter(receiverRtc as unknown as RTCDataChannel)
    senderRtc.open()
    receiverRtc.open()

    const snapshot = `\u001ePMDC|1|contenu-applicatif:${'é'.repeat(64 * 1_024)}`
    sender.send(snapshot)
    expect(senderRtc.sent.length).toBeGreaterThan(1)
    expect(senderRtc.sent.every((frame) => (
      measurePeerDataMessageBytes(frame) <= peerDataChannelDefaultMaximumFrameBytes
    ))).toBe(true)

    // Le snapshot arrive avant attach : les écouteurs natifs doivent déjà le capter.
    deliverFrames(senderRtc, receiverRtc)
    const events: string[] = []
    const listener = handlers()
    listener.onOpen.mockImplementation(() => { events.push('open') })
    listener.onMessage.mockImplementation((message) => { events.push(message) })
    receiver.attach(listener)
    await flushMicrotasks()

    expect(events).toEqual(['open', snapshot])
    expect(listener.onError).not.toHaveBeenCalled()
  })

  it('respecte une limite SCTP résolue plus petite et accepte exactement 256 Kio applicatifs', async () => {
    let transportMaximum = 1_024
    const senderRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel, {
      resolveMaximumTransportMessageBytes: () => transportMaximum,
    })
    senderRtc.open()
    const maximumMessage = 'x'.repeat(256 * 1_024)

    expect(() => sender.send(maximumMessage)).not.toThrow()
    expect(senderRtc.sent.length).toBeGreaterThan(256)
    expect(senderRtc.sent.every((frame) => measurePeerDataMessageBytes(frame) <= transportMaximum)).toBe(true)
    expect(() => sender.send(`${maximumMessage}x`)).toThrowError(expect.objectContaining({
      code: 'peer-channel-message-too-large',
    }))

    const receiverRtc = new FakeRtcDataChannel()
    const receiver = createRtcPeerDataChannelAdapter(receiverRtc as unknown as RTCDataChannel)
    const listener = handlers()
    receiver.attach(listener)
    receiverRtc.open()
    await flushMicrotasks()
    deliverFrames(senderRtc, receiverRtc)
    expect(listener.onMessage).toHaveBeenCalledWith(maximumMessage)

    transportMaximum = 128
    expect(() => sender.send('encore')).toThrowError(expect.objectContaining({
      code: 'peer-channel-transport-limit',
    }))
  })

  it('réassemble des fragments désordonnés et refuse strictement un doublon', async () => {
    const senderRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel, {
      maximumFrameBytes: 512,
    })
    senderRtc.open()
    const message = 'fragment'.repeat(1_024)
    sender.send(message)
    expect(senderRtc.sent.length).toBeGreaterThan(2)

    const orderedRtc = new FakeRtcDataChannel()
    const ordered = createRtcPeerDataChannelAdapter(orderedRtc as unknown as RTCDataChannel)
    const orderedListener = handlers()
    ordered.attach(orderedListener)
    orderedRtc.open()
    await flushMicrotasks()
    for (const frame of [...senderRtc.sent].reverse()) orderedRtc.receive(frame)
    expect(orderedListener.onMessage).toHaveBeenCalledWith(message)

    const duplicateRtc = new FakeRtcDataChannel()
    const duplicate = createRtcPeerDataChannelAdapter(duplicateRtc as unknown as RTCDataChannel)
    const duplicateListener = handlers()
    duplicate.attach(duplicateListener)
    duplicateRtc.open()
    await flushMicrotasks()
    duplicateRtc.receive(senderRtc.sent[0])
    duplicateRtc.receive(senderRtc.sent[0])
    expect(duplicateListener.onError).toHaveBeenCalledWith(expect.objectContaining({
      code: 'peer-channel-invalid-message',
    }))
    expect(duplicate.getState()).toBe('closed')
  })

  it('borne le nombre de messages reçus avant attach et ferme fail-closed en cas de saturation', async () => {
    const senderRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel)
    senderRtc.open()
    sender.send('premier')
    sender.send('second')

    const receiverRtc = new FakeRtcDataChannel()
    const receiver = createRtcPeerDataChannelAdapter(receiverRtc as unknown as RTCDataChannel, {
      maximumPendingMessages: 1,
    })
    receiverRtc.open()
    deliverFrames(senderRtc, receiverRtc)
    expect(receiver.getState()).toBe('closed')

    const listener = handlers()
    receiver.attach(listener)
    await flushMicrotasks()
    expect(listener.onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'peer-channel-buffer-limit' }))
    expect(listener.onClose).toHaveBeenCalledOnce()
    expect(listener.onMessage).not.toHaveBeenCalled()

    const bytesReceiverRtc = new FakeRtcDataChannel()
    const bytesReceiver = createRtcPeerDataChannelAdapter(bytesReceiverRtc as unknown as RTCDataChannel, {
      maximumPendingBytes: 4,
    })
    bytesReceiverRtc.open()
    bytesReceiverRtc.receive(senderRtc.sent[0])
    expect(bytesReceiver.getState()).toBe('closed')
  })

  it('borne les assemblages concurrents et leur durée de vie', async () => {
    vi.useFakeTimers()
    try {
      const senderRtc = new FakeRtcDataChannel()
      const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel, {
        maximumFrameBytes: 512,
      })
      senderRtc.open()
      sender.send('a'.repeat(2_048))
      const secondMessageFirstFrame = senderRtc.sent.length
      sender.send('b'.repeat(2_048))

      const saturatedRtc = new FakeRtcDataChannel()
      const saturated = createRtcPeerDataChannelAdapter(saturatedRtc as unknown as RTCDataChannel, {
        maximumConcurrentAssemblies: 1,
      })
      const saturatedListener = handlers()
      saturated.attach(saturatedListener)
      saturatedRtc.open()
      await flushMicrotasks()
      saturatedRtc.receive(senderRtc.sent[0])
      saturatedRtc.receive(senderRtc.sent[secondMessageFirstFrame])
      expect(saturatedListener.onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'peer-channel-buffer-limit',
      }))
      expect(saturated.getState()).toBe('closed')

      const bytesRtc = new FakeRtcDataChannel()
      const bytesChannel = createRtcPeerDataChannelAdapter(bytesRtc as unknown as RTCDataChannel, {
        maximumReassemblyBytes: 1_024,
      })
      const bytesListener = handlers()
      bytesChannel.attach(bytesListener)
      bytesRtc.open()
      await flushMicrotasks()
      bytesRtc.receive(senderRtc.sent[0])
      expect(bytesListener.onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'peer-channel-buffer-limit',
      }))
      expect(bytesChannel.getState()).toBe('closed')

      const timeoutRtc = new FakeRtcDataChannel()
      const timeoutChannel = createRtcPeerDataChannelAdapter(timeoutRtc as unknown as RTCDataChannel, {
        reassemblyTimeoutMs: 5,
      })
      const timeoutListener = handlers()
      timeoutChannel.attach(timeoutListener)
      timeoutRtc.open()
      await flushMicrotasks()
      timeoutRtc.receive(senderRtc.sent[0])
      await vi.advanceTimersByTimeAsync(5)
      expect(timeoutListener.onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'peer-channel-buffer-limit',
      }))
      expect(timeoutChannel.getState()).toBe('closed')
    } finally {
      vi.useRealTimers()
    }
  })

  it('transporte sans collision une chaîne ressemblant au protocole et le message vide', async () => {
    const senderRtc = new FakeRtcDataChannel()
    const receiverRtc = new FakeRtcDataChannel()
    const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel)
    const receiver = createRtcPeerDataChannelAdapter(receiverRtc as unknown as RTCDataChannel)
    const listener = handlers()
    receiver.attach(listener)
    senderRtc.open()
    receiverRtc.open()
    await flushMicrotasks()

    const protocolLookalike = '\u001ePMDC|1|1|0|1|4|dGVzdA=='
    sender.send(protocolLookalike)
    sender.send('')
    deliverFrames(senderRtc, receiverRtc)

    expect(listener.onMessage.mock.calls).toEqual([[protocolLookalike], ['']])
    expect(listener.onError).not.toHaveBeenCalled()
  })

  it('borne le débit entrant en trames, octets et messages logiques, puis renouvelle la fenêtre', async () => {
    vi.useFakeTimers()
    try {
      const senderRtc = new FakeRtcDataChannel()
      const sender = createRtcPeerDataChannelAdapter(senderRtc as unknown as RTCDataChannel)
      senderRtc.open()
      sender.send('un')
      sender.send('deux')
      sender.send('trois')

      const framesRtc = new FakeRtcDataChannel()
      const framesChannel = createRtcPeerDataChannelAdapter(framesRtc as unknown as RTCDataChannel, {
        incomingRateWindowMs: 1_000,
        maximumIncomingFramesPerWindow: 2,
      })
      const framesListener = handlers()
      framesChannel.attach(framesListener)
      framesRtc.open()
      await flushMicrotasks()
      deliverFrames(senderRtc, framesRtc)
      expect(framesListener.onMessage).toHaveBeenCalledTimes(2)
      expect(framesListener.onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'peer-channel-buffer-limit',
      }))
      expect(framesChannel.getState()).toBe('closed')

      const oneFrameBytes = measurePeerDataMessageBytes(senderRtc.sent[0]!)
      const bytesRtc = new FakeRtcDataChannel()
      const bytesChannel = createRtcPeerDataChannelAdapter(bytesRtc as unknown as RTCDataChannel, {
        maximumIncomingWireBytesPerWindow: oneFrameBytes,
      })
      const bytesListener = handlers()
      bytesChannel.attach(bytesListener)
      bytesRtc.open()
      await flushMicrotasks()
      bytesRtc.receive(senderRtc.sent[0])
      bytesRtc.receive(senderRtc.sent[1])
      expect(bytesListener.onMessage).toHaveBeenCalledTimes(1)
      expect(bytesListener.onError).toHaveBeenCalledWith(expect.objectContaining({
        code: 'peer-channel-buffer-limit',
      }))
      expect(bytesChannel.getState()).toBe('closed')

      const messagesRtc = new FakeRtcDataChannel()
      const messagesChannel = createRtcPeerDataChannelAdapter(messagesRtc as unknown as RTCDataChannel, {
        maximumIncomingMessagesPerWindow: 1,
      })
      const messagesListener = handlers()
      messagesChannel.attach(messagesListener)
      messagesRtc.open()
      await flushMicrotasks()
      messagesRtc.receive(senderRtc.sent[0])
      await vi.advanceTimersByTimeAsync(1_000)
      messagesRtc.receive(senderRtc.sent[1])
      expect(messagesListener.onMessage.mock.calls).toEqual([['un'], ['deux']])
      expect(messagesListener.onError).not.toHaveBeenCalled()
      expect(messagesChannel.getState()).toBe('open')
    } finally {
      vi.useRealTimers()
    }
  })
})
