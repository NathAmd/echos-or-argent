import { describe, expect, it } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import type { PlayerProfile } from '../../playerProfile'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createHgssPostOakFieldState } from './hgssPostOakFieldState'

function inventoryFixture(): RomInventory {
  return {
    pokemonCatalog: { marker: 'pokemon' },
    safariEncounterCatalog: { marker: 'safari' },
    photoDataCatalog: { marker: 'photo' },
    pokedexCatalog: { marker: 'pokedex' },
    itemCatalog: { marker: 'items' },
    phoneBookEntries: [{ contactId: 1 }],
    trainerCatalog: [{ trainerId: 1 }],
    trainerMessages: { 1: ['Bonjour'] },
    npcTradeCatalog: [{ tradeId: 1 }],
    trainerClassNames: ['Dresseur'],
    easyChatCatalog: { words: [] },
    pokeathlonDataMessages: { 1: 'Record' },
    alphPuzzleTiles: [],
    alphPuzzleBackground: { marker: 'puzzle' },
    alphPuzzleHints: ['Indice'],
    alphHiddenRoomBackground: { marker: 'room' },
    alphHiddenRoomWords: ['ESCAPE'],
    mailMessageBanks: {},
    trainerHouseDefaultName: 'CAL',
    resolvedMapCatalog: {
      maps: [{ id: 42, header: { mapSection: 7 } }],
    },
  } as unknown as RomInventory
}

describe('createHgssPostOakFieldState', () => {
  it('projects ROM resources and keeps temporal bindings live', () => {
    const inventory = inventoryFixture()
    const profile: PlayerProfile = {
      gender: 'female',
      name: 'LYRA',
      trainerId: 0x1234,
      language: 2,
      gameVersion: 7,
    }
    let now = new Date('2026-08-27T10:00:00.000Z')
    let offset = 4
    const state = createHgssPostOakFieldState(inventory, profile, createHgssSessionRng(7), {
      now: () => now,
      ownerRtcOffset: () => offset,
      igtMinutes: () => 125,
      rtcPenalty: () => false,
    })

    expect(state.gender).toBe('female')
    expect(state.playerName).toBe('LYRA')
    expect(state.pokemonRuntime?.trainer).toEqual({
      id: 0x1234,
      name: 'LYRA',
      gender: 'female',
      nameSource: 'user-text',
    })
    expect(state.pokemonRuntime?.catalog).toBe(inventory.pokemonCatalog)
    expect(state.pokemonRuntime?.mapSectionForMapId?.(42)).toBe(7)

    now = new Date('2026-08-28T12:00:00.000Z')
    offset = 9
    expect(state.pokemonRuntime?.now()).toBe(now)
    expect(state.pokemonRuntime?.ownerRtcOffset?.()).toBe(9)
  })

  it('rejects a profile before its native HGSS identity is initialized', () => {
    expect(() => createHgssPostOakFieldState(
      inventoryFixture(),
      { gender: 'male', name: 'ETHAN', language: 2, gameVersion: 7 },
      createHgssSessionRng(7),
      { now: () => new Date(), ownerRtcOffset: () => 0, igtMinutes: () => 0, rtcPenalty: () => false },
    )).toThrow('Le profil HGSS post-Oak est incomplet.')
  })
})
