import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { cloneHgssPokedex, createHgssPokedex, markPokemonCaught, markPokemonSeen, restoreHgssPokedex, snapshotHgssPokedex } from './hgssPokedex'

function pokemon(overrides: Partial<CanonicalPokemon> = {}): CanonicalPokemon {
  return {
    speciesId: 155,
    speciesName: 'HERICENDRE',
    form: 0,
    personality: 0x12345678,
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    level: 5,
    experience: 0,
    individualValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    effortValues: { hp: 0, attack: 0, defense: 0, speed: 0, specialAttack: 0, specialDefense: 0 },
    nature: 0,
    gender: 'male',
    abilityId: 66,
    shiny: false,
    friendship: 70,
    moves: [],
    stats: { hp: 20, attack: 10, defense: 10, speed: 10, specialAttack: 10, specialDefense: 10 },
    currentHp: 20,
    status: 0,
    heldItemId: 0,
    ballId: 4,
    isEgg: false,
    fatefulEncounter: false,
    shinyLeafMask: 0,
    ribbonIds: [],
    ...overrides,
    instanceId: overrides.instanceId ?? 'pkm:v1:r:00000000000000000000000000000155' as CanonicalPokemon['instanceId'],
  }
}

describe('HGSS Pokedex state', () => {
  it('makes caught imply seen and records language and international view', () => {
    const pokedex = createHgssPokedex()
    markPokemonCaught(pokedex, pokemon({ origin: { language: 2, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 } }))
    expect([...pokedex.seenSpeciesIds]).toEqual([155])
    expect([...pokedex.caughtSpeciesIds]).toEqual([155])
    expect([...pokedex.caughtLanguages.get(155)!]).toEqual([2])
    expect(pokedex.internationalViewEnabled).toBe(true)
  })

  it('does not register eggs before hatching', () => {
    const pokedex = createHgssPokedex()
    markPokemonCaught(pokedex, pokemon({ isEgg: true }))
    expect(pokedex.seenSpeciesIds.size).toBe(0)
    expect(pokedex.caughtSpeciesIds.size).toBe(0)
  })

  it('remembers a captured shiny species through snapshots and clones', () => {
    const pokedex = createHgssPokedex()
    markPokemonCaught(pokedex, pokemon({ shiny: true }))
    expect(pokedex.caughtShinySpeciesIds.has(155)).toBe(true)
    const restored = restoreHgssPokedex(snapshotHgssPokedex(pokedex))
    const cloned = cloneHgssPokedex(restored)
    expect(restored.caughtShinySpeciesIds.has(155)).toBe(true)
    cloned.caughtShinySpeciesIds.delete(155)
    expect(restored.caughtShinySpeciesIds.has(155)).toBe(true)
  })

  it('keeps first and second distinct genders in encounter order', () => {
    const pokedex = createHgssPokedex()
    markPokemonSeen(pokedex, pokemon({ gender: 'female' }))
    markPokemonSeen(pokedex, pokemon({ gender: 'male' }))
    markPokemonSeen(pokedex, pokemon({ gender: 'female' }))
    expect(pokedex.seenGenders.get(155)).toEqual(['female', 'male'])
  })

  it('records native ordered form histories with their HGSS limits', () => {
    const pokedex = createHgssPokedex()
    for (const form of [2, 0, 1, 2]) markPokemonSeen(pokedex, pokemon({ speciesId: 412, form }))
    for (const form of [5, 1, 4, 3, 2, 0, 6]) markPokemonSeen(pokedex, pokemon({ speciesId: 479, form }))
    markPokemonSeen(pokedex, pokemon({ speciesId: 172, form: 0, gender: 'female' }))
    markPokemonSeen(pokedex, pokemon({ speciesId: 172, form: 1, gender: 'female' }))
    expect(pokedex.seenForms.get(412)).toEqual([2, 0, 1])
    expect(pokedex.seenForms.get(479)).toEqual([5, 1, 4, 3, 2, 0])
    expect(pokedex.seenForms.get(172)).toEqual([1, 2])
  })

  it('records Spinda personality only on the first sighting', () => {
    const pokedex = createHgssPokedex()
    markPokemonSeen(pokedex, pokemon({ speciesId: 327, personality: 10 }))
    markPokemonSeen(pokedex, pokemon({ speciesId: 327, personality: 20 }))
    expect(pokedex.spindaPersonality).toBe(10)
  })

  it('snapshots, restores and clones all mutable collections independently', () => {
    const pokedex = createHgssPokedex({ enabled: true })
    markPokemonCaught(pokedex, pokemon({ speciesId: 201, form: 4 }))
    const restored = restoreHgssPokedex(snapshotHgssPokedex(pokedex))
    const cloned = cloneHgssPokedex(restored)
    cloned.caughtSpeciesIds.add(152)
    cloned.caughtUnownForms.push(5)
    expect(restored.caughtSpeciesIds.has(152)).toBe(false)
    expect(restored.caughtUnownForms).toEqual([4])
    expect(restored.enabled).toBe(true)
  })
})
