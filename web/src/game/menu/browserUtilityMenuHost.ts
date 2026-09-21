import type { NitroGraphic, RomInventory } from '../../ndsTypes'
import type { HgssItemPocket } from '../../rom/items/itemData'
import type { CanvasAssetCache } from '../../rendering/canvas/canvasAssets'
import { applyHgssMultiplayerMenuAccess } from '../multiplayer/hgssMultiplayerMenuAccess'
import { createHgssPokedexCryRequest, createHgssPokedexEntry, createHgssPokedexList, type HgssPokedexEntry } from '../pokedex/pokedexMenuModel'
import type { PokegearUiCoordinator } from '../pokegear/pokegearUiCoordinator'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { formatPokemonStatus } from '../pokemon/pokemonStatus'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssGameOptions } from '../save/hgssGameOptions'
import { createBagMenuPresentation, isBagActionItem, syncBagMenuItemDetail, syncBagMenuPocketPresentation } from '../ui/bagMenuPresentation'
import type { GameFullscreenController } from '../ui/gameFullscreenController'
import type { InputPromptController } from '../ui/inputPromptController'
import { createGameMenuButton, createGameMenuHeader, createGameMenuNavigation, syncGameMenuButtonStatesPresentation, syncGameMenuCursorPresentation } from '../ui/menuPresentation'
import { createOptionsMenuPresentation } from '../ui/optionsMenuPresentation'
import { createPokedexMenuPresentation, syncPokedexMenuSelectionPresentation, type PokedexMenuPresentationOptions } from '../ui/pokedexMenuPresentation'
import type { PokemonUiAnimationRegistry } from '../ui/pokemonUiAnimation'
import { resolvePokemonUiPreview } from '../ui/pokemonUiPreview'
import type { PokemonUiSpritePresentation } from '../ui/pokemonUiSpritePresentation'
import { createPokemonSummaryModel, createPokemonSummaryPresentation, syncPokemonSummaryPagePresentation, type PokemonSummaryPage } from '../ui/pokemonSummaryPresentation'
import { resolveRomMenuItemState, resolveRomMenuLabel } from '../ui/romMenuLabels'
import { createTeamMenuPresentation, syncTeamMenuSelectionPresentation } from '../ui/teamMenuPresentation'
import { createBagMenuCommandHost, type BagMenuCommandHostPorts, type BagMenuMachineTeaching } from './bagMenuCommandHost'
import { type MainMenuController, getMainMenuParentScreen, getPokegearAppCard, isPokegearAppScreen, type MainMenuItem, type MainMenuResult, type MainMenuScreen, type MainMenuState } from './mainMenuController'
import { parseMainMenuCommand } from './mainMenuCommand'
import { createPokegearMenuCommandHost, type PokegearMenuCommandHostPorts } from './pokegearMenuCommandHost'
import { createTeamMenuCommandHost, type TeamMenuCommandHostPorts } from './teamMenuCommandHost'
import { resolveUtilityMenuRomAsset } from './utilityMenuRomAsset'
import { getUtilityPokegearAppLabels } from './utilityMenuScreenItemsHost'
import { getUtilityMenuSection, type UtilityMenuSection } from './utilityMenuSections'
import { createUtilityMenuSystemCommandHost, type UtilityMenuStatusTone, type UtilityMenuSystemCommandHostPorts } from './utilityMenuSystemCommandHost'

export type BrowserUtilityMenuNotice = Readonly<{
  screen: MainMenuScreen
  text: string
  tone: UtilityMenuStatusTone
}>

export type BrowserUtilityMenuSelectionState = {
  teamSlot: number
  teamSummaryOpen: boolean
  teamSummaryPage: PokemonSummaryPage
  pokedexSpeciesId?: number
  readonly pokedexForms: Map<number, number>
  bagItemId?: number
  bagPocket?: HgssItemPocket
  bagAction?: 'use' | 'give'
  pendingBagMachineTeaching?: BagMenuMachineTeaching
  bagActionPopupOpen: boolean
  notice?: BrowserUtilityMenuNotice
}

export function createBrowserUtilityMenuSelectionState(): BrowserUtilityMenuSelectionState {
  return {
    teamSlot: 0,
    teamSummaryOpen: false,
    teamSummaryPage: 'stats',
    pokedexForms: new Map(),
    bagActionPopupOpen: false,
  }
}

type SystemCommandOptions = Omit<
  UtilityMenuSystemCommandHostPorts,
  'fullscreen' | 'menu' | 'options' | 'setStatus'
> & Readonly<{
  fullscreen: UtilityMenuSystemCommandHostPorts['fullscreen'] & Pick<GameFullscreenController, 'focus'>
  options: Omit<UtilityMenuSystemCommandHostPorts['options'], 'syncPresentation'>
}>

type TeamCommandOptions = Omit<
  TeamMenuCommandHostPorts,
  'menu' | 'setStatus' | 'team'
