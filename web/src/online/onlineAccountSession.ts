import type { OnlineClientConfig } from './onlineClientConfig'
import { readOnlineClientConfig } from './onlineClientConfig'
import { createOnlineRuntimeAccessToken } from './onlineRuntimeAccessToken'

export const onlineAccountSessionStorageKey = 'pokemaster:account-session:v1' as const
const legacyTestDeviceEnrollmentStorageKey = 'pokemaster:test-device:v1'

export type OnlineAccountRole = 'user' | 'admin'

export type OnlineAccount = Readonly<{
  id: string
  username: string
  role: OnlineAccountRole
  entitlements: readonly string[]
  vaultKeyId?: string
}>

export type OnlineAccountCredentials = Readonly<{
  username: string
  password: string
}>

export type OnlineAccountAuthentication = Readonly<{
  account: OnlineAccount
  session: Readonly<{
    accessToken: string
    expiresAt: number
  }>
}>

type AccountStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
type FetchLike = (input: string, init: RequestInit) => Promise<Response>

export type OnlineAccountSessionOptions = Readonly<{
  config?: OnlineClientConfig
  storage?: AccountStorage
  fetch?: FetchLike
  now?: () => number
}>

export type OnlineAccountSession = Readonly<{
  configured: boolean
  getAccount: () => OnlineAccount | undefined
  getAccessSnapshot: () => OnlineAccountAccessSnapshot
  subscribeAccess: (listener: (snapshot: OnlineAccountAccessSnapshot) => void) => () => void
  hasPersistedSession: () => boolean
  readAccessToken: () => string | undefined
  register: (
    credentials: OnlineAccountCredentials,
    signal?: AbortSignal,
  ) => Promise<OnlineAccountAuthentication>
  login: (
    credentials: OnlineAccountCredentials,
    signal?: AbortSignal,
  ) => Promise<OnlineAccountAuthentication>
  restore: (signal?: AbortSignal) => Promise<OnlineAccount | undefined>
  logout: () => Promise<void>
  clear: () => void
}>

export type OnlineAccountAccessSnapshot = Readonly<{
  signedIn: boolean
  account?: OnlineAccount
  isAdmin: boolean
  online: boolean
  premiumClient: boolean
  cloudStorage: boolean
  development: boolean
}>

type StoredAccountSession = Readonly<{
  version: 1
  serverUrl: string
  accessToken: string
  expiresAt: number
}>

type AccountSessionOperation = Readonly<{
  revision: number
  controller: AbortController
  detachCallerAbort: () => void
}>

const maximumResponseBytes = 32 * 1024
const maximumStoredSessionBytes = 4 * 1024
const usernamePattern = /^[A-Za-z0-9._-]{3,32}$/
const entitlementPattern = /^[a-z0-9][a-z0-9:-]{0,63}$/
const vaultKeyIdPattern = /^[A-Za-z0-9_-]{43}$/

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined
}

function validateCredentials(credentials: OnlineAccountCredentials): OnlineAccountCredentials {
  const username = credentials.username.normalize('NFKC').trim().toLowerCase()
  if (!usernamePattern.test(username)) {
    throw new TypeError("L'identifiant doit contenir 3 à 32 lettres, chiffres, points, tirets ou tirets bas.")
  }
  if (
    credentials.password.length < 10
    || credentials.password.length > 128
    || new TextEncoder().encode(credentials.password).byteLength > 256
  ) {
    throw new TypeError('Le mot de passe doit contenir entre 10 et 128 caractères, sans dépasser 256 octets.')
  }
  return Object.freeze({ username, password: credentials.password })
}

function parseAccount(value: unknown): OnlineAccount | undefined {
  const record = asRecord(value)
  if (!record) return undefined
  if (
    typeof record.id !== 'string'
    || record.id.length === 0
    || record.id.length > 128
    || typeof record.username !== 'string'
    || !usernamePattern.test(record.username)
    || record.id !== record.username
    || record.role !== 'user' && record.role !== 'admin'
    || !Array.isArray(record.entitlements)
    || record.vaultKeyId !== undefined && (
      typeof record.vaultKeyId !== 'string' || !vaultKeyIdPattern.test(record.vaultKeyId)
    )
  ) return undefined
  const entitlements = record.entitlements
  if (
    entitlements.length > 32
    || entitlements.some((entry) => typeof entry !== 'string' || !entitlementPattern.test(entry))
  ) return undefined
  return Object.freeze({
    id: record.id,
    username: record.username,
    role: record.role,
    entitlements: Object.freeze([...new Set(entitlements as string[])]),
    ...(record.vaultKeyId === undefined ? {} : { vaultKeyId: record.vaultKeyId as string }),
  })
}

