const userIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/
// Compatibilité de lecture avec les premières versions du protocole. Toute
// nouvelle émission du client officiel utilise isOnlineOpaqueId à la place.
const requestIdPattern = /^[A-Za-z0-9._:-]{1,64}$/
const negotiationIdPattern = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/
// 128 bits en base64url sans remplissage ; le dernier sextet est canonique.
const opaqueIdPattern = /^[A-Za-z0-9_-]{21}[AQgw]$/
const sdpLineTypePattern = /^[vosiuepcbtrzkam]=/
const sdpMediaLinePattern = /^m=[^ \t]+ [0-9]+(?:\/[0-9]+)? [^ \t]+(?: [^ \t]+)+$/
const iceFoundationPattern = /^[A-Za-z0-9+/]{1,32}$/
const iceTokenPattern = /^[\x21-\x7e]+$/

type UnknownRecord = Record<string, unknown>

export type OnlineFriend = Readonly<{ userId: string, online: boolean }>
export type OnlineSocialSnapshot = Readonly<{
  friends: readonly OnlineFriend[]
  incoming: readonly string[]
  outgoing: readonly string[]
}>
export type OnlineRealtimeTicket = Readonly<{ ticket: string, expiresInMs: number }>
export type OnlineSignalPayload =
  | Readonly<{ type: 'offer' | 'answer', sdp: string }>
  | Readonly<{ type: 'ice', candidate: string, sdpMid?: string | null, sdpMLineIndex?: number | null, usernameFragment?: string | null }>
  | Readonly<{ type: 'hangup' }>
export type OnlineRealtimeEvent =
  | Readonly<{ type: 'ready', version: 1, userId: string, onlineFriends: readonly string[] }>
  | Readonly<{ type: 'signal', requestId: string, negotiationId: string, from: string, payload: OnlineSignalPayload }>
  | Readonly<{ type: 'signal-accepted', requestId: string }>
  | Readonly<{ type: 'presence', userId: string, online: boolean }>
  | Readonly<{ type: 'social-changed' }>
  | Readonly<{ type: 'error', code: string, message: string, requestId?: string }>

function exactRecord(value: unknown, required: readonly string[], optional: readonly string[] = []): UnknownRecord | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object') return undefined
  const record = value as UnknownRecord
  const keys = Object.keys(record)
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(record, key)) && keys.every((key) => allowed.has(key)) ? record : undefined
}

function boundedString(value: unknown, maximum: number, allowEmpty = false): string | undefined {
  if (typeof value !== 'string' || (!allowEmpty && value.length === 0) || new TextEncoder().encode(value).byteLength > maximum) return undefined
  return value
}

export function isOnlineUserId(value: unknown): value is string {
  return typeof value === 'string' && userIdPattern.test(value)
}

export function isOnlineRequestId(value: unknown): value is string {
  return typeof value === 'string' && requestIdPattern.test(value)
}

export function isOnlineNegotiationId(value: unknown): value is string {
  return typeof value === 'string' && negotiationIdPattern.test(value)
}

/** Identifiant sans signification métier, encodant exactement 128 bits. */
export function isOnlineOpaqueId(value: unknown): value is string {
  return typeof value === 'string' && opaqueIdPattern.test(value)
}

