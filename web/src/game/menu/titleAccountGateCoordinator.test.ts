import { afterEach, describe, expect, it, vi } from 'vitest'
import type {
  OnlineAccount,
  OnlineAccountAuthentication,
  OnlineAccountCredentials,
} from '../../online/onlineAccountSession'
import {
  createTitleAccountGateCoordinator,
  type TitleAccountGateSession,
} from './titleAccountGateCoordinator'

const alice: OnlineAccount = Object.freeze({
  id: 'alice',
  username: 'alice',
  role: 'user',
  entitlements: Object.freeze(['online', 'cloud-storage']),
})

function authentication(account: OnlineAccount = alice): OnlineAccountAuthentication {
  return Object.freeze({
    account,
    session: Object.freeze({ accessToken: 'secret-bearer', expiresAt: 2_000_000_000_000 }),
  })
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

function session(overrides: Partial<TitleAccountGateSession> = {}): TitleAccountGateSession {
  return {
    configured: true,
    getAccount: () => undefined,
    hasPersistedSession: () => false,
    restore: async () => undefined,
    login: async () => authentication(),
    register: async () => authentication(),
    logout: async () => undefined,
    ...overrides,
  }
}

function localImportRequired(proposalId = 7, transferCount = 1): Error {
  return Object.assign(new Error('Sauvegarde locale détectée.'), {
    name: 'TitleSaveLocalAccountImportRequiredError',
    proposalId,
    transferCount,
  })
}

async function openAndConfirmAccount(
  coordinator: ReturnType<typeof createTitleAccountGateCoordinator>,
): Promise<void> {
  await coordinator.open()
  await coordinator.continueWithAccount()
}

afterEach(() => {
  vi.useRealTimers()
})

describe('coordinateur du compte avant le catalogue de sauvegardes', () => {
  it('attend une décision explicite et ne lit jamais le catalogue à l’ouverture anonyme', async () => {
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session(),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await coordinator.open()

    expect(coordinator.getState()).toEqual({ stage: 'signed-out', mode: 'login' })
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('attend Continuer pour le compte courant et déconnecte avant de changer', async () => {
    const logout = vi.fn(async () => undefined)
    const authorizeCatalog = vi.fn(async () => undefined)
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice, logout }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await coordinator.open()
    expect(coordinator.getState()).toEqual({ stage: 'account-choice', account: alice })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    await coordinator.switchAccount()
    expect(logout).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toEqual({ stage: 'signed-out', mode: 'login' })
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('garde le mode local disponible avec un service configuré sauf désactivation explicite', async () => {
    const allowedCatalog = vi.fn()
    const allowed = createTitleAccountGateCoordinator({
      session: session(),
      onAuthorizeCatalogAccess: allowedCatalog,
    })
    await allowed.open()
    await allowed.useLocal()
    expect(allowedCatalog).toHaveBeenCalledWith(
      { kind: 'local' }, expect.any(AbortSignal), expect.any(Map),
    )

    const blockedCatalog = vi.fn()
    const blocked = createTitleAccountGateCoordinator({
      session: session(),
      allowLocalAccess: false,
      onAuthorizeCatalogAccess: blockedCatalog,
    })
    await blocked.open()
    await blocked.useLocal()
    expect(blockedCatalog).not.toHaveBeenCalled()
  })

  it('restaure la session avant d’autoriser une seule ouverture en ligne', async () => {
    const catalog = deferred<void>()
    const authorizeCatalog = vi.fn(() => catalog.promise)
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        hasPersistedSession: () => true,
        restore: async () => alice,
      }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await coordinator.open()
    expect(coordinator.getState()).toEqual({ stage: 'account-choice', account: alice })
    expect(authorizeCatalog).not.toHaveBeenCalled()
    const opening = coordinator.continueWithAccount()
    await vi.waitFor(() => { expect(coordinator.getState().stage).toBe('authorizing') })
    expect(authorizeCatalog).toHaveBeenCalledOnce()
    expect(authorizeCatalog).toHaveBeenCalledWith(
      { kind: 'online', account: alice },
      expect.any(AbortSignal),
      expect.any(Map),
    )

    catalog.resolve()
    await opening

    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'online', account: alice },
    })
    expect(JSON.stringify(coordinator.getState())).not.toContain('secret-bearer')
  })

  it.each([
    ['import', 'importLocalSaves'],
    ['keep-separate', 'keepLocalSavesSeparate'],
  ] as const)('attend le choix local %s avant de reprendre le cloud', async (choice, action) => {
    const authorizeCatalog = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      _resolutions: ReadonlyMap<number, unknown>,
      decision?: { choice: string, proposalId: number },
    ) => {
      if (decision?.choice === choice && decision.proposalId === 7) return
      throw localImportRequired(7, 2)
    })
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)

    expect(coordinator.getState()).toEqual({
      stage: 'local-import',
      access: { kind: 'online', account: alice },
      transferCount: 2,
    })
    expect(authorizeCatalog).toHaveBeenCalledOnce()

    await coordinator[action]()

    expect(authorizeCatalog).toHaveBeenCalledTimes(2)
    expect(authorizeCatalog.mock.calls[1]?.[3]).toEqual({ choice, proposalId: 7 })
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'online', account: alice },
    })
  })

  it('conserve garder séparée pendant la résolution cloud sans reproposer l’import', async () => {
    const cloudConflict = Object.assign(new Error('Conflit cloud.'), {
      name: 'TitleSaveCloudConflictError',
      slot: 1,
      remoteEtag: '"remote"',
      localVersion: { storageToken: 'local-v1', tombstoneChangedAt: null },
      choices: ['remote'] as const,
      conflictKind: 'divergent' as const,
    })
    const authorizeCatalog = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      resolutions: ReadonlyMap<number, unknown>,
      decision?: { choice: string, proposalId: number },
    ) => {
      if (!decision) throw localImportRequired(11)
      if (!resolutions.has(1)) throw cloudConflict
    })
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)
    await coordinator.keepLocalSavesSeparate()
    expect(coordinator.getState().stage).toBe('catalog-conflict')

    await coordinator.useCloudConflict()

    expect(authorizeCatalog).toHaveBeenCalledTimes(3)
    expect(authorizeCatalog.mock.calls[2]?.[3]).toEqual({
      choice: 'keep-separate',
      proposalId: 11,
    })
    expect(coordinator.getState().stage).toBe('authorized')
  })

  it('borne une restauration lente, ignore sa réponse tardive et laisse choisir le local', async () => {
    vi.useFakeTimers()
    const restoration = deferred<OnlineAccount | undefined>()
    let restorationSignal: AbortSignal | undefined
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        hasPersistedSession: () => true,
        restore: (signal) => {
          restorationSignal = signal
          return restoration.promise
        },
      }),
      allowLocalAccess: true,
      restoreTimeoutMs: 25,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    const opening = coordinator.open()
    await vi.advanceTimersByTimeAsync(25)
    await opening

    expect(coordinator.getState()).toEqual({
      stage: 'unavailable',
      message: 'Serveur trop lent.',
      canRetry: true,
    })
    expect(authorizeCatalog).not.toHaveBeenCalled()
    expect(restorationSignal?.aborted).toBe(true)

    await coordinator.useLocal()
    restoration.resolve(alice)
    await Promise.resolve()

    expect(authorizeCatalog).toHaveBeenCalledOnce()
    expect(authorizeCatalog.mock.calls[0]?.[0]).toEqual({ kind: 'local' })
    expect(authorizeCatalog.mock.calls[0]?.[1]).toBeInstanceOf(AbortSignal)
    expect(coordinator.getState()).toEqual({ stage: 'authorized', access: { kind: 'local' } })
  })

  it('revient au formulaire quand le serveur invalide la session persistée', async () => {
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        hasPersistedSession: () => true,
        restore: async () => undefined,
      }),
      onAuthorizeCatalogAccess: vi.fn(),
    })

    await coordinator.open()

    expect(coordinator.getState()).toEqual({ stage: 'signed-out', mode: 'login' })
  })

  it.each([
    ['login', 'Connexion impossible.'],
    ['register', 'Création impossible.'],
  ] as const)('autorise le catalogue après %s sans exposer le mot de passe', async (mode, failure) => {
    const credentials: OnlineAccountCredentials = {
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    }
    const authenticate = vi.fn(async () => authentication())
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ [mode]: authenticate }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    await coordinator[mode](credentials)

    expect(authenticate).toHaveBeenCalledWith(credentials, expect.any(AbortSignal))
    expect(authorizeCatalog).toHaveBeenCalledOnce()
    expect(coordinator.getState().stage).toBe('authorized')
    expect(JSON.stringify(coordinator.getState())).not.toContain(credentials.password)
    expect(JSON.stringify(coordinator.getState())).not.toContain(failure)
  })

  it('prépare la clé privée après authentification et avant le catalogue sans publier le secret', async () => {
    const order: string[] = []
    const credentials: OnlineAccountCredentials = {
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    }
    const onAuthenticated = vi.fn(async (account: OnlineAccount, received: OnlineAccountCredentials) => {
      expect(account).toBe(alice)
      expect(received).toBe(credentials)
      order.push('key')
    })
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ login: async () => authentication() }),
      onAuthenticated,
      onAuthorizeCatalogAccess: () => { order.push('catalog') },
    })
    await coordinator.open()

    await coordinator.login(credentials)

    expect(order).toEqual(['key', 'catalog'])
    expect(JSON.stringify(coordinator.getState())).not.toContain(credentials.password)
  })

  it('annule la requête de connexion et ignore sa réponse si le sas est fermé', async () => {
    const pendingAuthentication = deferred<OnlineAccountAuthentication>()
    let authenticationSignal: AbortSignal | undefined
    const login = vi.fn((_credentials: OnlineAccountCredentials, signal?: AbortSignal) => {
      authenticationSignal = signal
      return pendingAuthentication.promise
    })
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ login }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    const authenticationAttempt = coordinator.login({
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    })
    expect(coordinator.getState().stage).toBe('authenticating')
    coordinator.close()

    expect(authenticationSignal?.aborted).toBe(true)
    await authenticationAttempt
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    pendingAuthentication.resolve(authentication())
    await Promise.resolve()
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('ferme pendant la préparation privée, efface la session publiée et ignore sa fin tardive', async () => {
    const preparation = deferred<void>()
    let preparationSignal: AbortSignal | undefined
    const clear = vi.fn()
    const login = vi.fn(async () => authentication())
    const onAuthenticated = vi.fn((_account: OnlineAccount, _credentials: OnlineAccountCredentials, signal: AbortSignal) => {
      preparationSignal = signal
      return preparation.promise
    })
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ login, clear }),
      onAuthenticated,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    const authenticationAttempt = coordinator.login({
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    })
    await vi.waitFor(() => { expect(onAuthenticated).toHaveBeenCalledOnce() })
    expect(login).toHaveBeenCalledOnce()

    coordinator.close()

    expect(preparationSignal?.aborted).toBe(true)
    expect(clear).toHaveBeenCalledOnce()
    await authenticationAttempt
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    preparation.resolve()
    await Promise.resolve()
    expect(clear).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it.each([
    ['login', 'Connexion trop lente.'],
    ['register', 'Création trop lente.'],
  ] as const)('borne %s, revient au formulaire et ne publie jamais sa réponse tardive', async (
    mode,
    expectedMessage,
  ) => {
    vi.useFakeTimers()
    const pendingAuthentication = deferred<OnlineAccountAuthentication>()
    let authenticationSignal: AbortSignal | undefined
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        [mode]: (_credentials: OnlineAccountCredentials, signal?: AbortSignal) => {
          authenticationSignal = signal
          return pendingAuthentication.promise
        },
      }),
      operationTimeoutMs: 25,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    const authenticationAttempt = coordinator[mode]({
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    })
    await vi.advanceTimersByTimeAsync(25)
    await authenticationAttempt

    expect(authenticationSignal?.aborted).toBe(true)
    expect(coordinator.getState()).toEqual({
      stage: 'signed-out',
      mode,
      message: expectedMessage,
    })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    pendingAuthentication.resolve(authentication())
    await Promise.resolve()
    expect(coordinator.getState().stage).toBe('signed-out')
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('borne la préparation privée après login, efface la session et ignore sa fin tardive', async () => {
    vi.useFakeTimers()
    const preparation = deferred<void>()
    let preparationSignal: AbortSignal | undefined
    const clear = vi.fn()
    const login = vi.fn(async () => authentication())
    const onAuthenticated = vi.fn((_account: OnlineAccount, _credentials: OnlineAccountCredentials, signal: AbortSignal) => {
      preparationSignal = signal
      return preparation.promise
    })
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ login, clear }),
      operationTimeoutMs: 25,
      onAuthenticated,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    const authenticationAttempt = coordinator.login({
      username: 'alice',
      password: 'mot-de-passe-ultra-secret',
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(login).toHaveBeenCalledOnce()
    expect(onAuthenticated).toHaveBeenCalledOnce()
    await vi.advanceTimersByTimeAsync(25)
    await authenticationAttempt

    expect(preparationSignal?.aborted).toBe(true)
    expect(clear).toHaveBeenCalledOnce()
    expect(coordinator.getState()).toEqual({
      stage: 'signed-out',
      mode: 'login',
      message: 'Connexion trop lente.',
    })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    preparation.resolve()
    await Promise.resolve()
    expect(clear).toHaveBeenCalledOnce()
    expect(coordinator.getState().stage).toBe('signed-out')
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('expurge aussi un secret repris dans une erreur d’authentification', async () => {
    const secret = 'mot-de-passe-ultra-secret'
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        login: async () => { throw new Error(`Refus pour ${secret}`) },
      }),
      onAuthorizeCatalogAccess: vi.fn(),
    })
    await coordinator.open()

    await coordinator.login({ username: 'alice', password: secret })

    expect(coordinator.getState()).toEqual({
      stage: 'signed-out',
      mode: 'login',
      message: 'Refus pour ••••',
    })
  })

  it('garde le sas fermé si le catalogue échoue puis permet de relancer la même autorisation', async () => {
    const authorizeCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('Stockage verrouillé.'))
      .mockResolvedValueOnce(undefined)
    const coordinator = createTitleAccountGateCoordinator({
      session: session(),
      allowLocalAccess: true,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })
    await coordinator.open()

    await coordinator.useLocal()
    expect(coordinator.getState()).toEqual({
      stage: 'catalog-error',
      access: { kind: 'local' },
      message: 'Stockage verrouillé.',
    })

    coordinator.reconnect()
    expect(coordinator.getState().stage).toBe('catalog-error')

    await coordinator.retryCatalog()

    expect(authorizeCatalog).toHaveBeenCalledTimes(2)
    expect(coordinator.getState()).toEqual({ stage: 'authorized', access: { kind: 'local' } })
  })

  it('borne le catalogue, annule son signal et laisse choisir un autre accès', async () => {
    vi.useFakeTimers()
    const pendingCatalog = deferred<void>()
    let catalogSignal: AbortSignal | undefined
    const authorizeCatalog = vi.fn()
      .mockImplementationOnce((_access: unknown, signal: AbortSignal) => {
        catalogSignal = signal
        return pendingCatalog.promise
      })
      .mockResolvedValueOnce(undefined)
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      operationTimeoutMs: 25,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await coordinator.open()
    const opening = coordinator.continueWithAccount()
    await vi.advanceTimersByTimeAsync(25)
    await opening

    expect(catalogSignal?.aborted).toBe(true)
    expect(coordinator.getState()).toEqual({
      stage: 'catalog-error',
      access: { kind: 'online', account: alice },
      message: 'Ouverture des sauvegardes trop lente.',
    })

    await coordinator.useAccountCache()
    expect(authorizeCatalog.mock.calls[1]?.[0]).toEqual({ kind: 'account-cache', account: alice })
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'account-cache', account: alice },
    })

    pendingCatalog.resolve()
    await Promise.resolve()
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'account-cache', account: alice },
    })
  })

  it('redemande le mot de passe après une erreur du catalogue en ligne puis refait toute la chaîne privée', async () => {
    const credentials: OnlineAccountCredentials = {
      username: 'alice',
      password: 'nouveau-mot-de-passe-secret',
    }
    const login = vi.fn(async () => authentication())
    const onAuthenticated = vi.fn()
    const authorizeCatalog = vi.fn()
      .mockRejectedValueOnce(new Error('Clé du coffre absente.'))
      .mockResolvedValueOnce(undefined)
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice, login }),
      onAuthenticated,
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)
    expect(coordinator.getState()).toEqual({
      stage: 'catalog-error',
      access: { kind: 'online', account: alice },
      message: 'Clé du coffre absente.',
    })

    coordinator.reconnect()
    expect(coordinator.getState()).toEqual({ stage: 'signed-out', mode: 'login' })

    await coordinator.login(credentials)

    expect(login).toHaveBeenCalledWith(credentials, expect.any(AbortSignal))
    expect(onAuthenticated).toHaveBeenCalledOnce()
    expect(onAuthenticated).toHaveBeenCalledWith(alice, credentials, expect.any(AbortSignal))
    expect(authorizeCatalog).toHaveBeenCalledTimes(2)
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'online', account: alice },
    })
    expect(JSON.stringify(coordinator.getState())).not.toContain(credentials.password)
  })

  it('laisse choisir explicitement la version cloud d’un conflit puis reprend la chaîne', async () => {
    const etag = '"remote-conflict"'
    const localVersion = { storageToken: 'local-v1'.repeat(1_000), tombstoneChangedAt: null }
    const authorizeCatalog = vi.fn(async (
      _access: unknown,
      _signal: AbortSignal,
      resolutions: ReadonlyMap<number, {
        remoteEtag: string
        localVersion: { storageToken: string | null, tombstoneChangedAt: string | null }
      }>,
    ) => {
      if (resolutions.get(2)?.remoteEtag === etag) return
      const conflict = new Error('Deux versions occupent le même emplacement.') as Error & {
        slot: number
        remoteEtag: string
        localVersion: typeof localVersion
        choices: readonly ('local' | 'remote')[]
        conflictKind: 'divergent'
      }
      conflict.name = 'TitleSaveCloudConflictError'
      conflict.slot = 2
      conflict.remoteEtag = etag
      conflict.localVersion = localVersion
      conflict.choices = ['local', 'remote']
      conflict.conflictKind = 'divergent'
      throw conflict
    })
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)
    expect(coordinator.getState()).toEqual({
      stage: 'catalog-conflict',
      access: { kind: 'online', account: alice },
      slot: 2,
      message: 'Deux versions occupent le même emplacement.',
      choices: ['local', 'remote'],
      conflictKind: 'divergent',
    })

    await coordinator.useCloudConflict()

    expect(authorizeCatalog).toHaveBeenCalledTimes(2)
    expect(authorizeCatalog.mock.calls[1]?.[2]).toEqual(new Map([[2, { choice: 'remote', remoteEtag: etag, localVersion }]]))
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'online', account: alice },
    })
  })

  it('ouvre le cache du même compte sans transport au lieu du stockage local global', async () => {
    const conflict = new Error('Conflit.') as Error & {
      slot: number
      remoteEtag: string
      localVersion: { storageToken: string | null, tombstoneChangedAt: string | null }
      choices: readonly ('local' | 'remote')[]
      conflictKind: 'divergent'
    }
    conflict.name = 'TitleSaveCloudConflictError'
    conflict.slot = 1
    conflict.remoteEtag = '"remote"'
    conflict.localVersion = { storageToken: 'local-v1', tombstoneChangedAt: null }
    conflict.choices = ['local', 'remote']
    conflict.conflictKind = 'divergent'
    const authorizeCatalog = vi.fn(async (access: { kind: string }) => {
      if (access.kind === 'online') throw conflict
    })
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)
    await coordinator.useAccountCache()

    expect(authorizeCatalog.mock.calls[1]?.[0]).toEqual({ kind: 'account-cache', account: alice })
    expect(coordinator.getState()).toEqual({
      stage: 'authorized',
      access: { kind: 'account-cache', account: alice },
    })
  })

  it('relit une fois le cloud après un If-Match périmé puis redemande le choix frais', async () => {
    const changed = new Error('Version distante modifiée.')
    changed.name = 'TitleSaveCloudRemoteChangedError'
    const conflict = Object.assign(new Error('Conflit frais.'), {
      name: 'TitleSaveCloudConflictError',
      slot: 2,
      remoteEtag: '"fresh"',
      localVersion: { storageToken: 'local-v2', tombstoneChangedAt: null },
      choices: ['local', 'remote'] as const,
      conflictKind: 'divergent' as const,
    })
    const authorizeCatalog = vi.fn()
      .mockRejectedValueOnce(changed)
      .mockRejectedValueOnce(conflict)
    const coordinator = createTitleAccountGateCoordinator({
      session: session({ getAccount: () => alice }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    await openAndConfirmAccount(coordinator)

    expect(authorizeCatalog).toHaveBeenCalledTimes(2)
    expect(coordinator.getState()).toEqual(expect.objectContaining({
      stage: 'catalog-conflict',
      slot: 2,
      choices: ['local', 'remote'],
    }))
  })

  it('invalide une opération en vol dès la fermeture', async () => {
    const restoration = deferred<OnlineAccount | undefined>()
    let restorationSignal: AbortSignal | undefined
    const authorizeCatalog = vi.fn()
    const coordinator = createTitleAccountGateCoordinator({
      session: session({
        hasPersistedSession: () => true,
        restore: (signal) => {
          restorationSignal = signal
          return restoration.promise
        },
      }),
      onAuthorizeCatalogAccess: authorizeCatalog,
    })

    const opening = coordinator.open()
    coordinator.close()
    expect(restorationSignal?.aborted).toBe(true)
    await opening
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()

    restoration.resolve(alice)
    await Promise.resolve()

    expect(coordinator.getState()).toEqual({ stage: 'closed' })
    expect(authorizeCatalog).not.toHaveBeenCalled()
  })

  it('annule le chargement du catalogue en vol dès la fermeture', async () => {
    const started = deferred<void>()
    let catalogSignal: AbortSignal | undefined
    const coordinator = createTitleAccountGateCoordinator({
      session: session(),
      allowLocalAccess: true,
      onAuthorizeCatalogAccess: (_access, signal) => {
        catalogSignal = signal
        return started.promise
      },
    })
    await coordinator.open()

    const local = coordinator.useLocal()
    await vi.waitFor(() => { expect(catalogSignal).toBeDefined() })
    coordinator.close()

    expect(catalogSignal?.aborted).toBe(true)
    await local
    expect(coordinator.getState()).toEqual({ stage: 'closed' })

    started.resolve()
    await Promise.resolve()
    expect(coordinator.getState()).toEqual({ stage: 'closed' })
  })
})
