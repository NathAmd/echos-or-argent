import { describe, expect, it } from 'vitest'
import { resolveBattleEvolutionInput, type BattleEvolutionInputPhase } from './battleEvolutionInput'

describe('battle evolution input', () => {
  it.each<BattleEvolutionInputPhase>(['intro', 'transforming'])(
    'keeps %s progression owned by its timers when confirmation is repeated',
    (phase) => {
      expect(resolveBattleEvolutionInput(phase, 'confirm', true)).toBe('ignore')
      expect(resolveBattleEvolutionInput(phase, 'confirm', false)).toBe('ignore')
    },
  )

  it.each<BattleEvolutionInputPhase>(['intro', 'transforming'])(
    'only cancels %s when the evolution is cancellable',
    (phase) => {
      expect(resolveBattleEvolutionInput(phase, 'cancel', true)).toBe('cancel')
      expect(resolveBattleEvolutionInput(phase, 'cancel', false)).toBe('ignore')
    },
  )

  it.each<BattleEvolutionInputPhase>(['complete', 'cancelled'])(
    'closes a terminal %s screen with either native action',
    (phase) => {
      expect(resolveBattleEvolutionInput(phase, 'confirm', true)).toBe('close')
      expect(resolveBattleEvolutionInput(phase, 'cancel', false)).toBe('close')
    },
  )
})
