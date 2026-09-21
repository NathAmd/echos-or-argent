import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import type {
  OnlineAccount,
  OnlineAccountAccessSnapshot,
  OnlineAccountCredentials,
} from '../../online/onlineAccountSession'
import type { OnlineVaultKeyring } from '../../online/onlineVaultKeyring'
import { OpaqueVaultServiceError } from '../../online/opaqueVaultHttpClient'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority } from '../save/hgssDataOnlySaveDocument'
import { writeHgssDataOnlyBrowserSaveSlot } from '../save/hgssDataOnlySaveStorage'
import type {
  HgssFullSaveCloudSnapshot,
  HgssFullSaveCloudStoredSnapshot,
  HgssFullSaveCloudVaultClient,
} from '../save/hgssFullSaveCloudVault'
import {
  inspectHgssBrowserSaveSlot,
  type HgssBrowserSaveSlotRecord,
} from '../save/hgssSaveStorage'
import { createHgssSaveState } from '../save/hgssSaveState'
import {
  createBrowserTitleSaveAccess,
  type BrowserTitleSaveAccess,
} from './browserTitleSaveAccess'
import {
  createTitleSaveCloudCoordinator,
  TitleSaveCloudConflictError,
  TitleSaveCloudFlushPendingError,
} from './titleSaveCloudCoordinator'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
}

const config = Object.freeze({
  httpBaseUrl: 'https://lan-save.test',
  identityBaseUrl: 'https://lan-save.test',
  webSocketBaseUrl: 'wss://lan-save.test',
})
const romIdentity = Object.freeze({ gameVersion: 7, language: 3 })
const inventory = {
  metadata: { gameCode: 'IPKF' },
  pokemonCatalog: createPokemonTestCatalog(),
  itemCatalog: {},
  pokedexCatalog: {},
  npcTradeCatalog: [],
  photoDataCatalog: {},
} as unknown as RomInventory
const testAccount: OnlineAccount = Object.freeze({
  id: 'save-test-account',
  username: 'SAVE_TEST',
  role: 'user',
  entitlements: Object.freeze(['online', 'cloud-storage']),
})
const credentials: OnlineAccountCredentials = Object.freeze({
  username: testAccount.username,
  password: 'temporary-test-password',
})
const cloudKey = {} as CryptoKey

function saveDocument(name: string) {
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name, trainerId: 0x12345678, language: 3, gameVersion: 7 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', name),
  ))
}

function createMemoryHlcVault() {
  const remote = new Map<number, HgssFullSaveCloudStoredSnapshot>()
  let connected = true
  let dropNextWriteResponse = false
  let logicalClock = 0n

  const requireNetwork = (): void => {
    if (!connected) throw new TypeError('Réseau de test indisponible.')
  }
  const nextMetadata = () => {
    logicalClock += 1n
    const encoded = logicalClock.toString(16).padStart(32, '0')
    return Object.freeze({
      etag: `"r-${encoded}"` as HgssFullSaveCloudStoredSnapshot['etag'],
      mutation: `m-${encoded}` as HgssFullSaveCloudStoredSnapshot['mutation'],
    })
  }
  const commit = (
    snapshot: HgssFullSaveCloudSnapshot,
    created: boolean,
  ) => {
    const metadata = nextMetadata()
    remote.set(snapshot.slot, Object.freeze({ snapshot, ...metadata }))
    if (dropNextWriteResponse) {
      dropNextWriteResponse = false
      throw new TypeError('Réponse réseau perdue après commit.')
    }
    return Object.freeze({ created, ...metadata })
  }
  const get = vi.fn(async (
    _key: CryptoKey,
    _identity: typeof romIdentity,
    slot: 1 | 2 | 3,
  ) => {
    requireNetwork()
    return remote.get(slot)
  })
  const create = vi.fn(async (
    _key: CryptoKey,
    snapshot: HgssFullSaveCloudSnapshot,
  ) => {
    requireNetwork()
    if (remote.has(snapshot.slot)) {
      throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'already exists', 'req-create')
    }
    return commit(snapshot, true)
  })
  const replace = vi.fn(async (
    _key: CryptoKey,
    etag: HgssFullSaveCloudStoredSnapshot['etag'],
    snapshot: HgssFullSaveCloudSnapshot,
  ) => {
    requireNetwork()
    if (remote.get(snapshot.slot)?.etag !== etag) {
      throw new OpaqueVaultServiceError(412, 'PRECONDITION_FAILED', 'stale revision', 'req-replace')
    }
    return commit(snapshot, false)
  })
  const client = Object.freeze({
    get,
    create,
    replace,
    purge: vi.fn(),
  }) as unknown as HgssFullSaveCloudVaultClient

  return Object.freeze({
    client,
    disconnect() { connected = false },
    reconnect() { connected = true },
    loseNextWriteResponse() { dropNextWriteResponse = true },
    stored(slot: 1 | 2 | 3) { return remote.get(slot) },
  })
}

