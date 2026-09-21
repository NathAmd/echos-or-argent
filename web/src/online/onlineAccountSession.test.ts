import { describe, expect, it, vi } from 'vitest'
import {
  createOnlineAccountSession,
  onlineAccountSessionStorageKey,
  projectOnlineAccountAccess,
  purgeDurableOnlineAccountSessions,
  type OnlineAccount,
} from './onlineAccountSession'
import { parseOnlineClientConfig } from './onlineClientConfig'

class MemoryStorage {
  readonly values = new Map<string, string>()
  readonly getItem = vi.fn((key: string) => this.values.get(key) ?? null)
  readonly setItem = vi.fn((key: string, value: string) => { this.values.set(key, value) })
  readonly removeItem = vi.fn((key: string) => { this.values.delete(key) })
}

const config = parseOnlineClientConfig('https://online.example.test')!
const now = 1_800_000_000_000
const account: OnlineAccount = Object.freeze({
  id: 'alice',
  username: 'alice',
  role: 'user',
  entitlements: Object.freeze(['online']),
  vaultKeyId: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA',
})

function authentication(accessToken = 'opaque-account-session') {
  return {
    account,
    session: { accessToken, expiresAt: now + 60_000 },
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

describe('session de compte navigateur', () => {
  it('purge les anciens Bearers durables même si la suppression d’une autre clé échoue', () => {
    const values = new Map([
      ['pokemaster:test-device:v1', 'legacy-secret'],
      [onlineAccountSessionStorageKey, 'durable-bearer'],
    ])
    const storage = {
      removeItem: vi.fn((key: string) => {
        if (key === 'pokemaster:test-device:v1') throw new Error('legacy entry locked')
        values.delete(key)
      }),
    }

    expect(() => purgeDurableOnlineAccountSessions(storage)).not.toThrow()
    expect(storage.removeItem).toHaveBeenCalledTimes(2)
    expect(values.has(onlineAccountSessionStorageKey)).toBe(false)
  })

  it('crée un compte, garde le Bearer hors du snapshot et persiste seulement la session opaque', async () => {
    const storage = new MemoryStorage()
    storage.values.set('pokemaster:test-device:v1', 'legacy-secret')
    const fetchRequest = vi.fn(async () => jsonResponse(authentication()))
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })
    const snapshots: ReturnType<typeof session.getAccessSnapshot>[] = []
    session.subscribeAccess((snapshot) => { snapshots.push(snapshot) })

    const result = await session.register({ username: ' ALICE ', password: 'correct-password' })

    expect(fetchRequest).toHaveBeenCalledWith(
      'https://online.example.test/v1/accounts/register',
      expect.objectContaining({
        method: 'POST',
        credentials: 'omit',
        body: JSON.stringify({ username: 'alice', password: 'correct-password' }),
      }),
    )
    expect(result.account).toEqual(account)
    expect(session.getAccount()).toEqual(account)
    expect(session.getAccessSnapshot()).toMatchObject({ signedIn: true, online: true, isAdmin: false })
    expect(JSON.stringify(session.getAccessSnapshot())).not.toContain('opaque-account-session')
    expect(snapshots.at(-1)).toMatchObject({ signedIn: true, account: { username: 'alice' } })
    expect(storage.values.has('pokemaster:test-device:v1')).toBe(false)
    expect(JSON.parse(storage.values.get(onlineAccountSessionStorageKey) ?? '')).toEqual({
      version: 1,
      serverUrl: 'https://online.example.test',
      accessToken: 'opaque-account-session',
      expiresAt: now + 60_000,
    })
  })

  it('contacte le transport courant mais persiste l’identité canonique du serveur', async () => {
    const storage = new MemoryStorage()
    const lanConfig = parseOnlineClientConfig(
      'https://192.168.0.109:5174',
      false,
      'https://pokemaster.local:5174',
    )!
    const fetchRequest = vi.fn<(input: string, init: RequestInit) => Promise<Response>>(
      async () => jsonResponse(authentication()),
    )
    const session = createOnlineAccountSession({
      config: lanConfig,
      storage,
      fetch: fetchRequest,
      now: () => now,
    })

    await session.login({ username: 'alice', password: 'correct-password' })

    expect(fetchRequest.mock.calls[0]?.[0]).toBe('https://192.168.0.109:5174/v1/accounts/login')
    expect(JSON.parse(storage.values.get(onlineAccountSessionStorageKey) ?? '')).toMatchObject({
      serverUrl: 'https://pokemaster.local:5174',
    })
  })

  it('restaure le compte par Bearer puis efface une session refusée en 401', async () => {
    const storage = new MemoryStorage()
    storage.values.set(onlineAccountSessionStorageKey, JSON.stringify({
      version: 1,
      serverUrl: config.httpBaseUrl,
      accessToken: 'persisted-session',
      expiresAt: now + 60_000,
    }))
    const fetchRequest = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ account }))
      .mockResolvedValueOnce(jsonResponse({ error: { code: 'UNAUTHORIZED', message: 'expired' } }, 401))
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })

    await expect(session.restore()).resolves.toEqual(account)
    const firstInit = fetchRequest.mock.calls[0]?.[1] as RequestInit
    expect(firstInit.headers).toMatchObject({ Authorization: 'Bearer persisted-session' })
    expect(session.getAccessSnapshot().signedIn).toBe(true)

    await expect(session.restore()).resolves.toBeUndefined()
    expect(session.readAccessToken()).toBeUndefined()
    expect(session.getAccessSnapshot()).toMatchObject({ signedIn: false, online: false })
    expect(storage.values.has(onlineAccountSessionStorageKey)).toBe(false)
  })

  it('déconnecte localement même si le VPS est indisponible et n’expose jamais le secret', async () => {
    const storage = new MemoryStorage()
    const fetchRequest = vi.fn()
      .mockResolvedValueOnce(jsonResponse(authentication('logout-session')))
      .mockRejectedValueOnce(new Error('offline'))
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })
    await session.login({ username: 'alice', password: 'correct-password' })

    await expect(session.logout()).resolves.toBeUndefined()

    expect(fetchRequest.mock.calls[1]?.[0]).toBe('https://online.example.test/v1/accounts/logout')
    expect(session.getAccount()).toBeUndefined()
    expect(session.readAccessToken()).toBeUndefined()
    expect(storage.values.has(onlineAccountSessionStorageKey)).toBe(false)
  })

  it('valide localement la longueur et les octets Unicode du mot de passe', async () => {
    const fetchRequest = vi.fn(async () => jsonResponse(authentication()))
    const session = createOnlineAccountSession({ config, fetch: fetchRequest, now: () => now })

    await expect(session.login({ username: 'alice', password: 'short' }))
      .rejects.toThrow('entre 10 et 128 caractères')
    await expect(session.login({ username: 'alice', password: '€'.repeat(100) }))
      .rejects.toThrow('256 octets')
    expect(fetchRequest).not.toHaveBeenCalled()
  })

  it('ne publie ni ne persiste une authentification annulée même si fetch répond tardivement', async () => {
    const storage = new MemoryStorage()
    const response = deferred<Response>()
    let receivedSignal: AbortSignal | undefined
    const fetchRequest = vi.fn((_input: string, init: RequestInit) => {
      receivedSignal = init.signal ?? undefined
      return response.promise
    })
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })
    const controller = new AbortController()

    const login = session.login(
      { username: 'alice', password: 'correct-password' },
      controller.signal,
    )
    controller.abort()

    await expect(login).rejects.toMatchObject({ name: 'AbortError' })
    expect(receivedSignal?.aborted).toBe(true)
    expect(session.getAccount()).toBeUndefined()
    expect(session.readAccessToken()).toBeUndefined()
    expect(storage.values.has(onlineAccountSessionStorageKey)).toBe(false)

    response.resolve(jsonResponse(authentication()))
    await Promise.resolve()
    expect(session.getAccount()).toBeUndefined()
    expect(storage.values.has(onlineAccountSessionStorageKey)).toBe(false)
  })

  it('ne publie pas une restauration annulée même si le compte arrive tardivement', async () => {
    const storage = new MemoryStorage()
    storage.values.set(onlineAccountSessionStorageKey, JSON.stringify({
      version: 1,
      serverUrl: config.httpBaseUrl,
      accessToken: 'persisted-session',
      expiresAt: now + 60_000,
    }))
    const response = deferred<Response>()
    let receivedSignal: AbortSignal | undefined
    const fetchRequest = vi.fn((_input: string, init: RequestInit) => {
      receivedSignal = init.signal ?? undefined
      return response.promise
    })
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })
    const snapshots: ReturnType<typeof session.getAccessSnapshot>[] = []
    session.subscribeAccess((snapshot) => { snapshots.push(snapshot) })
    const controller = new AbortController()

    const restoration = session.restore(controller.signal)
    controller.abort()

    await expect(restoration).rejects.toMatchObject({ name: 'AbortError' })
    expect(receivedSignal?.aborted).toBe(true)
    expect(session.getAccount()).toBeUndefined()
    expect(session.readAccessToken()).toBe('persisted-session')
    expect(snapshots).toHaveLength(1)
    expect(JSON.parse(storage.values.get(onlineAccountSessionStorageKey) ?? '')).toMatchObject({
      accessToken: 'persisted-session',
    })

    response.resolve(jsonResponse({ account }))
    await Promise.resolve()
    expect(session.getAccount()).toBeUndefined()
    expect(snapshots).toHaveLength(1)
  })

  it('la dernière tentative gagne même quand deux réponses de connexion arrivent dans le désordre', async () => {
    const storage = new MemoryStorage()
    const aliceResponse = deferred<Response>()
    const bobResponse = deferred<Response>()
    const fetchRequest = vi.fn()
      .mockImplementationOnce((_input: string, init: RequestInit) => {
        expect(init.signal?.aborted).toBe(false)
        return aliceResponse.promise
      })
      .mockImplementationOnce(() => bobResponse.promise)
    const session = createOnlineAccountSession({ config, storage, fetch: fetchRequest, now: () => now })
    const bob: OnlineAccount = Object.freeze({
      id: 'bob',
      username: 'bob',
      role: 'user',
      entitlements: Object.freeze(['online']),
    })

    const aliceLogin = session.login({ username: 'alice', password: 'alice-password' })
    const bobLogin = session.login({ username: 'bob', password: 'bob-password-ok' })
    await expect(aliceLogin).rejects.toMatchObject({ name: 'AbortError' })
    bobResponse.resolve(jsonResponse({
      account: bob,
      session: { accessToken: 'bob-account-session', expiresAt: now + 60_000 },
    }))
    await expect(bobLogin).resolves.toMatchObject({ account: { id: 'bob' } })
    aliceResponse.resolve(jsonResponse(authentication('alice-account-session')))
    await Promise.resolve()

    expect(session.getAccount()).toEqual(bob)
    expect(session.readAccessToken()).toBe('bob-account-session')
    expect(JSON.parse(storage.values.get(onlineAccountSessionStorageKey) ?? '')).toMatchObject({
      accessToken: 'bob-account-session',
    })
  })

  it('projette les droits génériques : online, premium, développement et bypass admin', () => {
    expect(projectOnlineAccountAccess(account)).toMatchObject({
      online: true,
      premiumClient: false,
      cloudStorage: false,
      development: false,
    })
    expect(projectOnlineAccountAccess({ ...account, entitlements: ['development'] })).toMatchObject({
      online: true,
      premiumClient: true,
      cloudStorage: true,
      development: true,
    })
    expect(projectOnlineAccountAccess({ ...account, role: 'admin', entitlements: [] })).toMatchObject({
      isAdmin: true,
      online: true,
      premiumClient: true,
      cloudStorage: true,
    })
  })
})
