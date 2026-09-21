import { describe, expect, it, vi } from 'vitest'
import type { OnlineSignalingClient, OnlineSignalingState } from './onlineSignalingClient'
import { isOnlineOpaqueId, type OnlineRealtimeEvent, type OnlineSignalPayload } from './onlineServiceProtocol'
import {
  createRtcSignalingCoordinator,
  isIssuedRtcSignalingRoute,
  type RtcSignalingInboundSignal,
} from './rtcSignalingCoordinator'

class MemorySignalingClient implements OnlineSignalingClient {
  private readonly eventListeners = new Set<(event: OnlineRealtimeEvent) => void>()
  private readonly stateListeners = new Set<(state: OnlineSignalingState) => void>()
  private state: OnlineSignalingState
  readonly sent: Array<Readonly<{
    to: string
    negotiationId: string
    payload: OnlineSignalPayload
    requestId: string
  }>> = []

  constructor(userId = 'local-user') {
    this.state = Object.freeze({ status: 'ready', userId })
  }

  getState = (): OnlineSignalingState => this.state

  sendSignal = (to: string, negotiationId: string, payload: OnlineSignalPayload, requestId = 'generated'): string => {
    this.sent.push(Object.freeze({ to, negotiationId, payload, requestId }))
    return requestId
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

  close = (): void => { this.setState(Object.freeze({ status: 'closed' })) }

  emit(event: OnlineRealtimeEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  setState(state: OnlineSignalingState): void {
    this.state = state
    for (const listener of this.stateListeners) listener(state)
  }

  listenerCounts(): Readonly<{ events: number, states: number }> {
    return { events: this.eventListeners.size, states: this.stateListeners.size }
  }
}

function signal(
  from: string,
  negotiationId: string,
  requestId: string,
  payload: OnlineSignalPayload,
): OnlineRealtimeEvent {
  return Object.freeze({ type: 'signal', from, negotiationId, requestId, payload })
}

function opaqueId(serial: number): string {
  return `${serial.toString(36).padStart(21, '0')}A`
}

const validSdp = [
  'v=0', 'o=- 0 0 IN IP4 127.0.0.1', 's=-', 't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'a=ice-ufrag:test', 'a=ice-pwd:0123456789012345678901',
  'a=fingerprint:sha-256 00', '',
].join('\r\n')

function iceCandidate(serial: number): string {
  return `candidate:${serial} 1 udp 2122260223 192.0.2.${serial} 54321 typ host`
}

describe('coordinateur long-vivant de signalisation RTC', () => {
  it('alloue une négociation opaque et refuse une étiquette métier sortante', () => {
    const signaling = new MemorySignalingClient()
    const coordinator = createRtcSignalingCoordinator({ signaling })
    const route = coordinator.createOutboundRoute('alice')

    expect(isOnlineOpaqueId(route.descriptor.negotiationId)).toBe(true)
    expect(() => coordinator.createOutboundRoute('bob', 'campaign-slot-one')).toThrow(/opaque/)
    route.close()
    coordinator.close()
  })

  it('capture une offre précoce, livre ICE dans son ordre et ne permet qu’une seule claim', () => {
    const signaling = new MemorySignalingClient()
    const coordinator = createRtcSignalingCoordinator({ signaling })
    const snapshots = vi.fn<(invitations: ReturnType<typeof coordinator.getInvitations>) => void>()
    const unsubscribeInvitations = coordinator.subscribeInvitations(snapshots)

    expect(signaling.listenerCounts()).toEqual({ events: 1, states: 1 })
    signaling.emit(signal('alice', 'rtc-inbound-1', 'alice-ice-1', {
      type: 'ice', candidate: 'candidate:early', sdpMid: '0', sdpMLineIndex: 0,
    }))
    expect(coordinator.getInvitations()).toEqual([])
    signaling.emit(signal('alice', 'rtc-inbound-1', 'alice-offer-1', {
      type: 'offer', sdp: 'v=0\r\no=alice-offer',
    }))

    const [invitation] = coordinator.getInvitations()
    expect(invitation).toMatchObject({
      descriptor: { peerId: 'alice', negotiationId: 'rtc-inbound-1' },
    })
    expect(Object.isFrozen(invitation)).toBe(true)
    expect(Object.isFrozen(invitation!.descriptor)).toBe(true)

    const route = coordinator.claimInvitation(invitation!)
    expect(route.descriptor).toBe(invitation!.descriptor)
    expect(Object.isFrozen(route)).toBe(true)
    expect(isIssuedRtcSignalingRoute(route)).toBe(true)
    expect(isIssuedRtcSignalingRoute(Object.freeze({ ...route }))).toBe(false)
    expect(() => coordinator.claimInvitation(invitation!)).toThrow(expect.objectContaining({
      code: 'rtc-invitation-consumed',
    }))

    const received: RtcSignalingInboundSignal[] = []
    route.subscribe((event) => received.push(event))
    expect(received.map(({ payload }) => payload.type)).toEqual(['ice', 'offer'])
    expect(() => route.subscribe(() => undefined)).toThrow(expect.objectContaining({
      code: 'rtc-route-already-subscribed',
    }))

    signaling.emit(signal('alice', 'rtc-inbound-1', 'alice-answer-1', {
      type: 'answer', sdp: 'v=0\r\no=unexpected-answer',
    }))
    signaling.emit(signal('alice', 'rtc-other', 'alice-other-offer', {
      type: 'offer', sdp: 'v=0\r\no=other-offer',
    }))
    signaling.emit(signal('alice', 'rtc-inbound-1', 'alice-answer-1', {
      type: 'answer', sdp: 'v=0\r\no=replayed-answer',
    }))

    expect(received.map(({ requestId }) => requestId)).toEqual([
      'alice-ice-1', 'alice-offer-1', 'alice-answer-1',
    ])
    expect(coordinator.getInvitations().map(({ descriptor }) => descriptor.negotiationId)).toEqual(['rtc-other'])

    route.close()
    signaling.emit(signal('alice', 'rtc-inbound-1', 'alice-late-ice', {
      type: 'ice', candidate: 'candidate:late',
    }))
    expect(received).toHaveLength(3)
    expect(coordinator.getInvitations().map(({ descriptor }) => descriptor.negotiationId)).toEqual(['rtc-other'])

    unsubscribeInvitations()
    coordinator.close()
    expect(signaling.listenerCounts()).toEqual({ events: 0, states: 0 })
    expect(snapshots).toHaveBeenCalled()
  })

  it('borne ICE, les invitations et les files de routes puis expire sans prolongation par rejeu', async () => {
    vi.useFakeTimers()
    try {
      const signaling = new MemorySignalingClient()
      const coordinator = createRtcSignalingCoordinator({
        signaling,
        invitationTtlMs: 10,
        acknowledgementTimeoutMs: 5,
        maximumBufferedNegotiations: 2,
        maximumInvitations: 1,
        maximumIceCandidatesPerNegotiation: 2,
        maximumBufferedIceCandidates: 2,
        maximumActiveRoutes: 2,
        maximumBufferedSignalsPerRoute: 3,
        maximumPendingRequests: 2,
        maximumRememberedRequestIds: 16,
        maximumReplayTombstones: 4,
      })

      signaling.emit(signal('alice', 'rtc-bounded', 'ice-1', { type: 'ice', candidate: 'candidate:1' }))
      signaling.emit(signal('alice', 'rtc-bounded', 'ice-2', { type: 'ice', candidate: 'candidate:2' }))
      signaling.emit(signal('alice', 'rtc-bounded', 'ice-3', { type: 'ice', candidate: 'candidate:3' }))
      signaling.emit(signal('alice', 'rtc-bounded', 'offer-1', { type: 'offer', sdp: 'v=0\r\no=bounded' }))
      signaling.emit(signal('bob', 'rtc-second', 'offer-2', { type: 'offer', sdp: 'v=0\r\no=second' }))

      const [boundedInvitation] = coordinator.getInvitations()
      expect(boundedInvitation?.descriptor.negotiationId).toBe('rtc-bounded')
      const boundedRoute = coordinator.claimInvitation(boundedInvitation!)
      const buffered: RtcSignalingInboundSignal[] = []
      boundedRoute.subscribe((event) => buffered.push(event))
      expect(buffered.map(({ requestId }) => requestId)).toEqual(['ice-1', 'ice-2', 'offer-1'])
      boundedRoute.close()

      const outboundNegotiationId = opaqueId(30)
      const outbound = coordinator.createOutboundRoute('alice', outboundNegotiationId)
      signaling.emit(signal('alice', outboundNegotiationId, 'answer-1', { type: 'answer', sdp: 'v=0\r\no=one' }))
      signaling.emit(signal('alice', outboundNegotiationId, 'answer-2', { type: 'answer', sdp: 'v=0\r\no=two' }))
      signaling.emit(signal('alice', outboundNegotiationId, 'answer-3', { type: 'answer', sdp: 'v=0\r\no=three' }))
      signaling.emit(signal('alice', outboundNegotiationId, 'answer-4', { type: 'answer', sdp: 'v=0\r\no=four' }))
      expect(() => outbound.subscribe(() => undefined)).toThrow(expect.objectContaining({
        code: 'rtc-capacity-exceeded',
      }))

      signaling.emit(signal('carol', 'rtc-expiring', 'offer-expiring', {
        type: 'offer', sdp: 'v=0\r\no=expiring',
      }))
      const expiring = coordinator.getInvitations()[0]
      expect(expiring?.descriptor.peerId).toBe('carol')
      await vi.advanceTimersByTimeAsync(10)
      expect(coordinator.getInvitations()).toEqual([])
      expect(() => coordinator.claimInvitation(expiring!)).toThrow(expect.objectContaining({
        code: 'rtc-invitation-consumed',
      }))
      coordinator.close()
    } finally {
      vi.useRealTimers()
    }
  })

  it('corrèle exactement ack/error, refuse les identifiants rejoués et confirme un decline', async () => {
    const signaling = new MemorySignalingClient()
    const coordinator = createRtcSignalingCoordinator({
      signaling,
      requestIdFactory: opaqueId,
    })
    const route = coordinator.createOutboundRoute('alice', opaqueId(20))

    const rejected = route.send({ type: 'offer', sdp: validSdp })
    expect(signaling.sent.at(-1)?.requestId).toBe(opaqueId(1))
    signaling.emit(Object.freeze({
      type: 'error', code: 'PEER_OFFLINE', message: 'Peer is offline', requestId: opaqueId(1),
    }))
    await expect(rejected).rejects.toMatchObject({
      code: 'rtc-signaling-rejected', requestId: opaqueId(1),
    })

    const accepted = route.send({ type: 'ice', candidate: iceCandidate(1) })
    signaling.emit(Object.freeze({ type: 'signal-accepted', requestId: 'unknown-id' }))
    signaling.emit(Object.freeze({ type: 'signal-accepted', requestId: opaqueId(2) }))
    await expect(accepted).resolves.toBe(opaqueId(2))

    signaling.emit(signal('bob', 'rtc-decline', 'bob-offer', {
      type: 'offer', sdp: 'v=0\r\no=bob-offer',
    }))
    const invitation = coordinator.getInvitations()[0]!
    const declined = coordinator.declineInvitation(invitation)
    expect(signaling.sent.at(-1)).toMatchObject({
      to: 'bob', negotiationId: 'rtc-decline', requestId: opaqueId(3),
      payload: { type: 'hangup' },
    })
    signaling.emit(Object.freeze({ type: 'signal-accepted', requestId: opaqueId(3) }))
    await expect(declined).resolves.toBeUndefined()
    await expect(coordinator.declineInvitation(invitation)).rejects.toMatchObject({
      code: 'rtc-invitation-consumed',
    })

    route.close()
    await expect(route.send({ type: 'ice', candidate: 'candidate:late' })).rejects.toMatchObject({
      code: 'rtc-route-closed',
    })
    coordinator.close()
  })

  it('rejette les ack expirés et nettoie routes, promesses et abonnements à la fermeture', async () => {
    vi.useFakeTimers()
    try {
      const signaling = new MemorySignalingClient()
      const coordinator = createRtcSignalingCoordinator({
        signaling,
        invitationTtlMs: 20,
        acknowledgementTimeoutMs: 5,
        maximumPendingRequests: 2,
        maximumRememberedRequestIds: 4,
        requestIdFactory: opaqueId,
      })
      const route = coordinator.createOutboundRoute('alice', opaqueId(40))
      const timedOut = route.send({ type: 'offer', sdp: validSdp })
      const timedOutAssertion = expect(timedOut).rejects.toMatchObject({
        code: 'rtc-acknowledgement-timeout', requestId: opaqueId(1),
      })
      await vi.advanceTimersByTimeAsync(5)
      await timedOutAssertion

      const closed = route.send({ type: 'ice', candidate: iceCandidate(2) })
      const closedAssertion = expect(closed).rejects.toMatchObject({ code: 'rtc-coordinator-closed' })
      coordinator.close()
      await closedAssertion
      expect(route.getState()).toMatchObject({ status: 'closed', error: { code: 'rtc-coordinator-closed' } })
      expect(signaling.listenerCounts()).toEqual({ events: 0, states: 0 })
      expect(() => coordinator.createOutboundRoute('bob', opaqueId(41))).toThrow(expect.objectContaining({
        code: 'rtc-coordinator-closed',
      }))
    } finally {
      vi.useRealTimers()
    }
  })

  it('passe en refus temporaire plutôt que d’évincer une preuve anti-rejeu', async () => {
    vi.useFakeTimers()
    try {
      const signaling = new MemorySignalingClient()
      const coordinator = createRtcSignalingCoordinator({
        signaling,
        invitationTtlMs: 10,
        maximumReplayTombstones: 1,
      })
      coordinator.createOutboundRoute('alice', opaqueId(50)).close()
      coordinator.createOutboundRoute('alice', opaqueId(51)).close()

      expect(() => coordinator.createOutboundRoute('alice', opaqueId(52))).toThrow(expect.objectContaining({
        code: 'rtc-capacity-exceeded',
      }))
      signaling.emit(signal('bob', 'rtc-replayed-during-barrier', 'barrier-offer', {
        type: 'offer', sdp: 'v=0\r\no=blocked-replay',
      }))
      expect(coordinator.getInvitations()).toEqual([])

      await vi.advanceTimersByTimeAsync(10)
      const route = coordinator.createOutboundRoute('alice', opaqueId(53))
      expect(route.descriptor.negotiationId).toBe(opaqueId(53))
      route.close()
      coordinator.close()
    } finally {
      vi.useRealTimers()
    }
  })
})
