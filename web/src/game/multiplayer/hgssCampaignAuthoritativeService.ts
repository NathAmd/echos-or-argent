import type { OnlineAccountSession } from '../../online/onlineAccountSession'
import {
  browserOnlineFetch,
  createBrowserOnlineWebSocket,
} from '../../online/browserOnlineTransportPrimitives'
import type { OnlineClientConfig } from '../../online/onlineClientConfig'
import {
  generateOnlineOpaqueId,
  isOnlineOpaqueId,
  isOnlineUserId,
  parseOnlineRealtimeTicket,
} from '../../online/onlineServiceProtocol'
import type {
  HgssCampaignClientTransport,
  HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import {
  parseHgssCampaignClientCommand,
  parseHgssCampaignServerSnapshot,
  parseHgssCampaignSharedProgression,
  type HgssCampaignClientCommand,
  type HgssCampaignFieldPosition,
  type HgssCampaignServerSnapshot,
  type HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import type {
  HgssCampaignMovementCommand,
  HgssCampaignServerMovementPort,
} from './hgssCampaignServerCore'
import { browserMultiplayerCampaignConnectionReplacedErrorCode } from './browserMultiplayerCampaignPort'

const authoritativeSessionProtocol = 'authoritative-session.v1'
const maximumHttpResponseBytes = 64 * 1024
const maximumRealtimeMessageBytes = 64 * 1024
const defaultRequestTimeoutMs = 10_000
const defaultReconnectDelaysMs = Object.freeze([250, 1_000, 3_000, 7_000, 10_000])
const connectionReplacedCloseCode = 4_000

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

type WebSocketEventMap = Readonly<{
  open: Event
  message: MessageEvent
  close: CloseEvent
  error: Event
}>

export type HgssCampaignAuthoritativeWebSocket = Readonly<{
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  addEventListener: <Kind extends keyof WebSocketEventMap>(
    kind: Kind,
    listener: (event: WebSocketEventMap[Kind]) => void,
  ) => void
  removeEventListener: <Kind extends keyof WebSocketEventMap>(
    kind: Kind,
    listener: (event: WebSocketEventMap[Kind]) => void,
  ) => void
}>

export type HgssCampaignAuthoritativeCompatibility = Readonly<{
  applicationId: string
  release: number
  locale: number
}>

export type HgssCampaignAuthoritativePlayer = Readonly<{
  displayName: string
  gender: 'male' | 'female'
  position: HgssCampaignFieldPosition
  spriteId: number
}>

export type HgssCampaignSharedEventCommand = Extract<
  HgssCampaignClientCommand,
  { kind: 'shared-event' }
>

export type HgssCampaignSharedEventAdmissionDecision =
  | Readonly<{ kind: 'accept' }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

export type HgssCampaignSharedEventAdmissionPort = (
  context: Readonly<{
    sessionId: string
    playerId: string
    command: HgssCampaignSharedEventCommand
    snapshot: HgssCampaignServerSnapshot
  }>,
) => HgssCampaignSharedEventAdmissionDecision

export type HgssCampaignGuestJoinAdmissionDecision =
  | Readonly<{ kind: 'accept' }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

/** Oracle ROM du propriétaire, interrogé avant toute insertion de l'invité. */
export type HgssCampaignGuestJoinAdmissionPort = (
  context: Readonly<{
    sessionId: string
    playerId: string
    compatibility: HgssCampaignAuthoritativeCompatibility
    player: HgssCampaignAuthoritativePlayer
    snapshot: HgssCampaignServerSnapshot
  }>,
) => HgssCampaignGuestJoinAdmissionDecision

export type HgssCampaignAuthoritativePreparation = Readonly<{
  sessionId: string
  localParticipantId: string
  remoteParticipantId: string
  compatibility: HgssCampaignAuthoritativeCompatibility
  player: HgssCampaignAuthoritativePlayer
  /** Baseline durable du propriétaire; interdite sur la route join invitée. */
  sharedProgression?: HgssCampaignSharedProgression
  /** Port ROM local de l'hôte. Il n'est jamais accepté pour un invité. */
  movementAdmission?: HgssCampaignServerMovementPort
  /** Attestation de transaction scénario par la ROM de l'hôte; interdite à l'invité. */
  sharedEventAdmission?: HgssCampaignSharedEventAdmissionPort
  /** Admission ROM de la position initiale invitée; interdite à l'invité. */
  guestJoinAdmission?: HgssCampaignGuestJoinAdmissionPort
  /** Autorise l'hôte direct à attacher son snapshot provisoire avant le join. */
  allowProvisionalHostSnapshot?: true
  /** Préserve une adhésion de rendez-vous serveur après un échec transitoire réessayable. */
  durableRendezvous?: true
  signal?: AbortSignal
}>

export type HgssCampaignAuthoritativeService = Readonly<{
  prepareHost: (
    request: HgssCampaignAuthoritativePreparation,
  ) => Promise<HgssCampaignClientTransport>
  prepareGuest: (
    request: HgssCampaignAuthoritativePreparation,
  ) => Promise<HgssCampaignClientTransport>
}>

export type HgssCampaignAuthoritativeServiceOptions = Readonly<{
  config: OnlineClientConfig
  accountSession: Pick<OnlineAccountSession, 'getAccount' | 'readAccessToken'>
  fetch?: FetchLike
  socketFactory?: (url: string, protocol: string) => HgssCampaignAuthoritativeWebSocket
  requestIdFactory?: () => string
  requestTimeoutMs?: number
  /** Délais bornés des réattachements; vide désactive la reprise transparente. */
  reconnectDelaysMs?: readonly number[]
}>

export class HgssCampaignAuthoritativeServiceError extends Error {
  readonly code: string
  readonly status?: number
  readonly requestId?: string

  constructor(
    code: string,
    message: string,
    options: Readonly<{ status?: number, requestId?: string }> = {},
  ) {
    super(message)
    this.name = 'HgssCampaignAuthoritativeServiceError'
    this.code = code
    this.status = options.status
    this.requestId = options.requestId
  }
}

type SessionRole = 'host' | 'guest'

type PendingRequest = Readonly<{
  operation: 'command' | 'snapshot'
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}>

type ParsedServerMessage =
  | Readonly<{ type: 'ready', version: 1, userId: string }>
  | Readonly<{
      type: 'attached'
      attachmentId?: string
      requestId: string
      snapshot: HgssCampaignServerSnapshot
    }>
  | Readonly<{
      type: 'snapshot-response'
      requestId: string
      snapshot: HgssCampaignServerSnapshot
    }>
  | Readonly<{ type: 'snapshot', snapshot: HgssCampaignServerSnapshot }>
  | Readonly<{
      type: 'admission-request'
      admissionId: string
      sessionId: string
      playerId: string
      command: HgssCampaignMovementCommand | HgssCampaignSharedEventCommand
      snapshot: HgssCampaignServerSnapshot
    }>
  | Readonly<{
      type: 'join-admission-request'
      admissionId: string
      sessionId: string
      playerId: string
      compatibility: HgssCampaignAuthoritativeCompatibility
      player: HgssCampaignAuthoritativePlayer
      snapshot: HgssCampaignServerSnapshot
    }>
  | Readonly<{
      type: 'command-accepted'
      requestId: string
      appliedRevision: number
      replayed: boolean
      snapshot: HgssCampaignServerSnapshot
    }>
  | Readonly<{ type: 'detached', requestId: string }>
  | Readonly<{
      type: 'session-ended'
      sessionId: string
      reason: 'idle-timeout' | 'member-left' | 'owner-left' | 'server-shutdown'
    }>
  | Readonly<{
      type: 'error'
      code: string
      message: string
      requestId?: string
    }>

function exactRecord(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  const allowed = new Set([...required, ...optional])
  const keys = Reflect.ownKeys(value)
  if (keys.some((key) => {
    if (typeof key !== 'string' || !allowed.has(key)) return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  return required.every((key) => Object.hasOwn(value, key))
    ? value as Record<string, unknown>
    : undefined
}

function boundedString(value: unknown, maximumBytes: number): string | undefined {
  return typeof value === 'string'
    && value.length > 0
    && new TextEncoder().encode(value).byteLength <= maximumBytes
    ? value
    : undefined
}

function isExactFieldPosition(
  value: unknown,
  expected: HgssCampaignFieldPosition,
): boolean {
  const position = exactRecord(value, ['mapId', 'x', 'z', 'direction'])
  return position?.mapId === expected.mapId
    && position.x === expected.x
    && position.z === expected.z
    && position.direction === expected.direction
}

function boundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function parseAuthoritativeCompatibility(
  value: unknown,
): HgssCampaignAuthoritativeCompatibility | undefined {
  const record = exactRecord(value, ['applicationId', 'release', 'locale'])
  if (!record
    || typeof record.applicationId !== 'string'
    || record.applicationId.length < 1
    || record.applicationId.length > 32
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(record.applicationId)
    || !boundedInteger(record.release, 0, 0xffff)
    || !boundedInteger(record.locale, 0, 0xff)) return undefined
  return Object.freeze({
    applicationId: record.applicationId,
    release: record.release,
    locale: record.locale,
  })
}

function parseAuthoritativePlayer(value: unknown): HgssCampaignAuthoritativePlayer | undefined {
  const record = exactRecord(value, ['displayName', 'gender', 'position', 'spriteId'])
  const position = exactRecord(record?.position, ['mapId', 'x', 'z', 'direction'])
  if (!record
    || typeof record.displayName !== 'string'
    || record.displayName.trim() !== record.displayName
    || [...record.displayName].length < 1
    || [...record.displayName].length > 7
    || [...record.displayName].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })
    || record.gender !== 'male' && record.gender !== 'female'
    || !boundedInteger(record.spriteId, 0, 0xffff)
    || !position
    || !boundedInteger(position.mapId, 0, 0xffff)
    || !boundedInteger(position.x, -1_000_000, 1_000_000)
    || !boundedInteger(position.z, -1_000_000, 1_000_000)
    || position.direction !== 'north'
      && position.direction !== 'south'
      && position.direction !== 'west'
      && position.direction !== 'east') return undefined
  return Object.freeze({
    displayName: record.displayName,
    gender: record.gender,
    position: Object.freeze({
      mapId: position.mapId,
      x: position.x,
      z: position.z,
      direction: position.direction,
    }),
    spriteId: record.spriteId,
  })
}

function parseServerMessage(value: unknown): ParsedServerMessage | undefined {
  const base = exactRecord(value, ['type'], [
    'version', 'userId', 'requestId', 'snapshot', 'appliedRevision', 'replayed',
    'sessionId', 'reason', 'code', 'message', 'admissionId', 'playerId', 'command',
    'compatibility', 'player', 'attachmentId',
  ])
  if (!base || typeof base.type !== 'string') return undefined
  if (base.type === 'ready') {
    const record = exactRecord(value, ['type', 'version', 'userId'])
    return record?.version === 1 && isOnlineUserId(record.userId)
      ? Object.freeze({ type: 'ready', version: 1, userId: record.userId })
      : undefined
  }
  if (base.type === 'attached') {
    const record = exactRecord(value, ['type', 'requestId', 'snapshot'], ['attachmentId'])
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    return record
      && (record.attachmentId === undefined || isOnlineOpaqueId(record.attachmentId))
      && isOnlineOpaqueId(record.requestId)
      && snapshot
      ? Object.freeze({
          type: 'attached',
          ...(record.attachmentId === undefined ? {} : { attachmentId: record.attachmentId }),
          requestId: record.requestId,
          snapshot,
        })
      : undefined
  }
  if (base.type === 'snapshot-response') {
    const record = exactRecord(value, ['type', 'requestId', 'snapshot'])
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    return record && isOnlineOpaqueId(record.requestId) && snapshot
      ? Object.freeze({ type: base.type, requestId: record.requestId, snapshot })
      : undefined
  }
  if (base.type === 'snapshot') {
    const record = exactRecord(value, ['type', 'snapshot'])
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    return snapshot ? Object.freeze({ type: 'snapshot', snapshot }) : undefined
  }
  if (base.type === 'admission-request') {
    const record = exactRecord(value, [
      'type', 'admissionId', 'sessionId', 'playerId', 'command', 'snapshot',
    ])
    const command = record && parseHgssCampaignClientCommand(record.command)
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    const admissibleCommand = command?.kind === 'movement' && command.arrival !== undefined
      ? command
      : command?.kind === 'shared-event'
        && snapshot
        && command.expectedRevision === snapshot.revision
        && !snapshot.sharedProgression.milestoneIds.includes(command.eventId)
        ? command
        : undefined
    return record
      && isOnlineOpaqueId(record.admissionId)
      && isOnlineOpaqueId(record.sessionId)
      && isOnlineUserId(record.playerId)
      && admissibleCommand
      && snapshot
      && snapshot.sessionId === record.sessionId
      && snapshot.players.some(({ playerId }) => playerId === record.playerId)
      ? Object.freeze({
          type: 'admission-request',
          admissionId: record.admissionId,
          sessionId: record.sessionId,
          playerId: record.playerId,
          command: admissibleCommand,
          snapshot,
        })
      : undefined
  }
  if (base.type === 'join-admission-request') {
    const record = exactRecord(value, [
      'type', 'admissionId', 'sessionId', 'playerId', 'compatibility', 'player', 'snapshot',
    ])
    const compatibility = record && parseAuthoritativeCompatibility(record.compatibility)
    const player = record && parseAuthoritativePlayer(record.player)
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    return record
      && isOnlineOpaqueId(record.admissionId)
      && isOnlineOpaqueId(record.sessionId)
      && isOnlineUserId(record.playerId)
      && compatibility
      && player
      && snapshot
      && snapshot.sessionId === record.sessionId
      && !snapshot.players.some(({ playerId }) => playerId === record.playerId)
      ? Object.freeze({
          type: 'join-admission-request',
          admissionId: record.admissionId,
          sessionId: record.sessionId,
          playerId: record.playerId,
          compatibility,
          player,
          snapshot,
        })
      : undefined
  }
  if (base.type === 'command-accepted') {
    const record = exactRecord(value, [
      'type', 'requestId', 'appliedRevision', 'replayed', 'snapshot',
    ])
    const snapshot = record && parseHgssCampaignServerSnapshot(record.snapshot)
    return record
      && isOnlineOpaqueId(record.requestId)
      && Number.isSafeInteger(record.appliedRevision)
      && (record.appliedRevision as number) >= 0
      && typeof record.replayed === 'boolean'
      && snapshot
      && (record.appliedRevision as number) <= snapshot.revision
      ? Object.freeze({
          type: 'command-accepted',
          requestId: record.requestId,
          appliedRevision: record.appliedRevision as number,
          replayed: record.replayed,
          snapshot,
        })
      : undefined
  }
  if (base.type === 'detached') {
    const record = exactRecord(value, ['type', 'requestId'])
    return record && isOnlineOpaqueId(record.requestId)
      ? Object.freeze({ type: 'detached', requestId: record.requestId })
      : undefined
  }
  if (base.type === 'session-ended') {
    const record = exactRecord(value, ['type', 'sessionId', 'reason'])
    return record
      && isOnlineOpaqueId(record.sessionId)
      && (record.reason === 'idle-timeout'
        || record.reason === 'member-left'
        || record.reason === 'owner-left'
        || record.reason === 'server-shutdown')
      ? Object.freeze({
          type: 'session-ended',
          sessionId: record.sessionId,
          reason: record.reason,
        })
      : undefined
  }
  if (base.type !== 'error') return undefined
  const record = exactRecord(value, ['type', 'code', 'message'], ['requestId'])
  const code = boundedString(record?.code, 64)
  const message = boundedString(record?.message, 512)
  return record
    && code
    && /^[a-z][a-z0-9-]{0,63}$/.test(code)
    && message
    && (record.requestId === undefined || isOnlineOpaqueId(record.requestId))
    ? Object.freeze({
        type: 'error',
        code,
        message,
        ...(record.requestId === undefined ? {} : { requestId: record.requestId as string }),
      })
    : undefined
}

async function readBoundedText(response: Response): Promise<string> {
  const declared = response.headers.get('Content-Length')
  if (declared !== null) {
    if (!/^(?:0|[1-9][0-9]*)$/.test(declared) || Number(declared) > maximumHttpResponseBytes) {
      await response.body?.cancel().catch(() => undefined)
      throw new HgssCampaignAuthoritativeServiceError(
        'invalid-response',
        'La réponse du serveur de campagne est trop volumineuse.',
      )
    }
  }
  if (!response.body) return ''
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let length = 0
  try {
    while (true) {
      const next = await reader.read()
      if (next.done) break
      length += next.value.byteLength
      if (length > maximumHttpResponseBytes) {
        throw new HgssCampaignAuthoritativeServiceError(
          'invalid-response',
          'La réponse du serveur de campagne est trop volumineuse.',
        )
      }
      chunks.push(next.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(length)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      "La réponse du serveur de campagne n'est pas un texte UTF-8 valide.",
    )
  }
}

function parseJson(text: string): unknown {
  try { return JSON.parse(text) as unknown }
  catch {
    throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      'La réponse du serveur de campagne contient un JSON invalide.',
    )
  }
}

function parseRemoteError(response: Response, value: unknown): HgssCampaignAuthoritativeServiceError {
  const outer = exactRecord(value, ['error', 'requestId'])
  const inner = exactRecord(outer?.error, ['code', 'message'])
  const code = boundedString(inner?.code, 64)
  const message = boundedString(inner?.message, 512)
  const requestId = boundedString(outer?.requestId, 128)
  return code && message
    ? new HgssCampaignAuthoritativeServiceError(code.toLowerCase().replaceAll('_', '-'), message, {
        status: response.status,
        ...(requestId ? { requestId } : {}),
      })
    : new HgssCampaignAuthoritativeServiceError(
        'invalid-response',
        'Le serveur de campagne a renvoyé une erreur non conforme.',
        { status: response.status },
      )
}

function parseSessionEnvelope(
  value: unknown,
  request: HgssCampaignAuthoritativePreparation,
  role: SessionRole,
): HgssCampaignServerSnapshot {
  const envelope = exactRecord(value, ['snapshot'])
  const snapshot = envelope && parseHgssCampaignServerSnapshot(envelope.snapshot)
  const participantIds = snapshot?.players.map(({ playerId }) => playerId) ?? []
  const validHostRoster = participantIds.length === 1
    && participantIds[0] === request.localParticipantId
    || request.allowProvisionalHostSnapshot === true
      && participantIds.length === 2
      && new Set(participantIds).size === 2
      && participantIds.includes(request.localParticipantId)
      && participantIds.includes(request.remoteParticipantId)
  const validGuestRoster = participantIds.length === 2
    && new Set(participantIds).size === 2
    && participantIds.includes(request.localParticipantId)
    && participantIds.includes(request.remoteParticipantId)
  if (
    !snapshot
    || snapshot.sessionId !== request.sessionId
    || (role === 'host' ? !validHostRoster : !validGuestRoster)
  ) {
    throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      'Le serveur a renvoyé un état initial de campagne incohérent.',
    )
  }
  return snapshot
}

function requestTimeout(value: number | undefined): number {
  const resolved = value ?? defaultRequestTimeoutMs
  if (!Number.isSafeInteger(resolved) || resolved < 1_000 || resolved > 60_000) {
    throw new RangeError('Le délai du transport autoritaire doit être compris entre 1 000 et 60 000 ms.')
  }
  return resolved
}

function reconnectDelays(value: readonly number[] | undefined): readonly number[] {
  const resolved = value ?? defaultReconnectDelaysMs
  if (resolved.length > 5 || resolved.some((delay) =>
    !Number.isSafeInteger(delay) || delay < 0 || delay > 10_000)) {
    throw new RangeError('Les délais de reconnexion autoritaire sont invalides.')
  }
  return Object.freeze([...resolved])
}

function callerAbortReason(signal: AbortSignal): unknown {
  return signal.reason ?? new DOMException('Connexion de campagne annulée.', 'AbortError')
}

async function withRequestDeadline<Value>(
  timeoutMs: number,
  callerSignal: AbortSignal | undefined,
  operation: (signal: AbortSignal) => Promise<Value>,
): Promise<Value> {
  const controller = new AbortController()
  let settled = false
  let rejectCancellation: (reason?: unknown) => void = () => undefined
  const cancellation = new Promise<never>((_resolve, reject) => { rejectCancellation = reject })
  const abort = (reason: unknown): void => {
    if (settled) return
    controller.abort(reason)
    rejectCancellation(reason)
  }
  const onCallerAbort = (): void => {
    if (callerSignal) abort(callerAbortReason(callerSignal))
  }
  if (callerSignal?.aborted) onCallerAbort()
  else callerSignal?.addEventListener('abort', onCallerAbort, { once: true })
  const timer = setTimeout(() => abort(new HgssCampaignAuthoritativeServiceError(
    'request-timeout',
    `Le serveur de campagne n'a pas répondu sous ${timeoutMs} ms.`,
  )), timeoutMs)
  const pending = controller.signal.aborted
    ? cancellation
    : Promise.resolve().then(() => operation(controller.signal))
  try { return await Promise.race([pending, cancellation]) }
  finally {
    settled = true
    clearTimeout(timer)
    callerSignal?.removeEventListener('abort', onCallerAbort)
  }
}

function requirePreparation(
  request: HgssCampaignAuthoritativePreparation,
  accountId: string | undefined,
  role: SessionRole,
): HgssCampaignAuthoritativePreparation {
  if (
    !isOnlineOpaqueId(request.sessionId)
    || !isOnlineUserId(request.localParticipantId)
    || !isOnlineUserId(request.remoteParticipantId)
    || request.localParticipantId === request.remoteParticipantId
    || request.localParticipantId !== accountId
    || request.movementAdmission !== undefined && typeof request.movementAdmission !== 'function'
    || request.sharedEventAdmission !== undefined && typeof request.sharedEventAdmission !== 'function'
    || request.guestJoinAdmission !== undefined && typeof request.guestJoinAdmission !== 'function'
    || request.allowProvisionalHostSnapshot !== undefined
      && request.allowProvisionalHostSnapshot !== true
    || request.durableRendezvous !== undefined && request.durableRendezvous !== true
    || role === 'guest' && request.movementAdmission !== undefined
    || role === 'guest' && request.sharedEventAdmission !== undefined
    || role === 'guest' && request.guestJoinAdmission !== undefined
    || role === 'guest' && request.allowProvisionalHostSnapshot !== undefined
    || role === 'guest' && request.sharedProgression !== undefined
    || request.sharedProgression !== undefined
      && parseHgssCampaignSharedProgression(request.sharedProgression) === undefined
    || !request.signal
      && request.signal !== undefined
  ) throw new TypeError("La route d'autorité serveur de la campagne est invalide.")
  return request
}

function createAuthoritativeTransport(options: Readonly<{
  config: OnlineClientConfig
  requestHttp: FetchLike
  socketFactory: (url: string, protocol: string) => HgssCampaignAuthoritativeWebSocket
  readAccessToken: () => string | undefined
  localParticipantId: string
  remoteParticipantId: string
  sessionId: string
  requestIdFactory: () => string
  timeoutMs: number
  reconnectDelaysMs: readonly number[]
  role: SessionRole
  movementAdmission?: HgssCampaignServerMovementPort
  sharedEventAdmission?: HgssCampaignSharedEventAdmissionPort
  guestJoinAdmission?: HgssCampaignGuestJoinAdmissionPort
  allowProvisionalHostSnapshot?: true
}>): HgssCampaignClientTransport {
  let lifecycle: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closing' | 'closed' = 'idle'
  let socket: HgssCampaignAuthoritativeWebSocket | undefined
  let handlers: HgssCampaignClientTransportHandlers | undefined
  let attachRequestId: string | undefined
  let attachmentId: string | undefined
  let readyReceived = false
  let connectResolve: (() => void) | undefined
  let connectReject: ((error: Error) => void) | undefined
  let connectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectTimer: ReturnType<typeof setTimeout> | undefined
  let reconnectAttempt = 0
  let socketAttempt = 0
  let reconnectWait: Readonly<{
    promise: Promise<void>
    resolve: () => void
    reject: (error: Error) => void
  }> | undefined
  let leaveOperation: Promise<void> | undefined
  let membershipTransferred = false
  const pending = new Map<string, PendingRequest>()
  const timedOutRequests = new Map<string, PendingRequest['operation']>()
  const timedOutRequestOrder: string[] = []
  const rememberedAdmissionIds = new Set<string>()
  const rememberedAdmissionOrder: string[] = []
  let completeRosterObserved = false

  const token = (): string => {
    const value = options.readAccessToken()
    if (!value || /\s/.test(value) || new TextEncoder().encode(value).byteLength > 512) {
      throw new HgssCampaignAuthoritativeServiceError(
        'authentication-required',
        'La session du compte est absente ou expirée.',
      )
    }
    return value
  }
  const nextRequestId = (): string => {
    const value = options.requestIdFactory()
    if (!isOnlineOpaqueId(value)) throw new Error("L'identifiant de requête autoritaire est invalide.")
    return value
  }
  const classifyRouteSnapshot = (
    snapshot: HgssCampaignServerSnapshot,
  ): 'provisional-host' | 'complete' | undefined => {
    if (snapshot.sessionId !== options.sessionId) return undefined
    const ids = snapshot.players.map(({ playerId }) => playerId)
    if (ids.length === 2
      && new Set(ids).size === 2
      && ids.includes(options.localParticipantId)
      && ids.includes(options.remoteParticipantId)) return 'complete'
    if (options.allowProvisionalHostSnapshot
      && isExactProvisionalHostSnapshot(snapshot)) return 'provisional-host'
    return undefined
  }
  const isExactProvisionalHostSnapshot = (
    snapshot: HgssCampaignServerSnapshot,
  ): boolean => {
    const ids = snapshot.players.map(({ playerId }) => playerId)
    return options.role === 'host'
      && !completeRosterObserved
      && snapshot.sessionId === options.sessionId
      && ids.length === 1
      && ids[0] === options.localParticipantId
  }
  const clearConnectWait = (): void => {
    if (connectTimer !== undefined) clearTimeout(connectTimer)
    connectTimer = undefined
    connectResolve = undefined
    connectReject = undefined
  }
  const clearReconnectTimer = (): void => {
    if (reconnectTimer !== undefined) clearTimeout(reconnectTimer)
    reconnectTimer = undefined
  }
  const ensureReconnectWait = (): NonNullable<typeof reconnectWait> => {
    if (reconnectWait) return reconnectWait
    let resolve = (): void => undefined
    let reject: (error: Error) => void = () => undefined
    const promise = new Promise<void>((nextResolve, nextReject) => {
      resolve = nextResolve
      reject = nextReject
    })
    void promise.catch(() => undefined)
    reconnectWait = Object.freeze({ promise, resolve, reject })
    return reconnectWait
  }
  const settleReconnectWait = (error?: Error): void => {
    const wait = reconnectWait
    reconnectWait = undefined
    if (!wait) return
    if (error) wait.reject(error)
    else wait.resolve()
  }
  const rejectPending = (error: Error): void => {
    for (const request of pending.values()) {
      clearTimeout(request.timer)
      request.reject(error)
    }
    pending.clear()
  }
  const rememberTimedOutRequest = (
    requestId: string,
    operation: PendingRequest['operation'],
  ): void => {
    timedOutRequests.set(requestId, operation)
    timedOutRequestOrder.push(requestId)
    while (timedOutRequestOrder.length > 256) {
      timedOutRequests.delete(timedOutRequestOrder.shift()!)
    }
  }
  const cleanupSocket = (): void => {
    const current = socket
    if (!current) return
    current.removeEventListener('open', onOpen)
    current.removeEventListener('message', onMessage)
    current.removeEventListener('close', onClose)
    current.removeEventListener('error', onSocketError)
    if (socket === current) socket = undefined
  }
  const fail = (error: Error): void => {
    if (lifecycle === 'closing' || lifecycle === 'closed') return
    lifecycle = 'closed'
    const rejectConnect = connectReject
    clearReconnectTimer()
    clearConnectWait()
    settleReconnectWait(error)
    rejectPending(error)
    if (rejectConnect) rejectConnect(error)
    else handlers?.onError(error)
    try { socket?.close(1002, 'Invalid authoritative session protocol') } catch { /* Terminal. */ }
    cleanupSocket()
  }
  const acceptSnapshot = (snapshot: HgssCampaignServerSnapshot): boolean => {
    if (snapshot.sessionId !== options.sessionId) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'session-mismatch',
        "Le serveur a publié le snapshot d'une autre campagne.",
      ))
      return false
    }
    const route = classifyRouteSnapshot(snapshot)
    if (!route) {
      if (lifecycle === 'connected' || lifecycle === 'reconnecting') {
        fail(new HgssCampaignAuthoritativeServiceError(
          'participant-mismatch',
          'La composition des joueurs de la campagne autoritaire a changé.',
        ))
      }
      return false
    }
    if (route === 'complete') completeRosterObserved = true
    const establishesConnection = lifecycle === 'connecting' || lifecycle === 'reconnecting'
    const resolveConnect = connectResolve
    const interruptedRequests = establishesConnection ? [...pending.entries()] : []
    if (establishesConnection) {
      // Retire les requêtes de l'ancienne socket avant de publier le snapshot.
      // Le callback peut immédiatement demander une resynchronisation en voyant
      // un saut de révision ; cette nouvelle requête ne doit pas être confondue
      // avec celles dont l'issue est devenue incertaine pendant la coupure.
      for (const [requestId, active] of interruptedRequests) {
        clearTimeout(active.timer)
        pending.delete(requestId)
      }
    }
    if (establishesConnection) lifecycle = 'connected'
    handlers?.onSnapshot(snapshot)
    if (establishesConnection) {
      reconnectAttempt = 0
      clearReconnectTimer()
      settleReconnectWait()
      for (const [requestId, active] of interruptedRequests) {
        if (active.operation === 'snapshot') active.resolve(snapshot)
        else active.reject(new HgssCampaignAuthoritativeServiceError(
          'command-outcome-uncertain',
          'Le résultat de la commande interrompue doit être resynchronisé sans la rejouer.',
          { requestId },
        ))
      }
      if (resolveConnect) {
        clearConnectWait()
        resolveConnect()
      }
    }
    return true
  }
  const sendRaw = (value: unknown): void => {
    if (!socket || socket.readyState !== 1) {
      throw new HgssCampaignAuthoritativeServiceError(
        'connection-closed',
        "La connexion autoritaire n'est pas ouverte.",
      )
    }
    socket.send(JSON.stringify(value))
  }
  const rejectAdmission = (admissionId: string, code: string): void => {
    sendRaw({
      type: 'admission-response',
      admissionId,
      decision: { kind: 'reject', code },
    })
  }
  const rememberAdmission = (admissionId: string): boolean => {
    if (rememberedAdmissionIds.has(admissionId)) return false
    rememberedAdmissionIds.add(admissionId)
    rememberedAdmissionOrder.push(admissionId)
    if (rememberedAdmissionOrder.length > 64) {
      rememberedAdmissionIds.delete(rememberedAdmissionOrder.shift()!)
    }
    return true
  }
  const readRejectionCode = (decision: unknown): string | undefined => {
    const rejection = exactRecord(decision, ['kind', 'code', 'message'])
    const code = boundedString(rejection?.code, 64)
    return rejection?.kind === 'reject'
      && code
      && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(code)
      && boundedString(rejection.message, 512)
      ? code
      : undefined
  }
  const handleAdmissionRequest = (
    message: Extract<ParsedServerMessage, { type: 'admission-request' }>,
  ): void => {
    if (lifecycle !== 'connected'
      || options.role !== 'host'
      || message.sessionId !== options.sessionId
      || classifyRouteSnapshot(message.snapshot) !== 'complete'
      || !rememberAdmission(message.admissionId)) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'invalid-admission-request',
        "La demande d'attestation de transition est incohérente.",
      ))
      return
    }
    let decision: unknown
    if (message.command.kind === 'movement') {
      const movementAdmission = options.movementAdmission
      if (!movementAdmission) {
        rejectAdmission(message.admissionId, 'world-admission-unavailable')
        return
      }
      try {
        decision = movementAdmission(Object.freeze({
          sessionId: message.sessionId,
          playerId: message.playerId,
          command: message.command,
          snapshot: message.snapshot,
        }))
      } catch {
        rejectAdmission(message.admissionId, 'world-admission-failed')
        return
      }
      const acceptance = exactRecord(decision, ['kind', 'authoritativePosition'])
      if (acceptance?.kind === 'accept'
        && isExactFieldPosition(acceptance.authoritativePosition, message.command.arrival!)) {
        sendRaw({
          type: 'admission-response',
          admissionId: message.admissionId,
          decision: { kind: 'accept', arrival: message.command.arrival },
        })
        return
      }
    } else {
      const sharedEventAdmission = options.sharedEventAdmission
      if (!sharedEventAdmission) {
        rejectAdmission(message.admissionId, 'shared-event-admission-unavailable')
        return
      }
      try {
        decision = sharedEventAdmission(Object.freeze({
          sessionId: message.sessionId,
          playerId: message.playerId,
          command: message.command,
          snapshot: message.snapshot,
        }))
      } catch {
        rejectAdmission(message.admissionId, 'shared-event-admission-failed')
        return
      }
      const acceptance = exactRecord(decision, ['kind'])
      if (acceptance?.kind === 'accept') {
        sendRaw({
          type: 'admission-response',
          admissionId: message.admissionId,
          decision: { kind: 'accept' },
        })
        return
      }
    }
    const code = readRejectionCode(decision)
    if (code) {
      rejectAdmission(message.admissionId, code)
      return
    }
    rejectAdmission(message.admissionId, message.command.kind === 'movement'
      ? 'world-admission-invalid'
      : 'shared-event-admission-invalid')
  }
  const handleJoinAdmissionRequest = (
    message: Extract<ParsedServerMessage, { type: 'join-admission-request' }>,
  ): void => {
    if (lifecycle !== 'connecting' && lifecycle !== 'connected' && lifecycle !== 'reconnecting'
      || options.role !== 'host'
      || message.sessionId !== options.sessionId
      || message.playerId !== options.remoteParticipantId
      || !isExactProvisionalHostSnapshot(message.snapshot)
      || !rememberAdmission(message.admissionId)) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'invalid-join-admission-request',
        "La demande d'admission initiale de l'invité est incohérente.",
      ))
      return
    }
    const admission = options.guestJoinAdmission
    if (!admission) {
      rejectAdmission(message.admissionId, 'guest-join-admission-unavailable')
      return
    }
    let decision: unknown
    try {
      decision = admission(Object.freeze({
        sessionId: message.sessionId,
        playerId: message.playerId,
        compatibility: message.compatibility,
        player: message.player,
        snapshot: message.snapshot,
      }))
    } catch {
      rejectAdmission(message.admissionId, 'guest-join-admission-failed')
      return
    }
    if (exactRecord(decision, ['kind'])?.kind === 'accept') {
      sendRaw({
        type: 'admission-response',
        admissionId: message.admissionId,
        decision: { kind: 'accept' },
      })
      return
    }
    const code = readRejectionCode(decision)
    rejectAdmission(message.admissionId, code ?? 'guest-join-admission-invalid')
  }
  const request = (
    operation: PendingRequest['operation'],
    payload: Readonly<Record<string, unknown>>,
  ): Promise<unknown> => {
    if (lifecycle === 'reconnecting' && reconnectWait) {
      return reconnectWait.promise.then(() => request(operation, payload))
    }
    if (lifecycle !== 'connected') {
      return Promise.reject(new HgssCampaignAuthoritativeServiceError(
        'connection-closed',
        "La campagne n'est pas connectée à son autorité serveur.",
      ))
    }
    const requestId = nextRequestId()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        pending.delete(requestId)
        rememberTimedOutRequest(requestId, operation)
        reject(new HgssCampaignAuthoritativeServiceError(
          'request-timeout',
          "Le serveur n'a pas répondu à la commande de campagne.",
          { requestId },
        ))
      }, options.timeoutMs)
      pending.set(requestId, { operation, resolve, reject, timer })
      try { sendRaw({ ...payload, requestId }) }
      catch (error) {
        clearTimeout(timer)
        pending.delete(requestId)
        reject(error instanceof Error ? error : new Error("L'envoi autoritaire a échoué."))
      }
    })
  }
  const resolveResponse = (
    requestId: string,
    operation: PendingRequest['operation'],
    value: unknown,
  ): void => {
    const active = pending.get(requestId)
    if (!active) {
      if (timedOutRequests.get(requestId) === operation) return
      fail(new HgssCampaignAuthoritativeServiceError(
        'unexpected-response',
        'Le serveur a répondu à une requête autoritaire inconnue.',
        { requestId },
      ))
      return
    }
    if (active.operation !== operation) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'unexpected-response',
        'Le serveur a répondu à une requête autoritaire inconnue.',
        { requestId },
      ))
      return
    }
    clearTimeout(active.timer)
    pending.delete(requestId)
    active.resolve(value)
  }

  const onOpen = (): void => undefined
  const onMessage = (event: MessageEvent): void => {
    if (typeof event.data !== 'string'
      || new TextEncoder().encode(event.data).byteLength > maximumRealtimeMessageBytes) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'invalid-message',
        'Le serveur a envoyé une trame autoritaire invalide ou trop volumineuse.',
      ))
      return
    }
    let decoded: unknown
    try { decoded = JSON.parse(event.data) as unknown }
    catch {
      fail(new HgssCampaignAuthoritativeServiceError(
        'invalid-message',
        'Le serveur a envoyé une trame JSON invalide.',
      ))
      return
    }
    const message = parseServerMessage(decoded)
    if (!message) {
      fail(new HgssCampaignAuthoritativeServiceError(
        'invalid-message',
        'Le serveur a envoyé une trame autoritaire non conforme.',
      ))
      return
    }
    if (message.type === 'ready') {
      if (lifecycle !== 'connecting' && lifecycle !== 'reconnecting'
        || readyReceived
        || message.userId !== options.localParticipantId) {
        fail(new HgssCampaignAuthoritativeServiceError(
          'identity-mismatch',
          "L'identité de la connexion autoritaire est incohérente.",
        ))
        return
      }
      readyReceived = true
      attachRequestId = nextRequestId()
      try {
        sendRaw({ type: 'attach', requestId: attachRequestId, sessionId: options.sessionId })
      } catch (error) {
        fail(error instanceof Error ? error : new Error("L'attachement autoritaire a échoué."))
      }
      return
    }
    if (message.type === 'attached') {
      if (lifecycle !== 'connecting' && lifecycle !== 'reconnecting'
        || message.requestId !== attachRequestId) {
        fail(new HgssCampaignAuthoritativeServiceError(
          'unexpected-response',
          "L'acquittement d'attachement autoritaire est inattendu.",
          { requestId: message.requestId },
        ))
        return
      }
      attachRequestId = undefined
      attachmentId = message.attachmentId
      acceptSnapshot(message.snapshot)
      return
    }
    if (message.type === 'snapshot') {
      if (lifecycle !== 'connecting' && lifecycle !== 'connected' && lifecycle !== 'reconnecting') return
      acceptSnapshot(message.snapshot)
      return
    }
    if (message.type === 'admission-request') {
      handleAdmissionRequest(message)
      return
    }
    if (message.type === 'join-admission-request') {
      handleJoinAdmissionRequest(message)
      return
    }
    if (message.type === 'snapshot-response') {
      if (!acceptSnapshot(message.snapshot)) return
      resolveResponse(message.requestId, 'snapshot', message.snapshot)
      return
    }
    if (message.type === 'command-accepted') {
      if (!acceptSnapshot(message.snapshot)) return
      resolveResponse(message.requestId, 'command', Object.freeze({
        appliedRevision: message.appliedRevision,
        replayed: message.replayed,
        snapshot: message.snapshot,
      }))
      return
    }
    if (message.type === 'error') {
      const error = new HgssCampaignAuthoritativeServiceError(
        message.code,
        message.message,
        message.requestId ? { requestId: message.requestId } : {},
      )
      if (message.requestId) {
        if (message.requestId === attachRequestId
          && (lifecycle === 'connecting' || lifecycle === 'reconnecting')) {
          attachRequestId = undefined
          fail(error)
          return
        }
        const active = pending.get(message.requestId)
        if (active) {
          clearTimeout(active.timer)
          pending.delete(message.requestId)
          active.reject(error)
          return
        }
        if (timedOutRequests.has(message.requestId)) return
      }
      fail(error)
      return
    }
    if (message.type === 'session-ended') {
      if (message.sessionId !== options.sessionId) {
        fail(new HgssCampaignAuthoritativeServiceError(
          'session-mismatch',
          "Le serveur a terminé une autre campagne.",
        ))
        return
      }
      fail(new HgssCampaignAuthoritativeServiceError(
        'session-ended',
        'La session autoritaire de campagne est terminée.',
      ))
      return
    }
    if (message.type === 'detached' && lifecycle !== 'closing') {
      fail(new HgssCampaignAuthoritativeServiceError(
        'unexpected-response',
        "Le serveur a détaché une campagne encore active.",
        { requestId: message.requestId },
      ))
    }
  }
  const onClose = (event: CloseEvent): void => {
    const previous = lifecycle
    if (previous === 'closing' || previous === 'closed') return
    if (event.code === connectionReplacedCloseCode) {
      membershipTransferred = true
      fail(new HgssCampaignAuthoritativeServiceError(
        browserMultiplayerCampaignConnectionReplacedErrorCode,
        'Cette campagne a été reprise sur un autre appareil.',
      ))
      return
    }
    recoverConnection(new HgssCampaignAuthoritativeServiceError(
      'connection-closed',
      `La connexion autoritaire a été fermée (${event.code}).`,
    ))
  }
  const onSocketError = (): void => {
    if ((lifecycle === 'connecting' || lifecycle === 'reconnecting')
      && (!socket || socket.readyState === 3)) {
      recoverConnection(new HgssCampaignAuthoritativeServiceError(
        'connection-failed',
        'La connexion à l’autorité de campagne est impossible.',
      ))
    }
  }

  const authorizedFetch = async (
    path: string,
    init: RequestInit,
  ): Promise<Readonly<{ response: Response, text: string }>> => {
    return withRequestDeadline(options.timeoutMs, undefined, async (signal) => {
      const response = await options.requestHttp(`${options.config.httpBaseUrl}${path}`, {
        ...init,
        signal,
        cache: 'no-store',
        credentials: 'omit',
        redirect: 'error',
        referrerPolicy: 'no-referrer',
        headers: {
          Accept: 'application/json',
          Authorization: `Bearer ${token()}`,
          ...init.headers,
        },
      })
      return Object.freeze({ response, text: await readBoundedText(response) })
    })
  }
  const issueTicket = async (): Promise<string> => {
    const { response, text } = await authorizedFetch('/v1/realtime-ticket', { method: 'POST' })
    if (!response.ok) throw parseRemoteError(response, parseJson(text))
    if (response.status !== 201) throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      'Le serveur a renvoyé un statut de ticket inattendu.',
      { status: response.status },
    )
    const ticket = parseOnlineRealtimeTicket(parseJson(text))
    if (!ticket) throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      'Le serveur a renvoyé un ticket temps réel invalide.',
    )
    return ticket.ticket
  }
  function recoverConnection(error: HgssCampaignAuthoritativeServiceError): void {
    if (lifecycle === 'closing' || lifecycle === 'closed') return
    cleanupSocket()
    readyReceived = false
    attachRequestId = undefined
    for (const active of pending.values()) clearTimeout(active.timer)
    if (reconnectAttempt >= options.reconnectDelaysMs.length) {
      const rejectConnect = connectReject
      lifecycle = 'closed'
      clearReconnectTimer()
      clearConnectWait()
      settleReconnectWait(error)
      rejectPending(error)
      if (rejectConnect) rejectConnect(error)
      else handlers?.onDisconnect()
      return
    }
    lifecycle = 'reconnecting'
    ensureReconnectWait()
    const delay = options.reconnectDelaysMs[reconnectAttempt++]!
    clearReconnectTimer()
    reconnectTimer = setTimeout(() => {
      reconnectTimer = undefined
      beginSocketAttempt()
    }, delay)
  }
  function beginSocketAttempt(): void {
    if (lifecycle !== 'connecting' && lifecycle !== 'reconnecting') return
    readyReceived = false
    attachRequestId = undefined
    const attempt = socketAttempt + 1
    socketAttempt = attempt
    void issueTicket().then((ticket) => {
      if (attempt !== socketAttempt
        || lifecycle !== 'connecting' && lifecycle !== 'reconnecting') return
      const url = new URL(`${options.config.webSocketBaseUrl}/v1/shared-sessions/realtime`)
      url.searchParams.set('ticket', ticket)
      let created: HgssCampaignAuthoritativeWebSocket
      try { created = options.socketFactory(url.toString(), authoritativeSessionProtocol) }
      catch (error) {
        recoverConnection(error instanceof HgssCampaignAuthoritativeServiceError
          ? error
          : new HgssCampaignAuthoritativeServiceError(
              'connection-failed',
              "La socket d'autorité de campagne ne peut pas être créée.",
            ))
        return
      }
      if (attempt !== socketAttempt
        || lifecycle !== 'connecting' && lifecycle !== 'reconnecting') {
        try { created.close(1000, 'Stale connection attempt') } catch { /* Terminal. */ }
        return
      }
      socket = created
      created.addEventListener('open', onOpen)
      created.addEventListener('message', onMessage)
      created.addEventListener('close', onClose)
      created.addEventListener('error', onSocketError)
    }).catch((error: unknown) => {
      if (attempt !== socketAttempt
        || lifecycle !== 'connecting' && lifecycle !== 'reconnecting') return
      recoverConnection(error instanceof HgssCampaignAuthoritativeServiceError
        ? error
        : new HgssCampaignAuthoritativeServiceError(
            'connection-failed',
            "Le ticket d'autorité est indisponible.",
          ))
    })
  }
  const leaveSession = async (): Promise<void> => {
    let response: Response
    let text: string
    try {
      ({ response, text } = await authorizedFetch(
        `/v1/shared-sessions/${encodeURIComponent(options.sessionId)}/members/me`,
        {
          method: 'DELETE',
          ...(attachmentId === undefined
            ? {}
            : { headers: { 'Shared-Attachment': attachmentId } }),
        },
      ))
    } catch (error) {
      throw error instanceof Error ? error : new Error('La sortie de campagne a échoué.')
    }
    if (response.status === 204 && text === '') return
    if (!response.ok) {
      const error = parseRemoteError(response, parseJson(text))
      if (error.code === 'session-not-found'
        || error.code === 'player-not-found'
        || error.code === 'stale-attachment') return
      throw error
    }
    throw new HgssCampaignAuthoritativeServiceError(
      'invalid-response',
      'Le serveur a renvoyé un statut de sortie inattendu.',
      { status: response.status },
    )
  }

  return Object.freeze({
    transportKind: 'authoritative-websocket' as const,
    connect(nextHandlers) {
      if (lifecycle === 'connected') return Promise.resolve()
      if (lifecycle !== 'idle') return Promise.reject(new Error('Le transport autoritaire ne peut pas être reconnecté.'))
      handlers = nextHandlers
      lifecycle = 'connecting'
      return new Promise<void>((resolve, reject) => {
        connectResolve = resolve
        connectReject = reject
        connectTimer = setTimeout(() => {
          fail(new HgssCampaignAuthoritativeServiceError(
            'connection-timeout',
            "Les deux joueurs n'ont pas rejoint l'autorité de campagne à temps.",
          ))
        }, options.timeoutMs)
        beginSocketAttempt()
      })
    },
    requestSnapshot: () => request('snapshot', { type: 'request-snapshot' }),
    send: (command: HgssCampaignClientCommand) => request('command', { type: 'command', command }),
    disconnect() {
      if (leaveOperation) return leaveOperation
      const operation = (async (): Promise<void> => {
        if (lifecycle !== 'closing' && lifecycle !== 'closed') {
          lifecycle = 'closing'
          socketAttempt += 1
          const rejectConnect = connectReject
          clearReconnectTimer()
          clearConnectWait()
          const closeError = new HgssCampaignAuthoritativeServiceError(
            'connection-closed',
            'La campagne autoritaire a été fermée.',
          )
          settleReconnectWait(closeError)
          rejectConnect?.(closeError)
          rejectPending(closeError)
          try {
            if (socket?.readyState === 1) {
              sendRaw({ type: 'detach', requestId: nextRequestId() })
            }
          } catch { /* La suppression HTTP reste la sortie autoritaire. */ }
          try { socket?.close(1000, 'Campaign closed') } catch { /* Terminal. */ }
          cleanupSocket()
          lifecycle = 'closed'
        }
        if (!membershipTransferred) await leaveSession()
      })()
      leaveOperation = operation
      return operation
    },
  })
}

