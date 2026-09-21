import { describe, expect, it } from 'vitest'
import { getHgssSaveSlotStorageKey } from '../save/hgssSaveStorage'
import {
  createSwitchableTitleSaveStorage,
  createTitleSaveTombstoneStore,
  fingerprintTitleSaveStorageToken,
} from './titleSaveStorageScope'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('portée locale du stockage de sauvegarde au titre', () => {
  it('conserve SHA-256 sur une WebView dépourvue de WebCrypto', async () => {
    await expect(fingerprintTitleSaveStorageToken('abc' as never, { crypto: null })).resolves.toBe(
      'ungWv48Bz-pBQUDeXa4iI7ADYaOWF3qctBD_YfIAFa0',
    )
  })

  it('isole deux comptes et revient aux octets locaux sans changer de façade', () => {
    const base = new MemoryStorage()
    const storage = createSwitchableTitleSaveStorage(base)
    const key = getHgssSaveSlotStorageKey('IPKF', 1)
    storage.setItem(key, 'local')

    storage.selectOnline('https://online.example.test/', 'alice')
    expect(storage.getItem(key)).toBeNull()
    storage.setItem(key, 'alice')

    storage.selectOnline('https://online.example.test', 'bob')
    expect(storage.getItem(key)).toBeNull()
    storage.setItem(key, 'bob')

    storage.selectOnline('https://online.example.test', 'alice')
    expect(storage.getItem(key)).toBe('alice')
    storage.selectLocal()
    expect(storage.getItem(key)).toBe('local')
  })

  it('ne copie jamais implicitement les octets locaux dans un compte', () => {
    const base = new MemoryStorage()
    const storage = createSwitchableTitleSaveStorage(base)
    const key = getHgssSaveSlotStorageKey('IPKF', 1)
    storage.setItem(key, 'local-prive')

    storage.selectOnline('https://online.example.test', 'alice')
    expect(storage.getItem(key)).toBeNull()
    storage.setItem(key, 'alice')

    storage.selectOnline('https://other.example.test', 'bob')
    expect(storage.getItem(key)).toBeNull()

    storage.selectLocal()
    expect(storage.getItem(key)).toBe('local-prive')
  })

  it('canonise le serveur et refuse les identités ou codes invalides', () => {
    const storage = createSwitchableTitleSaveStorage(new MemoryStorage())
    storage.selectOnline('https://ONLINE.example.test:443/path/', 'alice')
    expect(storage.getScope()).toEqual({
      kind: 'online',
      serverUrl: 'https://online.example.test/path',
      accountId: 'alice',
    })
    expect(() => storage.selectOnline('https://online.example.test', '../alice')).toThrow('identité')
  })

  it('conserve les tombstones après recréation et les isole par serveur, compte, ROM et slot', () => {
    const base = new MemoryStorage()
    const context = Object.freeze({
      serverUrl: 'https://online.example.test/',
      accountId: 'alice',
      gameCode: 'IPKF',
      romIdentity: Object.freeze({ gameVersion: 7, language: 3 }),
    })
    const changedAt = '2026-08-27T18:00:00.000Z'
    createTitleSaveTombstoneStore(base).write(context, 1, changedAt)

    const restored = createTitleSaveTombstoneStore(base)
    expect(restored.read(context).get(1)).toEqual({ changedAt })
    expect(restored.read({ ...context, serverUrl: 'https://other.example.test' })).toEqual(new Map())
    expect(restored.read({ ...context, accountId: 'bob' })).toEqual(new Map())
    expect(restored.read({ ...context, gameCode: 'IPGE' })).toEqual(new Map())
    expect(restored.read({
      ...context,
      romIdentity: { gameVersion: 8, language: 3 },
    })).toEqual(new Map())
    expect(restored.read(context).has(2)).toBe(false)

    restored.clear(context, 1)
    expect(restored.read(context)).toEqual(new Map())
  })

  it('conserve la preuve explicite qu une suppression distante visait un slot vide', () => {
    const base = new MemoryStorage()
    const context = Object.freeze({
      serverUrl: 'https://online.example.test/',
      accountId: 'alice',
      gameCode: 'IPKF',
      romIdentity: Object.freeze({ gameVersion: 7, language: 3 }),
    })
    const changedAt = '2026-08-27T18:00:00.000Z'

    createTitleSaveTombstoneStore(base).write(context, 1, changedAt, [])

    expect(createTitleSaveTombstoneStore(base).read(context).get(1)).toEqual({
      changedAt,
      supersededStorageHashes: [],
    })
  })

  it('bloque la synchronisation si le journal durable est corrompu', () => {
    const base = new MemoryStorage()
    const context = {
      serverUrl: 'https://online.example.test',
      accountId: 'alice',
      gameCode: 'IPKF',
      romIdentity: { gameVersion: 7, language: 3 },
    }
    createTitleSaveTombstoneStore(base).write(context, 1, '2026-08-27T18:00:00.000Z')
    const key = [...base.values.keys()].find((candidate) => candidate.includes('campaign-tombstone'))!
    base.setItem(key, '{"changedAt":"pas-une-date"}')

    expect(() => createTitleSaveTombstoneStore(base).read(context)).toThrow('horodatage')
  })
})