function validateAccessToken(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined
  const token = createOnlineRuntimeAccessToken()
  try {
    token.replace(value)
    return token.read()
  } catch {
    return undefined
  }
}

function parseExpiry(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return value
  if (typeof value !== 'string' || value.length > 64) return undefined
  const timestamp = Date.parse(value)
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : undefined
}

function parseAuthentication(value: unknown): OnlineAccountAuthentication | undefined {
  const record = asRecord(value)
  const session = asRecord(record?.session)
  const account = parseAccount(record?.account)
  const accessToken = validateAccessToken(session?.accessToken)
  const expiresAt = parseExpiry(session?.expiresAt)
  return account && accessToken && expiresAt
    ? Object.freeze({
      account,
      session: Object.freeze({ accessToken, expiresAt }),
    })
    : undefined
}

function parseAccountEnvelope(value: unknown): OnlineAccount | undefined {
  return parseAccount(asRecord(value)?.account)
}

function removeStoredSession(storage: AccountStorage | undefined): void {
  try { storage?.removeItem(onlineAccountSessionStorageKey) }
  catch { /* Le stockage peut être désactivé; la session mémoire reste nettoyée. */ }
}

function accountSessionAbortError(): DOMException {
  return new DOMException('Opération de compte annulée.', 'AbortError')
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}

async function awaitAbortable<T>(operation: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return operation
  let rejectCancellation: (() => void) | undefined
  try {
    return await new Promise<T>((resolve, reject) => {
      rejectCancellation = () => { reject(accountSessionAbortError()) }
      signal.addEventListener('abort', rejectCancellation, { once: true })
      operation.then(resolve, reject)
      if (signal.aborted) rejectCancellation()
    })
  } finally {
    if (rejectCancellation) signal.removeEventListener('abort', rejectCancellation)
  }
}

function persistSession(
  storage: AccountStorage | undefined,
  serverUrl: string,
  authentication: OnlineAccountAuthentication,
): void {
  const value: StoredAccountSession = Object.freeze({
    version: 1,
    serverUrl,
    accessToken: authentication.session.accessToken,
    expiresAt: authentication.session.expiresAt,
  })
  try { storage?.setItem(onlineAccountSessionStorageKey, JSON.stringify(value)) }
  catch { /* La connexion courante reste active sans persistance. */ }
}

function parseStoredSession(
  encoded: string,
  expectedServerUrl: string,
  now: number,
): StoredAccountSession | undefined {
  if (new TextEncoder().encode(encoded).byteLength > maximumStoredSessionBytes) return undefined
  let value: unknown
  try { value = JSON.parse(encoded) }
  catch { return undefined }
  const record = asRecord(value)
  const accessToken = validateAccessToken(record?.accessToken)
  const expiresAt = parseExpiry(record?.expiresAt)
  if (
    record?.version !== 1
    || record.serverUrl !== expectedServerUrl
    || !accessToken
    || !expiresAt
    || expiresAt <= now
  ) return undefined
  return Object.freeze({ version: 1, serverUrl: expectedServerUrl, accessToken, expiresAt })
}

async function decodeResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (new TextEncoder().encode(text).byteLength > maximumResponseBytes) {
    throw new Error('La réponse du service de comptes est trop volumineuse.')
  }
  if (text.length === 0) return undefined
  try { return JSON.parse(text) }
  catch { throw new Error('La réponse du service de comptes est invalide.') }
}

function responseError(response: Response, value: unknown, fallback: string): Error {
  const envelope = asRecord(value)
  const nested = asRecord(envelope?.error)
  const serverMessage = typeof nested?.message === 'string'
    ? nested.message
    : typeof envelope?.message === 'string' ? envelope.message : undefined
  if (response.status === 401) return new Error('Identifiant ou mot de passe incorrect.')
  if (response.status === 409) return new Error('Cet identifiant est déjà utilisé.')
  if (response.status === 429) return new Error('Trop de tentatives. Réessayez dans quelques instants.')
  return new Error(serverMessage && serverMessage.length <= 256 ? serverMessage : fallback)
}

/**
 * Capsule de compte du client statique. Le Bearer opaque est la seule donnée
 * secrète conservée pour la durée de l'onglet; il ne rejoint ni le DOM, ni les
 * snapshots de jeu, ni le stockage local durable.
 */
