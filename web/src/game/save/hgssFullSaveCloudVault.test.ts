import { describe, expect, it, vi } from 'vitest'
import {
  createOpaqueVaultContext,
  generateOpaqueVaultKey,
  openOpaqueJson,
  sealOpaqueJson,
} from '../../online/opaqueJsonVault'
import {
  OPAQUE_VAULT_MEDIA_TYPE,
  type OpaqueVaultEtag,
} from '../../online/opaqueVaultHttpClient'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createHgssDataOnlySaveAuthority,
  hgssDataOnlySaveAuthority,
  type HgssDataOnlySaveDocument,
} from './hgssDataOnlySaveDocument'
import {
  createHgssFullSaveCloudVaultClient,
  deriveHgssFullSaveCloudObjectId,
  type HgssFullSaveCloudPresentSnapshot,
  type HgssFullSaveCloudRomIdentity,
  type HgssFullSaveCloudSnapshot,
} from './hgssFullSaveCloudVault'
import { createHgssSaveState, type HgssSaveStateV1 } from './hgssSaveState'

const etag = `"r-${'a'.repeat(32)}"` as OpaqueVaultEtag
const nextEtag = `"r-${'b'.repeat(32)}"` as OpaqueVaultEtag
const mutation = `m-${'1'.repeat(32)}`
const config = {
  httpBaseUrl: 'https://online.example.com',
  identityBaseUrl: 'https://online.example.com',
  webSocketBaseUrl: 'wss://online.example.com',
}
const romIdentity: HgssFullSaveCloudRomIdentity = Object.freeze({ gameVersion: 7, language: 3 })
const savedAt = '2026-08-26T18:00:00.000Z'
const changedAt = '2026-08-27T07:30:00.000Z'
const protectedCanary = 'ROM_RESOLVED_PRESENTATION_CANARY_MUST_STAY_LOCAL'
const unattestedSafariName = 'ROMNAME'
type JsonObjectPath = readonly (string | number)[]

function collectObjectPaths(value: unknown, path: JsonObjectPath = []): JsonObjectPath[] {
  if (!value || typeof value !== 'object') return []
  if (Array.isArray(value)) {
    return value.flatMap((entry, index) => collectObjectPaths(entry, [...path, index]))
  }
  return [path, ...Object.entries(value).flatMap(([key, entry]) => (
    collectObjectPaths(entry, [...path, key])
  ))]
}

function objectAtPath(root: object, path: JsonObjectPath): Record<string, unknown> {
  let value: unknown = root
  for (const segment of path) value = (value as Record<string | number, unknown>)[segment]
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Chemin objet invalide dans le test.')
  return value as Record<string, unknown>
}

function createCompleteLocalSave(): HgssSaveStateV1 {
  const rng = createHgssSessionRng(5489)
  const pokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId: 155,
    level: 5,
    rng: rng.lc,
    personality: { kind: 'fixed', value: 0x12345678 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { id: 0x12345678, name: 'ALICE', nameSource: 'user-text', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
  pokemon.speciesName = protectedCanary
  const field = createFieldScriptState('male', 'ALICE', { party: [pokemon] })
  field.flags.add(0x6a)
  field.variables.set(0x4108, 2)
  field.inventory.set(17, 4)
  field.buffers.set(0, protectedCanary)
  field.player = { x: 4, z: 7, direction: 'north' }

  return createHgssSaveState(
    'IPKF',
    { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
    rng,
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    field,
    { textSpeed: 'fast', battleAnimations: false, localWeather: true },
    { hours: 42, minutes: 17, seconds: 9 },
    {
      schemaVersion: 1,
      lastObservedTimestampSeconds: 1_787_391_000,
      lastObservedDayOrdinal: 20_691,
      ownerRtcOffset: -120,
      penaltyMinutes: 0,
    },
    {
      format: 'pokemaster-hgss-new-game-plus',
      version: 1,
      source: {
        gameVersion: 7,
        language: 3,
        slot: 1,
        playerName: 'ALICE',
        playerNameSource: 'user-text',
        leagueCompletedAt: '2026-08-26T12:00:00.000Z',
      },
      modules: [{ id: 'carry-money', revision: 1, config: { percentage: 50 } }],
    },
    {
      'new-game-plus.hardcore': {
        version: 1,
        value: {
          format: 'pokemaster-hgss-hardcore-state',
          version: 1,
          highestProgression: 2,
        },
      },
    },
  )
}

function presentSnapshot(document: HgssDataOnlySaveDocument): HgssFullSaveCloudPresentSnapshot {
  return Object.freeze({
    kind: 'present',
    slot: 1,
    romIdentity,
    savedAt,
    saveKind: 'manual',
    document,
  })
}

function presentMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'pokemaster-hgss-cloud-slot',
    version: 1,
    kind: 'present',
    slot: 1,
    romIdentity: { gameVersion: 7, language: 3 },
    savedAt,
    saveKind: 'manual',
    ...overrides,
  }
}

function deletedMetadata(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    format: 'pokemaster-hgss-cloud-slot',
    version: 1,
    kind: 'deleted',
    slot: 1,
    romIdentity: { gameVersion: 7, language: 3 },
    changedAt,
    ...overrides,
  }
}

