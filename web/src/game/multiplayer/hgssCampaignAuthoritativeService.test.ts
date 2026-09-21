import { Buffer } from 'node:buffer'
import { describe, expect, it, vi } from 'vitest'
import { createHgssCampaignClientGateway } from './hgssCampaignClientGateway'
import type { HgssCampaignClientCommand, HgssCampaignServerSnapshot } from './hgssCampaignProtocol'
import { isBrowserMultiplayerCampaignConnectionReplacedError } from './browserMultiplayerCampaignPort'
import {
  createHgssCampaignAuthoritativeService,
  HgssCampaignAuthoritativeServiceError,
  type HgssCampaignAuthoritativeWebSocket,
} from './hgssCampaignAuthoritativeService'

const sessionId = opaqueId(1)
const ticket = Buffer.alloc(32, 7).toString('base64url')

function opaqueId(marker: number): string {
  const bytes = Buffer.alloc(16)
  bytes.writeUInt32BE(marker, 12)
  return bytes.toString('base64url')
}

function player(playerId: string, x: number) {
  return {
    playerId,
    displayName: playerId === 'alice' ? 'ALICE' : 'BOB',
    gender: playerId === 'alice' ? 'female' as const : 'male' as const,
    state: 'active' as const,
    position: { mapId: 7, x, z: 4, direction: 'east' as const },
    spriteId: playerId === 'alice' ? 97 : 0,
    movementSequence: 0,
  }
}

function snapshot(players: readonly ReturnType<typeof player>[], revision: number): HgssCampaignServerSnapshot {
  return {
    protocolVersion: 2,
    sessionId,
    revision,
    players,
    sharedProgression: { milestoneIds: [], counters: [] },
    pendingEvents: [],
  }
}

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

class FakeSocket {
  readyState = 0
  readonly sent: string[] = []
  readonly listeners = new Map<string, Set<(event: never) => void>>()

  addEventListener(kind: string, listener: (event: never) => void): void {
    const listeners = this.listeners.get(kind) ?? new Set()
    listeners.add(listener)
    this.listeners.set(kind, listeners)
  }

  removeEventListener(kind: string, listener: (event: never) => void): void {
    this.listeners.get(kind)?.delete(listener)
  }

  send(data: string): void { this.sent.push(data) }

  close(code = 1000): void {
    if (this.readyState === 3) return
    this.readyState = 3
    this.dispatch('close', { code })
  }

  open(): void {
    this.readyState = 1
    this.dispatch('open', {})
  }

  receive(value: unknown): void {
    this.dispatch('message', { data: JSON.stringify(value) })
  }

  private dispatch(kind: string, event: unknown): void {
    for (const listener of this.listeners.get(kind) ?? []) listener(event as never)
  }
}

function preparation() {
  return {
    sessionId,
    localParticipantId: 'alice',
    remoteParticipantId: 'bob',
    compatibility: { applicationId: 'IPKF', release: 1, locale: 2 },
    player: {
      displayName: 'ALICE',
      gender: 'female' as const,
      position: { mapId: 7, x: 3, z: 4, direction: 'east' as const },
      spriteId: 97,
    },
  }
}

