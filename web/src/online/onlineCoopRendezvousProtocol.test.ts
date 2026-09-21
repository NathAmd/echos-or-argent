import { describe, expect, it } from 'vitest'
import {
  parseOnlineCoopRendezvousSnapshot,
} from './onlineCoopRendezvousProtocol'

const idle = Object.freeze({
  protocolVersion: 1,
  current: Object.freeze({ status: 'idle' }),
  invitations: Object.freeze([]),
})

const sessionA = 'AAAAAAAAAAAAAAAAAAAAAA'
const sessionB = 'BBBBBBBBBBBBBBBBBBBBBA'
const sessionC = 'CCCCCCCCCCCCCCCCCCCCCA'

describe('onlineCoopRendezvousProtocol', () => {
  it('accepte les états canoniques du rendez-vous Coop', () => {
    expect(parseOnlineCoopRendezvousSnapshot(idle)).toEqual(idle)
    expect(parseOnlineCoopRendezvousSnapshot({
      protocolVersion: 1,
      current: { status: 'queued', mode: 'random', joinedAt: 10, expiresAt: 20 },
      invitations: [],
    })?.current).toEqual({ status: 'queued', mode: 'random', joinedAt: 10, expiresAt: 20 })
    expect(parseOnlineCoopRendezvousSnapshot({
      protocolVersion: 1,
      current: {
        status: 'offered',
        mode: 'friend',
        sessionId: sessionA,
        peerUserId: 'bob',
        role: 'host',
        expiresAt: 20,
      },
      invitations: [],
    })?.current).toMatchObject({ status: 'offered', role: 'host' })
    expect(parseOnlineCoopRendezvousSnapshot({
      protocolVersion: 1,
      current: {
        status: 'ready',
        mode: 'random',
        sessionId: sessionB,
        peerUserId: 'bob',
        role: 'guest',
        expiresAt: 20,
      },
      invitations: [],
    })?.current).toMatchObject({ status: 'ready', role: 'guest' })
    expect(parseOnlineCoopRendezvousSnapshot({
      protocolVersion: 1,
      current: {
        status: 'active',
        mode: 'friend',
        sessionId: sessionC,
        peerUserId: 'bob',
        role: 'host',
        expiresAt: 20,
      },
      invitations: [],
    })?.current).toMatchObject({ status: 'active', role: 'host' })
  })

  it('accepte seulement les invitations Coop strictes et uniques', () => {
    expect(parseOnlineCoopRendezvousSnapshot({
      ...idle,
      invitations: [{
        sessionId: sessionA,
        fromUserId: 'alice',
        intent: 'coop',
        expiresAt: 20,
      }],
    })?.invitations).toHaveLength(1)
    expect(parseOnlineCoopRendezvousSnapshot({
      ...idle,
      invitations: [
        { sessionId: sessionA, fromUserId: 'alice', intent: 'coop', expiresAt: 20 },
        { sessionId: sessionA, fromUserId: 'alice', intent: 'coop', expiresAt: 20 },
      ],
    })).toBeUndefined()
  })

  it.each([
    { ...idle, protocolVersion: 2 },
    { ...idle, extra: true },
    { ...idle, current: { status: 'idle', extra: true } },
    { ...idle, current: { status: 'queued', mode: 'friend', joinedAt: 10, expiresAt: 20 } },
    { ...idle, current: { status: 'queued', mode: 'random', joinedAt: 20, expiresAt: 20 } },
    { ...idle, current: { status: 'offered', mode: 'friend', sessionId: sessionA, peerUserId: 'bob', role: 'guest', expiresAt: 20 } },
    { ...idle, current: { status: 'active', mode: 'friend', sessionId: sessionA, peerUserId: 'bob', role: 'offerer', expiresAt: 20 } },
    { ...idle, invitations: [{ sessionId: sessionA, fromUserId: 'alice', intent: 'trade', expiresAt: 20 }] },
    {
      ...idle,
      current: { status: 'active', mode: 'friend', sessionId: sessionA, peerUserId: 'bob', role: 'host', expiresAt: 20 },
      invitations: [{ sessionId: sessionA, fromUserId: 'alice', intent: 'coop', expiresAt: 20 }],
    },
  ])('refuse une enveloppe divergente %#', (value) => {
    expect(parseOnlineCoopRendezvousSnapshot(value)).toBeUndefined()
  })
})
