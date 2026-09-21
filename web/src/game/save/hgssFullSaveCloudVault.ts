import {
  createPortableCloudVaultClient,
  PortableCloudCorruptObjectError,
  type PortableCloudStoredDocument,
  type PortableCloudVaultClient,
  type PortableCloudVaultClientOptions,
} from './portableCloudVault'
import {
  createPortableStateRegistry,
  definePortableStateContributor,
  type PortableStateDocument,
} from './portableStateRegistry'
import type { JsonSaveValue } from './versionedSaveExtensions'
import {
  hgssDataOnlySaveAuthority,
  type HgssDataOnlySaveDocument,
} from './hgssDataOnlySaveDocument'
import type { HgssBrowserSaveKind, HgssBrowserSaveSlot } from './hgssSaveStorage'

const hgssFullSaveContributorKey = 'campaign.full'
const hgssFullSaveContributorVersion = 1
const hgssCloudSlotContributorKey = 'campaign.slot'
const hgssCloudSlotContributorVersion = 1
const hgssCloudSlotMetadataFormat = 'pokemaster-hgss-cloud-slot'
const hgssCloudSlotMetadataVersion = 1
const derivedObjectIdBytes = 16
const aesKeyBytes = 32
const textEncoder = new TextEncoder()

export const HGSS_FULL_SAVE_CLOUD_OBJECT_ID_DERIVATION = Object.freeze({
  protocol: 'pokemaster.hgss.full-save-slot-object-id.v1',
  algorithm: 'HMAC',
  hash: 'SHA-256',
  outputBits: derivedObjectIdBytes * 8,
} as const)

type CloudObjectId = Parameters<PortableCloudVaultClient['get']>[0]
type CloudEtag = PortableCloudStoredDocument['etag']
type CloudWriteResult = Awaited<ReturnType<PortableCloudVaultClient['create']>>

export type HgssFullSaveCloudObjectId = CloudObjectId

export type HgssFullSaveCloudRomIdentity = Readonly<{
  gameVersion: number
  language: number
}>

export type HgssFullSaveCloudPresentSnapshot = Readonly<{
  kind: 'present'
  slot: HgssBrowserSaveSlot
  romIdentity: HgssFullSaveCloudRomIdentity
  savedAt: string
  saveKind: HgssBrowserSaveKind
  document: HgssDataOnlySaveDocument
}>

export type HgssFullSaveCloudDeletedSnapshot = Readonly<{
  kind: 'deleted'
  slot: HgssBrowserSaveSlot
  romIdentity: HgssFullSaveCloudRomIdentity
  changedAt: string
}>

export type HgssFullSaveCloudSnapshot =
  | HgssFullSaveCloudPresentSnapshot
  | HgssFullSaveCloudDeletedSnapshot

type HgssFullSaveCloudPresentMetadata = Readonly<{
  format: typeof hgssCloudSlotMetadataFormat
  version: typeof hgssCloudSlotMetadataVersion
  kind: 'present'
  slot: HgssBrowserSaveSlot
  romIdentity: HgssFullSaveCloudRomIdentity
  savedAt: string
  saveKind: HgssBrowserSaveKind
}>

type HgssFullSaveCloudDeletedMetadata = Readonly<{
  format: typeof hgssCloudSlotMetadataFormat
  version: typeof hgssCloudSlotMetadataVersion
  kind: 'deleted'
  slot: HgssBrowserSaveSlot
  romIdentity: HgssFullSaveCloudRomIdentity
  changedAt: string
}>

type HgssFullSaveCloudMetadata =
  | HgssFullSaveCloudPresentMetadata
  | HgssFullSaveCloudDeletedMetadata

type HgssFullSaveProjectionContext = Readonly<{
  snapshot: HgssFullSaveCloudSnapshot
}>

