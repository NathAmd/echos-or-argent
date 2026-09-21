import { describe, expect, it } from 'vitest'
import type { HgssTrainerPokemon } from '../../rom/battle/trainerData'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  baseFieldBattleRosterPolicy,
  composeFieldBattleRosterPolicies,
  type FieldBattleRosterPolicy,
} from './fieldBattleRosterPolicy'

const pokemon: HgssTrainerPokemon = {
  difficulty: 0,
  genderOverride: 0,
  abilityOverride: 0,
  level: 5,
  speciesId: 152,
  form: 0,
  capsule: 0,
}

const trainerHousePokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
  speciesId: 152,
  level: 5,
  rng: createHgssLcrng(1),
  personality: { kind: 'fixed', value: 1 },
  individualValues: { kind: 'fixed', value: 20 },
  originalTrainer: { id: 1, name: 'JO', gender: 'male' },
  origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
  ballId: 4,
})

describe('field battle roster policy', () => {
  it('preserve les definitions ROM avec la policy de base', () => {
    expect(baseFieldBattleRosterPolicy.transformTrainerParty([pokemon], {
      battleKind: 'trainer', role: 'opponent', trainerId: 7,
    })).toEqual([pokemon])
    expect(baseFieldBattleRosterPolicy.transformScriptedWildPokemon({
      speciesId: 152, level: 5,
    })).toEqual({ speciesId: 152, level: 5 })
    const trainerHouseParty = [trainerHousePokemon]
    expect(baseFieldBattleRosterPolicy.transformTrainerHouseParty(trainerHouseParty, {
      battleKind: 'trainer-house', role: 'opponent', trainerId: 12, trainerHouseSlot: 3,
    })).toBe(trainerHouseParty)
  })

  it('compose les overlays dans leur ordre declare', () => {
    const calls: string[] = []
    const trainerHouseCalls: string[] = []
    const policies: FieldBattleRosterPolicy[] = [
      {
        transformTrainerParty: (party) => { calls.push('first'); return [...party, { ...pokemon, speciesId: 155 }] },
        transformTrainerHouseParty: (party, context) => {
          trainerHouseCalls.push(`first:${context.trainerId}:${context.trainerHouseSlot}`)
          return party.map((entry) => ({ ...entry, level: entry.level + 1 }))
        },
        transformScriptedWildPokemon: (wild) => ({ ...wild, speciesId: 155 }),
      },
      {
        transformTrainerParty: (party) => { calls.push(`second:${party.length}`); return party.map((entry) => ({ ...entry, level: 9 })) },
        transformTrainerHouseParty: (party) => {
          trainerHouseCalls.push(`second:${party[0]?.level}`)
          return party.map((entry) => ({ ...entry, level: entry.level + 1 }))
        },
        transformScriptedWildPokemon: (wild) => ({ ...wild, level: wild.level + 1 }),
      },
    ]
    const composite = composeFieldBattleRosterPolicies(policies)
    policies.reverse()

    expect(composite.transformTrainerParty([pokemon], {
      battleKind: 'trainer', role: 'opponent', trainerId: 7,
    })).toMatchObject([{ level: 9 }, { speciesId: 155, level: 9 }])
    expect(composite.transformScriptedWildPokemon({ speciesId: 152, level: 5 })).toEqual({ speciesId: 155, level: 6 })
    expect(calls).toEqual(['first', 'second:2'])
    expect(composite.transformTrainerHouseParty([trainerHousePokemon], {
      battleKind: 'trainer-house', role: 'opponent', trainerId: 12, trainerHouseSlot: 3,
    })).toMatchObject([{ speciesId: 152, level: 7 }])
    expect(trainerHouseCalls).toEqual(['first:12:3', 'second:6'])
  })
})
