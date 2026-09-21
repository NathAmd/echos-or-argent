import { describe, expect, it } from 'vitest'
import type { HgssPokedexCatalog } from '../../rom/pokedex/pokedexData'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createHgssPokedex } from './hgssPokedex'
import { countHgssPokedexRegistrations, createHgssPokedexAreaEntries, createHgssPokedexCryRequest, createHgssPokedexEntry, createHgssPokedexList, createHgssPokedexPreviewRequest, createHgssPokedexRegistrationEntry, queryHgssPokedexList } from './pokedexMenuModel'

const dexCatalog: HgssPokedexCatalog = {
  johtoDexNumbers: Object.assign(Array.from({ length: 494 }, () => 0), { 152: 1, 155: 4 }),
  uiMessages: Object.assign(Array.from({ length: 176 }, () => ''), { 0: 'VUS', 1: 'PRIS', 8: 'INFO' }),
  heartGoldDescriptions: Object.assign(Array.from({ length: 494 }, () => ''), { 155: 'Il se roule en boule.' }),
  categoryNames: Object.assign(Array.from({ length: 494 }, () => ''), { 155: 'Pokémon Souris Feu' }),
  heightLabels: Object.assign(Array.from({ length: 494 }, () => ''), { 155: '0,5 m' }),
  weightLabels: Object.assign(Array.from({ length: 494 }, () => ''), { 155: '7,9 kg' }),
  heightsDecimeters: [],
  weightsTenthsKg: [],
  typeNames: Array.from({ length: 18 }, (_, type) => `TYPE ${type}`),
}

