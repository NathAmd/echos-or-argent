import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import type { OnlineClientConfig } from '../../online/onlineClientConfig'
import type {
  OnlineAccount,
  OnlineAccountAccessSnapshot,
  OnlineAccountCredentials,
} from '../../online/onlineAccountSession'
import type { OnlineVaultKeyring } from '../../online/onlineVaultKeyring'
import type { HgssFullSaveCloudPresentSnapshot } from '../save/hgssFullSaveCloudVault'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority } from '../save/hgssDataOnlySaveDocument'
import { writeHgssDataOnlyBrowserSaveSlot } from '../save/hgssDataOnlySaveStorage'
import {
  getHgssSaveSlotStorageKey,
  getHgssSaveStorageKey,
  inspectHgssBrowserSaveSlot,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSave,
  writeHgssBrowserSaveSlot,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
} from '../save/hgssSaveStorage'
import { createHgssSaveState } from '../save/hgssSaveState'
import type { TitleSaveCloudCoordinator } from './titleSaveCloudCoordinator'
import {
  createBrowserTitleSaveAccess,
  TitleSaveLocalAccountImportRequiredError,
} from './browserTitleSaveAccess'
import {
  createSwitchableTitleSaveStorage,
  createTitleSaveTombstoneStore,
} from './titleSaveStorageScope'
import { createTitleSaveCloudCausalStore } from './titleSaveCloudCausalStore'

class MemoryStorage {
  readonly values = new Map<string, string>()
  failSet?: (key: string) => boolean
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void {
    if (this.failSet?.(key)) throw new Error('écriture interrompue')
    this.values.set(key, String(value))
  }
  removeItem(key: string): void { this.values.delete(key) }
}

const config = Object.freeze({
  httpBaseUrl: 'https://online.example.test',
  identityBaseUrl: 'https://online.example.test',
  webSocketBaseUrl: 'wss://online.example.test',
})
const romIdentity = Object.freeze({ gameVersion: 7, language: 3 })
const inventory = {
  metadata: { gameCode: 'IPKF' },
  pokemonCatalog: {},
  itemCatalog: {},
  pokedexCatalog: {},
  npcTradeCatalog: [],
  photoDataCatalog: {},
} as unknown as RomInventory
const importInventory = {
  ...inventory,
  pokemonCatalog: createPokemonTestCatalog(),
} as RomInventory

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function account(id = 'alice', cloud = true): OnlineAccount {
  return Object.freeze({
    id,
    username: id,
    role: 'user',
    entitlements: Object.freeze(cloud ? ['online', 'cloud-storage'] : ['online']),
  })
}

type HarnessOverrides = Partial<Pick<
  Parameters<typeof createBrowserTitleSaveAccess>[0],
  | 'prepareCampaignInvalidation'
  | 'onCampaignInvalidated'
  | 'campaignLeaseManager'
  | 'reportStatus'
>>

function harness(
  initial = account(),
  clientConfig: OnlineClientConfig = config,
  overrides: HarnessOverrides = {},
) {
  const storage = new MemoryStorage()
  let snapshot: OnlineAccountAccessSnapshot = Object.freeze({
    signedIn: true,
    account: initial,
    isAdmin: false,
    online: true,
    premiumClient: false,
    cloudStorage: initial.entitlements.includes('cloud-storage'),
    development: false,
  })
  const listeners = new Set<(next: OnlineAccountAccessSnapshot) => void>()
  const session = {
    getAccount: () => snapshot.account,
    readAccessToken: () => 'token',
    subscribeAccess(listener: (next: OnlineAccountAccessSnapshot) => void) {
      listeners.add(listener)
      listener(snapshot)
      return () => { listeners.delete(listener) }
    },
  }
  const key = {} as CryptoKey
  const keyring = {
    unlock: vi.fn(async () => key),
    restore: vi.fn(async () => key),
    clearMemory: vi.fn(),
  } as unknown as OnlineVaultKeyring
  const cloud = {
    authorize: vi.fn(async () => ({ uploaded: 0, downloaded: 0, deletedLocally: 0 })),
    deactivate: vi.fn(),
    enqueuePresent: vi.fn(),
    enqueueDeleted: vi.fn(),
    hasPending: vi.fn(() => true),
    flush: vi.fn(async () => undefined),
  } as unknown as TitleSaveCloudCoordinator
  const access = createBrowserTitleSaveAccess({
    storage,
    keyStorage: storage,
    config: clientConfig,
    accountSession: session,
    keyring,
    cloudCoordinator: cloud,
    now: () => new Date('2026-08-27T18:00:00.000Z'),
    ...overrides,
  })
  return {
    storage,
    keyring,
    cloud,
    access,
    publish(next: OnlineAccountAccessSnapshot) {
      snapshot = next
      for (const listener of listeners) listener(next)
    },
  }
}

