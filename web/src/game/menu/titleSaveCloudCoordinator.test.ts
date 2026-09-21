import { describe, expect, it, vi } from 'vitest'
import {
  HgssFullSaveCloudCorruptObjectError,
  type HgssFullSaveCloudPresentSnapshot,
  type HgssFullSaveCloudSnapshot,
  type HgssFullSaveCloudVaultClient,
} from '../save/hgssFullSaveCloudVault'
import type {
  HgssDataOnlySaveDocument,
} from '../save/hgssDataOnlySaveDocument'
import type { HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'
import { OpaqueVaultServiceError } from '../../online/opaqueVaultHttpClient'
import type { TitleSaveCatalogDocument } from './titleSaveCatalog'
import {
  createTitleSaveCloudCoordinator,
  TitleSaveCloudConflictError,
  TitleSaveCloudFlushPendingError,
  TitleSaveCloudRemoteChangedError,
  type TitleSaveCloudLocalConflictVersion,
} from './titleSaveCloudCoordinator'
import { fingerprintTitleSaveStorageToken } from './titleSaveStorageScope'
import type { TitleSaveCloudCausalAnchor } from './titleSaveCloudCausalStore'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createHgssSharedCampaignProgressionSeed } from '../multiplayer/hgssSharedCampaignProgression'
import {
  createHgssSharedCampaignSaveExtension,
  replaceHgssSharedCampaignSaveExtension,
} from '../save/hgssSharedCampaignSaveExtension'

const romIdentity = Object.freeze({ gameVersion: 7, language: 3 })
const key = {} as CryptoKey
const firstEtag = '"r-11111111111111111111111111111111"' as never
const secondEtag = '"r-22222222222222222222222222222222"' as never
const firstMutation = `m-${'1'.repeat(32)}` as never
const secondMutation = `m-${'2'.repeat(32)}` as never

function document(marker: number): HgssDataOnlySaveDocument {
  return { version: 1, marker, romIdentity } as unknown as HgssDataOnlySaveDocument
}

function local(marker: number, savedAt: string, kind: 'manual' | 'auto' = 'manual'): TitleSaveCatalogDocument {
  return Object.freeze({
    document: document(marker),
    savedAt,
    kind,
    storageToken: `token-${marker}` as HgssBrowserSaveSlotDeletionToken,
  })
}

function present(slot: 1 | 2 | 3, marker: number, savedAt: string): HgssFullSaveCloudPresentSnapshot {
  return Object.freeze({
    kind: 'present',
    slot,
    romIdentity,
    savedAt,
    saveKind: 'manual',
    document: document(marker),
  })
}

function campaignPresent(revision: number, savedAt: string): HgssFullSaveCloudPresentSnapshot {
  const state = createFieldScriptState('male', 'JO')
  if (revision > 0) state.flags.add(0x10)
  const progression = createHgssSharedCampaignProgressionSeed(
    state,
    '0123456789abcdef0123456789abcdef',
    revision,
  )
  const campaign = createHgssSharedCampaignSaveExtension(
    progression,
    'campaign:cloud-test',
    [],
    'player:local',
  )
  return Object.freeze({
    kind: 'present',
    slot: 1,
    romIdentity,
    savedAt,
    saveKind: 'auto',
    document: {
      version: 1,
      marker: revision,
      romIdentity,
      extensions: replaceHgssSharedCampaignSaveExtension(undefined, campaign),
    } as unknown as HgssDataOnlySaveDocument,
  })
}

function conflictVersion(
  storageToken: string | null,
  tombstoneChangedAt: string | null = null,
): TitleSaveCloudLocalConflictVersion {
  return { storageToken: storageToken as never, tombstoneChangedAt }
}

function vault(remote = new Map<number, { snapshot: HgssFullSaveCloudSnapshot, etag: never }>()) {
  const get = vi.fn(async (
    _key: CryptoKey,
    _identity: typeof romIdentity,
    slot: 1 | 2 | 3,
    _signal?: AbortSignal,
  ) => {
    void _signal
    return remote.get(slot)
  })
  const create = vi.fn(async (_key: CryptoKey, snapshot: HgssFullSaveCloudSnapshot) => {
    remote.set(snapshot.slot, { snapshot, etag: firstEtag })
    return { created: true, etag: firstEtag }
  })
  const replace = vi.fn(async (_key: CryptoKey, _etag: never, snapshot: HgssFullSaveCloudSnapshot) => {
    remote.set(snapshot.slot, { snapshot, etag: secondEtag })
    return { created: false, etag: secondEtag }
  })
  return {
    remote,
    get,
    create,
    replace,
    client: { get, create, replace, purge: vi.fn() } as unknown as HgssFullSaveCloudVaultClient,
  }
}

function causalVault(initial: HgssFullSaveCloudSnapshot) {
  let remote = { snapshot: initial, etag: firstEtag, mutation: firstMutation }
  const get = vi.fn(async (_key: CryptoKey, _identity: typeof romIdentity, slot: 1 | 2 | 3) => (
    slot === initial.slot ? remote : undefined
  ))
  const create = vi.fn(async () => {
    throw new Error('Objet causal déjà créé.')
  })
  const replace = vi.fn(async (
    _key: CryptoKey,
    etag: never,
    snapshot: HgssFullSaveCloudSnapshot,
  ) => {
    if (etag !== remote.etag) {
      throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'revision mismatch', 'req-cas')
    }
    remote = { snapshot, etag: secondEtag, mutation: secondMutation }
    return { created: false, etag: secondEtag, mutation: secondMutation }
  })
  return {
    get remote() { return remote },
    get,
    create,
    replace,
    client: { get, create, replace, purge: vi.fn() } as unknown as HgssFullSaveCloudVaultClient,
  }
}

async function causalAnchorFor(localDocument: TitleSaveCatalogDocument) {
  return Object.freeze({
    localState: Object.freeze({
      storageHash: await fingerprintTitleSaveStorageToken(localDocument.storageToken),
      tombstoneChangedAt: null,
    }),
    remoteEtag: firstEtag,
    remoteMutation: firstMutation,
  })
}

function authorization(overrides: Partial<Parameters<ReturnType<typeof createTitleSaveCloudCoordinator>['authorize']>[0]> = {}) {
  return {
    key,
    romIdentity,
    localDocuments: new Map(),
    corruptSlots: new Map(),
    applyPresent: vi.fn(),
    applyDeleted: vi.fn(),
    applyCorruptDeleted: vi.fn(),
    ...overrides,
  }
}

