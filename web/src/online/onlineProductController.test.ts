import { describe, expect, it, vi } from 'vitest'
import type { PeerDataChannel } from './peerDataChannel'
import {
  createOnlineProductController,
  type OnlineProductController,
} from './onlineProductController'
import type { OnlineSignalingClient, OnlineSignalingState } from './onlineSignalingClient'
import type { OnlineSocialClient } from './onlineSocialClient'
import type { OnlineMatchmakingClient } from './onlineMatchmakingClient'
import type { OnlineCoopRendezvousClient } from './onlineCoopRendezvousClient'
import type { OnlineCoopRendezvousSnapshot } from './onlineCoopRendezvousProtocol'
import type {
  OnlineMatchmakingActivity,
  OnlineMatchmakingStatus,
} from './onlineMatchmakingProtocol'
import type {
  OnlineRealtimeEvent,
  OnlineSignalPayload,
  OnlineSocialSnapshot,
} from './onlineServiceProtocol'
import type {
  RtcPeerConnectionLink,
  RtcPeerConnectionSession,
  RtcPeerConnectionSessionOptions,
  RtcPeerConnectionSessionState,
} from './rtcPeerConnectionSession'
import type {
  RtcSignalingCoordinator,
  RtcSignalingInvitation,
  RtcSignalingRoute,
  RtcSignalingRouteRole,
} from './rtcSignalingCoordinator'

const config = Object.freeze({
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
})
const ticket = Object.freeze({ ticket: 'a'.repeat(43), expiresInMs: 30_000 })
const matchId = 'M'.repeat(21) + 'A'
const negotiationId = 'N'.repeat(21) + 'Q'

function deferred<T>(): Readonly<{
  promise: Promise<T>
  reject: (reason?: unknown) => void
  resolve: (value: T) => void
}> {
  let resolvePromise: ((value: T) => void) | undefined
  let rejectPromise: ((reason?: unknown) => void) | undefined
  const promise = new Promise<T>((resolve, reject) => {
    resolvePromise = resolve
    rejectPromise = reject
  })
  return Object.freeze({
    promise,
    reject: (reason) => { rejectPromise?.(reason) },
    resolve: (value) => { resolvePromise?.(value) },
  })
}

function socialSnapshot(
  online = false,
  incoming: readonly string[] = ['carol'],
  outgoing: readonly string[] = ['dave'],
): OnlineSocialSnapshot {
  return Object.freeze({
    friends: Object.freeze([Object.freeze({ userId: 'bob', online })]),
    incoming: Object.freeze([...incoming]),
    outgoing: Object.freeze([...outgoing]),
  })
}

function matchedStatus(
  activity: OnlineMatchmakingActivity,
  role: 'offerer' | 'answerer',
  overrides: Partial<Extract<OnlineMatchmakingStatus, { status: 'matched' }>> = {},
): Extract<OnlineMatchmakingStatus, { status: 'matched' }> {
  return Object.freeze({
    status: 'matched',
    activity,
    expiresAt: 31_000,
    matchId,
    negotiationId,
    peerUserId: 'bob',
    role,
    ...overrides,
  })
}

class FakeSocialClient implements OnlineSocialClient {
  snapshot = socialSnapshot()
  readonly getIdentity = vi.fn(async () => 'alice')
  readonly getSocial = vi.fn(async () => this.snapshot)
  readonly sendFriendRequest = vi.fn(async () => undefined)
  readonly acceptFriendRequest = vi.fn(async () => undefined)
  readonly declineFriendRequest = vi.fn(async () => undefined)
  readonly cancelFriendRequest = vi.fn(async () => undefined)
  readonly removeFriend = vi.fn(async () => undefined)
  readonly issueRealtimeTicket = vi.fn(async () => ticket)
}

class FakeMatchmakingClient implements OnlineMatchmakingClient {
  status: OnlineMatchmakingStatus = Object.freeze({ status: 'idle' })
  readonly getStatus = vi.fn(async (): Promise<OnlineMatchmakingStatus> => this.status)
  readonly join = vi.fn(async (activity: OnlineMatchmakingActivity): Promise<OnlineMatchmakingStatus> => {
    this.status = Object.freeze({
      status: 'queued',
      activity,
      joinedAt: 1_000,
      expiresAt: 31_000,
    })
    return this.status
  })
  readonly cancel = vi.fn(async (): Promise<void> => {
    this.status = Object.freeze({ status: 'idle' })
  })
}

class FakeCoopRendezvousClient implements OnlineCoopRendezvousClient {
  snapshot: OnlineCoopRendezvousSnapshot = Object.freeze({
    protocolVersion: 1,
    current: Object.freeze({ status: 'idle' }),
    invitations: Object.freeze([]),
  })
  readonly getSnapshot = vi.fn(async () => this.snapshot)
  readonly searchRandom = vi.fn(async () => this.snapshot)
  readonly inviteFriend = vi.fn(async (peerUserId: string) => {
    void peerUserId
    return this.snapshot
  })
  readonly acceptInvitation = vi.fn(async (sessionId: string) => {
    void sessionId
    return this.snapshot
  })
  readonly declineInvitation = vi.fn(async (sessionId: string) => {
    void sessionId
    return this.snapshot
  })
  readonly cancelCurrent = vi.fn(async () => this.snapshot)
}

