import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createHgssSessionRng, snapshotHgssSessionRng } from '../pokemon/hgssSessionRng'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState, type FieldPokemonRuntime } from '../scripts/fieldScriptRunner'
import { createHgssOutgoingPhoneSession, getHgssPhoneChoiceLabels } from './outgoingPhoneSession'
import { createPokegearOutgoingPhoneCoordinator } from './pokegearOutgoingPhoneCoordinator'

function createFixture() {
  const catalog = createPokemonTestCatalog()
  const now = new Date(2026, 7, 25, 12)
  const runtime = { now: () => now, trainer: { id: 1 } } as FieldPokemonRuntime
  const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
  const pokemon = createCanonicalPokemon(catalog, {
    speciesId: 152,
    level: 5,
    rng: createHgssLcrng(1),
    personality: { kind: 'fixed', value: 1 },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 1 },
    ballId: 4,
  })
  state.daycare.mons[0] = { pokemon, steps: 91 }
  state.phoneContacts.add(6)
  const map = { id: 1, header: { outgoingCalls: true } } as OpeningMapPreview
  const inventory = {
    pokemonCatalog: catalog,
    phoneBookEntries: [{
      id: 6, type: 9, unknown2: 0, trainerClass: 0, trainerId: 0, mapId: 2,
      giftItemId: 0, localScriptId: 0, unknownC: 0xff, rematchWeekday: 0,
      rematchTimeOfDay: 0, unknownF: 0, sortParameters: [0, 0, 0, 0],
    }],
    phoneContactNames: Object.assign([], { 6: 'PENSION' }),
    phoneContactMessages: { 6: { 3: 'Bonjour.', 5: 'Des nouvelles.', 6: 'Niveaux.', 8: 'Au revoir.' } },
    resolvedMapCatalog: { maps: [] },
    trainerCatalog: [],
    storageBoxNames: ['BOITE 1'],
    itemCatalog: { items: [] },
    pokedexCatalog: { johtoDexNumbers: Array.from({ length: 494 }, () => 0) },
    wildEncounterCatalog: [],
    uiMessageBanks: Object.assign([], {
      271: { 8: 'Économiser', 9: 'Ne pas économiser', 18: 'Oui', 19: 'Non' },
    }),
  } as unknown as RomInventory
  return { state, inventory, map }
}

describe('politique de niveau des appels sortants', () => {
  it('présente la croissance Pension plafonnée sans modifier l’ordre RNG', () => {
    const base = createFixture()
    const capped = createFixture()
    const baseRng = createHgssSessionRng(7)
    const cappedRng = createHgssSessionRng(7)
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 5 }

    const baseSession = createHgssOutgoingPhoneSession(6, base.state, base.inventory, base.map, baseRng)
    const cappedSession = createHgssOutgoingPhoneSession(6, capped.state, capped.inventory, capped.map, cappedRng, levelPolicy)

    expect(baseSession?.context.daycare?.mons[0]?.levelGrowth).toBe(1)
    expect(cappedSession?.context.daycare?.mons[0]?.levelGrowth).toBe(0)
    expect(snapshotHgssSessionRng(cappedRng)).toEqual(snapshotHgssSessionRng(baseRng))
  })

  it('propage la policy du coordinateur jusqu’à la session', () => {
    const fixture = createFixture()
    const resolveLevelCap = vi.fn(() => 5)
    const present = vi.fn()
    const coordinator = createPokegearOutgoingPhoneCoordinator({
      getSnapshot: () => ({ ...fixture, rng: createHgssSessionRng(9) }),
      present,
      choose: vi.fn(),
      finish: vi.fn(),
      persist: vi.fn(),
      levelPolicy: { resolveLevelCap },
    })

    expect(coordinator.start(6)).toBe(true)
    expect(resolveLevelCap).toHaveBeenCalled()
    expect(present).toHaveBeenCalledOnce()
  })

  it('reprend les libellés natifs d’épargne 8/9 pour le menu de Maman', () => {
    const fixture = createFixture()
    fixture.state.phoneContacts.add(0)
    fixture.state.flags.add(0x79)
    fixture.state.flags.add(0xa7)
    fixture.inventory.phoneBookEntries.push({
      ...fixture.inventory.phoneBookEntries[0]!,
      id: 0,
      type: 1,
    })
    const session = createHgssOutgoingPhoneSession(
      0,
      fixture.state,
      fixture.inventory,
      fixture.map,
      createHgssSessionRng(11),
    )

    expect(session?.call.choice?.kind).toBe('mom-saving')
    expect(session && getHgssPhoneChoiceLabels(session, fixture.inventory))
      .toEqual(['Économiser', 'Ne pas économiser'])
  })
})
