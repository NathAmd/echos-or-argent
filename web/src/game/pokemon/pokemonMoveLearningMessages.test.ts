import { describe, expect, it } from 'vitest'
import { formatBattleMoveLearningResult, formatMachineMoveLearningDeclined, formatMachineMoveLearningResult } from './pokemonMoveLearningMessages'

describe('messages ROM d’apprentissage de capacité', () => {
  const battle = {
    4: '{101 0,0} apprend\n{106 1,0}!',
    8: '{101 0,0} oublie\n{106 2,0}.',
    10: '{101 0,0} n’a pas appris\n{106 1,0}.',
  }
  const machine = {
    59: '{101 0,0} n’a pas appris la\ncapacité {106 1,0}.',
    61: '{101 0,0} ne sait plus\ncomment utiliser {106 1,0}.',
    62: '{101 0,0} apprend\n{106 1,0}!',
  }

  it('conserve le bon ancien puis le bon nouveau nom lors du remplacement', () => {
    expect(formatBattleMoveLearningResult(battle, 'GERMIGNON', 'TRANCH’HERBE', 'CHARGE')).toEqual([
      'GERMIGNON oublie\nCHARGE.',
      'GERMIGNON apprend\nTRANCH’HERBE!',
    ])
    expect(formatMachineMoveLearningResult(machine, 'GERMIGNON', 'TRANCH’HERBE', 'CHARGE')).toBe(
      'GERMIGNON ne sait plus\ncomment utiliser CHARGE.\nGERMIGNON apprend\nTRANCH’HERBE!',
    )
  })

  it('formate le refus sans substituer le nouveau nom à celui du Pokémon', () => {
    expect(formatBattleMoveLearningResult(battle, 'GERMIGNON', 'TRANCH’HERBE')).toEqual(['GERMIGNON n’a pas appris\nTRANCH’HERBE.'])
    expect(formatMachineMoveLearningDeclined(machine, 'GERMIGNON', 'TRANCH’HERBE')).toBe('GERMIGNON n’a pas appris la\ncapacité TRANCH’HERBE.')
  })
})