> & Readonly<{
  team: Omit<TeamMenuCommandHostPorts['team'], 'clearNotice' | 'openSummary' | 'selectPartySlot'>
}>

type BagCommandOptions = Omit<
  BagMenuCommandHostPorts,
  'clearNotice' | 'menu' | 'selection' | 'setStatus'
>

export type BrowserUtilityMenuHostOptions = Readonly<{
  elements: Readonly<{
    root: HTMLElement
    trigger: HTMLButtonElement
    battleScreen: HTMLElement
    status: HTMLElement
  }>
  menu: MainMenuController
  selection: BrowserUtilityMenuSelectionState
  readInventory: () => RomInventory | undefined
  readFieldState: () => FieldScriptState
  readGameOptions: () => HgssGameOptions
  readVblank: () => number
  isGameplayChromeSuppressed: () => boolean
  canvasAssets: Pick<CanvasAssetCache, 'getGraphicCanvas'>
  pokemonAnimations: Pick<PokemonUiAnimationRegistry, 'register'>
  pokemonSprites: Pick<PokemonUiSpritePresentation, 'createPokedexPreview'>
  prompts: Pick<InputPromptController, 'refresh'>
  pokegear: Pick<
    PokegearUiCoordinator,
    | 'createPresentation'
    | 'deactivate'
    | 'reset'
    | 'selectContact'
    | 'selectRadioSlot'
    | 'syncAfterRender'
  >
  commands: Readonly<{
    system: SystemCommandOptions
    pokegear: Omit<PokegearMenuCommandHostPorts, 'menu' | 'setStatus'>
    team: TeamCommandOptions
    bag: BagCommandOptions
  }>
  routing: Readonly<{
    openMultiplayer: () => void
    clearMovementInput: () => void
    resetPhoneRing: () => void
    answerIncomingPhoneCall: () => boolean
    playPokedexCry: (speciesId: number) => void
  }>
}>

export type BrowserUtilityMenuHost = Readonly<{
  render: (state?: MainMenuState) => void
  applyResult: (result: MainMenuResult) => void
  setOpen: (open: boolean) => void
  createPokedexPresentationOptions: (state: MainMenuState) => PokedexMenuPresentationOptions | undefined
  createGraphicCanvas: (graphic: NitroGraphic) => HTMLCanvasElement
  createPokemonCanvas: (
    speciesId: number,
    form?: number,
    isEgg?: boolean,
    shiny?: boolean,
    gender?: CanonicalPokemon['gender'],
    preferredSource?: 'battle' | 'icon',
  ) => HTMLCanvasElement | undefined
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
  syncCursor: (state: MainMenuState) => void
  syncPokedex: (state: MainMenuState) => void
  cyclePokedexForm: (direction: -1 | 1, state: MainMenuState) => boolean
  syncTeam: (state: MainMenuState) => void
  syncTeamSummaryPage: () => void
  syncTeamSummaryPokemon: () => void
  syncBagPocket: (state: MainMenuState) => void
  syncBagItemDetail: () => void
  syncOptions: () => void
  bag: Readonly<{
    closeActionPopup: () => void
    clearPendingMachineTeaching: () => void
    reset: () => void
  }>
}>

export type DeferredBrowserUtilityMenuHost = BrowserUtilityMenuHost & Readonly<{
  install: (host: BrowserUtilityMenuHost) => void
  require: () => BrowserUtilityMenuHost
}>

/**
 * Stable façade used while the application composition resolves its cyclic UI
 * callbacks. Calls fail explicitly until the concrete host is installed.
 */
export function createDeferredBrowserUtilityMenuHost(): DeferredBrowserUtilityMenuHost {
  let current: BrowserUtilityMenuHost | undefined
  const requireCurrent = (): BrowserUtilityMenuHost => {
    if (!current) throw new Error("L'hôte du menu utilitaire n'est pas initialisé.")
    return current
  }
  return Object.freeze({
    install: (host: BrowserUtilityMenuHost) => { current = host },
    require: requireCurrent,
    render: (...args: Parameters<BrowserUtilityMenuHost['render']>) => requireCurrent().render(...args),
    applyResult: (...args: Parameters<BrowserUtilityMenuHost['applyResult']>) => requireCurrent().applyResult(...args),
    setOpen: (...args: Parameters<BrowserUtilityMenuHost['setOpen']>) => requireCurrent().setOpen(...args),
    createPokedexPresentationOptions: (...args: Parameters<BrowserUtilityMenuHost['createPokedexPresentationOptions']>) => requireCurrent().createPokedexPresentationOptions(...args),
    createGraphicCanvas: (...args: Parameters<BrowserUtilityMenuHost['createGraphicCanvas']>) => requireCurrent().createGraphicCanvas(...args),
    createPokemonCanvas: (...args: Parameters<BrowserUtilityMenuHost['createPokemonCanvas']>) => requireCurrent().createPokemonCanvas(...args),
    createButton: (...args: Parameters<BrowserUtilityMenuHost['createButton']>) => requireCurrent().createButton(...args),
    syncCursor: (...args: Parameters<BrowserUtilityMenuHost['syncCursor']>) => requireCurrent().syncCursor(...args),
    syncPokedex: (...args: Parameters<BrowserUtilityMenuHost['syncPokedex']>) => requireCurrent().syncPokedex(...args),
    cyclePokedexForm: (...args: Parameters<BrowserUtilityMenuHost['cyclePokedexForm']>) => requireCurrent().cyclePokedexForm(...args),
    syncTeam: (...args: Parameters<BrowserUtilityMenuHost['syncTeam']>) => requireCurrent().syncTeam(...args),
    syncTeamSummaryPage: () => requireCurrent().syncTeamSummaryPage(),
    syncTeamSummaryPokemon: () => requireCurrent().syncTeamSummaryPokemon(),
    syncBagPocket: (...args: Parameters<BrowserUtilityMenuHost['syncBagPocket']>) => requireCurrent().syncBagPocket(...args),
    syncBagItemDetail: () => requireCurrent().syncBagItemDetail(),
    syncOptions: () => requireCurrent().syncOptions(),
    bag: Object.freeze({
      closeActionPopup: () => requireCurrent().bag.closeActionPopup(),
      clearPendingMachineTeaching: () => requireCurrent().bag.clearPendingMachineTeaching(),
      reset: () => requireCurrent().bag.reset(),
    }),
  })
}

