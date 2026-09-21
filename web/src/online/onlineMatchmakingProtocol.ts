import {
  isOnlineOpaqueId,
  isOnlineUserId,
} from './onlineServiceProtocol'

export const onlineMatchmakingActivities = ['trade', 'pvp', 'coop'] as const

export type OnlineMatchmakingActivity = (typeof onlineMatchmakingActivities)[number]
export type OnlineMatchmakingRole = 'offerer' | 'answerer'

export type OnlineMatchmakingStatus =
  | Readonly<{ status: 'idle' }>
  | Readonly<{
    activity: OnlineMatchmakingActivity
    expiresAt: number
    joinedAt: number
    lease?: string
    status: 'queued'
  }>
  | Readonly<{
    activity: OnlineMatchmakingActivity
    expiresAt: number
    matchId: string
    negotiationId: string
    peerUserId: string
    role: OnlineMatchmakingRole
    lease?: string
    status: 'matched'
  }>

type UnknownRecord = Record<string, unknown>

function exactRecord(
  value: unknown,
  keys: readonly string[],
  optionalKeys: readonly string[] = [],
): UnknownRecord | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => {
    if (typeof key !== 'string' || !keys.includes(key) && !optionalKeys.includes(key)) return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  const record = value as UnknownRecord
  return keys.every((key) => Object.hasOwn(record, key)) ? record : undefined
}

function isTimestamp(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0 && (value as number) <= 8_640_000_000_000_000
}

function readStatusDiscriminator(value: unknown): unknown {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const descriptor = Object.getOwnPropertyDescriptor(value, 'status')
  return descriptor?.enumerable === true && 'value' in descriptor ? descriptor.value : undefined
}

export function isOnlineMatchmakingActivity(value: unknown): value is OnlineMatchmakingActivity {
  return typeof value === 'string'
    && onlineMatchmakingActivities.includes(value as OnlineMatchmakingActivity)
}

/** Valide intégralement le petit contrat générique renvoyé par le rendez-vous. */
export function parseOnlineMatchmakingStatus(value: unknown): OnlineMatchmakingStatus | undefined {
  const discriminator = readStatusDiscriminator(value)
  if (discriminator === 'idle') {
    return exactRecord(value, ['status']) ? Object.freeze({ status: 'idle' }) : undefined
  }
  if (discriminator === 'queued') {
    const record = exactRecord(value, ['activity', 'expiresAt', 'joinedAt', 'status'], ['lease'])
    if (
      !record
      || !isOnlineMatchmakingActivity(record.activity)
      || !isTimestamp(record.joinedAt)
      || !isTimestamp(record.expiresAt)
      || record.expiresAt <= record.joinedAt
      || record.lease !== undefined && !isOnlineOpaqueId(record.lease)
    ) return undefined
    return Object.freeze({
      activity: record.activity,
      expiresAt: record.expiresAt,
      joinedAt: record.joinedAt,
      ...(record.lease === undefined ? {} : { lease: record.lease }),
      status: 'queued',
    })
  }
  if (discriminator !== 'matched') return undefined
  const record = exactRecord(value, [
    'activity',
    'expiresAt',
    'matchId',
    'negotiationId',
    'peerUserId',
    'role',
    'status',
  ], ['lease'])
  if (
    !record
    || !isOnlineMatchmakingActivity(record.activity)
    || !isTimestamp(record.expiresAt)
    || record.expiresAt === 0
    || !isOnlineOpaqueId(record.matchId)
    || !isOnlineOpaqueId(record.negotiationId)
    || record.matchId === record.negotiationId
    || !isOnlineUserId(record.peerUserId)
    || record.role !== 'offerer' && record.role !== 'answerer'
    || record.lease !== undefined && !isOnlineOpaqueId(record.lease)
  ) return undefined
  return Object.freeze({
    activity: record.activity,
    expiresAt: record.expiresAt,
    matchId: record.matchId,
    negotiationId: record.negotiationId,
    peerUserId: record.peerUserId,
    role: record.role,
    ...(record.lease === undefined ? {} : { lease: record.lease }),
    status: 'matched',
  })
}
