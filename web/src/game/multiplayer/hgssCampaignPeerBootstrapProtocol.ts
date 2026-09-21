import { isOnlineNegotiationId, isOnlineUserId } from '../../online/onlineServiceProtocol'
import type { PlayerGender } from '../../ndsTypes'
import type { HgssCampaignFieldPosition } from './hgssCampaignProtocol'

export const hgssCampaignPeerBootstrapProtocol = 'pokemaster-hgss-campaign-bootstrap' as const
export const hgssCampaignPeerBootstrapProtocolVersion = 2 as const

export const hgssCampaignPeerBootstrapRejectCodes = [
  'game-mismatch',
  'map-mismatch',
  'locomotion-unsupported',
  'position-occupied',
  'position-invalid',
  'campaign-unavailable',
] as const

export type HgssCampaignPeerBootstrapRejectCode = (
  typeof hgssCampaignPeerBootstrapRejectCodes
)[number]

export type HgssCampaignPeerBootstrapPlayer = Readonly<{
  displayName: string
  gender: PlayerGender
  position: HgssCampaignFieldPosition
  spriteId: number
  /** La première tranche coopérative reste volontairement limitée au terrain à pied. */
  locomotion: 'walking'
}>

type BootstrapEnvelope = Readonly<{
  protocol: typeof hgssCampaignPeerBootstrapProtocol
  protocolVersion: typeof hgssCampaignPeerBootstrapProtocolVersion
  sessionId: string
  senderId: string
  receiverId: string
}>

export type HgssCampaignPeerBootstrapHello = BootstrapEnvelope & Readonly<{
  kind: 'hello'
  gameCode: string
  gameVersion: number
  language: number
  player: HgssCampaignPeerBootstrapPlayer
}>

export type HgssCampaignPeerBootstrapAccept = BootstrapEnvelope & Readonly<{
  kind: 'accept'
}>

/** L'hôte a installé son consumer campagne; l'invité peut maintenant envoyer hello. */
export type HgssCampaignPeerBootstrapReady = BootstrapEnvelope & Readonly<{
  kind: 'ready'
}>

export type HgssCampaignPeerBootstrapReject = BootstrapEnvelope & Readonly<{
  kind: 'reject'
  code: HgssCampaignPeerBootstrapRejectCode
  message: string
}>

export type HgssCampaignPeerBootstrapFrame =
  | HgssCampaignPeerBootstrapHello
  | HgssCampaignPeerBootstrapReady
  | HgssCampaignPeerBootstrapAccept
  | HgssCampaignPeerBootstrapReject

type UnknownRecord = Record<string, unknown>

const maximumCoordinate = 1_000_000
const maximumMapId = 0xffff
const maximumSpriteId = 0xffff

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is UnknownRecord {
  if (!isRecord(value)) return false
  const expected = new Set(keys)
  return keys.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => expected.has(key))
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function parseDirection(value: unknown): HgssCampaignFieldPosition['direction'] | undefined {
  return value === 'north' || value === 'south' || value === 'west' || value === 'east'
    ? value
    : undefined
}

function parsePosition(value: unknown): HgssCampaignFieldPosition | undefined {
  if (!hasExactKeys(value, ['mapId', 'x', 'z', 'direction'])) return undefined
  const direction = parseDirection(value.direction)
  if (
    direction === undefined
    || !isBoundedInteger(value.mapId, 0, maximumMapId)
    || !isBoundedInteger(value.x, -maximumCoordinate, maximumCoordinate)
    || !isBoundedInteger(value.z, -maximumCoordinate, maximumCoordinate)
  ) return undefined
  return Object.freeze({ mapId: value.mapId, x: value.x, z: value.z, direction })
}

function parseDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value) return undefined
  const characters = [...value]
  if (characters.length < 1 || characters.length > 7) return undefined
  return characters.some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  }) ? undefined : value
}

function parsePlayer(value: unknown): HgssCampaignPeerBootstrapPlayer | undefined {
  if (!hasExactKeys(value, ['displayName', 'gender', 'position', 'spriteId', 'locomotion'])) return undefined
  const displayName = parseDisplayName(value.displayName)
  const position = parsePosition(value.position)
  if (
    displayName === undefined
    || position === undefined
    || value.gender !== 'male' && value.gender !== 'female'
    || value.locomotion !== 'walking'
    || !isBoundedInteger(value.spriteId, 0, maximumSpriteId)
  ) return undefined
  return Object.freeze({
    displayName,
    gender: value.gender,
    position,
    spriteId: value.spriteId,
    locomotion: 'walking',
  })
}

