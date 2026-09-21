import { describe, expect, it, vi } from 'vitest'
import type { OnlineClientConfig } from './onlineClientConfig'
import {
  createOnlineCoopRendezvousClient,
  OnlineCoopRendezvousRequestTimeoutError,
} from './onlineCoopRendezvousClient'
import { OnlineServiceError } from './onlineSocialClient'

const config: OnlineClientConfig = Object.freeze({
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://identity.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
})
const sessionId = 'AAAAAAAAAAAAAAAAAAAAAA'
const idle = Object.freeze({
  protocolVersion: 1,
  current: Object.freeze({ status: 'idle' }),
  invitations: Object.freeze([]),
})

function json(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('onlineCoopRendezvousClient', () => {
  it('clôture le cancel avec le lease du dernier snapshot', async () => {
    const queued = {
      protocolVersion: 1 as const,
      current: {
        status: 'queued' as const,
        mode: 'random' as const,
        joinedAt: 1_000,
        expiresAt: 2_000,
        lease: 'c3Nzc3Nzc3Nzc3Nzc3Nzcw',
      },
      invitations: [],
    }
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(json(queued))
      .mockResolvedValueOnce(json(idle))
    const client = createOnlineCoopRendezvousClient({
      config,
      readAccessToken: () => 'access-token',
      fetch,
    })
    await client.searchRandom()
    await client.cancelCurrent()
    expect(fetch).toHaveBeenNthCalledWith(2, expect.any(String), expect.objectContaining({
      headers: expect.objectContaining({ 'Engagement-Lease': queued.current.lease }),
      method: 'DELETE',
    }))
  })

  it('appelle chaque route avec le bearer et parse le snapshot commun', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => json(idle))
    const client = createOnlineCoopRendezvousClient({
      config,
      readAccessToken: () => 'access-token',
      fetch,
    })

    await expect(client.getSnapshot()).resolves.toEqual(idle)
    await expect(client.searchRandom()).resolves.toEqual(idle)
    await expect(client.inviteFriend('bob')).resolves.toEqual(idle)
    await expect(client.acceptInvitation(sessionId)).resolves.toEqual(idle)
    await expect(client.declineInvitation(sessionId)).resolves.toEqual(idle)
    await expect(client.cancelCurrent()).resolves.toEqual(idle)

    expect(fetch.mock.calls.map(([input]) => input)).toEqual([
      'https://online.example.com/v1/coop-rendezvous',
      'https://online.example.com/v1/coop-rendezvous/random',
      'https://online.example.com/v1/coop-rendezvous/invitations',
      `https://online.example.com/v1/coop-rendezvous/invitations/${sessionId}/accept`,
      `https://online.example.com/v1/coop-rendezvous/invitations/${sessionId}`,
      'https://online.example.com/v1/coop-rendezvous/current',
    ])
    expect(fetch).toHaveBeenNthCalledWith(3, expect.any(String), expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ peerUserId: 'bob' }),
      credentials: 'omit',
      headers: expect.objectContaining({ Authorization: 'Bearer access-token' }),
    }))
    expect(fetch).toHaveBeenNthCalledWith(5, expect.any(String), expect.objectContaining({
      method: 'DELETE',
    }))
    expect(fetch.mock.calls[4]?.[1]).not.toHaveProperty('body')
  })

  it('refuse les identifiants avant tout accès réseau', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>(async () => json(idle))
    const client = createOnlineCoopRendezvousClient({
      config,
      readAccessToken: () => 'access-token',
      fetch,
    })
    await expect(client.inviteFriend('bad user')).rejects.toBeInstanceOf(TypeError)
    expect(() => client.acceptInvitation('predictable-id')).toThrow(TypeError)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuse un succès non canonique et restitue les erreurs serveur', async () => {
    const malformed = createOnlineCoopRendezvousClient({
      config,
      readAccessToken: () => 'access-token',
      fetch: async () => json({ status: 'idle' }),
    })
    await expect(malformed.getSnapshot()).rejects.toThrow('invalide')

    const failed = createOnlineCoopRendezvousClient({
      config,
      readAccessToken: () => 'access-token',
      fetch: async () => json({ error: { code: 'CONFLICT', message: 'Déjà engagé.' } }, 409),
    })
    const error = await failed.searchRandom().catch((value: unknown) => value)
    expect(error).toBeInstanceOf(OnlineServiceError)
    expect(error).toMatchObject({ status: 409, code: 'CONFLICT', message: 'Déjà engagé.' })
  })

  it('borne la requête et respecte l’annulation appelante', async () => {
    vi.useFakeTimers()
    try {
      const client = createOnlineCoopRendezvousClient({
        config,
        readAccessToken: () => 'access-token',
        requestTimeoutMs: 250,
        fetch: async () => new Promise<Response>(() => undefined),
      })
      const timed = client.getSnapshot()
      const timedAssertion = expect(timed).rejects.toBeInstanceOf(
        OnlineCoopRendezvousRequestTimeoutError,
      )
      await vi.advanceTimersByTimeAsync(250)
      await timedAssertion

      const abort = new AbortController()
      const cancelled = client.getSnapshot(abort.signal)
      const cancelledAssertion = expect(cancelled).rejects.toThrow('stop')
      abort.abort(new Error('stop'))
      await cancelledAssertion
    } finally {
      vi.useRealTimers()
    }
  })
})
