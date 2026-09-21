import type { OnlineClientConfig } from './onlineClientConfig'
import {
  isCloudSafeSealedOpaqueVaultEnvelopeFor,
  parseOpaqueVaultEnvelope,
  type CloudSafeSealedOpaqueVaultEnvelope,
  type OpaqueVaultEnvelope,
} from './opaqueJsonVault'
import { isOnlineUserId } from './onlineServiceProtocol'

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>

declare const opaqueObjectIdBrand: unique symbol
declare const opaqueVaultEtagBrand: unique symbol
declare const opaqueVaultMutationBrand: unique symbol

export type OpaqueObjectId = string & { readonly [opaqueObjectIdBrand]: true }
export type OpaqueVaultEtag = string & { readonly [opaqueVaultEtagBrand]: true }
export type OpaqueVaultMutation = string & { readonly [opaqueVaultMutationBrand]: true }

export const OPAQUE_VAULT_MEDIA_TYPE = 'application/vnd.opaque-vault.v1+json'
export const OPAQUE_VAULT_HTTP_LIMITS = Object.freeze({
  accessTokenBytes: 512,
  ciphertextBytes: 1024 * 1024 + 16,
  // Le quota Fetch de 64 Kio additionne les corps keepalive encore en vol dans
  // le même groupe. Cette marge est gérée cumulativement par le client.
  keepaliveBodyBytes: 60 * 1024,
  responseBytes: 1536 * 1024,
})

// 128 bits en base64url sans remplissage ; le dernier sextet doit être canonique.
const objectIdPattern = /^[A-Za-z0-9_-]{21}[AQgw]$/
const etagPattern = /^"r-[a-f0-9]{32}"$/
const mutationPattern = /^m-[a-f0-9]{32}$/
const remoteCodePattern = /^[A-Z][A-Z0-9_]{0,63}$/
const requestIdPattern = /^[A-Za-z0-9-]{1,128}$/
const textEncoder = new TextEncoder()
const strictTextDecoder = new TextDecoder('utf-8', { fatal: true })

export class OpaqueVaultProtocolError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpaqueVaultProtocolError'
  }
}

export class OpaqueVaultServiceError extends Error {
  readonly status: number
  readonly code: string
  readonly requestId: string

  constructor(status: number, code: string, message: string, requestId: string) {
    super(message)
    this.name = 'OpaqueVaultServiceError'
    this.status = status
    this.code = code
    this.requestId = requestId
  }

  get isConflict(): boolean {
    return this.status === 412 && this.code === 'PRECONDITION_FAILED'
  }
}

export type OpaqueVaultStoredObject = Readonly<{
  envelope: OpaqueVaultEnvelope
  etag: OpaqueVaultEtag
  mutation: OpaqueVaultMutation
}>

export type OpaqueVaultWriteResult = Readonly<{
  created: boolean
  etag: OpaqueVaultEtag
  mutation: OpaqueVaultMutation
}>

export type OpaqueVaultHttpClient = Readonly<{
  get: (objectId: OpaqueObjectId, signal?: AbortSignal) => Promise<OpaqueVaultStoredObject | undefined>
  create: (objectId: OpaqueObjectId, envelope: CloudSafeSealedOpaqueVaultEnvelope, signal?: AbortSignal) => Promise<OpaqueVaultWriteResult>
  replace: (objectId: OpaqueObjectId, etag: OpaqueVaultEtag, envelope: CloudSafeSealedOpaqueVaultEnvelope, signal?: AbortSignal) => Promise<OpaqueVaultWriteResult>
  delete: (objectId: OpaqueObjectId, etag: OpaqueVaultEtag, signal?: AbortSignal) => Promise<void>
}>

export type OpaqueVaultHttpClientOptions = Readonly<{
  config: OnlineClientConfig
  readAccessToken: () => string | undefined
  readOwnerId: () => string | undefined
  fetch?: FetchLike
}>

type ParsedRemoteError = Readonly<{
  code: string
  message: string
  requestId: string
}>

