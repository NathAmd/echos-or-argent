import type { OnlineClientConfig } from './onlineClientConfig'
import { isOnlineUserId, parseOnlineRealtimeTicket, parseOnlineSocialSnapshot, type OnlineRealtimeTicket, type OnlineSocialSnapshot } from './onlineServiceProtocol'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

export class OnlineServiceError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId?: string

  constructor(status: number, code: string, message: string, requestId?: string) {
    super(message)
    this.name = 'OnlineServiceError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }
}

export type OnlineSocialClient = Readonly<{
  getIdentity: (signal?: AbortSignal) => Promise<string>
  getSocial: (signal?: AbortSignal) => Promise<OnlineSocialSnapshot>
  sendFriendRequest: (userId: string, signal?: AbortSignal) => Promise<void>
  acceptFriendRequest: (userId: string, signal?: AbortSignal) => Promise<void>
  declineFriendRequest: (userId: string, signal?: AbortSignal) => Promise<void>
  cancelFriendRequest: (userId: string, signal?: AbortSignal) => Promise<void>
  removeFriend: (userId: string, signal?: AbortSignal) => Promise<void>
  issueRealtimeTicket: (signal?: AbortSignal) => Promise<OnlineRealtimeTicket>
}>

export type OnlineSocialClientOptions = Readonly<{
  config: OnlineClientConfig
  readAccessToken: () => string | undefined
  fetch?: FetchLike
}>

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  return Object.keys(record).every((key) => keys.includes(key)) && keys.every((key) => Object.hasOwn(record, key)) ? record : undefined
}

export function createOnlineSocialClient(options: OnlineSocialClientOptions): OnlineSocialClient {
  const fetchRequest = options.fetch ?? ((input, init) => fetch(input, init))
  const token = (): string => {
    const value = options.readAccessToken()
    if (!value || /\s/.test(value) || new TextEncoder().encode(value).byteLength > 512) throw new Error('Session du compte absente ou invalide.')
    return value
  }
  const request = async (method: 'GET' | 'POST' | 'DELETE', path: string, body: unknown | undefined, signal?: AbortSignal): Promise<unknown> => {
    const response = await fetchRequest(`${options.config.httpBaseUrl}${path}`, {
      method, signal, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      headers: { Accept: 'application/json', Authorization: `Bearer ${token()}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await response.text()
    if (text.length > 64 * 1024) throw new Error('Réponse du service en ligne trop volumineuse.')
    let value: unknown
    try { value = text ? JSON.parse(text) : undefined } catch { throw new Error('Réponse JSON invalide du service en ligne.') }
    if (!response.ok) {
      const envelope = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined
      const error = envelope?.error && typeof envelope.error === 'object' && !Array.isArray(envelope.error) ? envelope.error as Record<string, unknown> : undefined
      throw new OnlineServiceError(response.status, typeof error?.code === 'string' ? error.code : 'UNKNOWN', typeof error?.message === 'string' ? error.message : `Erreur HTTP ${response.status}.`, typeof envelope?.requestId === 'string' ? envelope.requestId : undefined)
    }
    return value
  }
  const targetPath = (userId: string): string => {
    if (!isOnlineUserId(userId)) throw new Error('Identifiant ami invalide.')
    return encodeURIComponent(userId)
  }
  const expectOk = async (operation: Promise<unknown>): Promise<void> => {
    const value = await operation
    const record = exactRecord(value, ['ok'])
    if (!record || record.ok !== true) throw new Error('Confirmation invalide du service en ligne.')
  }
  return Object.freeze({
    async getIdentity(signal) {
      const record = exactRecord(await request('GET', '/v1/me', undefined, signal), ['userId'])
      if (!record || !isOnlineUserId(record.userId)) throw new Error("Identité invalide renvoyée par le service en ligne.")
      return record.userId
    },
    async getSocial(signal) {
      const snapshot = parseOnlineSocialSnapshot(await request('GET', '/v1/social', undefined, signal))
      if (!snapshot) throw new Error("Liste d'amis invalide renvoyée par le service en ligne.")
      return snapshot
    },
    sendFriendRequest: (userId, signal) => expectOk(request('POST', '/v1/friend-requests', { userId: targetPath(userId) }, signal)),
    acceptFriendRequest: (userId, signal) => expectOk(request('POST', `/v1/friend-requests/${targetPath(userId)}/accept`, undefined, signal)),
    declineFriendRequest: (userId, signal) => expectOk(request('POST', `/v1/friend-requests/${targetPath(userId)}/decline`, undefined, signal)),
    cancelFriendRequest: (userId, signal) => expectOk(request('DELETE', `/v1/friend-requests/${targetPath(userId)}`, undefined, signal)),
    removeFriend: (userId, signal) => expectOk(request('DELETE', `/v1/friends/${targetPath(userId)}`, undefined, signal)),
    async issueRealtimeTicket(signal) {
      const ticket = parseOnlineRealtimeTicket(await request('POST', '/v1/realtime-ticket', undefined, signal))
      if (!ticket) throw new Error('Ticket temps réel invalide renvoyé par le service en ligne.')
      return ticket
    },
  })
}
