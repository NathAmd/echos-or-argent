import { describe, expect, it, vi } from 'vitest'
import type { GameDigitalAction, GameDigitalEvent } from '../../gameInput'
import type {
  MainMenuItem,
  MainMenuResult,
  MainMenuScreen,
  MainMenuState,
} from './mainMenuController'
import {
  createUtilityMenuInputHost,
  type UtilityMenuInputHostPorts,
  type UtilityMenuInputSelection,
} from './utilityMenuInputHost'

const item = (id: MainMenuItem['id']): MainMenuItem => ({ id, label: id, kind: id === 'root' ? 'screen' : 'command' })

function menuState(
  screen: MainMenuScreen,
  items: readonly MainMenuItem[],
  cursor = 0,
  open = true,
): MainMenuState {
  return { open, screen, cursor, items }
}

function event(action: GameDigitalAction, pressed = true): GameDigitalEvent {
  return { action, pressed, source: 'gamepad' }
}

function pokedexMenuElement(clientHeight = 45, cellHeight = 10): HTMLElement {
  const firstCell = { offsetHeight: cellHeight }
  const grid = {
    clientHeight,
    querySelector: (selector: string) => selector === '.pokedex-grid-cell' ? firstCell : null,
  }
  return {
    querySelector: (selector: string) => selector === '.pokedex-grid' ? grid : null,
  } as unknown as HTMLElement
}

function createFixture(
  initialState: MainMenuState,
  initialSelection: Partial<UtilityMenuInputSelection> = {},
  menuElement = pokedexMenuElement(),
) {
  let state = initialState
  let selection: UtilityMenuInputSelection = {
    teamSummaryOpen: false,
    teamSummaryPage: 'stats',
    teamSlot: 0,
    pokedexSpeciesId: undefined,
    bagActionPopupOpen: false,
    bagPocket: undefined,
    bagItemId: undefined,
    ...initialSelection,
  }
  let handleResult: MainMenuResult = { kind: 'ignored' }
  const focus = vi.fn((cursor: number): MainMenuState => {
    state = { ...state, cursor }
    return state
  })
  const refresh = vi.fn((): MainMenuState => state)
  const menuHandle = vi.fn((action: GameDigitalAction): MainMenuResult => {
    void action
    return handleResult
  })
  const updateSelection = vi.fn((update: Partial<UtilityMenuInputSelection>) => {
    selection = { ...selection, ...update }
  })
  const presentation = {
    render: vi.fn(),
    syncCursor: vi.fn(),
    syncPokedex: vi.fn(),
    syncTeam: vi.fn(),
    syncTeamSummaryPage: vi.fn(),
    syncTeamSummaryPokemon: vi.fn(),
  }
  const cycleForm = vi.fn<UtilityMenuInputHostPorts['pokedex']['cycleForm']>(() => false)
  const closeActionPopup = vi.fn()
  const clearPendingMachineTeaching = vi.fn()
  const syncPocket = vi.fn()
  const syncItemDetail = vi.fn()
  const pokegearHandle = vi.fn<UtilityMenuInputHostPorts['pokegear']['handle']>(() => false)
  const applyResult = vi.fn()
  const playSoundEffect = vi.fn()
  const host = createUtilityMenuInputHost({
    menu: {
      getState: () => state,
      handle: menuHandle,
      focus,
      refresh,
    },
    menuElement,
    readViewportWidth: () => 600,
    readPartySize: () => 3,
    selection: {
      read: () => selection,
      update: updateSelection,
    },
    presentation,
    pokedex: { cycleForm },
    bag: {
      closeActionPopup,
      clearPendingMachineTeaching,
      syncPocket,
      syncItemDetail,
    },
    pokegear: { handle: pokegearHandle },
    applyResult,
    playSoundEffect,
  })
  return {
    host,
    focus,
    refresh,
    menuHandle,
    updateSelection,
    presentation,
    cycleForm,
    closeActionPopup,
    clearPendingMachineTeaching,
    syncPocket,
    syncItemDetail,
    pokegearHandle,
    applyResult,
    playSoundEffect,
    readSelection: () => selection,
    setHandleResult: (result: MainMenuResult) => { handleResult = result },
  }
}

