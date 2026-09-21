import { describe, expect, it } from 'vitest'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalWildPokemon, hasWildHeldItemCompoundEyesInfluence } from './wildPokemonGeneration'

function createSequenceRng(values: number[]): HgssLcrng {
  let cursor = 0
  return {
    getSeed: () => cursor,
    nextU16: () => {
      const value = values[cursor]
      if (value === undefined) throw new Error('Tirage RNG sauvage inattendu.')
      cursor += 1
      return value
    },
  }
}

describe('canonical HGSS wild Pokemon generation', () => {
  it('consumes nature, PID retries, IVs, then the held-item roll in native order', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[152] = {
      ...catalog.personalData[152]!,
      heldItems: [10, 20],
    }
    const rng = createSequenceRng([7, 1, 0, 7, 0, 0xffff, 0, 96])

    const pokemon = createCanonicalWildPokemon({
      speciesId: 152,
      level: 5,
      catalog,
      rng,
      originalTrainer: { id: 0x12345678, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    })

    expect(pokemon).toMatchObject({
      speciesId: 152,
      personality: 7,
      nature: 7,
      individualValues: { hp: 31, attack: 31, defense: 31, speed: 0, specialAttack: 0, specialDefense: 0 },
      heldItemId: 20,
      ballId: 4,
      originalTrainer: { id: 0x12345678 },
    })
    expect(rng.getSeed()).toBe(8)
  })

  it('uses the native Compound Eyes thresholds without skipping the item roll', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[152] = {
      ...catalog.personalData[152]!,
      heldItems: [10, 20],
    }
    const rng = createSequenceRng([1, 0, 0, 0, 85])

    expect(createCanonicalWildPokemon({
      speciesId: 152,
      level: 5,
      catalog,
      rng,
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
      nature: { kind: 'fixed', value: 1 },
      compoundEyes: true,
    }).heldItemId).toBe(20)
    expect(rng.getSeed()).toBe(5)
  })

  it('enables Compound Eyes only for a non-egg lead party Pokemon', () => {
    const catalog = createPokemonTestCatalog()
    const lead = createCanonicalWildPokemon({
      speciesId: 152,
      level: 5,
      catalog,
      rng: createSequenceRng([1, 0, 0, 0, 0]),
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
      nature: { kind: 'fixed', value: 1 },
    })
    lead.abilityId = 14

    expect(hasWildHeldItemCompoundEyesInfluence(lead)).toBe(true)
    lead.isEgg = true
    expect(hasWildHeldItemCompoundEyesInfluence(lead)).toBe(false)
    expect(hasWildHeldItemCompoundEyesInfluence(undefined)).toBe(false)
  })

  it('keeps naturally generated shiny Pokemon instead of filtering their PID', () => {
    const pokemon = createCanonicalWildPokemon({
      speciesId: 152,
      level: 5,
      catalog: createPokemonTestCatalog(),
      rng: createSequenceRng([0, 0, 0, 0, 0]),
      originalTrainer: { id: 0, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
      nature: { kind: 'fixed', value: 0 },
    })

    expect(pokemon.personality).toBe(0)
    expect(pokemon.shiny).toBe(true)
  })

  it('reproduit le PID chromatique forcé par le dernier octet de WildBattle', () => {
    const pokemon = createCanonicalWildPokemon({
      speciesId: 152,
      level: 5,
      catalog: createPokemonTestCatalog(),
      rng: createHgssLcrng(0x12345678),
      originalTrainer: { id: 0x76543210, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
      forceShiny: true,
    })

    expect(pokemon.shiny).toBe(true)
  })

  it('retente au plus quatre fois pour garantir l IV parfait des rencontres Safari', () => {
    const pokemon = createCanonicalWildPokemon({
      speciesId: 74,
      level: 17,
      catalog: createPokemonTestCatalog(),
      rng: createSequenceRng([0, 0, 0, 0, 0, 0, 0, 0, 31, 0, 0]),
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 },
      forceOnePerfectIv: true,
    })
    expect(Object.values(pokemon.individualValues)).toContain(31)
  })

  it('applique Synchro avant la génération de la nature sauvage', () => {
    const catalog = createPokemonTestCatalog()
    const lead = createCanonicalWildPokemon({
      speciesId: 152,
      level: 10,
      catalog,
      rng: createSequenceRng([7, 0, 0, 0, 0]),
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
      nature: { kind: 'fixed', value: 7 },
    })
    lead.abilityId = 28
    const synchronized = createCanonicalWildPokemon({
      speciesId: 74,
      level: 17,
      catalog,
      rng: createSequenceRng([0, 7, 0, 0, 0, 0]),
      leadPokemon: lead,
      originalTrainer: lead.originalTrainer,
      origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 },
    })
    expect(synchronized.nature).toBe(lead.nature)
  })
})