class FakeSignalingClient implements OnlineSignalingClient {
  private state: OnlineSignalingState = Object.freeze({ status: 'connecting' })
  private readonly eventListeners = new Set<(event: OnlineRealtimeEvent) => void>()
  private readonly stateListeners = new Set<(state: OnlineSignalingState) => void>()
  readonly closeSpy = vi.fn(() => {
    this.state = Object.freeze({ status: 'closed' })
    for (const listener of this.stateListeners) listener(this.state)
  })

  getState = (): OnlineSignalingState => this.state
  sendSignal = (
    _to: string,
    _negotiationId: string,
    _payload: OnlineSignalPayload,
    requestId = 'request-id',
  ): string => requestId
  subscribe = (listener: (event: OnlineRealtimeEvent) => void): (() => void) => {
    this.eventListeners.add(listener)
    return () => { this.eventListeners.delete(listener) }
  }
  subscribeState = (listener: (state: OnlineSignalingState) => void): (() => void) => {
    this.stateListeners.add(listener)
    listener(this.state)
    return () => { this.stateListeners.delete(listener) }
  }
  close = (): void => { this.closeSpy() }

  ready(userId = 'alice', onlineFriends: readonly string[] = ['bob']): void {
    this.state = Object.freeze({ status: 'ready', userId })
    for (const listener of this.stateListeners) listener(this.state)
    this.emit(Object.freeze({ type: 'ready', version: 1, userId, onlineFriends: Object.freeze([...onlineFriends]) }))
  }

  emit(event: OnlineRealtimeEvent): void {
    for (const listener of this.eventListeners) listener(event)
  }

  listenerCount(): number { return this.eventListeners.size + this.stateListeners.size }
}

function fakeRoute(
  peerId: string,
  role: RtcSignalingRouteRole,
  serial: number,
  exactNegotiationId = `rtc-${serial}`,
): RtcSignalingRoute {
  const descriptor = Object.freeze({ peerId, negotiationId: exactNegotiationId })
  const close = vi.fn()
  return Object.freeze({
    descriptor,
    role,
    getState: () => Object.freeze({ status: 'ready', userId: 'alice' } as const),
    send: async () => 'request-id',
    subscribe: () => () => undefined,
    subscribeState: (listener: (state: OnlineSignalingState) => void) => {
      listener(Object.freeze({ status: 'ready', userId: 'alice' }))
      return () => undefined
    },
    close,
  })
}

class FakeSignalingCoordinator implements RtcSignalingCoordinator {
  private invitations: readonly RtcSignalingInvitation[] = Object.freeze([])
  private readonly listeners = new Set<(value: readonly RtcSignalingInvitation[]) => void>()
  private serial = 0
  readonly createdRoutes: RtcSignalingRoute[] = []
  readonly claimed = vi.fn<(invitation: RtcSignalingInvitation) => void>()
  readonly declined = vi.fn<(invitation: RtcSignalingInvitation) => void>()
  readonly closeSpy = vi.fn()

  getInvitations = (): readonly RtcSignalingInvitation[] => this.invitations
  subscribeInvitations = (listener: (invitations: readonly RtcSignalingInvitation[]) => void): (() => void) => {
    this.listeners.add(listener)
    listener(this.invitations)
    return () => { this.listeners.delete(listener) }
  }
  createOutboundRoute = (peerId: string, exactNegotiationId?: string): RtcSignalingRoute => {
    this.serial += 1
    const route = fakeRoute(peerId, 'offerer', this.serial, exactNegotiationId)
    this.createdRoutes.push(route)
    return route
  }
  claimInvitation = (invitation: RtcSignalingInvitation): RtcSignalingRoute => {
    this.claimed(invitation)
    this.removeInvitation(invitation)
    this.serial += 1
    const route = fakeRoute(
      invitation.descriptor.peerId,
      'answerer',
      this.serial,
      invitation.descriptor.negotiationId,
    )
    this.createdRoutes.push(route)
    return route
  }
  declineInvitation = async (invitation: RtcSignalingInvitation): Promise<void> => {
    this.declined(invitation)
    this.removeInvitation(invitation)
  }
  close = (): void => {
    this.closeSpy()
    this.invitations = Object.freeze([])
    this.listeners.clear()
  }

  invite(peerId: string): RtcSignalingInvitation {
    this.serial += 1
    const invitation = Object.freeze({
      descriptor: Object.freeze({ peerId, negotiationId: `incoming-${this.serial}` }),
      receivedAt: 1,
      expiresAt: 30_001,
    })
    this.invitations = Object.freeze([...this.invitations, invitation])
    this.publish()
    return invitation
  }

  inviteExact(peerId: string, exactNegotiationId: string): RtcSignalingInvitation {
    const invitation = Object.freeze({
      descriptor: Object.freeze({ peerId, negotiationId: exactNegotiationId }),
      receivedAt: 1,
      expiresAt: 30_001,
    })
    this.invitations = Object.freeze([...this.invitations, invitation])
    this.publish()
    return invitation
  }

