import { describe, expect, it, vi } from 'vitest'
import {
  createOpaqueVaultContext,
  generateOpaqueVaultKey,
  openOpaqueJson,
} from '../../online/opaqueJsonVault'
import {
  OPAQUE_VAULT_MEDIA_TYPE,
  type OpaqueObjectId,
  type OpaqueVaultEtag,
} from '../../online/opaqueVaultHttpClient'
import {
  createPortableCloudVaultClient,
  PortableCloudCorruptObjectError,
  sealPortableStateDocumentForCloud,
} from './portableCloudVault'
import {
  createPortableStateRegistry,
  definePortableStateContributor,
  isPortableStateDocument,
  type PortableStateDocument,
} from './portableStateRegistry'

type ProjectContext = {
  counter: number
  romResolvedText: string
}

type CounterState = Readonly<{ count: number }>

const objectId = 'AAAAAAAAAAAAAAAAAAAAAA' as OpaqueObjectId
const etag = `"r-${'a'.repeat(32)}"` as OpaqueVaultEtag
const mutation = `m-${'1'.repeat(32)}`
const config = {
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
}
const protectedCanary = 'ROM_LOCAL_TEXT_CANARY_MUST_NEVER_REACH_THE_VPS'

function counterRegistry() {
  return createPortableStateRegistry([
    definePortableStateContributor<ProjectContext, ProjectContext, CounterState>({
      key: 'progress.counter',
      version: 1,
      project: ({ counter }) => ({ count: counter }),
      decode: (value) => {
        if (
          value === null
          || typeof value !== 'object'
          || Array.isArray(value)
          || Object.keys(value).length !== 1
          || !('count' in value)
          || !Number.isSafeInteger(value.count)
        ) throw new Error('invalid counter')
        return Object.freeze({ count: value.count as number })
      },
      hydrate: (context, value) => {
        context.counter = value.count
      },
    }),
  ])
}

describe('façade portable du coffre cloud', () => {
  it('projette, atteste, chiffre puis envoie uniquement l’enveloppe opaque', async () => {
    const registry = counterRegistry()
    const document = registry.project({ counter: 7, romResolvedText: protectedCanary })
    const key = await generateOpaqueVaultKey()
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, {
        status: 201,
        headers: { ETag: etag, 'Opaque-Mutation': mutation },
      }))
    const client = createPortableCloudVaultClient({
      config,
      registry,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => 'alice',
      fetch,
    })

    await expect(client.create(objectId, key, document)).resolves.toEqual({ created: true, etag, mutation })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [, request] = fetch.mock.calls[0]!
    const body = String(request?.body)
    const wireEnvelope = JSON.parse(body) as unknown
    expect(body).not.toContain(protectedCanary)
    expect(body).not.toContain('romResolvedText')
    expect(Object.keys(wireEnvelope as object).sort()).toEqual(['algorithm', 'ciphertext', 'iv', 'version'])
    await expect(openOpaqueJson(
      key,
      wireEnvelope,
      createOpaqueVaultContext('alice', objectId),
    )).resolves.toEqual({
      format: 'portable-state',
      version: 1,
      entries: { 'progress.counter': { version: 1, value: { count: 7 } } },
    })
  })

  it('refuse une sauvegarde brute ou une copie JSON avant fetch', async () => {
    const registry = counterRegistry()
    const document = registry.project({ counter: 3, romResolvedText: protectedCanary })
    const foreignDocument = counterRegistry().project({ counter: 4, romResolvedText: protectedCanary })
    const copiedDocument = structuredClone(document) as PortableStateDocument
    const rawSave = {
      format: 'portable-state',
      version: 1,
      entries: {},
      romResolvedText: protectedCanary,
    } as unknown as PortableStateDocument
    const key = await generateOpaqueVaultKey()
    const fetch = vi.fn()
    const client = createPortableCloudVaultClient({
      config,
      registry,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => 'alice',
      fetch,
    })

    expect(isPortableStateDocument(document)).toBe(true)
    expect(isPortableStateDocument(foreignDocument)).toBe(true)
    expect(registry.owns(foreignDocument)).toBe(false)
    expect(isPortableStateDocument(copiedDocument)).toBe(false)
    await expect(client.create(objectId, key, foreignDocument)).rejects.toThrow('registre allowlisté')
    await expect(client.create(objectId, key, copiedDocument)).rejects.toThrow('registre allowlisté')
    await expect(client.create(objectId, key, rawSave)).rejects.toThrow('registre allowlisté')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('déchiffre une lecture distante puis la redécode par le registre exact', async () => {
    const registry = counterRegistry()
    const key = await generateOpaqueVaultKey()
    const document = registry.project({ counter: 11, romResolvedText: protectedCanary })
    const envelope = await sealPortableStateDocumentForCloud(key, document, 'alice', objectId, registry)
    const client = createPortableCloudVaultClient({
      config,
      registry,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag, 'Opaque-Mutation': mutation },
      }),
    })

    const stored = await client.get(objectId, key)

    expect(stored?.etag).toBe(etag)
    expect(stored?.mutation).toBe(mutation)
    expect(stored?.document).toEqual(document)
    expect(isPortableStateDocument(stored?.document)).toBe(true)
    expect(JSON.stringify(stored?.document)).not.toContain(protectedCanary)
  })

  it('préserve l’ETag d’un objet distant indéchiffrable pour sa réparation explicite', async () => {
    const registry = counterRegistry()
    const sealingKey = await generateOpaqueVaultKey()
    const wrongKey = await generateOpaqueVaultKey()
    const document = registry.project({ counter: 12, romResolvedText: protectedCanary })
    const envelope = await sealPortableStateDocumentForCloud(
      sealingKey,
      document,
      'alice',
      objectId,
      registry,
    )
    const client = createPortableCloudVaultClient({
      config,
      registry,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag, 'Opaque-Mutation': mutation },
      }),
    })

    await expect(client.get(objectId, wrongKey)).rejects.toMatchObject({
      name: 'PortableCloudCorruptObjectError',
      objectId,
      etag,
    })
  })

  it('ne maquille pas une identité de session absente en objet distant corrompu', async () => {
    const registry = counterRegistry()
    const key = await generateOpaqueVaultKey()
    const document = registry.project({ counter: 13, romResolvedText: protectedCanary })
    const envelope = await sealPortableStateDocumentForCloud(key, document, 'alice', objectId, registry)
    const client = createPortableCloudVaultClient({
      config,
      registry,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => undefined,
      fetch: async () => new Response(JSON.stringify(envelope), {
        status: 200,
        headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag, 'Opaque-Mutation': mutation },
      }),
    })

    try {
      await client.get(objectId, key)
      throw new Error('Erreur d’identité attendue.')
    } catch (error) {
      expect(error).not.toBeInstanceOf(PortableCloudCorruptObjectError)
      expect(error).toMatchObject({ message: expect.stringContaining('Identité en ligne absente') })
    }
  })
})
