import { describe, expect, it } from 'vitest'
import { isHgssMoveCallableBy } from './simpleBattleInvocationRules'

describe('listes ROM d’invocation Gen IV', () => {
  it('sépare les interdictions de Copie et de Photocopie', () => {
    expect(isHgssMoveCallableBy(33, 'mirrorMove')).toBe(true)
    expect(isHgssMoveCallableBy(102, 'mirrorMove')).toBe(false)
    expect(isHgssMoveCallableBy(182, 'copycat')).toBe(false)
    expect(isHgssMoveCallableBy(33, 'copycat')).toBe(true)
  })
})
