import { describe, expect, it } from 'vitest'
import {
  baseBattleActionPolicy,
  composeBattleActionPolicies,
  type BattleActionPolicy,
  type BattleActionVeto,
  type PlayerBattleActionIntent,
} from './battleActionPolicy'

const intents: readonly PlayerBattleActionIntent[] = [
  { kind: 'bag', format: 'simple', itemId: 4, role: 'capture' },
  { kind: 'bag', format: 'simple', itemId: 80, role: 'escape' },
  { kind: 'bag', format: 'double', itemId: 57, role: 'battle-stat' },
  { kind: 'bag', format: 'double', itemId: 17, role: 'party-target' },
  { kind: 'switch', format: 'simple', mode: 'voluntary', partyIndex: 1 },
  { kind: 'switch', format: 'double', mode: 'voluntary', partyIndex: 2 },
  { kind: 'safari', action: 'ball' },
  { kind: 'safari', action: 'bait' },
  { kind: 'safari', action: 'mud' },
  { kind: 'safari', action: 'run' },
]

describe('battle action policy', () => {
  it('laisse la politique de base autoriser toutes les intentions joueur prévues', () => {
    expect(intents.map((intent) => baseBattleActionPolicy.vetoPlayerAction(intent))).toEqual(
      intents.map(() => undefined),
    )
  })

  it('retourne le premier veto et ne consulte pas les politiques suivantes', () => {
    const calls: string[] = []
    const firstVeto: BattleActionVeto = {
      code: 'challenge.bag-disabled',
      reason: 'Le Sac est désactivé pour ce combat.',
    }
    const policies: BattleActionPolicy[] = [
      { vetoPlayerAction: () => { calls.push('allow'); return undefined } },
      { vetoPlayerAction: () => { calls.push('first-veto'); return firstVeto } },
      { vetoPlayerAction: () => { calls.push('late-veto'); return { code: 'late', reason: 'Trop tard.' } } },
    ]

    expect(composeBattleActionPolicies(policies).vetoPlayerAction(intents[0]!)).toBe(firstVeto)
    expect(calls).toEqual(['allow', 'first-veto'])
  })

  it('autorise quand aucune politique ordonnée ne pose de veto', () => {
    const calls: string[] = []
    const composite = composeBattleActionPolicies([
      { vetoPlayerAction: () => { calls.push('first'); return undefined } },
      { vetoPlayerAction: () => { calls.push('second'); return undefined } },
    ])

    expect(composite.vetoPlayerAction(intents[4]!)).toBeUndefined()
    expect(calls).toEqual(['first', 'second'])
  })

  it('fige l’ordre au moment de la composition', () => {
    const veto: BattleActionVeto = { code: 'original', reason: 'Veto original.' }
    const policies: BattleActionPolicy[] = [{ vetoPlayerAction: () => veto }]
    const composite = composeBattleActionPolicies(policies)
    policies.unshift({ vetoPlayerAction: () => ({ code: 'added-later', reason: 'Ajout tardif.' }) })

    expect(composite.vetoPlayerAction(intents[5]!)).toBe(veto)
  })

  it('conserve des intentions et veto directement sérialisables en JSON', () => {
    const veto: BattleActionVeto = {
      code: 'challenge.voluntary-switch-disabled',
      reason: 'Le changement volontaire est désactivé.',
    }

    expect(JSON.parse(JSON.stringify(intents))).toEqual(intents)
    expect(JSON.parse(JSON.stringify(veto))).toEqual(veto)
  })
})