type TestDevice = Readonly<{
  access: BrowserTitleSaveAccess
  keyring: OnlineVaultKeyring
}>

function createDevice(vault: HgssFullSaveCloudVaultClient): TestDevice {
  const storage = new MemoryStorage()
  const accessSnapshot: OnlineAccountAccessSnapshot = Object.freeze({
    signedIn: true,
    account: testAccount,
    isAdmin: false,
    online: true,
    premiumClient: false,
    cloudStorage: true,
    development: false,
  })
  const accountSession = {
    getAccount: () => testAccount,
    readAccessToken: () => 'temporary-access-token',
    subscribeAccess(listener: (snapshot: OnlineAccountAccessSnapshot) => void) {
      listener(accessSnapshot)
      return () => undefined
    },
  }
  const keyring = {
    unlock: vi.fn(async () => cloudKey),
    restore: vi.fn(async () => cloudKey),
    clearMemory: vi.fn(),
  } as unknown as OnlineVaultKeyring
  const cloudCoordinator = createTitleSaveCloudCoordinator({ vault })
  const access = createBrowserTitleSaveAccess({
    storage,
    keyStorage: storage,
    config,
    accountSession,
    keyring,
    cloudCoordinator,
  })
  return Object.freeze({ access, keyring })
}

async function connect(device: TestDevice): Promise<void> {
  await device.access.prepareAuthentication(
    testAccount,
    credentials,
    new AbortController().signal,
  )
}

async function openCatalog(
  device: TestDevice,
  conflictResolutions: Parameters<BrowserTitleSaveAccess['authorize']>[4] = new Map(),
) {
  return device.access.authorize(
    { kind: 'online', account: testAccount },
    inventory,
    romIdentity,
    new AbortController().signal,
    conflictResolutions,
  )
}

function writeSave(
  device: TestDevice,
  name: string,
  savedAt: string,
): HgssBrowserSaveSlotRecord {
  const document = saveDocument(name)
  const record = writeHgssDataOnlyBrowserSaveSlot(
    device.access.campaignStorage,
    'IPKF',
    1,
    document,
    'manual',
    () => new Date(savedAt),
  )
  device.access.noteSaved(1, document, record)
  return record
}

function catalogName(result: Awaited<ReturnType<typeof openCatalog>>): string | undefined {
  return result.catalog.saves.get(1)?.restored.profile.name
}

function remoteName(vault: ReturnType<typeof createMemoryHlcVault>): string | undefined {
  const snapshot = vault.stored(1)?.snapshot
  if (snapshot?.kind !== 'present') return undefined
  return snapshot.document.profile.name
}

async function deleteCurrentSave(device: TestDevice): Promise<void> {
  const inspected = inspectHgssBrowserSaveSlot(device.access.campaignStorage, 'IPKF', 1)
  if (inspected.kind !== 'readable') throw new Error('Sauvegarde de test lisible attendue.')
  await device.access.deleteSlot(1, inspected.deletionToken)
}

