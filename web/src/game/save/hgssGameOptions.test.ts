import { describe, expect, it } from 'vitest'
import { createDefaultHgssGameOptions, getHgssGameOptionsStorageKey, getHgssTextFrameDelay, readHgssGameOptions, stepHgssTextSpeed, writeHgssGameOptions } from './hgssGameOptions'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
}

describe('HGSS game options storage', () => {
  it('reproduit les délais lent, normal et rapide de la ROM', () => {
    expect(getHgssTextFrameDelay('slow')).toBe(8)
    expect(getHgssTextFrameDelay('normal')).toBe(4)
    expect(getHgssTextFrameDelay('fast')).toBe(1)
  })

  it('parcourt la vitesse native dans les deux sens pour gauche/droite', () => {
    expect(stepHgssTextSpeed('normal', -1)).toBe('slow')
    expect(stepHgssTextSpeed('normal', 1)).toBe('fast')
    expect(stepHgssTextSpeed('slow', -1)).toBe('fast')
    expect(stepHgssTextSpeed('fast', 1)).toBe('slow')
  })

  it('persists options independently for each ROM game code', () => {
    const storage = new MemoryStorage()
    writeHgssGameOptions(storage, 'IPKF', { textSpeed: 'fast', battleAnimations: false, localWeather: true })

    expect(readHgssGameOptions(storage, 'IPKF')).toEqual({ textSpeed: 'fast', battleAnimations: false, localWeather: true })
    expect(readHgssGameOptions(storage, 'IPKE')).toBeUndefined()
  })

  it('migrates options saved before local weather existed without requesting location', () => {
    const storage = new MemoryStorage()
    storage.setItem(getHgssGameOptionsStorageKey('IPKF'), JSON.stringify({
      version: 1,
      gameCode: 'IPKF',
      options: { textSpeed: 'normal', battleAnimations: true },
    }))

    expect(readHgssGameOptions(storage, 'IPKF')).toEqual({ textSpeed: 'normal', battleAnimations: true, localWeather: false })
  })

  it('rejects corrupt settings instead of silently replacing them', () => {
    const storage = new MemoryStorage()
    storage.setItem(getHgssGameOptionsStorageKey('IPKF'), JSON.stringify({
      version: 1,
      gameCode: 'IPKF',
      options: { textSpeed: 'instant', battleAnimations: true },
    }))

    expect(() => readHgssGameOptions(storage, 'IPKF')).toThrow('vitesse')
    expect(createDefaultHgssGameOptions()).toEqual({ textSpeed: 'normal', battleAnimations: true, localWeather: false })
  })
})
