import { describe, expect, it } from 'vitest'
import {
  createTitleSaveCampaignLeaseManager,
  titleSaveCampaignLeaseKey,
} from './titleSaveCampaignLease'

class FakeLockManager {
  private readonly held = new Set<string>()

  request = async <T>(
    name: string,
    options: LockOptions,
    callback: LockGrantedCallback<T>,
  ): Promise<T> => {
    if (options.ifAvailable && this.held.has(name)) return callback(null)
    this.held.add(name)
    try {
      return await callback({ name, mode: 'exclusive' } as Lock)
    } finally {
      this.held.delete(name)
    }
  }
}

const localScope = Object.freeze({ kind: 'local' as const, gameCode: 'IPKF' })

describe('bail exclusif de campagne', () => {
  it('canonise la portée physique sans séparer deux identités ROM du même cache', () => {
    expect(titleSaveCampaignLeaseKey({
      kind: 'online',
      serverUrl: 'https://ONLINE.example.test:443/path/',
      accountId: 'alice',
      gameCode: 'IPKF',
    })).toBe('pokemaster:campaign-lease:v1:online:https%3A%2F%2Fonline.example.test%2Fpath:alice:IPKF')
    expect(titleSaveCampaignLeaseKey(localScope)).toBe('pokemaster:campaign-lease:v1:local:IPKF')
  })

  it('refuse un second onglet jusqu’à la libération du premier', async () => {
    const locks = new FakeLockManager()
    const manager = createTitleSaveCampaignLeaseManager(locks)
    const first = await manager.acquire(localScope, new AbortController().signal)

    await expect(manager.acquire(localScope, new AbortController().signal)).resolves.toBeUndefined()
    first?.release()
    await new Promise((resolve) => { setTimeout(resolve, 0) })

    const next = await manager.acquire(localScope, new AbortController().signal)
    expect(next?.key).toBe(titleSaveCampaignLeaseKey(localScope))
    next?.release()
  })

  it('conserve le verrou après acquisition malgré le timeout de l’autorisation', async () => {
    const locks = new FakeLockManager()
    const manager = createTitleSaveCampaignLeaseManager(locks)
    const controller = new AbortController()
    const lease = await manager.acquire(localScope, controller.signal)

    controller.abort()
    await expect(manager.acquire(localScope, new AbortController().signal)).resolves.toBeUndefined()
    lease?.release()
  })

  it('garde un chemin mono-contexte quand Web Locks est absent', async () => {
    const lease = await createTitleSaveCampaignLeaseManager(undefined).acquire(
      localScope,
      new AbortController().signal,
    )
    expect(lease?.key).toBe(titleSaveCampaignLeaseKey(localScope))
    expect(() => lease?.release()).not.toThrow()
  })
})