type HgssFullSaveHydrationDraft = {
  metadata?: HgssFullSaveCloudMetadata
  document?: HgssDataOnlySaveDocument
}

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet exact.`)
  }
  const prototype: unknown = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) {
    throw new Error(`${label} doit être un objet JSON simple.`)
  }
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string') throw new Error(`${label} contient une clé non JSON.`)
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    if (!descriptor?.enumerable || !Object.hasOwn(descriptor, 'value')) {
      throw new Error(`${label} contient un champ non canonique.`)
    }
  }
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const keys = Object.keys(value).sort()
  const sortedExpected = [...expected].sort()
  if (
    keys.length !== sortedExpected.length
    || !keys.every((key, index) => key === sortedExpected[index])
  ) {
    throw new Error(`${label} contient des champs inconnus ou manquants.`)
  }
}

function requireByte(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xff) {
    throw new Error(`${label} doit être un entier sur 8 bits.`)
  }
  return value as number
}

function requireRomIdentity(value: unknown): HgssFullSaveCloudRomIdentity {
  const identity = requirePlainRecord(value, 'romIdentity')
  requireExactKeys(identity, ['gameVersion', 'language'], 'romIdentity')
  return Object.freeze({
    gameVersion: requireByte(identity.gameVersion, 'romIdentity.gameVersion'),
    language: requireByte(identity.language, 'romIdentity.language'),
  })
}

function requireSlot(value: unknown): HgssBrowserSaveSlot {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3) {
    throw new Error('Le slot cloud HGSS doit être compris entre 1 et 3.')
  }
  return value as HgssBrowserSaveSlot
}

function requireCanonicalTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 32) {
    throw new Error(`${label} doit être une date ISO canonique.`)
  }
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} doit être une date ISO canonique.`)
  }
  return value
}

function requireSaveKind(value: unknown): HgssBrowserSaveKind {
  if (value !== 'manual' && value !== 'auto') {
    throw new Error('Le type de sauvegarde cloud HGSS est invalide.')
  }
  return value
}

function requireDataOnlyDocument(value: unknown): asserts value is HgssDataOnlySaveDocument {
  if (!hgssDataOnlySaveAuthority.owns(value)) {
    throw new Error('La sauvegarde complète ne possède pas l’attestation data-only HGSS attendue.')
  }
}

function identitiesMatch(
  left: HgssFullSaveCloudRomIdentity,
  right: HgssFullSaveCloudRomIdentity,
): boolean {
  return left.gameVersion === right.gameVersion && left.language === right.language
}

function normalizeSnapshot(value: HgssFullSaveCloudSnapshot): HgssFullSaveCloudSnapshot {
  const snapshot = requirePlainRecord(value, 'Le snapshot cloud HGSS')
  if (snapshot.kind === 'present') {
    requireExactKeys(
      snapshot,
      ['document', 'kind', 'romIdentity', 'savedAt', 'saveKind', 'slot'],
      'Le snapshot cloud HGSS présent',
    )
    const romIdentity = requireRomIdentity(snapshot.romIdentity)
    const slot = requireSlot(snapshot.slot)
    const savedAt = requireCanonicalTimestamp(snapshot.savedAt, 'savedAt')
    const saveKind = requireSaveKind(snapshot.saveKind)
    requireDataOnlyDocument(snapshot.document)
    const documentIdentity = requireRomIdentity(snapshot.document.romIdentity)
    if (!identitiesMatch(romIdentity, documentIdentity)) {
      throw new Error('L’identité ROM du snapshot ne correspond pas à sa sauvegarde HGSS.')
    }
    return Object.freeze({
      kind: 'present',
      slot,
      romIdentity,
      savedAt,
      saveKind,
      document: snapshot.document,
    })
  }
  if (snapshot.kind === 'deleted') {
    requireExactKeys(
      snapshot,
      ['changedAt', 'kind', 'romIdentity', 'slot'],
      'Le snapshot cloud HGSS supprimé',
    )
    return Object.freeze({
      kind: 'deleted',
      slot: requireSlot(snapshot.slot),
      romIdentity: requireRomIdentity(snapshot.romIdentity),
      changedAt: requireCanonicalTimestamp(snapshot.changedAt, 'changedAt'),
    })
  }
  throw new Error('Le snapshot cloud HGSS doit être présent ou supprimé.')
}

function metadataForSnapshot(snapshot: HgssFullSaveCloudSnapshot): HgssFullSaveCloudMetadata {
  if (snapshot.kind === 'present') {
    return Object.freeze({
      format: hgssCloudSlotMetadataFormat,
      version: hgssCloudSlotMetadataVersion,
      kind: snapshot.kind,
      slot: snapshot.slot,
      romIdentity: snapshot.romIdentity,
      savedAt: snapshot.savedAt,
      saveKind: snapshot.saveKind,
    })
  }
  return Object.freeze({
    format: hgssCloudSlotMetadataFormat,
    version: hgssCloudSlotMetadataVersion,
    kind: snapshot.kind,
    slot: snapshot.slot,
    romIdentity: snapshot.romIdentity,
    changedAt: snapshot.changedAt,
  })
}

