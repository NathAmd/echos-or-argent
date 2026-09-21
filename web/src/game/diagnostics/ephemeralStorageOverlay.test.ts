import { describe, expect, it, vi } from 'vitest'
import { getHgssSaveSlotStorageKey, getHgssSaveStorageKey } from '../save/hgssSaveStorage'
import { createEphemeralStorageOverlay, maskHgssCampaignSavesInOverlay } from './ephemeralStorageOverlay'

describe('surcouche de stockage jetable', () => {
  it('lit la base puis masque écritures et suppressions sans jamais la muter', () => {
    const baseValues = new Map([['save:1', 'normal'], ['save:2', 'normal-2']])
    const base = {
      getItem: vi.fn((key: string) => baseValues.get(key) ?? null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    }
    const overlay = createEphemeralStorageOverlay(base)

    expect(overlay.getItem('save:1')).toBe('normal')
    overlay.setItem('save:1', 'debug')
    overlay.removeItem('save:2')
    overlay.setItem('new', 'value')

    expect(overlay.getItem('save:1')).toBe('debug')
    expect(overlay.getItem('save:2')).toBeNull()
    expect(overlay.getItem('new')).toBe('value')
    expect(base.setItem).not.toHaveBeenCalled()
    expect(base.removeItem).not.toHaveBeenCalled()
    expect(baseValues).toEqual(new Map([['save:1', 'normal'], ['save:2', 'normal-2']]))
  })

  it('masque les trois slots et l’ancien format pour une ouverture déterministe', () => {
    const keys = [
      getHgssSaveStorageKey('IPKF'), `${getHgssSaveStorageKey('IPKF')}.staging`,
      ...([1, 2, 3] as const).flatMap((slot) => [getHgssSaveSlotStorageKey('IPKF', slot), `${getHgssSaveSlotStorageKey('IPKF', slot)}.staging`]),
    ]
    const baseValues = new Map(keys.map((key) => [key, 'réel']))
    const overlay = createEphemeralStorageOverlay({
      getItem: (key) => baseValues.get(key) ?? null,
      setItem: (key, value) => { baseValues.set(key, value) },
      removeItem: (key) => { baseValues.delete(key) },
    })

    maskHgssCampaignSavesInOverlay(overlay, 'IPKF')

    expect(keys.every((key) => overlay.getItem(key) === null)).toBe(true)
    expect(keys.every((key) => baseValues.get(key) === 'réel')).toBe(true)
  })
})
