import { describe, expect, it } from 'vitest'
import { resolveHgssBattleVictoryMusic, resolveHgssTrainerBattleMusic, resolveHgssWildBattleMusic } from './hgssBattleMusic'

describe('musique de combat HGSS', () => {
  it('sélectionne les thèmes des classes spéciales de la ROM', () => {
    expect(resolveHgssTrainerBattleMusic(66, 0)).toBe(1118)
    expect(resolveHgssTrainerBattleMusic(103, 1)).toBe(1127)
    expect(resolveHgssTrainerBattleMusic(23, 0)).toBe(1119)
    expect(resolveHgssTrainerBattleMusic(55, 0)).toBe(1120)
    expect(resolveHgssTrainerBattleMusic(109, 1)).toBe(1124)
  })

  it('sélectionne les légendaires et les variantes régionales sauvages', () => {
    expect(resolveHgssWildBattleMusic(250, 0)).toBe(1132)
    expect(resolveHgssWildBattleMusic(243, 0)).toBe(1123)
    expect(resolveHgssWildBattleMusic(384, 0)).toBe(1174)
    expect(resolveHgssWildBattleMusic(16, 1)).toBe(1125)
  })

  it('sélectionne les quatre familles de victoire natives', () => {
    expect(resolveHgssBattleVictoryMusic('wild')).toBe(1129)
    expect(resolveHgssBattleVictoryMusic('trainer', 1)).toBe(1128)
    expect(resolveHgssBattleVictoryMusic('trainer', 66)).toBe(1131)
    expect(resolveHgssBattleVictoryMusic('trainer', 112)).toBe(1131)
    expect(resolveHgssBattleVictoryMusic('trainer', 97)).toBe(1148)
  })
})