function decodeMetadata(value: JsonSaveValue): HgssFullSaveCloudMetadata {
  const metadata = requirePlainRecord(value, 'Les métadonnées du slot cloud HGSS')
  if (metadata.format !== hgssCloudSlotMetadataFormat || metadata.version !== hgssCloudSlotMetadataVersion) {
    throw new Error('La version des métadonnées du slot cloud HGSS est inconnue.')
  }
  if (metadata.kind === 'present') {
    requireExactKeys(
      metadata,
      ['format', 'kind', 'romIdentity', 'savedAt', 'saveKind', 'slot', 'version'],
      'Les métadonnées du slot cloud HGSS présent',
    )
    return Object.freeze({
      format: hgssCloudSlotMetadataFormat,
      version: hgssCloudSlotMetadataVersion,
      kind: 'present',
      slot: requireSlot(metadata.slot),
      romIdentity: requireRomIdentity(metadata.romIdentity),
      savedAt: requireCanonicalTimestamp(metadata.savedAt, 'savedAt'),
      saveKind: requireSaveKind(metadata.saveKind),
    })
  }
  if (metadata.kind === 'deleted') {
    requireExactKeys(
      metadata,
      ['changedAt', 'format', 'kind', 'romIdentity', 'slot', 'version'],
      'Les métadonnées du slot cloud HGSS supprimé',
    )
    return Object.freeze({
      format: hgssCloudSlotMetadataFormat,
      version: hgssCloudSlotMetadataVersion,
      kind: 'deleted',
      slot: requireSlot(metadata.slot),
      romIdentity: requireRomIdentity(metadata.romIdentity),
      changedAt: requireCanonicalTimestamp(metadata.changedAt, 'changedAt'),
    })
  }
  throw new Error('L’état des métadonnées du slot cloud HGSS est invalide.')
}

/**
 * Registre privé à deux entrées. `campaign.slot` est toujours présent ;
 * `campaign.full` existe seulement lorsqu'un document data-only occupe le slot.
 */
const hgssFullSaveRegistry = createPortableStateRegistry<
  HgssFullSaveProjectionContext,
  HgssFullSaveHydrationDraft
>([
  definePortableStateContributor<
    HgssFullSaveProjectionContext,
    HgssFullSaveHydrationDraft,
    JsonSaveValue
  >({
    key: hgssFullSaveContributorKey,
    version: hgssFullSaveContributorVersion,
    project: ({ snapshot }) => snapshot.kind === 'present'
      ? snapshot.document as unknown as JsonSaveValue
      : undefined,
    decode: (value) => hgssDataOnlySaveAuthority.decode(value) as unknown as JsonSaveValue,
    hydrate: (draft, value) => {
      draft.document = hgssDataOnlySaveAuthority.decode(value)
    },
  }),
  definePortableStateContributor<
    HgssFullSaveProjectionContext,
    HgssFullSaveHydrationDraft,
    JsonSaveValue
  >({
    key: hgssCloudSlotContributorKey,
    version: hgssCloudSlotContributorVersion,
    project: ({ snapshot }) => metadataForSnapshot(snapshot) as unknown as JsonSaveValue,
    decode: (value) => decodeMetadata(value) as unknown as JsonSaveValue,
    hydrate: (draft, value) => {
      draft.metadata = decodeMetadata(value)
    },
  }),
])

function projectSnapshot(snapshot: HgssFullSaveCloudSnapshot): PortableStateDocument {
  return hgssFullSaveRegistry.project({ snapshot: normalizeSnapshot(snapshot) })
}

