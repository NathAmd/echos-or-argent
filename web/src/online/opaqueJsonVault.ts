const textEncoder = new TextEncoder()
const strictTextDecoder = new TextDecoder('utf-8', { fatal: true })

const ivBytes = 12
const authenticationTagBytes = 16
const keyBytes = 32
const vaultContextProtocol = 'opaque-json-vault.v1'
const ownerIdPattern = /^[A-Za-z0-9](?:[A-Za-z0-9._-]{0,63})$/
const objectIdPattern = /^[A-Za-z0-9_-]{21}[AQgw]$/

export const OPAQUE_JSON_LIMITS = Object.freeze({
  plaintextBytes: 1024 * 1024,
  ciphertextBytes: 1024 * 1024 + authenticationTagBytes,
  contextBytes: 4 * 1024,
  depth: 64,
  nodes: 65_536,
})

export type OpaqueJsonValue = null | boolean | number | string | OpaqueJsonArray | OpaqueJsonObject
export type OpaqueJsonArray = readonly OpaqueJsonValue[]
export type OpaqueJsonObject = Readonly<{ [key: string]: OpaqueJsonValue }>

export type OpaqueVaultEnvelope = Readonly<{
  version: 1
  algorithm: 'A256GCM'
  iv: string
  ciphertext: string
}>

declare const sealedOpaqueVaultEnvelopeBrand: unique symbol

/** Enveloppe produite dans cette session par le codec avec un contexte obligatoire. */
export type SealedOpaqueVaultEnvelope = OpaqueVaultEnvelope & {
  readonly [sealedOpaqueVaultEnvelopeBrand]: true
}

declare const cloudSafeSealedOpaqueVaultEnvelopeBrand: unique symbol

/** Enveloppe attestée par la façade de projection portable avant transport HTTP. */
export type CloudSafeSealedOpaqueVaultEnvelope = SealedOpaqueVaultEnvelope & {
  readonly [cloudSafeSealedOpaqueVaultEnvelopeBrand]: true
}

declare const opaqueVaultContextBrand: unique symbol

/** Contexte authentifie localement ; il n'est jamais inclus dans l'enveloppe envoyee. */
export type OpaqueVaultContext = Readonly<{
  protocol: 'opaque-json-vault.v1'
  ownerId: string
  objectId: string
  readonly [opaqueVaultContextBrand]: true
}>

export type OpaqueJsonVaultErrorCode =
  | 'crypto-unavailable'
  | 'invalid-key'
  | 'invalid-data'
  | 'limit-exceeded'
  | 'invalid-context'
  | 'invalid-envelope'
  | 'open-failed'

export class OpaqueJsonVaultError extends Error {
  readonly code: OpaqueJsonVaultErrorCode

  constructor(code: OpaqueJsonVaultErrorCode, message: string) {
    super(message)
    this.name = 'OpaqueJsonVaultError'
    this.code = code
  }
}

const sealedEnvelopeContexts = new WeakMap<object, OpaqueVaultContext>()
const cloudSafeEnvelopeContexts = new WeakMap<object, OpaqueVaultContext>()

type TraversalState = {
  nodes: number
  readonly seen: WeakSet<object>
}

function fail(code: OpaqueJsonVaultErrorCode, message: string): never {
  throw new OpaqueJsonVaultError(code, message)
}

function webCrypto(): Crypto {
  const candidate = globalThis.crypto
  if (!candidate?.subtle || typeof candidate.getRandomValues !== 'function') {
    return fail('crypto-unavailable', 'Web Crypto est indisponible.')
  }
  return candidate
}

function encodedLength(byteLength: number): number {
  return Math.ceil(byteLength * 4 / 3)
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 32 * 1024
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize))
  }
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function decodeBase64Url(value: string, maximumBytes: number): Uint8Array<ArrayBuffer> | undefined {
  if (value.length === 0 || value.length > encodedLength(maximumBytes) || value.length % 4 === 1) return undefined
  if (!/^[A-Za-z0-9_-]+$/.test(value)) return undefined
  try {
    const standard = value.replaceAll('-', '+').replaceAll('_', '/')
    const binary = atob(standard + '='.repeat((4 - value.length % 4) % 4))
    if (binary.length > maximumBytes) return undefined
    const bytes = new Uint8Array(binary.length)
    for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
    return encodeBase64Url(bytes) === value ? bytes : undefined
  } catch {
    return undefined
  }
}

function assertKey(key: CryptoKey, usage: 'encrypt' | 'decrypt'): void {
  try {
    const algorithm = key.algorithm as KeyAlgorithm & { length?: unknown }
    if (key.type !== 'secret' || algorithm.name !== 'AES-GCM' || algorithm.length !== 256 || !key.usages.includes(usage)) {
      fail('invalid-key', `La clé ne permet pas l'opération ${usage}.`)
    }
  } catch (error) {
    if (error instanceof OpaqueJsonVaultError) throw error
    fail('invalid-key', 'La clé est invalide.')
  }
}

