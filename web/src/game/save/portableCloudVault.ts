import type { OnlineClientConfig } from '../../online/onlineClientConfig'
import {
  attestSealedOpaqueVaultEnvelopeForPortableCloud,
  createOpaqueVaultContext,
  openOpaqueJson,
  OpaqueJsonVaultError,
  sealOpaqueJson,
  type CloudSafeSealedOpaqueVaultEnvelope,
  type OpaqueVaultEnvelope,
} from '../../online/opaqueJsonVault'
import {
  createOpaqueVaultHttpClient,
  type OpaqueObjectId,
  type OpaqueVaultEtag,
  type OpaqueVaultMutation,
  type OpaqueVaultHttpClientOptions,
  type OpaqueVaultWriteResult,
} from '../../online/opaqueVaultHttpClient'
import {
  isPortableStateDocument,
  type PortableStateDocument,
  type PortableStateRegistry,
} from './portableStateRegistry'

export type PortableCloudStoredDocument = Readonly<{
  document: PortableStateDocument
  etag: OpaqueVaultEtag
  mutation: OpaqueVaultMutation
}>

export class PortableCloudCorruptObjectError extends Error {
  readonly objectId: OpaqueObjectId
  readonly etag: OpaqueVaultEtag
  readonly mutation?: OpaqueVaultMutation

  constructor(
    objectId: OpaqueObjectId,
    etag: OpaqueVaultEtag,
    cause: unknown,
    mutation?: OpaqueVaultMutation,
  ) {
    super('L’objet cloud chiffré est illisible ou incompatible.', { cause })
    this.name = 'PortableCloudCorruptObjectError'
    this.objectId = objectId
    this.etag = etag
    this.mutation = mutation
  }
}

export type PortableCloudVaultClient = Readonly<{
  get: (
    objectId: OpaqueObjectId,
    key: CryptoKey,
    signal?: AbortSignal,
  ) => Promise<PortableCloudStoredDocument | undefined>
  create: (
    objectId: OpaqueObjectId,
    key: CryptoKey,
    document: PortableStateDocument,
    signal?: AbortSignal,
  ) => Promise<OpaqueVaultWriteResult>
  replace: (
    objectId: OpaqueObjectId,
    etag: OpaqueVaultEtag,
    key: CryptoKey,
    document: PortableStateDocument,
    signal?: AbortSignal,
  ) => Promise<OpaqueVaultWriteResult>
  delete: (
    objectId: OpaqueObjectId,
    etag: OpaqueVaultEtag,
    signal?: AbortSignal,
  ) => Promise<void>
}>

export type PortableCloudVaultClientOptions<TProjectContext, THydrateContext> = OpaqueVaultHttpClientOptions & Readonly<{
  config: OnlineClientConfig
  registry: PortableStateRegistry<TProjectContext, THydrateContext>
}>

function requireOwnerId(readOwnerId: () => string | undefined): string {
  const ownerId = readOwnerId()
  if (typeof ownerId !== 'string') throw new Error('Identité en ligne absente ou invalide.')
  return ownerId
}

/** Seul ce point transforme un document allowlisté en enveloppe autorisée pour HTTP. */
export async function sealPortableStateDocumentForCloud<TProjectContext, THydrateContext>(
  key: CryptoKey,
  document: PortableStateDocument,
  ownerId: string,
  objectId: OpaqueObjectId,
  registry: PortableStateRegistry<TProjectContext, THydrateContext>,
): Promise<CloudSafeSealedOpaqueVaultEnvelope> {
  if (!isPortableStateDocument(document) || !registry.owns(document)) {
    throw new Error('Le document portable ne provient pas du registre allowlisté attendu.')
  }
  const context = createOpaqueVaultContext(ownerId, objectId)
  const envelope = await sealOpaqueJson(key, document, context)
  return attestSealedOpaqueVaultEnvelopeForPortableCloud(envelope, ownerId, objectId)
}

/** Déchiffre puis repasse obligatoirement par le décodeur exact du registre. */
export async function openPortableStateDocumentFromCloud<TProjectContext, THydrateContext>(
  key: CryptoKey,
  envelope: OpaqueVaultEnvelope,
  ownerId: string,
  objectId: OpaqueObjectId,
  registry: PortableStateRegistry<TProjectContext, THydrateContext>,
): Promise<PortableStateDocument> {
  const opened = await openOpaqueJson(key, envelope, createOpaqueVaultContext(ownerId, objectId))
  const document = registry.decode(opened)
  if (!isPortableStateDocument(document) || !registry.owns(document)) {
    throw new Error('Le décodeur n’a pas produit de document portable attesté.')
  }
  return document
}

/** Façade unique pour empêcher le gameplay de combiner directement codec et transport. */
export function createPortableCloudVaultClient<TProjectContext, THydrateContext>(
  options: PortableCloudVaultClientOptions<TProjectContext, THydrateContext>,
): PortableCloudVaultClient {
  const http = createOpaqueVaultHttpClient(options)

  return Object.freeze({
    async get(objectId, key, signal) {
      const stored = await http.get(objectId, signal)
      if (!stored) return undefined
      const ownerId = requireOwnerId(options.readOwnerId)
      try {
        const document = await openPortableStateDocumentFromCloud(
          key,
          stored.envelope,
          ownerId,
          objectId,
          options.registry,
        )
        return Object.freeze({ document, etag: stored.etag, mutation: stored.mutation })
      } catch (error) {
        if (signal?.aborted) throw new DOMException('Lecture cloud annulée.', 'AbortError')
        if (error instanceof OpaqueJsonVaultError && (
          error.code === 'crypto-unavailable'
          || error.code === 'invalid-key'
          || error.code === 'invalid-context'
        )) throw error
        throw new PortableCloudCorruptObjectError(objectId, stored.etag, error, stored.mutation)
      }
    },
    async create(objectId, key, document, signal) {
      const envelope = await sealPortableStateDocumentForCloud(
        key,
        document,
        requireOwnerId(options.readOwnerId),
        objectId,
        options.registry,
      )
      return http.create(objectId, envelope, signal)
    },
    async replace(objectId, etag, key, document, signal) {
      const envelope = await sealPortableStateDocumentForCloud(
        key,
        document,
        requireOwnerId(options.readOwnerId),
        objectId,
        options.registry,
      )
      return http.replace(objectId, etag, envelope, signal)
    },
    delete: (objectId, etag, signal) => http.delete(objectId, etag, signal),
  })
}