function secureRandom(): Crypto {
  const candidate = globalThis.crypto
  if (!candidate || typeof candidate.getRandomValues !== 'function') {
    throw new Error('Génération aléatoire sécurisée indisponible pour la signalisation WebRTC.')
  }
  return candidate
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

/** Génère localement 128 bits opaques ; aucun libellé de session n'est encodé. */
export function generateOnlineOpaqueId(): string {
  const bytes = secureRandom().getRandomValues(new Uint8Array(16))
  try {
    const encoded = encodeBase64Url(bytes)
    if (!isOnlineOpaqueId(encoded)) throw new Error("La génération de l'identifiant WebRTC a échoué.")
    return encoded
  } finally {
    bytes.fill(0)
  }
}

function containsForbiddenSdpControl(value: string): boolean {
  for (const character of value) {
    const code = character.charCodeAt(0)
    if (code <= 8 || code === 11 || code === 12 || (code >= 14 && code <= 31) || code === 127) return true
  }
  return false
}

function isWebRtcSdp(value: string): boolean {
  if (!value.startsWith('v=0\r\n') && !value.startsWith('v=0\n')) return false
  if (containsForbiddenSdpControl(value) || /\r(?!\n)/.test(value)) return false
  const lines = value.split(/\r\n|\n/)
  if (lines.at(-1) === '') lines.pop()
  if (lines.length < 5 || lines.length > 1_024 || lines[0] !== 'v=0') return false
  let origin = 0, sessionName = 0, timing = 0, media = 0
  let iceUfrag = false, icePassword = false, fingerprint = false
  for (const line of lines) {
    if (!line || !sdpLineTypePattern.test(line) || new TextEncoder().encode(line).byteLength > 4 * 1024) return false
    if (line.startsWith('v=')) {
      if (line !== 'v=0') return false
    } else if (line.startsWith('o=')) origin += 1
    else if (line.startsWith('s=')) sessionName += 1
    else if (line.startsWith('t=')) timing += 1
    else if (line.startsWith('m=')) {
      if (!sdpMediaLinePattern.test(line)) return false
      media += 1
    } else if (line.startsWith('a=ice-ufrag:') && line.length > 'a=ice-ufrag:'.length) iceUfrag = true
    else if (line.startsWith('a=ice-pwd:') && line.length > 'a=ice-pwd:'.length) icePassword = true
    else if (line.startsWith('a=fingerprint:') && line.length > 'a=fingerprint:'.length) fingerprint = true
  }
  // Ces marqueurs sont émis par RTCPeerConnection pour une négociation WebRTC.
  // Ils ne prétendent pas détecter un canal caché provenant d'un client modifié.
  return origin === 1 && sessionName === 1 && timing >= 1 && media >= 1
    && iceUfrag && icePassword && fingerprint
}

function isIceCandidate(value: string): boolean {
  if (value === '') return true // marqueur standard de fin des candidats
  if (/[^\x20-\x7e]/.test(value) || /\s{2,}/.test(value)) return false
  const tokens = value.split(' ')
  if (tokens.length < 8 || (tokens.length - 8) % 2 !== 0) return false
  const foundation = tokens[0]?.slice('candidate:'.length)
  const component = Number(tokens[1]), priority = Number(tokens[3]), port = Number(tokens[5])
  if (!tokens[0]?.startsWith('candidate:') || !foundation || !iceFoundationPattern.test(foundation)) return false
  if (!Number.isSafeInteger(component) || component < 1 || component > 256) return false
  if (!/^(?:udp|tcp)$/i.test(tokens[2] ?? '')) return false
  if (!/^[0-9]{1,10}$/.test(tokens[3] ?? '') || priority < 0 || priority > 4_294_967_295) return false
  if (!iceTokenPattern.test(tokens[4] ?? '')) return false
  if (!/^[0-9]{1,5}$/.test(tokens[5] ?? '') || port < 0 || port > 65_535) return false
  if (tokens[6] !== 'typ' || !/^(?:host|srflx|prflx|relay)$/.test(tokens[7] ?? '')) return false
  for (let index = 8; index < tokens.length; index += 2) {
    if (!/^[A-Za-z0-9-]{1,32}$/.test(tokens[index] ?? '') || !iceTokenPattern.test(tokens[index + 1] ?? '')) return false
  }
  return true
}

function parseUserIds(value: unknown, maximum: number): readonly string[] | undefined {
  if (!Array.isArray(value) || value.length > maximum || !value.every(isOnlineUserId)) return undefined
  if (new Set(value).size !== value.length) return undefined
  return Object.freeze([...value])
}

export function parseOnlineSocialSnapshot(value: unknown): OnlineSocialSnapshot | undefined {
  const record = exactRecord(value, ['friends', 'incoming', 'outgoing'])
  if (!record || !Array.isArray(record.friends) || record.friends.length > 200) return undefined
  const friends: OnlineFriend[] = []
  const friendIds = new Set<string>()
  for (const value of record.friends) {
    const friend = exactRecord(value, ['online', 'userId'])
    if (!friend || typeof friend.online !== 'boolean' || !isOnlineUserId(friend.userId) || friendIds.has(friend.userId)) return undefined
    friendIds.add(friend.userId)
    friends.push(Object.freeze({ userId: friend.userId, online: friend.online }))
  }
  const incoming = parseUserIds(record.incoming, 100)
  const outgoing = parseUserIds(record.outgoing, 100)
  if (!incoming || !outgoing) return undefined
  return Object.freeze({ friends: Object.freeze(friends), incoming, outgoing })
}

export function parseOnlineRealtimeTicket(value: unknown): OnlineRealtimeTicket | undefined {
  const record = exactRecord(value, ['ticket', 'expiresInMs'])
  if (!record || typeof record.ticket !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(record.ticket)) return undefined
  if (!Number.isSafeInteger(record.expiresInMs) || (record.expiresInMs as number) < 5_000 || (record.expiresInMs as number) > 60_000) return undefined
  return Object.freeze({ ticket: record.ticket, expiresInMs: record.expiresInMs as number })
}

export function parseOnlineSignalPayload(value: unknown): OnlineSignalPayload | undefined {
  const discriminator = exactRecord(value, ['type'], ['sdp', 'candidate', 'sdpMid', 'sdpMLineIndex', 'usernameFragment'])
  if (!discriminator) return undefined
  if (discriminator.type === 'offer' || discriminator.type === 'answer') {
    const record = exactRecord(value, ['type', 'sdp'])
    const sdp = record && boundedString(record.sdp, 24 * 1024)
    return sdp && isWebRtcSdp(sdp) ? Object.freeze({ type: discriminator.type, sdp }) : undefined
  }
  if (discriminator.type === 'hangup') {
    return exactRecord(value, ['type']) ? Object.freeze({ type: 'hangup' }) : undefined
  }
  if (discriminator.type !== 'ice') return undefined
  const record = exactRecord(value, ['type', 'candidate'], ['sdpMid', 'sdpMLineIndex', 'usernameFragment'])
  const candidate = record && boundedString(record.candidate, 2 * 1024, true)
  if (!record || candidate === undefined || !isIceCandidate(candidate)) return undefined
  const optionalString = (key: 'sdpMid' | 'usernameFragment'): string | null | undefined => {
    const field = record[key]
    return field === undefined || field === null ? field : boundedString(field, 256, true)
  }
  const sdpMid = optionalString('sdpMid'), usernameFragment = optionalString('usernameFragment')
  const line = record.sdpMLineIndex
  if ((record.sdpMid !== undefined && sdpMid === undefined) || (record.usernameFragment !== undefined && usernameFragment === undefined)) return undefined
  if (typeof sdpMid === 'string' && !/^[\x21-\x7e]{1,256}$/.test(sdpMid)) return undefined
  if (typeof usernameFragment === 'string' && !/^[A-Za-z0-9+/]{4,256}$/.test(usernameFragment)) return undefined
  if (line !== undefined && line !== null && (!Number.isSafeInteger(line) || (line as number) < 0 || (line as number) > 65_535)) return undefined
  return Object.freeze({ type: 'ice', candidate,
    ...(record.sdpMid !== undefined ? { sdpMid } : {}), ...(line !== undefined ? { sdpMLineIndex: line as number | null } : {}),
    ...(record.usernameFragment !== undefined ? { usernameFragment } : {}) })
}

export function parseOnlineRealtimeEvent(value: unknown): OnlineRealtimeEvent | undefined {
  const base = exactRecord(value, ['type'], ['version', 'userId', 'onlineFriends', 'requestId', 'negotiationId', 'from', 'payload', 'online', 'code', 'message'])
  if (!base) return undefined
  if (base.type === 'ready') {
    const record = exactRecord(value, ['type', 'version', 'userId', 'onlineFriends'])
    const friends = record && parseUserIds(record.onlineFriends, 200)
    return record?.version === 1 && isOnlineUserId(record.userId) && friends ? Object.freeze({ type: 'ready', version: 1, userId: record.userId, onlineFriends: friends }) : undefined
  }
  if (base.type === 'signal') {
    const record = exactRecord(value, ['type', 'requestId', 'negotiationId', 'from', 'payload'])
    const payload = record && parseOnlineSignalPayload(record.payload)
    return record && isOnlineRequestId(record.requestId) && isOnlineNegotiationId(record.negotiationId) && isOnlineUserId(record.from) && payload
      ? Object.freeze({ type: 'signal', requestId: record.requestId, negotiationId: record.negotiationId, from: record.from, payload })
      : undefined
  }
  if (base.type === 'signal-accepted') {
    const record = exactRecord(value, ['type', 'requestId'])
    return record && isOnlineRequestId(record.requestId) ? Object.freeze({ type: 'signal-accepted', requestId: record.requestId }) : undefined
  }
  if (base.type === 'presence') {
    const record = exactRecord(value, ['type', 'userId', 'online'])
    return record && isOnlineUserId(record.userId) && typeof record.online === 'boolean' ? Object.freeze({ type: 'presence', userId: record.userId, online: record.online }) : undefined
  }
  if (base.type === 'social-changed') return exactRecord(value, ['type']) ? Object.freeze({ type: 'social-changed' }) : undefined
  if (base.type !== 'error') return undefined
  const record = exactRecord(value, ['type', 'code', 'message'], ['requestId'])
  const code = record && boundedString(record.code, 64), message = record && boundedString(record.message, 512)
  if (!record || !code || !message || (record.requestId !== undefined && !isOnlineRequestId(record.requestId))) return undefined
  return Object.freeze({ type: 'error', code, message, ...(record.requestId !== undefined ? { requestId: record.requestId } : {}) })
}