export function createOnlineAccountSession(options: OnlineAccountSessionOptions): OnlineAccountSession {
  const { config } = options
  const fetchRequest = options.fetch
    ?? (typeof globalThis.fetch === 'function' ? globalThis.fetch.bind(globalThis) : undefined)
  const now = options.now ?? Date.now
  const token = createOnlineRuntimeAccessToken()
  let expiresAt: number | undefined
  let account: OnlineAccount | undefined
  let operationRevision = 0
  let activeOperation: AccountSessionOperation | undefined
  const accessListeners = new Set<(snapshot: OnlineAccountAccessSnapshot) => void>()

  const publishAccess = (): void => {
    const snapshot = projectOnlineAccountAccess(account)
    for (const listener of accessListeners) {
      try { listener(snapshot) } catch { /* Un observateur ne pilote jamais la session. */ }
    }
  }

  const invalidateOperations = (): void => {
    operationRevision += 1
    activeOperation?.controller.abort()
    activeOperation?.detachCallerAbort()
    activeOperation = undefined
  }

  const clearSession = (): void => {
    token.clear()
    expiresAt = undefined
    account = undefined
    removeStoredSession(options.storage)
    publishAccess()
  }

  const clear = (): void => {
    invalidateOperations()
    clearSession()
  }

  const beginOperation = (callerSignal?: AbortSignal): AccountSessionOperation => {
    invalidateOperations()
    const controller = new AbortController()
    const abortFromCaller = (): void => { controller.abort(callerSignal?.reason) }
    if (callerSignal?.aborted) abortFromCaller()
    else callerSignal?.addEventListener('abort', abortFromCaller, { once: true })
    const operation = Object.freeze({
      revision: operationRevision,
      controller,
      detachCallerAbort: () => { callerSignal?.removeEventListener('abort', abortFromCaller) },
    })
    activeOperation = operation
    return operation
  }

  const finishOperation = (operation: AccountSessionOperation): void => {
    operation.detachCallerAbort()
    if (activeOperation === operation) activeOperation = undefined
  }

  const requireCurrentOperation = (operation: AccountSessionOperation): void => {
    if (
      activeOperation !== operation
      || operationRevision !== operation.revision
      || operation.controller.signal.aborted
    ) throw accountSessionAbortError()
  }

  const clearIfExpired = (): boolean => {
    if (expiresAt === undefined || expiresAt > now()) return false
    clear()
    return true
  }

  try { options.storage?.removeItem(legacyTestDeviceEnrollmentStorageKey) }
  catch { /* Migration best-effort de l'ancien enrôlement par appareil. */ }

  if (config) {
    let stored: string | null = null
    try { stored = options.storage?.getItem(onlineAccountSessionStorageKey) ?? null }
    catch { /* Un navigateur peut refuser le stockage de session. */ }
    if (stored !== null) {
      const parsed = parseStoredSession(stored, config.identityBaseUrl, now())
      if (parsed) {
        token.replace(parsed.accessToken)
        expiresAt = parsed.expiresAt
      } else {
        removeStoredSession(options.storage)
      }
    }
  } else {
    removeStoredSession(options.storage)
  }

  const request = async (
    method: 'GET' | 'POST',
    path: string,
    body?: unknown,
    accessToken?: string,
    signal?: AbortSignal,
  ): Promise<Readonly<{ response: Response, value: unknown }>> => {
    if (!config || !fetchRequest) throw new Error("Le service de comptes n'est pas configuré.")
    let response: Response
    try {
      if (signal?.aborted) throw accountSessionAbortError()
      response = await awaitAbortable(
        fetchRequest(`${config.httpBaseUrl}${path}`, {
          method,
          signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            Accept: 'application/json',
            ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
            ...(accessToken === undefined ? {} : { Authorization: `Bearer ${accessToken}` }),
          },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        }),
        signal,
      )
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw accountSessionAbortError()
      throw new Error('Le serveur de comptes est inaccessible.', { cause: error })
    }
    try {
      const value = await awaitAbortable(decodeResponse(response), signal)
      if (signal?.aborted) throw accountSessionAbortError()
      return Object.freeze({ response, value })
    } catch (error) {
      if (signal?.aborted || isAbortError(error)) throw accountSessionAbortError()
      throw error
    }
  }

  const authenticate = async (
    path: '/v1/accounts/register' | '/v1/accounts/login',
    credentials: OnlineAccountCredentials,
    signal?: AbortSignal,
  ): Promise<OnlineAccountAuthentication> => {
    const operation = beginOperation(signal)
    try {
      requireCurrentOperation(operation)
      const serverUrl = config?.identityBaseUrl
      if (!serverUrl) throw new Error("Le service de comptes n'est pas configuré.")
      const validated = validateCredentials(credentials)
      const { response, value } = await request(
        'POST',
        path,
        validated,
        undefined,
        operation.controller.signal,
      )
      requireCurrentOperation(operation)
      if (!response.ok) {
        throw responseError(
          response,
          value,
          path.endsWith('/register') ? 'La création du compte a échoué.' : 'La connexion a échoué.',
        )
      }
      const authentication = parseAuthentication(value)
      if (!authentication || authentication.session.expiresAt <= now()) {
        throw new Error('La session renvoyée par le serveur est invalide.')
      }
      requireCurrentOperation(operation)
      token.replace(authentication.session.accessToken)
      expiresAt = authentication.session.expiresAt
      account = authentication.account
      persistSession(options.storage, serverUrl, authentication)
      publishAccess()
      return authentication
    } finally {
      finishOperation(operation)
    }
  }

  return Object.freeze({
    configured: config !== undefined && fetchRequest !== undefined,
    getAccount: () => clearIfExpired() ? undefined : account,
    getAccessSnapshot: () => {
      clearIfExpired()
      return projectOnlineAccountAccess(account)
    },
    subscribeAccess(listener) {
      clearIfExpired()
      accessListeners.add(listener)
      try { listener(projectOnlineAccountAccess(account)) } catch { /* Observation isolée. */ }
      return () => { accessListeners.delete(listener) }
    },
    hasPersistedSession: () => !clearIfExpired() && token.read() !== undefined && expiresAt !== undefined,
    readAccessToken: () => {
      clearIfExpired()
      return token.read()
    },
    register: (credentials, signal) => authenticate('/v1/accounts/register', credentials, signal),
    login: (credentials, signal) => authenticate('/v1/accounts/login', credentials, signal),
    async restore(signal) {
      const operation = beginOperation(signal)
      try {
        requireCurrentOperation(operation)
        const accessToken = token.read()
        if (!accessToken || expiresAt === undefined || expiresAt <= now()) {
          requireCurrentOperation(operation)
          invalidateOperations()
          clearSession()
          return undefined
        }
        const { response, value } = await request(
          'GET',
          '/v1/account',
          undefined,
          accessToken,
          operation.controller.signal,
        )
        requireCurrentOperation(operation)
        if (response.status === 401) {
          invalidateOperations()
          clearSession()
          return undefined
        }
        if (!response.ok) throw responseError(response, value, 'La restauration du compte a échoué.')
        const restored = parseAccountEnvelope(value)
        if (!restored) throw new Error('Le compte renvoyé par le serveur est invalide.')
        requireCurrentOperation(operation)
        account = restored
        publishAccess()
        return restored
      } finally {
        finishOperation(operation)
      }
    },
    async logout() {
      const accessToken = token.read()
      clear()
      if (!accessToken || !config || !fetchRequest) return
      try { await request('POST', '/v1/accounts/logout', undefined, accessToken) }
      catch { /* La déconnexion locale est définitive même si le VPS est hors ligne. */ }
    },
    clear,
  })
}

