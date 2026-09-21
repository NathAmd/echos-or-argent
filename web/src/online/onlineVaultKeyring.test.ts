import { describe, expect, it, vi } from 'vitest'
import type { OnlineAccount } from './onlineAccountSession'
import { exportOpaqueVaultKey } from './opaqueJsonVault'
import { createOnlineVaultKeyring } from './onlineVaultKeyring'

class MemoryStorage {
  readonly values = new Map<string, string>()
  readonly getItem = vi.fn((key: string) => this.values.get(key) ?? null)
  readonly setItem = vi.fn((key: string, value: string) => { this.values.set(key, value) })
  readonly removeItem = vi.fn((key: string) => { this.values.delete(key) })
}

function account(id: string): OnlineAccount {
  return Object.freeze({
    id,
    username: id,
    role: 'user',
    entitlements: Object.freeze(['cloud-storage']),
    vaultKeyId: id === 'alice'
      ? 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'
      : 'BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB',
  })
}

const alice = account('alice')
const password = 'correct horse battery staple'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('trousseau de clés du coffre en ligne', () => {
  it('dérive la même clé stable lorsque le domaine et le port du serveur changent', async () => {
    const firstStorage = new MemoryStorage()
    const secondStorage = new MemoryStorage()
    const first = createOnlineVaultKeyring({
      serverUrl: 'https://online.example.test/api',
      storage: firstStorage,
    })
    const second = createOnlineVaultKeyring({
      serverUrl: 'https://backup.example.test:9443',
      storage: secondStorage,
    })

    const [firstKey, secondKey] = await Promise.all([
      first.unlock(alice, password),
      second.unlock(alice, password),
    ])

    await expect(exportOpaqueVaultKey(firstKey)).resolves.toBe(await exportOpaqueVaultKey(secondKey))
    expect([...firstStorage.values.values()]).toEqual([...secondStorage.values.values()])
  })

  it('sépare cryptographiquement le compte et le mot de passe sans dépendre du serveur', async () => {
    const storage = new MemoryStorage()
    const primary = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage })
    const otherServer = createOnlineVaultKeyring({ serverUrl: 'https://backup.example.test', storage })

    const keys = await Promise.all([
      primary.unlock(alice, password),
      primary.unlock(account('bob'), password),
      primary.unlock(alice, `${password}!`),
      otherServer.unlock(alice, password),
    ])
    const exported = await Promise.all(keys.map(exportOpaqueVaultKey))

    expect(exported[0]).toBe(exported[3])
    expect(new Set(exported).size).toBe(3)
    expect(storage.values.size).toBe(2)
    const persisted = JSON.stringify([...storage.values.entries()])
    expect(persisted).not.toContain(password)
    expect(persisted).not.toContain('alice')
    expect(persisted).not.toContain('online.example.test')
  })

  it('conserve la dérivation URL v1 avec un serveur de comptes hérité', async () => {
    const legacyAlice = { ...alice, vaultKeyId: undefined }
    const primary = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage: new MemoryStorage() })
    const other = createOnlineVaultKeyring({ serverUrl: 'https://backup.example.test', storage: new MemoryStorage() })

    const [primaryKey, otherKey] = await Promise.all([
      primary.unlock(legacyAlice, password),
      other.unlock(legacyAlice, password),
    ])

    await expect(exportOpaqueVaultKey(primaryKey)).resolves.not.toBe(await exportOpaqueVaultKey(otherKey))
  })

  it('restaure la seule clé exportée sans redemander ni conserver le mot de passe', async () => {
    const storage = new MemoryStorage()
    const original = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage })
    const unlocked = await original.unlock(alice, password)
    const exported = await exportOpaqueVaultKey(unlocked)
    expect([...storage.values.values()]).toEqual([exported])

    original.clearMemory()
    const restoredInPlace = await original.restore(alice)
    expect(restoredInPlace).toBeDefined()
    await expect(exportOpaqueVaultKey(restoredInPlace!)).resolves.toBe(exported)

    const restarted = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage })
    const restoredAfterRestart = await restarted.restore(alice)
    expect(restoredAfterRestart).toBeDefined()
    await expect(exportOpaqueVaultKey(restoredAfterRestart!)).resolves.toBe(exported)
    await expect(restarted.restore(account('bob'))).resolves.toBeUndefined()
  })

  it('ignore puis supprime une entrée de stockage corrompue', async () => {
    const storage = new MemoryStorage()
    const keyring = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage })
    await keyring.unlock(alice, password)
    const storageKey = [...storage.values.keys()][0]
    if (!storageKey) throw new Error('Clé de test absente')
    storage.values.set(storageKey, JSON.stringify({ password, key: 'not-a-key' }))

    const restarted = createOnlineVaultKeyring({ serverUrl: 'https://online.example.test', storage })

    await expect(restarted.restore(alice)).resolves.toBeUndefined()
    expect(storage.removeItem).toHaveBeenCalledWith(storageKey)
    expect(storage.values.has(storageKey)).toBe(false)
  })

  it('utilise intégralement le fournisseur Web Crypto injecté', async () => {
    const storage = new MemoryStorage()
    const keyring = createOnlineVaultKeyring({
      serverUrl: 'https://online.example.test',
      storage,
      crypto: globalThis.crypto,
    })

    const unlocked = await keyring.unlock(alice, 'mot-de-passe-avec-emoji-🔑')
    keyring.clearMemory()
    const restored = await keyring.restore(alice)

    expect(restored).toBeDefined()
    await expect(exportOpaqueVaultKey(restored!)).resolves.toBe(await exportOpaqueVaultKey(unlocked))
  })

  it('ne publie ni ne persiste une clé si la dérivation est annulée avant sa réponse', async () => {
    const storage = new MemoryStorage()
    const derivation = deferred<CryptoKey>()
    const derivedKey = {} as CryptoKey
    const digest = vi.fn(async () => new Uint8Array(32).buffer)
    const importKey = vi.fn(async () => ({} as CryptoKey))
    const deriveKey = vi.fn(() => derivation.promise)
    const exportKey = vi.fn(async () => new Uint8Array(32).buffer)
    const crypto = {
      subtle: { digest, importKey, deriveKey, exportKey },
    } as unknown as Crypto
    const keyring = createOnlineVaultKeyring({
      serverUrl: 'https://online.example.test',
      storage,
      crypto,
    })
    const controller = new AbortController()

    const unlocking = keyring.unlock(alice, password, controller.signal)
    await vi.waitFor(() => { expect(deriveKey).toHaveBeenCalledOnce() })
    controller.abort()
    derivation.resolve(derivedKey)

    await expect(unlocking).rejects.toMatchObject({ name: 'AbortError' })
    expect(exportKey).not.toHaveBeenCalled()
    expect(storage.setItem).not.toHaveBeenCalled()
    expect(storage.values.size).toBe(0)
    await expect(keyring.restore(alice)).resolves.toBeUndefined()
  })
})
