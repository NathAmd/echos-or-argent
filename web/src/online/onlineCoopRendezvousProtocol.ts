import {
  isOnlineOpaqueId,
  isOnlineUserId,
} from './onlineServiceProtocol'

export const onlineCoopRendezvousProtocolVersion = 1 as const

export type OnlineCoopRendezvousMode = 'random' | 'friend'
export type OnlineCoopRendezvousRole = 'host' | 'guest'

export type OnlineCoopRendezvousInvitation = Readonly<{
  sessionId: string
  fromUserId: string
  intent: 'coop'
  expiresAt: number
}>

export type OnlineCoopRendezvousCurrent =
  | Readonly<{ status: 'idle' }>
  | Readonly<{
    status: 'queued'
    mode: 'random'
    joinedAt: number
    expiresAt: number
    lease?: string
  }>
  | Readonly<{
    status: 'offered'
    mode: 'friend'
    sessionId: string
    peerUserId: string
    role: 'host'
    expiresAt: number
    lease?: string
  }>
  | Readonly<{
    status: 'ready' | 'active'
    mode: OnlineCoopRendezvousMode
    sessionId: string
    peerUserId: string
    role: OnlineCoopRendezvousRole
    expiresAt: number
    lease?: string
  }>

export type OnlineCoopRendezvousSnapshot = Readonly<{
  protocolVersion: typeof onlineCoopRendezvousProtocolVersion
  current: OnlineCoopRendezvousCurrent
  invitations: readonly OnlineCoopRendezvousInvitation[]
}>

type UnknownRecord = Record<string, unknown>

function exactRecord(
  value: unknown,
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): UnknownRecord | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const allowed = new Set([...requiredKeys, ...optionalKeys])
  if (Reflect.ownKeys(value).some((key) => {
    if (typeof key !== 'string' || !allowed.has(key)) return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  const record = value as UnknownRecord
  return requiredKeys.every((key) => Object.hasOwn(record, key)) ? record : undefined
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value)
    && (value as number) > 0
    && (value as number) <= 8_640_000_000_000_000
}

function readStatus(value: unknown): unknown {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, 'status')
  return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
}

function parseCurrent(value: unknown): OnlineCoopRendezvousCurrent | undefined {
  const status = readStatus(value)
  if (status === 'idle') {
    return exactRecord(value, ['status']) ? Object.freeze({ status: 'idle' }) : undefined
  }
  if (status === 'queued') {
    const record = exactRecord(value, ['status', 'mode', 'joinedAt', 'expiresAt'], ['lease'])
    if (
      !record
      || record.mode !== 'random'
      || !isTimestamp(record.joinedAt)
      || !isTimestamp(record.expiresAt)
      || record.expiresAt <= record.joinedAt
      || record.lease !== undefined && !isOnlineOpaqueId(record.lease)
    ) return undefined
    return Object.freeze({
      status: 'queued',
      mode: 'random',
      joinedAt: record.joinedAt,
      expiresAt: record.expiresAt,
      ...(record.lease === undefined ? {} : { lease: record.lease }),
    })
  }
  if (status === 'offered') {
    const record = exactRecord(value, [
      'status',
      'mode',
      'sessionId',
      'peerUserId',
      'role',
      'expiresAt',
    ], ['lease'])
    if (
      !record
      || record.mode !== 'friend'
      || !isOnlineOpaqueId(record.sessionId)
      || !isOnlineUserId(record.peerUserId)
      || record.role !== 'host'
      || !isTimestamp(record.expiresAt)
      || record.lease !== undefined && !isOnlineOpaqueId(record.lease)
    ) return undefined
    return Object.freeze({
      status: 'offered',
      mode: 'friend',
      sessionId: record.sessionId,
      peerUserId: record.peerUserId,
      role: 'host',
      expiresAt: record.expiresAt,
      ...(record.lease === undefined ? {} : { lease: record.lease }),
    })
  }
  if (status !== 'ready' && status !== 'active') return undefined
  const record = exactRecord(value, [
    'status',
    'mode',
    'sessionId',
    'peerUserId',
    'role',
    'expiresAt',
  ], ['lease'])
  if (
    !record
    || record.mode !== 'random' && record.mode !== 'friend'
    || !isOnlineOpaqueId(record.sessionId)
    || !isOnlineUserId(record.peerUserId)
    || record.role !== 'host' && record.role !== 'guest'
    || !isTimestamp(record.expiresAt)
    || record.lease !== undefined && !isOnlineOpaqueId(record.lease)
  ) return undefined
  return Object.freeze({
    status,
    mode: record.mode,
    sessionId: record.sessionId,
    peerUserId: record.peerUserId,
    role: record.role,
    expiresAt: record.expiresAt,
    ...(record.lease === undefined ? {} : { lease: record.lease }),
  })
}

function parseInvitation(value: unknown): OnlineCoopRendezvousInvitation | undefined {
  const record = exactRecord(value, ['sessionId', 'fromUserId', 'intent', 'expiresAt'])
  if (
    !record
    || !isOnlineOpaqueId(record.sessionId)
    || !isOnlineUserId(record.fromUserId)
    || record.intent !== 'coop'
    || !isTimestamp(record.expiresAt)
  ) return undefined
  return Object.freeze({
    sessionId: record.sessionId,
    fromUserId: record.fromUserId,
    intent: 'coop',
    expiresAt: record.expiresAt,
  })
}

/** Parse intégralement le rendez-vous persistant; les champs inconnus sont refusés. */
export function parseOnlineCoopRendezvousSnapshot(
  value: unknown,
): OnlineCoopRendezvousSnapshot | undefined {
  const record = exactRecord(value, ['protocolVersion', 'current', 'invitations'])
  if (
    !record
    || record.protocolVersion !== onlineCoopRendezvousProtocolVersion
    || !Array.isArray(record.invitations)
    || record.invitations.length > 200
  ) return undefined
  const current = parseCurrent(record.current)
  if (!current) return undefined
  const invitations: OnlineCoopRendezvousInvitation[] = []
  const sessionIds = new Set<string>()
  for (const value of record.invitations) {
    const invitation = parseInvitation(value)
    if (!invitation || sessionIds.has(invitation.sessionId)) return undefined
    sessionIds.add(invitation.sessionId)
    invitations.push(invitation)
  }
  if ('sessionId' in current && sessionIds.has(current.sessionId)) return undefined
  return Object.freeze({
    protocolVersion: onlineCoopRendezvousProtocolVersion,
    current,
    invitations: Object.freeze(invitations),
  })
}
