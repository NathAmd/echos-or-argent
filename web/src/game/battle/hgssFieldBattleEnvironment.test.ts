import { describe, expect, it } from 'vitest'
import { resolveHgssFieldBattleBackgroundId, resolveHgssFieldBattleEnvironment, resolveHgssFieldBattleTerrainId } from './hgssFieldBattleEnvironment'

describe('environnement de combat de terrain HGSS', () => {
  it('respecte la priorité exacte des comportements de dalle de la ROM', () => {
    expect(resolveHgssFieldBattleTerrainId(32, 3)).toBe(8)
    expect(resolveHgssFieldBattleTerrainId(2, 1)).toBe(2)
    expect(resolveHgssFieldBattleTerrainId(3, 1)).toBe(2)
    expect(resolveHgssFieldBattleTerrainId(33, 1)).toBe(1)
    expect(resolveHgssFieldBattleTerrainId(168, 1)).toBe(6)
    expect(resolveHgssFieldBattleTerrainId(164, 1)).toBe(10)
    expect(resolveHgssFieldBattleTerrainId(8, 1)).toBe(5)
    expect(resolveHgssFieldBattleTerrainId(16, 0)).toBe(7)
    expect(resolveHgssFieldBattleTerrainId(124, 0)).toBe(7)
  })

  it('reproduit toute la table décor vers terrain de battle_setup.c', () => {
    expect(Array.from({ length: 23 }, (_, backgroundId) => resolveHgssFieldBattleTerrainId(0, backgroundId))).toEqual([
      0, 7, 9, 2, 4, 6, 9, 9, 9, 5, 5, 5, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ])
  })

  it('force le décor océan seulement lorsque PlayerAvatar surfe', () => {
    expect(resolveHgssFieldBattleBackgroundId(4, 'surfing')).toBe(1)
    expect(resolveHgssFieldBattleEnvironment({ terrainAttribute: 16, mapBattleBackgroundId: 4, locomotion: 'surfing' })).toEqual({ backgroundId: 1, terrainId: 7 })
    expect(resolveHgssFieldBattleEnvironment({ terrainAttribute: 0, mapBattleBackgroundId: 4, locomotion: 'walking' })).toEqual({ backgroundId: 4, terrainId: 4 })
  })

  it('refuse un décor impossible au lieu de fabriquer un terrain', () => {
    expect(() => resolveHgssFieldBattleTerrainId(0, 23)).toThrow(/23/)
    expect(() => resolveHgssFieldBattleBackgroundId(-1, 'walking')).toThrow(/-1/)
  })
})