function extractSnapshot(document: PortableStateDocument): HgssFullSaveCloudSnapshot {
  const draft: HgssFullSaveHydrationDraft = {}
  hgssFullSaveRegistry.hydrateDraft(draft, document)
  const metadata = draft.metadata
  if (!metadata) throw new Error('Le coffre cloud ne contient pas les métadonnées du slot HGSS.')
  if (metadata.kind === 'deleted') {
    if (draft.document) {
      throw new Error('Un slot cloud HGSS supprimé ne peut pas contenir une sauvegarde complète.')
    }
    return normalizeSnapshot({
      kind: 'deleted',
      slot: metadata.slot,
      romIdentity: metadata.romIdentity,
      changedAt: metadata.changedAt,
    })
  }
  if (!draft.document) {
    throw new Error('Un slot cloud HGSS présent doit contenir une sauvegarde complète.')
  }
  return normalizeSnapshot({
    kind: 'present',
    slot: metadata.slot,
    romIdentity: metadata.romIdentity,
    savedAt: metadata.savedAt,
    saveKind: metadata.saveKind,
    document: draft.document,
  })
}

function resolveWebCrypto(): Crypto {
  const candidate = globalThis.crypto
  if (!candidate?.subtle) throw new Error('Web Crypto est indisponible pour le coffre HGSS.')
  return candidate
}

function assertExportableAesKey(key: CryptoKey): void {
  try {
    const algorithm = key.algorithm as KeyAlgorithm & { length?: unknown }
    if (
      key.type !== 'secret'
      || algorithm.name !== 'AES-GCM'
      || algorithm.length !== 256
      || !key.extractable
    ) {
      throw new Error('invalid-key')
    }
  } catch {
    throw new Error('La dérivation d’objet cloud exige une clé AES-GCM 256 bits exportable.')
  }
}

function encodeBase64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function encodeObjectIdContext(
  romIdentity: HgssFullSaveCloudRomIdentity,
  slot: HgssBrowserSaveSlot,
): Uint8Array<ArrayBuffer> {
  return textEncoder.encode(JSON.stringify([
    HGSS_FULL_SAVE_CLOUD_OBJECT_ID_DERIVATION.protocol,
    romIdentity.gameVersion,
    romIdentity.language,
    slot,
  ]))
}

/**
 * Dérive l'identifiant serveur opaque et stable d'un slot sans exposer son label.
 * Les 128 premiers bits de HMAC-SHA256 restent séparés par version, ROM et slot.
 */
export async function deriveHgssFullSaveCloudObjectId(
  key: CryptoKey,
  romIdentityValue: HgssFullSaveCloudRomIdentity,
  slotValue: HgssBrowserSaveSlot,
): Promise<HgssFullSaveCloudObjectId> {
  assertExportableAesKey(key)
  const cryptoApi = resolveWebCrypto()
  const romIdentity = requireRomIdentity(romIdentityValue)
  const slot = requireSlot(slotValue)
  const context = encodeObjectIdContext(romIdentity, slot)
  let rawKey: Uint8Array<ArrayBuffer> | undefined
  let signature: Uint8Array<ArrayBuffer> | undefined
  try {
    rawKey = new Uint8Array(await cryptoApi.subtle.exportKey('raw', key))
    if (rawKey.byteLength !== aesKeyBytes) {
      throw new Error('La clé AES-GCM du coffre HGSS doit contenir exactement 256 bits.')
    }
    const hmacKey = await cryptoApi.subtle.importKey(
      'raw',
      rawKey,
      { name: HGSS_FULL_SAVE_CLOUD_OBJECT_ID_DERIVATION.algorithm, hash: HGSS_FULL_SAVE_CLOUD_OBJECT_ID_DERIVATION.hash },
      false,
      ['sign'],
    )
    signature = new Uint8Array(await cryptoApi.subtle.sign('HMAC', hmacKey, context))
    const objectId = encodeBase64Url(signature.subarray(0, derivedObjectIdBytes))
    if (!/^[A-Za-z0-9_-]{21}[AQgw]$/.test(objectId)) {
      throw new Error("La dérivation de l'identifiant opaque du slot HGSS a échoué.")
    }
    return objectId as HgssFullSaveCloudObjectId
  } finally {
    context.fill(0)
    rawKey?.fill(0)
    signature?.fill(0)
  }
}

export type HgssFullSaveCloudStoredSnapshot = Readonly<{
  snapshot: HgssFullSaveCloudSnapshot
  etag: CloudEtag
  mutation: PortableCloudStoredDocument['mutation']
}>

