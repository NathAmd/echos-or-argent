import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import { addPokemonPartyMember, createPokemonParty } from '../pokemon/pokemonParty'
import { createPokemonStorage, placePokemonInFirstStorageSlot } from '../pokemon/pokemonStorage'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssSafariPostBattleFinalizer } from './hgssSafariPostBattle'

function pokemon(speciesId: number, personality: number, abilityId = 1) {
  const created = createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId,
    level: 20,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 205, metLevel: 20, metTerrain: 0 },
    ballId: 5,
    moveIds: [33],
  })
  created.abilityId = abilityId
  return created
}

function scriptedRng(values: number[]): HgssLcrng {
  return { getSeed: () => 0, nextU16: () => values.shift() ?? 1 }
}

describe('fin de combat Safari Pokérus HGSS', () => {
  it('cible la capture ajoutée à l’équipe avant la commande native de fin', () => {
    const party = createPokemonParty([pokemon(152, 1)])
    const rolls = [0x4000, 1, 3, 1]
    const finish = createHgssSafariPostBattleFinalizer(party, scriptedRng(rolls))

    expect(addPokemonPartyMember(party, pokemon(74, 2))).toBe(true)
    expect(finish()).toEqual({
      abilityItems: [],
      pokerus: { acquisition: { partySlot: 1, pokerus: 0x34 }, spreadSlots: [] },
    })
    expect(party.members[1]?.pokerus).toBe(0x34)
    expect(finish()).toBeUndefined()
    expect(rolls).toEqual([])
  })

  it('exclut une capture rangée au PC et ne déclenche aucun talent de victoire', () => {
    const members = Array.from({ length: 6 }, (_, slot) => pokemon(152, slot + 1, slot === 5 ? 53 : 1))
    const party = createPokemonParty(members)
    const storage = createPokemonStorage()
    const captured = pokemon(74, 20)
    const placement = placePokemonInFirstStorageSlot(storage, captured)!
    const rolls = [0x4000, 5, 3, 1]

    const result = createHgssSafariPostBattleFinalizer(party, scriptedRng(rolls))()

    expect(result).toEqual({
      abilityItems: [],
      pokerus: { acquisition: { partySlot: 5, pokerus: 0x34 }, spreadSlots: [] },
    })
    expect(party.members[5]).toMatchObject({ heldItemId: 0, pokerus: 0x34 })
    expect(storage.boxes[placement.box]?.[placement.slot]?.pokerus).toBe(0)
  })

  it('branche la capture avant les hooks terrain et garde un fallback pour toute autre issue', () => {
    const source = readFileSync(new URL('./hgssSafariRuntimeCoordinator.ts', import.meta.url), 'utf8')
    const calls = [...source.matchAll(/finishPostBattle\(\)/g)].map(({ index }) => index!)

    expect(calls).toHaveLength(2)
    expect(source).toMatch(/finishPostBattle\(\)\s+context\.progression\.completeCaptureAfterBattle\(progression\)/)
    expect(source).toMatch(/if \(outcome === 'opponent-fled'\)[^\n]+\s+finishPostBattle\(\)[\s\S]+options\.onFinish\(finish\)/)
  })
})
