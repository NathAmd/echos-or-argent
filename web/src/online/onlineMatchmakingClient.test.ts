import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  createOnlineMatchmakingClient,
  OnlineMatchmakingRequestTimeoutError,
  type OnlineMatchmakingClient,
} from './onlineMatchmakingClient'
import {
  isOnlineMatchmakingActivity,
  parseOnlineMatchmakingStatus,
} from './onlineMatchmakingProtocol'

const config = {
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
}
const matchId = `${'A'.repeat(21)}Q`
const negotiationId = `${'B'.repeat(21)}g`

afterEach(() => { vi.useRealTimers() })

describe('protocole de rendez-vous multijoueur', () => {
  it('accepte uniquement les trois activités génériques', () => {
    expect(isOnlineMatchmakingActivity('trade')).toBe(true)
    expect(isOnlineMatchmakingActivity('pvp')).toBe(true)
    expect(isOnlineMatchmakingActivity('coop')).toBe(true)
    expect(isOnlineMatchmakingActivity('ranked')).toBe(false)
  })

  it('valide strictement les états idle, queued et matched', () => {
    expect(parseOnlineMatchmakingStatus({ status: 'idle' })).toEqual({ status: 'idle' })
    expect(parseOnlineMatchmakingStatus({
      activity: 'trade',
      expiresAt: 2_000,
      joinedAt: 1_000,
      status: 'queued',
    })).toEqual({ activity: 'trade', expiresAt: 2_000, joinedAt: 1_000, status: 'queued' })
    expect(parseOnlineMatchmakingStatus({
      activity: 'pvp',
      expiresAt: 2_000,
      matchId,
      negotiationId,
      peerUserId: 'bob',
      role: 'offerer',
      status: 'matched',
    })).toEqual({
      activity: 'pvp',
      expiresAt: 2_000,
      matchId,
      negotiationId,
      peerUserId: 'bob',
      role: 'offerer',
      status: 'matched',
    })
  })

  it('refuse les champs libres, identifiants sémantiques et incohérences temporelles', () => {
    expect(parseOnlineMatchmakingStatus({ status: 'idle', peer: 'bob' })).toBeUndefined()
    expect(parseOnlineMatchmakingStatus({
      activity: 'coop', expiresAt: 1_000, joinedAt: 1_000, status: 'queued',
    })).toBeUndefined()
    expect(parseOnlineMatchmakingStatus({
      activity: 'trade', expiresAt: 2_000, matchId: 'trade-match', negotiationId,
      peerUserId: 'bob', role: 'answerer', status: 'matched',
    })).toBeUndefined()
  })
})

