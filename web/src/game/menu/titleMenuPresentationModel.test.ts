import { describe, expect, it, vi } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import type { RestoredHgssSaveState } from '../save/hgssSaveState'
import type { HgssBrowserSaveSlot, HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'
import { createHgssRtcPenaltyState } from '../time/hgssRtcPenalty'
import type { NewGamePlusProfileV1 } from '../newGamePlus/newGamePlusTypes'
import { createTitleMenuController } from './titleMenuController'
import {
  createTitleMenuPresentationModel,
  type TitleMenuPresentationInventory,
  type TitleMenuSavePreview,
} from './titleMenuPresentationModel'

const savedAt = '2026-08-24T18:30:00.000Z'

const inventory = {
  uiMessageBanks: {
    196: { 1: 'Équipe' },
    442: {
      0: 'CONTINUER',
      1: 'NOUVELLE PARTIE',
      13: 'SAUVEGARDES',
      14: 'Sauvegardé',
      16: 'Badges',
    },
  },
  resolvedMapCatalog: {
    maps: [{ id: 61, label: 'Doublonville' }],
  },
} satisfies TitleMenuPresentationInventory

function createNewGamePlusProfile(): NewGamePlusProfileV1 {
  return {
    format: 'pokemaster-hgss-new-game-plus',
    version: 1,
    source: {
      gameCode: 'IPKF',
      slot: 1,
      playerName: 'LUTH',
      leagueCompletedAt: savedAt,
    },
    modules: [
      { id: 'carry-pokedex', revision: 1, config: { includeNationalDex: false } },
      { id: 'carry-money', revision: 1, config: { percentage: 50 } },
    ],
  }
}

function createRestoredSave(options: {
  pokedexEnabled?: boolean
  newGamePlus?: NewGamePlusProfileV1
} = {}): RestoredHgssSaveState {
  const rng = createHgssSessionRng(5489)
  const pokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
    speciesId: 155,
    level: 12,
    rng: rng.lc,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: { id: 0x12345678, name: 'LUTH', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
  pokemon.nickname = 'FLAMME'
  const field = createFieldScriptState('male', 'LUTH', {
    party: [pokemon],
    pokedexEnabled: options.pokedexEnabled ?? true,
  })
  field.money = 640_000
  for (let badge = 0; badge < 8; badge += 1) field.badges.add(badge)
  field.pokedex.seenSpeciesIds = new Set([152, 155, 158])
  field.pokedex.caughtSpeciesIds = new Set([155, 158])

  return {
    profile: { gender: 'male', name: 'LUTH', trainerId: 0x12345678, language: 3, gameVersion: 7 },
    rng,
    world: { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    field,
    options: { textSpeed: 'normal', battleAnimations: true, localWeather: false },
    igt: { hours: 42, minutes: 17, seconds: 9 },
    rtcPenalty: createHgssRtcPenaltyState(new Date(savedAt)),
    newGamePlus: options.newGamePlus,
  }
}

function createModel(
  restored: RestoredHgssSaveState,
  createPokemonIcon = vi.fn(() => undefined),
  newGamePlusUnlocked = false,
) {
  const state = createTitleMenuController().open({ newGamePlusUnlocked })
  const saves = new Map<HgssBrowserSaveSlot, TitleMenuSavePreview>([[1, {
    restored,
    savedAt,
    kind: 'manual',
    deletionToken: 'slot-1-exact-bytes' as HgssBrowserSaveSlotDeletionToken,
  }]])
  return {
    createPokemonIcon,
    model: createTitleMenuPresentationModel({
      state,
      saves,
      inventory,
      createPokemonIcon,
      locales: 'fr-FR',
    }),
  }
}

describe('modèle de présentation du menu titre', () => {
  it('projette les statistiques réellement restaurées dans une fiche de sauvegarde', () => {
    const restored = createRestoredSave()
    const { model, createPokemonIcon } = createModel(restored)
    const card = model.items[0]!

    expect(card).toMatchObject({
      id: 'slot-1',
      kind: 'save-slot',
      occupied: true,
      number: '01',
      name: 'LUTH',
      location: 'Doublonville',
      kicker: 'CONTINUER · 01',
      partyLabel: 'Équipe',
    })
    expect(card.progress).toBe('')
    expect(card.savedAt).toMatchObject({ dateTime: savedAt })
    expect(card.savedAt?.label).toContain('Manuelle ·')
    expect(card.stats).toEqual(expect.arrayContaining([
      { label: 'Temps de jeu', value: '42:17:09' },
      { label: 'Badges', value: '8 / 16' },
      { label: 'Pokédex', value: '2 attrapés · 3 vus' },
      { label: 'Argent', value: expect.stringContaining('640') },
    ]))
    expect(card.stats).toHaveLength(4)
    expect(card.actions.map(({ id }) => id)).toEqual(['continue', 'export', 'delete'])
    expect(card.party).toHaveLength(1)
    expect(card.party[0]?.title).toBe('FLAMME · Niv. 12')

    card.party[0]?.createIcon()
    const pokemon = restored.field.party.members[0]!
    expect(createPokemonIcon).toHaveBeenCalledWith(
      pokemon.speciesId,
      pokemon.form,
      pokemon.isEgg,
      pokemon.shiny,
      pokemon.gender,
    )
  })

  it('garde une partie normale compatible et masque un Pokédex qui n’est pas encore obtenu', () => {
    const restored = createRestoredSave({ pokedexEnabled: false })
    restored.world.mapId = 999
    const { model } = createModel(restored, undefined, true)
    const occupied = model.items[0]!

    expect(occupied.location).toBe('999')
    expect(occupied.kicker).toBe('CONTINUER · 01')
    expect(occupied.progress).not.toContain('Pokédex')
    expect(occupied.progress).not.toContain('NG+')
    expect(model.items[1]).toMatchObject({
      id: 'slot-2',
      occupied: false,
      progress: '',
      party: [],
      actions: [{ id: 'new-game' }, { id: 'import' }],
    })
    expect(model.items.at(-1)).toMatchObject({
      id: 'new-game-plus',
      kind: 'action',
      name: 'NOUVELLE PARTIE+',
      actions: [{ id: 'new-game-plus' }],
    })
  })

  it('identifie une sauvegarde NG+ et compte ses modules sans affecter les fiches normales', () => {
    const ngPlus = createModel(createRestoredSave({ newGamePlus: createNewGamePlusProfile() })).model.items[0]!
    const normal = createModel(createRestoredSave()).model.items[0]!

    expect(ngPlus.kicker).toBe('NOUVELLE PARTIE+ · 01')
    expect(ngPlus.progress).toBe('')
    expect(ngPlus.stats).toHaveLength(4)
    expect(normal.kicker).toBe('CONTINUER · 01')
    expect(normal.progress).not.toContain('NG+')
  })

  it('présente un slot corrompu comme occupé avec la suppression pour seule action', () => {
    const menu = createTitleMenuController()
    menu.open()
    const state = menu.focus(1)
    const model = createTitleMenuPresentationModel({
      state,
      saves: new Map(),
      corruptSaves: new Map([[2, { reason: 'Le checksum est invalide.', deletionToken: 'raw-token' as never }]]),
      inventory,
      createPokemonIcon: () => undefined,
    })

    expect(model.heading).toBe('CONTINUER')
    expect(model.items[1]).toMatchObject({
      id: 'slot-2',
      occupied: true,
      corrupted: true,
      name: 'SAUVEGARDE CORROMPUE',
      location: 'Données conservées',
      progress: 'Le checksum est invalide.',
      actions: [{ id: 'delete', slot: 2 }],
    })
    expect(model.items[1]?.actions.map(({ id }) => id)).toEqual(['delete'])
  })
})