export function createHgssCampaignAuthoritativeService(
  options: HgssCampaignAuthoritativeServiceOptions,
): HgssCampaignAuthoritativeService {
  const timeoutMs = requestTimeout(options.requestTimeoutMs)
  const reconnectDelaySchedule = reconnectDelays(options.reconnectDelaysMs)
  const fetchRequest = options.fetch ?? browserOnlineFetch
  const socketFactory = options.socketFactory
    ?? createBrowserOnlineWebSocket
  const requestIdFactory = options.requestIdFactory ?? generateOnlineOpaqueId

  const accessToken = (): string => {
    const value = options.accountSession.readAccessToken()
    if (!value || /\s/.test(value) || new TextEncoder().encode(value).byteLength > 512) {
      throw new HgssCampaignAuthoritativeServiceError(
        'authentication-required',
        'Connectez-vous avant de rejoindre une campagne.',
      )
    }
    return value
  }
  const requestSession = async (
    role: SessionRole,
    rawRequest: HgssCampaignAuthoritativePreparation,
  ): Promise<HgssCampaignClientTransport> => {
    const request = requirePreparation(rawRequest, options.accountSession.getAccount()?.id, role)
    if (request.signal?.aborted) throw new DOMException('Connexion de campagne annulée.', 'AbortError')
    // Le jeton qui a effectivement créé/rejoint cette session reste son identité
    // de nettoyage. Un changement de compte dans un autre écran ne doit jamais
    // transformer le DELETE final en départ de l'autre participant.
    const sessionAccessToken = accessToken()
    const path = role === 'host'
      ? '/v1/shared-sessions'
      : `/v1/shared-sessions/${encodeURIComponent(request.sessionId)}/join`
    const body = role === 'host'
      ? {
          sessionId: request.sessionId,
          peerUserId: request.remoteParticipantId,
          compatibility: request.compatibility,
          player: request.player,
          ...(request.sharedProgression === undefined
            ? {}
            : { sharedProgression: request.sharedProgression }),
        }
      : { compatibility: request.compatibility, player: request.player }
    const rollbackMember = async (): Promise<void> => {
      if (request.durableRendezvous && !request.signal?.aborted) return
      try {
        const rollback = await withRequestDeadline(timeoutMs, undefined, (signal) => fetchRequest(
          `${options.config.httpBaseUrl}/v1/shared-sessions/${encodeURIComponent(request.sessionId)}/members/me`,
          {
            method: 'DELETE',
            signal,
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            referrerPolicy: 'no-referrer',
            headers: {
              Accept: 'application/json',
              Authorization: `Bearer ${sessionAccessToken}`,
            },
          },
        ))
        await rollback.body?.cancel().catch(() => undefined)
      } catch { /* Le TTL serveur nettoie une préparation devenue inaccessible. */ }
    }
    let response: Response
    let text: string
    try {
      ({ response, text } = await withRequestDeadline(timeoutMs, request.signal, async (signal) => {
        const received = await fetchRequest(`${options.config.httpBaseUrl}${path}`, {
          method: 'POST',
          signal,
          cache: 'no-store',
          credentials: 'omit',
          redirect: 'error',
          referrerPolicy: 'no-referrer',
          headers: {
            Accept: 'application/json',
            Authorization: `Bearer ${sessionAccessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
        })
        return Object.freeze({ response: received, text: await readBoundedText(received) })
      }))
    } catch (error) {
      await rollbackMember()
      throw error
    }
    if (!response.ok) throw parseRemoteError(response, parseJson(text))
    try {
      const expectedStatus = role === 'guest'
        ? response.status === 200
        : response.status === 200 || response.status === 201
      if (!expectedStatus) throw new HgssCampaignAuthoritativeServiceError(
        'invalid-response',
        'Le serveur a renvoyé un statut de préparation inattendu.',
        { status: response.status },
      )
      parseSessionEnvelope(parseJson(text), request, role)
      if (request.signal?.aborted) throw new DOMException('Connexion de campagne annulée.', 'AbortError')
      return createAuthoritativeTransport({
        config: options.config,
        requestHttp: fetchRequest,
        socketFactory,
        readAccessToken: () => sessionAccessToken,
        localParticipantId: request.localParticipantId,
        remoteParticipantId: request.remoteParticipantId,
        sessionId: request.sessionId,
        requestIdFactory,
        timeoutMs,
        reconnectDelaysMs: reconnectDelaySchedule,
        role,
        ...(request.movementAdmission ? { movementAdmission: request.movementAdmission } : {}),
        ...(request.sharedEventAdmission
          ? { sharedEventAdmission: request.sharedEventAdmission }
          : {}),
        ...(request.guestJoinAdmission
          ? { guestJoinAdmission: request.guestJoinAdmission }
          : {}),
        ...(request.allowProvisionalHostSnapshot
          ? { allowProvisionalHostSnapshot: true as const }
          : {}),
      })
    } catch (error) {
      await rollbackMember()
      throw error
    }
  }

  return Object.freeze({
    prepareHost: (request) => requestSession('host', request),
    prepareGuest: (request) => requestSession('guest', request),
  })
}