describe('HGSS Pokedex menu model', () => {
  it('uses the complete Johto order and masks unseen species', () => {
    const state = createHgssPokedex({ caughtSpeciesIds: [155] })
    state.seenSpeciesIds.add(152)
    state.seenSpeciesIds.add(386)
    const list = createHgssPokedexList(state, createPokemonTestCatalog(), dexCatalog)
    expect(list.map(({ speciesId, dexNumber, speciesName, seen }) => [speciesId, dexNumber, speciesName, seen])).toEqual([
      [152, 1, 'GERMIGNON', true],
      [155, 4, 'HERICENDRE', true],
    ])
    state.seenSpeciesIds.delete(152)
    expect(createHgssPokedexList(state, createPokemonTestCatalog(), dexCatalog)[0]).toMatchObject({
      speciesId: 152,
      speciesName: '?????',
      seen: false,
      caught: false,
    })
  })

  it('reveals ROM description only for a caught species', () => {
    const state = createHgssPokedex({ caughtSpeciesIds: [155] })
    state.seenSpeciesIds.add(152)
    const catalog = createPokemonTestCatalog()
    expect(createHgssPokedexEntry(state, catalog, dexCatalog, 155)?.description).toBe('Il se roule en boule.')
    expect(createHgssPokedexEntry(state, catalog, dexCatalog, 155)).toMatchObject({ categoryName: 'Pokémon Souris Feu', heightLabel: '0,5 m', weightLabel: '7,9 kg' })
    expect(createHgssPokedexEntry(state, catalog, dexCatalog, 152)?.description).toBeUndefined()
  })

  it('alimente la fiche de première capture depuis le Pokémon sans muter le Pokédex', () => {
    const catalog = createPokemonTestCatalog()
    const state = createHgssPokedex({ enabled: true })
    const pokemon = createCanonicalPokemon(catalog, {
      speciesId: 155, level: 17, rng: createHgssLcrng(1), personality: { kind: 'fixed', value: 1 }, individualValues: { kind: 'fixed', value: 12 },
      originalTrainer: { id: 42, name: 'LUTH', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 }, ballId: 5,
    })
    pokemon.shiny = true

    expect(createHgssPokedexRegistrationEntry(pokemon, catalog, dexCatalog, state.nationalDexEnabled)).toMatchObject({
      speciesId: 155, dexNumber: 4, speciesName: 'HERICENDRE', seen: true, caught: true, shinyCaught: true,
      categoryName: 'Pokémon Souris Feu', heightLabel: '0,5 m', weightLabel: '7,9 kg', description: 'Il se roule en boule.',
      forms: [0], genders: [pokemon.gender],
    })
    expect(state.caughtSpeciesIds.size).toBe(0)
  })

  it('exposes the native shiny presentation only after a shiny capture', () => {
    const state = createHgssPokedex({ caughtSpeciesIds: [155] })
    state.caughtShinySpeciesIds.add(155)
    expect(createHgssPokedexEntry(state, createPokemonTestCatalog(), dexCatalog, 155)).toMatchObject({ shinyCaught: true })
    expect(createHgssPokedexEntry(state, createPokemonTestCatalog(), dexCatalog, 152)?.shinyCaught).toBeUndefined()
  })

  it('keeps unseen entries selectable without leaking their identity or data', () => {
    const state = createHgssPokedex()
    const entry = createHgssPokedexEntry(state, createPokemonTestCatalog(), dexCatalog, 152)

    expect(entry).toEqual({
      speciesId: 152,
      dexNumber: 1,
      speciesName: '?????',
      seen: false,
      caught: false,
      forms: [],
      genders: [],
    })
  })

  it('uses the first seen form for the official Pokedex cry action', () => {
    const state = createHgssPokedex()
    state.seenSpeciesIds.add(479)
    state.seenForms.set(479, [3, 0])
    expect(createHgssPokedexCryRequest(state, 479)).toEqual({ speciesId: 479, form: 3 })
    expect(createHgssPokedexCryRequest(state, 155)).toBeUndefined()
  })

  it('converts the native Pichu form sentinel before playing its cry', () => {
    const state = createHgssPokedex()
    state.seenSpeciesIds.add(172)
    state.seenForms.set(172, [2])
    expect(createHgssPokedexCryRequest(state, 172)).toEqual({ speciesId: 172, form: 1 })
  })

  it('switches to the complete species order when the National Dex is enabled', () => {
    const state = createHgssPokedex({ nationalDexEnabled: true })
    state.seenSpeciesIds.add(155)
    const list = createHgssPokedexList(state, createPokemonTestCatalog(), dexCatalog)

    expect(list).toHaveLength(158)
    expect(list[0]).toMatchObject({ speciesId: 1, dexNumber: 1, speciesName: '?????', seen: false })
    expect(list[154]).toMatchObject({ speciesId: 155, dexNumber: 155, speciesName: 'HERICENDRE', seen: true })
  })

  it('normalizes captured species as seen and counts each displayed species once', () => {
    const state = createHgssPokedex()
    state.caughtSpeciesIds.add(155)
    const list = createHgssPokedexList(state, createPokemonTestCatalog(), dexCatalog)

    expect(list.find(({ speciesId }) => speciesId === 155)).toMatchObject({ seen: true, caught: true, speciesName: 'HERICENDRE' })
    expect(countHgssPokedexRegistrations([...list, list[1]!])).toEqual({ seen: 1, caught: 1 })
  })

  it('filtre et trie les entrées sans révéler le nom des espèces inconnues', () => {
    const state = createHgssPokedex({ caughtSpeciesIds: [155] })
    state.seenSpeciesIds.add(152)
    const list = createHgssPokedexList(state, createPokemonTestCatalog(), dexCatalog)

    expect(queryHgssPokedexList(list, { filter: 'caught' }).map(({ speciesId }) => speciesId)).toEqual([155])
    expect(queryHgssPokedexList(list, { filter: 'seen', sort: 'name' }).map(({ speciesId }) => speciesId)).toEqual([152, 155])
    expect(queryHgssPokedexList(list, { search: 'HERIC' }).map(({ speciesId }) => speciesId)).toEqual([155])
    expect(queryHgssPokedexList(list, { search: '????' })).toEqual([])
  })

  it('converts native Pichu gender sentinels for its animated preview', () => {
    const base = {
      speciesId: 172,
      dexNumber: 21,
      speciesName: 'PICHU',
      seen: true,
      caught: false,
      typeNames: ['ELECTRIK', 'ELECTRIK'] as const,
      genders: ['female'] as const,
    }
    expect(createHgssPokedexPreviewRequest({ ...base, forms: [1] })).toEqual({ speciesId: 172, form: 0, gender: 'female' })
    expect(createHgssPokedexPreviewRequest({ ...base, forms: [2] })).toEqual({ speciesId: 172, form: 1, gender: 'female' })
  })

  it('builds and groups area data from ROM map headers and encounter banks', () => {
    const encounter = {
      bankId: 0,
      rates: { walking: 20, surfing: 10, rockSmash: 0, oldRod: 0, goodRod: 0, superRod: 0 },
      land: {
        morning: [{ speciesId: 155, level: 5 }],
        day: [{ speciesId: 152, level: 5 }],
        night: [{ speciesId: 155, level: 5 }],
      },
      hoennSoundSpecies: [0, 0] as const,
      sinnohSoundSpecies: [155, 0] as const,
      surfing: [{ speciesId: 155, minLevel: 5, maxLevel: 10 }],
      rockSmash: [], oldRod: [], goodRod: [], superRod: [],
      swarm: { landSpeciesId: 0, surfingSpeciesId: 0, nightFishingSpeciesId: 0, fishingSpeciesId: 0 },
    }
    const header = { wildEncounterBank: 0, mapSection: 42 }
    const maps = [
      { id: 10, label: 'ROUTE TEST', header },
      { id: 11, label: 'ROUTE TEST', header },
      { id: 12, label: 'SANS RENCONTRE', header: { wildEncounterBank: 0xff, mapSection: 43 } },
    ]

    expect(createHgssPokedexAreaEntries(155, maps as never, [encounter])).toEqual([{
      mapSection: 42,
      label: 'ROUTE TEST',
      mapIds: [10, 11],
      methods: ['morning', 'night', 'surfing', 'sinnohSound'],
    }])
  })
})