function portableWire(metadata: unknown, document?: unknown): unknown {
  return {
    format: 'portable-state',
    version: 1,
    entries: {
      ...(document === undefined ? {} : { 'campaign.full': { version: 1, value: document } }),
      'campaign.slot': { version: 1, value: metadata },
    },
  }
}

function client(fetch: (input: string, init?: RequestInit) => Promise<Response>) {
  return createHgssFullSaveCloudVaultClient({
    config,
    readAccessToken: () => 'runtime-token',
    readOwnerId: () => 'alice',
    fetch,
  })
}

async function remoteResponse(
  key: CryptoKey,
  objectId: Awaited<ReturnType<typeof deriveHgssFullSaveCloudObjectId>>,
  wire: unknown,
  logicalMutation: string = mutation,
): Promise<Response> {
  const envelope = await sealOpaqueJson(key, wire, createOpaqueVaultContext('alice', objectId))
  return new Response(JSON.stringify(envelope), {
    status: 200,
    headers: {
      'Content-Type': OPAQUE_VAULT_MEDIA_TYPE,
      ETag: etag,
      ...(logicalMutation ? { 'Opaque-Mutation': logicalMutation } : {}),
    },
  })
}

describe('coffre cloud de slot HGSS complet', () => {
  it('dérive des objectId opaques stables et séparés par clé, ROM et slot', async () => {
    const key = await generateOpaqueVaultKey()
    const otherKey = await generateOpaqueVaultKey()
    const vectorKey = await crypto.subtle.importKey(
      'raw',
      Uint8Array.from({ length: 32 }, (_, index) => index),
      { name: 'AES-GCM' },
      true,
      ['encrypt', 'decrypt'],
    )
    const exported = await crypto.subtle.exportKey('raw', key)
    const restoredKey = await crypto.subtle.importKey('raw', exported, { name: 'AES-GCM' }, true, ['encrypt', 'decrypt'])

    const first = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const restored = await deriveHgssFullSaveCloudObjectId(restoredKey, romIdentity, 1)
    const variants = await Promise.all([
      deriveHgssFullSaveCloudObjectId(key, romIdentity, 2),
      deriveHgssFullSaveCloudObjectId(key, romIdentity, 3),
      deriveHgssFullSaveCloudObjectId(key, { gameVersion: 8, language: 3 }, 1),
      deriveHgssFullSaveCloudObjectId(key, { gameVersion: 7, language: 2 }, 1),
      deriveHgssFullSaveCloudObjectId(otherKey, romIdentity, 1),
    ])

    expect(restored).toBe(first)
    expect(await deriveHgssFullSaveCloudObjectId(vectorKey, romIdentity, 1)).toBe('iCx6u-V-QuNZ6zgjbc4XlA')
    expect([first, ...variants]).toHaveLength(new Set([first, ...variants]).size)
    for (const objectId of [first, ...variants]) {
      expect(objectId).toMatch(/^[A-Za-z0-9_-]{21}[AQgw]$/)
      expect(objectId).not.toContain('IPK')
    }

    const nonExtractableKey = await crypto.subtle.generateKey(
      { name: 'AES-GCM', length: 256 },
      false,
      ['encrypt', 'decrypt'],
    )
    await expect(deriveHgssFullSaveCloudObjectId(nonExtractableKey, romIdentity, 1))
      .rejects.toThrow('exportable')
  })

  it('chiffre un snapshot présent avec campaign.full et ses métadonnées exactes', async () => {
    const document = hgssDataOnlySaveAuthority.project(createCompleteLocalSave())
    expect(JSON.stringify(document)).not.toContain(protectedCanary)
    expect(document).toHaveProperty('rtcPenalty')
    expect(document).toHaveProperty('newGamePlus.modules.0.id', 'carry-money')
    expect(document).toHaveProperty(['extensions', 'new-game-plus.hardcore'])
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, {
        status: 201,
        headers: { ETag: etag, 'Opaque-Mutation': mutation },
      }))

    await expect(client(fetch).create(key, presentSnapshot(document))).resolves.toEqual({ created: true, etag, mutation })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe(`${config.httpBaseUrl}/v1/objects/${objectId}`)
    const requestBody = String(request?.body)
    const opened = await openOpaqueJson(
      key,
      JSON.parse(requestBody) as unknown,
      createOpaqueVaultContext('alice', objectId),
    )
    expect(opened).toEqual(portableWire(presentMetadata(), document))
    expect(Object.keys((opened as { entries: object }).entries).sort()).toEqual(['campaign.full', 'campaign.slot'])
    expect(JSON.stringify(opened)).not.toContain(protectedCanary)
    expect(JSON.stringify(opened)).not.toContain('romGameCode')
    expect(JSON.stringify(opened)).not.toContain('speciesName')
  })

  it('relit un snapshot présent et conserve l’attestation exacte du document', async () => {
    const document = hgssDataOnlySaveAuthority.project(createCompleteLocalSave())
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const response = await remoteResponse(
      key,
      objectId,
      portableWire(presentMetadata(), document),
      mutation,
    )
    const stored = await client(async () => response.clone()).get(key, romIdentity, 1)

    expect(stored).toEqual({ snapshot: presentSnapshot(document), etag, mutation })
    expect(stored && Object.isFrozen(stored)).toBe(true)
    expect(stored && Object.isFrozen(stored.snapshot)).toBe(true)
    expect(stored?.snapshot.kind).toBe('present')
    if (stored?.snapshot.kind !== 'present') throw new Error('Snapshot présent attendu.')
    expect(hgssDataOnlySaveAuthority.owns(stored.snapshot.document)).toBe(true)
  })

  it('remplace un slot par un tombstone chiffré sans campaign.full', async () => {
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, {
        status: 204,
        headers: { ETag: nextEtag, 'Opaque-Mutation': mutation },
      }))
    const tombstone = Object.freeze({
      kind: 'deleted',
      slot: 1,
      romIdentity,
      changedAt,
    } as const)

    await expect(client(fetch).replace(key, etag, tombstone)).resolves.toEqual({ created: false, etag: nextEtag, mutation })

    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe(`${config.httpBaseUrl}/v1/objects/${objectId}`)
    expect(new Headers(request?.headers).get('If-Match')).toBe(etag)
    const opened = await openOpaqueJson(
      key,
      JSON.parse(String(request?.body)) as unknown,
      createOpaqueVaultContext('alice', objectId),
    )
    expect(opened).toEqual(portableWire(deletedMetadata()))
    expect(Object.keys((opened as { entries: object }).entries)).toEqual(['campaign.slot'])

    const response = await remoteResponse(key, objectId, opened)
    await expect(client(async () => response.clone()).get(key, romIdentity, 1)).resolves.toEqual({
      snapshot: tombstone,
      etag,
      mutation,
    })
  })

  it('refuse les snapshots forgés, incohérents ou non canoniques avant fetch', async () => {
    const rawSave = createCompleteLocalSave()
    const document = hgssDataOnlySaveAuthority.project(rawSave)
    const foreignDocument = createHgssDataOnlySaveAuthority().project(rawSave)
    const copiedDocument = structuredClone(document) as HgssDataOnlySaveDocument
    const forgedDocument = rawSave as unknown as HgssDataOnlySaveDocument
    const key = await generateOpaqueVaultKey()
    const fetch = vi.fn()
    const cloud = client(fetch)
    const valid = presentSnapshot(document)
    const invalid: HgssFullSaveCloudSnapshot[] = [
      { ...valid, document: foreignDocument },
      { ...valid, document: copiedDocument },
      { ...valid, document: forgedDocument },
      { ...valid, romIdentity: { gameVersion: 8, language: 3 } },
      { ...valid, savedAt: '2026-08-26T18:00:00Z' },
      { ...valid, saveKind: 'quick' } as unknown as HgssFullSaveCloudSnapshot,
      { ...valid, slot: 4 } as unknown as HgssFullSaveCloudSnapshot,
      { ...valid, romLabel: protectedCanary } as unknown as HgssFullSaveCloudSnapshot,
      {
        kind: 'deleted', slot: 1, romIdentity, changedAt, document,
      } as unknown as HgssFullSaveCloudSnapshot,
    ]

    for (const snapshot of invalid) {
      await expect(cloud.create(key, snapshot)).rejects.toThrow()
    }
    await expect(cloud.replace(key, etag, { ...valid, document: copiedDocument }))
      .rejects.toThrow('attestation data-only')
    expect(fetch).not.toHaveBeenCalled()
  })

  it('refuse les combinaisons distantes metadata/document invalides ou mal rangées', async () => {
    const document = hgssDataOnlySaveAuthority.project(createCompleteLocalSave())
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const malformedWires = [
      portableWire(presentMetadata()),
      portableWire(deletedMetadata(), document),
      portableWire({ ...presentMetadata(), unexpected: protectedCanary }, document),
      portableWire(presentMetadata({ savedAt: '2026-08-26T18:00:00Z' }), document),
      portableWire(presentMetadata({ romIdentity: { gameVersion: 8, language: 3 } }), document),
      portableWire(deletedMetadata({ slot: 2 })),
      {
        format: 'portable-state',
        version: 1,
        entries: { 'campaign.full': { version: 1, value: document } },
      },
    ]

    for (const wire of malformedWires) {
      const response = await remoteResponse(key, objectId, wire)
      await expect(client(async () => response.clone()).get(key, romIdentity, 1)).rejects.toThrow()
    }
  })

  it('conserve slot et ETag quand le document HGSS déchiffré reste invalide', async () => {
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const response = await remoteResponse(key, objectId, portableWire(presentMetadata()))

    await expect(client(async () => response.clone()).get(key, romIdentity, 1)).rejects.toMatchObject({
      name: 'HgssFullSaveCloudCorruptObjectError',
      slot: 1,
      etag,
    })
  })

  it('refuse un champ inconnu à chaque niveau objet de la sauvegarde complète', () => {
    const document = hgssDataOnlySaveAuthority.project(createCompleteLocalSave())
    const acceptedPaths: string[] = []

    for (const path of collectObjectPaths(document)) {
      const poisoned = structuredClone(document)
      objectAtPath(poisoned, path).unexpectedCloudField = protectedCanary
      try {
        hgssDataOnlySaveAuthority.decode(poisoned)
        acceptedPaths.push(path.length === 0 ? '$' : `$.${path.join('.')}`)
      } catch {
        // Le rejet exact est le résultat attendu pour chaque sous-objet.
      }
    }

    expect(acceptedPaths).toEqual([])
  })

  it('redécode chaque campaign.full distant et refuse toute présentation ROM réinjectée', async () => {
    const document = hgssDataOnlySaveAuthority.project(createCompleteLocalSave())
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 1)
    const poisonedField = {
      ...structuredClone(document),
      field: {
        ...structuredClone(document.field),
        resolvedRomPresentation: protectedCanary,
      },
    }
    const poisonedPokemon = structuredClone(document)
    Object.assign(poisonedPokemon.field.party[0]!, { resolvedRomPresentation: protectedCanary })
    const poisonedNested = structuredClone(document)
    Object.assign(poisonedNested.field.friendGroups![0]!, { resolvedRomPresentation: protectedCanary })
    const poisonedSafariName = structuredClone(document)
    const poisonedSafariState = poisonedSafariName.field.safariZone
    if (!poisonedSafariState || !('linkLeader' in poisonedSafariState)) {
      throw new Error('Fixture Safari data-only absente.')
    }
    Object.assign(poisonedSafariState.linkLeader, { name: unattestedSafariName })
    delete poisonedSafariState.linkLeader.nameSource
    const poisonedExtension = {
      ...structuredClone(document),
      extensions: { 'unsafe.extra': { version: 1, value: { payload: protectedCanary } } },
    }
    const poisonedNewGamePlus = {
      ...structuredClone(document),
      newGamePlus: {
        format: 'pokemaster-hgss-new-game-plus',
        version: 1,
        source: {
          gameVersion: 7,
          language: 3,
          slot: 1,
          playerName: 'ALICE',
          playerNameSource: 'user-text',
          leagueCompletedAt: '2026-08-26T12:00:00.000Z',
        },
        modules: [{ id: 'unsafe-extra', revision: 1, config: { payload: protectedCanary } }],
      },
    }

    for (const poisonedValue of [
      poisonedField,
      poisonedPokemon,
      poisonedNested,
      poisonedSafariName,
      poisonedExtension,
      poisonedNewGamePlus,
    ]) {
      const response = await remoteResponse(key, objectId, portableWire(presentMetadata(), poisonedValue))
      await expect(client(async () => response.clone()).get(key, romIdentity, 1)).rejects.toThrow()
    }
  })

  it('purge physiquement uniquement l’objectId dérivé et la révision fournie', async () => {
    const key = await generateOpaqueVaultKey()
    const objectId = await deriveHgssFullSaveCloudObjectId(key, romIdentity, 3)
    const fetch = vi.fn<(input: string, init?: RequestInit) => Promise<Response>>()
      .mockResolvedValue(new Response(null, { status: 204 }))

    await expect(client(fetch).purge(key, romIdentity, 3, etag)).resolves.toBeUndefined()

    const [url, request] = fetch.mock.calls[0]!
    expect(url).toBe(`${config.httpBaseUrl}/v1/objects/${objectId}`)
    expect(request?.method).toBe('DELETE')
    expect(new Headers(request?.headers).get('If-Match')).toBe(etag)
  })
})
