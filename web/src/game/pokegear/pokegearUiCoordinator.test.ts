import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import type { MainMenuController, MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createPokegearNativeState } from './pokegearNativeState'
import { createPokegearUiCoordinator, type PokegearUiCoordinatorDependencies } from './pokegearUiCoordinator'

const menuState: MainMenuState = { open: true, screen: 'pokegear', cursor: 0, items: [] }

function createMenuStub(): MainMenuController {
  return {
    getState: () => menuState,
    open: () => menuState,
    close: () => menuState,
    refresh: () => menuState,
    openScreen: () => menuState,
    focus: () => menuState,
    select: () => ({ kind: 'ignored' }),
    handle: () => ({ kind: 'ignored' }),
  }
}

describe('Pokématos UI coordinator', () => {
  it("laisse le changement de page au menu principal et ne conserve plus d'onglets internes", () => {
    const pokegear = { ...createPokegearNativeState(), lastUsedApp: 3 as const }
    const fieldState = { pokegearCards: new Set([1, 2]), pokegear }
    const state: MainMenuState = {
      open: true,
      screen: 'pokegear-map',
      cursor: 0,
      items: [{ id: 'pokegear', label: '', kind: 'screen' }],
    }
    const menu = { ...createMenuStub(), getState: () => state, refresh: () => state }
    const renderMenu = vi.fn()
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const coordinator = createPokegearUiCoordinator({
      getInventory: () => undefined,
      getFieldState: () => fieldState,
      getMap: () => undefined,
      getPlayerPosition: () => undefined,
      getAudio: () => undefined,
      menu,
      menuElement: {} as HTMLElement,
      renderMenu,
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist: vi.fn(),
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection: vi.fn(),
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies)

    const initialCard = coordinator.getSelectedCard()
    expect(coordinator.handleDatasetButton({ dataset: { pokegearCard: '1' } } as unknown as HTMLButtonElement)).toBe(false)
    expect(coordinator.getSelectedCard()).toBe(initialCard)
    expect(renderMenu).not.toHaveBeenCalled()
  })

  it("ne change plus d'application avec les gâchettes depuis une page dédiée", () => {
    vi.stubGlobal('window', { innerWidth: 1024, setTimeout: vi.fn(() => 1), clearTimeout: vi.fn() })
    try {
      const pokegear = { ...createPokegearNativeState(), lastUsedApp: 3 as const }
      const fieldState = { pokegearCards: new Set([1, 2]), pokegear }
      const state: MainMenuState = {
        open: true,
        screen: 'pokegear-phone',
        cursor: 0,
        items: [{ id: 'pokegear', label: '', kind: 'screen' }],
      }
      const menu = { ...createMenuStub(), getState: () => state, refresh: () => state }
      const renderMenu = vi.fn()
      const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
      const coordinator = createPokegearUiCoordinator({
        getInventory: () => undefined,
        getFieldState: () => fieldState,
        getMap: () => undefined,
        getPlayerPosition: () => undefined,
        getAudio: () => undefined,
        menu,
        menuElement: {} as HTMLElement,
        renderMenu,
        syncMenuCursor: vi.fn(),
        refreshInputPrompts: vi.fn(),
        persist: vi.fn(),
        confirmFly: vi.fn(),
        useFly: vi.fn(),
        applyMenuSelection: vi.fn(),
        createButton: unexpected,
        createPortrait: unexpected,
        createGraphic: unexpected,
        createPokemonIcon: () => undefined,
      } as unknown as PokegearUiCoordinatorDependencies)
      coordinator.selectCard(0)

      expect(coordinator.handleDigitalEvent({ action: 'page-next', pressed: true, source: 'gamepad' })).toBe(false)
      expect(coordinator.handleDigitalEvent({ action: 'page-next', pressed: true, source: 'gamepad' })).toBe(true)
      expect(coordinator.getSelectedCard()).toBe(0)
      expect(renderMenu).not.toHaveBeenCalled()

      expect(coordinator.handleDigitalEvent({ action: 'page-next', pressed: false, source: 'gamepad' })).toBe(false)
      expect(coordinator.handleDigitalEvent({ action: 'page-next', pressed: true, source: 'gamepad' })).toBe(false)
      expect(coordinator.getSelectedCard()).toBe(0)
      expect(renderMenu).not.toHaveBeenCalled()
    } finally {
      vi.unstubAllGlobals()
    }
  })

  it('garde le focus des thèmes hors du curseur du menu principal', () => {
    const pokegear = { ...createPokegearNativeState(), skin: 0 }
    const fieldState = { pokegearCards: new Set<number>(), pokegear }
    const items: MainMenuItem[] = [
      ...Array.from({ length: 8 }, (_, theme) => ({ id: `pokegear-skin:${theme}` as const, label: '', kind: 'command' as const })),
      { id: 'pokegear', label: '', kind: 'screen' as const },
    ]
    const state: MainMenuState = { open: true, screen: 'pokegear-configure', cursor: 0, items }
    const focusMainMenu = vi.fn(() => state)
    const menu = { ...createMenuStub(), getState: () => state, refresh: () => state, focus: focusMainMenu }
    const themeButtons = Array.from({ length: 8 }, (_, theme) => ({
      dataset: { pokegearTheme: String(theme) },
      tabIndex: -1,
      setAttribute: vi.fn(),
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
    }))
    const menuElement = {
      querySelectorAll: vi.fn(() => themeButtons),
      querySelector: vi.fn(() => null),
    } as unknown as HTMLElement
    const applyMenuSelection = vi.fn()
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const coordinator = createPokegearUiCoordinator({
      getInventory: () => undefined,
      getFieldState: () => fieldState,
      getMap: () => undefined,
      getPlayerPosition: () => undefined,
      getAudio: () => undefined,
      menu,
      menuElement,
      renderMenu: vi.fn(),
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist: vi.fn(),
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection,
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies)
    coordinator.selectCard(3)

    expect(coordinator.handleDigitalEvent({ action: 'right', pressed: true, source: 'keyboard' })).toBe(true)
    expect(focusMainMenu).not.toHaveBeenCalled()
    expect(themeButtons[1]!.focus).toHaveBeenCalledWith({ preventScroll: true })

    expect(coordinator.handleDigitalEvent({ action: 'confirm', pressed: true, source: 'keyboard' })).toBe(true)
    expect(applyMenuSelection).toHaveBeenCalledWith(1)
  })

  it('consumes radio confirmation without changing the tuned station', () => {
    const pokegear = { ...createPokegearNativeState(), lastUsedApp: 1 as const, radioCursorX: 112, radioCursorY: 76 }
    const fieldState = { pokegearCards: new Set([2]), pokegear }
    const persist = vi.fn()
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const dependencies = {
      getInventory: () => undefined,
      getFieldState: () => fieldState,
      getMap: () => undefined,
      getPlayerPosition: () => undefined,
      getAudio: () => undefined,
      menu: createMenuStub(),
      menuElement: {} as HTMLElement,
      renderMenu: vi.fn(),
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist,
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection: vi.fn(),
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies
    const coordinator = createPokegearUiCoordinator(dependencies)
    coordinator.selectCard(2)
    persist.mockClear()

    const consumed = coordinator.handleDigitalEvent({ action: 'confirm', pressed: true, source: 'keyboard', inputId: 'Enter' })

    expect(consumed).toBe(true)
    expect(fieldState.pokegear.radioCursorX).toBe(112)
    expect(fieldState.pokegear.radioCursorY).toBe(76)
    expect(persist).not.toHaveBeenCalled()
  })

  it("laisse Escape et Annuler au menu global depuis une application", () => {
    const pokegear = { ...createPokegearNativeState(), lastUsedApp: 1 as const }
    const fieldState = { pokegearCards: new Set([0, 1, 2]), pokegear }
    const appState: MainMenuState = {
      open: true,
      screen: 'pokegear-radio',
      cursor: 0,
      items: [{ id: 'pokegear', label: '', kind: 'screen' }],
    }
    const menu = { ...createMenuStub(), getState: () => appState, refresh: () => appState, focus: () => appState }
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const coordinator = createPokegearUiCoordinator({
      getInventory: () => undefined,
      getFieldState: () => fieldState,
      getMap: () => undefined,
      getPlayerPosition: () => undefined,
      getAudio: () => undefined,
      menu,
      menuElement: {} as HTMLElement,
      renderMenu: vi.fn(),
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist: vi.fn(),
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection: vi.fn(),
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies)
    coordinator.selectCard(2)

    expect(coordinator.handleDigitalEvent({ action: 'cancel', pressed: true, source: 'keyboard', inputId: 'Escape' })).toBe(false)
    expect(coordinator.getSelectedCard()).toBe(2)
  })

  it("laisse le bouton retour de la Carte rejoindre le burger Pokematos au lieu d'activer Vol", () => {
    const pokegear = { ...createPokegearNativeState(), lastUsedApp: 2 as const }
    const fieldState = { pokegearCards: new Set([1]), pokegear }
    const appState: MainMenuState = {
      open: true,
      screen: 'pokegear-map',
      cursor: 0,
      items: [{ id: 'pokegear', label: '', kind: 'screen' }],
    }
    const menu = { ...createMenuStub(), getState: () => appState, refresh: () => appState }
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const coordinator = createPokegearUiCoordinator({
      getInventory: () => undefined,
      getFieldState: () => fieldState,
      getMap: () => undefined,
      getPlayerPosition: () => undefined,
      getAudio: () => undefined,
      menu,
      menuElement: {} as HTMLElement,
      renderMenu: vi.fn(),
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist: vi.fn(),
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection: vi.fn(),
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies)
    coordinator.selectCard(1)

    expect(coordinator.handleDigitalEvent({ action: 'confirm', pressed: true, source: 'pointer' })).toBe(false)
  })

  it('restaure la carte si une station echoue avant de posseder le canal BGM', async () => {
    const state = createFieldScriptState('male', 'LUTH')
    state.pokegearCards.add(2)
    state.pokemonRuntime = {
      now: () => new Date(2026, 7, 24, 12),
      rng: createHgssLcrng(1),
    } as typeof state.pokemonRuntime
    const map = {
      id: 1,
      header: { mapId: 1, region: 0, radioSignal: true, dayMusicId: 1000, nightMusicId: 1001 },
    } as OpeningMapPreview
    const inventory = {
      radioProgramMessages: { 0: { 0: 'Musique Pokemon', 1: 'DJ', 2: 'Emission' } },
      resolvedMapCatalog: { maps: [] },
      wildEncounterCatalog: [],
      pokemonCatalog: { speciesNames: [] },
      uiMessageBanks: { 66: {} },
    } as unknown as RomInventory
    const audio = {
      playMusic: vi.fn(async () => { throw new Error('sequence illisible') }),
      playMapMusic: vi.fn(async () => 1000),
    } as unknown as RomAudioRuntime
    const menuElement = { querySelector: vi.fn(() => null) } as unknown as HTMLElement
    const unexpected = (): never => { throw new Error('Unexpected presentation dependency') }
    const coordinator = createPokegearUiCoordinator({
      getInventory: () => inventory,
      getFieldState: () => state,
      getMap: () => map,
      getPlayerPosition: () => undefined,
      getAudio: () => audio,
      menu: createMenuStub(),
      menuElement,
      renderMenu: vi.fn(),
      syncMenuCursor: vi.fn(),
      refreshInputPrompts: vi.fn(),
      persist: vi.fn(),
      confirmFly: vi.fn(),
      useFly: vi.fn(),
      applyMenuSelection: vi.fn(),
      createButton: unexpected,
      createPortrait: unexpected,
      createGraphic: unexpected,
      createPokemonIcon: () => undefined,
    } as unknown as PokegearUiCoordinatorDependencies)

    coordinator.selectCard(2)
    expect(coordinator.selectRadioSlot(0)).toBe(true)
    await Promise.resolve()
    await Promise.resolve()

    expect(state.radioMusicSequenceId).toBe(0)
    expect(audio.playMapMusic).toHaveBeenCalledExactlyOnceWith(map, new Date(2026, 7, 24, 12))
  })
})
