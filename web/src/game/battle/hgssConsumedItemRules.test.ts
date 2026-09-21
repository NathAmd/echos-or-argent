import { describe, expect, it } from 'vitest'
import { resolveHgssConsumedItemEffect } from './hgssConsumedItemRules'

describe('effets consommables Pluck/Fling HGSS', () => {
  it('décode les 30 identifiants natifs sans trou ni valeur inventée', () => {
    expect(Array.from({ length: 30 }, (_, index) => resolveHgssConsumedItemEffect(index + 1, 10, 100, 0).kind)).toEqual([
      'cure', 'cure', 'cure', 'cure', 'cure', 'restorePp', 'heal', 'cure', 'cure', 'heal',
      'heal', 'heal', 'heal', 'heal', 'heal', 'raiseStat', 'raiseStat', 'raiseStat', 'raiseStat', 'raiseStat',
      'focusEnergy', 'raiseRandomStat', 'nextMoveAccuracy', 'restoreLoweredStats', 'cureInfatuation',
      'flinch', 'inflict', 'inflict', 'inflict', 'inflict',
    ])
  })

  it('utilise le paramètre ROM et la préférence de saveur de la nature', () => {
    expect(resolveHgssConsumedItemEffect(10, 25, 101, 0)).toEqual({ kind: 'heal', amount: 25, confuse: false })
    expect(resolveHgssConsumedItemEffect(11, 8, 101, 5)).toEqual({ kind: 'heal', amount: 12, confuse: true })
    expect(resolveHgssConsumedItemEffect(11, 8, 101, 0)).toEqual({ kind: 'heal', amount: 12, confuse: false })
  })
})
