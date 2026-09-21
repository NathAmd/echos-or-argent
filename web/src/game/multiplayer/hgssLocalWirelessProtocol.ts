import {
  createHgssSafariState,
  receiveHgssSafariLinkedAreaSet,
  type HgssSafariAreaSet,
} from '../safari/hgssSafariState'
import {
  hgssMultiplayerProtocolVersion,
  type HgssMultiplayerPlayer,
  type HgssMultiplayerRequest,
} from './hgssMultiplayerGateway'

export const hgssLocalWirelessNamespace = 'pokemaster-hgss-local-wireless' as const

export type HgssLocalWirelessMatch = {
  communicationType: number
  parameter1: number
  parameter2: number
}

export type HgssLocalWirelessExchangePayload = {
  areaSet: HgssSafariAreaSet
  player: HgssMultiplayerPlayer & { language: number, gameVersion: number }
}

type WireBase = {
  namespace: typeof hgssLocalWirelessNamespace
  protocolVersion: typeof hgssMultiplayerProtocolVersion
  from: string
}

type ClubSessionWire = {
  to: string
  hostOperationId: string
  joinOperationId: string
  sessionId: string
  match: HgssLocalWirelessMatch
}

export type HgssLocalWirelessMessage = WireBase & (
  | { type: 'club-advertise', operationId: string, role: 'host' | 'join', match: HgssLocalWirelessMatch, player: HgssMultiplayerPlayer }
  | ({ type: 'club-offer', player: HgssMultiplayerPlayer } & ClubSessionWire)
  | ({ type: 'club-accept', player: HgssMultiplayerPlayer } & ClubSessionWire)
  | ({ type: 'club-ready' } & ClubSessionWire)
  | { type: 'club-withdraw', operationId: string }
  | { type: 'session-close', to: string, sessionId: string, reason: 'cancelled' | 'destroyed' | 'replaced' | 'timeout' }
  | { type: 'safari-exchange', to: string, sessionId: string, round: number, requestId: string, payload: HgssLocalWirelessExchangePayload }
)

type UnknownRecord = Record<string, unknown>

function record(value: unknown): UnknownRecord | undefined {
  return value !== null && typeof value === 'object' && !Array.isArray(value) ? value as UnknownRecord : undefined
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= 512 ? value : undefined
}

function integer(value: unknown, maximum: number): number | undefined {
  return Number.isInteger(value) && (value as number) >= 0 && (value as number) <= maximum ? value as number : undefined
}

function parseMatch(value: unknown): HgssLocalWirelessMatch | undefined {
  const source = record(value)
  if (!source) return undefined
  const communicationType = integer(source.communicationType, 0xffff)
  const parameter1 = integer(source.parameter1, 0xffff)
  const parameter2 = integer(source.parameter2, 0xffff)
  return communicationType === undefined || parameter1 === undefined || parameter2 === undefined
    ? undefined
    : { communicationType, parameter1, parameter2 }
}

function parsePlayer(value: unknown): HgssMultiplayerPlayer | undefined {
  const source = record(value)
  const trainerId = integer(source?.trainerId, 0xffffffff)
  const name = source?.name
  const gender = source?.gender
  if (trainerId === undefined || typeof name !== 'string' || [...name].length > 7 || gender !== 'male' && gender !== 'female') return undefined
  return { trainerId, name, gender }
}

function parseSession(source: UnknownRecord): ClubSessionWire | undefined {
  const to = identifier(source.to)
  const hostOperationId = identifier(source.hostOperationId)
  const joinOperationId = identifier(source.joinOperationId)
  const sessionId = identifier(source.sessionId)
  const match = parseMatch(source.match)
  return !to || !hostOperationId || !joinOperationId || !sessionId || !match
    ? undefined
    : { to, hostOperationId, joinOperationId, sessionId, match }
}

export function sameHgssLocalWirelessMatch(first: HgssLocalWirelessMatch, second: HgssLocalWirelessMatch): boolean {
  return first.communicationType === second.communicationType
    && first.parameter1 === second.parameter1
    && first.parameter2 === second.parameter2
}

