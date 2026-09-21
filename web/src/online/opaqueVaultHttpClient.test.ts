import { describe, expect, it, vi } from 'vitest'
import {
  attestSealedOpaqueVaultEnvelopeForPortableCloud,
  createOpaqueVaultContext,
  generateOpaqueVaultKey,
  sealOpaqueJson,
  type CloudSafeSealedOpaqueVaultEnvelope,
  type OpaqueVaultEnvelope,
} from './opaqueJsonVault'
import {
  OPAQUE_VAULT_HTTP_LIMITS,
  OPAQUE_VAULT_MEDIA_TYPE,
  OpaqueVaultProtocolError,
  OpaqueVaultServiceError,
  createOpaqueVaultHttpClient,
  generateOpaqueObjectId,
  parseOpaqueObjectId,
  parseOpaqueVaultEtag,
  parseOpaqueVaultMutation,
  type OpaqueObjectId,
  type OpaqueVaultEtag,
  type OpaqueVaultMutation,
} from './opaqueVaultHttpClient'

const config = {
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
}
const objectId = 'AAAAAAAAAAAAAAAAAAAAAA' as OpaqueObjectId
const otherObjectId = `${'A'.repeat(21)}Q` as OpaqueObjectId
const etag = `"r-${'a'.repeat(32)}"` as OpaqueVaultEtag
const nextEtag = `"r-${'b'.repeat(32)}"` as OpaqueVaultEtag
const mutation = `m-${'1'.repeat(32)}` as OpaqueVaultMutation
const envelope: OpaqueVaultEnvelope = Object.freeze({
  version: 1,
  algorithm: 'A256GCM',
  iv: 'AAAAAAAAAAAAAAAA',
  ciphertext: 'AAAAAAAAAAAAAAAAAAAAAA',
})

async function sealedEnvelope(ownerId = 'alice', id = objectId): Promise<CloudSafeSealedOpaqueVaultEnvelope> {
  const sealed = await sealOpaqueJson(
    await generateOpaqueVaultKey(),
    { value: 'opaque' },
    createOpaqueVaultContext(ownerId, id),
  )
  return attestSealedOpaqueVaultEnvelopeForPortableCloud(sealed, ownerId, id)
}

function successEnvelopeResponse(
  value: unknown = envelope,
  revision = etag,
  logicalMutation: string = mutation,
): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: {
      'Content-Type': OPAQUE_VAULT_MEDIA_TYPE,
      ETag: revision,
      ...(logicalMutation ? { 'Opaque-Mutation': logicalMutation } : {}),
    },
  })
}

function emptyResponse(status: 201 | 204, revision?: string, logicalMutation: string = mutation): Response {
  return new Response(null, {
    status,
    headers: revision === undefined
      ? undefined
      : { ETag: revision, ...(logicalMutation ? { 'Opaque-Mutation': logicalMutation } : {}) },
  })
}

function errorResponse(status: number, code: string, message = 'refusé'): Response {
  return new Response(JSON.stringify({ error: { code, message }, requestId: 'req-1' }), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function deferredResponse() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>((accept) => { resolve = accept })
  return { promise, resolve }
}

describe('identifiants opaques distants', () => {
  it('génère uniquement des identifiants aléatoires canoniques de 128 bits', () => {
    const first = generateOpaqueObjectId()
    const second = generateOpaqueObjectId()

    expect(first).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/)
    expect(parseOpaqueObjectId(first)).toBe(first)
    expect(second).not.toBe(first)
  })

  it.each([
    '',
    'slot-principal',
    'A'.repeat(21),
    'A'.repeat(23),
    `${'A'.repeat(21)}B`,
    `${'A'.repeat(21)}=`,
  ])('refuse un identifiant libre, mal dimensionné ou non canonique (%s)', (value) => {
    expect(parseOpaqueObjectId(value)).toBeUndefined()
  })

  it('accepte uniquement les ETag forts exacts émis par le serveur', () => {
    expect(parseOpaqueVaultEtag(etag)).toBe(etag)
    expect(parseOpaqueVaultEtag(`r-${'a'.repeat(32)}`)).toBeUndefined()
    expect(parseOpaqueVaultEtag(`W/${etag}`)).toBeUndefined()
    expect(parseOpaqueVaultEtag(`"r-${'A'.repeat(32)}"`)).toBeUndefined()
  })

  it('accepte uniquement l horloge logique opaque exacte émise par le serveur', () => {
    expect(parseOpaqueVaultMutation(mutation)).toBe(mutation)
    expect(parseOpaqueVaultMutation(`"${mutation}"`)).toBeUndefined()
    expect(parseOpaqueVaultMutation(`m-${'A'.repeat(32)}`)).toBeUndefined()
  })
})

