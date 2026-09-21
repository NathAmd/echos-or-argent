import { describe, expect, it } from 'vitest'
import { createHgssPokedex } from '../pokedex/hgssPokedex'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { basePokemonInitialTeamResolver, composePokemonInitialTeamResolvers, type PokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'
import { createPokemonParty } from '../pokemon/pokemonParty'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { getHgssStarterSpeciesId } from '../pokemon/hgssStarters'
import { PokemonTeamPolicyVetoError, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import {
  appendScriptedPokemonToParty,
  giveHgssStarterToParty,
  removeScriptedPokemonFromParty,
  replaceScriptedPokemonInParty,
} from './fieldScriptPokemonTransactions'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 1 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
  })
}

describe('transactions Pokémon des scripts terrain', () => {
  it('préserve les mutations natives avec la politique neutre', () => {
    const party = createPokemonParty([pokemon(152)])
    appendScriptedPokemonToParty(party, pokemon(155), 'gift')
    replaceScriptedPokemonInParty(party, 0, pokemon(158))
    removeScriptedPokemonFromParty(party, 1, 'loan')
    expect(party.members.map(({ speciesId }) => speciesId)).toEqual([158])
  })

  it('refuse ajout, échange et retrait avant toute publication', () => {
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => ({ code: `${intent.reason}-locked`, reason: 'Équipe verrouillée.' }),
    }
    const actions = [
      (party: ReturnType<typeof createPokemonParty>) => appendScriptedPokemonToParty(party, pokemon(155), 'gift', policy),
      (party: ReturnType<typeof createPokemonParty>) => replaceScriptedPokemonInParty(party, 0, pokemon(158), policy),
      (party: ReturnType<typeof createPokemonParty>) => removeScriptedPokemonFromParty(party, 0, 'loan', policy),
    ]
    for (const action of actions) {
      const party = createPokemonParty([pokemon(152)])
      const before = JSON.stringify(party)
      expect(() => action(party)).toThrow(PokemonTeamPolicyVetoError)
      expect(JSON.stringify(party)).toBe(before)
    }
  })

  it('valide le starter avant équipe et Pokédex', () => {
    const party = createPokemonParty()
    const pokedex = createHgssPokedex()
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'starter-locked', reason: 'Starter verrouillé.' }),
    }
    expect(() => giveHgssStarterToParty(
      party,
      pokedex,
      1,
      126,
      {
        catalog,
        rng: createHgssLcrng(1),
        trainer: { id: 1, name: 'JO', gender: 'male' },
        language: 3,
        gameVersion: 7,
        now: () => new Date(2026, 2, 12),
      },
      policy,
    )).toThrow(PokemonTeamPolicyVetoError)
    expect(party.members).toEqual([])
    expect(pokedex.caughtSpeciesIds.size).toBe(0)
  })

  it.each([0, 1, 2])('conserve le starter, sa matérialisation et le RNG natifs pour le choix %i', (choice) => {
    const actualRng = createHgssLcrng(0x12345678)
    const expectedRng = createHgssLcrng(0x12345678)
    const party = createPokemonParty()
    const pokedex = createHgssPokedex()
    const trainer = { id: 1, name: 'JO', gender: 'male' as const }
    const now = new Date(2026, 2, 12)

    const actual = giveHgssStarterToParty(party, pokedex, choice, 126, {
      catalog, rng: actualRng, trainer, language: 3, gameVersion: 7, now: () => now,
    })
    const expected = createCanonicalPokemon(catalog, {
      speciesId: getHgssStarterSpeciesId(choice),
      level: 5,
      rng: expectedRng,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: trainer,
      origin: {
        language: 3,
        gameVersion: 7,
        metLocation: 126,
        metLevel: 5,
        metTerrain: 12,
        metDate: { year: 2026, month: 3, day: 12 },
      },
      ballId: 4,
    })

    expect({ ...actual, instanceId: 'parité' }).toEqual({ ...expected, instanceId: 'parité' })
    expect(party.members).toHaveLength(1)
    expect(party.members[0]?.instanceId).toBe(actual.instanceId)
    expect(pokedex.caughtSpeciesIds).toEqual(new Set([actual.speciesId]))
    expect(actualRng.getSeed()).toBe(expectedRng.getSeed())
  })

  it('matérialise transactionnellement une équipe initiale de six membres', () => {
    const definitions = Array.from({ length: 6 }, (_, index) => ({
      speciesId: 152 + index,
      level: 5 + index,
      form: 0,
    }))
    const resolver = composePokemonInitialTeamResolvers([
      basePokemonInitialTeamResolver,
      () => definitions,
    ])
    const party = createPokemonParty()
    const pokedex = createHgssPokedex()

    const first = giveHgssStarterToParty(party, pokedex, 0, 126, {
      catalog,
      rng: createHgssLcrng(7),
      trainer: { id: 1, name: 'JO', gender: 'male' },
      language: 3,
      gameVersion: 7,
      now: () => new Date(2026, 2, 12),
    }, undefined, resolver)

    expect(first.instanceId).toBe(party.members[0]?.instanceId)
    expect(party.members.map(({ speciesId, level, form }) => ({ speciesId, level, form }))).toEqual(definitions)
    expect(new Set(party.members.map(({ instanceId }) => instanceId)).size).toBe(6)
    expect(pokedex.caughtSpeciesIds).toEqual(new Set(definitions.map(({ speciesId }) => speciesId)))
  })

  it('soumet l’équipe finale de six à la policy avant équipe et Pokédex', () => {
    const original = pokemon(158)
    const party = createPokemonParty([original])
    const pokedex = createHgssPokedex()
    const before = JSON.stringify(party)
    const definitions = Array.from({ length: 6 }, (_, index) => ({ speciesId: 152 + index, level: 5, form: 0 }))
    const resolver: PokemonInitialTeamResolver = () => definitions
    let observedIntent: Parameters<PokemonTeamPolicy['vetoPartyMutation']>[0] | undefined
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => {
        observedIntent = intent
        return { code: 'initial-team-locked', reason: 'Équipe initiale verrouillée.' }
      },
    }

    expect(() => giveHgssStarterToParty(party, pokedex, 2, 126, {
      catalog,
      rng: createHgssLcrng(7),
      trainer: { id: 1, name: 'JO', gender: 'male' },
      language: 3,
      gameVersion: 7,
      now: () => new Date(2026, 2, 12),
    }, policy, resolver)).toThrow(PokemonTeamPolicyVetoError)

    expect(observedIntent).toMatchObject({
      reason: 'starter',
      before: [{ instanceId: original.instanceId }],
    })
    expect(observedIntent?.after).toHaveLength(6)
    expect(JSON.stringify(party)).toBe(before)
    expect(pokedex.caughtSpeciesIds.size).toBe(0)
  })

  it('notifie le resolver uniquement après publication de l’équipe initiale', () => {
    const party = createPokemonParty()
    const pokedex = createHgssPokedex()
    let committedIds: readonly string[] | undefined
    const resolver = Object.assign(
      (() => [{ speciesId: 152, level: 5, form: 0 }]) satisfies PokemonInitialTeamResolver,
      {
        onInitialTeamCommitted: (members: readonly { instanceId: string }[]) => {
          expect(party.members.map(({ instanceId }) => instanceId)).toEqual(members.map(({ instanceId }) => instanceId))
          committedIds = members.map(({ instanceId }) => instanceId)
        },
      },
    )

    giveHgssStarterToParty(party, pokedex, 0, 126, {
      catalog,
      rng: createHgssLcrng(7),
      trainer: { id: 1, name: 'JO', gender: 'male' },
      language: 3,
      gameVersion: 7,
      now: () => new Date(2026, 2, 12),
    }, undefined, resolver)

    expect(committedIds).toEqual(party.members.map(({ instanceId }) => instanceId))
  })
})