describe('parcours cloud multi-appareils', () => {
  it('synchronise le descendant causal le plus récent et exige un choix pour une vraie divergence', async () => {
    const vault = createMemoryHlcVault()
    const deviceA = createDevice(vault.client)
    const deviceB = createDevice(vault.client)

    expect(() => deviceA.access.campaignStorage.getItem('avant-sas')).toThrow(/sas/)
    await connect(deviceA)
    await connect(deviceB)
    expect(deviceA.keyring.unlock).toHaveBeenCalledOnce()
    expect(deviceB.keyring.unlock).toHaveBeenCalledOnce()
    expect(deviceA.keyring.restore).not.toHaveBeenCalled()
    expect(deviceB.keyring.restore).not.toHaveBeenCalled()

    expect(catalogName(await openCatalog(deviceA))).toBeUndefined()
    expect(deviceA.keyring.restore).toHaveBeenCalledOnce()
    writeSave(deviceA, 'ASTART', '2026-08-28T12:00:00.000Z')
    await deviceA.access.flushCloud()
    const firstMutation = vault.stored(1)?.mutation
    expect(remoteName(vault)).toBe('ASTART')

    expect(catalogName(await openCatalog(deviceB))).toBe('ASTART')
    expect(deviceB.keyring.restore).toHaveBeenCalledOnce()
    writeSave(deviceB, 'BNEXT', '2020-01-01T00:00:00.000Z')
    await deviceB.access.flushCloud()
    const secondMutation = vault.stored(1)?.mutation
    expect(firstMutation && secondMutation && secondMutation > firstMutation).toBe(true)
    expect(remoteName(vault)).toBe('BNEXT')
    expect(catalogName(await openCatalog(deviceA))).toBe('BNEXT')

    await deleteCurrentSave(deviceA)
    await deviceA.access.flushCloud()
    expect(vault.stored(1)?.snapshot.kind).toBe('deleted')
    expect(catalogName(await openCatalog(deviceB))).toBeUndefined()

    writeSave(deviceB, 'BRESTR', '2019-01-01T00:00:00.000Z')
    await deviceB.access.flushCloud()
    expect(remoteName(vault)).toBe('BRESTR')
    expect(catalogName(await openCatalog(deviceA))).toBe('BRESTR')

    vault.disconnect()
    writeSave(deviceA, 'AOFFLN', '2018-01-01T00:00:00.000Z')
    await expect(deviceA.access.flushCloud()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)
    deviceA.access.deactivateCloud()
    vault.reconnect()
    expect(catalogName(await openCatalog(deviceA))).toBe('AOFFLN')
    expect(remoteName(vault)).toBe('AOFFLN')
    expect(catalogName(await openCatalog(deviceB))).toBe('AOFFLN')

    vault.loseNextWriteResponse()
    writeSave(deviceB, 'BACKLS', '2017-01-01T00:00:00.000Z')
    await expect(deviceB.access.flushCloud()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)
    expect(remoteName(vault)).toBe('BACKLS')
    deviceB.access.deactivateCloud()
    expect(catalogName(await openCatalog(deviceB))).toBe('BACKLS')
    expect(catalogName(await openCatalog(deviceA))).toBe('BACKLS')

    writeSave(deviceA, 'ABRCH', '2016-01-01T00:00:00.000Z')
    writeSave(deviceB, 'BBRCH', '2099-01-01T00:00:00.000Z')
    await deviceA.access.flushCloud()
    await expect(deviceB.access.flushCloud()).rejects.toBeInstanceOf(TitleSaveCloudFlushPendingError)
    expect(remoteName(vault)).toBe('ABRCH')
    const mutationBeforeConflictResolution = vault.stored(1)?.mutation

    deviceB.access.deactivateCloud()
    let conflict: unknown
    try {
      await openCatalog(deviceB)
    } catch (error) {
      conflict = error
    }
    expect(conflict).toBeInstanceOf(TitleSaveCloudConflictError)
    if (!(conflict instanceof TitleSaveCloudConflictError)) {
      throw new Error('Conflit causal de test attendu.')
    }
    expect(conflict.choices).toEqual(['local', 'remote'])
    expect(remoteName(vault)).toBe('ABRCH')
    expect(vault.stored(1)?.mutation).toBe(mutationBeforeConflictResolution)

    const resolved = await openCatalog(deviceB, new Map([[conflict.slot, Object.freeze({
      choice: 'remote',
      remoteEtag: conflict.remoteEtag,
      localVersion: conflict.localVersion,
    })]]))
    expect(catalogName(resolved)).toBe('ABRCH')
    expect(remoteName(vault)).toBe('ABRCH')
    expect(vault.stored(1)?.mutation).toBe(mutationBeforeConflictResolution)

    deviceA.access.destroy()
    deviceB.access.destroy()
  })
})
