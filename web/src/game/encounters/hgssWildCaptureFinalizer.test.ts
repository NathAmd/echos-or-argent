import { describe, expect, it, vi } from 'vitest'
import { createHgssPokedex } from '../pokedex/hgssPokedex'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonStorage } from '../pokemon/pokemonStorage'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  commitHgssWildCaptureBeforeStorage,
  commitHgssWildCaptureProgression,
  completeHgssWildCaptureAfterBattle,
  finalizeHgssWildCaptureProgression,
  hasHgssPokemonNicknameInput,
  HGSS_BILL_PC_FULL_ACKNOWLEDGED_FLAG_ID,
  HGSS_CAUGHT_POKEMON_GAME_STAT_ID,
  HGSS_NICKNAMES_GIVEN_GAME_STAT_ID,
  HGSS_OAK_NATIONAL_DEX_ACKNOWLEDGEMENT_BASE_FLAG_ID,
  HGSS_REGISTER_SPECIES_CAUGHT_SCORE,
  HGSS_WILD_ENCOUNTERS_GAME_STAT_ID,
  HGSS_WILD_POKEMON_FLED_GAME_STAT_ID,
  prepareHgssWildCaptureProgression,
  recordHgssWildEncounterStarted,
  recordHgssWildOpponentFled,
  resolveHgssOakDexProgressAcknowledgementFlag,
  scheduleHgssPostWildBattleCalls,
  type HgssWildCaptureProgressState,
} from './hgssWildCaptureFinalizer'

function createPokemon(speciesId = 155) {
  return createCanonicalPokemon(createPokemonTestCatalog(493), {
    speciesId,
    level: 17,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 },
    ballId: 5,
  })
}

function createState(): HgssWildCaptureProgressState {
  return {
    gameScore: 0,
    gameStats: new Map(),
    pokedex: createHgssPokedex({ enabled: true }),
    pokemonStorage: createPokemonStorage(),
    phoneContacts: new Set(),
    flags: new Set(),
    phoneCallTriggers: new Set(),
  }
}

function johtoDexNumbers(speciesId?: number): number[] {
  const values = Array<number>(494).fill(0)
  if (speciesId !== undefined) values[speciesId] = 1
  return values
}