function assertPlainDescriptor(descriptor: PropertyDescriptor | undefined): asserts descriptor is PropertyDescriptor & { value: unknown } {
  if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) {
    fail('invalid-data', 'Seules les propriétés de données JSON sont acceptées.')
  }
}

function enterNode(value: object, state: TraversalState): void {
  if (state.seen.has(value)) fail('invalid-data', 'Les références partagées ou cycliques sont refusées.')
  state.seen.add(value)
}

function cloneJsonValue(value: unknown, depth: number, state: TraversalState): OpaqueJsonValue {
  if (depth > OPAQUE_JSON_LIMITS.depth) fail('limit-exceeded', 'La profondeur JSON maximale est dépassée.')
  state.nodes += 1
  if (state.nodes > OPAQUE_JSON_LIMITS.nodes) fail('limit-exceeded', 'Le nombre maximal de nœuds JSON est dépassé.')
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) fail('invalid-data', 'Tous les nombres JSON doivent être finis.')
    return value
  }
  if (typeof value !== 'object') fail('invalid-data', 'La valeur ne fait pas partie du format JSON strict.')

  enterNode(value, state)
  if (Array.isArray(value)) {
    if (Object.getPrototypeOf(value) !== Array.prototype) fail('invalid-data', 'Un tableau possède un prototype non autorisé.')
    if (value.length > OPAQUE_JSON_LIMITS.nodes - state.nodes) fail('limit-exceeded', 'Le nombre maximal de nœuds JSON est dépassé.')
    const ownKeys = Reflect.ownKeys(value)
    if (ownKeys.length !== value.length + 1 || !ownKeys.includes('length')) {
      fail('invalid-data', 'Un tableau JSON ne peut contenir ni trou, ni propriété supplémentaire.')
    }
    const clone: OpaqueJsonValue[] = []
    for (let index = 0; index < value.length; index += 1) {
      const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
      assertPlainDescriptor(descriptor)
      clone.push(cloneJsonValue(descriptor.value, depth + 1, state))
    }
    return Object.freeze(clone)
  }

  if (Object.getPrototypeOf(value) !== Object.prototype) fail('invalid-data', 'Un objet possède un prototype non autorisé.')
  const keys = Reflect.ownKeys(value)
  if (keys.length > OPAQUE_JSON_LIMITS.nodes - state.nodes) fail('limit-exceeded', 'Le nombre maximal de nœuds JSON est dépassé.')
  const clone: Record<string, OpaqueJsonValue> = {}
  for (const key of keys) {
    if (typeof key !== 'string') fail('invalid-data', 'Les clés symboliques sont refusées.')
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    assertPlainDescriptor(descriptor)
    Object.defineProperty(clone, key, {
      configurable: true,
      enumerable: true,
      writable: true,
      value: cloneJsonValue(descriptor.value, depth + 1, state),
    })
  }
  return Object.freeze(clone)
}

function prepareJson(value: unknown): Readonly<{ value: OpaqueJsonValue, bytes: Uint8Array<ArrayBuffer> }> {
  try {
    const normalized = cloneJsonValue(value, 0, { nodes: 0, seen: new WeakSet() })
    const serialized = JSON.stringify(normalized)
    const bytes = textEncoder.encode(serialized)
    if (bytes.byteLength > OPAQUE_JSON_LIMITS.plaintextBytes) {
      fail('limit-exceeded', 'La taille JSON maximale est dépassée.')
    }
    return Object.freeze({ value: normalized, bytes })
  } catch (error) {
    if (error instanceof OpaqueJsonVaultError) throw error
    fail('invalid-data', 'La valeur JSON est invalide.')
  }
}

function canonicalizeContext(context: OpaqueVaultContext): OpaqueVaultContext {
  if (
    context === null ||
    typeof context !== 'object' ||
    Object.getPrototypeOf(context) !== Object.prototype ||
    Reflect.ownKeys(context).length !== 3
  ) {
    fail('invalid-context', 'Le contexte authentifié du coffre est invalide.')
  }
  const protocol = Object.getOwnPropertyDescriptor(context, 'protocol')
  const ownerId = Object.getOwnPropertyDescriptor(context, 'ownerId')
  const objectId = Object.getOwnPropertyDescriptor(context, 'objectId')
  if (
    !protocol?.enumerable || !Object.hasOwn(protocol, 'value') || protocol.value !== vaultContextProtocol ||
    !ownerId?.enumerable || !Object.hasOwn(ownerId, 'value') || typeof ownerId.value !== 'string' || !ownerIdPattern.test(ownerId.value) ||
    !objectId?.enumerable || !Object.hasOwn(objectId, 'value') || typeof objectId.value !== 'string' || !objectIdPattern.test(objectId.value)
  ) {
    fail('invalid-context', 'Le contexte authentifié du coffre est invalide.')
  }
  return Object.freeze({
    protocol: vaultContextProtocol,
    ownerId: ownerId.value,
    objectId: objectId.value,
  }) as OpaqueVaultContext
}

