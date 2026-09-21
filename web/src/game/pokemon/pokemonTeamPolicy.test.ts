import { describe, expect, it, vi } from 'vitest'
import {
  basePokemonTeamPolicy,
  composePokemonTeamPolicies,
  createPokemonPartyMutationIntent,
  getPokemonBattleEligiblePartySlots,
  type PokemonTeamMember,
  type PokemonTeamPolicy,
} from './pokemonTeamPolicy'

const member = (instanceId: string, currentHp = 10, isEgg = false): PokemonTeamMember => ({
  instanceId, speciesId: 152, currentHp, isEgg,
})

describe('pokemon team policy', () => {
  it('reproduit la sélection native avec la politique de base', () => {
    expect(getPokemonBattleEligiblePartySlots(
      [member('alive'), member('fainted', 0), member('egg', 10, true)],
      { format: 'simple', phase: 'initial' },
    )).toEqual([0])
  })

  it('distingue sélection initiale, changement volontaire et remplacement forcé', () => {
    const phases: string[] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: (intent) => { phases.push(intent.phase); return intent.phase === 'voluntary-switch' ? { code: 'locked', reason: 'Équipe verrouillée.' } : undefined },
      vetoPartyMutation: () => undefined,
    }
    expect(getPokemonBattleEligiblePartySlots([member('one')], { format: 'simple', phase: 'initial' }, policy)).toEqual([0])
    expect(getPokemonBattleEligiblePartySlots([member('one')], { format: 'simple', phase: 'voluntary-switch' }, policy)).toEqual([])
    expect(getPokemonBattleEligiblePartySlots([member('one')], { format: 'double', phase: 'forced-replacement' }, policy)).toEqual([0])
    expect(phases).toEqual(['initial', 'voluntary-switch', 'forced-replacement'])
  })

  it('compose au premier veto sans qu’une règle suivante puisse réautoriser', () => {
    const late = vi.fn(() => undefined)
    const policy = composePokemonTeamPolicies([
      { vetoBattleEligibility: () => undefined, vetoPartyMutation: () => ({ code: 'locked', reason: 'Équipe verrouillée.' }) },
      { vetoBattleEligibility: () => undefined, vetoPartyMutation: late },
    ])
    const intent = createPokemonPartyMutationIntent('pc', [member('one')], [member('two')])
    expect(policy.vetoPartyMutation(intent)).toEqual({ code: 'locked', reason: 'Équipe verrouillée.' })
    expect(late).not.toHaveBeenCalled()
    expect(basePokemonTeamPolicy.vetoPartyMutation(intent)).toBeUndefined()
  })

  it('copie les tableaux de l’intention de mutation', () => {
    const before = [member('one')]
    const after = [member('two')]
    const intent = createPokemonPartyMutationIntent('capture', before, after)
    before.push(member('three')); after.length = 0
    expect(intent.before.map(({ instanceId }) => instanceId)).toEqual(['one'])
    expect(intent.after.map(({ instanceId }) => instanceId)).toEqual(['two'])
    expect(JSON.parse(JSON.stringify(intent))).toEqual(intent)
  })
})
