import { describe, expect, it } from 'vitest'
import {
  deleteNewGamePlusEntitlement,
  getNewGamePlusEntitlementStorageKey,
  markNewGamePlusEntitlementAnnounced,
  readNewGamePlusEntitlement,
  reconcileNewGamePlusEntitlement,
  validateNewGamePlusEntitlement,
  writeNewGamePlusEntitlement,
} from './newGamePlusEntitlementStorage'

class MemoryStorage {
  readonly values = new Map<string, string>()
  writes = 0

  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.writes += 1; this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('New Game+ entitlement storage', () => {
  it('stores a checksummed entitlement atomically and isolates each ROM', () => {
    const storage = new MemoryStorage()
    const entitlement = writeNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF',
      unlockedAt: '2026-08-24T10:20:30.000Z',
      sourceSlot: 1,
    })
    const key = getNewGamePlusEntitlementStorageKey('IPKF')

    expect(entitlement).toEqual({ gameCode: 'IPKF', unlockedAt: '2026-08-24T10:20:30.000Z', sourceSlot: 1 })
    expect(storage.values.get(key)).toContain('pokemaster-hgss-new-game-plus-entitlement')
    expect(storage.values.has(`${key}.staging`)).toBe(false)
    expect(readNewGamePlusEntitlement(storage, 'IPKF')).toEqual(entitlement)
    expect(readNewGamePlusEntitlement(storage, 'IPGE')).toBeUndefined()
  })

  it('rejects corruption and a payload copied under another ROM key', () => {
    const storage = new MemoryStorage()
    writeNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-24T10:20:30.000Z', sourceSlot: 1,
    })
    const key = getNewGamePlusEntitlementStorageKey('IPKF')
    const encoded = storage.values.get(key)!
    storage.values.set(key, encoded.replace('2026-08-24', '2026-08-25'))
    expect(() => readNewGamePlusEntitlement(storage, 'IPKF')).toThrow('checksum')

    storage.values.set(getNewGamePlusEntitlementStorageKey('IPGE'), encoded)
    expect(() => readNewGamePlusEntitlement(storage, 'IPGE')).toThrow('ne correspond pas')
  })

  it('peut supprimer uniquement la métadonnée corrompue avant une réconciliation prouvée par une sauvegarde', () => {
    const storage = new MemoryStorage()
    const key = getNewGamePlusEntitlementStorageKey('IPKF')
    storage.values.set(key, '{broken')
    storage.values.set(`${key}.staging`, '{broken-too')

    deleteNewGamePlusEntitlement(storage, 'IPKF')

    expect(storage.values.has(key)).toBe(false)
    expect(storage.values.has(`${key}.staging`)).toBe(false)
    expect(readNewGamePlusEntitlement(storage, 'IPKF')).toBeUndefined()
  })

  it('recovers a valid staged entitlement and discards a corrupt staging value', () => {
    const committedStorage = new MemoryStorage()
    const stagedStorage = new MemoryStorage()
    const key = getNewGamePlusEntitlementStorageKey('IPKF')
    writeNewGamePlusEntitlement(committedStorage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 1,
    })
    writeNewGamePlusEntitlement(stagedStorage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-23T09:00:00.000Z', sourceSlot: 2,
    })
    committedStorage.values.set(`${key}.staging`, stagedStorage.values.get(key)!)

    expect(readNewGamePlusEntitlement(committedStorage, 'IPKF')).toMatchObject({
      unlockedAt: '2026-08-23T09:00:00.000Z', sourceSlot: 2,
    })
    expect(committedStorage.values.get(key)).toBe(stagedStorage.values.get(key))
    expect(committedStorage.values.has(`${key}.staging`)).toBe(false)

    committedStorage.values.set(`${key}.staging`, '{broken')
    expect(readNewGamePlusEntitlement(committedStorage, 'IPKF')).toMatchObject({ sourceSlot: 2 })
    expect(committedStorage.values.has(`${key}.staging`)).toBe(false)
  })

  it('reconciles League-clear evidence deterministically and without redundant writes', () => {
    const storage = new MemoryStorage()
    reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 2,
    })
    const afterFirstUnlock = storage.writes

    expect(reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-25T10:00:00.000Z', sourceSlot: 1,
    })).toMatchObject({ unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 2 })
    expect(storage.writes).toBe(afterFirstUnlock)

    expect(reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-23T10:00:00.000Z', sourceSlot: 3,
    })).toMatchObject({ unlockedAt: '2026-08-23T10:00:00.000Z', sourceSlot: 3 })
    expect(reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-23T10:00:00.000Z', sourceSlot: 1,
    })).toMatchObject({ unlockedAt: '2026-08-23T10:00:00.000Z', sourceSlot: 1 })
  })

  it('records the unlock announcement once and preserves it during reconciliation', () => {
    const storage = new MemoryStorage()
    reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 1,
    })
    const announced = markNewGamePlusEntitlementAnnounced(
      storage,
      'IPKF',
      () => new Date('2026-08-24T11:00:00.000Z'),
    )
    const afterAnnouncement = storage.writes

    expect(announced.announcedAt).toBe('2026-08-24T11:00:00.000Z')
    expect(markNewGamePlusEntitlementAnnounced(
      storage,
      'IPKF',
      () => new Date('2026-08-26T11:00:00.000Z'),
    ).announcedAt).toBe('2026-08-24T11:00:00.000Z')
    expect(storage.writes).toBe(afterAnnouncement)
    expect(reconcileNewGamePlusEntitlement(storage, {
      gameCode: 'IPKF', unlockedAt: '2026-08-25T10:00:00.000Z', sourceSlot: 2,
    }).announcedAt).toBe('2026-08-24T11:00:00.000Z')
  })

  it('validates identifiers, timestamps, source slots and announcement order', () => {
    expect(() => validateNewGamePlusEntitlement({
      gameCode: 'IPK', unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 1,
    })).toThrow('code ROM')
    expect(() => validateNewGamePlusEntitlement({
      gameCode: 'IPKF', unlockedAt: 'yesterday', sourceSlot: 1,
    })).toThrow('unlockedAt')
    expect(() => validateNewGamePlusEntitlement({
      gameCode: 'IPKF', unlockedAt: '2026-08-24T10:00:00.000Z', sourceSlot: 4,
    })).toThrow('source')
    expect(() => validateNewGamePlusEntitlement({
      gameCode: 'IPKF',
      unlockedAt: '2026-08-24T10:00:00.000Z',
      announcedAt: '2026-08-24T09:00:00.000Z',
      sourceSlot: 1,
    })).toThrow('précéder')
    expect(() => markNewGamePlusEntitlementAnnounced(new MemoryStorage(), 'IPKF')).toThrow('pas débloqué')
  })
})
