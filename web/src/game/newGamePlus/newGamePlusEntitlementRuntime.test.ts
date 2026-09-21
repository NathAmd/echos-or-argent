import { describe, expect, it, vi } from 'vitest'
import { createNewGamePlusEntitlementRuntime } from './newGamePlusEntitlementRuntime'
import { readNewGamePlusEntitlement } from './newGamePlusEntitlementStorage'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

describe('runtime de déblocage New Game+', () => {
  it('attend à la fois la fin complète du script et la sauvegarde réussie', () => {
    const storage = new MemoryStorage()
    const onUnlocked = vi.fn()
    const runtime = createNewGamePlusEntitlementRuntime(storage, { onUnlocked, reportStatus: vi.fn() })
    runtime.reconcile('IPKF', [])
    runtime.noteGameClear(true)
    runtime.completeFieldScript(false, undefined, 1)

    expect(onUnlocked).not.toHaveBeenCalled()
    expect(readNewGamePlusEntitlement(storage, 'IPKF')).toBeUndefined()

    runtime.noteGameClear(true)
    runtime.completeFieldScript(true, '2026-08-25T00:00:00.000Z', 1)
    expect(onUnlocked).toHaveBeenCalledOnce()
    expect(readNewGamePlusEntitlement(storage, 'IPKF')).toMatchObject({ sourceSlot: 1 })
  })

  it('ignore Red, les replays sans firstClear et une scène annulée', () => {
    const onUnlocked = vi.fn()
    const runtime = createNewGamePlusEntitlementRuntime(new MemoryStorage(), { onUnlocked, reportStatus: vi.fn() })
    runtime.reconcile('IPKF', [])
    runtime.noteGameClear(false)
    runtime.completeFieldScript(true, '2026-08-25T00:00:00.000Z', 1)
    runtime.noteGameClear(true)
    runtime.cancelPendingGameClear()
    runtime.completeFieldScript(true, '2026-08-25T00:00:00.000Z', 1)
    expect(onUnlocked).not.toHaveBeenCalled()
  })
})