describe('autorité serveur de campagne HGSS', () => {
  it("réattache l'hôte direct à un roster durable complet sans le recréer", async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 8)
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') {
        expect(init?.method).toBe('POST')
        return json({ snapshot: joined }, 200)
      }
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => new FakeSocket() as unknown as HgssCampaignAuthoritativeWebSocket,
    })

    await expect(service.prepareHost({
      ...preparation(),
      allowProvisionalHostSnapshot: true,
    })).resolves.toEqual(expect.objectContaining({
      connect: expect.any(Function),
      disconnect: expect.any(Function),
    }))
  })

  it('atteste les transitions uniquement avec le calcul ROM hôte et reprend exactement son arrivée', async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
    const arrival = { mapId: 8, x: 2, z: 6, direction: 'south' as const }
    const transition: Extract<HgssCampaignClientCommand, { kind: 'movement' }> = {
      protocolVersion: 2,
      commandId: 'campaign-command:warp:1',
      expectedRevision: 1,
      kind: 'movement',
      sequence: 1,
      from: player('bob', 9).position,
      to: { ...player('bob', 9).position, x: 10 },
      arrival,
      mode: 'walk',
    }
    const movementAdmission = vi.fn()
      .mockReturnValueOnce({ kind: 'accept', authoritativePosition: arrival })
      .mockReturnValueOnce({
        kind: 'accept',
        authoritativePosition: { ...arrival, x: arrival.x + 1 },
      })
    const sharedEvent: Extract<HgssCampaignClientCommand, { kind: 'shared-event' }> = {
      protocolVersion: 2,
      commandId: 'campaign-command:field-event:1',
      expectedRevision: joined.revision,
      kind: 'shared-event',
      eventId: 'field-event.1.IPKE.7.2.1p.o.7.2bf',
      milestoneIds: ['field.flag.0010'],
      counters: [
        { id: 'field.progression-revision', expectedValue: null, value: 1 },
      ],
    }
    const sharedEventAdmission = vi.fn()
      .mockReturnValueOnce({ kind: 'accept' })
      .mockReturnValueOnce({
        kind: 'reject',
        code: 'field-script-rejected',
        message: 'Le script ne correspond pas à la ROM hôte.',
      })
      .mockReturnValueOnce({ kind: 'accept', extra: true })
      .mockReturnValueOnce({
        kind: 'reject',
        code: 'field-script-rejected',
        message: 'x'.repeat(513),
      })
      .mockImplementationOnce(() => { throw new Error('ROM unavailable') })
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const socket = new FakeSocket()
    let requestSerial = 40
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => socket as unknown as HgssCampaignAuthoritativeWebSocket,
      requestIdFactory: () => opaqueId(requestSerial++),
    })
    const transport = await service.prepareHost({
      ...preparation(),
      movementAdmission,
      sharedEventAdmission,
    })
    const connection = Promise.resolve(transport.connect({
      onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn(),
    }))
    await vi.waitFor(() => expect(socket.listeners.get('message')?.size).toBe(1))
    socket.open()
    socket.receive({ type: 'ready', version: 1, userId: 'alice' })
    const attach = JSON.parse(socket.sent.at(-1)!)
    socket.receive({ type: 'attached', requestId: attach.requestId, snapshot: joined })
    await connection

    const firstAdmissionId = opaqueId(70)
    socket.receive({
      type: 'admission-request', admissionId: firstAdmissionId, sessionId,
      playerId: 'bob', command: transition, snapshot: joined,
    })
    expect(movementAdmission).toHaveBeenCalledWith({
      sessionId,
      playerId: 'bob',
      command: transition,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: firstAdmissionId,
      decision: { kind: 'accept', arrival },
    })

    const secondAdmissionId = opaqueId(71)
    socket.receive({
      type: 'admission-request', admissionId: secondAdmissionId, sessionId,
      playerId: 'bob', command: transition, snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: secondAdmissionId,
      decision: { kind: 'reject', code: 'world-admission-invalid' },
    })

    const acceptedEventAdmissionId = opaqueId(72)
    socket.receive({
      type: 'admission-request',
      admissionId: acceptedEventAdmissionId,
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(sharedEventAdmission).toHaveBeenCalledWith({
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: acceptedEventAdmissionId,
      decision: { kind: 'accept' },
    })

    const rejectedEventAdmissionId = opaqueId(73)
    socket.receive({
      type: 'admission-request',
      admissionId: rejectedEventAdmissionId,
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: rejectedEventAdmissionId,
      decision: { kind: 'reject', code: 'field-script-rejected' },
    })

    const invalidEventAdmissionId = opaqueId(74)
    socket.receive({
      type: 'admission-request',
      admissionId: invalidEventAdmissionId,
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: invalidEventAdmissionId,
      decision: { kind: 'reject', code: 'shared-event-admission-invalid' },
    })

    const oversizedEventAdmissionId = opaqueId(75)
    socket.receive({
      type: 'admission-request',
      admissionId: oversizedEventAdmissionId,
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: oversizedEventAdmissionId,
      decision: { kind: 'reject', code: 'shared-event-admission-invalid' },
    })

    const failedEventAdmissionId = opaqueId(76)
    socket.receive({
      type: 'admission-request',
      admissionId: failedEventAdmissionId,
      sessionId,
      playerId: 'bob',
      command: sharedEvent,
      snapshot: joined,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: failedEventAdmissionId,
      decision: { kind: 'reject', code: 'shared-event-admission-failed' },
    })
    await transport.disconnect()
  })

  it("atteste l'admission initiale invitée sur le snapshot provisoire de l'hôte", async () => {
    const provisional = snapshot([player('alice', 3)], 0)
    const guestCompatibility = { applicationId: 'IPKF', release: 1, locale: 2 }
    const guestPlayer = {
      displayName: 'BOB',
      gender: 'male' as const,
      position: player('bob', 9).position,
      spriteId: 0,
    }
    const guestJoinAdmission = vi.fn()
      .mockReturnValueOnce({ kind: 'accept' })
      .mockReturnValueOnce({
        kind: 'reject',
        code: 'position-occupied',
        message: 'La case est déjà occupée.',
      })
      .mockReturnValueOnce({ kind: 'accept', extra: true })
      .mockImplementationOnce(() => { throw new Error('ROM unavailable') })
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') return json({ snapshot: provisional }, 201)
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const socket = new FakeSocket()
    let requestSerial = 180
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => socket as unknown as HgssCampaignAuthoritativeWebSocket,
      requestIdFactory: () => opaqueId(requestSerial++),
    })
    const transport = await service.prepareHost({
      ...preparation(),
      allowProvisionalHostSnapshot: true,
      guestJoinAdmission,
    })
    const connection = Promise.resolve(transport.connect({
      onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError: vi.fn(),
    }))
    await vi.waitFor(() => expect(socket.listeners.get('message')?.size).toBe(1))
    socket.open()
    socket.receive({ type: 'ready', version: 1, userId: 'alice' })
    const attach = JSON.parse(socket.sent.at(-1)!)
    socket.receive({ type: 'attached', requestId: attach.requestId, snapshot: provisional })
    await connection

    const sendJoinAdmission = (admissionId: string): void => socket.receive({
      type: 'join-admission-request',
      admissionId,
      sessionId,
      playerId: 'bob',
      compatibility: guestCompatibility,
      player: guestPlayer,
      snapshot: provisional,
    })
    const acceptedId = opaqueId(200)
    sendJoinAdmission(acceptedId)
    expect(guestJoinAdmission).toHaveBeenCalledWith({
      sessionId,
      playerId: 'bob',
      compatibility: guestCompatibility,
      player: guestPlayer,
      snapshot: provisional,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: acceptedId,
      decision: { kind: 'accept' },
    })

    const rejectedId = opaqueId(201)
    sendJoinAdmission(rejectedId)
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: rejectedId,
      decision: { kind: 'reject', code: 'position-occupied' },
    })

    const invalidId = opaqueId(202)
    sendJoinAdmission(invalidId)
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: invalidId,
      decision: { kind: 'reject', code: 'guest-join-admission-invalid' },
    })

    const failedId = opaqueId(203)
    sendJoinAdmission(failedId)
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId: failedId,
      decision: { kind: 'reject', code: 'guest-join-admission-failed' },
    })
    await transport.disconnect()
  })

  it("ferme la route si une demande d'admission d'événement diverge du snapshot", async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') {
        return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      }
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const socket = new FakeSocket()
    const sharedEventAdmission = vi.fn(() => ({ kind: 'accept' as const }))
    let requestSerial = 140
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => socket as unknown as HgssCampaignAuthoritativeWebSocket,
      requestIdFactory: () => opaqueId(requestSerial++),
    })
    const transport = await service.prepareHost({ ...preparation(), sharedEventAdmission })
    const onError = vi.fn()
    const connection = Promise.resolve(transport.connect({
      onSnapshot: vi.fn(), onDisconnect: vi.fn(), onError,
    }))
    await vi.waitFor(() => expect(socket.listeners.get('message')?.size).toBe(1))
    socket.open()
    socket.receive({ type: 'ready', version: 1, userId: 'alice' })
    const attach = JSON.parse(socket.sent.at(-1)!)
    socket.receive({ type: 'attached', requestId: attach.requestId, snapshot: joined })
    await connection

    socket.receive({
      type: 'admission-request',
      admissionId: opaqueId(170),
      sessionId,
      playerId: 'bob',
      command: {
        protocolVersion: 2,
        commandId: 'campaign-command:field-event:stale',
        expectedRevision: joined.revision + 1,
        kind: 'shared-event',
        eventId: 'field-event.1.IPKE.7.2.1p.o.7.2bf',
        milestoneIds: [],
        counters: [],
      },
      snapshot: joined,
    })
    await vi.waitFor(() => expect(socket.readyState).toBe(3))
    expect(sharedEventAdmission).not.toHaveBeenCalled()
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ code: 'invalid-message' }))
  })

  it('se réattache après une coupure, resynchronise et ne rejoue jamais une commande incertaine', async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
    const moved: HgssCampaignServerSnapshot = {
      ...joined,
      revision: 2,
      players: [
        { ...player('alice', 4), movementSequence: 1 },
        player('bob', 9),
      ],
    }
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const sockets: FakeSocket[] = []
    let requestSerial = 80
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as HgssCampaignAuthoritativeWebSocket
      },
      requestIdFactory: () => opaqueId(requestSerial++),
      reconnectDelaysMs: [0],
    })
    const transport = await service.prepareHost(preparation())
    const onSnapshot = vi.fn()
    const onDisconnect = vi.fn()
    const connection = Promise.resolve(transport.connect({
      onSnapshot, onDisconnect, onError: vi.fn(),
    }))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const first = sockets[0]!
    first.open()
    first.receive({ type: 'ready', version: 1, userId: 'alice' })
    const firstAttach = JSON.parse(first.sent.at(-1)!)
    first.receive({ type: 'attached', requestId: firstAttach.requestId, snapshot: joined })
    await connection

    const command: HgssCampaignClientCommand = {
      protocolVersion: 2,
      commandId: 'campaign-command:uncertain:1',
      expectedRevision: 1,
      kind: 'movement',
      sequence: 1,
      from: player('alice', 3).position,
      to: player('alice', 4).position,
      mode: 'walk',
    }
    const uncertain = transport.send(command)
    expect(JSON.parse(first.sent.at(-1)!)).toMatchObject({ type: 'command', command })
    first.close(1006)

    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    const second = sockets[1]!
    second.open()
    second.receive({ type: 'ready', version: 1, userId: 'alice' })
    const secondAttach = JSON.parse(second.sent.at(-1)!)
    second.receive({ type: 'attached', requestId: secondAttach.requestId, snapshot: moved })

    await expect(uncertain).rejects.toMatchObject({ code: 'command-outcome-uncertain' })
    expect(onSnapshot).toHaveBeenLastCalledWith(moved)
    expect(onDisconnect).not.toHaveBeenCalled()
    expect(second.sent.map((frame) => JSON.parse(frame))).toEqual([
      { type: 'attach', requestId: secondAttach.requestId, sessionId },
    ])
    await transport.disconnect()
  })

  it("cède localement une campagne reprise par un appareil plus récent sans reconnecter ni quitter l'adhésion", async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') {
        return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      }
      if (pathname === '/v1/realtime-ticket') {
        return json({ ticket, expiresInMs: 15_000 }, 201)
      }
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const sockets: FakeSocket[] = []
    let requestSerial = 85
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as HgssCampaignAuthoritativeWebSocket
      },
      requestIdFactory: () => opaqueId(requestSerial++),
      reconnectDelaysMs: [0, 0],
    })
    const transport = await service.prepareHost(preparation())
    const onError = vi.fn()
    const onDisconnect = vi.fn()
    const connection = Promise.resolve(transport.connect({
      onSnapshot: vi.fn(), onDisconnect, onError,
    }))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const first = sockets[0]!
    first.open()
    first.receive({ type: 'ready', version: 1, userId: 'alice' })
    const attach = JSON.parse(first.sent.at(-1)!)
    first.receive({ type: 'attached', requestId: attach.requestId, snapshot: joined })
    await connection

    first.close(4_000)
    await vi.waitFor(() => expect(onError).toHaveBeenCalledOnce())
    expect(isBrowserMultiplayerCampaignConnectionReplacedError(onError.mock.calls[0]?.[0])).toBe(true)
    await new Promise<void>((resolve) => setTimeout(resolve, 10))
    expect(sockets).toHaveLength(1)
    expect(onDisconnect).not.toHaveBeenCalled()

    await transport.disconnect()
    expect(fetch.mock.calls.filter(([input]) => (
      new URL(input).pathname.endsWith('/members/me')
    ))).toHaveLength(0)
    expect(fetch.mock.calls.filter(([input]) => (
      new URL(input).pathname === '/v1/realtime-ticket'
    ))).toHaveLength(1)
  })

  it('conserve la requestSnapshot créée par un saut de révision pendant le réattachement', async () => {
    const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
    const resumed = snapshot([player('alice', 3), player('bob', 9)], 3)
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const sockets: FakeSocket[] = []
    let requestSerial = 90
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => {
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as HgssCampaignAuthoritativeWebSocket
      },
      requestIdFactory: () => opaqueId(requestSerial++),
      reconnectDelaysMs: [0],
    })
    const gateway = createHgssCampaignClientGateway({
      transport: await service.prepareHost(preparation()),
      localParticipantId: 'alice',
    })
    const connection = gateway.connect()
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const first = sockets[0]!
    first.open()
    first.receive({ type: 'ready', version: 1, userId: 'alice' })
    const firstAttach = JSON.parse(first.sent.at(-1)!)
    first.receive({ type: 'attached', requestId: firstAttach.requestId, snapshot: joined })
    await vi.waitFor(() => expect(first.sent.some((frame) => JSON.parse(frame).type === 'request-snapshot')).toBe(true))
    const firstSnapshotRequest = first.sent.map((frame) => JSON.parse(frame))
      .find((frame) => frame.type === 'request-snapshot')
    first.receive({ type: 'snapshot-response', requestId: firstSnapshotRequest.requestId, snapshot: joined })
    await connection

    first.close(1006)
    await vi.waitFor(() => expect(sockets).toHaveLength(2))
    const second = sockets[1]!
    second.open()
    second.receive({ type: 'ready', version: 1, userId: 'alice' })
    const secondAttach = JSON.parse(second.sent.at(-1)!)
    second.receive({ type: 'attached', requestId: secondAttach.requestId, snapshot: resumed })
    await vi.waitFor(() => expect(second.sent.some((frame) => JSON.parse(frame).type === 'request-snapshot')).toBe(true))
    const resynchronization = second.sent.map((frame) => JSON.parse(frame))
      .find((frame) => frame.type === 'request-snapshot')
    second.receive({
      type: 'snapshot-response', requestId: resynchronization.requestId, snapshot: resumed,
    })
    await vi.waitFor(() => expect(gateway.getState()).toMatchObject({
      status: 'connected', snapshot: { revision: 3 },
    }))

    await gateway.disconnect()
  })

  it("interdit à l'invité de fournir un port d'attestation", async () => {
    const joined = snapshot([player('bob', 9), player('alice', 3)], 1)
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch: async () => json({ snapshot: joined }),
    })

    await expect(service.prepareGuest({
      ...preparation(),
      movementAdmission: () => ({ kind: 'accept' }),
    })).rejects.toThrow("La route d'autorité serveur de la campagne est invalide.")
    await expect(service.prepareGuest({
      ...preparation(),
      sharedEventAdmission: () => ({ kind: 'accept' }),
    })).rejects.toThrow("La route d'autorité serveur de la campagne est invalide.")
    await expect(service.prepareGuest({
      ...preparation(),
      sharedProgression: { milestoneIds: ['field.schema.v1'], counters: [] },
    })).rejects.toThrow("La route d'autorité serveur de la campagne est invalide.")
    await expect(service.prepareGuest({
      ...preparation(),
      guestJoinAdmission: () => ({ kind: 'accept' }),
    })).rejects.toThrow("La route d'autorité serveur de la campagne est invalide.")
    await expect(service.prepareGuest({
      ...preparation(),
      allowProvisionalHostSnapshot: true,
    })).rejects.toThrow("La route d'autorité serveur de la campagne est invalide.")
  })

  it('prépare la session, attend les deux comptes et acquitte snapshot puis mouvement', async () => {
    const sharedProgression = {
      milestoneIds: ['field.schema.v1', 'field.branch.heartgold'],
      counters: [{ id: 'field.progression.revision', value: 7 }],
    }
    const host = { ...snapshot([player('alice', 3)], 0), sharedProgression }
    const joined = { ...snapshot([player('alice', 3), player('bob', 9)], 1), sharedProgression }
    const moved: HgssCampaignServerSnapshot = {
      ...joined,
      revision: 2,
      players: [
        { ...player('alice', 4), movementSequence: 1 },
        player('bob', 9),
      ],
    }
    const fetch = vi.fn(async (input: string, init?: RequestInit) => {
      const url = new URL(input)
      if (url.pathname === '/v1/shared-sessions') {
        expect(init?.method).toBe('POST')
        expect(JSON.parse(String(init?.body))).toEqual({
          sessionId,
          peerUserId: 'bob',
          compatibility: preparation().compatibility,
          player: preparation().player,
          sharedProgression,
        })
        return json({ snapshot: host }, 201)
      }
      if (url.pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (url.pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${url.pathname}`)
    })
    const sockets: FakeSocket[] = []
    let requestSerial = 10
    const guestJoinAdmission = vi.fn(() => ({ kind: 'accept' as const }))
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: (_url, protocol) => {
        expect(protocol).toBe('authoritative-session.v1')
        const socket = new FakeSocket()
        sockets.push(socket)
        return socket as unknown as HgssCampaignAuthoritativeWebSocket
      },
      requestIdFactory: () => opaqueId(requestSerial++),
    })

    const transport = await service.prepareHost({
      ...preparation(),
      sharedProgression,
      guestJoinAdmission,
    })
    const onSnapshot = vi.fn()
    const connection = Promise.resolve(transport.connect({
      onSnapshot,
      onDisconnect: vi.fn(),
      onError: vi.fn(),
    }))
    await vi.waitFor(() => expect(sockets).toHaveLength(1))
    const socket = sockets[0]!
    socket.open()
    socket.receive({ type: 'ready', version: 1, userId: 'alice' })
    const attach = JSON.parse(socket.sent.at(-1)!)
    expect(attach).toMatchObject({ type: 'attach', sessionId })
    socket.receive({
      type: 'attached',
      attachmentId: 'c3Nzc3Nzc3Nzc3Nzc3Nzcw',
      requestId: attach.requestId,
      snapshot: host,
    })
    expect(onSnapshot).not.toHaveBeenCalled()
    const admissionId = opaqueId(9)
    const joiningPlayer = {
      displayName: 'BOB',
      gender: 'male' as const,
      position: player('bob', 9).position,
      spriteId: 0,
    }
    socket.receive({
      type: 'join-admission-request',
      admissionId,
      sessionId,
      playerId: 'bob',
      compatibility: preparation().compatibility,
      player: joiningPlayer,
      snapshot: host,
    })
    expect(guestJoinAdmission).toHaveBeenCalledWith({
      sessionId,
      playerId: 'bob',
      compatibility: preparation().compatibility,
      player: joiningPlayer,
      snapshot: host,
    })
    expect(JSON.parse(socket.sent.at(-1)!)).toEqual({
      type: 'admission-response',
      admissionId,
      decision: { kind: 'accept' },
    })
    socket.receive({ type: 'snapshot', snapshot: joined })
    await connection
    expect(onSnapshot).toHaveBeenLastCalledWith(joined)

    const snapshotRequest = transport.requestSnapshot()
    const requestFrame = JSON.parse(socket.sent.at(-1)!)
    socket.receive({ type: 'snapshot-response', requestId: requestFrame.requestId, snapshot: joined })
    await expect(snapshotRequest).resolves.toEqual(joined)

    const command: HgssCampaignClientCommand = {
      protocolVersion: 2,
      commandId: 'campaign-command:test:1',
      expectedRevision: 1,
      kind: 'movement',
      sequence: 1,
      from: player('alice', 3).position,
      to: player('alice', 4).position,
      mode: 'walk',
    }
    const sent = transport.send(command)
    const commandFrame = JSON.parse(socket.sent.at(-1)!)
    expect(commandFrame).toMatchObject({ type: 'command', command })
    socket.receive({
      type: 'command-accepted',
      requestId: commandFrame.requestId,
      appliedRevision: 2,
      replayed: false,
      snapshot: moved,
    })
    await expect(sent).resolves.toEqual({ appliedRevision: 2, replayed: false, snapshot: moved })

    await transport.disconnect()
    expect(fetch).toHaveBeenCalledWith(
      `https://lan.test/v1/shared-sessions/${encodeURIComponent(sessionId)}/members/me`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({
          'Shared-Attachment': 'c3Nzc3Nzc3Nzc3Nzc3Nzcw',
        }),
      }),
    )
  })

  it('tolère un command-accepted tardif après timeout et conserve le transport resynchronisable', async () => {
    vi.useFakeTimers()
    try {
      const host = snapshot([player('alice', 3)], 0)
      const joined = snapshot([player('alice', 3), player('bob', 9)], 1)
      const moved: HgssCampaignServerSnapshot = {
        ...joined,
        revision: 2,
        players: [{ ...player('alice', 4), movementSequence: 1 }, player('bob', 9)],
      }
      const fetch = vi.fn(async (input: string) => {
        const pathname = new URL(input).pathname
        if (pathname === '/v1/shared-sessions') return json({ snapshot: host }, 201)
        if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
        if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
        throw new Error(`Route inattendue : ${pathname}`)
      })
      const socket = new FakeSocket()
      let requestSerial = 120
      const service = createHgssCampaignAuthoritativeService({
        config: {
          httpBaseUrl: 'https://lan.test',
          identityBaseUrl: 'https://identity.test',
          webSocketBaseUrl: 'wss://lan.test',
        },
        accountSession: {
          getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
          readAccessToken: () => 'access-token',
        },
        fetch,
        socketFactory: () => socket as unknown as HgssCampaignAuthoritativeWebSocket,
        requestIdFactory: () => opaqueId(requestSerial++),
        requestTimeoutMs: 1_000,
      })
      const transport = await service.prepareHost(preparation())
      const onSnapshot = vi.fn()
      const onError = vi.fn()
      const connection = Promise.resolve(transport.connect({
        onSnapshot, onDisconnect: vi.fn(), onError,
      }))
      await vi.waitFor(() => expect(socket.listeners.get('message')?.size).toBe(1))
      socket.open()
      socket.receive({ type: 'ready', version: 1, userId: 'alice' })
      const attach = JSON.parse(socket.sent.at(-1)!)
      socket.receive({ type: 'attached', requestId: attach.requestId, snapshot: joined })
      await connection

      const command: HgssCampaignClientCommand = {
        protocolVersion: 2,
        commandId: 'command:late-ack',
        expectedRevision: 1,
        kind: 'movement',
        sequence: 1,
        from: player('alice', 3).position,
        to: player('alice', 4).position,
        mode: 'walk',
      }
      const pending = transport.send(command)
      const commandFrame = JSON.parse(socket.sent.at(-1)!)
      const timeout = expect(pending).rejects.toMatchObject({ code: 'request-timeout' })
      await vi.advanceTimersByTimeAsync(1_000)
      await timeout

      socket.receive({
        type: 'command-accepted',
        requestId: commandFrame.requestId,
        appliedRevision: 2,
        replayed: false,
        snapshot: moved,
      })
      expect(onSnapshot).toHaveBeenLastCalledWith(moved)
      expect(onError).not.toHaveBeenCalled()

      const resynchronization = transport.requestSnapshot()
      const snapshotFrame = JSON.parse(socket.sent.at(-1)!)
      socket.receive({
        type: 'snapshot-response', requestId: snapshotFrame.requestId, snapshot: moved,
      })
      await expect(resynchronization).resolves.toEqual(moved)
      expect(onError).not.toHaveBeenCalled()
      await transport.disconnect()
    } finally {
      vi.useRealTimers()
    }
  })

  it('nettoie exactement la session avec le jeton qui a établi son identité', async () => {
    let currentToken = 'alice-access-token'
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') {
        return json({ snapshot: snapshot([player('alice', 3)], 0) }, 201)
      }
      if (pathname === `/v1/shared-sessions/${sessionId}/members/me`) {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => currentToken,
      },
      fetch,
    })

    const transport = await service.prepareHost(preparation())
    currentToken = 'bob-access-token'
    await transport.disconnect()

    expect(fetch).toHaveBeenNthCalledWith(1, 'https://lan.test/v1/shared-sessions', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer alice-access-token' }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(
      2,
      `https://lan.test/v1/shared-sessions/${sessionId}/members/me`,
      expect.objectContaining({
        method: 'DELETE',
        headers: expect.objectContaining({ Authorization: 'Bearer alice-access-token' }),
      }),
    )
  })

  it('borne le POST de préparation et annule sa requête avant un rollback ciblé', async () => {
    vi.useFakeTimers()
    try {
      let preparationSignal: AbortSignal | null | undefined
      const fetch = vi.fn((input: string, init?: RequestInit): Promise<Response> => {
        const pathname = new URL(input).pathname
        if (pathname === '/v1/shared-sessions') {
          preparationSignal = init?.signal
          return new Promise<Response>(() => undefined)
        }
        if (pathname === `/v1/shared-sessions/${sessionId}/members/me`) {
          return Promise.resolve(new Response(null, { status: 204 }))
        }
        throw new Error(`Route inattendue : ${pathname}`)
      })
      const service = createHgssCampaignAuthoritativeService({
        config: {
          httpBaseUrl: 'https://lan.test',
          identityBaseUrl: 'https://identity.test',
          webSocketBaseUrl: 'wss://lan.test',
        },
        accountSession: {
          getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
          readAccessToken: () => 'alice-access-token',
        },
        fetch,
        requestTimeoutMs: 1_000,
      })

      const pending = service.prepareHost(preparation())
      const rejection = expect(pending).rejects.toMatchObject({ code: 'request-timeout' })
      await vi.advanceTimersByTimeAsync(1_000)
      await rejection

      expect(preparationSignal?.aborted).toBe(true)
      expect(fetch).toHaveBeenLastCalledWith(
        `https://lan.test/v1/shared-sessions/${sessionId}/members/me`,
        expect.objectContaining({
          method: 'DELETE',
          headers: expect.objectContaining({ Authorization: 'Bearer alice-access-token' }),
        }),
      )
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('rollback une création dont la réponse réseau est devenue incertaine', async () => {
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') throw new TypeError('network-response-lost')
      if (pathname === `/v1/shared-sessions/${sessionId}/members/me`) {
        return new Response(null, { status: 204 })
      }
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'alice-access-token',
      },
      fetch,
    })

    await expect(service.prepareHost(preparation())).rejects.toThrow('network-response-lost')
    expect(fetch).toHaveBeenLastCalledWith(
      `https://lan.test/v1/shared-sessions/${sessionId}/members/me`,
      expect.objectContaining({ method: 'DELETE' }),
    )
  })

  it('préserve une adhésion durable quand la réponse réseau du rendez-vous est incertaine', async () => {
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') throw new TypeError('durable-response-lost')
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'alice-access-token',
      },
      fetch,
    })

    await expect(service.prepareHost({
      ...preparation(),
      durableRendezvous: true,
    })).rejects.toThrow('durable-response-lost')
    expect(fetch).toHaveBeenCalledOnce()
    expect(fetch.mock.calls[0]?.[0]).toBe('https://lan.test/v1/shared-sessions')
  })

  it('refuse une identité WebSocket différente du compte authentifié', async () => {
    const host = snapshot([player('alice', 3)], 0)
    const fetch = vi.fn(async (input: string) => {
      const pathname = new URL(input).pathname
      if (pathname === '/v1/shared-sessions') return json({ snapshot: host }, 201)
      if (pathname === '/v1/realtime-ticket') return json({ ticket, expiresInMs: 15_000 }, 201)
      if (pathname.endsWith('/members/me')) return new Response(null, { status: 204 })
      throw new Error(`Route inattendue : ${pathname}`)
    })
    const socket = new FakeSocket()
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch,
      socketFactory: () => socket as unknown as HgssCampaignAuthoritativeWebSocket,
      requestIdFactory: () => opaqueId(30),
    })
    const transport = await service.prepareHost(preparation())
    const connection = Promise.resolve(transport.connect({
      onSnapshot: vi.fn(),
      onDisconnect: vi.fn(),
      onError: vi.fn(),
    }))
    await vi.waitFor(() => expect(socket.listeners.get('message')?.size).toBe(1))
    socket.open()
    socket.receive({ type: 'ready', version: 1, userId: 'bob' })
    await expect(connection).rejects.toMatchObject({
      name: 'HgssCampaignAuthoritativeServiceError',
      code: 'identity-mismatch',
    })
    await transport.disconnect()
  })

  it('conserve le code métier d’un refus HTTP strict', async () => {
    const service = createHgssCampaignAuthoritativeService({
      config: {
        httpBaseUrl: 'https://lan.test',
        identityBaseUrl: 'https://identity.test',
        webSocketBaseUrl: 'wss://lan.test',
      },
      accountSession: {
        getAccount: () => ({ id: 'alice', username: 'alice', role: 'user', entitlements: ['online'] }),
        readAccessToken: () => 'access-token',
      },
      fetch: async () => json({
        error: { code: 'FORBIDDEN', message: 'Friendship required' },
        requestId: 'request-1',
      }, 403),
    })

    await expect(service.prepareHost(preparation())).rejects.toEqual(expect.objectContaining({
      name: 'HgssCampaignAuthoritativeServiceError',
      code: 'forbidden',
      status: 403,
    } satisfies Partial<HgssCampaignAuthoritativeServiceError>))
  })
})