function storeTestSlot(
  view: ReturnType<typeof harness>,
  slot: HgssBrowserSaveSlot,
): HgssBrowserSaveSlotDeletionToken {
  writeHgssBrowserSaveSlot(
    view.access.campaignStorage,
    'IPKF',
    slot,
    { marker: slot },
    'manual',
    () => new Date('2026-08-27T12:00:00.000Z'),
  )
  const inspected = inspectHgssBrowserSaveSlot(view.access.campaignStorage, 'IPKF', slot)
  if (inspected.kind !== 'readable') throw new Error('Slot de test illisible.')
  return inspected.deletionToken
}

function readTombstone(view: ReturnType<typeof harness>): unknown {
  const serialized = [...view.storage.values.entries()]
    .find(([key]) => key.includes('campaign-tombstone'))?.[1]
  return serialized ? JSON.parse(serialized) : undefined
}

function importDocument(name: string) {
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name, trainerId: 0x12345678, language: 3, gameVersion: 7 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', name),
  ))
}

function accountStorage(view: ReturnType<typeof harness>, accountId = 'alice') {
  const storage = createSwitchableTitleSaveStorage(view.storage)
  storage.selectOnline(config.httpBaseUrl, accountId)
  return storage
}

function writeAccountTombstone(
  view: ReturnType<typeof harness>,
  slot: HgssBrowserSaveSlot,
  changedAt: string,
): void {
  createTitleSaveTombstoneStore(view.storage).write({
    serverUrl: config.httpBaseUrl,
    accountId: 'alice',
    gameCode: 'IPKF',
    romIdentity,
  }, slot, changedAt)
}

async function expectLocalImportProposal(
  view: ReturnType<typeof harness>,
): Promise<TitleSaveLocalAccountImportRequiredError> {
  return requireLocalImportProposal(view.access.authorize(
    { kind: 'online', account: account() },
    importInventory,
    romIdentity,
    new AbortController().signal,
  ))
}

async function requireLocalImportProposal(
  operation: Promise<unknown>,
): Promise<TitleSaveLocalAccountImportRequiredError> {
  try {
    await operation
  } catch (error) {
    if (error instanceof TitleSaveLocalAccountImportRequiredError) return error
    throw error
  }
  throw new Error("La proposition d'import locale était attendue.")
}

