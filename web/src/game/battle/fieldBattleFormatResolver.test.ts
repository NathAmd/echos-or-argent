import { describe, expect, it } from 'vitest'
import {
  resolveBaseFieldBattleFormat,
  type FieldBattleFormatSource,
  type ResolvedFieldBattleFormat,
} from './fieldBattleFormatResolver'

const baseFormatCases: readonly (readonly [FieldBattleFormatSource, ResolvedFieldBattleFormat])[] = [
  [{ kind: 'tutorial' }, { engine: 'tutorial' }],
  [{ kind: 'trainerHouse' }, { engine: 'simple', sessionKind: 'trainer' }],
  [{ kind: 'tagTrainer' }, { engine: 'double', sessionKind: 'double' }],
  [{ kind: 'multiTrainer' }, { engine: 'double', sessionKind: 'multi' }],
  [{ kind: 'trainer', trainer: { doubleBattle: false } }, { engine: 'simple', sessionKind: 'trainer' }],
  [{ kind: 'trainer', trainer: { doubleBattle: true } }, { engine: 'double', sessionKind: 'double' }],
  [{ kind: 'wild' }, { engine: 'simple', sessionKind: 'wild' }],
]

describe('base field battle format resolver', () => {
  it.each(baseFormatCases)('routes $0 to $1', (source, expected) => {
    expect(resolveBaseFieldBattleFormat(source)).toEqual(expected)
  })
})