  private removeInvitation(invitation: RtcSignalingInvitation): void {
    this.invitations = Object.freeze(this.invitations.filter((value) => value !== invitation))
    this.publish()
  }

  private publish(): void {
    for (const listener of this.listeners) listener(this.invitations)
  }
}

const channel: PeerDataChannel = Object.freeze({
  getState: () => 'open' as const,
  attach: () => () => undefined,
  send: () => undefined,
  close: () => undefined,
})

class FakePeerSession implements RtcPeerConnectionSession {
  private state: RtcPeerConnectionSessionState
  private readonly options: RtcPeerConnectionSessionOptions
  private readonly connectGate?: Promise<void>
  readonly closeSpy = vi.fn((reason?: string) => {
    void reason
    this.state = Object.freeze({
      status: 'closed',
      role: this.options.route.role,
      peerId: this.options.route.descriptor.peerId,
      negotiationId: this.options.route.descriptor.negotiationId,
    })
    this.options.onStateChange?.(this.state)
  })

  constructor(options: RtcPeerConnectionSessionOptions, connectGate?: Promise<void>) {
    this.options = options
    this.connectGate = connectGate
    this.state = Object.freeze({
      status: 'idle',
      role: options.route.role,
      peerId: options.route.descriptor.peerId,
      negotiationId: options.route.descriptor.negotiationId,
    })
  }

  getState = (): RtcPeerConnectionSessionState => this.state
  connect = async (): Promise<RtcPeerConnectionLink> => {
    this.state = Object.freeze({ ...this.state, status: 'connecting' })
    this.options.onStateChange?.(this.state)
    await Promise.resolve()
    await this.connectGate
    this.state = Object.freeze({ ...this.state, status: 'connected' })
    this.options.onStateChange?.(this.state)
    return Object.freeze({
      channel,
      descriptor: this.options.route.descriptor,
      role: this.options.route.role,
    })
  }
  close = (reason?: string): void => { this.closeSpy(reason) }
}

type Harness = Readonly<{
  controller: OnlineProductController
  social: FakeSocialClient
  signaling: FakeSignalingClient
  matchmaking: FakeMatchmakingClient
  coop: FakeCoopRendezvousClient
  coordinator: FakeSignalingCoordinator
  sessions: FakePeerSession[]
  rtcConfigurations: Array<RTCConfiguration | undefined>
  readCapturedToken: () => string | undefined
}>

function createHarness(
  now: () => number = () => 2_000,
  peerConnectGate?: Promise<void>,
  rtcConfiguration?: RTCConfiguration,
): Harness {
  const social = new FakeSocialClient()
  const signaling = new FakeSignalingClient()
  const coordinator = new FakeSignalingCoordinator()
  const matchmaking = new FakeMatchmakingClient()
  const coop = new FakeCoopRendezvousClient()
  const sessions: FakePeerSession[] = []
  const rtcConfigurations: Array<RTCConfiguration | undefined> = []
  let readToken: (() => string | undefined) | undefined
  const controller = createOnlineProductController({
    config,
    rtcConfiguration,
    socialClientFactory: (options) => {
      readToken = options.readAccessToken
      return social
    },
    matchmakingClientFactory: () => matchmaking,
    coopRendezvousClientFactory: () => coop,
    signalingClientFactory: () => signaling,
    signalingCoordinatorFactory: () => coordinator,
    peerConnectionSessionFactory: (options) => {
      rtcConfigurations.push(options.rtcConfiguration)
      const session = new FakePeerSession(options, peerConnectGate)
      sessions.push(session)
      return session
    },
    now,
  })
  return {
    controller,
    social,
    signaling,
    matchmaking,
    coop,
    coordinator,
    sessions,
    rtcConfigurations,
    readCapturedToken: () => readToken?.(),
  }
}

async function connectReady(harness: Harness): Promise<void> {
  const connection = harness.controller.connect('opaque-runtime-token')
  await vi.waitFor(() => expect(harness.signaling.listenerCount()).toBeGreaterThan(0))
  harness.signaling.ready()
  await connection
}

