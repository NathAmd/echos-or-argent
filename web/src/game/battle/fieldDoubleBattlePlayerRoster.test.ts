import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createFieldDoubleBattlePlayerRoster } from './fieldDoubleBattlePlayerRoster'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number, currentHp?: number) {
  const created = createCanonicalPokemon(catalog, {
    speciesId, level: 10, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 10 }, originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 }, ballId: 4,
  })
  if (currentHp !== undefined) created.currentHp = currentHp
  return created
}

describe('roster joueur asymétrique du combat duo', () => {
  it('ouvre deux slots distincts lorsque deux Pokémon sont aptes', () => {
    const party = [pokemon(152), pokemon(155)]
    const roster = createFieldDoubleBattlePlayerRoster({
      party, teamPolicy: basePokemonTeamPolicy, allowSingleParticipant: true,
    })

    expect(roster).toHaveLength(2)
    expect(roster.map(({ activePartyIndex }) => activePartyIndex)).toEqual([0, 1])
    expect(roster.every((participant) => participant.party === party)).toBe(true)
  })

  it('ouvre un seul slot sans clone lorsqu’un seul Pokémon est éligible en NG+', () => {
    const party = [pokemon(152), pokemon(155, 0)]
    const roster = createFieldDoubleBattlePlayerRoster({
      party, teamPolicy: basePokemonTeamPolicy, allowSingleParticipant: true,
    })

    expect(roster).toHaveLength(1)
    expect(roster[0]).toMatchObject({ ownerId: 'player', activePartyIndex: 0, controlled: true })
    expect(roster[0]!.party).toBe(party)
  })

  it('respecte les exclusions de politique et préserve le prérequis du jeu normal', () => {
    const party = [pokemon(152), pokemon(155)]
    const onlyFirst: PokemonTeamPolicy = {
      vetoBattleEligibility: ({ partyIndex }) => partyIndex === 1
        ? { code: 'test-excluded', reason: 'Second membre exclu.' }
        : undefined,
      vetoPartyMutation: () => undefined,
    }

    expect(createFieldDoubleBattlePlayerRoster({
      party, teamPolicy: onlyFirst, allowSingleParticipant: true,
    })).toHaveLength(1)
    expect(() => createFieldDoubleBattlePlayerRoster({
      party, teamPolicy: onlyFirst, allowSingleParticipant: false,
    })).toThrow('deux Pokémon joueur utilisables')
  })

  it('refuse toujours une équipe sans aucun combattant apte', () => {
    expect(() => createFieldDoubleBattlePlayerRoster({
      party: [pokemon(152, 0)], teamPolicy: basePokemonTeamPolicy, allowSingleParticipant: true,
    })).toThrow('au moins un Pokémon joueur utilisable')
  })
})