function encodeContext(context: OpaqueVaultContext): Uint8Array<ArrayBuffer> {
  const canonical = canonicalizeContext(context)
  const bytes = textEncoder.encode(JSON.stringify([canonical.protocol, canonical.ownerId, canonical.objectId]))
  if (bytes.byteLength > OPAQUE_JSON_LIMITS.contextBytes) fail('limit-exceeded', 'Le contexte est trop volumineux.')
  return bytes
}

/** Lie cryptographiquement une enveloppe a son protocole, son compte et son objet opaque. */
export function createOpaqueVaultContext(ownerId: string, objectId: string): OpaqueVaultContext {
  if (
    typeof ownerId !== 'string' ||
    !ownerIdPattern.test(ownerId) ||
    typeof objectId !== 'string' ||
    !objectIdPattern.test(objectId)
  ) {
    fail('invalid-context', 'Le propriétaire ou l’identifiant d’objet du coffre est invalide.')
  }
  return canonicalizeContext({
    protocol: vaultContextProtocol,
    ownerId,
    objectId,
  } as OpaqueVaultContext)
}

/** Vérifie la provenance locale et la liaison au compte/objet avant une écriture distante. */
export function isSealedOpaqueVaultEnvelopeFor(
  envelope: unknown,
  ownerId: string,
  objectId: string,
): envelope is SealedOpaqueVaultEnvelope {
  if (envelope === null || typeof envelope !== 'object') return false
  const context = sealedEnvelopeContexts.get(envelope)
  return context?.protocol === vaultContextProtocol && context.ownerId === ownerId && context.objectId === objectId
}

/**
 * Capacité interne consommée uniquement par la façade portable allowlistée.
 * La frontière de source interdit son import direct depuis les autres modules.
 */
export function attestSealedOpaqueVaultEnvelopeForPortableCloud(
  envelope: SealedOpaqueVaultEnvelope,
  ownerId: string,
  objectId: string,
): CloudSafeSealedOpaqueVaultEnvelope {
  if (!isSealedOpaqueVaultEnvelopeFor(envelope, ownerId, objectId)) {
    fail('invalid-envelope', "L’enveloppe n’est pas liée au contexte portable attendu.")
  }
  cloudSafeEnvelopeContexts.set(envelope, createOpaqueVaultContext(ownerId, objectId))
  return envelope as CloudSafeSealedOpaqueVaultEnvelope
}

export function isCloudSafeSealedOpaqueVaultEnvelopeFor(
  envelope: unknown,
  ownerId: string,
  objectId: string,
): envelope is CloudSafeSealedOpaqueVaultEnvelope {
  if (envelope === null || typeof envelope !== 'object') return false
  const context = cloudSafeEnvelopeContexts.get(envelope)
  return context?.protocol === vaultContextProtocol && context.ownerId === ownerId && context.objectId === objectId
}

function exactEnvelopeRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) return undefined
  const keys = Reflect.ownKeys(value)
  const expected = new Set(['version', 'algorithm', 'iv', 'ciphertext'])
  if (keys.length !== expected.size || keys.some((key) => typeof key !== 'string' || !expected.has(key))) return undefined
  const record: Record<string, unknown> = {}
  for (const key of expected) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) return undefined
    record[key] = descriptor.value
  }
  return record
}

export function parseOpaqueVaultEnvelope(value: unknown): OpaqueVaultEnvelope | undefined {
  try {
    const record = exactEnvelopeRecord(value)
    if (!record || record.version !== 1 || record.algorithm !== 'A256GCM') return undefined
    if (typeof record.iv !== 'string' || typeof record.ciphertext !== 'string') return undefined
    const decodedIv = decodeBase64Url(record.iv, ivBytes)
    const decodedCiphertext = decodeBase64Url(record.ciphertext, OPAQUE_JSON_LIMITS.ciphertextBytes)
    if (decodedIv?.byteLength !== ivBytes || !decodedCiphertext || decodedCiphertext.byteLength < authenticationTagBytes) return undefined
    return Object.freeze({ version: 1, algorithm: 'A256GCM', iv: record.iv, ciphertext: record.ciphertext })
  } catch {
    return undefined
  }
}

/** Valide, copie et gèle récursivement une valeur JSON avant tout transport. */
export function freezeOpaqueJsonData(value: unknown): OpaqueJsonValue {
  return prepareJson(value).value
}

