import { describe, expect, it, vi } from 'vitest'
import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog, HgssItemData, HgssItemPocket } from '../../rom/items/itemData'
import type { FieldItemEffect } from '../items/useFieldItem'
import type { CanonicalPokemon, CanonicalPokemonMove } from '../pokemon/canonicalPokemon'
import { basePokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { basePokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import {
  createBagMenuCommandHost,
  type BagMenuCommandHostPorts,
  type BagMenuCommandOperations,
  type BagMenuCommandResources,
  type BagMenuCommandSelection,
  type BagMenuCommandState,
  type BagMenuCommandWorld,
} from './bagMenuCommandHost'
import type {
  MainMenuCommand,
  MainMenuResult,
  MainMenuState,
} from './mainMenuController'

function menuState(items: MainMenuState['items'] = [], cursor = 0): MainMenuState {
  return { open: true, screen: 'bag', cursor, items }
}

function commandResult(command: MainMenuCommand): MainMenuResult {
  return { kind: 'command', command, state: menuState() }
}

function createItem(itemId: number, name: string, fieldPocket: HgssItemPocket = 1): HgssItemData {
  return { itemId, name, fieldPocket, holdEffect: 0 } as HgssItemData
}

function createEffect(overrides: Partial<FieldItemEffect> = {}): FieldItemEffect {
  return {
    hpRestored: 20,
    statusHealed: false,
    ppRestored: 0,
    ppUpsAdded: 0,
    revived: false,
    levelsGained: 0,
    learnedMoveIds: [],
    skippedMoveIds: [],
    effortValueChange: 0,
    friendshipChange: 0,
    ...overrides,
  }
}

function createFixture(options: { defaultOperations?: boolean, resources?: boolean } = {}) {
  const pokemon = {
    instanceId: 'pokemon:bag-host',
    speciesId: 1,
    speciesName: 'GERMIGNON',
    nickname: 'Herbe',
    heldItemId: 0,
    isEgg: false,
    moves: [{ moveId: 33 }],
  } as CanonicalPokemon
  const itemCatalog = {
    items: Array.from({ length: 451 }),
    pocketNames: ['Objets', 'Soins', 'Balls', 'CT/CS'],
  } as unknown as HgssItemCatalog
  itemCatalog.items[17] = createItem(17, 'POTION')
  itemCatalog.items[18] = createItem(18, 'ANTIDOTE')
  itemCatalog.items[79] = createItem(79, 'REPOUSSE')
  itemCatalog.items[221] = createItem(221, 'RAPPEL MAX')
  itemCatalog.items[328] = createItem(328, 'MITRA-POING', 3)
  itemCatalog.items[445] = createItem(445, 'CANNE', 7)
  itemCatalog.items[450] = createItem(450, 'BICYCLETTE', 7)
  const moveNames = Array.from({ length: 265 }, () => '')
  moveNames[33] = 'CHARGE'
  moveNames[264] = 'MITRA-POING'
  const pokemonCatalog = { moveNames } as unknown as PokemonCatalog
  const resources: BagMenuCommandResources = {
    itemCatalog,
    pokemonCatalog,
    uiMessageBanks: {
      10: {},
      300: {
        59: '{101 0,0} n’apprend pas {106 1,0}.',
        60: 'Choisissez une capacité.',
        61: '{101 0,0} oublie {106 1,0}.',
        62: '{101 0,0} apprend {106 1,0}.',
      },
    },
  }
  const state = {
    inventory: new Map<number, number>([
      [17, 2],
      [18, 1],
      [79, 2],
      [221, 1],
      [328, 2],
      [445, 1],
      [450, 1],
    ]),
    party: { members: [pokemon] },
    roamers: { repelSteps: 0 },
    currentMapId: 7,
  } as unknown as BagMenuCommandState
  const selection: {
    pocket?: HgssItemPocket
    itemId?: number
    action?: 'use' | 'give'
    pendingMachineTeaching?: { itemId: number, partySlot: number }
    actionPopupOpen: boolean
  } = {
    pocket: 1,
    itemId: 17,
    actionPopupOpen: false,
  }
  let currentMenuState = menuState()
  let refreshedMenuState = menuState()
  let confirmationResolve: ((confirmed: boolean) => void) | undefined
  let resourcesAvailable = options.resources ?? true
  const worldState = {
    locomotion: 'walking' as const,
    map: { header: { bikeAllowed: true } },
  }
  const world = {
    getState: vi.fn(() => worldState),
    setLocomotion: vi.fn(),
  } as unknown as BagMenuCommandWorld
  const getState = vi.fn(() => currentMenuState)
  const close = vi.fn(() => ({ ...currentMenuState, open: false }))
  const refresh = vi.fn(() => refreshedMenuState)
  const focus = vi.fn((cursor: number) => ({ ...refreshedMenuState, cursor }))
  const render = vi.fn((next: MainMenuState) => { currentMenuState = next })
  const syncPocket = vi.fn()
  const syncCursor = vi.fn()
  const updateSelection = vi.fn((update: Partial<BagMenuCommandSelection>) => {
    Object.assign(selection, update)
  })
  const requestConfirmation = vi.fn((_message: string, resolve: (confirmed: boolean) => void) => {
    confirmationResolve = resolve
  })
  const applyPlayerSkin = vi.fn()
  const syncFollower = vi.fn()
  const startFishing = vi.fn()
  const useSweetScent = vi.fn()
  const createMoveLearningEntries = vi.fn(() => [] as string[])
  const createEvolutionEntry = vi.fn(() => ({ text: 'évolution' }))
  const startPresentation = vi.fn()
  const startEvolution = vi.fn()
  const clearNotice = vi.fn()
  const setStatus = vi.fn()
  const setFieldStatus = vi.fn()
  const persist = vi.fn()
  const machine = { itemId: 328, moveId: 264, kind: 'CT', number: 1, consumed: true } as const
  const operations = {
    getMachine: vi.fn((itemId: number) => itemId === 328 ? machine : undefined),
    useMachine: vi.fn(() => ({ kind: 'unavailable', reason: 'CT indisponible.' })),
    giveHeldItem: vi.fn(() => ({ kind: 'given', previousItemId: 0 })),
    useRepel: vi.fn(() => ({ kind: 'used', steps: 100, remaining: 1 })),
    useOnPokemon: vi.fn(() => ({ kind: 'used', effect: createEffect(), remaining: 1 })),
    useOnParty: vi.fn(() => ({ kind: 'used', effects: [{ partySlot: 0, effect: createEffect() }], remaining: 0 })),
  } as unknown as BagMenuCommandOperations
  const ports: BagMenuCommandHostPorts = {
    menu: { getState, close, refresh, focus, render, syncPocket, syncCursor },
    selection: {
      read: () => selection,
      update: updateSelection,
    },
    resources: { read: () => resourcesAvailable ? resources : undefined },
    state: { read: () => state },
    confirmation: { request: requestConfirmation },
    policies: {
      level: basePokemonLevelPolicy,
      healing: basePokemonPartyHealingPolicy,
      team: basePokemonTeamPolicy,
    },
    world: { read: () => world, applyPlayerSkin, syncFollower },
    encounters: { startFishing, useSweetScent },
    progression: {
      moveLearning: { createMoveLearningEntries },
      createEvolutionEntry,
      startPresentation,
      startEvolution,
    },
    currentTimeOfDay: () => 2,
    clearNotice,
    setStatus,
    setFieldStatus,
    persist,
  }
  const host = options.defaultOperations
    ? createBagMenuCommandHost(ports)
    : createBagMenuCommandHost(ports, operations)

  return {
    host,
    pokemon,
    itemCatalog,
    resources,
    state,
    selection,
    world,
    worldState,
    operations,
    getState,
    close,
    refresh,
    focus,
    render,
    syncPocket,
    syncCursor,
    updateSelection,
    requestConfirmation,
    applyPlayerSkin,
    syncFollower,
    startFishing,
    useSweetScent,
    createMoveLearningEntries,
    createEvolutionEntry,
    startPresentation,
    startEvolution,
    clearNotice,
    setStatus,
    setFieldStatus,
    persist,
    setRefreshedMenuState: (next: MainMenuState) => { refreshedMenuState = next },
    setCurrentMenuState: (next: MainMenuState) => { currentMenuState = next },
    setResourcesAvailable: (available: boolean) => { resourcesAvailable = available },
    resolveConfirmation: (confirmed: boolean) => confirmationResolve?.(confirmed),
  }
}

describe('bagMenuCommandHost', () => {
  it('ne consomme ni un état de menu ni une commande d’un autre domaine', () => {
    const fixture = createFixture()

    expect(fixture.host.handle({ kind: 'state', state: menuState() })).toBe(false)
    expect(fixture.host.handle(commandResult('team-member:0'))).toBe(false)
    expect(fixture.render).not.toHaveBeenCalled()
    expect(fixture.updateSelection).not.toHaveBeenCalled()
  })

  it('change de poche, efface les sous-sélections puis synchronise la colonne et le curseur', () => {
    const fixture = createFixture()
    fixture.selection.action = 'give'
    fixture.selection.pendingMachineTeaching = { itemId: 328, partySlot: 0 }
    fixture.selection.actionPopupOpen = true
    const refreshed = menuState([
      { id: 'bag-pocket:2', label: 'Balls', kind: 'command' },
      { id: 'bag-item:4', label: 'Poké Ball', kind: 'command' },
    ])
    fixture.setRefreshedMenuState(refreshed)

    expect(fixture.host.handle(commandResult('bag-pocket:2'))).toBe(true)
    expect(fixture.selection).toMatchObject({ pocket: 2, actionPopupOpen: false })
    expect(fixture.selection.itemId).toBeUndefined()
    expect(fixture.selection.action).toBeUndefined()
    expect(fixture.selection.pendingMachineTeaching).toBeUndefined()
    expect(fixture.focus).toHaveBeenCalledWith(1)
    expect(fixture.syncPocket).toHaveBeenCalledWith({ ...refreshed, cursor: 1 })
    expect(fixture.syncCursor).toHaveBeenCalledWith({ ...refreshed, cursor: 1 })
    expect(fixture.render).not.toHaveBeenCalled()
  })

  it('ignore une poche hors catalogue tout en refermant son action', () => {
    const fixture = createFixture()
    fixture.selection.itemId = 18
    fixture.selection.actionPopupOpen = true

    fixture.host.handle(commandResult('bag-pocket:7'))

    expect(fixture.selection.pocket).toBe(1)
    expect(fixture.selection.itemId).toBe(18)
    expect(fixture.selection.actionPopupOpen).toBe(false)
  })

  it('ouvre les actions d’un objet et avertit précisément lorsqu’il n’en existe aucune', () => {
    const fixture = createFixture()
    const withAction = menuState([
      { id: 'bag-item:17', label: 'Potion', kind: 'command' },
      { id: 'bag-action-use:17', label: 'Utiliser', kind: 'command' },
    ])
    fixture.setRefreshedMenuState(withAction)

    fixture.host.handle(commandResult('bag-item:17'))
    expect(fixture.selection).toMatchObject({ itemId: 17, actionPopupOpen: true })
    expect(fixture.focus).toHaveBeenLastCalledWith(1)

    fixture.setRefreshedMenuState(menuState([{ id: 'bag-item:18', label: 'Antidote', kind: 'command' }]))
    fixture.host.handle(commandResult('bag-item:18'))
    expect(fixture.selection.actionPopupOpen).toBe(false)
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Cet objet ne peut pas être utilisé depuis le terrain.',
      'info',
    )
  })

  it('navigue entre choix, cible et fermeture sans perdre l’objet sélectionné', () => {
    const fixture = createFixture()
    fixture.selection.actionPopupOpen = true
    fixture.setRefreshedMenuState(menuState([
      { id: 'bag-item:17', label: 'Potion', kind: 'command' },
      { id: 'bag-use:17:0', label: 'Herbe', kind: 'command' },
    ]))

    fixture.host.handle(commandResult('bag-action-use:17'))
    expect(fixture.selection.action).toBe('use')
    expect(fixture.focus).toHaveBeenLastCalledWith(1)

    fixture.setRefreshedMenuState(menuState([
      { id: 'bag-item:17', label: 'Potion', kind: 'command' },
      { id: 'bag-action-use:17', label: 'Utiliser', kind: 'command' },
    ]))
    fixture.host.closeActionPopup()
    expect(fixture.selection.action).toBeUndefined()
    expect(fixture.selection.actionPopupOpen).toBe(true)
    expect(fixture.focus).toHaveBeenLastCalledWith(1)

    fixture.host.closeActionPopup()
    expect(fixture.selection.actionPopupOpen).toBe(false)
    expect(fixture.focus).toHaveBeenLastCalledWith(0)
  })

  it('diffère une utilisation confirmable, annule sans mutation puis l’exécute une seule fois', () => {
    const fixture = createFixture()
    fixture.selection.action = 'use'
    fixture.selection.actionPopupOpen = true
    const current = menuState([{ id: 'bag-use:17:0', label: 'Utiliser', kind: 'command' }])
    fixture.setCurrentMenuState(current)

    expect(fixture.host.handle(commandResult('bag-use:17:0'))).toBe(true)
    expect(fixture.requestConfirmation).toHaveBeenCalledWith(
      'Utiliser POTION sur Herbe ?',
      expect.any(Function),
    )
    expect(fixture.operations.useOnPokemon).not.toHaveBeenCalled()

    fixture.resolveConfirmation(false)
    expect(fixture.render).toHaveBeenLastCalledWith(current)
    expect(fixture.selection).toMatchObject({ action: 'use', actionPopupOpen: true })

    fixture.host.handle(commandResult('bag-use:17:0'))
    fixture.resolveConfirmation(true)
    expect(fixture.operations.useOnPokemon).toHaveBeenCalledOnce()
    expect(fixture.selection.action).toBeUndefined()
    expect(fixture.selection.actionPopupOpen).toBe(false)
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'POTION utilisé sur Herbe : 20 PV récupérés.',
      'success',
    )
  })

  it('ouvre puis résout le remplacement CT/CS sans consommer sur le premier choix', () => {
    const fixture = createFixture()
    const learned = { moveId: 264 } as CanonicalPokemonMove
    const forgotten = { moveId: 33 } as CanonicalPokemonMove
    vi.mocked(fixture.operations.useMachine)
      .mockReturnValueOnce({ kind: 'replacement-required', machine: vi.mocked(fixture.operations.getMachine)(328)! })
      .mockReturnValueOnce({
        kind: 'learned',
        machine: vi.mocked(fixture.operations.getMachine)(328)!,
        learned,
        forgotten,
      })
    fixture.setRefreshedMenuState(menuState([
      { id: 'bag-item:328', label: 'CT01', kind: 'command' },
      { id: 'bag-machine-replace:328:0:0', label: 'CHARGE', kind: 'command' },
    ]))

    fixture.host.handle(commandResult('bag-machine-target:328:0'))
    expect(fixture.selection.pendingMachineTeaching).toEqual({ itemId: 328, partySlot: 0 })
    expect(fixture.selection.actionPopupOpen).toBe(true)
    expect(fixture.setStatus).toHaveBeenLastCalledWith('Choisissez une capacité.', 'info')
    expect(fixture.persist).not.toHaveBeenCalled()

    fixture.host.handle(commandResult('bag-machine-replace:328:0:0'))
    expect(fixture.operations.useMachine).toHaveBeenLastCalledWith(
      fixture.state.inventory,
      328,
      fixture.pokemon,
      fixture.resources.pokemonCatalog,
      0,
    )
    expect(fixture.selection.pendingMachineTeaching).toBeUndefined()
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Herbe oublie CHARGE.\nHerbe apprend MITRA-POING.',
      'success',
    )
    expect(fixture.persist).toHaveBeenCalledOnce()
  })

  it('refuse un remplacement CT/CS périmé avant toute mutation', () => {
    const fixture = createFixture()
    fixture.selection.pendingMachineTeaching = { itemId: 328, partySlot: 1 }

    fixture.host.handle(commandResult('bag-machine-replace:328:0:0'))

    expect(fixture.operations.useMachine).not.toHaveBeenCalled()
    expect(fixture.setStatus).toHaveBeenCalledWith(
      'Le choix d’apprentissage a expiré sans modifier les capacités.',
      'warning',
    )
    expect(fixture.render).toHaveBeenCalledWith(expect.objectContaining({ screen: 'bag' }))
  })

  it('annule explicitement l’apprentissage CT/CS et efface son sentinel', () => {
    const fixture = createFixture()
    fixture.selection.pendingMachineTeaching = { itemId: 328, partySlot: 0 }

    fixture.host.handle(commandResult('bag-machine-cancel:328:0'))

    expect(fixture.selection.pendingMachineTeaching).toBeUndefined()
    expect(fixture.setStatus).toHaveBeenCalledWith(
      'Herbe n’apprend pas MITRA-POING.',
      'info',
    )
  })

  it('donne réellement un objet tenu après confirmation puis persiste la mutation', () => {
    const fixture = createFixture({ defaultOperations: true })

    fixture.host.handle(commandResult('bag-give:17:0'))
    expect(fixture.state.inventory.get(17)).toBe(2)
    expect(fixture.pokemon.heldItemId).toBe(0)

    fixture.resolveConfirmation(true)
    expect(fixture.state.inventory.get(17)).toBe(1)
    expect(fixture.pokemon.heldItemId).toBe(17)
    expect(fixture.setStatus).toHaveBeenLastCalledWith('Herbe tient maintenant POTION.', 'success')
    expect(fixture.persist).toHaveBeenCalledOnce()
  })

  it('bascule la bicyclette et ferme le menu, mais conserve le menu ouvert sur l’eau', () => {
    const fixture = createFixture()

    fixture.host.handle(commandResult('bag-bike:450'))
    expect(fixture.world.setLocomotion).toHaveBeenCalledWith('cycling')
    expect(fixture.applyPlayerSkin).toHaveBeenCalledOnce()
    expect(fixture.syncFollower).toHaveBeenCalledWith(false)
    expect(fixture.setFieldStatus).toHaveBeenCalledWith('Bicyclette utilisée.')
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }))

    vi.mocked(fixture.world.getState).mockReturnValue({
      ...fixture.worldState,
      locomotion: 'surfing',
    } as ReturnType<BagMenuCommandWorld['getState']>)
    fixture.host.handle(commandResult('bag-bike:450'))
    expect(fixture.world.setLocomotion).toHaveBeenCalledOnce()
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'Impossible d’utiliser la Bicyclette sur l’eau.',
      'warning',
    )
  })

  it('consomme réellement un Repousse confirmé et remplace le compteur de pas', () => {
    const fixture = createFixture({ defaultOperations: true })

    fixture.host.handle(commandResult('bag-repel:79'))
    expect(fixture.state.inventory.get(79)).toBe(2)
    fixture.resolveConfirmation(true)

    expect(fixture.state.inventory.get(79)).toBe(1)
    expect(fixture.state.roamers.repelSteps).toBe(100)
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'REPOUSSE utilisé : effet actif pendant 100 pas.',
      'success',
    )
    expect(fixture.persist).toHaveBeenCalledOnce()
  })

  it('ferme le menu avant la pêche et délègue le Miel sans rendu inventé', () => {
    const fixture = createFixture()

    fixture.state.inventory.delete(445)
    fixture.host.handle(commandResult('bag-fish:445'))
    expect(fixture.startFishing).not.toHaveBeenCalled()
    expect(fixture.setStatus).toHaveBeenLastCalledWith('Cette canne n’est plus dans le Sac.', 'warning')

    fixture.state.inventory.set(445, 1)
    fixture.host.handle(commandResult('bag-fish:445'))
    expect(fixture.startFishing).toHaveBeenCalledWith(445)
    expect(fixture.render).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }))
    const renderCount = fixture.render.mock.calls.length

    fixture.host.handle(commandResult('bag-sweet-scent:94'))
    expect(fixture.useSweetScent).toHaveBeenCalledWith('honey')
    expect(fixture.render).toHaveBeenCalledTimes(renderCount)
  })

  it('transmet toutes les politiques à un objet ciblé puis persiste un effet simple', () => {
    const fixture = createFixture()

    fixture.host.handle(commandResult('bag-use-move:17:0:2'))
    fixture.resolveConfirmation(true)

    expect(fixture.operations.useOnPokemon).toHaveBeenCalledWith(
      fixture.state.inventory,
      fixture.itemCatalog.items[17],
      fixture.pokemon,
      2,
      expect.objectContaining({
        levelPolicy: basePokemonLevelPolicy,
        healingPolicy: basePokemonPartyHealingPolicy,
        teamPolicy: basePokemonTeamPolicy,
        partyIndex: 0,
        healingSource: 'field-item',
        currentLocationId: 7,
        timeOfDay: 2,
        deferEvolution: true,
      }),
    )
    expect(fixture.persist).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenLastCalledWith(expect.objectContaining({ screen: 'bag' }))
  })

  it('ferme le Sac et démarre la séquence complète niveau/apprentissage/évolution', () => {
    const fixture = createFixture()
    const effect = createEffect({
      levelsGained: 1,
      learnedMoveIds: [45],
      skippedMoveIds: [73],
      evolvedToSpeciesId: 2,
      evolutionContext: 'level-up',
    })
    vi.mocked(fixture.operations.useOnPokemon).mockReturnValue({ kind: 'used', effect, remaining: 1 })
    fixture.createMoveLearningEntries.mockReturnValue(['Herbe apprend Rugissement.'])
    const evolutionEntry = { text: '', onShow: vi.fn() }
    fixture.createEvolutionEntry.mockReturnValue(evolutionEntry)

    fixture.host.handle(commandResult('bag-use:17:0'))
    fixture.resolveConfirmation(true)

    expect(fixture.createMoveLearningEntries).toHaveBeenCalledWith(
      fixture.pokemon,
      { kind: 'field', partySlot: 0, cancellable: true },
      [45],
      [73],
    )
    expect(fixture.createEvolutionEntry).toHaveBeenCalledWith(
      fixture.pokemon,
      { kind: 'field', partySlot: 0, cancellable: true },
    )
    expect(fixture.startPresentation).toHaveBeenCalledWith([
      expect.stringContaining('niveau +1'),
      'Herbe apprend Rugissement.',
      evolutionEntry,
    ])
    expect(fixture.clearNotice).toHaveBeenCalledOnce()
    expect(fixture.render).toHaveBeenLastCalledWith(expect.objectContaining({ open: false }))
    expect(fixture.persist).not.toHaveBeenCalled()
  })

  it('démarre directement une évolution d’objet isolée avec sa règle ROM', () => {
    const fixture = createFixture()
    const effect = createEffect({
      hpRestored: 0,
      evolvedToSpeciesId: 2,
      evolutionContext: 'item-use',
      evolutionMethod: 7,
      evolutionParameter: 80,
    })
    vi.mocked(fixture.operations.useOnPokemon).mockReturnValue({ kind: 'used', effect, remaining: 1 })

    fixture.host.handle(commandResult('bag-use:17:0'))
    fixture.resolveConfirmation(true)

    expect(fixture.startEvolution).toHaveBeenCalledWith(
      fixture.pokemon,
      2,
      { kind: 'field', partySlot: 0, cancellable: false },
      { method: 7, parameter: 80, targetSpeciesId: 2 },
    )
    expect(fixture.startPresentation).not.toHaveBeenCalled()
    expect(fixture.persist).not.toHaveBeenCalled()
  })

  it('applique un objet d’Équipe, resynchronise le follower puis persiste', () => {
    const fixture = createFixture()
    vi.mocked(fixture.operations.useOnParty).mockReturnValue({
      kind: 'used',
      effects: [
        { partySlot: 0, effect: createEffect() },
        { partySlot: 1, effect: createEffect() },
      ],
      remaining: 0,
    })

    fixture.host.handle(commandResult('bag-use-party:221'))
    fixture.resolveConfirmation(true)

    expect(fixture.operations.useOnParty).toHaveBeenCalledWith(
      fixture.state.inventory,
      fixture.itemCatalog.items[221],
      fixture.state.party.members,
      { healingPolicy: basePokemonPartyHealingPolicy },
    )
    expect(fixture.setStatus).toHaveBeenLastCalledWith(
      'RAPPEL MAX réanime 2 Pokémon de l’Équipe.',
      'success',
    )
    expect(fixture.syncFollower).toHaveBeenCalledWith(true)
    expect(fixture.persist).toHaveBeenCalledOnce()
  })

  it('garde les erreurs sans ROM dans le host et réinitialise son état de sélection', () => {
    const fixture = createFixture({ resources: false })
    fixture.selection.action = 'give'
    fixture.selection.pendingMachineTeaching = { itemId: 328, partySlot: 0 }
    fixture.selection.actionPopupOpen = true

    fixture.host.handle(commandResult('bag-use:17:0'))
    expect(fixture.setStatus).toHaveBeenCalledWith(
      'La cible ou l’objet du Sac n’est plus disponible.',
      'warning',
    )
    // Sans ROM, l’ancien code ne passait pas par le nettoyage des actions.
    expect(fixture.selection.action).toBe('give')
    expect(fixture.selection.actionPopupOpen).toBe(true)

    fixture.host.reset()
    expect(fixture.selection.action).toBeUndefined()
    expect(fixture.selection.pendingMachineTeaching).toBeUndefined()
    expect(fixture.selection.actionPopupOpen).toBe(false)
  })
})