export class HgssFullSaveCloudCorruptObjectError extends Error {
  readonly slot: HgssBrowserSaveSlot
  readonly etag: CloudEtag
  readonly mutation?: PortableCloudStoredDocument['mutation']

  constructor(
    slot: HgssBrowserSaveSlot,
    etag: CloudEtag,
    cause: unknown,
    mutation?: PortableCloudStoredDocument['mutation'],
  ) {
    super(`L’objet cloud de l’emplacement ${slot} est illisible.`, { cause })
    this.name = 'HgssFullSaveCloudCorruptObjectError'
    this.slot = slot
    this.etag = etag
    this.mutation = mutation
  }
}

export type HgssFullSaveCloudVaultClient = Readonly<{
  get: (
    key: CryptoKey,
    romIdentity: HgssFullSaveCloudRomIdentity,
    slot: HgssBrowserSaveSlot,
    signal?: AbortSignal,
  ) => Promise<HgssFullSaveCloudStoredSnapshot | undefined>
  create: (
    key: CryptoKey,
    snapshot: HgssFullSaveCloudSnapshot,
    signal?: AbortSignal,
  ) => Promise<CloudWriteResult>
  replace: (
    key: CryptoKey,
    etag: CloudEtag,
    snapshot: HgssFullSaveCloudSnapshot,
    signal?: AbortSignal,
  ) => Promise<CloudWriteResult>
  /** Suppression physique réservée au compactage ; une suppression métier écrit un tombstone. */
  purge: (
    key: CryptoKey,
    romIdentity: HgssFullSaveCloudRomIdentity,
    slot: HgssBrowserSaveSlot,
    etag: CloudEtag,
    signal?: AbortSignal,
  ) => Promise<void>
}>

export type HgssFullSaveCloudVaultClientOptions = Omit<
  PortableCloudVaultClientOptions<HgssFullSaveProjectionContext, HgssFullSaveHydrationDraft>,
  'registry'
>

/**
 * Façade cloud complète d'un slot HGSS. L'identifiant opaque est toujours
 * dérivé dans cette frontière et le transport n'accepte qu'un snapshot exact.
 */
export function createHgssFullSaveCloudVaultClient(
  options: HgssFullSaveCloudVaultClientOptions,
): HgssFullSaveCloudVaultClient {
  const portable = createPortableCloudVaultClient({ ...options, registry: hgssFullSaveRegistry })

  return Object.freeze({
    async get(key, romIdentityValue, slotValue, signal) {
      const romIdentity = requireRomIdentity(romIdentityValue)
      const slot = requireSlot(slotValue)
      const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, slot)
      let stored: Awaited<ReturnType<typeof portable.get>>
      try {
        stored = await portable.get(objectId, key, signal)
      } catch (error) {
        if (error instanceof PortableCloudCorruptObjectError) {
          throw new HgssFullSaveCloudCorruptObjectError(slot, error.etag, error, error.mutation)
        }
        throw error
      }
      if (!stored) return undefined
      try {
        const snapshot = extractSnapshot(stored.document)
        if (snapshot.slot !== slot || !identitiesMatch(snapshot.romIdentity, romIdentity)) {
          throw new Error("Le snapshot cloud HGSS ne correspond pas à l'objet de slot demandé.")
        }
        return Object.freeze({ snapshot, etag: stored.etag, mutation: stored.mutation })
      } catch (error) {
        throw new HgssFullSaveCloudCorruptObjectError(slot, stored.etag, error, stored.mutation)
      }
    },
    async create(key, snapshotValue, signal) {
      const snapshot = normalizeSnapshot(snapshotValue)
      const objectId = await deriveHgssFullSaveCloudObjectId(key, snapshot.romIdentity, snapshot.slot)
      return portable.create(objectId, key, projectSnapshot(snapshot), signal)
    },
    async replace(key, etag, snapshotValue, signal) {
      const snapshot = normalizeSnapshot(snapshotValue)
      const objectId = await deriveHgssFullSaveCloudObjectId(key, snapshot.romIdentity, snapshot.slot)
      return portable.replace(objectId, etag, key, projectSnapshot(snapshot), signal)
    },
    async purge(key, romIdentityValue, slotValue, etag, signal) {
      const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentityValue, slotValue)
      return portable.delete(objectId, etag, signal)
    },
  })
}