describe('utility menu input host', () => {
  it('ignore les événements lorsque le menu est fermé', () => {
    const fixture = createFixture(menuState('root', [item('pokedex')], 0, false))

    expect(fixture.host.handle(event('confirm'))).toBe(false)
    expect(fixture.menuHandle).not.toHaveBeenCalled()
    expect(fixture.applyResult).not.toHaveBeenCalled()
  })

  it('transmet les relâchements au Pokématos actif puis les consomme sans fallback', () => {
    const released = event('right', false)
    const fixture = createFixture(menuState('pokegear-phone', [item('pokegear-contact:3'), item('pokegear')]))

    expect(fixture.host.handle(released)).toBe(true)
    expect(fixture.pokegearHandle).toHaveBeenCalledWith(released)
    expect(fixture.menuHandle).not.toHaveBeenCalled()
  })

  it('donne la priorité au résumé Équipe pour les pages, les Pokémon et Retour', () => {
    const fixture = createFixture(
      menuState('team', [item('team-member:0'), item('team-member:1'), item('root')]),
      { teamSummaryOpen: true, teamSummaryPage: 'stats', teamSlot: 0 },
    )

    fixture.host.handle(event('right'))
    expect(fixture.readSelection().teamSummaryPage).toBe('moves')
    expect(fixture.presentation.syncTeamSummaryPage).toHaveBeenCalledOnce()

    fixture.host.handle(event('down'))
    expect(fixture.readSelection().teamSlot).toBe(1)
    expect(fixture.presentation.syncTeamSummaryPokemon).toHaveBeenCalledOnce()

    fixture.host.handle(event('cancel'))
    expect(fixture.readSelection().teamSummaryOpen).toBe(false)
    expect(fixture.presentation.render).toHaveBeenCalledWith(fixture.refresh.mock.results.at(-1)?.value)
    expect(fixture.menuHandle).not.toHaveBeenCalled()
  })

  it('priorise les formes Pokédex puis calcule la pagination avec les lignes visibles', () => {
    const entries = Array.from({ length: 12 }, (_, index) => item(`pokedex-species:${100 + index}`))
    const fixture = createFixture(
      menuState('pokedex', [...entries, item('root')], 1),
      { pokedexSpeciesId: 101 },
      pokedexMenuElement(45, 10),
    )
    fixture.cycleForm.mockReturnValueOnce(true)

    fixture.host.handle(event('page-next'))
    expect(fixture.cycleForm).toHaveBeenCalledWith(1, expect.objectContaining({ screen: 'pokedex' }))
    expect(fixture.focus).not.toHaveBeenCalled()

    fixture.host.handle(event('page-next'))
    expect(fixture.focus).toHaveBeenCalledWith(9)
    expect(fixture.readSelection().pokedexSpeciesId).toBe(109)
    expect(fixture.presentation.syncPokedex).toHaveBeenCalledWith(expect.objectContaining({ cursor: 9 }))
    expect(fixture.presentation.syncCursor).not.toHaveBeenCalled()
  })

  it('sélectionne une poche puis un objet sans dupliquer la présentation du Sac', () => {
    const entries = [item('bag-pocket:0'), item('bag-pocket:1'), item('bag-item:42'), item('root')]
    const pocket = createFixture(menuState('bag', entries), { bagPocket: 0 })

    pocket.host.handle(event('down'))
    expect(pocket.readSelection()).toEqual(expect.objectContaining({ bagPocket: 1, bagItemId: undefined }))
    expect(pocket.clearPendingMachineTeaching).toHaveBeenCalledOnce()
    expect(pocket.syncPocket).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1 }))
    expect(pocket.presentation.syncCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1 }))

    const inventoryItem = createFixture(menuState('bag', entries, 1), { bagPocket: 1 })
    inventoryItem.host.handle(event('right'))
    expect(inventoryItem.readSelection().bagItemId).toBe(42)
    expect(inventoryItem.syncItemDetail).toHaveBeenCalledWith(expect.objectContaining({ cursor: 2 }))
    expect(inventoryItem.presentation.syncCursor).toHaveBeenCalledWith(expect.objectContaining({ cursor: 2 }))
  })

  it('ferme prioritairement le popup Sac mais laisse Confirmer atteindre le modèle', () => {
    const state = menuState('bag', [item('bag-action-use:42'), item('root')])
    const cancel = createFixture(state, { bagActionPopupOpen: true })
    cancel.host.handle(event('cancel'))
    expect(cancel.closeActionPopup).toHaveBeenCalledOnce()
    expect(cancel.menuHandle).not.toHaveBeenCalled()

    const confirm = createFixture(state, { bagActionPopupOpen: true })
    confirm.host.handle(event('confirm'))
    expect(confirm.menuHandle).toHaveBeenCalledWith('confirm')
    expect(confirm.applyResult).toHaveBeenCalledWith({ kind: 'ignored' })
  })

  it('synchronise la sélection Équipe et réserve le fallback aux autres écrans', () => {
    const team = createFixture(menuState('team', [item('team-member:0'), item('team-member:1'), item('team-summary:0'), item('root')]))
    team.host.handle(event('down'))
    expect(team.readSelection().teamSlot).toBe(1)
    expect(team.presentation.syncTeam).toHaveBeenCalledWith(expect.objectContaining({ cursor: 1 }))
    expect(team.menuHandle).not.toHaveBeenCalled()

    const rootState = menuState('root', [item('pokedex'), item('team')])
    const fallback = createFixture(rootState)
    const movedState = { ...rootState, cursor: 1 }
    fallback.setHandleResult({ kind: 'state', state: movedState })
    fallback.host.handle(event('down'))
    expect(fallback.presentation.syncCursor).toHaveBeenCalledWith(movedState)
    expect(fallback.applyResult).not.toHaveBeenCalled()
    expect(fallback.playSoundEffect).toHaveBeenCalledWith(1509)
  })

  it('joue le retour sonore natif lors d’une confirmation traitée', () => {
    const fixture = createFixture(menuState('root', [item('pokedex')]))
    fixture.setHandleResult({ kind: 'state', state: menuState('pokedex', [item('pokedex-species:1')]) })

    fixture.host.handle(event('confirm'))

    expect(fixture.playSoundEffect).toHaveBeenCalledWith(1500)
  })

  it('laisse un Pokématos qui a traité la pression court-circuiter le menu', () => {
    const fixture = createFixture(menuState('pokegear-radio', [item('pokegear-radio:2'), item('pokegear')]))
    fixture.pokegearHandle.mockReturnValue(true)

    fixture.host.handle(event('confirm'))

    expect(fixture.pokegearHandle).toHaveBeenCalledOnce()
    expect(fixture.menuHandle).not.toHaveBeenCalled()
    expect(fixture.applyResult).not.toHaveBeenCalled()
  })
})