describe('contrôleur produit en ligne', () => {
  it('compose identité, social, ticket et présence sans exposer le Bearer', async () => {
    const harness = createHarness()
    const states: string[] = []
    harness.controller.subscribe((state) => states.push(state.status))

    await connectReady(harness)

    expect(harness.controller.getState()).toMatchObject({
      configured: true,
      status: 'ready',
      identity: 'alice',
      friends: [{ userId: 'bob', online: true }],
      incomingFriendRequests: ['carol'],
      outgoingFriendRequests: ['dave'],
    })
    expect(Object.isFrozen(harness.controller.getState())).toBe(true)
    expect(JSON.stringify(harness.controller.getState())).not.toContain('opaque-runtime-token')
    expect(harness.readCapturedToken()).toBe('opaque-runtime-token')

    harness.signaling.emit(Object.freeze({ type: 'presence', userId: 'bob', online: false }))
    expect(harness.controller.getState().friends).toEqual([{ userId: 'bob', online: false }])

    harness.social.snapshot = socialSnapshot(true, ['erin'], [])
    harness.signaling.emit(Object.freeze({ type: 'social-changed' }))
    await vi.waitFor(() => expect(harness.controller.getState().incomingFriendRequests).toEqual(['erin']))

    harness.controller.disconnect()
    expect(harness.controller.getState()).toEqual({
      configured: true,
      status: 'disconnected',
      friends: [],
      incomingFriendRequests: [],
      outgoingFriendRequests: [],
      invitations: [],
      matchmaking: { status: 'idle' },
      coopRendezvous: {
        protocolVersion: 1,
        current: { status: 'idle' },
        invitations: [],
      },
    })
    expect(harness.readCapturedToken()).toBeUndefined()
    expect(harness.signaling.closeSpy).toHaveBeenCalledOnce()
    expect(harness.coordinator.closeSpy).toHaveBeenCalledOnce()
    expect(states).toContain('connecting')
    expect(states).toContain('ready')
  })

  it('rafraîchit le snapshot après chaque mutation de relation', async () => {
    const harness = createHarness()
    await connectReady(harness)
    harness.social.snapshot = socialSnapshot(true, [], [])

    await harness.controller.acceptFriendRequest('carol')
    await harness.controller.declineFriendRequest('erin')
    await harness.controller.sendFriendRequest('frank')
    await harness.controller.cancelFriendRequest('george')
    await harness.controller.removeFriend('bob')

    expect(harness.social.acceptFriendRequest).toHaveBeenCalledWith('carol', expect.any(AbortSignal))
    expect(harness.social.declineFriendRequest).toHaveBeenCalledWith('erin', expect.any(AbortSignal))
    expect(harness.social.sendFriendRequest).toHaveBeenCalledWith('frank', expect.any(AbortSignal))
    expect(harness.social.cancelFriendRequest).toHaveBeenCalledWith('george', expect.any(AbortSignal))
    expect(harness.social.removeFriend).toHaveBeenCalledWith('bob', expect.any(AbortSignal))
    expect(harness.social.getSocial).toHaveBeenCalledTimes(6)
    expect(harness.controller.getState().incomingFriendRequests).toEqual([])
  })

  it('pilote le rendez-vous Coop persistant sans créer de route RTC', async () => {
    const harness = createHarness()
    await connectReady(harness)
    harness.coop.snapshot = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({
        status: 'queued',
        mode: 'random',
        joinedAt: 2_000,
        expiresAt: 32_000,
      }),
      invitations: Object.freeze([]),
    })

    await harness.controller.searchRandomCoop!()
    expect(harness.controller.getState().coopRendezvous?.current).toMatchObject({
      status: 'queued',
      mode: 'random',
    })
    expect(harness.coop.searchRandom).toHaveBeenCalledOnce()
    expect(harness.coordinator.createdRoutes).toHaveLength(0)

    harness.coop.snapshot = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({ status: 'idle' }),
      invitations: Object.freeze([]),
    })
    await harness.controller.cancelCoopRendezvous!()
    harness.coop.snapshot = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({
        status: 'offered',
        mode: 'friend',
        sessionId: matchId,
        peerUserId: 'bob',
        role: 'host',
        expiresAt: 32_000,
      }),
      invitations: Object.freeze([]),
    })
    await harness.controller.inviteCoopFriend!('bob')
    expect(harness.coop.inviteFriend).toHaveBeenCalledWith('bob', expect.any(AbortSignal))
    expect(harness.controller.getState().coopRendezvous?.current).toMatchObject({
      status: 'offered',
      role: 'host',
    })

    harness.coop.snapshot = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({ status: 'idle' }),
      invitations: Object.freeze([]),
    })
    await harness.controller.cancelCoopRendezvous!()
    expect(harness.controller.getState().coopRendezvous?.current).toEqual({ status: 'idle' })
    expect(harness.coordinator.createdRoutes).toHaveLength(0)
  })

  it.each(['search', 'invite', 'accept'] as const)(
    'coalesce le cancel Coop et compense une mutation %s commitée tardivement',
    async (kind) => {
      const harness = createHarness()
      await connectReady(harness)
      const mutationResponse = deferred<OnlineCoopRendezvousSnapshot>()
      const finalDelete = deferred<void>()
      const engaged: OnlineCoopRendezvousSnapshot = kind === 'search'
        ? Object.freeze({
          protocolVersion: 1,
          current: Object.freeze({
            status: 'queued',
            mode: 'random',
            joinedAt: 2_000,
            expiresAt: 32_000,
          }),
          invitations: Object.freeze([]),
        })
        : kind === 'invite'
          ? Object.freeze({
            protocolVersion: 1,
            current: Object.freeze({
              status: 'offered',
              mode: 'friend',
              sessionId: matchId,
              peerUserId: 'bob',
              role: 'host',
              expiresAt: 32_000,
            }),
            invitations: Object.freeze([]),
          })
          : Object.freeze({
            protocolVersion: 1,
            current: Object.freeze({
              status: 'ready',
              mode: 'friend',
              sessionId: matchId,
              peerUserId: 'bob',
              role: 'guest',
              expiresAt: 32_000,
            }),
            invitations: Object.freeze([]),
          })
      const lateMutation = async (): Promise<OnlineCoopRendezvousSnapshot> => {
        const next = await mutationResponse.promise
        harness.coop.snapshot = next
        return next
      }
      if (kind === 'search') harness.coop.searchRandom.mockImplementationOnce(lateMutation)
      else if (kind === 'invite') harness.coop.inviteFriend.mockImplementationOnce(lateMutation)
      else harness.coop.acceptInvitation.mockImplementationOnce(lateMutation)
      const idle = Object.freeze({
        protocolVersion: 1,
        current: Object.freeze({ status: 'idle' as const }),
        invitations: Object.freeze([]),
      })
      harness.coop.cancelCurrent
        .mockRejectedValueOnce(new Error('coop-mutation-in-progress'))
        .mockImplementationOnce(async () => {
          await finalDelete.promise
          harness.coop.snapshot = idle
          return idle
        })

      const mutation = kind === 'search'
        ? harness.controller.searchRandomCoop!()
        : kind === 'invite'
          ? harness.controller.inviteCoopFriend!('bob')
          : harness.controller.acceptCoopInvitation!(matchId)
      const rejectedMutation = expect(mutation).rejects.toMatchObject({
        code: 'online-connection-cancelled',
      })
      const firstCancel = harness.controller.cancelCoopRendezvous!()
      const secondCancel = harness.controller.cancelCoopRendezvous!()

      expect(secondCancel).toBe(firstCancel)
      expect(harness.coop.cancelCurrent).toHaveBeenCalledOnce()
      mutationResponse.resolve(engaged)
      await rejectedMutation
      await vi.waitFor(() => expect(harness.coop.cancelCurrent).toHaveBeenCalledTimes(2))
      expect(harness.coop.snapshot).toEqual(engaged)
      expect(harness.controller.getState().coopRendezvous?.current).toEqual({ status: 'idle' })

      finalDelete.resolve(undefined)
      await expect(firstCancel).resolves.toEqual(idle)
      await expect(secondCancel).resolves.toEqual(idle)
      expect(harness.controller.getState().coopRendezvous).toEqual(idle)
      harness.controller.disconnect()
    },
  )

  it('exclut symétriquement Coop, matchmaking et session RTC, y compris pendant un POST en vol', async () => {
    const harness = createHarness()
    await connectReady(harness)
    const queuedCoop = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({
        status: 'queued',
        mode: 'random',
        joinedAt: 2_000,
        expiresAt: 32_000,
      }),
      invitations: Object.freeze([]),
    } satisfies OnlineCoopRendezvousSnapshot)
    const coopResponse = deferred<OnlineCoopRendezvousSnapshot>()
    harness.coop.searchRandom.mockImplementationOnce(async () => coopResponse.promise)

    const coopJoin = harness.controller.searchRandomCoop!()
    await expect(harness.controller.invitePeer('bob')).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    await expect(harness.controller.joinMatchmaking!('trade')).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    expect(harness.coordinator.createdRoutes).toHaveLength(0)
    coopResponse.resolve(queuedCoop)
    await expect(coopJoin).resolves.toEqual(queuedCoop)

    harness.coop.snapshot = Object.freeze({
      protocolVersion: 1,
      current: Object.freeze({ status: 'idle' }),
      invitations: Object.freeze([]),
    })
    await harness.controller.cancelCoopRendezvous!()
    await harness.controller.joinMatchmaking!('pvp')
    await expect(harness.controller.searchRandomCoop!()).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    await expect(harness.controller.inviteCoopFriend!('bob')).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    await expect(harness.controller.acceptCoopInvitation!(matchId)).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    expect(harness.coop.searchRandom).toHaveBeenCalledTimes(1)
    expect(harness.coop.inviteFriend).not.toHaveBeenCalled()
    expect(harness.coop.acceptInvitation).not.toHaveBeenCalled()
  })

  it('négocie une invitation sortante, remet le lien RTC puis raccroche proprement', async () => {
    const harness = createHarness()
    await connectReady(harness)

    const linkPromise = harness.controller.invitePeer('bob')
    expect(harness.controller.getState()).toMatchObject({
      status: 'negotiating',
      activePeer: { peerId: 'bob', role: 'offerer' },
    })
    const link = await linkPromise

    expect(harness.controller.getState()).toMatchObject({ status: 'connected', rtcLink: link })
    await expect(harness.controller.invitePeer('stranger')).rejects.toMatchObject({
      code: 'online-peer-not-friend',
    })

    harness.controller.hangUp()
    expect(harness.controller.getState()).toMatchObject({ status: 'ready' })
    expect(harness.controller.getState().activePeer).toBeUndefined()
    expect(harness.controller.getState().rtcLink).toBeUndefined()
    expect(harness.sessions[0]?.closeSpy).toHaveBeenCalledOnce()
  })

  it('injecte la configuration ICE publique dans chaque RTCPeerConnection', async () => {
    const rtcConfiguration: RTCConfiguration = Object.freeze({
      iceServers: [{ urls: ['stun:stun.example.com:3478'] }],
    })
    const harness = createHarness(() => 2_000, undefined, rtcConfiguration)
    await connectReady(harness)

    await harness.controller.invitePeer('bob')

    expect(harness.rtcConfigurations).toEqual([rtcConfiguration])
    expect(harness.rtcConfigurations[0]).toBe(rtcConfiguration)
  })

  it('expose, refuse et accepte exactement les invitations entrantes actives', async () => {
    const harness = createHarness()
    await connectReady(harness)
    const refused = harness.coordinator.invite('bob')

    expect(harness.controller.getState().invitations).toEqual([refused])
    await harness.controller.declinePeerInvitation(refused)
    expect(harness.coordinator.declined).toHaveBeenCalledWith(refused)
    expect(harness.controller.getState().invitations).toEqual([])

    const accepted = harness.coordinator.invite('bob')
    const link = await harness.controller.acceptPeerInvitation(accepted)
    expect(harness.coordinator.claimed).toHaveBeenCalledWith(accepted)
    expect(link.role).toBe('answerer')
    expect(harness.controller.getState()).toMatchObject({ status: 'connected', rtcLink: link })
    await expect(harness.controller.acceptPeerInvitation(accepted)).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
  })

  it('consomme un match offerer avec le peer et le negotiationId exacts', async () => {
    const harness = createHarness()
    await connectReady(harness)
    await expect(harness.controller.joinMatchmaking!('pvp')).resolves.toMatchObject({
      status: 'queued',
      activity: 'pvp',
    })
    harness.matchmaking.status = matchedStatus('pvp', 'offerer')
    const current = await harness.controller.refreshMatchmaking!()
    if (current.status !== 'matched') throw new Error('Match offerer attendu.')

    const link = await harness.controller.consumeMatchmakingMatch!(current)

    expect(link).toMatchObject({
      role: 'offerer',
      descriptor: { peerId: 'bob', negotiationId },
    })
    expect(harness.coordinator.createdRoutes).toHaveLength(1)
    expect(harness.coordinator.createdRoutes[0]?.descriptor).toEqual({ peerId: 'bob', negotiationId })
    expect(harness.controller.getState()).toMatchObject({
      status: 'connected',
      matchmaking: { status: 'idle' },
    })
    expect(harness.matchmaking.cancel).toHaveBeenCalledOnce()
  })

  it("garde le rendez-vous jusqu'à la résolution RTC puis le supprime même après un échec", async () => {
    const connected = deferred<void>()
    const harness = createHarness(() => 2_000, connected.promise)
    await connectReady(harness)
    await harness.controller.joinMatchmaking!('pvp')
    harness.matchmaking.status = matchedStatus('pvp', 'offerer')
    const current = await harness.controller.refreshMatchmaking!()
    if (current.status !== 'matched') throw new Error('Match pvp attendu.')

    const link = harness.controller.consumeMatchmakingMatch!(current)
    expect(harness.controller.getState()).toMatchObject({
      status: 'negotiating',
      matchmaking: { status: 'idle' },
    })
    await expect(harness.controller.cancelMatchmaking!()).rejects.toMatchObject({
      code: 'online-invalid-state',
    })
    expect(harness.matchmaking.cancel).not.toHaveBeenCalled()
    connected.resolve(undefined)
    await expect(link).resolves.toMatchObject({ role: 'offerer' })
    expect(harness.matchmaking.cancel).toHaveBeenCalledOnce()

    const failedConnection = deferred<void>()
    const failingHarness = createHarness(() => 2_000, failedConnection.promise)
    await connectReady(failingHarness)
    await failingHarness.controller.joinMatchmaking!('coop')
    failingHarness.matchmaking.status = matchedStatus('coop', 'offerer')
    const failingMatch = await failingHarness.controller.refreshMatchmaking!()
    if (failingMatch.status !== 'matched') throw new Error('Match coop attendu.')

    const failure = failingHarness.controller.consumeMatchmakingMatch!(failingMatch)
    expect(failingHarness.matchmaking.cancel).not.toHaveBeenCalled()
    failedConnection.reject(new Error('RTC indisponible'))
    await expect(failure).rejects.toThrow('RTC indisponible')
    expect(failingHarness.matchmaking.cancel).toHaveBeenCalledOnce()
    expect(failingHarness.controller.getState().matchmaking).toEqual({ status: 'idle' })
  })

  it('réserve le join avant le premier await et refuse un second POST concurrent', async () => {
    const harness = createHarness()
    await connectReady(harness)
    const response = deferred<OnlineMatchmakingStatus>()
    harness.matchmaking.join.mockImplementationOnce(async () => {
      const next = await response.promise
      harness.matchmaking.status = next
      return next
    })

    const first = harness.controller.joinMatchmaking!('trade')
    const second = harness.controller.joinMatchmaking!('trade')

    await expect(second).rejects.toMatchObject({ code: 'online-invalid-state' })
    expect(harness.matchmaking.join).toHaveBeenCalledTimes(1)
    const queued = Object.freeze({
      status: 'queued',
      activity: 'trade',
      joinedAt: 1_000,
      expiresAt: 31_000,
    } as const)
    response.resolve(queued)
    await expect(first).resolves.toEqual(queued)
    expect(harness.controller.getState().matchmaking).toEqual(queued)
  })

  it('coalesce les cancel concurrents et réconcilie un join résolu après le premier DELETE', async () => {
    const harness = createHarness()
    await connectReady(harness)
    const joinResponse = deferred<OnlineMatchmakingStatus>()
    const immediateDelete = deferred<void>()
    const reconciliationDelete = deferred<void>()
    harness.matchmaking.join.mockImplementationOnce(async () => {
      const next = await joinResponse.promise
      harness.matchmaking.status = next
      return next
    })
    harness.matchmaking.cancel
      .mockImplementationOnce(async () => {
        await immediateDelete.promise
        harness.matchmaking.status = Object.freeze({ status: 'idle' })
      })
      .mockImplementationOnce(async () => {
        await reconciliationDelete.promise
        harness.matchmaking.status = Object.freeze({ status: 'idle' })
      })

    const join = harness.controller.joinMatchmaking!('pvp')
    const rejectedJoin = expect(join).rejects.toMatchObject({ code: 'online-connection-cancelled' })
    const firstCancel = harness.controller.cancelMatchmaking!()
    const secondCancel = harness.controller.cancelMatchmaking!()

    expect(secondCancel).toBe(firstCancel)
    expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(1)
    immediateDelete.resolve(undefined)
    await vi.waitFor(() => expect(harness.matchmaking.status).toEqual({ status: 'idle' }))

    const queued = Object.freeze({
      status: 'queued',
      activity: 'pvp',
      joinedAt: 1_000,
      expiresAt: 31_000,
    } as const)
    joinResponse.resolve(queued)
    await rejectedJoin
    await vi.waitFor(() => expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(2))
    expect(harness.matchmaking.status).toEqual(queued)
    await expect(harness.controller.joinMatchmaking!('coop')).rejects.toMatchObject({
      code: 'online-invalid-state',
    })

    reconciliationDelete.resolve(undefined)
    await expect(firstCancel).resolves.toBeUndefined()
    await expect(secondCancel).resolves.toBeUndefined()
    expect(harness.matchmaking.status).toEqual({ status: 'idle' })
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
  })

  it('refait un DELETE de nettoyage si un join se termine après la déconnexion', async () => {
    const harness = createHarness()
    await connectReady(harness)
    const joinResponse = deferred<OnlineMatchmakingStatus>()
    harness.matchmaking.join.mockImplementationOnce(async () => {
      const next = await joinResponse.promise
      harness.matchmaking.status = next
      return next
    })

    const join = harness.controller.joinMatchmaking!('coop')
    const rejectedJoin = expect(join).rejects.toMatchObject({ code: 'online-connection-cancelled' })
    harness.controller.disconnect()
    expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(1)

    const queued = Object.freeze({
      status: 'queued',
      activity: 'coop',
      joinedAt: 1_000,
      expiresAt: 31_000,
    } as const)
    joinResponse.resolve(queued)
    await rejectedJoin
    await vi.waitFor(() => expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(2))
    expect(harness.matchmaking.status).toEqual({ status: 'idle' })
    expect(harness.controller.getState()).toMatchObject({
      status: 'disconnected',
      matchmaking: { status: 'idle' },
    })
  })

  it('invalide un refresh en vol dès la consommation et refuse de réarmer un match avec un peer actif', async () => {
    const harness = createHarness()
    await connectReady(harness)
    await harness.controller.joinMatchmaking!('trade')
    harness.matchmaking.status = matchedStatus('trade', 'offerer')
    const current = await harness.controller.refreshMatchmaking!()
    if (current.status !== 'matched') throw new Error('Match trade attendu.')

    const lateStatus = deferred<OnlineMatchmakingStatus>()
    harness.matchmaking.getStatus.mockImplementationOnce(async () => lateStatus.promise)
    const snapshots: OnlineMatchmakingStatus[] = []
    const unsubscribe = harness.controller.subscribe((next) => {
      if (next.activePeer && next.matchmaking) snapshots.push(next.matchmaking)
    })
    const refresh = harness.controller.refreshMatchmaking!()
    const link = harness.controller.consumeMatchmakingMatch!(current)

    expect(harness.controller.getState()).toMatchObject({
      status: 'negotiating',
      matchmaking: { status: 'idle' },
    })
    lateStatus.resolve(current)
    await expect(refresh).rejects.toMatchObject({ code: 'online-connection-cancelled' })
    await expect(link).resolves.toMatchObject({ role: 'offerer' })
    expect(snapshots).not.toContainEqual(current)
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })

    harness.matchmaking.status = current
    await expect(harness.controller.refreshMatchmaking!()).rejects.toThrow('session pair-à-pair')
    await vi.waitFor(() => expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(2))
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
    unsubscribe()
  })

  it("rejette une activité changée et toute copie altérée du match courant", async () => {
    const harness = createHarness()
    await connectReady(harness)
    await harness.controller.joinMatchmaking!('trade')
    harness.matchmaking.status = matchedStatus('pvp', 'offerer')
    await expect(harness.controller.refreshMatchmaking!()).rejects.toThrow('activité')
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
    expect(harness.matchmaking.cancel).toHaveBeenCalledOnce()

    await harness.controller.joinMatchmaking!('trade')
    harness.matchmaking.status = matchedStatus('trade', 'offerer')
    const current = await harness.controller.refreshMatchmaking!()
    if (current.status !== 'matched') throw new Error('Match trade attendu.')
    await expect(harness.controller.consumeMatchmakingMatch!({
      ...current,
      peerUserId: 'mallory',
    })).rejects.toMatchObject({ code: 'online-invalid-state' })
    await expect(harness.controller.consumeMatchmakingMatch!({
      ...current,
      negotiationId: `${'X'.repeat(21)}g`,
    })).rejects.toMatchObject({ code: 'online-invalid-state' })
    await expect(harness.controller.consumeMatchmakingMatch!({
      ...current,
      activity: 'coop',
    })).rejects.toMatchObject({ code: 'online-invalid-state' })
    expect(harness.coordinator.createdRoutes).toEqual([])
  })

  it("laisse l'answerer attendre puis ne réclame que l'invitation exacte du match", async () => {
    const harness = createHarness()
    await connectReady(harness)
    await harness.controller.joinMatchmaking!('coop')
    harness.matchmaking.status = matchedStatus('coop', 'answerer')
    const current = await harness.controller.refreshMatchmaking!()
    if (current.status !== 'matched') throw new Error('Match answerer attendu.')

    await expect(harness.controller.consumeMatchmakingMatch!(current)).resolves.toBeUndefined()
    const wrong = harness.coordinator.inviteExact('bob', `${'W'.repeat(21)}A`)
    await expect(harness.controller.consumeMatchmakingMatch!(current)).resolves.toBeUndefined()
    expect(harness.coordinator.claimed).not.toHaveBeenCalled()

    const exact = harness.coordinator.inviteExact('bob', negotiationId)
    await expect(harness.controller.consumeMatchmakingMatch!(current)).resolves.toMatchObject({
      role: 'answerer',
      descriptor: exact.descriptor,
    })
    expect(harness.coordinator.claimed).toHaveBeenCalledTimes(1)
    expect(harness.coordinator.claimed).toHaveBeenCalledWith(exact)
    expect(harness.controller.getState().invitations).toContain(wrong)
  })

  it('annule explicitement, expire honnêtement et nettoie en best-effort à la déconnexion', async () => {
    const harness = createHarness()
    await connectReady(harness)
    await harness.controller.joinMatchmaking!('trade')
    await harness.controller.cancelMatchmaking!()
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
    expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(1)

    await harness.controller.joinMatchmaking!('pvp')
    harness.matchmaking.status = matchedStatus('pvp', 'offerer', { expiresAt: 1_500 })
    await expect(harness.controller.refreshMatchmaking!()).resolves.toEqual({ status: 'idle' })
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
    expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(2)

    await harness.controller.joinMatchmaking!('coop')
    harness.controller.disconnect()
    await vi.waitFor(() => expect(harness.matchmaking.cancel).toHaveBeenCalledTimes(3))
    expect(harness.controller.getState().matchmaking).toEqual({ status: 'idle' })
  })

  it('annule une connexion en cours, efface le jeton et ignore un ready tardif', async () => {
    const harness = createHarness()
    const connection = harness.controller.connect('ephemeral-secret')
    await vi.waitFor(() => expect(harness.signaling.listenerCount()).toBeGreaterThan(0))

    harness.controller.disconnect()
    await expect(connection).rejects.toMatchObject({ code: 'online-connection-cancelled' })
    expect(harness.readCapturedToken()).toBeUndefined()
    expect(harness.controller.getState().status).toBe('disconnected')

    harness.signaling.ready()
    expect(harness.controller.getState().status).toBe('disconnected')
  })

  it('ferme toutes les ressources si les identités REST et WebSocket divergent', async () => {
    const harness = createHarness()
    const connection = harness.controller.connect('ephemeral-secret')
    await vi.waitFor(() => expect(harness.signaling.listenerCount()).toBeGreaterThan(0))

    harness.signaling.ready('mallory')

    await expect(connection).rejects.toMatchObject({ code: 'online-identity-mismatch' })
    expect(harness.controller.getState()).toMatchObject({
      status: 'failed',
      error: { code: 'online-identity-mismatch' },
    })
    expect(harness.readCapturedToken()).toBeUndefined()
    expect(harness.signaling.listenerCount()).toBe(0)
  })

  it('reste utilisable hors ligne quand aucune URL publique n’est configurée', async () => {
    const controller = createOnlineProductController({})
    expect(controller.getState()).toMatchObject({ configured: false, status: 'disconnected' })
    await expect(controller.connect('token')).rejects.toMatchObject({ code: 'online-not-configured' })
  })
})
