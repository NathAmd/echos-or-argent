import type { OnlineClientConfig } from './onlineClientConfig'
import {
  parseOnlineCoopRendezvousSnapshot,
  type OnlineCoopRendezvousSnapshot,
} from './onlineCoopRendezvousProtocol'
import {
  isOnlineOpaqueId,
  isOnlineUserId,
} from './onlineServiceProtocol'
import { OnlineServiceError } from './onlineSocialClient'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

const maximumResponseBytes = 64 * 1024
const strictTextDecoder = new TextDecoder('utf-8', { fatal: true })
const defaultRequestTimeoutMs = 10_000

export class OnlineCoopRendezvousRequestTimeoutError extends Error {
  readonly code = 'online-coop-rendezvous-timeout' as const
  readonly timeoutMs: number

  constructor(timeoutMs: number) {
    super(`La requête de campagne Coop a expiré après ${timeoutMs} ms.`)
    this.name = 'OnlineCoopRendezvousRequestTimeoutError'
    this.timeoutMs = timeoutMs
  }
}

export type OnlineCoopRendezvousClient = Readonly<{
  getSnapshot: (signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
  searchRandom: (signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
  inviteFriend: (peerUserId: string, signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
  acceptInvitation: (sessionId: string, signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
  declineInvitation: (sessionId: string, signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
  cancelCurrent: (signal?: AbortSignal) => Promise<OnlineCoopRendezvousSnapshot>
}>

export type OnlineCoopRendezvousClientOptions = Readonly<{
  config: OnlineClientConfig
  readAccessToken: () => string | undefined
  fetch?: FetchLike
  requestTimeoutMs?: number
}>

function validatedTimeout(value: number | undefined): number {
  const timeoutMs = value ?? defaultRequestTimeoutMs
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 250 || timeoutMs > 120_000) {
    throw new RangeError('Le délai HTTP du rendez-vous Coop doit être compris entre 250 et 120 000 ms.')
  }
  return timeoutMs
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('La requête de campagne Coop a été annulée.', 'AbortError')
}

function errorEnvelope(value: unknown): Readonly<{
  code: string
  message: string
  requestId?: string
}> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const envelope = value as Record<string, unknown>
  const candidate = envelope.error
  if (candidate === null || Array.isArray(candidate) || typeof candidate !== 'object') return undefined
  const error = candidate as Record<string, unknown>
  if (typeof error.code !== 'string' || typeof error.message !== 'string') return undefined
  return Object.freeze({
    code: error.code,
    message: error.message,
    ...(typeof envelope.requestId === 'string' ? { requestId: envelope.requestId } : {}),
  })
}

async function readBoundedText(response: Response): Promise<string> {
  const declaredHeader = response.headers.get('Content-Length')
  if (declaredHeader !== null) {
    const declared = /^(?:0|[1-9][0-9]*)$/.test(declaredHeader)
      ? Number(declaredHeader)
      : Number.NaN
    if (!Number.isSafeInteger(declared) || declared > maximumResponseBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new Error('Réponse du rendez-vous Coop trop volumineuse ou mal bornée.')
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
        throw new Error('Réponse du rendez-vous Coop trop volumineuse.')
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
  catch { throw new Error("La réponse du rendez-vous Coop n'est pas un texte UTF-8 valide.") }
}

/** Client REST sans état; le runtime reste propriétaire du polling et des annulations. */
export function createOnlineCoopRendezvousClient(
  options: OnlineCoopRendezvousClientOptions,
): OnlineCoopRendezvousClient {
  const fetchRequest = options.fetch ?? ((input: string, init?: RequestInit) => fetch(input, init))
  const timeoutMs = validatedTimeout(options.requestTimeoutMs)
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
    path: string,
    body: unknown | undefined,
    signal?: AbortSignal,
  ): Promise<OnlineCoopRendezvousSnapshot> => {
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
      abort(new OnlineCoopRendezvousRequestTimeoutError(timeoutMs))
    }, timeoutMs)
    const operation = (async (): Promise<OnlineCoopRendezvousSnapshot> => {
      const response = await fetchRequest(`${options.config.httpBaseUrl}${path}`, {
        method,
        signal: requestAbort.signal,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token()}`,
          ...(method === 'DELETE' && engagementLease !== undefined
            ? { 'Engagement-Lease': engagementLease }
            : {}),
          ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      })
      const text = await readBoundedText(response)
      let value: unknown
      try { value = text === '' ? undefined : JSON.parse(text) }
      catch { throw new Error('Réponse JSON invalide du rendez-vous Coop.') }
      if (!response.ok) {
        const error = errorEnvelope(value)
        throw new OnlineServiceError(
          response.status,
          error?.code ?? 'UNKNOWN',
          error?.message ?? `Erreur HTTP ${response.status}.`,
          error?.requestId,
        )
      }
      if (response.status !== 200) {
        throw new Error(`Statut HTTP ${response.status} inattendu pour le rendez-vous Coop.`)
      }
      const snapshot = parseOnlineCoopRendezvousSnapshot(value)
      if (!snapshot) throw new Error('État de rendez-vous Coop invalide renvoyé par le serveur.')
      engagementLease = snapshot.current.status === 'idle' ? undefined : snapshot.current.lease
      return snapshot
    })()
    try { return await Promise.race([operation, cancellation]) }
    finally {
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener('abort', onCallerAbort)
    }
  }

  const sessionPath = (sessionId: string): string => {
    if (!isOnlineOpaqueId(sessionId)) throw new TypeError("L'identifiant de campagne Coop est invalide.")
    return encodeURIComponent(sessionId)
  }

  return Object.freeze({
    getSnapshot: (signal) => request('GET', '/v1/coop-rendezvous', undefined, signal),
    searchRandom: (signal) => request('POST', '/v1/coop-rendezvous/random', undefined, signal),
    inviteFriend(peerUserId, signal) {
      if (!isOnlineUserId(peerUserId)) {
        return Promise.reject(new TypeError("L'identité de l'ami Coop est invalide."))
      }
      return request('POST', '/v1/coop-rendezvous/invitations', { peerUserId }, signal)
    },
    acceptInvitation: (sessionId, signal) => request(
      'POST',
      `/v1/coop-rendezvous/invitations/${sessionPath(sessionId)}/accept`,
      undefined,
      signal,
    ),
    declineInvitation: (sessionId, signal) => request(
      'DELETE',
      `/v1/coop-rendezvous/invitations/${sessionPath(sessionId)}`,
      undefined,
      signal,
    ),
    cancelCurrent: (signal) => request('DELETE', '/v1/coop-rendezvous/current', undefined, signal),
  })
}