describe('client HTTP du coffre opaque', () => {
  it('lit une enveloppe exacte avec son ETag et les options réseau restrictives', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(successEnvelopeResponse())
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'runtime-token',
      readOwnerId: () => 'alice',
      fetch,
    })

    const stored = await client.get(objectId)

    expect(stored).toEqual({ envelope, etag, mutation })
    expect(Object.isFrozen(stored)).toBe(true)
    expect(Object.isFrozen(stored?.envelope)).toBe(true)
    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = fetch.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(url).toBe(`https://online.example.com/v1/objects/${objectId}`)
    expect(init).toMatchObject({
      method: 'GET', cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer', redirect: 'error',
    })
    expect(headers.get('Authorization')).toBe('Bearer runtime-token')
    expect(headers.get('Accept')).toBe(`${OPAQUE_VAULT_MEDIA_TYPE}, application/json`)
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('propage strictement l horloge de mutation des lectures et écritures', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValueOnce(successEnvelopeResponse(envelope, etag, mutation))
      .mockResolvedValueOnce(emptyResponse(201, nextEtag, mutation))
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch,
    })

    await expect(client.get(objectId)).resolves.toEqual({ envelope, etag, mutation })
    await expect(client.create(objectId, await sealedEnvelope())).resolves.toEqual({
      created: true,
      etag: nextEtag,
      mutation,
    })

    const malformed = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => successEnvelopeResponse(envelope, etag, 'clock-libre'),
    })
    await expect(malformed.get(objectId)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)
  })

  it('retourne undefined uniquement pour une absence distante structurée', async () => {
    const missing = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => errorResponse(404, 'NOT_FOUND'),
    })
    await expect(missing.get(objectId)).resolves.toBeUndefined()

    const malformed = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => errorResponse(404, 'OTHER'),
    })
    await expect(malformed.get(objectId)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)
  })

  it('crée avec If-None-Match puis retourne la nouvelle révision', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(emptyResponse(201, etag))
    const client = createOpaqueVaultHttpClient({ config, readAccessToken: () => 'token', readOwnerId: () => 'alice', fetch })
    const locallySealed = await sealedEnvelope()

    await expect(client.create(objectId, locallySealed)).resolves.toEqual({ created: true, etag, mutation })
    const [, init] = fetch.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(init?.method).toBe('PUT')
    expect(init?.keepalive).toBe(true)
    expect(headers.get('Content-Type')).toBe(OPAQUE_VAULT_MEDIA_TYPE)
    expect(headers.get('If-None-Match')).toBe('*')
    expect(headers.has('If-Match')).toBe(false)
    expect(JSON.parse(String(init?.body))).toEqual(locallySealed)
  })

  it('remplace avec If-Match et exige le statut de remplacement', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(emptyResponse(204, nextEtag))
    const client = createOpaqueVaultHttpClient({ config, readAccessToken: () => 'token', readOwnerId: () => 'alice', fetch })
    const locallySealed = await sealedEnvelope()

    await expect(client.replace(objectId, etag, locallySealed)).resolves.toEqual({ created: false, etag: nextEtag, mutation })
    const headers = new Headers(fetch.mock.calls[0]![1]?.headers)
    expect(headers.get('If-Match')).toBe(etag)
    expect(headers.has('If-None-Match')).toBe(false)

    const wrongStatus = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => emptyResponse(201, nextEtag),
    })
    await expect(wrongStatus.replace(objectId, etag, locallySealed)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)
  })

  it('supprime avec une révision forte, sans corps ni Content-Type', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(emptyResponse(204))
    const client = createOpaqueVaultHttpClient({ config, readAccessToken: () => 'token', readOwnerId: () => 'alice', fetch })

    await expect(client.delete(objectId, etag)).resolves.toBeUndefined()
    const [, init] = fetch.mock.calls[0]!
    const headers = new Headers(init?.headers)
    expect(init?.method).toBe('DELETE')
    expect(init?.keepalive).toBe(true)
    expect(init?.body).toBeUndefined()
    expect(headers.get('If-Match')).toBe(etag)
    expect(headers.has('Content-Type')).toBe(false)
  })

  it('expose explicitement un conflit de révision structuré', async () => {
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => errorResponse(412, 'PRECONDITION_FAILED', 'revision mismatch'),
    })
    const locallySealed = await sealedEnvelope()

    let failure: unknown
    try {
      await client.replace(objectId, etag, locallySealed)
    } catch (error) {
      failure = error
    }
    expect(failure).toMatchObject({
      status: 412, code: 'PRECONDITION_FAILED', requestId: 'req-1', isConflict: true,
    } satisfies Partial<OpaqueVaultServiceError>)
  })

  it('refuse une session absente ou un identifiant forgé avant tout appel réseau', async () => {
    const fetch = vi.fn()
    const missingToken = createOpaqueVaultHttpClient({ config, readAccessToken: () => undefined, readOwnerId: () => 'alice', fetch })
    await expect(missingToken.get(objectId)).rejects.toThrow('Session du compte')

    const validToken = createOpaqueVaultHttpClient({ config, readAccessToken: () => 'token', readOwnerId: () => 'alice', fetch })
    await expect(validToken.get('slot-principal' as OpaqueObjectId)).rejects.toThrow('Identifiant')
    await expect(validToken.delete(objectId, 'revision-libre' as OpaqueVaultEtag)).rejects.toThrow('Révision')
    expect(fetch).not.toHaveBeenCalled()
  })

  it.each([
    ['mauvais type de contenu', new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': 'application/json', ETag: etag } })],
    ['ETag absent', new Response(JSON.stringify(envelope), { status: 200, headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE } })],
    ['horloge logique absente', new Response(JSON.stringify(envelope), {
      status: 200,
      headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag },
    })],
    ['enveloppe avec champ supplémentaire', successEnvelopeResponse({ ...envelope, extra: true })],
    ['JSON invalide', new Response('{', { status: 200, headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag } })],
    ['UTF-8 invalide', new Response(new Uint8Array([0xff]), { status: 200, headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag } })],
  ])('échoue fermé face à une réponse de succès non conforme : %s', async (_label, response) => {
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => response,
    })
    await expect(client.get(objectId)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)
  })

  it('refuse une erreur distante dont la forme ou le type MIME ne suit pas le contrat', async () => {
    const wrongShape = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'non' } }), {
        status: 403,
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
      }),
    })
    await expect(wrongShape.get(objectId)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)

    const wrongType = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response(JSON.stringify({ error: { code: 'FORBIDDEN', message: 'non' }, requestId: 'req-1' }), {
        status: 403,
        headers: { 'Content-Type': 'text/plain' },
      }),
    })
    await expect(wrongType.get(objectId)).rejects.toBeInstanceOf(OpaqueVaultProtocolError)
  })

  it('borne la réponse par Content-Length et par les octets réellement lus', async () => {
    const declared = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response('{}', {
        status: 200,
        headers: {
          'Content-Type': OPAQUE_VAULT_MEDIA_TYPE,
          'Content-Length': String(OPAQUE_VAULT_HTTP_LIMITS.responseBytes + 1),
          ETag: etag,
        },
      }),
    })
    await expect(declared.get(objectId)).rejects.toThrow('trop volumineuse')

    const streamed = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch: async () => new Response('x'.repeat(OPAQUE_VAULT_HTTP_LIMITS.responseBytes + 1), {
        status: 200,
        headers: { 'Content-Type': OPAQUE_VAULT_MEDIA_TYPE, ETag: etag },
      }),
    })
    await expect(streamed.get(objectId)).rejects.toThrow('trop volumineuse')
  })

  it('refuse une enveloppe locale non exacte avant de lancer PUT', async () => {
    const fetch = vi.fn()
    const client = createOpaqueVaultHttpClient({ config, readAccessToken: () => 'token', readOwnerId: () => 'alice', fetch })
    const malformed = { ...await sealedEnvelope(), extra: true } as unknown as CloudSafeSealedOpaqueVaultEnvelope

    await expect(client.create(objectId, malformed)).rejects.toThrow('Enveloppe')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('réserve keepalive aux écritures assez petites pour la limite du navigateur', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(emptyResponse(201, etag))
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch,
    })
    const largeSealed = attestSealedOpaqueVaultEnvelopeForPortableCloud(
      await sealOpaqueJson(
        await generateOpaqueVaultKey(),
        { value: 'x'.repeat(70 * 1024) },
        createOpaqueVaultContext('alice', objectId),
      ),
      'alice',
      objectId,
    )

    await client.create(objectId, largeSealed)

    expect(String(fetch.mock.calls[0]![1]?.body).length).toBeGreaterThan(
      OPAQUE_VAULT_HTTP_LIMITS.keepaliveBodyBytes,
    )
    expect(fetch.mock.calls[0]![1]?.keepalive).toBeUndefined()
  })

  it('applique le quota keepalive au cumul des corps encore en vol', async () => {
    const firstResponse = deferredResponse()
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockImplementationOnce(() => firstResponse.promise)
      .mockResolvedValueOnce(emptyResponse(201, nextEtag))
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch,
    })
    const mediumValue = { value: 'x'.repeat(30 * 1024) }
    const firstEnvelope = attestSealedOpaqueVaultEnvelopeForPortableCloud(
      await sealOpaqueJson(await generateOpaqueVaultKey(), mediumValue, createOpaqueVaultContext('alice', objectId)),
      'alice',
      objectId,
    )
    const secondEnvelope = attestSealedOpaqueVaultEnvelopeForPortableCloud(
      await sealOpaqueJson(await generateOpaqueVaultKey(), mediumValue, createOpaqueVaultContext('alice', otherObjectId)),
      'alice',
      otherObjectId,
    )

    const firstWrite = client.create(objectId, firstEnvelope)
    while (fetch.mock.calls.length < 1) await Promise.resolve()
    const secondWrite = client.create(otherObjectId, secondEnvelope)
    while (fetch.mock.calls.length < 2) await Promise.resolve()

    expect(fetch.mock.calls[0]![1]?.keepalive).toBe(true)
    expect(fetch.mock.calls[1]![1]?.keepalive).toBeUndefined()
    firstResponse.resolve(emptyResponse(201, etag))
    await expect(Promise.all([firstWrite, secondWrite])).resolves.toEqual([
      { created: true, etag, mutation },
      { created: true, etag: nextEtag, mutation },
    ])
  })

  it('rend le budget keepalive après un rejet réseau', async () => {
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockRejectedValueOnce(new TypeError('network down'))
      .mockResolvedValueOnce(emptyResponse(201, etag))
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch,
    })
    const sealed = attestSealedOpaqueVaultEnvelopeForPortableCloud(
      await sealOpaqueJson(
        await generateOpaqueVaultKey(),
        { value: 'x'.repeat(30 * 1024) },
        createOpaqueVaultContext('alice', objectId),
      ),
      'alice',
      objectId,
    )

    await expect(client.create(objectId, sealed)).rejects.toThrow('network down')
    await expect(client.create(objectId, sealed)).resolves.toEqual({ created: true, etag, mutation })

    expect(fetch.mock.calls[0]![1]?.keepalive).toBe(true)
    expect(fetch.mock.calls[1]![1]?.keepalive).toBe(true)
  })

  it('refuse une écriture sans provenance AAD ou liée à un autre compte ou objet', async () => {
    const fetch = vi.fn()
    const client = createOpaqueVaultHttpClient({
      config,
      readAccessToken: () => 'token',
      readOwnerId: () => 'alice',
      fetch,
    })
    const copiedWithoutProvenance = { ...await sealedEnvelope() } as CloudSafeSealedOpaqueVaultEnvelope
    const genericOnly = await sealOpaqueJson(
      await generateOpaqueVaultKey(),
      { raw: 'not-portable' },
      createOpaqueVaultContext('alice', objectId),
    ) as CloudSafeSealedOpaqueVaultEnvelope
    const sealedForAnotherOwner = await sealedEnvelope('bob')
    const sealedForAnotherObject = await sealedEnvelope('alice', otherObjectId)

    await expect(client.create(objectId, copiedWithoutProvenance)).rejects.toThrow('Enveloppe')
    await expect(client.create(objectId, genericOnly)).rejects.toThrow('Enveloppe')
    await expect(client.create(objectId, sealedForAnotherOwner)).rejects.toThrow('Enveloppe')
    await expect(client.create(objectId, sealedForAnotherObject)).rejects.toThrow('Enveloppe')
    expect(fetch).not.toHaveBeenCalled()
  })
})