describe('coordinateur cloud du catalogue titre', () => {
  it('ne laisse pas une autosave attestée contourner la garde de campagne', async () => {
    const remoteSnapshot = campaignPresent(1, '2026-08-27T18:00:00.000Z')
    const cloud = causalVault(remoteSnapshot)
    const localDocument = Object.freeze({
      document: remoteSnapshot.document,
      savedAt: remoteSnapshot.savedAt,
      kind: remoteSnapshot.saveKind,
      storageToken: 'token-campaign' as HgssBrowserSaveSlotDeletionToken,
    })
    const reportStatus = vi.fn()
    const coordinator = createTitleSaveCloudCoordinator({ vault: cloud.client, reportStatus })
    await coordinator.authorize(authorization({
      localDocuments: new Map([[1, localDocument]]),
      causalAnchors: new Map([[1, await causalAnchorFor(localDocument)]]),
      readLocalVersion: () => conflictVersion(localDocument.storageToken),
    }))

    coordinator.enqueuePresent(
      campaignPresent(0, '2026-08-27T19:00:00.000Z'),
      conflictVersion(localDocument.storageToken),
    )
    await expect(coordinator.flush()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)

    expect(cloud.replace).not.toHaveBeenCalled()
    expect(reportStatus).toHaveBeenCalledWith(expect.stringMatching(/Conflit cloud/))
  })

  it('fait converger A vers B puis B vers A sans conflit et conserve la date d affichage', async () => {
    let serial = 0
    let remote: {
      snapshot: HgssFullSaveCloudSnapshot
      etag: never
      mutation: never
    } | undefined
    const nextMetadata = () => {
      serial += 1
      const value = serial.toString(16).padStart(32, '0')
      return { etag: `"r-${value}"` as never, mutation: `m-${value}` as never }
    }
    const sharedVault = {
      get: vi.fn(async (_key: CryptoKey, _identity: typeof romIdentity, slot: 1 | 2 | 3) => (
        slot === 1 ? remote : undefined
      )),
      create: vi.fn(async (_key: CryptoKey, snapshot: HgssFullSaveCloudSnapshot) => {
        if (remote) throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'exists', 'req-create')
        const metadata = nextMetadata()
        remote = { snapshot, ...metadata }
        return { created: true, ...metadata }
      }),
      replace: vi.fn(async (_key: CryptoKey, etag: never, snapshot: HgssFullSaveCloudSnapshot) => {
        if (!remote || remote.etag !== etag) {
          throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'stale', 'req-replace')
        }
        const metadata = nextMetadata()
        remote = { snapshot, ...metadata }
        return { created: false, ...metadata }
      }),
      purge: vi.fn(),
    } as unknown as HgssFullSaveCloudVaultClient
    type Device = {
      local?: TitleSaveCatalogDocument
      anchor?: TitleSaveCloudCausalAnchor
      applied: (snapshot: HgssFullSaveCloudSnapshot) => void
    }
    const alice: Device = { local: local(1, '2026-08-27T18:00:00.000Z'), applied: vi.fn() }
    const bob: Device = { applied: vi.fn() }
    let downloadedToken = 10
    const requestFor = (device: Device) => authorization({
      localDocuments: device.local ? new Map([[1, device.local]]) : new Map(),
      causalAnchors: device.anchor ? new Map([[1, device.anchor]]) : new Map(),
      readLocalVersion: () => conflictVersion(device.local?.storageToken ?? null),
      persistCausalAnchor: (_slot, anchor) => { device.anchor = anchor },
      applyPresent: vi.fn((_slot, _expected, snapshot) => {
        downloadedToken += 1
        device.local = Object.freeze({
          document: snapshot.document,
          savedAt: snapshot.savedAt,
          kind: snapshot.saveKind,
          storageToken: `download-${downloadedToken}` as HgssBrowserSaveSlotDeletionToken,
        })
        device.applied(snapshot)
      }),
    })

    await createTitleSaveCloudCoordinator({ vault: sharedVault }).authorize(requestFor(alice))
    expect(remote?.snapshot).toMatchObject({ document: expect.objectContaining({ marker: 1 }) })

    const bobCoordinator = createTitleSaveCloudCoordinator({ vault: sharedVault })
    await bobCoordinator.authorize(requestFor(bob))
    expect(bob.local).toMatchObject({
      savedAt: '2026-08-27T18:00:00.000Z',
      document: expect.objectContaining({ marker: 1 }),
    })

    // La seconde console sauvegarde après A avec une horloge murale reculée.
    bob.local = local(2, '2020-01-01T00:00:00.000Z')
    bobCoordinator.enqueuePresent(
      present(1, 2, bob.local.savedAt),
      conflictVersion(bob.local.storageToken),
    )
    await bobCoordinator.flush()
    expect(remote?.snapshot).toMatchObject({
      savedAt: '2020-01-01T00:00:00.000Z',
      document: expect.objectContaining({ marker: 2 }),
    })

    await createTitleSaveCloudCoordinator({ vault: sharedVault }).authorize(requestFor(alice))
    expect(alice.local).toMatchObject({
      savedAt: '2020-01-01T00:00:00.000Z',
      document: expect.objectContaining({ marker: 2 }),
    })
    expect(alice.applied).toHaveBeenCalledOnce()
  })

  it('ne fait pas avancer la mutation distante lors d’un téléchargement puis accepte le descendant offline', async () => {
    const base = local(1, '2026-08-27T18:00:00.000Z')
    const adapter = causalVault(present(1, 1, base.savedAt))
    let downloadedVersion = conflictVersion(null)
    const downloaded = authorization({
      readLocalVersion: () => downloadedVersion,
      applyPresent: vi.fn((_slot, _expected, snapshot) => {
        downloadedVersion = conflictVersion('downloaded-token')
        expect(snapshot.document).toMatchObject({ marker: 1 })
      }),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(downloaded))
      .resolves.toEqual({ uploaded: 0, downloaded: 1, deletedLocally: 0 })
    expect(adapter.replace).not.toHaveBeenCalled()
    expect(adapter.remote).toMatchObject({ etag: firstEtag, mutation: firstMutation })

    const offlineDescendant = local(2, '2020-01-01T00:00:00.000Z')
    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(authorization({
      localDocuments: new Map([[1, offlineDescendant]]),
      causalAnchors: new Map([[1, await causalAnchorFor(base)]]),
      readLocalVersion: () => conflictVersion(offlineDescendant.storageToken),
    }))).resolves.toEqual({ uploaded: 1, downloaded: 0, deletedLocally: 0 })
    expect(adapter.remote.snapshot).toMatchObject({
      kind: 'present',
      document: expect.objectContaining({ marker: 2 }),
    })
  })

  it('reconnaît une tombstone locale déjà synchronisée sans la réécrire', async () => {
    const changedAt = '2026-08-27T18:00:00.000Z'
    const remoteDeleted = Object.freeze({
      kind: 'deleted' as const,
      slot: 1 as const,
      romIdentity,
      changedAt,
    })
    const adapter = causalVault(remoteDeleted)
    const anchor: TitleSaveCloudCausalAnchor = Object.freeze({
      localState: Object.freeze({ storageHash: null, tombstoneChangedAt: changedAt }),
      remoteEtag: firstEtag,
      remoteMutation: firstMutation,
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(authorization({
      localTombstones: new Map([[1, Object.freeze({
        changedAt,
        supersededStorageHashes: Object.freeze(['A'.repeat(43)]),
      })]]),
      causalAnchors: new Map([[1, anchor]]),
      readLocalVersion: () => conflictVersion(null, changedAt),
    }))).resolves.toEqual({ uploaded: 0, downloaded: 0, deletedLocally: 0 })
    expect(adapter.replace).not.toHaveBeenCalled()
    expect(adapter.remote).toMatchObject({ etag: firstEtag, mutation: firstMutation })
  })

  it('utilise l ancrage serveur quand l horloge locale recule', async () => {
    const base = local(1, '2026-08-27T18:00:00.000Z')
    const changedWithEarlierClock = local(2, '2020-01-01T00:00:00.000Z')
    const adapter = causalVault(present(1, 1, base.savedAt))
    const persisted = vi.fn()
    const request = authorization({
      localDocuments: new Map([[1, changedWithEarlierClock]]),
      causalAnchors: new Map([[1, await causalAnchorFor(base)]]),
      readLocalVersion: () => conflictVersion(changedWithEarlierClock.storageToken),
      persistCausalAnchor: persisted,
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request))
      .resolves.toEqual({ uploaded: 1, downloaded: 0, deletedLocally: 0 })
    expect(adapter.remote.snapshot).toMatchObject({
      kind: 'present',
      savedAt: '2020-01-01T00:00:00.000Z',
      document: expect.objectContaining({ marker: 2 }),
    })
    expect(persisted).toHaveBeenCalledWith(1, expect.objectContaining({
      remoteEtag: secondEtag,
      remoteMutation: secondMutation,
    }))
  })

  it('télécharge le descendant serveur si le local est inchangé, quelle que soit sa date affichée', async () => {
    const base = local(1, '2099-01-01T00:00:00.000Z')
    const adapter = causalVault(present(1, 3, '2020-01-01T00:00:00.000Z'))
    const remote = adapter.remote
    Object.assign(remote, { etag: secondEtag, mutation: secondMutation })
    const request = authorization({
      localDocuments: new Map([[1, base]]),
      causalAnchors: new Map([[1, await causalAnchorFor(base)]]),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request))
      .resolves.toEqual({ uploaded: 0, downloaded: 1, deletedLocally: 0 })
    expect(request.applyPresent).toHaveBeenCalledWith(
      1,
      { kind: 'occupied', storageToken: base.storageToken },
      expect.objectContaining({ document: expect.objectContaining({ marker: 3 }) }),
    )
  })

  it('expose une vraie divergence offline même si une date locale semble plus récente', async () => {
    const base = local(1, '2026-08-27T18:00:00.000Z')
    const offlineEdit = local(2, '2099-01-01T00:00:00.000Z')
    const adapter = causalVault(present(1, 3, '2020-01-01T00:00:00.000Z'))
    const remote = adapter.remote
    Object.assign(remote, { etag: secondEtag, mutation: secondMutation })
    const request = authorization({
      localDocuments: new Map([[1, offlineEdit]]),
      causalAnchors: new Map([[1, await causalAnchorFor(base)]]),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request))
      .rejects.toBeInstanceOf(TitleSaveCloudConflictError)
    expect(adapter.replace).not.toHaveBeenCalled()
  })

  it('ignore un événement local périmé sans le rattacher au token courant', async () => {
    const base = local(1, '2026-08-27T18:00:00.000Z')
    const next = local(2, '2020-01-01T00:00:00.000Z')
    const afterNext = local(3, '2019-01-01T00:00:00.000Z')
    const adapter = causalVault(present(1, 1, base.savedAt))
    let currentVersion = conflictVersion(base.storageToken)
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization({
      localDocuments: new Map([[1, base]]),
      causalAnchors: new Map([[1, await causalAnchorFor(base)]]),
      readLocalVersion: () => currentVersion,
    }))

    currentVersion = conflictVersion(next.storageToken)
    coordinator.enqueuePresent(
      present(1, 2, next.savedAt),
      conflictVersion(next.storageToken),
    )
    currentVersion = conflictVersion(afterNext.storageToken)
    coordinator.enqueuePresent(
      present(1, 99, '2099-01-01T00:00:00.000Z'),
      conflictVersion(next.storageToken),
    )
    await coordinator.flush()

    expect(adapter.remote.snapshot).toMatchObject({
      document: expect.objectContaining({ marker: 2 }),
      savedAt: next.savedAt,
    })
  })

  it('envoie un slot local absent du cloud et restaure un slot cloud absent localement', async () => {
    const adapter = vault(new Map([[2, {
      snapshot: present(2, 22, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(11, '2026-08-26T12:00:00.000Z')]]),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 1,
      deletedLocally: 0,
    })
    expect(adapter.create).toHaveBeenCalledWith(key, expect.objectContaining({ slot: 1 }), expect.any(AbortSignal))
    expect(request.applyPresent).toHaveBeenCalledWith(
      2,
      { kind: 'empty' },
      expect.objectContaining({ slot: 2 }),
    )
  })

  it('fait converger deux appareils du même compte vers la sauvegarde horodatée la plus récente', async () => {
    const adapter = vault()
    const firstDeviceLocal = local(101, '2026-08-27T10:00:00.000Z')
    const secondDeviceLocal = local(202, '2026-08-27T12:00:00.000Z')

    await createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(authorization({
      localDocuments: new Map([[1, firstDeviceLocal]]),
    }))
    await createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(authorization({
      localDocuments: new Map([[1, secondDeviceLocal]]),
    }))

    expect(adapter.remote.get(1)?.snapshot).toMatchObject({
      kind: 'present',
      savedAt: '2026-08-27T12:00:00.000Z',
      document: expect.objectContaining({ marker: 202 }),
    })

    const returningFirstDevice = authorization({
      localDocuments: new Map([[1, firstDeviceLocal]]),
    })
    await expect(
      createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(returningFirstDevice),
    ).resolves.toEqual({ uploaded: 0, downloaded: 1, deletedLocally: 0 })
    expect(returningFirstDevice.applyPresent).toHaveBeenCalledWith(
      1,
      { kind: 'occupied', storageToken: firstDeviceLocal.storageToken },
      expect.objectContaining({
        savedAt: '2026-08-27T12:00:00.000Z',
        document: expect.objectContaining({ marker: 202 }),
      }),
    )
  })

  it('choisit la version différente la plus récente et propage une tombstone distante', async () => {
    const adapter = vault(new Map([
      [1, { snapshot: present(1, 100, '2026-08-27T14:00:00.000Z'), etag: firstEtag }],
      [2, {
        snapshot: Object.freeze({
          kind: 'deleted' as const,
          slot: 2 as const,
          romIdentity,
          changedAt: '2026-08-27T15:00:00.000Z',
        }),
        etag: firstEtag,
      }],
      [3, { snapshot: present(3, 300, '2026-08-26T10:00:00.000Z'), etag: firstEtag }],
    ]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([
        [1, local(101, '2026-08-26T14:00:00.000Z')],
        [2, local(200, '2026-08-26T15:00:00.000Z')],
        [3, local(301, '2026-08-27T10:00:00.000Z')],
      ]),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 1,
      deletedLocally: 1,
    })
    expect(request.applyPresent).toHaveBeenCalledWith(
      1,
      expect.objectContaining({ kind: 'occupied' }),
      expect.objectContaining({ document: expect.objectContaining({ marker: 100 }) }),
    )
    expect(request.applyDeleted).toHaveBeenCalledWith(2, expect.objectContaining({ document: expect.objectContaining({ marker: 200 }) }))
    expect(adapter.replace).toHaveBeenCalledWith(key, firstEtag, expect.objectContaining({ slot: 3 }), expect.any(AbortSignal))
  })

  it('mémorise qu une tombstone distante reçue sur un slot vide ne supprimait aucun octet local', async () => {
    const changedAt = '2026-08-27T15:00:00.000Z'
    const adapter = vault(new Map([[1, {
      snapshot: Object.freeze({
        kind: 'deleted' as const,
        slot: 1 as const,
        romIdentity,
        changedAt,
      }),
      etag: firstEtag,
    }]]))
    const request = authorization({ persistLocalTombstone: vi.fn() })

    await createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request)

    expect(request.persistLocalTombstone).toHaveBeenCalledWith(1, changedAt, [])
  })

  it('préserve les nouveaux octets après cette tombstone même avec un serveur sans mutation', async () => {
    const changedAt = '2099-01-01T00:00:00.000Z'
    const adapter = vault(new Map([[1, {
      snapshot: Object.freeze({
        kind: 'deleted' as const,
        slot: 1 as const,
        romIdentity,
        changedAt,
      }),
      etag: firstEtag,
    }]]))
    const request = authorization({
      localDocuments: new Map([[1, local(2, '2026-08-28T12:00:00.000Z')]]),
      localTombstones: new Map([[1, {
        changedAt,
        supersededStorageHashes: [],
      }]]),
      clearLocalTombstone: vi.fn(),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request))
      .resolves.toEqual({ uploaded: 1, downloaded: 0, deletedLocally: 0 })
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({ kind: 'present', document: expect.objectContaining({ marker: 2 }) }),
      expect.any(AbortSignal),
    )
    expect(request.applyDeleted).not.toHaveBeenCalled()
    expect(request.clearLocalTombstone).toHaveBeenCalledWith(1)
  })

  it('conserve le conflit causal entre deux suppressions modernes malgré une date identique', async () => {
    const changedAt = '2099-01-01T00:00:00.000Z'
    const remoteSnapshot = Object.freeze({
      kind: 'deleted' as const,
      slot: 1 as const,
      romIdentity,
      changedAt,
    })
    const get = vi.fn(async (
      _key: CryptoKey,
      _identity: typeof romIdentity,
      slot: 1 | 2 | 3,
    ) => slot === 1
      ? { snapshot: remoteSnapshot, etag: secondEtag, mutation: secondMutation }
      : undefined)
    const replace = vi.fn()
    const coordinator = createTitleSaveCloudCoordinator({
      vault: {
        get,
        replace,
        create: vi.fn(),
        purge: vi.fn(),
      } as unknown as HgssFullSaveCloudVaultClient,
    })
    const request = authorization({
      localDocuments: new Map([[1, local(2, '2026-08-28T12:00:00.000Z')]]),
      localTombstones: new Map([[1, {
        changedAt,
        supersededStorageHashes: [],
      }]]),
      causalAnchors: new Map([[1, Object.freeze({
        localState: Object.freeze({ storageHash: null, tombstoneChangedAt: changedAt }),
        remoteEtag: firstEtag,
        remoteMutation: firstMutation,
      })]]),
    })

    await expect(coordinator.authorize(request)).rejects.toBeInstanceOf(TitleSaveCloudConflictError)
    expect(replace).not.toHaveBeenCalled()
    expect(request.applyDeleted).not.toHaveBeenCalled()
  })

  it('refuse tout conflit avant de muter si deux contenus partagent le même horodatage', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
    })

    await expect(coordinator.authorize(request)).rejects.toBeInstanceOf(TitleSaveCloudConflictError)
    expect(adapter.create).not.toHaveBeenCalled()
    expect(adapter.replace).not.toHaveBeenCalled()
    expect(request.applyPresent).not.toHaveBeenCalled()
  })

  it('ne remplace jamais automatiquement des octets locaux corrompus par le cloud', async () => {
    const adapter = vault(new Map([[3, {
      snapshot: present(3, 3, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })

    const request = authorization({ corruptSlots: new Map([[3, 'corrupt-token' as never]]) })
    await expect(coordinator.authorize(request)).rejects.toMatchObject({
      name: 'TitleSaveCloudConflictError',
      remoteEtag: firstEtag,
      localVersion: conflictVersion('corrupt-token'),
    })
    expect(request.applyPresent).not.toHaveBeenCalled()
  })

  it('applique seulement après choix explicite une version cloud divergente', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
      remoteConflictResolutions: new Map([[1, {
        choice: 'remote',
        remoteEtag: firstEtag,
        localVersion: conflictVersion('token-1'),
      }]]),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 0,
      downloaded: 1,
      deletedLocally: 0,
    })
    expect(request.applyPresent).toHaveBeenCalledWith(
      1,
      { kind: 'occupied', storageToken: 'token-1' },
      expect.objectContaining({ document: expect.objectContaining({ marker: 2 }) }),
    )
    expect(adapter.replace).not.toHaveBeenCalled()
    expect(adapter.get).toHaveBeenCalledTimes(4)
  })

  it('retire durablement la tombstone avant de recréer les octets distants', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T18:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const order: string[] = []
    const applyError = new Error('écriture locale interrompue')
    const request = authorization({
      localTombstones: new Map([[1, {
        changedAt: '2026-08-27T17:00:00.000Z',
        supersededStorageHashes: ['A'.repeat(43)],
      }]]),
      clearLocalTombstone: vi.fn(() => { order.push('clear') }),
      applyPresent: vi.fn(() => { order.push('apply'); throw applyError }),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request))
      .rejects.toBe(applyError)
    expect(order).toEqual(['clear', 'apply'])
  })

  it('redemande un choix si la version distante a changé depuis l’écran de conflit', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T12:00:00.000Z'),
      etag: secondEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
      remoteConflictResolutions: new Map([[1, {
        choice: 'remote',
        remoteEtag: firstEtag,
        localVersion: conflictVersion('token-1'),
      }]]),
    })

    await expect(coordinator.authorize(request)).rejects.toMatchObject({
      name: 'TitleSaveCloudConflictError',
      remoteEtag: secondEtag,
    })
    expect(request.applyPresent).not.toHaveBeenCalled()
    expect(adapter.replace).not.toHaveBeenCalled()
  })

  it('restaure explicitement le cloud sur les octets locaux corrompus avec leur token exact', async () => {
    const adapter = vault(new Map([[3, {
      snapshot: present(3, 33, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const corruptToken = 'corrupt-token' as never
    const request = authorization({
      corruptSlots: new Map([[3, corruptToken]]),
      remoteConflictResolutions: new Map([[3, {
        choice: 'remote',
        remoteEtag: firstEtag,
        localVersion: conflictVersion('corrupt-token'),
      }]]),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 0,
      downloaded: 1,
      deletedLocally: 0,
    })
    expect(request.applyPresent).toHaveBeenCalledWith(
      3,
      { kind: 'occupied', storageToken: corruptToken },
      expect.objectContaining({ slot: 3 }),
    )
    expect(request.applyCorruptDeleted).not.toHaveBeenCalled()
  })

  it('redemande un choix si le slot local change après l’écran de conflit', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T12:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(3, '2026-08-27T12:00:00.000Z')]]),
      remoteConflictResolutions: new Map([[1, {
        choice: 'remote',
        remoteEtag: firstEtag,
        localVersion: conflictVersion('token-1'),
      }]]),
    })

    await expect(coordinator.authorize(request)).rejects.toMatchObject({
      name: 'TitleSaveCloudConflictError',
      remoteEtag: firstEtag,
      localVersion: conflictVersion('token-3'),
    })
    expect(request.applyPresent).not.toHaveBeenCalled()
  })

  it('sérialise et coalesce les sauvegardes en jeu puis écrit une tombstone', async () => {
    const adapter = vault()
    const coordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      now: () => new Date('2026-08-27T18:00:00.000Z'),
    })
    await coordinator.authorize(authorization())

    coordinator.enqueuePresent(present(1, 1, '2026-08-27T16:00:00.000Z'))
    coordinator.enqueuePresent(present(1, 2, '2026-08-27T17:00:00.000Z'))
    expect(coordinator.hasPending()).toBe(true)
    await coordinator.flush()
    expect(coordinator.hasPending()).toBe(false)
    coordinator.enqueueDeleted(1, romIdentity)
    await coordinator.flush()

    expect(adapter.create).toHaveBeenCalled()
    expect(adapter.replace).toHaveBeenLastCalledWith(
      key,
      expect.anything(),
      expect.objectContaining({ kind: 'deleted', changedAt: '2026-08-27T18:00:00.000Z' }),
      expect.any(AbortSignal),
    )
    expect(adapter.remote.get(1)?.snapshot.kind).toBe('deleted')
  })

  it('attend une sauvegarde enfilée pendant sa barrière de flush', async () => {
    const adapter = vault()
    let releaseCreate = (): void => undefined
    const originalCreate = adapter.create.getMockImplementation()!
    adapter.create.mockImplementation(async (...args) => {
      await new Promise<void>((resolve) => { releaseCreate = resolve })
      return originalCreate(...args)
    })
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())

    const flushed = coordinator.flush()
    await Promise.resolve()
    coordinator.enqueuePresent(present(1, 1, '2026-08-27T16:00:00.000Z'))
    await vi.waitFor(() => expect(coordinator.hasPending()).toBe(true))
    let settled = false
    void flushed.then(() => { settled = true })
    await Promise.resolve()

    expect(settled).toBe(false)
    releaseCreate()
    await flushed
    expect(coordinator.hasPending()).toBe(false)
  })

  it('relance spontanément une sauvegarde arrivée juste avant la fin du drain', async () => {
    const adapter = vault()
    let releaseCreate!: (value: { created: true, etag: typeof firstEtag }) => void
    adapter.create.mockReturnValueOnce(new Promise((resolve) => { releaseCreate = resolve }))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())

    coordinator.enqueuePresent(present(1, 1, '2026-08-27T16:00:00.000Z'))
    releaseCreate({ created: true, etag: firstEtag })
    queueMicrotask(() => {
      coordinator.enqueuePresent(present(1, 2, '2026-08-27T17:00:00.000Z'))
    })

    await vi.waitFor(() => expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({ document: expect.objectContaining({ marker: 2 }) }),
      expect.any(AbortSignal),
    ))
    await vi.waitFor(() => expect(coordinator.hasPending()).toBe(false))
  })

  it('n’envoie jamais une sauvegarde en retard après une version déjà acceptée plus récente', async () => {
    const adapter = vault()
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())

    coordinator.enqueuePresent(present(1, 2, '2026-08-27T18:00:00.000Z'))
    coordinator.enqueuePresent(present(1, 1, '2026-08-27T17:00:00.000Z'))
    await coordinator.flush()

    expect(adapter.create).toHaveBeenCalledTimes(1)
    expect(adapter.remote.get(1)?.snapshot).toEqual(expect.objectContaining({
      kind: 'present',
      savedAt: '2026-08-27T18:00:00.000Z',
      document: expect.objectContaining({ marker: 2 }),
    }))
  })

  it('applique aussi l’ordre chronologique aux tombstones envoyées en session', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 1, '2026-08-27T18:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())
    adapter.replace.mockClear()

    coordinator.enqueueDeleted(1, romIdentity, '2026-08-27T17:00:00.000Z')
    await coordinator.flush()

    expect(adapter.replace).not.toHaveBeenCalled()
    expect(adapter.remote.get(1)?.snapshot).toEqual(expect.objectContaining({
      kind: 'present',
      savedAt: '2026-08-27T18:00:00.000Z',
    }))
  })

  it('ne ressuscite pas une sauvegarde en retard après une tombstone plus récente', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: Object.freeze({
        kind: 'deleted' as const,
        slot: 1 as const,
        romIdentity,
        changedAt: '2026-08-27T18:00:00.000Z',
      }),
      etag: firstEtag,
    }]]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())
    adapter.replace.mockClear()

    coordinator.enqueuePresent(present(1, 1, '2026-08-27T17:00:00.000Z'))
    await coordinator.flush()

    expect(adapter.replace).not.toHaveBeenCalled()
    expect(adapter.remote.get(1)?.snapshot).toEqual(expect.objectContaining({
      kind: 'deleted',
      changedAt: '2026-08-27T18:00:00.000Z',
    }))
  })

  it('bloque une divergence en session seulement si son horodatage est exactement identique', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 1, '2026-08-27T18:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const reportStatus = vi.fn()
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client, reportStatus })
    await coordinator.authorize(authorization())
    adapter.replace.mockClear()

    coordinator.enqueuePresent(present(1, 2, '2026-08-27T18:00:00.000Z'))
    coordinator.enqueuePresent(present(1, 3, '2026-08-27T19:00:00.000Z'))
    await expect(coordinator.flush()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)

    expect(adapter.replace).not.toHaveBeenCalled()
    expect(reportStatus).toHaveBeenCalledWith('Conflit cloud sur l’emplacement 1 · reconnexion requise.')
  })

  it('relance une écriture en attente une fois pendant flush après une erreur transitoire', async () => {
    const adapter = vault()
    adapter.create.mockRejectedValueOnce(new Error('réseau indisponible'))
    const reportStatus = vi.fn()
    const coordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      reportStatus,
    })
    await coordinator.authorize(authorization())

    coordinator.enqueuePresent(present(1, 7, '2026-08-27T18:00:00.000Z'))
    await coordinator.flush()

    expect(adapter.create).toHaveBeenCalledTimes(2)
    expect(adapter.remote.get(1)?.snapshot).toEqual(expect.objectContaining({
      kind: 'present',
      document: expect.objectContaining({ marker: 7 }),
    }))
    expect(reportStatus).toHaveBeenCalledTimes(1)
  })

  it('ne prétend pas avoir flushé tant qu’une écriture reste seulement locale', async () => {
    const adapter = vault()
    adapter.create.mockRejectedValue(new Error('réseau indisponible'))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    await coordinator.authorize(authorization())

    coordinator.enqueuePresent(present(1, 7, '2026-08-27T18:00:00.000Z'))

    await expect(coordinator.flush()).rejects.toMatchObject({
      name: 'TitleSaveCloudFlushPendingError',
      slots: [1],
    } satisfies Partial<TitleSaveCloudFlushPendingError>)
    expect(adapter.create).toHaveBeenCalledTimes(2)
  })

  it('bloque après 412 le seul slot conflictuel jusqu’à une nouvelle autorisation', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 1, '2026-08-27T16:00:00.000Z'),
      etag: firstEtag,
    }]]))
    const reportStatus = vi.fn()
    const coordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      reportStatus,
    })
    await coordinator.authorize(authorization())
    adapter.replace.mockClear()
    adapter.replace.mockImplementationOnce(async () => {
      adapter.remote.set(1, {
        snapshot: present(1, 2, '2026-08-27T19:00:00.000Z'),
        etag: secondEtag,
      })
      throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'révision périmée', 'req-412')
    })

    const attemptedLocal = present(1, 3, '2026-08-27T18:00:00.000Z')
    coordinator.enqueuePresent(attemptedLocal)
    await expect(coordinator.flush()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)
    await expect(coordinator.flush()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)
    coordinator.enqueuePresent(present(1, 4, '2026-08-27T20:00:00.000Z'))
    coordinator.enqueuePresent(present(2, 22, '2026-08-27T20:00:00.000Z'))
    await expect(coordinator.flush()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)

    expect(adapter.replace).toHaveBeenCalledTimes(1)
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      attemptedLocal,
      expect.any(AbortSignal),
    )
    expect(adapter.get).toHaveBeenCalledTimes(4)
    expect(adapter.remote.get(1)?.snapshot).toEqual(present(1, 2, '2026-08-27T19:00:00.000Z'))
    expect(adapter.create).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ slot: 2, document: expect.objectContaining({ marker: 22 }) }),
      expect.any(AbortSignal),
    )
    expect(adapter.remote.get(2)?.snapshot).toEqual(present(2, 22, '2026-08-27T20:00:00.000Z'))
    expect(reportStatus).toHaveBeenCalledWith('Conflit cloud sur l’emplacement 1 · reconnexion requise.')

    await expect(coordinator.authorize(authorization({
      localDocuments: new Map([[1, local(4, '2026-08-27T20:00:00.000Z')]]),
    }))).resolves.toEqual({ uploaded: 1, downloaded: 1, deletedLocally: 0 })
    expect(adapter.replace).toHaveBeenNthCalledWith(
      2,
      key,
      secondEtag,
      expect.objectContaining({ slot: 1, document: expect.objectContaining({ marker: 4 }) }),
      expect.any(AbortSignal),
    )
  })

  it('réconcilie les tombstones locales et distantes selon leur horodatage', async () => {
    const adapter = vault(new Map([
      [1, { snapshot: present(1, 1, '2026-08-27T12:00:00.000Z'), etag: firstEtag }],
      [2, { snapshot: present(2, 2, '2026-08-27T16:00:00.000Z'), etag: firstEtag }],
      [3, {
        snapshot: Object.freeze({
          kind: 'deleted' as const,
          slot: 3 as const,
          romIdentity,
          changedAt: '2026-08-27T17:00:00.000Z',
        }),
        etag: firstEtag,
      }],
    ]))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localTombstones: new Map([
        [1, { changedAt: '2026-08-27T15:00:00.000Z' }],
        [2, { changedAt: '2026-08-27T13:00:00.000Z' }],
      ]),
      persistLocalTombstone: vi.fn(),
      clearLocalTombstone: vi.fn(),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 1,
      deletedLocally: 0,
    })
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({ kind: 'deleted', slot: 1, changedAt: '2026-08-27T15:00:00.000Z' }),
      expect.any(AbortSignal),
    )
    expect(request.applyPresent).toHaveBeenCalledWith(2, { kind: 'empty' }, expect.objectContaining({ slot: 2 }))
    expect(request.clearLocalTombstone).toHaveBeenCalledWith(2)
    expect(request.persistLocalTombstone).toHaveBeenCalledWith(3, '2026-08-27T17:00:00.000Z', [])
  })

  it('réémet après rechargement une suppression durable absente du cloud', async () => {
    const adapter = vault()
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
      localTombstones: new Map([[1, { changedAt: '2026-08-27T18:00:00.000Z' }]]),
      persistLocalTombstone: vi.fn(),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 0,
      deletedLocally: 1,
    })
    expect(adapter.create).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ kind: 'deleted', slot: 1, changedAt: '2026-08-27T18:00:00.000Z' }),
      expect.any(AbortSignal),
    )
    expect(request.persistLocalTombstone).toHaveBeenCalledWith(
      1,
      '2026-08-27T18:00:00.000Z',
      [expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)],
    )
    expect(request.applyDeleted).toHaveBeenCalledWith(1, expect.objectContaining({ savedAt: '2026-08-27T12:00:00.000Z' }))
  })

  it('répare explicitement un objet cloud corrompu par une tombstone durable', async () => {
    const adapter = vault()
    adapter.get.mockImplementation(async (_key, _identity, slot) => {
      if (slot === 1) throw new HgssFullSaveCloudCorruptObjectError(1, firstEtag, new Error('ciphertext'))
      return undefined
    })
    const coordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      now: () => new Date('2026-08-27T20:00:00.000Z'),
    })
    const initial = authorization({ persistLocalTombstone: vi.fn() })
    await expect(coordinator.authorize(initial)).rejects.toMatchObject({
      name: 'TitleSaveCloudConflictError',
      conflictKind: 'remote-corrupt',
      choices: ['local'],
    })
    const repaired = authorization({
      persistLocalTombstone: vi.fn(),
      remoteConflictResolutions: new Map([[1, {
        choice: 'local',
        remoteEtag: firstEtag,
        localVersion: conflictVersion(null),
      }]]),
    })

    await expect(coordinator.authorize(repaired)).resolves.toEqual({
      uploaded: 1,
      downloaded: 0,
      deletedLocally: 0,
    })
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({
        kind: 'deleted',
        slot: 1,
        changedAt: '2026-08-27T20:00:00.000Z',
      }),
      expect.any(AbortSignal),
    )
    expect(repaired.persistLocalTombstone).toHaveBeenCalledWith(1, '2026-08-27T20:00:00.000Z', [])
    expect(adapter.client.purge).not.toHaveBeenCalled()
  })

  it('répare ensemble un objet cloud et ses octets locaux tous deux corrompus', async () => {
    const adapter = vault()
    adapter.get.mockImplementation(async (_key, _identity, slot) => {
      if (slot === 2) throw new HgssFullSaveCloudCorruptObjectError(2, firstEtag, new Error('ciphertext'))
      return undefined
    })
    const coordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      now: () => new Date('2026-08-27T20:30:00.000Z'),
    })
    const corruptToken = 'local-corrupt-token' as HgssBrowserSaveSlotDeletionToken
    const request = authorization({
      corruptSlots: new Map([[2, corruptToken]]),
      persistLocalTombstone: vi.fn(),
      remoteConflictResolutions: new Map([[2, {
        choice: 'local',
        remoteEtag: firstEtag,
        localVersion: conflictVersion(corruptToken),
      }]]),
    })

    await expect(coordinator.authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 0,
      deletedLocally: 1,
    })
    expect(request.persistLocalTombstone).toHaveBeenCalledWith(
      2,
      '2026-08-27T20:30:00.000Z',
      [expect.stringMatching(/^[A-Za-z0-9_-]{43}$/)],
    )
    expect(request.applyCorruptDeleted).toHaveBeenCalledWith(2, corruptToken)
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({ kind: 'deleted', slot: 2 }),
      expect.any(AbortSignal),
    )
  })

  it('n’applique aucun octet local si la version distante change au dernier If-Match', async () => {
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 2, '2026-08-27T14:00:00.000Z'),
      etag: firstEtag,
    }]]))
    let slotOneReads = 0
    adapter.get.mockImplementation(async (
      _key: CryptoKey,
      _identity: typeof romIdentity,
      slot: 1 | 2 | 3,
    ) => {
      if (slot !== 1) return adapter.remote.get(slot)
      slotOneReads += 1
      return slotOneReads === 1
        ? adapter.remote.get(slot)
        : {
            snapshot: present(1, 3, '2026-08-27T15:00:00.000Z'),
            etag: secondEtag,
          }
    })
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const request = authorization({
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
    })

    await expect(coordinator.authorize(request)).rejects.toBeInstanceOf(TitleSaveCloudRemoteChangedError)
    expect(request.applyPresent).not.toHaveBeenCalled()
    expect(request.applyDeleted).not.toHaveBeenCalled()
    expect(adapter.replace).not.toHaveBeenCalled()
  })

  it('ne supprime rien si l’autorisation est annulée pendant le hash causal', async () => {
    let resolveFingerprint: ((value: string) => void) | undefined
    const fingerprintStorageToken = vi.fn(() => new Promise<string>((resolve) => {
      resolveFingerprint = resolve
    }))
    const adapter = vault(new Map([[1, {
      snapshot: Object.freeze({
        kind: 'deleted' as const,
        slot: 1 as const,
        romIdentity,
        changedAt: '2026-08-27T15:00:00.000Z',
      }),
      etag: firstEtag,
    }]]))
    const guardedCoordinator = createTitleSaveCloudCoordinator({
      vault: adapter.client,
      fingerprintStorageToken,
    })
    const signal = new AbortController()
    const request = authorization({
      signal: signal.signal,
      localDocuments: new Map([[1, local(1, '2026-08-27T12:00:00.000Z')]]),
      persistLocalTombstone: vi.fn(),
    })
    const operation = guardedCoordinator.authorize(request)
    await vi.waitFor(() => { expect(fingerprintStorageToken).toHaveBeenCalled() })

    signal.abort()
    resolveFingerprint?.('A'.repeat(43))

    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(request.persistLocalTombstone).not.toHaveBeenCalled()
    expect(request.applyDeleted).not.toHaveBeenCalled()
  })

  it('aborte les lectures cloud en vol dès la désactivation de la session', async () => {
    const adapter = vault()
    const observedSignals: AbortSignal[] = []
    adapter.get.mockImplementation((_key, _identity, _slot, signal) => new Promise((_, reject) => {
      if (!signal) throw new Error("Le signal d'autorisation cloud est requis.")
      observedSignals.push(signal)
      signal.addEventListener('abort', () => {
        reject(new DOMException('Lecture cloud annulée.', 'AbortError'))
      }, { once: true })
    }))
    const coordinator = createTitleSaveCloudCoordinator({ vault: adapter.client })
    const operation = coordinator.authorize(authorization())
    await vi.waitFor(() => { expect(observedSignals).toHaveLength(3) })

    coordinator.deactivate()

    expect(observedSignals.every((signal) => signal.aborted)).toBe(true)
    await expect(operation).rejects.toMatchObject({ name: 'AbortError' })
    expect(adapter.create).not.toHaveBeenCalled()
    expect(adapter.replace).not.toHaveBeenCalled()
  })

  it('donne priorité à l empreinte causale des tombstones malgré une horloge locale fausse', async () => {
    const localDocument = local(1, '2026-08-27T20:00:00.000Z')
    const matchingHash = await fingerprintTitleSaveStorageToken(localDocument.storageToken)
    const matchingAdapter = vault()
    const matching = authorization({
      localDocuments: new Map([[1, localDocument]]),
      localTombstones: new Map([[1, {
        changedAt: '2026-08-27T10:00:00.000Z',
        supersededStorageHashes: [matchingHash],
      }]]),
      persistLocalTombstone: vi.fn(),
    })

    await createTitleSaveCloudCoordinator({ vault: matchingAdapter.client }).authorize(matching)
    expect(matchingAdapter.create).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ kind: 'deleted' }),
      expect.any(AbortSignal),
    )
    expect(matching.applyDeleted).toHaveBeenCalled()

    const newerDeletionAdapter = vault()
    const newerDeletion = authorization({
      localDocuments: new Map([[1, localDocument]]),
      localTombstones: new Map([[1, {
        changedAt: '2026-08-28T10:00:00.000Z',
        supersededStorageHashes: ['A'.repeat(43)],
      }]]),
      clearLocalTombstone: vi.fn(),
    })
    await createTitleSaveCloudCoordinator({ vault: newerDeletionAdapter.client }).authorize(newerDeletion)
    expect(newerDeletionAdapter.create).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ kind: 'present', savedAt: localDocument.savedAt }),
      expect.any(AbortSignal),
    )
    expect(newerDeletionAdapter.remote.get(1)?.snapshot.kind).toBe('present')
    expect(newerDeletion.applyDeleted).not.toHaveBeenCalled()
    expect(newerDeletion.clearLocalTombstone).toHaveBeenCalledWith(1)

    const simultaneousAdapter = vault()
    const simultaneous = authorization({
      localDocuments: new Map([[1, localDocument]]),
      localTombstones: new Map([[1, {
        changedAt: localDocument.savedAt,
        supersededStorageHashes: ['A'.repeat(43)],
      }]]),
      clearLocalTombstone: vi.fn(),
    })
    await createTitleSaveCloudCoordinator({ vault: simultaneousAdapter.client }).authorize(simultaneous)
    expect(simultaneousAdapter.create).toHaveBeenCalledWith(
      key,
      expect.objectContaining({ kind: 'present', savedAt: localDocument.savedAt }),
      expect.any(AbortSignal),
    )
    expect(simultaneous.applyDeleted).not.toHaveBeenCalled()
    expect(simultaneous.clearLocalTombstone).toHaveBeenCalledWith(1)
  })

  it('ne touche pas une tombstone distante déjà identique', async () => {
    const changedAt = '2026-08-27T18:00:00.000Z'
    const adapter = vault(new Map([[1, {
      snapshot: Object.freeze({ kind: 'deleted' as const, slot: 1 as const, romIdentity, changedAt }),
      etag: firstEtag,
    }]]))
    const request = authorization({ localTombstones: new Map([[1, { changedAt }]]) })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request)).resolves.toEqual({
      uploaded: 0,
      downloaded: 0,
      deletedLocally: 0,
    })
    expect(adapter.replace).not.toHaveBeenCalled()
  })

  it('applique le choix local explicite entre tombstone et sauvegarde simultanées', async () => {
    const changedAt = '2026-08-27T18:00:00.000Z'
    const adapter = vault(new Map([[1, {
      snapshot: present(1, 9, changedAt),
      etag: firstEtag,
    }]]))
    const request = authorization({
      localTombstones: new Map([[1, { changedAt }]]),
      remoteConflictResolutions: new Map([[1, {
        choice: 'local',
        remoteEtag: firstEtag,
        localVersion: conflictVersion(null, changedAt),
      }]]),
    })

    await expect(createTitleSaveCloudCoordinator({ vault: adapter.client }).authorize(request)).resolves.toEqual({
      uploaded: 1,
      downloaded: 0,
      deletedLocally: 0,
    })
    expect(adapter.replace).toHaveBeenCalledWith(
      key,
      firstEtag,
      expect.objectContaining({ kind: 'deleted', changedAt }),
      expect.any(AbortSignal),
    )
    expect(request.applyPresent).not.toHaveBeenCalled()
  })
})
