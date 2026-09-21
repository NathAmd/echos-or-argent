import { isOnlineOpaqueId } from '../../online/onlineServiceProtocol'
import {
  hgssP2pTradeJournalLimit,
  parseHgssP2pTradeJournal,
  type HgssP2pTradeJournal,
  type HgssP2pTradeJournalPhase,
} from './hgssP2pTradeJournal'
import { hgssP2pTradeMaximumWireBytes } from './hgssP2pTradeProtocol'

export const hgssP2pTradeRecoveryProtocol = 'pokemaster-hgss-p2p-trade-recovery' as const
export const hgssP2pTradeRecoveryProtocolVersion = 1 as const
export const hgssP2pTradeRecoveryMaximumWireBytes = hgssP2pTradeMaximumWireBytes + 4 * 1024

export type HgssP2pTradeRecoverySummary = Readonly<{
  transactionId: string
  phase: HgssP2pTradeJournalPhase
}>

type HgssP2pTradeRecoveryEnvelope = Readonly<{
  protocol: typeof hgssP2pTradeRecoveryProtocol
  protocolVersion: typeof hgssP2pTradeRecoveryProtocolVersion
  recoverySessionId: string
  senderId: string
  receiverId: string
  sequence: number
}>

export type HgssP2pTradeRecoveryFrame = HgssP2pTradeRecoveryEnvelope & (
  | Readonly<{ kind: 'sync-start', journals: readonly HgssP2pTradeRecoverySummary[] }>
  | Readonly<{ kind: 'journal', journal: HgssP2pTradeJournal }>
  | Readonly<{
    kind: 'confirm'
    transactionId: string
    disposition: 'confirmed-committed' | 'cancel-prepared'
  }>
)

export type HgssP2pTradeRecoverySequenceDecision = 'next' | 'replay' | 'gap'

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

function participantId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
}

function denseArray(value: unknown, maximum: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximum || Object.getPrototypeOf(value) !== Array.prototype) return false
  return Object.keys(value).length === value.length
    && Reflect.ownKeys(value).every((key) => (
      key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
    ))
    && value.every((_entry, index) => Object.hasOwn(value, index))
}

function freezeDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezeDeep(nested)
  return Object.freeze(value)
}

function parseSummaries(value: unknown): readonly HgssP2pTradeRecoverySummary[] | undefined {
  if (!denseArray(value, hgssP2pTradeJournalLimit)) return undefined
  const summaries: HgssP2pTradeRecoverySummary[] = []
  for (const entry of value) {
    const record = exactRecord(entry)
    if (!record
      || !hasExactKeys(record, ['transactionId', 'phase'])
      || !isOnlineOpaqueId(record.transactionId)
      || record.phase !== 'prepared' && record.phase !== 'committed') return undefined
    summaries.push({ transactionId: record.transactionId, phase: record.phase })
  }
  const transactionIds = summaries.map(({ transactionId }) => transactionId)
  if (new Set(transactionIds).size !== transactionIds.length) return undefined
  if (transactionIds.some((transactionId, index) => index > 0 && transactionIds[index - 1]! >= transactionId)) return undefined
  return freezeDeep(summaries)
}

function parseEnvelope(record: UnknownRecord): HgssP2pTradeRecoveryEnvelope | undefined {
  if (record.protocol !== hgssP2pTradeRecoveryProtocol
    || record.protocolVersion !== hgssP2pTradeRecoveryProtocolVersion
    || !isOnlineOpaqueId(record.recoverySessionId)
    || !participantId(record.senderId)
    || !participantId(record.receiverId)
    || record.senderId === record.receiverId
    || !Number.isSafeInteger(record.sequence)
    || (record.sequence as number) < 1) return undefined
  return {
    protocol: hgssP2pTradeRecoveryProtocol,
    protocolVersion: hgssP2pTradeRecoveryProtocolVersion,
    recoverySessionId: record.recoverySessionId,
    senderId: record.senderId,
    receiverId: record.receiverId,
    sequence: record.sequence as number,
  }
}

/** Validation stricte et copie défensive de toute frame de réconciliation. */
export function parseHgssP2pTradeRecoveryFrame(value: unknown): HgssP2pTradeRecoveryFrame | undefined {
  try {
    const record = exactRecord(value)
    if (!record || typeof record.kind !== 'string') return undefined
    const envelope = parseEnvelope(record)
    if (!envelope) return undefined
    const envelopeKeys = [
      'protocol', 'protocolVersion', 'recoverySessionId', 'senderId', 'receiverId', 'sequence', 'kind',
    ]
    if (record.kind === 'sync-start') {
      if (!hasExactKeys(record, [...envelopeKeys, 'journals'])) return undefined
      const journals = parseSummaries(record.journals)
      return journals ? freezeDeep({ ...envelope, kind: 'sync-start' as const, journals }) : undefined
    }
    if (record.kind === 'journal') {
      if (!hasExactKeys(record, [...envelopeKeys, 'journal'])) return undefined
      const journal = parseHgssP2pTradeJournal(record.journal)
      if (journal.localParticipantId !== envelope.senderId
        || journal.remoteParticipantId !== envelope.receiverId) return undefined
      return freezeDeep({ ...envelope, kind: 'journal' as const, journal })
    }
    if (record.kind !== 'confirm'
      || !hasExactKeys(record, [...envelopeKeys, 'transactionId', 'disposition'])
      || !isOnlineOpaqueId(record.transactionId)
      || record.disposition !== 'confirmed-committed' && record.disposition !== 'cancel-prepared') return undefined
    return freezeDeep({
      ...envelope,
      kind: 'confirm' as const,
      transactionId: record.transactionId,
      disposition: record.disposition,
    })
  } catch {
    return undefined
  }
}

export function encodeHgssP2pTradeRecoveryFrame(frame: HgssP2pTradeRecoveryFrame): string {
  const parsed = parseHgssP2pTradeRecoveryFrame(frame)
  if (!parsed) throw new TypeError("La trame de réconciliation d'échange P2P est invalide.")
  const encoded = JSON.stringify(parsed)
  if (new TextEncoder().encode(encoded).byteLength > hgssP2pTradeRecoveryMaximumWireBytes) {
    throw new RangeError("La trame de réconciliation d'échange P2P dépasse la taille maximale autorisée.")
  }
  return encoded
}

export function decodeHgssP2pTradeRecoveryFrame(message: string): HgssP2pTradeRecoveryFrame | undefined {
  if (typeof message !== 'string'
    || new TextEncoder().encode(message).byteLength > hgssP2pTradeRecoveryMaximumWireBytes) return undefined
  try { return parseHgssP2pTradeRecoveryFrame(JSON.parse(message)) }
  catch { return undefined }
}

/** Une nouvelle session RTC repart de zéro; doublons et anciens numéros sont des replays. */
export function classifyHgssP2pTradeRecoverySequence(
  previousSequence: number,
  receivedSequence: number,
): HgssP2pTradeRecoverySequenceDecision {
  if (!Number.isSafeInteger(previousSequence) || previousSequence < 0
    || !Number.isSafeInteger(receivedSequence) || receivedSequence < 1) {
    throw new TypeError('La séquence de réconciliation P2P est invalide.')
  }
  if (receivedSequence <= previousSequence) return 'replay'
  return receivedSequence === previousSequence + 1 ? 'next' : 'gap'
}
