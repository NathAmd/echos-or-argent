import { describe, expect, it, vi } from 'vitest'
import { createOnlineSignalingClient, type OnlineWebSocket } from './onlineSignalingClient'
import { generateOnlineOpaqueId, isOnlineOpaqueId, parseOnlineSignalPayload } from './onlineServiceProtocol'
import { createOnlineSocialClient, OnlineServiceError } from './onlineSocialClient'

const config = {
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
}
const ticket = { ticket: 'a'.repeat(43), expiresInMs: 30_000 }
const negotiationId = 'A'.repeat(22)
const requestId = `${'B'.repeat(21)}Q`
const incomingRequestId = `${'C'.repeat(21)}g`
const validSdp = [
  'v=0',
  'o=- 0 0 IN IP4 127.0.0.1',
  's=-',
  't=0 0',
  'm=application 9 UDP/DTLS/SCTP webrtc-datachannel',
  'c=IN IP4 0.0.0.0',
  'a=ice-ufrag:test',
  'a=ice-pwd:0123456789012345678901',
  'a=fingerprint:sha-256 00',
  'a=setup:actpass',
  'a=mid:0',
  'a=sctp-port:5000',
  '',
].join('\r\n')
const validCandidate = 'candidate:1 1 udp 2122260223 192.0.2.1 54321 typ host'

class FakeSocket implements OnlineWebSocket {
  readyState: number = WebSocket.CONNECTING
  readonly sent: string[] = []
  readonly listeners = new Map<string, Set<(event: never) => void>>()
  addEventListener(kind: string, listener: (event: never) => void) { const set = this.listeners.get(kind) ?? new Set(); set.add(listener); this.listeners.set(kind, set) }
  removeEventListener(kind: string, listener: (event: never) => void) { this.listeners.get(kind)?.delete(listener) }
  send(data: string) { this.sent.push(data) }
  close() { this.readyState = WebSocket.CLOSED }
  emit(kind: string, event: unknown) { for (const listener of this.listeners.get(kind) ?? []) listener(event as never) }
}