/**
 * Owns the browser presentation and command routing of the in-field utility
 * menu. The application root only supplies live state and effect ports.
 */
export function createBrowserUtilityMenuHost(
  options: BrowserUtilityMenuHostOptions,
): BrowserUtilityMenuHost {
  const { elements, menu, selection } = options

  const isPokegearMenuScreen = (screen: MainMenuScreen): boolean => (
    screen === 'pokegear' || isPokegearAppScreen(screen)
  )

  const createGraphicCanvas = (graphic: NitroGraphic): HTMLCanvasElement => {
    const canvas = document.createElement('canvas')
    canvas.width = graphic.width
    canvas.height = graphic.height
    canvas.getContext('2d')?.drawImage(options.canvasAssets.getGraphicCanvas(graphic), 0, 0)
    canvas.className = 'game-menu-rom-asset'
    canvas.setAttribute('aria-hidden', 'true')
    return canvas
  }

  const createPokemonCanvas = (
    speciesId: number,
    form = 0,
    isEgg = false,
    shiny = false,
    gender: CanonicalPokemon['gender'] = 'genderless',
    preferredSource: 'battle' | 'icon' = shiny ? 'battle' : 'icon',
  ): HTMLCanvasElement | undefined => {
    const inventory = options.readInventory()
    const preview = inventory
      ? resolvePokemonUiPreview(inventory, { speciesId, form, gender, shiny, isEgg }, preferredSource)
      : undefined
    const firstFrame = preview?.frames[0]
    if (!preview || !firstFrame) return undefined
    const canvas = createGraphicCanvas(firstFrame)
    canvas.dataset.shiny = String(shiny)
    canvas.dataset.romSource = preview.source
    options.pokemonAnimations.register(canvas, preview, options.readVblank())
    return canvas
  }

  const createPokedexPresentationOptions = (
    state: MainMenuState,
  ): PokedexMenuPresentationOptions | undefined => {
    const inventory = options.readInventory()
    if (!inventory) return undefined
    const fieldState = options.readFieldState()
    return {
      state,
      pokedex: fieldState.pokedex,
      pokemonCatalog: inventory.pokemonCatalog,
      pokedexCatalog: inventory.pokedexCatalog,
      maps: inventory.resolvedMapCatalog.maps,
      encounterCatalog: inventory.wildEncounterCatalog,
      selectedSpeciesId: selection.pokedexSpeciesId,
      selectedForm: selection.pokedexSpeciesId === undefined
        ? undefined
        : selection.pokedexForms.get(selection.pokedexSpeciesId),
      createGridIcon: (entry: ReturnType<typeof createHgssPokedexList>[number]) => {
        if (!entry.seen) return undefined
        const form = fieldState.pokedex.seenForms.get(entry.speciesId)?.[0] ?? 0
        const gender = fieldState.pokedex.seenGenders.get(entry.speciesId)?.[0] ?? 'genderless'
        const icon = createPokemonCanvas(entry.speciesId, form, false, entry.shinyCaught === true, gender)
        if (icon) icon.dataset.romAssetState = entry.caught ? 'caught' : 'seen'
        return icon
      },
      createPreview: (entry: HgssPokedexEntry, selectedForm?: number, shiny = false) => (
        options.pokemonSprites.createPokedexPreview({
          entry,
          inventory,
          selectedForm,
          shiny,
          startedAtVblank: options.readVblank(),
        })
      ),
      onSelectForm: (speciesId, form) => selection.pokedexForms.set(speciesId, form),
    }
  }

  const syncCursor = (state: MainMenuState): void => {
    syncGameMenuCursorPresentation(elements.root, state.cursor)
  }

  const syncPokedex = (state: MainMenuState): void => {
    const presentationOptions = createPokedexPresentationOptions(state)
    if (!presentationOptions || !syncPokedexMenuSelectionPresentation(elements.root, presentationOptions)) {
      render(state)
      return
    }
    syncCursor(state)
  }

  const cyclePokedexForm = (direction: -1 | 1, state: MainMenuState): boolean => {
    const inventory = options.readInventory()
    const speciesId = selection.pokedexSpeciesId
    if (!inventory || speciesId === undefined) return false
    const entry = createHgssPokedexEntry(
      options.readFieldState().pokedex,
      inventory.pokemonCatalog,
      inventory.pokedexCatalog,
      speciesId,
    )
    if (!entry || entry.forms.length < 2) return false
    const current = selection.pokedexForms.get(entry.speciesId) ?? entry.forms[0]
    const currentIndex = Math.max(0, entry.forms.indexOf(current))
    const nextForm = entry.forms[(currentIndex + direction + entry.forms.length) % entry.forms.length]!
    const formButton = elements.root.querySelector<HTMLButtonElement>(`button[data-pokedex-form="${nextForm}"]`)
    if (formButton) formButton.click()
    else {
      selection.pokedexForms.set(entry.speciesId, nextForm)
      syncPokedex(state)
    }
    return true
  }

  const getSelectedTeamSummaryContext = () => {
    const inventory = options.readInventory()
    const fieldState = options.readFieldState()
    const pokemon = fieldState.party.members[selection.teamSlot] ?? fieldState.party.members[0]
    if (!inventory || !pokemon) return undefined
    selection.teamSlot = fieldState.party.members.indexOf(pokemon)
    const heldItem = pokemon.heldItemId ? inventory.itemCatalog.items[pokemon.heldItemId] : undefined
    const metLocationName = inventory.resolvedMapCatalog.maps.find(
      ({ header }) => header.mapSection === pokemon.origin.metLocation,
    )?.label
    return {
      inventory,
      pokemon,
      heldItem,
      model: createPokemonSummaryModel(pokemon, inventory.pokemonCatalog, {
        typeNames: inventory.pokedexCatalog.typeNames,
        heldItemName: heldItem?.name,
        metLocationName,
      }),
    }
  }

  const createSelectedTeamSummaryPresentation = (): HTMLElement | undefined => {
    const context = getSelectedTeamSummaryContext()
    if (!context) return undefined
    const fieldState = options.readFieldState()
    const { inventory, pokemon, heldItem, model } = context
    return createPokemonSummaryPresentation({
      model,
      page: selection.teamSummaryPage,
      partySlot: selection.teamSlot,
      partySize: fieldState.party.members.length,
      createPokemonSprite: () => {
        const canvas = createPokemonCanvas(
          pokemon.speciesId,
          pokemon.form,
          pokemon.isEgg,
          pokemon.shiny,
          pokemon.gender,
          'battle',
        )
        if (!canvas) throw new Error(`Le sprite ROM du Pokémon ${pokemon.speciesId} est absent.`)
        return canvas
      },
      createHeldItemIcon: heldItem
        ? () => createGraphicCanvas(inventory.itemIconResolver(heldItem.itemId))
        : undefined,
      summaryMessages: inventory.uiMessageBanks[302],
      partyMessages: inventory.uiMessageBanks[6],
      onSelectPage: (page) => {
        selection.teamSummaryPage = page
        syncTeamSummaryPage()
      },
      onSelectPartySlot: (slot) => {
        selection.teamSlot = slot
        syncTeamSummaryPokemon()
      },
    })
  }

  const createMainMenuContent = (state: MainMenuState): HTMLElement | undefined => {
    if (state.screen === 'root') return undefined
    const content = document.createElement('div')
    content.className = 'game-menu-content'
    content.dataset.menuScreen = state.screen
    if (state.screen !== 'team') return undefined
    const fieldState = options.readFieldState()
    const pokemon = fieldState.party.members[selection.teamSlot] ?? fieldState.party.members[0]
    if (!pokemon) content.textContent = options.readInventory()?.uiMessageBanks[24]?.[92] ?? ''
    else if (selection.teamSummaryOpen && options.readInventory()) {
      selection.teamSlot = fieldState.party.members.indexOf(pokemon)
      const summary = createSelectedTeamSummaryPresentation()
      if (summary) content.append(summary)
    }
    return content
  }

  const syncTeamSummaryPage = (): void => {
    const context = getSelectedTeamSummaryContext()
    if (!context || !syncPokemonSummaryPagePresentation(elements.root, {
      model: context.model,
      page: selection.teamSummaryPage,
      summaryMessages: context.inventory.uiMessageBanks[302],
      partyMessages: context.inventory.uiMessageBanks[6],
    })) render()
  }

  const syncTeamSummaryPokemon = (): void => {
    const current = elements.root.querySelector<HTMLElement>('.pokemon-summary')
    const next = createSelectedTeamSummaryPresentation()
    if (!current || !next) {
      render(menu.refresh())
      return
    }
    current.replaceWith(next)
    options.prompts.refresh()
  }

  const setStatus = (
    text: string,
    tone: UtilityMenuStatusTone = 'info',
  ): void => {
    elements.status.textContent = text
    selection.notice = { screen: menu.getState().screen, text, tone }
  }

  const getItemState = (id: MainMenuItem['id']) => resolveRomMenuItemState(
    id,
    options.readGameOptions(),
    options.commands.system.fullscreen.isActive(),
    options.readInventory()?.uiMessageBanks,
  )

  const syncOptions = (): void => {
    syncGameMenuButtonStatesPresentation(
      elements.root,
      (id) => getItemState(id as MainMenuItem['id']),
    )
  }

  const createButton = (
    item: MainMenuItem,
    index: number,
    selected: boolean,
    withAsset = true,
  ): HTMLButtonElement => {
    const fieldState = options.readFieldState()
    const asset = withAsset ? resolveUtilityMenuRomAsset(item, {
      inventory: options.readInventory(),
      party: fieldState.party.members,
      bagInventory: fieldState.inventory,
      pokedex: fieldState.pokedex,
      selectedPokedexSpeciesId: selection.pokedexSpeciesId,
      selectedBagItemId: selection.bagItemId,
      createPokemonCanvas,
      createGraphicCanvas,
    }) : undefined
    return createGameMenuButton({
      id: item.id,
      index,
      label: resolveRomMenuLabel(item, options.readInventory()?.uiMessageBanks, fieldState.party.members),
      state: getItemState(item.id),
      selected,
      tone: item.id === 'new-game' ? 'danger' : undefined,
      asset,
    })
  }

  const createBagPresentationContext = () => {
    const inventory = options.readInventory()
    if (!inventory) return undefined
    const fieldState = options.readFieldState()
    return {
      inventory: fieldState.inventory,
      itemCatalog: inventory.itemCatalog,
      pokemonCatalog: inventory.pokemonCatalog,
      party: fieldState.party.members,
      bagMessages: inventory.uiMessageBanks[5],
      partyMessages: inventory.uiMessageBanks[6],
      storageMessages: inventory.uiMessageBanks[24],
      promptMessages: inventory.uiMessageBanks[25],
      summaryMessages: inventory.uiMessageBanks[302],
      teamMenuMessages: inventory.uiMessageBanks[300],
      battleMessages: inventory.battleMessages,
      uiMessages: inventory.uiMessageBanks[196],
      createButton,
      createItemIcon: (itemId: number) => createGraphicCanvas(inventory.itemIconResolver(itemId)),
    }
  }

  const syncBagPocket = (state: MainMenuState): void => {
    const context = createBagPresentationContext()
    if (!context) return
    syncBagMenuPocketPresentation(elements.root, {
      ...context,
      state,
      selectedPocket: selection.bagPocket,
      selectedItemId: selection.bagItemId,
      actionPopupOpen: false,
    })
  }

  const syncBagItemDetail = (): void => {
    const context = createBagPresentationContext()
    if (!context) return
    syncBagMenuItemDetail(elements.root, {
      ...context,
      selectedItemId: selection.bagItemId,
    })
  }

  const syncTeam = (state: MainMenuState): void => {
    const inventory = options.readInventory()
    const fieldState = options.readFieldState()
    const pokemon = fieldState.party.members[selection.teamSlot] ?? fieldState.party.members[0]
    if (!inventory || !pokemon) {
      render(state)
      return
    }
    selection.teamSlot = fieldState.party.members.indexOf(pokemon)
    const heldItemName = pokemon.heldItemId
      ? inventory.itemCatalog.items[pokemon.heldItemId]?.name
      : undefined
    const model = createPokemonSummaryModel(pokemon, inventory.pokemonCatalog, {
      typeNames: inventory.pokedexCatalog.typeNames,
      heldItemName,
    })
    const synced = syncTeamMenuSelectionPresentation(elements.root, {
      state,
      party: fieldState.party.members,
      selectedPartySlot: selection.teamSlot,
      selectedModel: model,
      statusLabel: formatPokemonStatus(pokemon.status),
      createButton,
      createPokemonIcon: () => createPokemonCanvas(
        pokemon.speciesId,
        pokemon.form,
        pokemon.isEgg,
        pokemon.shiny,
        pokemon.gender,
      )!,
      createHeldItemIcon: (itemId) => createGraphicCanvas(inventory.itemIconResolver(itemId)),
    })
    if (!synced) {
      render(state)
      return
    }
    syncCursor(state)
  }

  const render = (requestedState?: MainMenuState): void => {
    const state = requestedState ?? menu.getState()
    const inventory = options.readInventory()
    const fieldState = options.readFieldState()
    const menuHadFocus = elements.root.contains(document.activeElement)
    elements.root.classList.remove('game-menu-title')
    elements.root.classList.add('ui-menu')
    elements.root.dataset.screen = state.screen
    const burgerScreen = state.screen === 'root' || state.screen === 'pokegear'
    elements.root.dataset.presentation = burgerScreen ? 'root' : 'detail'
    elements.root.classList.toggle('game-menu-detail', state.open && !burgerScreen)
    elements.root.classList.toggle('ui-menu-root', state.open && burgerScreen)
    elements.root.classList.toggle('ui-menu-detail', state.open && !burgerScreen)
    elements.root.hidden = options.isGameplayChromeSuppressed() || !state.open
    elements.trigger.setAttribute('aria-expanded', String(!elements.root.hidden))
    if (elements.root.hidden) {
      elements.root.replaceChildren()
      if (menuHadFocus) {
        if (window.matchMedia('(pointer: coarse)').matches || window.innerWidth <= 760) {
          elements.trigger.focus({ preventScroll: true })
        } else {
          options.commands.system.fullscreen.focus(true)
        }
      }
      return
    }
    if (burgerScreen) {
      const buttons = state.items.map((item, index) => createButton(item, index, index === state.cursor, false))
      elements.root.replaceChildren(createGameMenuNavigation(buttons, 'root'))
      options.prompts.refresh()
      syncCursor(state)
      return
    }
    const appCard = getPokegearAppCard(state.screen)
    const title = state.screen === 'pokedex'
      ? inventory?.uiMessageBanks[196]?.[0] ?? ''
      : state.screen === 'team'
        ? inventory?.uiMessageBanks[196]?.[1] ?? ''
        : state.screen === 'bag'
          ? inventory?.uiMessageBanks[196]?.[2] ?? ''
          : appCard !== undefined
            ? getUtilityPokegearAppLabels(inventory)[appCard] ?? ''
            : inventory?.uiMessageBanks[45]?.[0] ?? ''
    const parentScreen = getMainMenuParentScreen(state.screen)
    const closeIndex = state.items.findIndex(({ id }) => id === parentScreen)
    const close = closeIndex >= 0 && parentScreen
      ? {
          index: closeIndex,
          selected: !isPokegearAppScreen(state.screen) && closeIndex === state.cursor,
          targetId: parentScreen,
          label: resolveRomMenuLabel(
            state.items[closeIndex]!,
            inventory?.uiMessageBanks,
            fieldState.party.members,
          ),
        }
      : undefined
    const header = createGameMenuHeader(title, close)
    if (state.screen === 'pokedex' && inventory) {
      const selectedIndex = state.items.findIndex(
        ({ id }) => id === `pokedex-species:${selection.pokedexSpeciesId}`,
      )
      const presentationState = selectedIndex >= 0 ? menu.focus(selectedIndex) : state
      const selectedItem = presentationState.items[presentationState.cursor]
      if (selectedItem?.id.startsWith('pokedex-species:')) {
        selection.pokedexSpeciesId = Number.parseInt(
          selectedItem.id.slice('pokedex-species:'.length),
          10,
        )
      }
      const presentationOptions = createPokedexPresentationOptions(presentationState)
      if (!presentationOptions) return
      elements.root.replaceChildren(header, createPokedexMenuPresentation(presentationOptions))
      options.prompts.refresh()
      syncCursor(presentationState)
      return
    }
    if (state.screen === 'bag' && inventory) {
      const selectedItemIndex = state.items.findIndex(({ id }) => id === `bag-item:${selection.bagItemId}`)
      const selectedItem = state.items[state.cursor] ?? { id: 'root', label: '', kind: 'screen' }
      const presentationState = !selection.bagActionPopupOpen
        && isBagActionItem(selectedItem)
        && selectedItemIndex >= 0
        ? menu.focus(selectedItemIndex)
        : state
      const layout = createBagMenuPresentation({
        state: presentationState,
        inventory: fieldState.inventory,
        itemCatalog: inventory.itemCatalog,
        pokemonCatalog: inventory.pokemonCatalog,
        party: fieldState.party.members,
        bagMessages: inventory.uiMessageBanks[5],
        partyMessages: inventory.uiMessageBanks[6],
        storageMessages: inventory.uiMessageBanks[24],
        promptMessages: inventory.uiMessageBanks[25],
        summaryMessages: inventory.uiMessageBanks[302],
        teamMenuMessages: inventory.uiMessageBanks[300],
        battleMessages: inventory.battleMessages,
        uiMessages: inventory.uiMessageBanks[196],
        selectedPocket: selection.bagPocket,
        selectedItemId: selection.bagItemId,
        actionPopupOpen: selection.bagActionPopupOpen,
        createButton,
        createItemIcon: (itemId) => createGraphicCanvas(inventory.itemIconResolver(itemId)),
      })
      if (selection.notice?.screen === 'bag') {
        const notice = document.createElement('p')
        notice.className = 'game-menu-notice bag-menu-notice'
        notice.dataset.tone = selection.notice.tone
        notice.setAttribute('role', 'status')
        notice.textContent = selection.notice.text
        layout.prepend(notice)
      }
      elements.root.replaceChildren(header, layout)
      options.prompts.refresh()
      syncCursor(presentationState)
      return
    }
    if (state.screen === 'team' && selection.teamSummaryOpen) {
      const content = createMainMenuContent(state)
      const layout = document.createElement('div')
      layout.className = 'game-menu-layout game-menu-layout-content-only pokemon-summary-layout'
      if (content) layout.append(content)
      elements.root.replaceChildren(
        createGameMenuHeader(
          inventory?.uiMessageBanks[24]?.[65] ?? '',
          close ? { ...close, selected: false } : undefined,
        ),
        layout,
      )
      options.prompts.refresh()
      return
    }
    if (state.screen === 'team' && inventory) {
      const pokemon = fieldState.party.members[selection.teamSlot] ?? fieldState.party.members[0]
      if (!pokemon) throw new Error('Le menu Équipe a été ouvert sans Pokémon disponible.')
      selection.teamSlot = fieldState.party.members.indexOf(pokemon)
      const heldItemName = pokemon.heldItemId
        ? inventory.itemCatalog.items[pokemon.heldItemId]?.name
        : undefined
      const model = createPokemonSummaryModel(pokemon, inventory.pokemonCatalog, {
        typeNames: inventory.pokedexCatalog.typeNames,
        heldItemName,
      })
      const layout = createTeamMenuPresentation({
        state,
        party: fieldState.party.members,
        selectedPartySlot: selection.teamSlot,
        selectedModel: model,
        statusLabel: formatPokemonStatus(pokemon.status),
        uiMessages: inventory.uiMessageBanks[24],
        createButton,
        createPokemonIcon: () => createPokemonCanvas(
          pokemon.speciesId,
          pokemon.form,
          pokemon.isEgg,
          pokemon.shiny,
          pokemon.gender,
        )!,
        createHeldItemIcon: (itemId) => createGraphicCanvas(inventory.itemIconResolver(itemId)),
      })
      elements.root.replaceChildren(header, layout)
      options.prompts.refresh()
      syncCursor(state)
      return
    }
    if (isPokegearAppScreen(state.screen) && inventory) {
      elements.root.replaceChildren(header, options.pokegear.createPresentation(state))
      options.prompts.refresh()
      options.pokegear.syncAfterRender()
      return
    }
    if (state.screen === 'options') {
      const notice = selection.notice?.screen === 'options' ? selection.notice : undefined
      elements.root.replaceChildren(
        header,
        createOptionsMenuPresentation({ state, notice, createButton }),
      )
      options.prompts.refresh()
      syncCursor(state)
      return
    }
    const content = createMainMenuContent(state)
    if (content && selection.notice?.screen === state.screen) {
      const notice = document.createElement('p')
      notice.className = 'game-menu-notice'
      notice.dataset.tone = selection.notice.tone
      notice.setAttribute('role', 'status')
      notice.textContent = selection.notice.text
      content.prepend(notice)
    }
    const groupedItems = new Map<UtilityMenuSection, Array<{ item: MainMenuItem, index: number }>>()
    state.items.forEach((item, index) => {
      if (item.id === 'root') return
      if (state.screen === 'team' && !item.id.startsWith('team-member:')) return
      if (state.screen === 'bag' && !item.id.startsWith('bag-pocket:') && !item.id.startsWith('bag-item:')) return
      const section = getUtilityMenuSection(state.screen, item)
      const entries = groupedItems.get(section) ?? []
      entries.push({ item, index })
      groupedItems.set(section, entries)
    })
    const list = document.createElement('div')
    list.className = 'game-menu-list'
    list.setAttribute('role', 'navigation')
    list.setAttribute('aria-labelledby', 'game-menu-title')
    for (const [section, entries] of groupedItems) {
      const group = document.createElement('section')
      group.className = 'game-menu-list-section'
      group.dataset.menuSection = section
      group.append(...entries.map(({ item, index }) => createButton(item, index, index === state.cursor)))
      list.append(group)
    }
    const layout = document.createElement('div')
    layout.className = 'game-menu-layout'
    if (!content || groupedItems.size === 0) layout.classList.add('game-menu-layout-content-only')
    layout.append(...(groupedItems.size > 0 ? [list] : []), ...(content ? [content] : []))
    elements.root.replaceChildren(header, layout)
    options.prompts.refresh()
    syncCursor(state)
  }

  const systemCommandHost = createUtilityMenuSystemCommandHost({
    ...options.commands.system,
    menu: { close: menu.close, refresh: menu.refresh, render },
    options: { ...options.commands.system.options, syncPresentation: syncOptions },
    setStatus,
  })

  const pokegearCommandHost = createPokegearMenuCommandHost({
    ...options.commands.pokegear,
    menu: {
      refresh: menu.refresh,
      render,
      setHidden: (hidden) => { elements.root.hidden = hidden },
    },
    setStatus,
  })

  const teamCommandHost = createTeamMenuCommandHost({
    ...options.commands.team,
    menu: {
      close: menu.close,
      refresh: menu.refresh,
      render,
      syncTeamSelection: syncTeam,
      setHidden: (hidden) => { elements.root.hidden = hidden },
    },
    team: {
      ...options.commands.team.team,
      clearNotice: () => { selection.notice = undefined },
      selectPartySlot: (partySlot) => { selection.teamSlot = partySlot },
      openSummary: (partySlot, page) => {
        selection.teamSlot = partySlot
        selection.teamSummaryPage = page
        selection.teamSummaryOpen = true
      },
    },
    setStatus,
  })

  const bagCommandHost = createBagMenuCommandHost({
    ...options.commands.bag,
    menu: {
      getState: menu.getState,
      close: menu.close,
      refresh: menu.refresh,
      focus: menu.focus,
      render,
      syncPocket: syncBagPocket,
      syncCursor,
    },
    selection: {
      read: () => ({
        pocket: selection.bagPocket,
        itemId: selection.bagItemId,
        action: selection.bagAction,
        pendingMachineTeaching: selection.pendingBagMachineTeaching,
        actionPopupOpen: selection.bagActionPopupOpen,
      }),
      update: (update) => {
        if ('pocket' in update) selection.bagPocket = update.pocket
        if ('itemId' in update) selection.bagItemId = update.itemId
        if ('action' in update) selection.bagAction = update.action
        if ('pendingMachineTeaching' in update) {
          selection.pendingBagMachineTeaching = update.pendingMachineTeaching
        }
        if ('actionPopupOpen' in update) {
          selection.bagActionPopupOpen = update.actionPopupOpen ?? false
        }
      },
    },
    clearNotice: () => { selection.notice = undefined },
    setStatus,
  })

  const applyResult = (result: MainMenuResult): void => {
    if (result.kind === 'ignored') return
    if (result.kind === 'state') {
      const previousScreen = elements.root.dataset.screen as MainMenuScreen | undefined
      const previousWasPokegear = previousScreen !== undefined && isPokegearMenuScreen(previousScreen)
      const nextIsPokegear = result.state.open && isPokegearMenuScreen(result.state.screen)
      if (previousWasPokegear && !nextIsPokegear) options.pokegear.deactivate()
      if (result.state.open && result.state.screen !== 'root' && !nextIsPokegear) {
        options.routing.resetPhoneRing()
      }
      if (!result.state.open || result.state.screen !== 'team') selection.teamSummaryOpen = false
      if (!result.state.open || result.state.screen !== 'bag') bagCommandHost.reset()
      if (result.state.open && result.state.screen === 'pokegear') {
        if (!previousWasPokegear) options.pokegear.reset()
        const focused = result.state.items[result.state.cursor]?.id
        if (focused?.startsWith('pokegear-contact:')) {
          options.pokegear.selectContact(Number.parseInt(focused.slice('pokegear-contact:'.length), 10))
        }
      }
      if (result.state.open
        && result.state.screen === 'pokegear-phone'
        && options.routing.answerIncomingPhoneCall()) return
      render(menu.refresh())
      return
    }
    if (applyHgssMultiplayerMenuAccess(result.command, {
      closeMenu: menu.close,
      renderMenu: render,
      openMultiplayer: options.routing.openMultiplayer,
    })) return
    if (systemCommandHost.handle(result)) return
    if (pokegearCommandHost.handle(result)) return
    if (teamCommandHost.handle(result)) return
    if (bagCommandHost.handle(result)) return
    const command = parseMainMenuCommand(result.command)
    if (command.kind !== 'pokedex-species') return
    selection.notice = undefined
    const { speciesId } = command
    if (speciesId !== selection.pokedexSpeciesId) {
      selection.pokedexSpeciesId = speciesId
      syncPokedex(menu.getState())
      return
    }
    const request = createHgssPokedexCryRequest(options.readFieldState().pokedex, speciesId)
    if (request && (request.form === 0 || request.speciesId === 172)) {
      options.routing.playPokedexCry(request.speciesId)
    }
  }

  const setOpen = (open: boolean): void => {
    if (open) options.routing.clearMovementInput()
    if (open) selection.notice = undefined
    if (!open) {
      if (isPokegearMenuScreen(menu.getState().screen)) options.pokegear.deactivate()
      bagCommandHost.reset()
    }
    render(open ? menu.open() : menu.close())
  }

  return Object.freeze({
    render,
    applyResult,
    setOpen,
    createPokedexPresentationOptions,
    createGraphicCanvas,
    createPokemonCanvas,
    createButton,
    syncCursor,
    syncPokedex,
    cyclePokedexForm,
    syncTeam,
    syncTeamSummaryPage,
    syncTeamSummaryPokemon,
    syncBagPocket,
    syncBagItemDetail,
    syncOptions,
    bag: Object.freeze({
      closeActionPopup: bagCommandHost.closeActionPopup,
      clearPendingMachineTeaching: bagCommandHost.clearPendingMachineTeaching,
      reset: bagCommandHost.reset,
    }),
  })
}
