import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from './canonicalPokemon'
import { clonePokemonParty, createPokemonParty, healPokemonParty } from './pokemonParty'
import {
  basePokemonPartyHealingPolicy,
  composePokemonPartyHealingPolicies,
  healPokemonWithPolicy,
  healPokemonPartyWithPolicy,
  type PokemonFullHealVeto,
  type PokemonPartyHealingPolicy,
} from './pokemonPartyHealingPolicy'

function pokemon(speciesId: number, currentHp = 0): CanonicalPokemon {
  return {
    instanceId: `pkm:v1:r:${speciesId.toString(16).padStart(32, '0')}` as CanonicalPokemon['instanceId'],
    speciesId,
    speciesName: `ESPECE ${speciesId}`,
    form: 0,
    personality: speciesId,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    level: 5,
    experience: 125,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 1,
    shiny: false,
    friendship: 70,
    moves: [{ moveId: 33, pp: 1, maxPp: 35, ppUps: 0, data: {} as CanonicalPokemon['moves'][number]['data'] }],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp,
    status: 4,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    ribbonIds: [],
  }
}

describe('pokemon party healing policy', () => {
  it('reproduit exactement healPokemonParty avec la politique de base', () => {
    const directParty = createPokemonParty([pokemon(152), pokemon(155, 3)])
    const policyParty = clonePokemonParty(directParty)

    healPokemonParty(directParty)
    const result = healPokemonPartyWithPolicy(policyParty, basePokemonPartyHealingPolicy)

    expect(policyParty).toEqual(directParty)
    expect(result.members).toEqual([
      { partyIndex: 0, restored: ['hp', 'status', 'move-pp'], vetoes: [] },
      { partyIndex: 1, restored: ['hp', 'status', 'move-pp'], vetoes: [] },
    ])
  })

  it("peut empêcher la résurrection d'un Pokémon tout en restaurant statut et PP", () => {
    const party = createPokemonParty([pokemon(152)])
    const resurrectionVeto: PokemonFullHealVeto = {
      code: 'challenge.permanent-knockout',
      reason: 'Ce Pokémon ne peut plus récupérer ses PV.',
    }
    const policy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ pokemon: member, restoration }) => (
        member.currentHp === 0 && restoration === 'hp' ? resurrectionVeto : undefined
      ),
    }

    const result = healPokemonPartyWithPolicy(party, policy)

    expect(party.members[0]).toMatchObject({ currentHp: 0, status: 0, moves: [{ pp: 35 }] })
    expect(result.members[0]).toEqual({
      partyIndex: 0,
      restored: ['status', 'move-pp'],
      vetoes: [{ restoration: 'hp', ...resurrectionVeto }],
    })
  })

  it('permet de distinguer une restauration de Pension d’un soin complet', () => {
    const fullHealTarget = pokemon(152)
    const daycareTarget = pokemon(155)
    const policy: PokemonPartyHealingPolicy = {
      vetoFullHealRestoration: ({ restoration, source }) => restoration === 'hp' && source === 'daycare'
        ? { code: 'challenge.daycare-revive', reason: 'Réanimation interdite à la Pension.' }
        : undefined,
    }

    healPokemonWithPolicy(fullHealTarget, 0, policy)
    const daycareResult = healPokemonWithPolicy(daycareTarget, 1, policy, 'daycare')

    expect(fullHealTarget.currentHp).toBe(fullHealTarget.stats.hp)
    expect(daycareTarget.currentHp).toBe(0)
    expect(daycareResult.vetoes).toContainEqual(expect.objectContaining({ restoration: 'hp', code: 'challenge.daycare-revive' }))
  })

  it('retient le premier veto et ne consulte pas les politiques suivantes', () => {
    const calls: string[] = []
    const firstVeto: PokemonFullHealVeto = { code: 'first', reason: 'Premier veto.' }
    const policies: PokemonPartyHealingPolicy[] = [
      { vetoFullHealRestoration: () => { calls.push('allow'); return undefined } },
      { vetoFullHealRestoration: () => { calls.push('first-veto'); return firstVeto } },
      { vetoFullHealRestoration: () => { calls.push('late-veto'); return { code: 'late', reason: 'Trop tard.' } } },
    ]
    const composite = composePokemonPartyHealingPolicies(policies)
    policies.reverse()

    expect(composite.vetoFullHealRestoration({
      pokemon: pokemon(152),
      partyIndex: 0,
      restoration: 'hp',
      source: 'battle-item',
    })).toBe(firstVeto)
    expect(calls).toEqual(['allow', 'first-veto'])
  })
})
