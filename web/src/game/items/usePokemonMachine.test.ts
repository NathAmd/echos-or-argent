import { describe, expect, it } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { getHgssPokemonMachine, inspectPokemonMachineCompatibility, usePokemonMachine } from './usePokemonMachine'

function createFixture(): { catalog: PokemonCatalog, pokemon: CanonicalPokemon } {
  const catalog = createPokemonTestCatalog() as PokemonCatalog
  catalog.moves[264] = { ...catalog.moves[33]!, moveId: 264, pp: 20 }
  catalog.personalData[1] = { ...catalog.personalData[1]!, tmHmCompatibility: [1, 0, 0, 0] }
  const pokemon = {
    speciesId: 1,
    form: 0,
    isEgg: false,
    moves: [{ moveId: 33, pp: 35, maxPp: 35, ppUps: 0, data: catalog.moves[33]! }],
  } as CanonicalPokemon
  return { catalog, pokemon }
}

describe('usePokemonMachine', () => {
  it('décode les limites CT/CS de la table ROM HGSS', () => {
    expect(getHgssPokemonMachine(328)).toMatchObject({ kind: 'CT', number: 1, moveId: 264, consumed: true })
    expect(getHgssPokemonMachine(420)).toMatchObject({ kind: 'CS', number: 1, moveId: 15, consumed: false })
    expect(getHgssPokemonMachine(327)).toBeUndefined()
  })

  it('lit le bit de compatibilité de personal.narc et consomme une CT après succès', () => {
    const { catalog, pokemon } = createFixture()
    const inventory = new Map([[328, 1]])
    expect(inspectPokemonMachineCompatibility(pokemon, 328, catalog).kind).toBe('compatible')
    expect(usePokemonMachine(inventory, 328, pokemon, catalog)).toMatchObject({ kind: 'learned' })
    expect(pokemon.moves.map(({ moveId }) => moveId)).toEqual([33, 264])
    expect(inventory.has(328)).toBe(false)
  })

  it('attend un choix explicite avec quatre capacités sans consommer la CT', () => {
    const { catalog, pokemon } = createFixture()
    pokemon.moves = [33, 33, 33, 33].map((moveId) => ({ moveId, pp: 35, maxPp: 35, ppUps: 0, data: catalog.moves[moveId]! }))
    const inventory = new Map([[328, 2]])
    expect(usePokemonMachine(inventory, 328, pokemon, catalog)).toMatchObject({ kind: 'replacement-required' })
    expect(inventory.get(328)).toBe(2)
    const replacement = usePokemonMachine(inventory, 328, pokemon, catalog, 2)
    expect(replacement).toMatchObject({ kind: 'learned', forgotten: { moveId: 33 } })
    expect(pokemon.moves[2]?.moveId).toBe(264)
    if (replacement.kind === 'learned') expect(replacement.learned).toBe(pokemon.moves[2])
    expect(inventory.get(328)).toBe(1)
  })

  it('ne consomme rien et ne mute aucun emplacement sur un choix périmé', () => {
    const { catalog, pokemon } = createFixture()
    pokemon.moves = [33, 33, 33, 33].map((moveId) => ({ moveId, pp: 35, maxPp: 35, ppUps: 0, data: catalog.moves[moveId]! }))
    const inventory = new Map([[328, 1]])
    const before = pokemon.moves.map(({ moveId }) => moveId)

    expect(usePokemonMachine(inventory, 328, pokemon, catalog, 9)).toMatchObject({ kind: 'unavailable' })
    expect(inventory.get(328)).toBe(1)
    expect(pokemon.moves.map(({ moveId }) => moveId)).toEqual(before)
  })

  it('conserve une CS dans le Sac après apprentissage', () => {
    const { catalog, pokemon } = createFixture()
    catalog.personalData[1] = { ...catalog.personalData[1]!, tmHmCompatibility: [0, 0, 1 << 28, 0] }
    const inventory = new Map([[420, 1]])

    expect(usePokemonMachine(inventory, 420, pokemon, catalog)).toMatchObject({ kind: 'learned', machine: { kind: 'CS' } })
    expect(pokemon.moves.at(-1)?.moveId).toBe(15)
    expect(inventory.get(420)).toBe(1)
  })

  it("refuse un Œuf, une incompatibilité et une capacité déjà connue", () => {
    const { catalog, pokemon } = createFixture()
    pokemon.isEgg = true
    expect(inspectPokemonMachineCompatibility(pokemon, 328, catalog).kind).toBe('egg')
    pokemon.isEgg = false
    catalog.personalData[1] = { ...catalog.personalData[1]!, tmHmCompatibility: [0, 0, 0, 0] }
    expect(inspectPokemonMachineCompatibility(pokemon, 328, catalog).kind).toBe('incompatible')
    pokemon.moves.push({ moveId: 264, pp: 20, maxPp: 20, ppUps: 0, data: catalog.moves[264]! })
    expect(inspectPokemonMachineCompatibility(pokemon, 328, catalog).kind).toBe('already-known')
  })
})
