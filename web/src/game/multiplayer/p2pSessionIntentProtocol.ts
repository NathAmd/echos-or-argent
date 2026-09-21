import {
  isOnlineOpaqueId,
  isOnlineUserId,
} from '../../online/onlineServiceProtocol'

export const p2pSessionIntentProtocol = 'pokemaster-p2p-session-intent' as const
export const p2pSessionIntentProtocolVersion = 1 as const
export const p2pSessionIntentMaximumWireBytes = 1_024

export type P2pSessionIntent = 'trade' | 'pvp' | 'coop'
export type P2pSessionIntentRejectReason = 'intent-mismatch' | 'user-declined'

type P2pSessionIntentEnvelope = Readonly<{
  protocol: typeof p2pSessionIntentProtocol
  protocolVersion: typeof p2pSessionIntentProtocolVersion
  sessionId: string
  senderId: string
  receiverId: string
  sequence: number
}>

export type P2pSessionIntentFrame = P2pSessionIntentEnvelope & (
  | Readonly<{ kind: 'offer' | 'accept', intent: P2pSessionIntent }>
  | Readonly<{
    kind: 'reject'
    intent: P2pSessionIntent
    reason: P2pSessionIntentRejectReason
  }>
)

export type P2pSessionIntentSequenceDecision = 'next' | 'replay' | 'gap'

type UnknownRecord = Record<string, unknown>

function exactRecord(value: unknown): UnknownRecord | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => {
    if (typeof key !== 'string') return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  return value as UnknownRecord
}

function hasExactKeys(record: UnknownRecord, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return Object.keys(record).length === keys.length
    && keys.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => expected.has(key))
}

export function isP2pSessionIntent(value: unknown): value is P2pSessionIntent {
  return value === 'trade' || value === 'pvp' || value === 'coop'
}

/** Validation exacte et copie gelée d'une intention de session P2P. */
export function parseP2pSessionIntentFrame(value: unknown): P2pSessionIntentFrame | undefined {
  const record = exactRecord(value)
  if (!record
    || record.protocol !== p2pSessionIntentProtocol
    || record.protocolVersion !== p2pSessionIntentProtocolVersion
    || !isOnlineOpaqueId(record.sessionId)
    || !isOnlineUserId(record.senderId)
    || !isOnlineUserId(record.receiverId)
    || record.senderId === record.receiverId
    || record.sequence !== 1
    || !isP2pSessionIntent(record.intent)) return undefined

  const base = Object.freeze({
    protocol: p2pSessionIntentProtocol,
    protocolVersion: p2pSessionIntentProtocolVersion,
    sessionId: record.sessionId,
    senderId: record.senderId,
    receiverId: record.receiverId,
    sequence: 1 as const,
  })
  if (record.kind === 'offer' || record.kind === 'accept') {
    if (!hasExactKeys(record, [
      'protocol', 'protocolVersion', 'sessionId', 'senderId', 'receiverId',
      'sequence', 'kind', 'intent',
    ])) return undefined
    return Object.freeze({ ...base, kind: record.kind, intent: record.intent })
  }
  if (record.kind !== 'reject'
    || record.reason !== 'intent-mismatch' && record.reason !== 'user-declined'
    || !hasExactKeys(record, [
      'protocol', 'protocolVersion', 'sessionId', 'senderId', 'receiverId',
      'sequence', 'kind', 'intent', 'reason',
    ])) return undefined
  return Object.freeze({
    ...base,
    kind: 'reject',
    intent: record.intent,
    reason: record.reason,
  })
}

export function encodeP2pSessionIntentFrame(frame: P2pSessionIntentFrame): string {
  const parsed = parseP2pSessionIntentFrame(frame)
  if (!parsed) throw new TypeError("La trame d'intention de session P2P est invalide.")
  const encoded = JSON.stringify(parsed)
  if (new TextEncoder().encode(encoded).byteLength > p2pSessionIntentMaximumWireBytes) {
    throw new RangeError("La trame d'intention de session P2P dépasse la taille autorisée.")
  }
  return encoded
}

export function decodeP2pSessionIntentFrame(message: string): P2pSessionIntentFrame | undefined {
  if (typeof message !== 'string'
    || new TextEncoder().encode(message).byteLength > p2pSessionIntentMaximumWireBytes) return undefined
  try { return parseP2pSessionIntentFrame(JSON.parse(message)) }
  catch { return undefined }
}

/** Chaque rôle émet une seule décision; sa répétition exacte est un replay sûr. */
export function classifyP2pSessionIntentSequence(
  previousSequence: number,
  receivedSequence: number,
): P2pSessionIntentSequenceDecision {
  if (!Number.isSafeInteger(previousSequence) || previousSequence < 0 || previousSequence > 1
    || !Number.isSafeInteger(receivedSequence) || receivedSequence !== 1) {
    throw new TypeError("La séquence d'intention de session P2P est invalide.")
  }
  if (receivedSequence <= previousSequence) return 'replay'
  return receivedSequence === previousSequence + 1 ? 'next' : 'gap'
}