function webCrypto(): Crypto {
  const candidate = globalThis.crypto
  if (!candidate || typeof candidate.getRandomValues !== 'function') {
    throw new Error('Génération aléatoire sécurisée indisponible.')
  }
  return candidate
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

export function parseOpaqueObjectId(value: unknown): OpaqueObjectId | undefined {
  return typeof value === 'string' && objectIdPattern.test(value) ? value as OpaqueObjectId : undefined
}

/** Crée un identifiant sans signification métier à partir de 128 bits aléatoires. */
export function generateOpaqueObjectId(): OpaqueObjectId {
  const bytes = webCrypto().getRandomValues(new Uint8Array(16))
  try {
    const encoded = encodeBase64Url(bytes)
    const parsed = parseOpaqueObjectId(encoded)
    if (!parsed) throw new Error("La génération de l'identifiant opaque a échoué.")
    return parsed
  } finally {
    bytes.fill(0)
  }
}

export function parseOpaqueVaultEtag(value: unknown): OpaqueVaultEtag | undefined {
  return typeof value === 'string' && etagPattern.test(value) ? value as OpaqueVaultEtag : undefined
}

export function parseOpaqueVaultMutation(value: unknown): OpaqueVaultMutation | undefined {
  return typeof value === 'string' && mutationPattern.test(value)
    ? value as OpaqueVaultMutation
    : undefined
}

function requireObjectId(value: OpaqueObjectId): OpaqueObjectId {
  const parsed = parseOpaqueObjectId(value)
  if (!parsed) throw new Error("Identifiant d'objet opaque invalide.")
  return parsed
}

function requireEtag(value: OpaqueVaultEtag): OpaqueVaultEtag {
  const parsed = parseOpaqueVaultEtag(value)
  if (!parsed) throw new Error("Révision d'objet opaque invalide.")
  return parsed
}

function decodedBase64UrlByteLength(value: string): number {
  return Math.floor(value.length * 3 / 4)
}

function requireRemoteEnvelope(
  value: CloudSafeSealedOpaqueVaultEnvelope,
  ownerId: string,
  objectId: OpaqueObjectId,
): OpaqueVaultEnvelope {
  const parsed = parseOpaqueVaultEnvelope(value)
  if (
    !parsed ||
    !isCloudSafeSealedOpaqueVaultEnvelopeFor(value, ownerId, objectId) ||
    decodedBase64UrlByteLength(parsed.ciphertext) > OPAQUE_VAULT_HTTP_LIMITS.ciphertextBytes
  ) {
    throw new Error("Enveloppe d'objet opaque invalide ou trop volumineuse.")
  }
  return parsed
}

function readOwnerId(readOwnerId: () => string | undefined): string {
  const ownerId = readOwnerId()
  if (!isOnlineUserId(ownerId)) throw new Error("Identité en ligne absente ou invalide.")
  return ownerId
}

function readToken(readAccessToken: () => string | undefined): string {
  const value = readAccessToken()
  if (
    !value ||
    /\s/.test(value) ||
    textEncoder.encode(value).byteLength > OPAQUE_VAULT_HTTP_LIMITS.accessTokenBytes
  ) {
    throw new Error('Session du compte absente ou invalide.')
  }
  return value
}

function declaredContentLength(response: Response): number | undefined {
  const header = response.headers.get('Content-Length')
  if (header === null) return undefined
  if (!/^(?:0|[1-9][0-9]*)$/.test(header)) {
    throw new OpaqueVaultProtocolError('Longueur de réponse invalide.')
  }
  const length = Number(header)
  if (!Number.isSafeInteger(length) || length > OPAQUE_VAULT_HTTP_LIMITS.responseBytes) {
    throw new OpaqueVaultProtocolError('Réponse du coffre opaque trop volumineuse.')
  }
  return length
}

async function readBoundedText(response: Response): Promise<string> {
  let declared: number | undefined
  try {
    declared = declaredContentLength(response)
  } catch (error) {
    await response.body?.cancel().catch(() => undefined)
    throw error
  }
  if (response.body === null) {
    if (declared !== undefined && declared !== 0) throw new OpaqueVaultProtocolError('Corps de réponse manquant.')
    return ''
  }
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let received = 0
  try {
    while (true) {
      const result = await reader.read()
      if (result.done) break
      received += result.value.byteLength
      if (received > OPAQUE_VAULT_HTTP_LIMITS.responseBytes) {
        throw new OpaqueVaultProtocolError('Réponse du coffre opaque trop volumineuse.')
      }
      chunks.push(result.value)
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined)
    throw error
  }
  const bytes = new Uint8Array(received)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  try {
    return strictTextDecoder.decode(bytes)
  } catch {
    throw new OpaqueVaultProtocolError("La réponse n'est pas un texte UTF-8 valide.")
  }
}

function parseJson(text: string): unknown {
  if (text === '') throw new OpaqueVaultProtocolError('Réponse JSON manquante.')
  try {
    return JSON.parse(text) as unknown
  } catch {
    throw new OpaqueVaultProtocolError('Réponse JSON invalide.')
  }
}

function exactRecord(value: unknown, keys: readonly string[]): Record<string, unknown> | undefined {
  if (value === null || Array.isArray(value) || typeof value !== 'object' || Object.getPrototypeOf(value) !== Object.prototype) {
    return undefined
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== keys.length || ownKeys.some((key) => typeof key !== 'string' || !keys.includes(key))) return undefined
  return value as Record<string, unknown>
}

function parseRemoteError(value: unknown): ParsedRemoteError | undefined {
  const outer = exactRecord(value, ['error', 'requestId'])
  const inner = exactRecord(outer?.error, ['code', 'message'])
  if (
    !outer ||
    !inner ||
    typeof inner.code !== 'string' ||
    !remoteCodePattern.test(inner.code) ||
    typeof inner.message !== 'string' ||
    inner.message.length === 0 ||
    textEncoder.encode(inner.message).byteLength > 4 * 1024 ||
    typeof outer.requestId !== 'string' ||
    !requestIdPattern.test(outer.requestId)
  ) {
    return undefined
  }
  return Object.freeze({ code: inner.code, message: inner.message, requestId: outer.requestId })
}

function requireMediaType(response: Response, expected: string): void {
  if (response.headers.get('Content-Type')?.toLowerCase() !== expected) {
    throw new OpaqueVaultProtocolError('Type de contenu inattendu dans la réponse.')
  }
}

function requireEmptySuccessBody(text: string): void {
  if (text !== '') throw new OpaqueVaultProtocolError('Une réponse vide était attendue.')
}

function responseEtag(response: Response): OpaqueVaultEtag {
  const etag = parseOpaqueVaultEtag(response.headers.get('ETag'))
  if (!etag) throw new OpaqueVaultProtocolError('Révision absente ou invalide dans la réponse.')
  return etag
}

function responseMutation(response: Response): OpaqueVaultMutation {
  const header = response.headers.get('Opaque-Mutation')
  const mutation = parseOpaqueVaultMutation(header)
  if (!mutation) throw new OpaqueVaultProtocolError('Horloge de mutation absente ou invalide dans la réponse.')
  return mutation
}

function throwRemoteError(response: Response, text: string): never {
  requireMediaType(response, 'application/json; charset=utf-8')
  const parsed = parseRemoteError(parseJson(text))
  if (!parsed) throw new OpaqueVaultProtocolError("Réponse d'erreur invalide du coffre opaque.")
  throw new OpaqueVaultServiceError(response.status, parsed.code, parsed.message, parsed.requestId)
}

export function createOpaqueVaultHttpClient(options: OpaqueVaultHttpClientOptions): OpaqueVaultHttpClient {
  const fetchRequest = options.fetch ?? ((input, init) => fetch(input, init))
  let inFlightKeepaliveBodyBytes = 0

  const request = async (
    method: 'GET' | 'PUT' | 'DELETE',
    objectId: OpaqueObjectId,
    headers: Readonly<Record<string, string>>,
    body: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<Readonly<{ response: Response, text: string }>> => {
    const id = requireObjectId(objectId)
    const bodyBytes = body === undefined ? 0 : textEncoder.encode(body).byteLength
    const keepalive = method !== 'GET'
      && inFlightKeepaliveBodyBytes + bodyBytes <= OPAQUE_VAULT_HTTP_LIMITS.keepaliveBodyBytes
    if (keepalive) inFlightKeepaliveBodyBytes += bodyBytes
    try {
      const response = await fetchRequest(`${options.config.httpBaseUrl}/v1/objects/${id}`, {
        method,
        signal,
        cache: 'no-store',
        credentials: 'omit',
        ...(keepalive ? { keepalive: true } : {}),
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        headers: {
          Accept: `${OPAQUE_VAULT_MEDIA_TYPE}, application/json`,
          Authorization: `Bearer ${readToken(options.readAccessToken)}`,
          ...headers,
        },
        ...(body === undefined ? {} : { body }),
      })
      return Object.freeze({ response, text: await readBoundedText(response) })
    } finally {
      if (keepalive) inFlightKeepaliveBodyBytes -= bodyBytes
    }
  }

  const put = async (
    objectId: OpaqueObjectId,
    envelope: CloudSafeSealedOpaqueVaultEnvelope,
    condition: Readonly<Record<string, string>>,
    expectedStatus: 201 | 204,
    signal?: AbortSignal,
  ): Promise<OpaqueVaultWriteResult> => {
    const id = requireObjectId(objectId)
    const ownerId = readOwnerId(options.readOwnerId)
    const normalized = requireRemoteEnvelope(envelope, ownerId, id)
    const { response, text } = await request(
      'PUT',
      objectId,
      { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ...condition },
      JSON.stringify(normalized),
      signal,
    )
    if (!response.ok) throwRemoteError(response, text)
    if (response.status !== expectedStatus) throw new OpaqueVaultProtocolError('Statut de création ou remplacement inattendu.')
    requireEmptySuccessBody(text)
    return Object.freeze({
      created: response.status === 201,
      etag: responseEtag(response),
      mutation: responseMutation(response),
    })
  }

  return Object.freeze({
    async get(objectId, signal) {
      const { response, text } = await request('GET', objectId, {}, undefined, signal)
      if (response.status === 404) {
        requireMediaType(response, 'application/json; charset=utf-8')
        const missing = parseRemoteError(parseJson(text))
        if (!missing || missing.code !== 'NOT_FOUND') {
          throw new OpaqueVaultProtocolError("Réponse d'absence invalide du coffre opaque.")
        }
        return undefined
      }
      if (!response.ok) throwRemoteError(response, text)
      if (response.status !== 200) throw new OpaqueVaultProtocolError('Statut de lecture inattendu.')
      requireMediaType(response, OPAQUE_VAULT_MEDIA_TYPE)
      const envelope = parseOpaqueVaultEnvelope(parseJson(text))
      if (!envelope || decodedBase64UrlByteLength(envelope.ciphertext) > OPAQUE_VAULT_HTTP_LIMITS.ciphertextBytes) {
        throw new OpaqueVaultProtocolError("Enveloppe d'objet opaque invalide dans la réponse.")
      }
      return Object.freeze({
        envelope,
        etag: responseEtag(response),
        mutation: responseMutation(response),
      })
    },
    create: (objectId, envelope, signal) => put(objectId, envelope, { 'If-None-Match': '*' }, 201, signal),
    replace: (objectId, etag, envelope, signal) => put(objectId, envelope, { 'If-Match': requireEtag(etag) }, 204, signal),
    async delete(objectId, etag, signal) {
      const { response, text } = await request('DELETE', objectId, { 'If-Match': requireEtag(etag) }, undefined, signal)
      if (!response.ok) throwRemoteError(response, text)
      if (response.status !== 204) throw new OpaqueVaultProtocolError('Statut de suppression inattendu.')
      requireEmptySuccessBody(text)
    },
  })
}