function parseEnvelope(value: UnknownRecord): BootstrapEnvelope | undefined {
  if (
    value.protocol !== hgssCampaignPeerBootstrapProtocol
    || value.protocolVersion !== hgssCampaignPeerBootstrapProtocolVersion
    || !isOnlineNegotiationId(value.sessionId)
    || !isOnlineUserId(value.senderId)
    || !isOnlineUserId(value.receiverId)
    || value.senderId === value.receiverId
  ) return undefined
  return Object.freeze({
    protocol: hgssCampaignPeerBootstrapProtocol,
    protocolVersion: hgssCampaignPeerBootstrapProtocolVersion,
    sessionId: value.sessionId,
    senderId: value.senderId,
    receiverId: value.receiverId,
  })
}

function parseRejectMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 1 || [...value].length > 256) return undefined
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  }) ? undefined : value
}

function deepFreeze<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) deepFreeze(nested)
  return Object.freeze(value)
}

/** Reconstruit une trame bootstrap en supprimant tout prototype ou champ étranger. */
export function parseHgssCampaignPeerBootstrapFrame(
  value: unknown,
): HgssCampaignPeerBootstrapFrame | undefined {
  try {
    if (!isRecord(value) || typeof value.kind !== 'string') return undefined
    const envelope = parseEnvelope(value)
    if (!envelope) return undefined
    if (value.kind === 'hello') {
      if (!hasExactKeys(value, [
        'protocol', 'protocolVersion', 'sessionId', 'senderId', 'receiverId',
        'kind', 'gameCode', 'gameVersion', 'language', 'player',
      ])) return undefined
      const player = parsePlayer(value.player)
      if (
        !player
        || typeof value.gameCode !== 'string'
        || !/^[A-Z0-9]{4}$/.test(value.gameCode)
        || !isBoundedInteger(value.gameVersion, 0, 0xff)
        || !isBoundedInteger(value.language, 0, 0xff)
      ) return undefined
      return deepFreeze({
        ...envelope,
        kind: 'hello' as const,
        gameCode: value.gameCode,
        gameVersion: value.gameVersion,
        language: value.language,
        player,
      })
    }
    if (value.kind === 'ready' || value.kind === 'accept') {
      return hasExactKeys(value, [
        'protocol', 'protocolVersion', 'sessionId', 'senderId', 'receiverId', 'kind',
      ]) ? deepFreeze({ ...envelope, kind: value.kind }) : undefined
    }
    if (value.kind !== 'reject' || !hasExactKeys(value, [
      'protocol', 'protocolVersion', 'sessionId', 'senderId', 'receiverId', 'kind', 'code', 'message',
    ])) return undefined
    const message = parseRejectMessage(value.message)
    if (!message || !hgssCampaignPeerBootstrapRejectCodes.includes(
      value.code as HgssCampaignPeerBootstrapRejectCode,
    )) return undefined
    return deepFreeze({
      ...envelope,
      kind: 'reject' as const,
      code: value.code as HgssCampaignPeerBootstrapRejectCode,
      message,
    })
  } catch {
    return undefined
  }
}

export function decodeHgssCampaignPeerBootstrapFrame(
  message: string,
): HgssCampaignPeerBootstrapFrame | undefined {
  try { return parseHgssCampaignPeerBootstrapFrame(JSON.parse(message)) }
  catch { return undefined }
}

export function encodeHgssCampaignPeerBootstrapFrame(
  frame: HgssCampaignPeerBootstrapFrame,
): string {
  const parsed = parseHgssCampaignPeerBootstrapFrame(frame)
  if (!parsed) throw new TypeError('La trame bootstrap de campagne pair-à-pair est invalide.')
  return JSON.stringify(parsed)
}

export function createHgssCampaignPeerBootstrapEnvelope(input: Readonly<{
  sessionId: string
  senderId: string
  receiverId: string
}>): BootstrapEnvelope {
  const parsed = parseEnvelope({
    protocol: hgssCampaignPeerBootstrapProtocol,
    protocolVersion: hgssCampaignPeerBootstrapProtocolVersion,
    ...input,
  })
  if (!parsed) throw new TypeError("L'enveloppe bootstrap de campagne pair-à-pair est invalide.")
  return parsed
}