export function sameHgssLocalWirelessPlayer(first: HgssMultiplayerPlayer, second: HgssMultiplayerPlayer): boolean {
  return first.trainerId === second.trainerId && first.name === second.name && first.gender === second.gender
}

export function createHgssLocalWirelessSessionId(hostOperationId: string, joinOperationId: string): string {
  return JSON.stringify([hostOperationId, joinOperationId])
}

export function getHgssLocalWirelessMatch(
  request: Extract<HgssMultiplayerRequest, { kind: 'communication-club' }>,
): HgssLocalWirelessMatch {
  return {
    communicationType: request.communicationType,
    parameter1: request.parameter1,
    parameter2: request.parameter2,
  }
}

export function normalizeHgssLocalWirelessExchangePayload(value: unknown): HgssLocalWirelessExchangePayload {
  const source = record(value)
  const player = parsePlayer(source?.player)
  const playerRecord = record(source?.player)
  const language = integer(playerRecord?.language, 0xff)
  const gameVersion = integer(playerRecord?.gameVersion, 0xff)
  if (!source || !player || language === undefined || gameVersion === undefined) {
    throw new Error('Le profil local wireless HGSS reçu est invalide.')
  }
  const extendedPlayer = { ...player, language, gameVersion }
  const validated = receiveHgssSafariLinkedAreaSet(
    createHgssSafariState(0),
    source.areaSet as HgssSafariAreaSet,
    extendedPlayer,
    0,
    0,
  )
  return { areaSet: validated.areaSets[1], player: extendedPlayer }
}

export function createHgssLocalWirelessExchangePayload(
  request: Extract<HgssMultiplayerRequest, { kind: 'safari-area-exchange' }>,
): HgssLocalWirelessExchangePayload {
  return normalizeHgssLocalWirelessExchangePayload({
    areaSet: request.areaSet,
    player: { ...request.player, language: request.language, gameVersion: request.gameVersion },
  })
}

export function parseHgssLocalWirelessMessage(value: unknown): HgssLocalWirelessMessage | undefined {
  const source = record(value)
  if (!source || source.namespace !== hgssLocalWirelessNamespace || source.protocolVersion !== hgssMultiplayerProtocolVersion) return undefined
  const from = identifier(source.from)
  if (!from || typeof source.type !== 'string') return undefined
  const base = { namespace: hgssLocalWirelessNamespace, protocolVersion: hgssMultiplayerProtocolVersion, from }
  if (source.type === 'club-advertise') {
    const operationId = identifier(source.operationId)
    const match = parseMatch(source.match)
    const player = parsePlayer(source.player)
    const role = source.role
    return !operationId || !match || !player || role !== 'host' && role !== 'join'
      ? undefined
      : { ...base, type: source.type, operationId, role, match, player }
  }
  if (source.type === 'club-offer' || source.type === 'club-accept') {
    const session = parseSession(source)
    const player = parsePlayer(source.player)
    return !session || !player ? undefined : { ...base, type: source.type, ...session, player }
  }
  if (source.type === 'club-ready') {
    const session = parseSession(source)
    return session ? { ...base, type: source.type, ...session } : undefined
  }
  if (source.type === 'club-withdraw') {
    const operationId = identifier(source.operationId)
    return operationId ? { ...base, type: source.type, operationId } : undefined
  }
  if (source.type === 'session-close') {
    const to = identifier(source.to)
    const sessionId = identifier(source.sessionId)
    const reason = source.reason
    return !to || !sessionId || reason !== 'cancelled' && reason !== 'destroyed' && reason !== 'replaced' && reason !== 'timeout'
      ? undefined
      : { ...base, type: source.type, to, sessionId, reason }
  }
  if (source.type === 'safari-exchange') {
    const to = identifier(source.to)
    const sessionId = identifier(source.sessionId)
    const requestId = identifier(source.requestId)
    const round = integer(source.round, 0xffff)
    if (!to || !sessionId || !requestId || round === undefined) return undefined
    try {
      return { ...base, type: source.type, to, sessionId, requestId, round, payload: normalizeHgssLocalWirelessExchangePayload(source.payload) }
    } catch {
      return undefined
    }
  }
  return undefined
}