describe('client social HTTP générique', () => {
  it('utilise le Bearer en mémoire et valide la liste d’amis', async () => {
    const fetch = vi.fn(async () => new Response(JSON.stringify({ friends: [{ userId: 'bob', online: true }], incoming: [], outgoing: [] }), { status: 200 }))
    const client = createOnlineSocialClient({ config, readAccessToken: () => 'opaque-runtime-token', fetch })

    await expect(client.getSocial()).resolves.toEqual({ friends: [{ userId: 'bob', online: true }], incoming: [], outgoing: [] })
    expect(fetch).toHaveBeenCalledWith('https://online.example.com/v1/social', expect.objectContaining({
      credentials: 'omit', headers: expect.objectContaining({ Authorization: 'Bearer opaque-runtime-token' }),
    }))
  })

  it('expose les erreurs structurées sans accepter une réponse arbitraire', async () => {
    const failedFetch = vi.fn(async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'refusé' }, requestId: 'req-1' }), { status: 403 }))
    const failed = createOnlineSocialClient({ config, readAccessToken: () => 'token', fetch: failedFetch })
    await expect(failed.getIdentity()).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN', requestId: 'req-1' } satisfies Partial<OnlineServiceError>)

    const malformed = createOnlineSocialClient({ config, readAccessToken: () => 'token', fetch: async () => new Response(JSON.stringify({ friends: 'non' }), { status: 200 }) })
    await expect(malformed.getSocial()).rejects.toThrow("Liste d'amis invalide")
  })

  it('ne tente aucun appel sans session de compte', async () => {
    const fetch = vi.fn()
    const client = createOnlineSocialClient({ config, readAccessToken: () => undefined, fetch })
    await expect(client.getIdentity()).rejects.toThrow('Session du compte')
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('client de signalisation WebRTC', () => {
  it('génère des identifiants opaques canoniques sans libellé applicatif', () => {
    const first = generateOnlineOpaqueId(), second = generateOnlineOpaqueId()
    expect(isOnlineOpaqueId(first)).toBe(true)
    expect(isOnlineOpaqueId(second)).toBe(true)
    expect(first).not.toBe(second)
  })

  it('refuse les raisons, champs libres et pseudo-contenus applicatifs', () => {
    for (const payload of [
      { type: 'hangup', reason: 'donnée applicative interdite' },
      { type: 'hangup', data: { inventory: [1, 2, 3] } },
      { type: 'offer', sdp: validSdp, campaign: 'interdit' },
      { type: 'ice', candidate: validCandidate, data: 'interdit' },
      { type: 'offer', sdp: 'v=0\r\n{"gameplay":true}\r\n' },
      { type: 'ice', candidate: 'candidate:contenu-libre' },
    ]) expect(parseOnlineSignalPayload(payload)).toBeUndefined()
  })

  it('utilise un ticket court, le sous-protocole exact et relaie seulement les signaux bornés', () => {
    const socket = new FakeSocket()
    const factory = vi.fn(() => socket)
    const events: unknown[] = []
    const client = createOnlineSignalingClient({ config, ticket, socketFactory: factory, requestIdFactory: () => requestId })
    client.subscribe((event) => events.push(event))
    socket.readyState = WebSocket.OPEN
    socket.emit('message', new MessageEvent('message', { data: JSON.stringify({ type: 'ready', version: 1, userId: 'alice', onlineFriends: ['bob'] }) }))

    expect(client.getState()).toEqual({ status: 'ready', userId: 'alice' })
    expect(client.sendSignal('bob', negotiationId, { type: 'offer', sdp: validSdp })).toBe(requestId)
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      type: 'signal',
      requestId,
      negotiationId,
      to: 'bob',
      payload: { type: 'offer', sdp: validSdp },
    })
    expect(factory).toHaveBeenCalledWith(expect.stringContaining('/v1/realtime?ticket='), 'social-signaling.v1')
    socket.emit('message', new MessageEvent('message', { data: JSON.stringify({
      type: 'signal', requestId: incomingRequestId, negotiationId, from: 'bob',
      payload: { type: 'answer', sdp: validSdp },
    }) }))
    expect(events).toEqual([
      { type: 'ready', version: 1, userId: 'alice', onlineFriends: ['bob'] },
      {
        type: 'signal', requestId: incomingRequestId, negotiationId, from: 'bob',
        payload: { type: 'answer', sdp: validSdp },
      },
    ])
  })

  it('refuse des identifiants sortants sémantiques même injectés par un appelant', () => {
    const socket = new FakeSocket()
    const client = createOnlineSignalingClient({ config, ticket, socketFactory: () => socket, requestIdFactory: () => 'trade-slot-one' })
    socket.readyState = WebSocket.OPEN
    socket.emit('message', new MessageEvent('message', { data: JSON.stringify({ type: 'ready', version: 1, userId: 'alice', onlineFriends: ['bob'] }) }))

    expect(() => client.sendSignal('bob', 'campaign-slot-one', { type: 'ice', candidate: validCandidate }, requestId)).toThrow(/opaque/)
    expect(() => client.sendSignal('bob', negotiationId, { type: 'ice', candidate: validCandidate })).toThrow(/opaque/)
    expect(socket.sent).toEqual([])
  })

  it('ferme le canal sur un message serveur non conforme', () => {
    const socket = new FakeSocket()
    const client = createOnlineSignalingClient({ config, ticket, socketFactory: () => socket })
    socket.readyState = WebSocket.OPEN
    socket.emit('message', new MessageEvent('message', { data: JSON.stringify({ type: 'game-payload', value: 'interdit' }) }))

    expect(client.getState().status).toBe('failed')
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it('exige un unique événement ready avant tout signal', () => {
    const socket = new FakeSocket()
    const client = createOnlineSignalingClient({ config, ticket, socketFactory: () => socket })
    socket.readyState = WebSocket.OPEN
    socket.emit('message', new MessageEvent('message', { data: JSON.stringify({
      type: 'signal', requestId: 'late-1', negotiationId: 'rtc-session-1', from: 'bob',
      payload: { type: 'hangup' },
    }) }))

    expect(client.getState().status).toBe('failed')
    expect(socket.readyState).toBe(WebSocket.CLOSED)
  })

  it('notifie les sessions en attente lors d’une fermeture locale', () => {
    const socket = new FakeSocket()
    const client = createOnlineSignalingClient({ config, ticket, socketFactory: () => socket })
    const states: string[] = []
    client.subscribeState((state) => states.push(state.status))

    client.close()

    expect(states).toEqual(['connecting', 'closed'])
    expect(client.getState()).toEqual({ status: 'closed' })
  })
})
