import { describe, expect, it } from 'vitest'
import {
  decodeHardcoreConfig,
  defaultHardcoreConfig,
  hardcoreModule,
} from './hardcoreModule'

describe('configuration du module Hardcore', () => {
  it('déclare un défaut neutre explicite sans inventer de niveau de boss', () => {
    expect(defaultHardcoreConfig.levelCaps[0]).toEqual({
      progression: 0,
      nextMajorBattleId: 0,
      levelCap: 13,
    })
    expect(defaultHardcoreConfig.levelCaps.at(-1)).toEqual({
      progression: 16,
      nextMajorBattleId: 11,
      levelCap: 88,
    })
    expect(hardcoreModule.createDefaultConfig()).toEqual(defaultHardcoreConfig)
    expect(hardcoreModule.enabledByDefault).toBe(false)
  })

  it('accepte, copie et fige une table complète déjà ordonnée', () => {
    const source = {
      levelCaps: [
        { progression: 0, nextMajorBattle: 'Arène Alpha', levelCap: 13 },
        { progression: 1, nextMajorBattle: 'Arène Bêta', levelCap: 17 },
        { progression: 4, nextMajorBattle: 'Ligue', levelCap: 50 },
      ],
    }
    const decoded = decodeHardcoreConfig(source)

    expect(decoded).toEqual({ levelCaps: [
      { progression: 0, nextMajorBattleId: 0, levelCap: 13 },
      { progression: 1, nextMajorBattleId: 1, levelCap: 17 },
      { progression: 4, nextMajorBattleId: 2, levelCap: 50 },
    ] })
    expect(decoded).not.toBe(source)
    expect(decoded.levelCaps).not.toBe(source.levelCaps)
    expect(Object.isFrozen(decoded)).toBe(true)
    expect(Object.isFrozen(decoded.levelCaps)).toBe(true)
    expect(Object.isFrozen(decoded.levelCaps[0])).toBe(true)
  })

  it.each([
    [{ levelCaps: [], extra: true }],
    [{ levelCaps: [] }],
    [{ levelCaps: [{ progression: 1, nextMajorBattle: 'Alpha', levelCap: 13 }] }],
    [{ levelCaps: [
      { progression: 0, nextMajorBattle: 'Alpha', levelCap: 13 },
      { progression: 0, nextMajorBattle: 'Bêta', levelCap: 17 },
    ] }],
    [{ levelCaps: [
      { progression: 0, nextMajorBattle: 'Alpha', levelCap: 17 },
      { progression: 1, nextMajorBattle: 'Bêta', levelCap: 13 },
    ] }],
    [{ levelCaps: [{ progression: 0, nextMajorBattle: ' Alpha', levelCap: 13 }] }],
    [{ levelCaps: [{ progression: 0, nextMajorBattle: 'Alpha', levelCap: 101 }] }],
    [{ levelCaps: [{ progression: 0, nextMajorBattle: 'Alpha', levelCap: 13, hidden: true }] }],
    [new Date()],
  ])('refuse la configuration JSON ambiguë %#', (value) => {
    expect(() => decodeHardcoreConfig(value)).toThrow()
    expect(() => hardcoreModule.decodeConfig(value)).toThrow()
  })
})