describe('client HTTP de rendez-vous multijoueur', () => {
  it('rejoint, consulte puis annule une recherche avec le Bearer seulement en mémoire', async () => {
    const queued = {
      activity: 'coop', expiresAt: 2_000, joinedAt: 1_000,
      lease: 'c3Nzc3Nzc3Nzc3Nzc3Nzcw', status: 'queued',
    }
    const fetch = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(queued), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))
    const client = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'opaque-runtime-token',
      fetch,
    })

    await expect(client.join('coop')).resolves.toEqual(queued)
    await expect(client.getStatus()).resolves.toEqual(queued)
    await expect(client.cancel()).resolves.toBeUndefined()
    expect(fetch).toHaveBeenNthCalledWith(1, 'https://online.example.com/v1/matchmaking', expect.objectContaining({
      body: JSON.stringify({ activity: 'coop' }),
      credentials: 'omit',
      headers: expect.objectContaining({ Authorization: 'Bearer opaque-runtime-token' }),
      method: 'POST',
    }))
    expect(fetch).toHaveBeenNthCalledWith(3, 'https://online.example.com/v1/matchmaking', expect.objectContaining({
      headers: expect.objectContaining({ 'Engagement-Lease': queued.lease }),
      method: 'DELETE',
    }))
  })

  it('refuse une réponse arbitraire et conserve les erreurs HTTP structurées', async () => {
    const malformed = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: async () => new Response(JSON.stringify({ status: 'matched', peerUserId: 'bob' }), { status: 200 }),
    })
    await expect(malformed.getStatus()).rejects.toThrow('invalide')

    const failed = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: async () => new Response(JSON.stringify({
        error: { code: 'CONFLICT', message: 'déjà en recherche' },
        requestId: 'request-1',
      }), { status: 409 }),
    })
    await expect(failed.join('trade')).rejects.toMatchObject({
      code: 'CONFLICT', requestId: 'request-1', status: 409,
    })
  })

  it('ne lance aucune requête sans session de compte valide', async () => {
    const fetch = vi.fn()
    const client = createOnlineMatchmakingClient({ config, readAccessToken: () => undefined, fetch })
    await expect(client.getStatus()).rejects.toThrow('Session du compte')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('interrompt une réponse en flux avant de dépasser la borne mémoire', async () => {
    const oversized = new Uint8Array(64 * 1024 + 1).fill(0x61)
    const client = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: async () => new Response(new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(oversized.subarray(0, 32 * 1024))
          controller.enqueue(oversized.subarray(32 * 1024))
          controller.close()
        },
      }), { status: 200 }),
    })

    await expect(client.getStatus()).rejects.toThrow('trop volumineuse')
  })

  it('refuse un succès HTTP hors du contrat exact', async () => {
    const client = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: async () => new Response(JSON.stringify({ status: 'idle' }), { status: 201 }),
    })

    await expect(client.getStatus()).rejects.toThrow('Statut HTTP 201 inattendu')
  })

  it('borne et interrompt séparément les requêtes POST, GET et DELETE sans réponse', async () => {
    vi.useFakeTimers()
    const cases: readonly Readonly<{
      method: 'POST' | 'GET' | 'DELETE'
      invoke: (client: OnlineMatchmakingClient) => Promise<unknown>
    }>[] = [
      { method: 'POST', invoke: (client) => client.join('trade') },
      { method: 'GET', invoke: (client) => client.getStatus() },
      { method: 'DELETE', invoke: (client) => client.cancel() },
    ]

    for (const testCase of cases) {
      let requestSignal: AbortSignal | null | undefined
      const fetch = vi.fn((_input: string, init?: RequestInit) => {
        requestSignal = init?.signal
        return new Promise<Response>(() => undefined)
      })
      const client = createOnlineMatchmakingClient({
        config,
        readAccessToken: () => 'token',
        fetch,
        requestTimeoutMs: 250,
      })
      const pending = testCase.invoke(client)
      const rejection = expect(pending).rejects.toMatchObject({
        code: 'online-matchmaking-timeout',
        timeoutMs: 250,
      })

      expect(fetch).toHaveBeenCalledWith(
        'https://online.example.com/v1/matchmaking',
        expect.objectContaining({ method: testCase.method }),
      )
      await vi.advanceTimersByTimeAsync(250)
      await rejection
      expect(requestSignal?.aborted).toBe(true)
      expect(requestSignal?.reason).toBeInstanceOf(OnlineMatchmakingRequestTimeoutError)
      expect(vi.getTimerCount()).toBe(0)
    }
  })

  it("préserve la raison d'annulation appelante et retire listener et timer", async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const addListener = vi.spyOn(caller.signal, 'addEventListener')
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    let requestSignal: AbortSignal | null | undefined
    const client = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: (_input, init) => {
        requestSignal = init?.signal
        return new Promise<Response>(() => undefined)
      },
      requestTimeoutMs: 1_000,
    })
    const pending = client.getStatus(caller.signal)
    const reason = new DOMException('annulation-appelante', 'AbortError')
    const rejection = expect(pending).rejects.toBe(reason)

    caller.abort(reason)
    await rejection
    expect(requestSignal?.aborted).toBe(true)
    expect(requestSignal?.reason).toBe(reason)
    expect(addListener).toHaveBeenCalledOnce()
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
  })

  it('nettoie le délai et le listener après un succès et valide la configuration', async () => {
    vi.useFakeTimers()
    const caller = new AbortController()
    const removeListener = vi.spyOn(caller.signal, 'removeEventListener')
    const client = createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      fetch: async () => new Response(JSON.stringify({ status: 'idle' }), { status: 200 }),
      requestTimeoutMs: 1_000,
    })

    await expect(client.getStatus(caller.signal)).resolves.toEqual({ status: 'idle' })
    expect(removeListener).toHaveBeenCalledWith('abort', expect.any(Function))
    expect(vi.getTimerCount()).toBe(0)
    expect(() => createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      requestTimeoutMs: 249,
    })).toThrow('250')
    expect(() => createOnlineMatchmakingClient({
      config,
      readAccessToken: () => 'token',
      requestTimeoutMs: 120_001,
    })).toThrow('120 000')
  })
})
