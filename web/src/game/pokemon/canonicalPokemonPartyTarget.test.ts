import { describe, expect, it } from 'vitest'
import { cloneCanonicalPokemon, createCanonicalPokemon } from './canonicalPokemon'
import {
  createCanonicalPokemonPartyTarget,
  resolveCanonicalPokemonPartyTarget,
  type PokemonPartySlotSource,
} from './canonicalPokemonPartyTarget'
import { createPokemonEvolutionIdentity, evolveCanonicalPokemonPartyMember } from './pokemonEvolution'
import { createHgssLcrng } from './hgssPokemonRng'
import { deriveLegacyPokemonInstanceId } from './pokemonInstanceId'
import { replacePokemonMoveAfterChoice } from './pokemonMoveLearning'
import { createPokemonTestCatalog } from './pokemonTestCatalog'

describe('cible canonique differée apres evolution', () => {
  it.each(['single', 'double'] as const)(
    'remplace la capacite du Pokemon evolue en combat %s, meme apres remplacement et reordre de l equipe',
    (kind) => {
      const catalog = createPokemonTestCatalog()
      catalog.speciesNames[153] = 'MACRONIUM'
      const original = pokemon(catalog, 152, 42)
      const partner = pokemon(catalog, 155, 99)
      original.moves = [10, 33, 43, 44].map((moveId) => ({
        moveId,
        pp: catalog.moves[moveId]!.pp,
        maxPp: catalog.moves[moveId]!.pp,
        ppUps: 0,
        data: catalog.moves[moveId]!,
      }))
      const party = [original, partner]
      const source: PokemonPartySlotSource = kind === 'single'
        ? { kind, partySlot: 0 }
        : { kind, ownerId: 'player', partySlot: 0 }
      const target = createCanonicalPokemonPartyTarget(original, source)
      const resolveParty = (candidate: PokemonPartySlotSource) => (
        candidate.kind === 'double' && candidate.ownerId !== 'player' ? undefined : party
      )

      evolveCanonicalPokemonPartyMember(
        party,
        0,
        createPokemonEvolutionIdentity(original),
        153,
        catalog,
      )
      const displayed = resolveCanonicalPokemonPartyTarget(target, resolveParty)
      expect(displayed?.pokemon.speciesId).toBe(153)
      expect(displayed?.pokemon).not.toBe(original)

      const latestEvolved = cloneCanonicalPokemon(displayed!.pokemon)
      party.splice(0, 2, partner, latestEvolved)
      const confirmed = resolveCanonicalPokemonPartyTarget(target, resolveParty)
      expect(confirmed).toEqual({ pokemon: latestEvolved, partySlot: 1 })
      expect(replacePokemonMoveAfterChoice(confirmed!.pokemon, 45, 2, catalog).kind).toBe('replaced')

      expect(party[1]?.speciesId).toBe(153)
      expect(party[1]?.moves.map(({ moveId }) => moveId)).toEqual([10, 33, 45, 44])
      expect(original.moves.map(({ moveId }) => moveId)).toEqual([10, 33, 43, 44])
      expect(displayed?.pokemon.moves.map(({ moveId }) => moveId)).toEqual([10, 33, 43, 44])
    },
  )

  it("ne confond pas deux Pokemon qui partagent personnalité et dresseur d'origine", () => {
    const catalog = createPokemonTestCatalog()
    const expected = pokemon(catalog, 152, 42, 'expected')
    const lookalike = pokemon(catalog, 152, 42, 'lookalike')
    const party = [expected]
    const target = createCanonicalPokemonPartyTarget(expected, { kind: 'single', partySlot: 0 })

    party.splice(0, 1, lookalike, expected)

    expect(resolveCanonicalPokemonPartyTarget(target, () => party)).toEqual({ pokemon: expected, partySlot: 1 })
  })
})

function pokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  speciesId: number,
  personality: number,
  instancePath = `${speciesId}-${personality}`,
) {
  return createCanonicalPokemon(catalog, {
    instanceId: deriveLegacyPokemonInstanceId('canonical-party-target-test', instancePath),
    speciesId,
    level: 16,
    rng: createHgssLcrng(personality),
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
  })
}
