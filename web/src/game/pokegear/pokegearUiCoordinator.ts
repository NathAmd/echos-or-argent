import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { startRomAudioPresentation } from '../../audio/romAudioPresentation'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import type { GameDigitalEvent } from '../../gameInput'
import type { NitroGraphic, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { getHgssRegisteredPokegearApps } from '../../rom/phone/phoneBook'
import { formatFieldMessage, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssUiThemes, resolveHgssUiTheme, resolveHgssUiThemeNames } from '../ui/hgssUiThemes'
import {
  createPokegearConfigureMenuItems,
  createPokegearContactMenuItems,
  createPokegearPhoneModel,
  createPokegearPresentation,
  POKEGEAR_MARKING_WORD_PAGE_SIZE,
  syncPokegearMapMarkingsPresentation,
  syncPokegearMapPresentation,
  syncPokegearConfigureSelection,
  syncPokegearPhonePresentation,
  type PokegearMapMarkingsUiState,
} from '../ui/pokegearPhonePresentation'
import { focusPokegearMapBoard } from '../ui/pokegearMapPresentation'
import { createPokegearRadioMenuItems, focusPokegearRadioSelection, syncPokegearRadioPresentation } from '../ui/pokegearRadioPresentation'
import { getMainMenuParentScreen, type MainMenuController, type MainMenuItem, type MainMenuState } from '../menu/mainMenuController'
import { getMapOrigin, usesWorldMatrixCoordinates } from '../world/mapCoordinates'
import {
  createHgssRadioBroadcast,
  createHgssRadioModel,
  hgssGbSoundsItemId,
  isHgssRadioTuningCoordinate,
  tuneHgssRadioProgram,
  type HgssRadioBroadcastContext,
  type HgssRadioProgram,
} from './hgssRadio'
import {
  createPokegearMapModel,
  getInitialPokegearMapCursor,
  getPokegearPointerSelectionCursor,
  movePokegearMapSelection,
  type PokegearFlypoint,
  type PokegearMapCursor,
  type PokegearMapModel,
} from './pokegearMapController'
import {
  getPokegearGridColumnCount,
  movePokegearGridCursor,
  movePokegearStationCursor,
} from './pokegearNavigation'
import { pokegearCardToNativeApp, pokegearNativeAppToCard, setPokegearMapMarking } from './pokegearNativeState'
import { resolveHgssMassOutbreakAnnouncement } from '../encounters/hgssMassOutbreak'

type FlyConfirmation = {
  title: string
  message: string
  yesLabel: string
  noLabel: string
  onConfirm: () => void
}

export type PokegearUiCoordinatorDependencies = {
  getInventory: () => RomInventory | undefined
  getFieldState: () => FieldScriptState
  getMap: () => OpeningMapPreview | undefined
  getPlayerPosition: () => { tileX: number, tileZ: number } | undefined
  getAudio: () => RomAudioRuntime | undefined
  menu: MainMenuController
  menuElement: HTMLElement
  renderMenu: (state: MainMenuState) => void
  syncMenuCursor: (state: MainMenuState) => void
  refreshInputPrompts: () => void
  persist: () => void
  confirmFly: (confirmation: FlyConfirmation) => void
  useFly: (destination: PokegearFlypoint) => void
  applyMenuSelection: (index: number) => void
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
  createPortrait: (trainerClass: number) => NitroGraphic
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  createPokemonIcon: (speciesId: number) => HTMLElement | undefined
}

export type PokegearUiCoordinator = {
  getMenuItems: () => readonly MainMenuItem[]
  getSelectedCard: () => number
  getSelectedContactId: () => number
  getMapMarkingsUi: () => PokegearMapMarkingsUiState
  reset: () => void
  deactivate: () => void
  selectCard: (card: number) => void
  selectContact: (contactId: number) => void
  selectRadioSlot: (slot: number) => boolean
  createPresentation: (state: MainMenuState) => HTMLElement
  syncAfterRender: () => void
  animate: (now: number) => void
  handleDatasetButton: (target: HTMLButtonElement) => boolean
  handlePointerDown: (event: PointerEvent) => boolean
  handlePointerMove: (event: PointerEvent) => boolean
  handlePointerUp: (event: PointerEvent) => boolean
  handleDigitalEvent: (event: GameDigitalEvent) => boolean
}

type ActiveRadioBroadcast = {
  programKey: string
  messages: readonly string[]
  messageIndex: number
  nextMessageAt: number
  lastEpisodeId: number
}

const markingNavigation = {
  left: [3, 0, 1, 2, 7, 4, 5, 6],
  right: [1, 2, 3, 0, 5, 6, 7, 4],
  up: [4, 5, 6, 7, 0, 1, 2, 3],
  down: [4, 5, 6, 7, 0, 1, 2, 3],
} as const

const radioFrameDurationMs = hgssVBlanksToMilliseconds(45 + 8)
const getPokegearViewportWidth = (): number => typeof window === 'undefined' ? 1024 : window.innerWidth

function createRadioFrames(messages: readonly string[]): string[] {
  return messages.flatMap((message) => {
    const lines = message.split('\n').filter((line) => line.length > 0)
    return lines.map((line, index) => index === 0 ? line : `${lines[index - 1]}\n${line}`)
  })
}

/**
 * Propriétaire unique de l'état transitoire et des entrées du Pokématos.
 * Les données persistantes restent celles de SavePokegear et les contenus
 * affichés proviennent exclusivement des catalogues décodés de la ROM.
 */
export function createPokegearUiCoordinator(dependencies: PokegearUiCoordinatorDependencies): PokegearUiCoordinator {
  const resolveAvailableCard = (card: number): number => {
    const available = new Set([...getHgssRegisteredPokegearApps(dependencies.getFieldState().pokegearCards), 3])
    return available.has(card) ? card : 3
  }
  let selectedCard = resolveAvailableCard(pokegearNativeAppToCard(dependencies.getFieldState().pokegear.lastUsedApp))
  let selectedContactId = 0
  let selectedTheme = dependencies.getFieldState().pokegear.skin
  let mapCursor: PokegearMapCursor | undefined
  let markingsUi: PokegearMapMarkingsUiState = { mode: 'map', slotCursor: 0, iconCursor: 0, categoryCursor: 0, wordCursor: 0 }
  let radioPointerId: number | undefined
  let activeRadioProgramKey: string | undefined
  let activeRadioBroadcast: ActiveRadioBroadcast | undefined
  let presentedMapModel: PokegearMapModel | undefined
  const heldPageActions = new Set<'page-previous' | 'page-next'>()

  const persistImmediately = (): void => {
    dependencies.persist()
  }

  /**
   * HGSS conserve une station correctement accordée hors du Pokématos, mais
   * rétablit la musique de la carte lorsqu'on quitte la Radio sans signal.
   * La décision repose sur l'état radio natif, pas sur l'onglet de destination.
   */
  const leaveRadio = (): void => {
    if (selectedCard !== 2) return
    radioPointerId = undefined
    const state = dependencies.getFieldState()
    if (state.radioMusicSequenceId !== 0) return
    const map = dependencies.getMap()
    const audio = dependencies.getAudio()
    if (!map || !audio) return
    const now = state.pokemonRuntime?.now() ?? new Date()
    void audio.playMapMusic(map, now).catch(() => undefined)
  }

  const deactivate = (): void => {
    heldPageActions.clear()
    leaveRadio()
  }

  const createPhoneModel = () => {
    const inventory = dependencies.getInventory()
    if (!inventory) return undefined
    return createPokegearPhoneModel(dependencies.getFieldState().phoneContacts, selectedContactId, {
      phoneContactNames: inventory.phoneContactNames,
      phoneBookEntries: inventory.phoneBookEntries,
      trainerClassNames: inventory.trainerClassNames,
      maps: inventory.resolvedMapCatalog.maps,
    })
  }

  const createRadioContext = (): HgssRadioBroadcastContext | undefined => {
    const map = dependencies.getMap()
    const inventory = dependencies.getInventory()
    if (!map || !inventory) return undefined
    const state = dependencies.getFieldState()
    return {
      map,
      flags: state.flags,
      variables: state.variables,
      now: state.pokemonRuntime?.now() ?? new Date(),
      nationalDexEnabled: state.pokedex.nationalDexEnabled,
      hasGbSounds: (state.inventory.get(hgssGbSoundsItemId) ?? 0) > 0,
      badges: state.badges,
      inventory: state.inventory,
      maps: inventory.resolvedMapCatalog.maps,
      wildEncounters: inventory.wildEncounterCatalog,
      speciesNames: inventory.pokemonCatalog.speciesNames,
      caughtSpeciesIds: state.pokedex.caughtSpeciesIds,
      buenasPasswordMessages: inventory.uiMessageBanks[66] ?? {},
      swarm: resolveHgssMassOutbreakAnnouncement(
        { active: state.roamers.massOutbreaksEnabled, randomValue: state.friendGroups[1]?.randomValue ?? 0 },
        inventory.resolvedMapCatalog.maps,
        inventory.wildEncounterCatalog,
      ),
    }
  }

  const createRadioModel = () => {
    const context = createRadioContext()
    const inventory = dependencies.getInventory()
    const state = dependencies.getFieldState()
    return context && inventory
      ? createHgssRadioModel(context, inventory.radioProgramMessages, { x: state.pokegear.radioCursorX, y: state.pokegear.radioCursorY })
      : undefined
  }

  const startRadioBroadcast = (program: HgssRadioProgram, programKey: string, lastEpisodeId = 0): void => {
    const context = createRadioContext()
    const inventory = dependencies.getInventory()
    const rng = dependencies.getFieldState().pokemonRuntime?.rng
    if (!context || !inventory || !rng) {
      activeRadioBroadcast = undefined
      return
    }
    const broadcast = createHgssRadioBroadcast(program, context, inventory.radioProgramMessages, () => rng.nextU16(), lastEpisodeId)
    activeRadioBroadcast = {
      programKey,
      messages: createRadioFrames(broadcast.messages),
      messageIndex: 0,
      nextMessageAt: performance.now() + radioFrameDurationMs,
      lastEpisodeId: broadcast.episodeId ?? lastEpisodeId,
    }
  }

  const syncRadio = (playAudio = true): void => {
    const model = createRadioModel()
    if (!model) return
    const state = dependencies.getFieldState()
    const programKey = model.selected ? `${model.selected.slot}:${model.selected.id}` : undefined
    if (playAudio && programKey !== activeRadioProgramKey) {
      activeRadioProgramKey = programKey
      if (!model.selected || !programKey) {
        activeRadioBroadcast = undefined
        state.radioMusicSequenceId = 0
        dependencies.getAudio()?.stopMusic()
      } else {
        startRadioBroadcast(model.selected, programKey)
        const rng = state.pokemonRuntime?.rng
        const sequenceId = rng ? tuneHgssRadioProgram(model.selected, rng) : undefined
        if (sequenceId !== undefined) {
          const audio = dependencies.getAudio()
          if (!audio) {
            state.radioMusicSequenceId = 0
          } else {
            state.radioMusicSequenceId = sequenceId
            startRomAudioPresentation(
              () => audio.playMusic(sequenceId),
              () => {
                const currentState = dependencies.getFieldState()
                if (activeRadioProgramKey !== programKey || currentState.radioMusicSequenceId !== sequenceId) return
                // Une station qui n'a jamais acquis le canal BGM ne doit pas
                // rester marquee active : sinon `leaveRadio` refuserait de
                // restaurer la carte et laisserait un silence persistant.
                currentState.radioMusicSequenceId = 0
                const currentMap = dependencies.getMap()
                const currentAudio = dependencies.getAudio()
                if (!currentMap || !currentAudio) return
                const now = currentState.pokemonRuntime?.now() ?? new Date()
                startRomAudioPresentation(() => currentAudio.playMapMusic(currentMap, now))
              },
            )
          }
        }
      }
    }
    const broadcast = activeRadioBroadcast
    if (model.selected && broadcast && broadcast.programKey === programKey) {
      model.selected.broadcast = broadcast.messages[broadcast.messageIndex] ?? ''
    }
    syncPokegearRadioPresentation(dependencies.menuElement, model)
  }

  const animate = (now: number): void => {
    const session = activeRadioBroadcast
    if (!session || dependencies.menuElement.hidden || dependencies.menu.getState().screen !== 'pokegear-radio' || selectedCard !== 2 || now < session.nextMessageAt) return
    const nextIndex = session.messageIndex + 1
    if (nextIndex >= session.messages.length) {
      const model = createRadioModel()
      if (!model?.selected || `${model.selected.slot}:${model.selected.id}` !== session.programKey) return
      startRadioBroadcast(model.selected, session.programKey, session.lastEpisodeId)
    } else {
      session.messageIndex = nextIndex
      session.nextMessageAt = now + radioFrameDurationMs
    }
    const current = activeRadioBroadcast
    const copy = dependencies.menuElement.querySelector<HTMLElement>('.pokegear-radio-copy')
    if (!current || !copy) return
    copy.textContent = current.messages[current.messageIndex] ?? ''
    copy.animate([{ opacity: 0, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }], { duration: 180, easing: 'ease-out' })
  }

  const createMapModel = (): PokegearMapModel | undefined => {
    const map = dependencies.getMap()
    const inventory = dependencies.getInventory()
    const state = dependencies.getFieldState()
    if (!map || !inventory) return undefined
    const nativeSkin = resolveHgssUiTheme(state.pokegear.skin).nativeSkin
    const player = dependencies.getPlayerPosition()
    const origin = usesWorldMatrixCoordinates(map) ? getMapOrigin(map) : undefined
    const playerMapPosition = player && origin
      ? { x: Math.floor((origin.x + player.tileX) / 32), y: Math.floor((origin.z + player.tileZ) / 32) + 2 }
      : undefined
    mapCursor ??= playerMapPosition ?? getInitialPokegearMapCursor(map, state.pokegearMapUnlockLevel)
    return createPokegearMapModel({
      mapData: inventory.pokegearMapData,
      maps: inventory.resolvedMapCatalog.maps,
      currentMap: map,
      flags: state.flags,
      badges: state.badges,
      party: state.party,
      background: inventory.uiAssets.pokegearMapBackgrounds[nativeSkin % inventory.uiAssets.pokegearMapBackgrounds.length]!,
      backgroundAtlas: inventory.uiAssets.pokegearMapAtlases[nativeSkin % inventory.uiAssets.pokegearMapAtlases.length],
      highlightAtlas: inventory.uiAssets.pokegearMapHighlightAtlases[nativeSkin % inventory.uiAssets.pokegearMapHighlightAtlases.length],
      mapUnlockLevel: state.pokegearMapUnlockLevel,
      mapMessages: inventory.uiMessageBanks[273]!,
      cursor: mapCursor,
      playerMapPosition,
      roamers: state.roamers.roamers,
      encounterLandmarks: inventory.mapEncounterLandmarks.landmarks,
      phoneBookEntries: inventory.phoneBookEntries,
      phoneRematchSeeking: state.phoneRematchSeeking,
      phoneGiftItems: state.phoneGiftItems,
      mapMarkings: state.pokegear.mapMarkings,
      visitedMapIds: state.pokegear.visitedMapIds,
      now: state.pokemonRuntime?.now() ?? new Date(),
      locationPreviewResolver: inventory.uiAssets.pokegearLocationPreviewResolver,
      areaBannerResolver: inventory.uiAssets.pokegearAreaBannerResolver,
    })
  }

  const syncMap = (): void => {
    const model = createMapModel()
    if (!model) return
    presentedMapModel = model
    mapCursor = model.cursor
    syncPokegearMapPresentation(dependencies.menuElement, model)
    dependencies.refreshInputPrompts()
  }

  const renderMarkings = (): void => {
    dependencies.renderMenu(dependencies.menu.refresh())
    dependencies.refreshInputPrompts()
    syncPokegearMapMarkingsPresentation(dependencies.menuElement, markingsUi)
  }

  const openMarkings = (): void => {
    if (!(presentedMapModel ?? createMapModel())?.location) return
    markingsUi = { ...markingsUi, mode: 'slots', slotCursor: 0 }
    renderMarkings()
  }

  const closeMarkings = (): void => {
    markingsUi = { ...markingsUi, mode: 'map' }
    dependencies.renderMenu(dependencies.menu.refresh())
  }

  const selectMarkingSlot = (slot: number): void => {
    if (!Number.isInteger(slot) || slot < 0 || slot >= 8) return
    markingsUi = { ...markingsUi, slotCursor: slot }
    const model = presentedMapModel ?? createMapModel()
    const value = slot % 2 === 0 ? model?.selectedMarkings?.icons[slot / 2] : model?.selectedMarkings?.words[Math.floor(slot / 2)]
    markingsUi.mode = value === null || value === undefined ? (slot % 2 === 0 ? 'icons' : 'words') : 'delete'
    renderMarkings()
  }

  const commitMarking = (value: number | null): void => {
    const model = presentedMapModel ?? createMapModel()
    const mapId = model?.location?.mapId
    if (mapId === undefined) return
    const state = dependencies.getFieldState()
    const slot = markingsUi.slotCursor
    state.pokegear.mapMarkings = setPokegearMapMarking(
      state.pokegear.mapMarkings,
      mapId,
      slot % 2 === 0 ? 'icon' : 'word',
      Math.floor(slot / 2),
      value,
    )
    persistImmediately()
    markingsUi = { ...markingsUi, mode: 'slots' }
    renderMarkings()
  }

  const moveMarking = (action: 'left' | 'right' | 'up' | 'down' | 'page-previous' | 'page-next'): void => {
    const inventory = dependencies.getInventory()
    if (markingsUi.mode === 'slots') {
      if (action === 'page-previous' || action === 'page-next') return
      markingsUi.slotCursor = markingNavigation[action][markingsUi.slotCursor] ?? markingsUi.slotCursor
    } else if (markingsUi.mode === 'icons') {
      const direction = action === 'page-previous' ? 'left' : action === 'page-next' ? 'right' : action
      markingsUi.iconCursor = movePokegearGridCursor(
        inventory?.uiAssets.pokegearMapMarkingIcons.length ?? 0,
        markingsUi.iconCursor,
        direction,
        getPokegearGridColumnCount('marking-icons', getPokegearViewportWidth()),
      ) ?? 0
    } else if (markingsUi.mode === 'words') {
      if (action === 'page-previous' || action === 'page-next') {
        const delta = action === 'page-previous' ? -1 : 1
        const count = inventory?.easyChatCatalog.categories.length ?? 0
        if (count > 0) {
          markingsUi.categoryCursor = (markingsUi.categoryCursor + delta + count) % count
          markingsUi.wordCursor = 0
          renderMarkings()
          return
        }
      } else {
        const words = inventory?.easyChatCatalog.categories[markingsUi.categoryCursor]?.words.filter(({ text }) => text.length > 0) ?? []
        if (words.length > 0) {
          const previousPage = Math.floor(markingsUi.wordCursor / POKEGEAR_MARKING_WORD_PAGE_SIZE)
          markingsUi.wordCursor = movePokegearGridCursor(
            words.length,
            markingsUi.wordCursor,
            action,
            getPokegearGridColumnCount('marking-words', getPokegearViewportWidth()),
          ) ?? 0
          if (previousPage !== Math.floor(markingsUi.wordCursor / POKEGEAR_MARKING_WORD_PAGE_SIZE)) {
            renderMarkings()
            return
          }
        }
      }
    }
    syncPokegearMapMarkingsPresentation(dependencies.menuElement, markingsUi)
  }

  const confirmMarking = (): void => {
    if (markingsUi.mode === 'slots') selectMarkingSlot(markingsUi.slotCursor)
    else if (markingsUi.mode === 'icons') commitMarking(markingsUi.iconCursor)
    else if (markingsUi.mode === 'delete') commitMarking(null)
    else if (markingsUi.mode === 'words') {
      const words = dependencies.getInventory()?.easyChatCatalog.categories[markingsUi.categoryCursor]?.words.filter(({ text }) => text.length > 0) ?? []
      const word = words[markingsUi.wordCursor]
      if (word) commitMarking(word.wordId)
    }
  }

  const cancelMarking = (): void => {
    if (markingsUi.mode === 'slots') closeMarkings()
    else {
      markingsUi = { ...markingsUi, mode: 'slots' }
      renderMarkings()
    }
  }

  const activateFlypoint = (): void => {
    const model = createMapModel()
    const inventory = dependencies.getInventory()
    const state = dependencies.getFieldState()
    if (!model?.flypoint || !model.canFly || !inventory) return
    const previousBuffers = state.buffers
    state.buffers = new Map([[0, model.flypoint.label], [1, model.flypoint.label]])
    const message = formatFieldMessage(inventory.uiMessageBanks[273]?.[5] ?? '', state)
    state.buffers = previousBuffers
    dependencies.confirmFly({
      title: model.flypoint.label,
      message,
      yesLabel: inventory.uiMessageBanks[271]?.[18] ?? '',
      noLabel: inventory.uiMessageBanks[271]?.[19] ?? '',
      onConfirm: () => dependencies.useFly(model.flypoint!),
    })
  }

  const updateSelectedCard = (card: number): boolean => {
    const nextCard = resolveAvailableCard(card)
    const changed = nextCard !== selectedCard
    if (!changed) return false
    leaveRadio()
    selectedCard = nextCard
    if (selectedCard === 3) selectedTheme = dependencies.getFieldState().pokegear.skin
    dependencies.getFieldState().pokegear.lastUsedApp = pokegearCardToNativeApp(selectedCard)
    markingsUi.mode = 'map'
    // Les applications gardent leur état pendant une même ouverture. Revenir
    // sur Carte ne doit notamment pas renvoyer Johto/Kanto sur le joueur.
    presentedMapModel = undefined
    persistImmediately()
    return true
  }

  const syncPhone = (): void => {
    const inventory = dependencies.getInventory()
    if (!inventory) return
    const model = createPhoneModel()
    if (!model) return
    selectedContactId = model.selected?.id ?? 0
    syncPokegearPhonePresentation(dependencies.menuElement, model, inventory.trainerBattleSpriteResolver, dependencies.createGraphic, inventory.uiMessageBanks[271]!)
    const selected = dependencies.menuElement.querySelector<HTMLButtonElement>(`[data-pokegear-contact="${selectedContactId}"]`)
    selected?.focus({ preventScroll: true })
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const syncConfigure = (): void => {
    const activeTheme = dependencies.getFieldState().pokegear.skin
    const selected = syncPokegearConfigureSelection(dependencies.menuElement, selectedTheme, activeTheme)
    selected?.focus({ preventScroll: true })
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }

  const moveContent = (direction: 'left' | 'right' | 'up' | 'down'): void => {
    if (selectedCard === 0) {
      const contacts = createPhoneModel()?.contacts ?? []
      if (contacts.length === 0) return
      const position = Math.max(0, contacts.findIndex(({ id }) => id === selectedContactId))
      const step = direction === 'left' || direction === 'up' ? -1 : 1
      selectedContactId = contacts[(position + step + contacts.length) % contacts.length]!.id
      syncPhone()
      return
    }
    if (selectedCard !== 3) return
    selectedTheme = movePokegearGridCursor(
      hgssUiThemes.length,
      selectedTheme,
      direction,
      getPokegearGridColumnCount('themes', getPokegearViewportWidth()),
    ) ?? 0
    syncConfigure()
  }

  const moveRadio = (direction: 'left' | 'right' | 'up' | 'down'): void => {
    const model = createRadioModel()
    if (!model) return
    const slot = movePokegearStationCursor(
      model.programs.map(({ slot: programSlot }) => programSlot),
      model.selected?.slot,
      direction === 'left' || direction === 'up' ? -1 : 1,
    )
    if (slot !== undefined && selectRadioSlot(slot, false)) {
      focusPokegearRadioSelection(dependencies.menuElement)
    }
  }

  const getMenuItems = (): readonly MainMenuItem[] => {
    const inventory = dependencies.getInventory()
    if (!inventory) return []
    if (selectedCard === 3) return createPokegearConfigureMenuItems(resolveHgssUiThemeNames(inventory.pokemonCatalog.speciesNames))
    if (selectedCard === 2) {
      const radio = createRadioModel()
      return radio ? createPokegearRadioMenuItems(radio) : []
    }
    if (selectedCard !== 0) return []
    const phone = createPhoneModel()
    if (!phone) return []
    selectedContactId = phone.selected?.id ?? 0
    return createPokegearContactMenuItems(phone)
  }

  const activateMenuItem = (id: string): boolean => {
    const state = dependencies.menu.refresh()
    const index = state.items.findIndex((item) => item.id === id)
    if (index < 0) return false
    dependencies.applyMenuSelection(index)
    return true
  }

  const reset = (): void => {
    selectedCard = resolveAvailableCard(pokegearNativeAppToCard(dependencies.getFieldState().pokegear.lastUsedApp))
    selectedTheme = dependencies.getFieldState().pokegear.skin
    mapCursor = undefined
    presentedMapModel = undefined
    markingsUi = { ...markingsUi, mode: 'map' }
    radioPointerId = undefined
    heldPageActions.clear()
  }

  const selectCard = (card: number): void => {
    updateSelectedCard(card)
  }

  const selectRadioSlot = (slot: number, persistSelection = true): boolean => {
    const station = createRadioModel()?.programs.find((candidate) => candidate.slot === slot)
    if (!station) return false
    const state = dependencies.getFieldState()
    state.pokegear.radioCursorX = station.tunerX
    state.pokegear.radioCursorY = station.tunerY
    syncRadio()
    if (persistSelection) persistImmediately()
    return true
  }

  const createPresentation = (state: MainMenuState): HTMLElement => {
    const inventory = dependencies.getInventory()
    if (!inventory) return document.createElement('div')
    const field = dependencies.getFieldState()
    const map = selectedCard === 1 ? createMapModel() : undefined
    presentedMapModel = map
    return createPokegearPresentation({
      state,
      selectedCard,
      phone: selectedCard === 0 ? createPhoneModel() : undefined,
      radio: selectedCard === 2 ? createRadioModel() : undefined,
      map,
      mapMarkingsUi: markingsUi,
      easyChatCatalog: inventory.easyChatCatalog,
      skin: field.pokegear.skin,
      selectedTheme,
      uiAssets: inventory.uiAssets,
      phoneMessages: inventory.uiMessageBanks[271]!,
      configureMessages: inventory.uiMessageBanks[270]!,
      createButton: dependencies.createButton,
      createPortrait: dependencies.createPortrait,
      createGraphic: dependencies.createGraphic,
      createPokemonIcon: dependencies.createPokemonIcon,
    })
  }

  const focusActiveCardFallback = (): void => {
    const focused = document.activeElement
    if (focused instanceof HTMLElement && focused.matches('button, [tabindex]') && dependencies.menuElement.contains(focused)) return
    dependencies.menuElement.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus({ preventScroll: true })
  }

  const syncActiveApp = (): void => {
    if (selectedCard === 1 && markingsUi.mode === 'map') {
      dependencies.refreshInputPrompts()
      focusPokegearMapBoard(dependencies.menuElement)
    }
    else if (selectedCard === 1) syncPokegearMapMarkingsPresentation(dependencies.menuElement, markingsUi)
    else if (selectedCard === 2) {
      syncRadio()
      focusPokegearRadioSelection(dependencies.menuElement)
    }
    else if (selectedCard === 0) syncPhone()
    else if (selectedCard === 3) syncConfigure()
    else dependencies.syncMenuCursor(dependencies.menu.getState())
    focusActiveCardFallback()
  }

  const syncAfterRender = (): void => {
    syncActiveApp()
  }

  const handleDatasetButton = (target: HTMLButtonElement): boolean => {
    if (target.dataset.pokegearContact !== undefined) {
      const contactId = Number.parseInt(target.dataset.pokegearContact, 10)
      if (Number.isInteger(contactId)) {
        selectedContactId = contactId
        syncPhone()
        activateMenuItem(`pokegear-contact:${contactId}`)
      }
    } else if (target.dataset.pokegearRadioSlot !== undefined) {
      const slot = Number.parseInt(target.dataset.pokegearRadioSlot, 10)
      if (Number.isInteger(slot) && selectRadioSlot(slot)) focusPokegearRadioSelection(dependencies.menuElement)
    } else if (target.dataset.pokegearTheme !== undefined) {
      const theme = Number.parseInt(target.dataset.pokegearTheme, 10)
      if (Number.isInteger(theme) && theme >= 0 && theme < hgssUiThemes.length) {
        selectedTheme = theme
        syncConfigure()
        activateMenuItem(`pokegear-skin:${theme}`)
      }
    } else if (target.dataset.pokegearMapMarkings !== undefined) openMarkings()
    else if (target.dataset.pokegearMarkingSlot !== undefined) selectMarkingSlot(Number(target.dataset.pokegearMarkingSlot))
    else if (target.dataset.pokegearMarkingIcon !== undefined) {
      markingsUi.iconCursor = Number(target.dataset.pokegearMarkingIcon)
      commitMarking(markingsUi.iconCursor)
    } else if (target.dataset.pokegearMarkingCategoryDelta !== undefined) {
      moveMarking(Number(target.dataset.pokegearMarkingCategoryDelta) < 0 ? 'page-previous' : 'page-next')
    } else if (target.dataset.pokegearMarkingWord !== undefined) {
      const wordId = Number(target.dataset.pokegearMarkingWord)
      if (Number.isInteger(wordId)) commitMarking(wordId)
    } else if (target.dataset.pokegearMarkingDelete !== undefined) commitMarking(null)
    else if (target.dataset.pokegearMapFly !== undefined) activateFlypoint()
    else if (target.dataset.pokegearMapCurrent !== undefined) {
      const model = presentedMapModel ?? createMapModel()
      if (model) {
        mapCursor = model.currentCursor
        syncMap()
        focusPokegearMapBoard(dependencies.menuElement)
      }
    }
    else return false
    return true
  }

  const handlePointerDown = (event: PointerEvent): boolean => {
    const source = event.target
    if (!(source instanceof Element)) return false
    const mapBoard = source.closest<HTMLElement>('[data-pokegear-map-board]')
    if (mapBoard && selectedCard === 1 && markingsUi.mode === 'map') {
      const model = presentedMapModel ?? createMapModel()
      const bounds = mapBoard.getBoundingClientRect()
      if (!model || bounds.width <= 0 || bounds.height <= 0) return true
      event.preventDefault()
      mapCursor = getPokegearPointerSelectionCursor(model, {
        x: Math.max(0, Math.min(47, (event.clientX - bounds.left) / bounds.width * 47)),
        y: Math.max(0, Math.min(20, (event.clientY - bounds.top) / bounds.height * 20)),
      })
      syncMap()
      focusPokegearMapBoard(dependencies.menuElement)
      return true
    }
    const dial = source.closest<HTMLElement>('.pokegear-radio-dial')
    if (dial && !source.closest('button')) {
      const bounds = dial.getBoundingClientRect()
      const x = Math.round(76 + (event.clientX - bounds.left) / bounds.width * 104)
      const y = Math.round(40 + (event.clientY - bounds.top) / bounds.height * 104)
      if (isHgssRadioTuningCoordinate(x, y)) {
        event.preventDefault()
        radioPointerId = event.pointerId
        dial.setPointerCapture(event.pointerId)
        const state = dependencies.getFieldState()
        state.pokegear.radioCursorX = x
        state.pokegear.radioCursorY = y
        syncRadio()
      }
      return true
    }
    return false
  }

  const handlePointerMove = (event: PointerEvent): boolean => {
    if (event.pointerId !== radioPointerId) return false
    const dial = dependencies.menuElement.querySelector<HTMLElement>('.pokegear-radio-dial')
    if (!dial) return true
    const bounds = dial.getBoundingClientRect()
    const x = Math.round(76 + (event.clientX - bounds.left) / bounds.width * 104)
    const y = Math.round(40 + (event.clientY - bounds.top) / bounds.height * 104)
    if (!isHgssRadioTuningCoordinate(x, y)) return true
    event.preventDefault()
    const state = dependencies.getFieldState()
    state.pokegear.radioCursorX = x
    state.pokegear.radioCursorY = y
    syncRadio()
    return true
  }

  const handlePointerUp = (event: PointerEvent): boolean => {
    if (event.pointerId !== radioPointerId) return false
    radioPointerId = undefined
    persistImmediately()
    return true
  }

  const handleDigitalEvent = (event: GameDigitalEvent): boolean => {
    if (event.action === 'page-previous' || event.action === 'page-next') {
      if (!event.pressed) {
        heldPageActions.delete(event.action)
        return false
      }
      if (heldPageActions.has(event.action)) return true
      heldPageActions.add(event.action)
    }
    if (!event.pressed) return false
    const state = dependencies.menu.getState()
    if (event.source === 'pointer' && event.action === 'confirm') {
      const pointedItem = state.items[state.cursor]
      if (pointedItem?.id === getMainMenuParentScreen(state.screen)) {
        if (selectedCard === 1 && markingsUi.mode !== 'map') {
          cancelMarking()
          return true
        }
        return false
      }
      if (pointedItem?.id.startsWith('pokegear-contact:')
        || pointedItem?.id.startsWith('pokegear-radio:')
        || pointedItem?.id.startsWith('pokegear-skin:')) {
        activateMenuItem(pointedItem.id)
        return true
      }
    }
    if (event.action === 'menu') {
      return false
    }
    if (selectedCard === 1 && markingsUi.mode !== 'map') {
      if (event.action === 'cancel') cancelMarking()
      else if (event.action === 'confirm') confirmMarking()
      else if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down' || event.action === 'page-previous' || event.action === 'page-next') moveMarking(event.action)
      return true
    }
    if (event.action === 'cancel') {
      return false
    }
    if (event.action === 'page-previous' || event.action === 'page-next') {
      return false
    }
    if (selectedCard === 0 || selectedCard === 3) {
      if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down') {
        moveContent(event.action)
        return true
      }
      if (event.action === 'confirm') {
        if (selectedCard === 0 && createPhoneModel()?.selected) activateMenuItem(`pokegear-contact:${selectedContactId}`)
        else if (selectedCard === 3) activateMenuItem(`pokegear-skin:${selectedTheme}`)
        return true
      }
    }
    if (selectedCard === 2) {
      if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down') {
        moveRadio(event.action)
        return true
      }
      if (event.action === 'confirm') {
        return true
      }
    }
    if (selectedCard === 1) {
      if (event.action === 'left' || event.action === 'right' || event.action === 'up' || event.action === 'down') {
        const model = presentedMapModel ?? createMapModel()
        if (model) {
          mapCursor = movePokegearMapSelection(model, event.action)
          syncMap()
          focusPokegearMapBoard(dependencies.menuElement)
        }
        return true
      }
      if (event.action === 'confirm') {
        activateFlypoint()
        return true
      }
      if (event.action === 'secondary') {
        openMarkings()
        return true
      }
    }
    return false
  }

  return {
    getMenuItems,
    getSelectedCard: () => selectedCard,
    getSelectedContactId: () => selectedContactId,
    getMapMarkingsUi: () => markingsUi,
    reset,
    deactivate,
    selectCard,
    selectContact: (contactId) => { selectedContactId = contactId },
    selectRadioSlot,
    createPresentation,
    syncAfterRender,
    animate,
    handleDatasetButton,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
    handleDigitalEvent,
  }
}