describe('finaliseur global des captures sauvages HGSS', () => {
  it('incrémente le stat natif #8 au démarrage et respecte son plafond large', () => {
    const state = { gameStats: new Map<number, number>() }
    recordHgssWildEncounterStarted(state)
    expect(state.gameStats.get(HGSS_WILD_ENCOUNTERS_GAME_STAT_ID)).toBe(1)
    state.gameStats.set(HGSS_WILD_ENCOUNTERS_GAME_STAT_ID, 999_999_999)
    recordHgssWildEncounterStarted(state)
    expect(state.gameStats.get(HGSS_WILD_ENCOUNTERS_GAME_STAT_ID)).toBe(999_999_999)

    recordHgssWildOpponentFled(state)
    expect(state.gameStats.get(HGSS_WILD_POKEMON_FLED_GAME_STAT_ID)).toBe(1)
    state.gameStats.set(HGSS_WILD_POKEMON_FLED_GAME_STAT_ID, 9_999)
    recordHgssWildOpponentFled(state)
    expect(state.gameStats.get(HGSS_WILD_POKEMON_FLED_GAME_STAT_ID)).toBe(9_999)
  })

  it('porte une première capture Johto: event21 +20, event10 +2, stats #50/#10 et Pokédex', () => {
    const state = createState()
    const pokemon = createPokemon(155)
    const result = finalizeHgssWildCaptureProgression(state, pokemon, {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
      nicknameWasEntered: true,
    })

    expect(HGSS_REGISTER_SPECIES_CAUGHT_SCORE).toBe(20)
    expect(result).toMatchObject({
      wasAlreadyCaught: false,
      registeredNewSpecies: true,
      scoreEventIds: [21, 10],
      scoreAdded: 22,
      scheduledCalls: [],
    })
    expect(state.gameScore).toBe(22)
    expect(state.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(1)
    expect(state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(true)
  })

  it('sépare fidèlement event21 avant la fiche du commit après surnom, sans double mutation', () => {
    const state = createState()
    const pokemon = createPokemon(155)
    const preparation = prepareHgssWildCaptureProgression(state, pokemon, {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
    })

    expect(preparation).toMatchObject({
      speciesId: 155,
      wasAlreadyCaught: false,
      registeredNewSpecies: true,
      scoreEventIds: [21],
      scoreAdded: 20,
    })
    // État exact pendant la fiche Pokédex : event21 est déjà crédité, mais le
    // flag caught et les stats du Naming Screen/stockage ne le sont pas.
    expect(state.gameScore).toBe(20)
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(false)
    expect(state.gameStats.has(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(false)
    expect(state.gameStats.has(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(false)

    expect(prepareHgssWildCaptureProgression(state, pokemon, {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
    })).toBe(preparation)
    expect(state.gameScore).toBe(20)

    commitHgssWildCaptureBeforeStorage(preparation, { nicknameWasEntered: true })
    expect(state.gameScore).toBe(20)
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(true)
    expect(state.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(1)
    expect(state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)

    const committed = completeHgssWildCaptureAfterBattle(preparation)
    expect(committed).toMatchObject({ scoreEventIds: [21, 10], scoreAdded: 22 })
    expect(state.gameScore).toBe(22)
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(true)
    expect(state.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(1)
    expect(state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)

    commitHgssWildCaptureBeforeStorage(preparation, { nicknameWasEntered: true })
    expect(completeHgssWildCaptureAfterBattle(preparation)).toBe(committed)
    expect(state.gameScore).toBe(22)
    expect(state.gameStats.get(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(1)
    expect(state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)
  })

  it('interdit le retour post-combat avant la validation d’identité', () => {
    const state = createState()
    const preparation = prepareHgssWildCaptureProgression(state, createPokemon(155), {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
    })
    expect(() => completeHgssWildCaptureAfterBattle(preparation)).toThrow(/validée avant son retour/)
    expect(state.gameScore).toBe(20)
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(false)
  })

  it('reproduit noInput du Naming Screen Pokémon pour vide et CHAR_SPACE seulement', () => {
    expect(hasHgssPokemonNicknameInput(undefined)).toBe(false)
    expect(hasHgssPokemonNicknameInput(null)).toBe(false)
    expect(hasHgssPokemonNicknameInput('')).toBe(false)
    expect(hasHgssPokemonNicknameInput('    ')).toBe(false)
    expect(hasHgssPokemonNicknameInput(' A ')).toBe(true)
    // La ROM ne traite que CHAR_SPACE comme espace : un autre caractère reste
    // une saisie, même si JavaScript le classerait comme whitespace.
    expect(hasHgssPokemonNicknameInput('\t')).toBe(true)

    const state = createState()
    const pokemon = createPokemon(155)
    const preparation = prepareHgssWildCaptureProgression(state, pokemon, {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
    })
    commitHgssWildCaptureProgression(preparation, {
      nicknameWasEntered: hasHgssPokemonNicknameInput('   '),
    })
    expect(state.gameStats.has(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(false)
  })

  it('n’accorde plus event21 à une espèce déjà prise mais donne toujours le score national et stat #10', () => {
    const state = createState()
    state.pokedex.caughtSpeciesIds.add(150)
    const result = finalizeHgssWildCaptureProgression(state, createPokemon(150), {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(),
      nicknameWasEntered: false,
    })
    expect(result).toMatchObject({
      wasAlreadyCaught: true,
      registeredNewSpecies: false,
      scoreEventIds: [11],
      scoreAdded: 3,
    })
    expect(state.gameStats.has(HGSS_NICKNAMES_GIVEN_GAME_STAT_ID)).toBe(false)
    expect(state.gameStats.get(HGSS_CAUGHT_POKEMON_GAME_STAT_ID)).toBe(1)
  })

  it('programme Bill en forcé uniquement si contact, PC plein et flag 0x985 absent', () => {
    const state = createState()
    const filler = createPokemon()
    state.phoneContacts = new Set([9])
    expect(scheduleHgssPostWildBattleCalls(state)).toEqual([])
    for (const box of state.pokemonStorage.boxes) box.fill(filler)
    state.phoneContacts = new Set()
    expect(scheduleHgssPostWildBattleCalls(state)).toEqual([])
    state.phoneContacts = new Set([9])
    const urgent = vi.fn()

    expect(scheduleHgssPostWildBattleCalls(state, urgent)).toEqual([{ triggerId: 3, forcePickUp: true }])
    expect(state.phoneCallTriggers.has(3)).toBe(true)
    expect(urgent).toHaveBeenCalledWith(3)

    state.phoneCallTriggers.clear()
    state.flags = new Set([HGSS_BILL_PC_FULL_ACKNOWLEDGED_FLAG_ID])
    expect(scheduleHgssPostWildBattleCalls(state, urgent)).toEqual([])
    expect(state.phoneCallTriggers.has(3)).toBe(false)
  })

  it('programme Chen sur le palier national exact 50..450 non acquitté, sans amorçage forcé', () => {
    expect(resolveHgssOakDexProgressAcknowledgementFlag(49)).toBeUndefined()
    expect(resolveHgssOakDexProgressAcknowledgementFlag(50)).toBe(0x989)
    expect(resolveHgssOakDexProgressAcknowledgementFlag(493)).toBe(0x991)

    const state = createState()
    for (let speciesId = 1; speciesId <= 49; speciesId += 1) state.pokedex.caughtSpeciesIds.add(speciesId)
    expect(scheduleHgssPostWildBattleCalls(state)).toEqual([])
    state.phoneContacts = new Set([2])
    const result = finalizeHgssWildCaptureProgression(state, createPokemon(50), {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(),
      nicknameWasEntered: false,
    })
    expect(result.scheduledCalls).toEqual([{ triggerId: 4, forcePickUp: false }])
    expect(state.phoneCallTriggers.has(4)).toBe(true)

    state.phoneCallTriggers.clear()
    state.flags = new Set([HGSS_OAK_NATIONAL_DEX_ACKNOWLEDGEMENT_BASE_FLAG_ID + 1])
    expect(scheduleHgssPostWildBattleCalls(state)).toEqual([])
    expect(state.phoneCallTriggers.has(4)).toBe(false)
  })

  it('borne le score global natif et refuse une LUT ROM absente avant mutation', () => {
    const state = createState()
    state.gameScore = 99_999_998
    expect(finalizeHgssWildCaptureProgression(state, createPokemon(155), {
      nativeGameLanguage: 3,
      johtoDexNumbers: johtoDexNumbers(155),
      nicknameWasEntered: false,
    }).scoreAdded).toBe(1)
    expect(state.gameScore).toBe(99_999_999)

    const invalid = createState()
    expect(() => finalizeHgssWildCaptureProgression(invalid, createPokemon(155), {
      nativeGameLanguage: 3,
      johtoDexNumbers: [],
      nicknameWasEntered: false,
    })).toThrow(/index Johto ROM/)
    expect(invalid.gameScore).toBe(0)
    expect(invalid.pokedex.caughtSpeciesIds.size).toBe(0)
  })
})