/** @internal Purge de migration isolée afin que chaque ancienne clé soit tentée. */
export function purgeDurableOnlineAccountSessions(storage: Pick<Storage, 'removeItem'>): void {
  for (const key of [legacyTestDeviceEnrollmentStorageKey, onlineAccountSessionStorageKey]) {
    try { storage.removeItem(key) }
    catch { /* Une clé refusée ne doit pas empêcher la tentative sur l'autre. */ }
  }
}

function browserStorage(): AccountStorage | undefined {
  try { purgeDurableOnlineAccountSessions(window.localStorage) }
  catch { /* Le getter localStorage lui-même peut être refusé. */ }
  try { return window.sessionStorage }
  catch { return undefined }
}

const browserAccountSession = typeof window === 'undefined'
  ? createOnlineAccountSession({})
  : createOnlineAccountSession({
    config: readOnlineClientConfig(),
    storage: browserStorage(),
  })

export function readBrowserOnlineAccountSession(): OnlineAccountSession {
  return browserAccountSession
}

export function hasOnlineAccountEntitlement(account: OnlineAccount, entitlement: string): boolean {
  return account.role === 'admin'
    || account.entitlements.includes(entitlement)
    || account.entitlements.includes('development')
}

/** Projection sans Bearer, partageable avec les gardes multijoueur et NG+. */
export function projectOnlineAccountAccess(account?: OnlineAccount): OnlineAccountAccessSnapshot {
  const development = account?.entitlements.includes('development') ?? false
  return Object.freeze({
    signedIn: account !== undefined,
    ...(account ? { account } : {}),
    isAdmin: account?.role === 'admin',
    online: account ? hasOnlineAccountEntitlement(account, 'online') : false,
    premiumClient: account ? hasOnlineAccountEntitlement(account, 'premium-client') : false,
    cloudStorage: account ? hasOnlineAccountEntitlement(account, 'cloud-storage') : false,
    development,
  })
}