/** Crée une clé éphémère exportable ; son éventuelle persistance reste à la charge de l'appelant. */
export async function generateOpaqueVaultKey(): Promise<CryptoKey> {
  return webCrypto().subtle.generateKey({ name: 'AES-GCM', length: 256 }, true, ['encrypt', 'decrypt'])
}

/** Importe exactement 256 bits encodés en base64url canonique, sans les conserver dans le module. */
export async function importOpaqueVaultKey(encodedKey: string): Promise<CryptoKey> {
  if (typeof encodedKey !== 'string') fail('invalid-key', 'La clé exportée est invalide.')
  const raw = decodeBase64Url(encodedKey, keyBytes)
  if (raw?.byteLength !== keyBytes) fail('invalid-key', 'La clé exportée est invalide.')
  try {
    return await webCrypto().subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])
  } catch {
    return fail('invalid-key', "L'import de la clé a échoué.")
  } finally {
    raw.fill(0)
  }
}

/** Exporte uniquement à la demande de l'appelant ; aucune copie de la clé n'est stockée. */
export async function exportOpaqueVaultKey(key: CryptoKey): Promise<string> {
  assertKey(key, 'encrypt')
  let raw: Uint8Array<ArrayBuffer> | undefined
  try {
    raw = new Uint8Array(await webCrypto().subtle.exportKey('raw', key))
    if (raw.byteLength !== keyBytes) return fail('invalid-key', 'La clé exportée doit contenir exactement 256 bits.')
    return encodeBase64Url(raw)
  } catch (error) {
    if (error instanceof OpaqueJsonVaultError) throw error
    return fail('invalid-key', "L'export de la clé a échoué.")
  } finally {
    raw?.fill(0)
  }
}

export async function sealOpaqueJson(key: CryptoKey, value: unknown, context: OpaqueVaultContext): Promise<SealedOpaqueVaultEnvelope> {
  assertKey(key, 'encrypt')
  const prepared = prepareJson(value)
  const canonicalContext = canonicalizeContext(context)
  const additionalData = encodeContext(canonicalContext)
  const iv = webCrypto().getRandomValues(new Uint8Array(ivBytes))
  try {
    const ciphertext = await webCrypto().subtle.encrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData },
      key,
      prepared.bytes,
    )
    const encrypted = new Uint8Array(ciphertext)
    if (encrypted.byteLength > OPAQUE_JSON_LIMITS.ciphertextBytes) return fail('limit-exceeded', 'Le texte chiffré est trop volumineux.')
    const envelope = Object.freeze({
      version: 1,
      algorithm: 'A256GCM',
      iv: encodeBase64Url(iv),
      ciphertext: encodeBase64Url(encrypted),
    }) as SealedOpaqueVaultEnvelope
    sealedEnvelopeContexts.set(envelope, canonicalContext)
    return envelope
  } finally {
    prepared.bytes.fill(0)
    additionalData?.fill(0)
  }
}

export async function openOpaqueJson(key: CryptoKey, envelope: unknown, context: OpaqueVaultContext): Promise<OpaqueJsonValue> {
  assertKey(key, 'decrypt')
  const parsed = parseOpaqueVaultEnvelope(envelope)
  if (!parsed) fail('invalid-envelope', "L'enveloppe chiffrée est invalide.")
  const iv = decodeBase64Url(parsed.iv, ivBytes)
  const ciphertext = decodeBase64Url(parsed.ciphertext, OPAQUE_JSON_LIMITS.ciphertextBytes)
  if (!iv || !ciphertext) fail('invalid-envelope', "L'enveloppe chiffrée est invalide.")
  const additionalData = encodeContext(context)
  let plaintext: Uint8Array<ArrayBuffer> | undefined
  try {
    plaintext = new Uint8Array(await webCrypto().subtle.decrypt(
      { name: 'AES-GCM', iv, tagLength: 128, additionalData },
      key,
      ciphertext,
    ))
    if (plaintext.byteLength > OPAQUE_JSON_LIMITS.plaintextBytes) fail('open-failed', "L'ouverture a échoué.")
    const decoded = strictTextDecoder.decode(plaintext)
    return prepareJson(JSON.parse(decoded)).value
  } catch (error) {
    if (error instanceof OpaqueJsonVaultError && (
      error.code === 'limit-exceeded'
      || error.code === 'crypto-unavailable'
      || error.code === 'invalid-key'
      || error.code === 'invalid-context'
    )) throw error
    return fail('open-failed', "L'ouverture a échoué.")
  } finally {
    plaintext?.fill(0)
    ciphertext.fill(0)
    iv.fill(0)
    additionalData?.fill(0)
  }
}
