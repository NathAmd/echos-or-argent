import type { OnlineClientConfig } from './onlineClientConfig'
import {
  isOnlineMatchmakingActivity,
  parseOnlineMatchmakingStatus,
  type OnlineMatchmakingActivity,
  type OnlineMatchmakingStatus,
} from './onlineMatchmakingProtocol'
import { OnlineServiceError } from './onlineSocialClient'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>
const maximumResponseBytes = 64 * 1024
const strictTextDecoder = new TextDecoder('utf-8', { fatal: true })
export const onlineMatchmakingDefaultRequestTimeoutMs = 10_000
const minimumRequestTimeoutMs = 250
const maximumRequestTimeoutMs = 120_000

export class OnlineMatchmakingRequestTimeoutError extends Error {
  readonly code = 'online-matchmaking-timeout' as const
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`La requête de rendez-vous multijoueur a expiré après ${timeoutMs} ms.`)
    this.name = 'OnlineMatchmakingRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export type OnlineMatchmakingClient = Readonly<{
  getStatus: (signal?: AbortSignal) => Promise<OnlineMatchmakingStatus>
  join: (activity: OnlineMatchmakingActivity, signal?: AbortSignal) => Promise<OnlineMatchmakingStatus>
  cancel: (signal?: AbortSignal) => Promise<void>
}>

export type OnlineMatchmakingClientOptions = Readonly<{
  config: OnlineClientConfig
  readAccessToken: () => string | undefined
  fetch?: FetchLike
  /** Délai total, réponse en flux comprise. Valeur autorisée : 250 ms à 120 s. */
  requestTimeoutMs?: number
}>

function validatedRequestTimeout(value: number | undefined): number {
  const timeoutMs = value ?? onlineMatchmakingDefaultRequestTimeoutMs
  if (!Number.isSafeInteger(timeoutMs)
    || timeoutMs < minimumRequestTimeoutMs
    || timeoutMs > maximumRequestTimeoutMs) {
    throw new RangeError('Le délai HTTP du matchmaking doit être compris entre 250 et 120 000 ms.')
  }
  return timeoutMs
}

function callerAbortReason(signal: AbortSignal): unknown {
  if (signal.reason !== undefined) return signal.reason
  return new DOMException('La requête de matchmaking a été annulée.', 'AbortError')
}

function errorEnvelope(value: unknown): Readonly<{ code: string, message: string, requestId?: string }> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const envelope = value as Record<string, unknown>
  const errorValue = envelope.error
  if (errorValue === null || Array.isArray(errorValue) || typeof errorValue !== 'object') return undefined
  const error = errorValue as Record<string, unknown>
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return undefined
  return Object.freeze({
    code: error.code,
    message: error.message,
    ...(typeof envelope.requestId === 'string' ? { requestId: envelope.requestId } : {}),
  })
}

async function readBoundedResponseText(response: Response): Promise<string> {
  const declaredHeader = response.headers.get('Content-Length')
  if (declaredHeader !== null) {
    const declared = /^(?:0|[1-9][0-9]*)$/.test(declaredHeader) ? Number(declaredHeader) : Number.NaN
    if (!Number.isSafeInteger(declared) || declared > maximumResponseBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Réponse du rendez-vous multijoueur trop volumineuse ou mal bornée.')
    }
  }
  if (response.body === null) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      received += result.value.byteLength
      if (received > maximumResponseBytes) {
        throw new Error('Réponse du rendez-vous multijoueur trop volumineuse.')
      }
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try { return strictTextDecoder.decode(bytes) }
  catch { throw new Error("La réponse du rendez-vous multijoueur n'est pas un texte UTF-8 valide.") }
}

/** Client HTTP sans état : le contrôleur produit reste propriétaire du cycle de vie. */
export function createOnlineMatchmakingClient(
  options: OnlineMatchmakingClientOptions,
): OnlineMatchmakingClient {
  const fetchRequest = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const requestTimeoutMs = validatedRequestTimeout(options.requestTimeoutMs)
  let engagementLease: string | undefined
  const token = (): string => {
    const value = options.readAccessToken()
    if (!value || /\s/.test(value) || new TextEncoder().encode(value).byteLength > 512) {
      throw new Error('Session du compte absente ou invalide.')
    }
    return value
  }
  const request = async (
    method: 'GET' | 'POST' | 'DELETE',
    body: unknown | undefined,
    signal?: AbortSignal,
  ): Promise<unknown> => {
    const accessToken = token()
    const requestAbort = new AbortController()
    let rejectCancellation!: (reason?: unknown) => void
    let settled = false
    const cancellation = new Promise<never>((resolve, reject) => {
      void resolve
      rejectCancellation = reject
    })
    const abort = (reason: unknown): void => {
      if (settled) return
      requestAbort.abort(reason)
      rejectCancellation(reason)
    }
    const onCallerAbort = (): void => { if (signal) abort(callerAbortReason(signal)) }
    if (signal?.aborted) onCallerAbort()
    else signal?.addEventListener('abort', onCallerAbort, { once: true })
    const timer = setTimeout(() => {
      abort(new OnlineMatchmakingRequestTimeoutError(requestTimeoutMs))
    }, requestTimeoutMs)
    const operation = (async (): Promise<unknown> => {
      const response = await fetchRequest(`${options.config.httpBaseUrl}/v1/matchmaking`, {
        method,
        signal: requestAbort.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${accessToken}`,
          ...(method === 'DELETE' && engagementLease !== undefined
            ? { 'Engagement-Lease': engagementLease }
            : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await readBoundedResponseText(response)
      let value: unknown
      try { value = text === '' ? undefined : JSON.parse(text) }
      catch { throw new Error('Réponse JSON invalide du rendez-vous multijoueur.') }
      if (!response.ok) {
        const error = errorEnvelope(value)
        throw new OnlineServiceError(
          response.status,
          error?.code ?? 'UNKNOWN',
          error?.message ?? `Erreur HTTP ${response.status}.`,
          error?.requestId,
        )
      }
      const validSuccess = method === 'GET'
        ? response.status === 200
        : method === 'POST'
          ? response.status === 200 || response.status === 202
          : response.status === 204
      if (!validSuccess) throw new Error(`Statut HTTP ${response.status} inattendu pour le rendez-vous multijoueur.`)
      return value
    })()
    try { return await Promise.race([operation, cancellation]) }
    finally {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  const readStatus = async (operation: Promise<unknown>): Promise<OnlineMatchmakingStatus> => {
    const status = parseOnlineMatchmakingStatus(await operation)
    if (!status) throw new Error('État de rendez-vous multijoueur invalide renvoyé par le serveur.')
    engagementLease = status.status === 'idle' ? undefined : status.lease
    return status
  }

  return Object.freeze({
    getStatus: (signal) => readStatus(request('GET', undefined, signal)),
    join(activity, signal) {
      if (!isOnlineMatchmakingActivity(activity)) {
        return Promise.reject(new TypeError("L'activité de rendez-vous multijoueur est invalide."))
      }
      return readStatus(request('POST', { activity }, signal))
    },
    async cancel(signal) {
      const value = await request('DELETE', undefined, signal)
      if (value !== undefined) {
        throw new Error("L'annulation du rendez-vous multijoueur a renvoyé un contenu inattendu.")
      }
      engagementLease = undefined
    },
  })
}