describe('accès navigateur aux sauvegardes du titre', () => {
  it('scope la campagne sur l’identité stable plutôt que sur l’adresse de transport LAN', async () => {
    const stableIdentity = 'https://pokemaster.local:5174'
    const view = harness(account(), Object.freeze({
      httpBaseUrl: 'https://192.168.0.109:5174',
      identityBaseUrl: stableIdentity,
      webSocketBaseUrl: 'wss://192.168.0.109:5174',
    }))

    await view.access.authorize(
      { kind: 'online', account: account() },
      inventory,
      romIdentity,
      new AbortController().signal,
    )

    expect(view.access.campaignStorage.getScope()).toEqual({
      kind: 'online',
      serverUrl: stableIdentity,
      accountId: 'alice',
    })
  })

  it('déverrouille la clé seulement après une authentification cloud réussie', async () => {
    const view = harness()
    const credentials: OnlineAccountCredentials = { username: 'alice', password: 'secret-solide' }
    const signal = new AbortController().signal

    await view.access.prepareAuthentication(account(), credentials, signal)
    await view.access.prepareAuthentication(account('bob', false), credentials, signal)

    expect(view.keyring.unlock).toHaveBeenCalledOnce()
    expect(view.keyring.unlock).toHaveBeenCalledWith(
      expect.objectContaining({ id: 'alice' }),
      'secret-solide',
      signal,
    )
  })

  it('purge une clé Alice dérivée tardivement si Bob devient courant', async () => {
    const view = harness()
    const unlocking = deferred<CryptoKey>()
    vi.mocked(view.keyring.unlock).mockReturnValueOnce(unlocking.promise)
    const preparation = view.access.prepareAuthentication(
      account('alice'),
      { username: 'alice', password: 'secret-solide' },
      new AbortController().signal,
    )
    await vi.waitFor(() => { expect(view.keyring.unlock).toHaveBeenCalledOnce() })

    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    unlocking.resolve({} as CryptoKey)

    await expect(preparation).rejects.toMatchObject({ name: 'AbortError' })
    expect(view.keyring.clearMemory).toHaveBeenCalled()
  })

  it('importe la sauvegarde locale consentie avant la réconciliation cloud', async () => {
    const view = harness()
    const savedAt = '2026-08-27T15:00:00.000Z'
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date(savedAt),
    )
    createTitleSaveCloudCausalStore(view.storage).write({
      serverUrl: config.httpBaseUrl,
      accountId: 'alice',
      gameCode: 'IPKF',
      romIdentity,
    }, 1, {
      localState: { storageHash: 'A'.repeat(43), tombstoneChangedAt: null },
      remoteEtag: '"r-11111111111111111111111111111111"' as never,
      remoteMutation: `m-${'1'.repeat(32)}` as never,
    })

    const prompt = await expectLocalImportProposal(view)

    expect(prompt.transferCount).toBe(1)
    expect(view.cloud.authorize).not.toHaveBeenCalled()
    const result = await view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: prompt.proposalId },
    )

    expect(result.catalog.saves.get(1)?.restored.profile.name).toBe('LOCAL')
    expect(readHgssBrowserSaveSlot(view.storage, 'IPKF', 1)).toEqual(expect.objectContaining({ savedAt }))
    expect(readHgssBrowserSaveSlot(accountStorage(view), 'IPKF', 1)).toEqual(expect.objectContaining({ savedAt }))
    expect(view.cloud.authorize).toHaveBeenCalledOnce()
    const cloudRequest = vi.mocked(view.cloud.authorize).mock.calls[0]?.[0]
    if (!cloudRequest) throw new Error('Requête cloud attendue.')
    expect(cloudRequest.localDocuments.get(1)?.savedAt).toBe(savedAt)
    expect(cloudRequest.causalAnchors?.has(1)).toBe(false)
  })

  it('efface une suppression de compte plus ancienne quand le local importé gagne', async () => {
    const view = harness()
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    writeAccountTombstone(view, 1, '2026-08-27T14:00:00.000Z')
    const prompt = await expectLocalImportProposal(view)

    await view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: prompt.proposalId },
    )

    const cloudRequest = vi.mocked(view.cloud.authorize).mock.calls[0]?.[0]
    expect(cloudRequest.localDocuments.has(1)).toBe(true)
    expect(cloudRequest.localTombstones?.has(1)).toBe(false)
    expect([...view.storage.values.keys()].some((key) => key.includes('campaign-tombstone'))).toBe(false)
  })

  it('efface la tombstone avant une copie locale susceptible d être interrompue', async () => {
    const view = harness()
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    writeAccountTombstone(view, 1, '2026-08-27T14:00:00.000Z')
    const prompt = await expectLocalImportProposal(view)
    view.storage.failSet = (storageKey) => storageKey.includes('campaign-cache')

    await expect(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: prompt.proposalId },
    )).rejects.toThrow('a changé')

    expect([...view.storage.values.keys()].some((key) => key.includes('campaign-tombstone'))).toBe(false)
    expect(readHgssBrowserSaveSlot(view.storage, 'IPKF', 1)).toBeDefined()
    expect(view.cloud.authorize).not.toHaveBeenCalled()
  })

  it('garde le local séparé pendant un nouvel essai cloud sans reboucler', async () => {
    const view = harness()
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    const prompt = await expectLocalImportProposal(view)
    const decision = { choice: 'keep-separate' as const, proposalId: prompt.proposalId }
    vi.mocked(view.cloud.authorize)
      .mockRejectedValueOnce(new Error('Cloud temporairement indisponible.'))
      .mockResolvedValueOnce({ uploaded: 0, downloaded: 0, deletedLocally: 0 })

    await expect(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      decision,
    )).rejects.toThrow('temporairement indisponible')
    await expect(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      decision,
    )).resolves.toEqual(expect.objectContaining({ identity: 'alice' }))

    expect(view.cloud.authorize).toHaveBeenCalledTimes(2)
    expect(vi.mocked(view.cloud.authorize).mock.calls[1]?.[0].localDocuments.size).toBe(0)
    expect(readHgssBrowserSaveSlot(accountStorage(view), 'IPKF', 1)).toBeUndefined()
    expect(readHgssBrowserSaveSlot(view.storage, 'IPKF', 1)).toBeDefined()
  })

  it('ne rejoue jamais le consentement Alice sur le cache de Bob', async () => {
    const view = harness()
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    const alicePrompt = await expectLocalImportProposal(view)
    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))

    const bobAuthorization = view.access.authorize(
      { kind: 'online', account: bob },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: alicePrompt.proposalId },
    )

    await expect(bobAuthorization).rejects.toMatchObject({
      name: 'TitleSaveLocalAccountImportRequiredError',
      transferCount: 1,
    })
    await expect(bobAuthorization).rejects.not.toMatchObject({ proposalId: alicePrompt.proposalId })
    expect(readHgssBrowserSaveSlot(accountStorage(view, 'bob'), 'IPKF', 1)).toBeUndefined()
  })

  it('invalide le consentement si la version ou la langue ROM change', async () => {
    const view = harness()
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    const initial = await expectLocalImportProposal(view)

    const refreshed = await requireLocalImportProposal(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      { gameVersion: 8, language: 3 },
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: initial.proposalId },
    ))

    expect(refreshed.proposalId).not.toBe(initial.proposalId)
    expect(readHgssBrowserSaveSlot(accountStorage(view), 'IPKF', 1)).toBeUndefined()
  })

  it('invalide le consentement si l’origine serveur change', async () => {
    let serverUrl = 'https://first.example.test'
    const mutableConfig: OnlineClientConfig = {
      get httpBaseUrl() { return serverUrl },
      get identityBaseUrl() { return serverUrl },
      get webSocketBaseUrl() { return serverUrl.replace('https:', 'wss:') },
    }
    const view = harness(account(), mutableConfig)
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date('2026-08-27T15:00:00.000Z'),
    )
    const initial = await requireLocalImportProposal(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
    ))
    serverUrl = 'https://second.example.test'

    const refreshed = await requireLocalImportProposal(view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
      new Map(),
      { choice: 'import', proposalId: initial.proposalId },
    ))

    const secondServerCache = createSwitchableTitleSaveStorage(view.storage)
    secondServerCache.selectOnline(serverUrl, 'alice')
    expect(refreshed.proposalId).not.toBe(initial.proposalId)
    expect(readHgssBrowserSaveSlot(secondServerCache, 'IPKF', 1)).toBeUndefined()
  })

  it.each(['account-newer', 'identical'] as const)(
    'ne propose rien quand le cache du compte est %s',
    async (scenario) => {
      const view = harness()
      const localDocument = importDocument('LOCAL')
      const targetDocument = scenario === 'identical' ? localDocument : importDocument('COMPTE')
      const localSavedAt = '2026-08-27T14:00:00.000Z'
      const targetSavedAt = scenario === 'identical' ? localSavedAt : '2026-08-27T15:00:00.000Z'
      writeHgssDataOnlyBrowserSaveSlot(
        view.storage,
        'IPKF',
        1,
        localDocument,
        'manual',
        () => new Date(localSavedAt),
      )
      writeHgssDataOnlyBrowserSaveSlot(
        accountStorage(view),
        'IPKF',
        1,
        targetDocument,
        'manual',
        () => new Date(targetSavedAt),
      )

      const result = await view.access.authorize(
        { kind: 'online', account: account() },
        importInventory,
        romIdentity,
        new AbortController().signal,
      )

      expect(result.catalog.saves.get(1)?.savedAt).toBe(targetSavedAt)
      expect(view.cloud.authorize).toHaveBeenCalledOnce()
    },
  )

  it('préserve sans import automatique un conflit local à date égale', async () => {
    const view = harness()
    const savedAt = '2026-08-27T15:00:00.000Z'
    writeHgssDataOnlyBrowserSaveSlot(
      view.storage,
      'IPKF',
      1,
      importDocument('LOCAL'),
      'manual',
      () => new Date(savedAt),
    )
    writeHgssDataOnlyBrowserSaveSlot(
      accountStorage(view),
      'IPKF',
      1,
      importDocument('COMPTE'),
      'manual',
      () => new Date(savedAt),
    )

    const result = await view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
    )

    expect(result.catalog.saves.get(1)?.restored.profile.name).toBe('COMPTE')
    expect(readHgssBrowserSaveSlot(view.storage, 'IPKF', 1)?.value)
      .toEqual(expect.objectContaining({ profile: expect.objectContaining({ name: 'LOCAL' }) }))
  })

  it('laisse des octets locaux corrompus hors du compte sans afficher un faux import', async () => {
    const view = harness()
    const rawKey = getHgssSaveSlotStorageKey('IPKF', 2)
    view.storage.setItem(rawKey, '{broken')

    const result = await view.access.authorize(
      { kind: 'online', account: account() },
      importInventory,
      romIdentity,
      new AbortController().signal,
    )

    expect(result.catalog.saves.size).toBe(0)
    expect(result.catalog.corruptSaves.size).toBe(0)
    expect(view.storage.getItem(rawKey)).toBe('{broken')
    expect(readHgssBrowserSaveSlot(accountStorage(view), 'IPKF', 2)).toBeUndefined()
  })

  it('annule Alice si Bob devient courant pendant la restauration de clé', async () => {
    const view = harness()
    const restoration = deferred<CryptoKey | undefined>()
    vi.mocked(view.keyring.restore).mockReturnValueOnce(restoration.promise)
    const initialScope = view.access.campaignStorage.getScope()

    const authorization = view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    await vi.waitFor(() => { expect(view.keyring.restore).toHaveBeenCalledOnce() })

    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    restoration.resolve({} as CryptoKey)

    await expect(authorization).rejects.toMatchObject({ name: 'AbortError' })
    expect(view.cloud.authorize).not.toHaveBeenCalled()
    expect(view.access.campaignStorage.getScope()).toEqual(initialScope)
  })

  it('ne laisse pas une réconciliation Alice retardée désactiver le catalogue Bob déjà publié', async () => {
    const view = harness()
    const aliceCloud = deferred<{ uploaded: number, downloaded: number, deletedLocally: number }>()
    vi.mocked(view.cloud.authorize).mockReturnValueOnce(aliceCloud.promise)
    const aliceAuthorization = view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    await vi.waitFor(() => { expect(view.cloud.authorize).toHaveBeenCalledOnce() })

    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')

    await expect(view.access.authorize(
      { kind: 'online', account: bob },
      inventory,
      romIdentity,
      new AbortController().signal,
    )).resolves.toEqual(expect.objectContaining({ identity: 'bob' }))
    view.access.campaignStorage.setItem('scope-probe', 'bob-value')
    const deactivationsAfterBob = vi.mocked(view.cloud.deactivate).mock.calls.length

    aliceCloud.resolve({ uploaded: 0, downloaded: 0, deletedLocally: 0 })
    await expect(aliceAuthorization).rejects.toMatchObject({ name: 'AbortError' })

    expect(vi.mocked(view.cloud.deactivate).mock.calls.length).toBe(deactivationsAfterBob)
    expect(view.access.campaignStorage.getScope()).toEqual({
      kind: 'online',
      serverUrl: config.httpBaseUrl,
      accountId: 'bob',
    })
    expect(view.access.campaignStorage.getItem('scope-probe')).toBe('bob-value')
  })

  it('ferme immédiatement la campagne si la session est invalidée avec une identité encore cachée', async () => {
    const view = harness()
    await view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    view.access.campaignStorage.setItem('scope-probe', 'alice-value')
    vi.mocked(view.cloud.deactivate).mockClear()
    vi.mocked(view.keyring.clearMemory).mockClear()

    view.publish(Object.freeze({
      signedIn: false,
      account: account('alice'),
      isAdmin: false,
      online: false,
      premiumClient: false,
      cloudStorage: false,
      development: false,
    }))

    expect(view.cloud.deactivate).toHaveBeenCalledOnce()
    expect(view.keyring.clearMemory).toHaveBeenCalledOnce()
    expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    expect(() => { view.access.campaignStorage.setItem('scope-probe', 'unsafe') }).toThrow('sas')
    await expect(view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )).rejects.toMatchObject({ name: 'AbortError' })
    expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    expect(view.cloud.enqueuePresent).not.toHaveBeenCalled()
  })

  it('checkpoint puis ferme cloud, lease et clé avant une notification unique de logout', async () => {
    const order: string[] = []
    const releaseLease = vi.fn(() => {
      order.push('lease')
      expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    })
    const prepareCampaignInvalidation = vi.fn(() => {
      order.push('prepare')
      expect(view.access.campaignStorage.getItem('scope-probe')).toBe('alice-value')
      return true
    })
    const onCampaignInvalidated = vi.fn((event) => {
      order.push('notify')
      expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
      expect(event).toEqual({ reason: 'session-ended', checkpointSaved: true })
      expect(Object.isFrozen(event)).toBe(true)
    })
    const view = harness(account(), config, {
      prepareCampaignInvalidation,
      onCampaignInvalidated,
      campaignLeaseManager: {
        acquire: vi.fn(async () => Object.freeze({ key: 'test-lease', release: releaseLease })),
      },
    })
    await view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    view.access.campaignStorage.setItem('scope-probe', 'alice-value')
    vi.mocked(view.cloud.deactivate).mockClear()
    vi.mocked(view.cloud.deactivate).mockImplementation(() => {
      order.push('cloud')
      expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    })
    vi.mocked(view.keyring.clearMemory).mockClear()
    vi.mocked(view.keyring.clearMemory).mockImplementation(() => {
      order.push('key')
      expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    })
    const signedOut = Object.freeze({
      signedIn: false,
      account: account('alice'),
      isAdmin: false,
      online: false,
      premiumClient: false,
      cloudStorage: false,
      development: false,
    })

    view.publish(signedOut)
    view.publish(signedOut)

    expect(order).toEqual(['prepare', 'cloud', 'lease', 'key', 'notify'])
    expect(prepareCampaignInvalidation).toHaveBeenCalledOnce()
    expect(releaseLease).toHaveBeenCalledOnce()
    expect(onCampaignInvalidated).toHaveBeenCalledOnce()
  })

  it('capture les deux hooks fautifs et publie un événement borné lors du changement de compte', async () => {
    const reportStatus = vi.fn()
    const received: unknown[] = []
    const view = harness(account(), config, {
      reportStatus,
      prepareCampaignInvalidation: () => { throw new Error('secret-checkpoint') },
      onCampaignInvalidated: (event) => {
        received.push(event)
        throw new Error('secret-notification')
      },
    })
    await view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    const bob = account('bob')

    expect(() => view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))).not.toThrow()

    expect(received).toEqual([{ reason: 'account-changed', checkpointSaved: false }])
    expect(Object.keys(received[0] as object)).toEqual(['reason', 'checkpointSaved'])
    expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    expect(reportStatus).toHaveBeenCalledTimes(2)
    expect(reportStatus.mock.calls.flat().join(' ')).not.toMatch(/secret/i)
  })

  it('ne notifie ni une autorisation non publiée ni une fermeture manuelle', async () => {
    const prepareCampaignInvalidation = vi.fn(() => true)
    const onCampaignInvalidated = vi.fn()
    const view = harness(account(), config, { prepareCampaignInvalidation, onCampaignInvalidated })
    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    await view.access.authorize(
      { kind: 'online', account: bob },
      inventory,
      romIdentity,
      new AbortController().signal,
    )

    view.access.deactivateCloud()
    view.publish(Object.freeze({
      signedIn: false,
      account: undefined,
      isAdmin: false,
      online: false,
      premiumClient: false,
      cloudStorage: false,
      development: false,
    }))

    expect(prepareCampaignInvalidation).not.toHaveBeenCalled()
    expect(onCampaignInvalidated).not.toHaveBeenCalled()
  })

  it('ferme la façade campagne pendant un changement de portée et après son échec', async () => {
    const view = harness()
    await view.access.authorize(
      { kind: 'online', account: account('alice') },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    view.access.campaignStorage.setItem('scope-probe', 'alice-value')
    const bytesBeforeSwitch = new Map(view.storage.values)
    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    const restoration = deferred<CryptoKey | undefined>()
    vi.mocked(view.keyring.restore).mockReturnValueOnce(restoration.promise)
    const switching = view.access.authorize(
      { kind: 'online', account: bob },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    await vi.waitFor(() => { expect(view.keyring.restore).toHaveBeenCalledTimes(2) })

    expect(() => { view.access.campaignStorage.setItem('scope-probe', 'unsafe') }).toThrow('sas')
    expect(() => view.access.campaignStorage.getItem('scope-probe')).toThrow('sas')
    expect(view.storage.values).toEqual(bytesBeforeSwitch)
    expect('selectOnline' in view.access.campaignStorage).toBe(false)

    restoration.reject(new Error('coffre indisponible'))
    await expect(switching).rejects.toThrow('coffre indisponible')
    expect(() => { view.access.campaignStorage.removeItem('scope-probe') }).toThrow('sas')
    expect(view.storage.values).toEqual(bytesBeforeSwitch)
  })

  it('publie le cache isolé du compte seulement après la réconciliation cloud', async () => {
    const view = harness()
    const result = await view.access.authorize(
      { kind: 'online', account: account() },
      inventory,
      romIdentity,
      new AbortController().signal,
    )

    expect(view.cloud.authorize).toHaveBeenCalledOnce()
    expect(result.identity).toBe('alice')
    expect(result.cloud).toEqual({ uploaded: 0, downloaded: 0, deletedLocally: 0 })
    expect(view.access.campaignStorage.getScope()).toEqual({
      kind: 'online',
      serverUrl: config.httpBaseUrl,
      accountId: 'alice',
    })
    expect(view.access.hasPendingCloud()).toBe(true)
  })

  it('garde le mode local hors cloud et isole un compte sans droit cloud', async () => {
    const view = harness(account('alice', false))
    await view.access.authorize(
      { kind: 'online', account: account('alice', false) },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    expect(view.cloud.authorize).not.toHaveBeenCalled()
    expect(view.access.campaignStorage.getScope().kind).toBe('online')

    await view.access.authorize(
      { kind: 'local' },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    expect(view.access.campaignStorage.getScope()).toEqual({ kind: 'local' })
    expect(view.cloud.deactivate).toHaveBeenCalled()
  })

  it('ouvre hors transport le cache isolé du même compte', async () => {
    const view = harness()

    const result = await view.access.authorize(
      { kind: 'account-cache', account: account() },
      inventory,
      romIdentity,
      new AbortController().signal,
    )

    expect(view.cloud.authorize).not.toHaveBeenCalled()
    expect(result.identity).toBe('alice · hors ligne')
    expect(view.access.campaignStorage.getScope()).toEqual({
      kind: 'online',
      serverUrl: config.httpBaseUrl,
      accountId: 'alice',
    })
  })

  it.each([
    ['slot engagé seul', 'slot', 2],
    ['legacy engagé seul', 'legacy', 1],
  ] as const)('purge le raw causal %s avant de lire le cache compte', async (
    _label,
    source,
    slot,
  ) => {
    const view = harness()
    const signal = new AbortController().signal
    const accountCache = { kind: 'account-cache', account: account() } as const
    await view.access.authorize(accountCache, inventory, romIdentity, signal)

    if (source === 'slot') {
      writeHgssBrowserSaveSlot(
        view.access.campaignStorage,
        'IPKF',
        slot,
        { causalCanary: source },
      )
    } else {
      writeHgssBrowserSave(
        view.access.campaignStorage,
        'IPKF',
        { causalCanary: source },
      )
    }
    const rawKey = source === 'slot'
      ? getHgssSaveSlotStorageKey('IPKF', slot)
      : getHgssSaveStorageKey('IPKF')
    const committedRaw = view.access.campaignStorage.getItem(rawKey)
    expect(committedRaw).toEqual(expect.any(String))
    expect(view.access.campaignStorage.getItem(`${rawKey}.staging`)).toBeNull()
    const inspection = inspectHgssBrowserSaveSlot(view.access.campaignStorage, 'IPKF', slot)
    if (inspection.kind !== 'readable') throw new Error('Raw causal lisible attendu.')

    await expect(view.access.deleteSlot(slot, inspection.deletionToken)).resolves.toBe('deleted')
    expect(readTombstone(view)).toMatchObject({
      changedAt: '2026-08-27T18:00:00.000Z',
      supersededStorageHashes: [expect.stringMatching(/^[A-Za-z0-9_-]{43}$/u)],
    })

    view.access.campaignStorage.setItem(rawKey, committedRaw!)
    view.access.deactivateCloud()

    const reopened = await view.access.authorize(accountCache, inventory, romIdentity, signal)

    expect(reopened.catalog.saves.size).toBe(0)
    expect(reopened.catalog.documents.size).toBe(0)
    expect(reopened.catalog.corruptSaves.size).toBe(0)
    expect(view.access.campaignStorage.getItem(rawKey)).toBeNull()
    expect(view.access.campaignStorage.getItem(`${rawKey}.staging`)).toBeNull()
    expect(view.access.campaignStorage.getItem(getHgssSaveSlotStorageKey('IPKF', 1))).toBeNull()
    expect([...view.storage.values.keys()].some((key) => key.includes('.migration.slot.1'))).toBe(false)
    expect(readTombstone(view)).toBeDefined()
  })

  it('enfile sauvegarde et tombstone puis invalide le cloud au changement de compte', async () => {
    const view = harness()
    await view.access.authorize(
      { kind: 'online', account: account() },
      inventory,
      romIdentity,
      new AbortController().signal,
    )
    const document = { version: 1, romIdentity } as unknown as HgssFullSaveCloudPresentSnapshot['document']
    const deletionToken = storeTestSlot(view, 2)

    view.access.campaignStorage.noteSaved(2, document, { savedAt: '2026-08-27T12:00:00.000Z', kind: 'auto' })
    await view.access.deleteSlot(2, deletionToken)
    expect(view.cloud.enqueuePresent).toHaveBeenCalledWith(
      expect.objectContaining({ slot: 2, document }),
      expect.objectContaining({ storageToken: deletionToken, tombstoneChangedAt: null }),
    )
    expect(view.cloud.enqueueDeleted).toHaveBeenCalledWith(
      2,
      romIdentity,
      '2026-08-27T18:00:00.000Z',
      { storageToken: null, tombstoneChangedAt: '2026-08-27T18:00:00.000Z' },
    )

    const bob = account('bob')
    view.publish(Object.freeze({
      signedIn: true,
      account: bob,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    expect(view.cloud.deactivate).toHaveBeenCalled()
    expect(view.keyring.clearMemory).toHaveBeenCalled()
  })

  it('restaure une suppression durable après désactivation puis l’efface à la sauvegarde suivante', async () => {
    const view = harness()
    const signal = new AbortController().signal
    await view.access.authorize({ kind: 'online', account: account() }, inventory, romIdentity, signal)

    await view.access.deleteSlot(1, storeTestSlot(view, 1))
    expect(readTombstone(view)).toEqual({
      changedAt: '2026-08-27T18:00:00.000Z',
      supersededStorageHashes: [expect.any(String)],
    })

    view.access.deactivateCloud()
    await view.access.authorize({ kind: 'online', account: account() }, inventory, romIdentity, signal)
    const authorization = vi.mocked(view.cloud.authorize).mock.calls.at(-1)?.[0]
    expect(authorization?.localTombstones?.get(1)).toEqual({
      changedAt: '2026-08-27T18:00:00.000Z',
      supersededStorageHashes: [expect.any(String)],
    })

    const document = { version: 1, romIdentity } as unknown as HgssFullSaveCloudPresentSnapshot['document']
    view.access.noteSaved(1, document, { savedAt: '2026-08-27T19:00:00.000Z', kind: 'manual' })
    expect([...view.storage.values.keys()].some((key) => key.includes('campaign-tombstone'))).toBe(false)
  })

  it('restaure l ancrage causal du compte et relit le token local exact', async () => {
    const view = harness()
    const signal = new AbortController().signal
    await view.access.authorize({ kind: 'online', account: account() }, inventory, romIdentity, signal)
    const token = storeTestSlot(view, 1)
    const firstAuthorization = vi.mocked(view.cloud.authorize).mock.calls.at(-1)?.[0]
    expect(firstAuthorization?.readLocalVersion?.(1)).toEqual({
      storageToken: token,
      tombstoneChangedAt: null,
    })
    firstAuthorization?.persistCausalAnchor?.(1, Object.freeze({
      localState: Object.freeze({ storageHash: 'A'.repeat(43), tombstoneChangedAt: null }),
      remoteEtag: `"r-${'1'.repeat(32)}"` as never,
      remoteMutation: `m-${'2'.repeat(32)}` as never,
    }))

    view.access.deactivateCloud()
    await view.access.authorize({ kind: 'online', account: account() }, inventory, romIdentity, signal)
    const reopened = vi.mocked(view.cloud.authorize).mock.calls.at(-1)?.[0]
    expect(reopened?.causalAnchors?.get(1)).toEqual(expect.objectContaining({
      remoteEtag: `"r-${'1'.repeat(32)}"`,
      remoteMutation: `m-${'2'.repeat(32)}`,
    }))
  })

  it('journalise hors transport cloud et empêche la résurrection au retour du droit', async () => {
    const view = harness(account('alice', false))
    const signal = new AbortController().signal
    await view.access.authorize(
      { kind: 'online', account: account('alice', false) },
      inventory,
      romIdentity,
      signal,
    )

    await view.access.deleteSlot(3, storeTestSlot(view, 3))

    expect(view.cloud.enqueueDeleted).not.toHaveBeenCalled()
    expect(readTombstone(view)).toEqual({
      changedAt: '2026-08-27T18:00:00.000Z',
      supersededStorageHashes: [expect.any(String)],
    })

    const aliceWithCloud = account('alice', true)
    view.publish(Object.freeze({
      signedIn: true,
      account: aliceWithCloud,
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: true,
      development: false,
    }))
    await view.access.authorize(
      { kind: 'online', account: aliceWithCloud },
      inventory,
      romIdentity,
      signal,
    )
    const authorization = vi.mocked(view.cloud.authorize).mock.calls.at(-1)?.[0]
    expect(authorization?.localTombstones?.get(3)).toEqual({
      changedAt: '2026-08-27T18:00:00.000Z',
      supersededStorageHashes: [expect.any(String)],
    })
  })

  it('conserve le journal du cache actif si le droit expire pendant la partie', async () => {
    const view = harness()
    const signal = new AbortController().signal
    await view.access.authorize({ kind: 'online', account: account() }, inventory, romIdentity, signal)
    vi.mocked(view.cloud.enqueueDeleted).mockClear()

    view.publish(Object.freeze({
      signedIn: true,
      account: account('alice', false),
      isAdmin: false,
      online: true,
      premiumClient: false,
      cloudStorage: false,
      development: false,
    }))
    await view.access.deleteSlot(2, storeTestSlot(view, 2))

    expect(view.cloud.deactivate).toHaveBeenCalled()
    expect(view.cloud.enqueueDeleted).not.toHaveBeenCalled()
    expect([...view.storage.values.keys()].some((key) => key.includes('campaign-tombstone'))).toBe(true)
  })
})
