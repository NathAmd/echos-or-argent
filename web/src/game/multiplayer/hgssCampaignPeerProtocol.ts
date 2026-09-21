import {
  parseHgssCampaignClientCommand,
  parseHgssCampaignServerSnapshot,
  type HgssCampaignClientCommand,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'

export const hgssCampaignPeerProtocol = 'pokemaster-hgss-campaign-peer' as const
export const hgssCampaignPeerProtocolVersion = 2 as const

type PeerEnvelope = Readonly<{
  protocol: typeof hgssCampaignPeerProtocol
  protocolVersion: typeof hgssCampaignPeerProtocolVersion
}>

export type HgssCampaignPeerRequest = PeerEnvelope & (
  | Readonly<{ kind: 'request', requestId: string, operation: 'command', command: HgssCampaignClientCommand }>
  | Readonly<{ kind: 'request', requestId: string, operation: 'snapshot' }>
  | Readonly<{ kind: 'request', requestId: string, operation: 'ready' }>
)

export type HgssCampaignPeerRemoteError = Readonly<{
  code: string
  message: string
}>

export type HgssCampaignPeerResponse = PeerEnvelope & (
  | Readonly<{
    kind: 'response'
    requestId: string
    operation: 'command'
    ok: true
    appliedRevision: number
    replayed: boolean
    snapshot: HgssCampaignServerSnapshot
  }>
  | Readonly<{ kind: 'response', requestId: string, operation: 'snapshot', ok: true, snapshot: HgssCampaignServerSnapshot }>
  | Readonly<{ kind: 'response', requestId: string, operation: 'ready', ok: true }>
  | Readonly<{ kind: 'response', requestId: string, operation: 'command' | 'snapshot' | 'ready', ok: false, error: HgssCampaignPeerRemoteError }>
)

export type HgssCampaignPeerSnapshot = PeerEnvelope & Readonly<{
  kind: 'snapshot'
  snapshot: HgssCampaignServerSnapshot
}>

export type HgssCampaignPeerFrame = HgssCampaignPeerRequest | HgssCampaignPeerResponse | HgssCampaignPeerSnapshot

type UnknownRecord = Record<string, unknown>

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  return (prototype === Object.prototype || prototype === null)
    && Reflect.ownKeys(value).every((key) => {
      const descriptor = typeof key === 'string' ? Object.getOwnPropertyDescriptor(value, key) : undefined
      return descriptor?.enumerable === true && 'value' in descriptor
    })
}

function hasExactKeys(value: unknown, required: readonly string[]): value is UnknownRecord {
  if (!isRecord(value)) return false
  const expected = new Set(required)
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => expected.has(key))
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 128 && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
    ? value
    : undefined
}

function errorCode(value: unknown): string | undefined {
  return typeof value === 'string' && value.length <= 64 && /^[a-z][a-z0-9-]*$/.test(value)
    ? value
    : undefined
}

function errorMessage(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length < 1 || [...value].length > 512) return undefined
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  }) ? undefined : value
}

function envelope(value: UnknownRecord): boolean {
  return value.protocol === hgssCampaignPeerProtocol
    && value.protocolVersion === hgssCampaignPeerProtocolVersion
}

function remoteError(value: unknown): HgssCampaignPeerRemoteError | undefined {
  if (!hasExactKeys(value, ['code', 'message'])) return undefined
  const code = errorCode(value.code)
  const message = errorMessage(value.message)
  return code && message ? Object.freeze({ code, message }) : undefined
}

function freezeFrame<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezeFrame(nested)
  return Object.freeze(value)
}

/** Valide une trame décodée et reconstruit uniquement ses clés autorisées. */
export function parseHgssCampaignPeerFrame(value: unknown): HgssCampaignPeerFrame | undefined {
  try {
    if (!isRecord(value) || !envelope(value) || typeof value.kind !== 'string') return undefined
    const base = { protocol: hgssCampaignPeerProtocol, protocolVersion: hgssCampaignPeerProtocolVersion }
    if (value.kind === 'snapshot') {
      if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'snapshot'])) return undefined
      const snapshot = parseHgssCampaignServerSnapshot(value.snapshot)
      return snapshot ? freezeFrame({ ...base, kind: 'snapshot' as const, snapshot }) : undefined
    }
    const requestId = identifier(value.requestId)
    if (!requestId || value.operation !== 'command' && value.operation !== 'snapshot' && value.operation !== 'ready') {
      return undefined
    }
    if (value.kind === 'request') {
      if (value.operation === 'snapshot' || value.operation === 'ready') {
        return hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'requestId', 'operation'])
          ? freezeFrame({ ...base, kind: 'request' as const, requestId, operation: value.operation })
          : undefined
      }
      if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'requestId', 'operation', 'command'])) return undefined
      const command = parseHgssCampaignClientCommand(value.command)
      return command ? freezeFrame({ ...base, kind: 'request' as const, requestId, operation: 'command' as const, command }) : undefined
    }
    if (value.kind !== 'response' || typeof value.ok !== 'boolean') return undefined
    if (!value.ok) {
      if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'requestId', 'operation', 'ok', 'error'])) return undefined
      const error = remoteError(value.error)
      return error ? freezeFrame({ ...base, kind: 'response' as const, requestId, operation: value.operation, ok: false as const, error }) : undefined
    }
    if (value.operation === 'command') {
      if (!hasExactKeys(value, [
        'protocol', 'protocolVersion', 'kind', 'requestId', 'operation', 'ok', 'appliedRevision', 'replayed', 'snapshot',
      ])) return undefined
      const snapshot = parseHgssCampaignServerSnapshot(value.snapshot)
      if (!snapshot || !Number.isSafeInteger(value.appliedRevision)
        || (value.appliedRevision as number) < 0
        || (value.appliedRevision as number) > snapshot.revision
        || typeof value.replayed !== 'boolean') return undefined
      return freezeFrame({
        ...base,
        kind: 'response' as const,
        requestId,
        operation: 'command' as const,
        ok: true as const,
        appliedRevision: value.appliedRevision as number,
        replayed: value.replayed,
        snapshot,
      })
    }
    if (value.operation === 'ready') {
      return hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'requestId', 'operation', 'ok'])
        ? freezeFrame({ ...base, kind: 'response' as const, requestId, operation: 'ready' as const, ok: true as const })
        : undefined
    }
    if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'kind', 'requestId', 'operation', 'ok', 'snapshot'])) return undefined
    const snapshot = parseHgssCampaignServerSnapshot(value.snapshot)
    return snapshot ? freezeFrame({ ...base, kind: 'response' as const, requestId, operation: 'snapshot' as const, ok: true as const, snapshot }) : undefined
  } catch {
    return undefined
  }
}

export function decodeHgssCampaignPeerFrame(message: string): HgssCampaignPeerFrame | undefined {
  try { return parseHgssCampaignPeerFrame(JSON.parse(message)) } catch { return undefined }
}

export function encodeHgssCampaignPeerFrame(frame: HgssCampaignPeerFrame): string {
  const parsed = parseHgssCampaignPeerFrame(frame)
  if (!parsed) throw new TypeError('La trame de campagne pair-à-pair est invalide.')
  return JSON.stringify(parsed)
}

export function createHgssCampaignPeerEnvelope(): PeerEnvelope {
  return Object.freeze({
    protocol: hgssCampaignPeerProtocol,
    protocolVersion: hgssCampaignPeerProtocolVersion,
  })
}
