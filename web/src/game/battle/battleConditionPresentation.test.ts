import { describe, expect, it } from 'vitest'
import { isHeldItemBattleCondition, resolveBattleConditionMessage } from './battleConditionPresentation'

describe('battle condition presentation', () => {
  it('centralise les expirations et le compte du Requiem', () => {
    expect(resolveBattleConditionMessage('disableEnded', true)).toBe('Entrave prend fin!')
    expect(resolveBattleConditionMessage('perish:2', true)).toBe('Le compte du Requiem tombe à 2!')
  })

  it('distingue les effets visuels provenant des objets tenus', () => {
    expect(isHeldItemBattleCondition('resistBerry')).toBe(true)
    expect(isHeldItemBattleCondition('transform')).toBe(false)
  })
})
