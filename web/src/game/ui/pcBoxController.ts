import type { GameDigitalAction } from '../../gameInput'
import type { PokemonCatalog } from '../../ndsTypes'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { hgssPartyCapacity, type PokemonParty } from '../pokemon/pokemonParty'
import { hgssStorageBoxCapacity, hgssStorageBoxCount, type PokemonStorage } from '../pokemon/pokemonStorage'
import { releasePokemonStorage, transferPokemonHeldItem, transferPokemonStorage, type PokemonStorageLocation } from '../pokemon/pokemonStorageTransfer'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { formatPokemonIvScore, pokemonTrainingStatKeys } from '../pokemon/pokemonTrainingValues'
import { createPokemonSummaryModel, createPokemonSummaryStatsPresentation } from './pokemonSummaryPresentation'

type PcBoxContext = { party: PokemonParty, storage: PokemonStorage, pokemonCatalog?: PokemonCatalog, typeNames?: readonly string[], boxNames?: readonly string[], playerName?: string, romMessages?: Record<number, string>, storageMessages?: Record<number, string>, partyMessages?: Record<number, string>, summaryMessages?: Record<number, string> }

type Options = {
  readContext: () => PcBoxContext
  teamPolicy?: PokemonTeamPolicy
  createPokemonIcon: (pokemon: CanonicalPokemon) => HTMLElement | undefined
  createHeldItemIcon: (itemId: number) => HTMLElement | undefined
  getItemName: (itemId: number) => string | undefined
  takeHeldItem: (pokemon: CanonicalPokemon) => boolean
  onCommit: (party: PokemonParty, storage: PokemonStorage) => void
  onCurrentBoxChange: (box: number) => void
  onRender: () => void
  onClose: () => void
}

export type PcBoxController = {
  isOpen: () => boolean
  open: (mode?: 0 | 1 | 2 | 3 | 4) => void
  close: () => void
  handle: (action: GameDigitalAction) => void
}

type PcBoxView = {
  title: HTMLElement
  partyLabel: HTMLElement
  partyCount: HTMLElement
  boxName: HTMLElement
  boxCount: HTMLElement
  previousBox: HTMLButtonElement
  nextBox: HTMLButtonElement
  partySlots: HTMLButtonElement[]
  boxSlots: HTMLButtonElement[]
  summaryLocation: HTMLElement
  summaryName: HTMLElement
  summaryStats: HTMLElement
  summaryTraits: HTMLElement
  notice: HTMLElement
  actionMenu: HTMLElement
  actionTitle: HTMLElement
  actionMessage: HTMLElement
  actionNav: HTMLElement
  closeLabel: HTMLElement
}

type PcBoxAction = 'move' | 'summary' | 'deposit' | 'withdraw' | 'move-item' | 'take-item' | 'release' | 'release-confirm' | 'cancel'
type PcBoxActionEntry = { action: PcBoxAction, label: string }

function pokemonName(pokemon: CanonicalPokemon): string {
  return pokemon.nickname ?? pokemon.speciesName
}

const pcModeMessageIds = [67, 68, 69, 70, 71] as const

export function resolvePcModeLabel(messages: Record<number, string> | undefined, mode: 0 | 1 | 2 | 3 | 4): string {
  return messages?.[pcModeMessageIds[mode]]?.replace(/\{[^}]*\}/g, '').replace(/[\r\n\f]+/g, ' ').trim() ?? ''
}

function pokemonGenderLabel(pokemon: CanonicalPokemon): string {
  return pokemon.gender === 'male' ? '♂' : pokemon.gender === 'female' ? '♀' : ''
}

export function resolvePcBoxName(boxNames: readonly string[] | undefined, boxIndex: number): string {
  return boxNames?.[boxIndex]?.trim() ?? ''
}

function createElement<K extends keyof HTMLElementTagNameMap>(tagName: K, className = ''): HTMLElementTagNameMap[K] {
  const element = document.createElement(tagName)
  element.className = className
  return element
}

function appendKeycap(button: HTMLButtonElement, action: 'confirm' | 'cancel' | 'page-previous' | 'page-next', fallback: string): void {
  const keycap = createElement('kbd')
  keycap.dataset.inputKey = action
  keycap.textContent = fallback
  button.append(keycap)
}

function sameLocation(first: PokemonStorageLocation | undefined, second: PokemonStorageLocation): boolean {
  return Boolean(first && first.kind === second.kind && first.slot === second.slot
    && (first.kind === 'party' || first.box === (second as Extract<PokemonStorageLocation, { kind: 'box' }>).box))
}

function setRomAccessibleName(button: HTMLButtonElement, value: string): void {
  if (value) button.setAttribute('aria-label', value)
  else button.removeAttribute('aria-label')
}

export function createPcBoxController(root: HTMLElement, options: Options): PcBoxController {
  const teamPolicy = options.teamPolicy ?? basePokemonTeamPolicy
  let region: 'party' | 'box' = 'box'
  let partyCursor = 0
  let boxCursor = 0
  let boxIndex = 0
  let source: PokemonStorageLocation | undefined
  let sourceAction: 'pokemon' | 'item' = 'pokemon'
  let actionLocation: PokemonStorageLocation | undefined
  let actionEntries: PcBoxActionEntry[] = []
  let actionCursor = 0
  let summaryOpen = false
  let notice = ''
  let view: PcBoxView | undefined
  let summaryTraitKey = ''
  const slotPresentationKeys = new WeakMap<HTMLButtonElement, string>()
  const storageText = (messageId: number): string => options.readContext().storageMessages?.[messageId] ?? ''

  const currentLocation = (): PokemonStorageLocation => region === 'party'
    ? { kind: 'party', slot: partyCursor }
    : { kind: 'box', box: boxIndex, slot: boxCursor }

  function createSlot(location: PokemonStorageLocation): HTMLButtonElement {
    const button = createElement('button', `pc-pokemon-slot pc-pokemon-slot-${location.kind}`)
    button.type = 'button'
    button.dataset.pcKind = location.kind
    button.dataset.pcSlot = String(location.slot)
    if (location.kind === 'box') button.dataset.pcBox = String(location.box)
    button.tabIndex = -1
    button.setAttribute('aria-current', 'false')
    button.setAttribute('aria-pressed', 'false')
    return button
  }

  function buildView(): PcBoxView {
    const header = createElement('header', 'pc-box-header')
    const titleGroup = createElement('div')
    const title = createElement('h2')
    titleGroup.append(title)
    header.append(titleGroup)

    const layout = createElement('div', 'pc-box-layout')
    const partyPanel = createElement('section', 'pc-party-panel')
    const partyHeader = createElement('header')
    const partyLabel = createElement('span')
    const partyCount = createElement('strong')
    const partyList = createElement('div', 'pc-party-list')
    partyHeader.append(partyLabel, partyCount)
    partyPanel.append(partyHeader, partyList)

    const storagePanel = createElement('section', 'pc-storage-panel')
    const storageHeader = createElement('header')
    const previousBox = createElement('button')
    previousBox.type = 'button'
    previousBox.dataset.pcPage = 'previous'
    appendKeycap(previousBox, 'page-previous', 'LB')
    const boxName = createElement('h3')
    const boxCount = createElement('small')
    const nextBox = createElement('button')
    nextBox.type = 'button'
    nextBox.dataset.pcPage = 'next'
    appendKeycap(nextBox, 'page-next', 'RB')
    storageHeader.append(previousBox, boxName, boxCount, nextBox)
    const boxGrid = createElement('div', 'pc-box-grid')
    boxGrid.setAttribute('role', 'grid')

    const summary = createElement('aside', 'pc-selection-summary')
    const summaryIdentity = createElement('div')
    const summaryLocation = createElement('small')
    const summaryName = createElement('strong')
    const summaryStats = createElement('span')
    summaryIdentity.append(summaryLocation, summaryName, summaryStats)
    const summaryTraits = createElement('div', 'pc-selection-traits')
    const boxNotice = createElement('p', 'pc-box-notice')
    boxNotice.setAttribute('role', 'status')
    summary.append(summaryIdentity, summaryTraits, boxNotice)
    storagePanel.append(storageHeader, boxGrid, summary)
    layout.append(partyPanel, storagePanel)

    const partySlots = Array.from({ length: hgssPartyCapacity }, (_, slot) => createSlot({ kind: 'party', slot }))
    const boxSlots = Array.from({ length: hgssStorageBoxCapacity }, (_, slot) => createSlot({ kind: 'box', box: boxIndex, slot }))
    partyList.append(...partySlots)
    boxGrid.append(...boxSlots)

    const footer = createElement('footer', 'pc-box-footer')
    const activate = createElement('button')
    activate.type = 'button'
    activate.dataset.pcActivate = ''
    appendKeycap(activate, 'confirm', 'A')
    const close = createElement('button')
    close.type = 'button'
    close.dataset.pcClose = ''
    const closeLabel = createElement('span', 'pc-box-close-label')
    close.append(closeLabel)
    appendKeycap(close, 'cancel', 'B')
    footer.append(activate, close)
    const actionMenu = createElement('section', 'pc-action-menu pokemon-summary-scope')
    actionMenu.hidden = true
    actionMenu.setAttribute('role', 'dialog')
    actionMenu.setAttribute('aria-modal', 'true')
    const actionTitle = createElement('h3')
    const actionMessage = createElement('p')
    const actionNav = createElement('nav')
    actionMenu.append(actionTitle, actionMessage, actionNav)
    root.replaceChildren(header, layout, footer, actionMenu)

    return {
      title,
      partyLabel,
      partyCount,
      boxName,
      boxCount,
      previousBox,
      nextBox,
      partySlots,
      boxSlots,
      summaryLocation,
      summaryName,
      summaryStats,
      summaryTraits,
      notice: boxNotice,
      actionMenu,
      actionTitle,
      actionMessage,
      actionNav,
      closeLabel,
    }
  }

  function slotPresentationKey(pokemon: CanonicalPokemon | undefined, kind: PokemonStorageLocation['kind'], emptyLabel: string, levelLabel: string, hpLabel: string, itemName: string): string {
    if (!pokemon) return `empty\u001f${emptyLabel}`
    return [
      kind,
      pokemon.personality,
      pokemon.speciesId,
      pokemon.form,
      pokemon.gender,
      pokemon.shiny,
      pokemon.isEgg,
      pokemonName(pokemon),
      pokemon.level,
      pokemon.currentHp,
      pokemon.stats.hp,
      ...pokemonTrainingStatKeys.map((stat) => pokemon.individualValues[stat]),
      pokemon.heldItemId,
      itemName,
      levelLabel,
      hpLabel,
    ].join('\u001f')
  }

  function syncSlot(button: HTMLButtonElement, pokemon: CanonicalPokemon | undefined, location: PokemonStorageLocation, context: PcBoxContext): void {
    const emptyLabel = context.storageMessages?.[92] ?? ''
    const levelLabel = context.partyMessages?.[23] ?? ''
    const hpLabel = context.partyMessages?.[28] ?? ''
    const itemName = pokemon?.heldItemId ? options.getItemName(pokemon.heldItemId) ?? '' : ''
    const ivScore = pokemon ? formatPokemonIvScore(pokemon.individualValues) : ''
    const presentationKey = slotPresentationKey(pokemon, location.kind, emptyLabel, levelLabel, hpLabel, itemName)
    button.dataset.pcKind = location.kind
    button.dataset.pcSlot = String(location.slot)
    if (location.kind === 'box') button.dataset.pcBox = String(location.box)
    button.dataset.occupied = String(Boolean(pokemon))
    const accessibleName = pokemon
      ? [pokemonName(pokemon), `${levelLabel}${pokemon.level}`, `IV ${ivScore}/10`, itemName].filter(Boolean).join(', ')
      : emptyLabel
    if (accessibleName) button.setAttribute('aria-label', accessibleName)
    else button.removeAttribute('aria-label')
    if (slotPresentationKeys.get(button) === presentationKey) return

    button.replaceChildren()
    delete button.dataset.shiny
    delete button.dataset.egg
    delete button.dataset.heldItem
    if (!pokemon) {
      button.append(createElement('span', 'pc-slot-empty'))
      slotPresentationKeys.set(button, presentationKey)
      return
    }

    const icon = options.createPokemonIcon(pokemon)
    if (icon) {
      icon.classList.add('pc-pokemon-icon')
      icon.setAttribute('aria-hidden', 'true')
      button.append(icon)
    } else {
      const fallbackName = createElement('span', 'pc-pokemon-icon-fallback')
      fallbackName.textContent = pokemonName(pokemon)
      button.append(fallbackName)
    }
    button.dataset.shiny = String(pokemon.shiny)
    button.dataset.egg = String(pokemon.isEgg)
    button.dataset.heldItem = String(pokemon.heldItemId !== 0)
    const potential = createElement('span', 'pc-pokemon-iv-score')
    potential.textContent = `${ivScore}/10`
    potential.setAttribute('aria-hidden', 'true')
    button.append(potential)
    if (pokemon.heldItemId) {
      const heldItem = options.createHeldItemIcon(pokemon.heldItemId)
      if (heldItem) {
        heldItem.classList.add('pc-held-item-icon')
        heldItem.setAttribute('aria-hidden', 'true')
        button.append(heldItem)
      }
    }
    if (location.kind === 'party') {
      const identity = createElement('span', 'pc-pokemon-identity')
      const name = createElement('strong')
      name.textContent = pokemonName(pokemon)
      const level = createElement('small')
      level.textContent = `${pokemonGenderLabel(pokemon)}  ${levelLabel}${pokemon.level}`.trim()
      identity.append(name, level)
      button.append(identity)
      const hp = createElement('progress')
      hp.max = Math.max(1, pokemon.stats.hp)
      hp.value = pokemon.currentHp
      hp.setAttribute('aria-label', `${hpLabel} ${pokemon.currentHp}/${pokemon.stats.hp}`.trim())
      button.append(hp)
    }
    slotPresentationKeys.set(button, presentationKey)
  }

  function syncSelection(context: PcBoxContext, moveFocus = true): void {
    if (!view) return
    const activePokemon = region === 'party' ? context.party.members[partyCursor] : context.storage.boxes[boxIndex]?.[boxCursor]
    let focusTarget: HTMLButtonElement | undefined
    for (const button of [...view.partySlots, ...view.boxSlots]) {
      const kind = button.dataset.pcKind as 'party' | 'box'
      const slot = Number(button.dataset.pcSlot)
      const location: PokemonStorageLocation = kind === 'party'
        ? { kind, slot }
        : { kind, box: Number(button.dataset.pcBox), slot }
      const selected = kind === region && slot === (kind === 'party' ? partyCursor : boxCursor)
      button.tabIndex = selected ? 0 : -1
      button.setAttribute('aria-current', String(selected))
      button.setAttribute('aria-pressed', String(sameLocation(source, location)))
      if (selected) focusTarget = button
    }

    view.summaryLocation.textContent = region === 'party'
      ? `${context.storageMessages?.[60] ?? ''} · ${partyCursor + 1}`
      : `${resolvePcBoxName(context.boxNames, boxIndex)} · ${boxCursor + 1}`
    view.summaryName.textContent = activePokemon ? pokemonName(activePokemon) : context.storageMessages?.[92] ?? ''
    view.summaryStats.textContent = activePokemon
      ? `${pokemonGenderLabel(activePokemon)}  ${context.partyMessages?.[23] ?? ''}${activePokemon.level}${region === 'party' ? `  ·  ${context.partyMessages?.[28] ?? ''} ${activePokemon.currentHp}/${activePokemon.stats.hp}` : ''}`.trim()
      : ''
    const itemName = activePokemon?.heldItemId ? options.getItemName(activePokemon.heldItemId) ?? '' : ''
    const nextSummaryTraitKey = activePokemon?.heldItemId ? `${activePokemon.personality}\u001f${activePokemon.heldItemId}\u001f${itemName}` : 'empty'
    if (summaryTraitKey !== nextSummaryTraitKey) {
      view.summaryTraits.replaceChildren()
      if (activePokemon?.heldItemId) {
        const trait = createElement('span')
        const icon = options.createHeldItemIcon(activePokemon.heldItemId)
        if (icon) {
          icon.classList.add('pc-trait-item-icon')
          icon.setAttribute('aria-hidden', 'true')
          trait.append(icon)
        }
        if (itemName) trait.append(itemName)
        view.summaryTraits.append(trait)
      }
      summaryTraitKey = nextSummaryTraitKey
    }
    view.notice.textContent = notice
    if (moveFocus) focusTarget?.focus({ preventScroll: true })
  }

  function syncView(moveFocus = true): void {
    const context = options.readContext()
    view ??= buildView()
    boxIndex = Math.max(0, Math.min(boxIndex, hgssStorageBoxCount - 1))
    partyCursor = Math.max(0, Math.min(partyCursor, hgssPartyCapacity - 1))
    boxCursor = Math.max(0, Math.min(boxCursor, hgssStorageBoxCapacity - 1))
    const currentBox = context.storage.boxes[boxIndex]!
    view.title.textContent = (context.romMessages?.[63] ?? '').replace(/\{103 0,0\}/g, context.playerName ?? '')
    if (view.title.textContent) root.setAttribute('aria-label', view.title.textContent)
    view.partyLabel.textContent = context.storageMessages?.[60] ?? ''
    view.partyCount.textContent = `${context.party.members.length} / ${hgssPartyCapacity}`
    view.boxName.textContent = resolvePcBoxName(context.boxNames, boxIndex)
    view.boxCount.textContent = `${currentBox.filter(Boolean).length} / ${hgssStorageBoxCapacity}`
    view.closeLabel.textContent = context.romMessages?.[75] ?? ''
    setRomAccessibleName(view.previousBox, resolvePcBoxName(context.boxNames, (boxIndex - 1 + hgssStorageBoxCount) % hgssStorageBoxCount))
    setRomAccessibleName(view.nextBox, resolvePcBoxName(context.boxNames, (boxIndex + 1) % hgssStorageBoxCount))
    view.partySlots.forEach((button, slot) => syncSlot(button, context.party.members[slot], { kind: 'party', slot }, context))
    view.boxSlots.forEach((button, slot) => syncSlot(button, currentBox[slot], { kind: 'box', box: boxIndex, slot }, context))
    syncSelection(context, moveFocus)
    options.onRender()
  }

  function setBox(next: number): void {
    boxIndex = (next + hgssStorageBoxCount) % hgssStorageBoxCount
    options.onCurrentBoxChange(boxIndex)
    if (source?.kind === 'box') source = undefined
    notice = resolvePcBoxName(options.readContext().boxNames, boxIndex)
    syncView()
  }

  function pokemonAt(context: PcBoxContext, location: PokemonStorageLocation): CanonicalPokemon | undefined {
    return location.kind === 'party' ? context.party.members[location.slot] : context.storage.boxes[location.box]?.[location.slot]
  }

  function closeActionMenu(moveFocus = true): void {
    if (!view) return
    view.actionMenu.hidden = true
    view.actionNav.replaceChildren()
    actionLocation = undefined
    actionEntries = []
    actionCursor = 0
    summaryOpen = false
    delete view.actionMenu.dataset.presentation
    delete view.actionNav.dataset.pcPanel
    if (moveFocus) syncSelection(options.readContext())
  }

  function syncActionCursor(): void {
    if (!view) return
    const buttons = [...view.actionNav.querySelectorAll<HTMLButtonElement>('button[data-pc-action]')]
    buttons.forEach((button, index) => {
      button.tabIndex = index === actionCursor ? 0 : -1
      button.setAttribute('aria-current', String(index === actionCursor))
    })
    buttons[actionCursor]?.focus({ preventScroll: true })
  }

  function showActionEntries(pokemon: CanonicalPokemon, title: string, message: string, entries: PcBoxActionEntry[], initialCursor = 0): void {
    if (!view) return
    summaryOpen = false
    actionEntries = entries.filter(({ label }) => Boolean(label))
    actionCursor = Math.max(0, Math.min(actionEntries.length - 1, initialCursor))
    view.actionTitle.textContent = title
    view.actionMessage.textContent = message
    view.actionMenu.dataset.presentation = 'actions'
    delete view.actionNav.dataset.pcPanel
    view.actionNav.replaceChildren(...actionEntries.map(({ action, label }) => {
      const button = createElement('button')
      button.type = 'button'
      button.dataset.pcAction = action
      button.textContent = label
      return button
    }))
    view.actionMenu.dataset.shiny = String(pokemon.shiny)
    view.actionMenu.hidden = false
    syncActionCursor()
  }

  function openActionMenu(location: PokemonStorageLocation, pokemon: CanonicalPokemon): void {
    actionLocation = location
    const entries: PcBoxActionEntry[] = [
      { action: 'move', label: storageText(61) },
      { action: 'summary', label: storageText(65) },
      { action: location.kind === 'party' ? 'deposit' : 'withdraw', label: storageText(location.kind === 'party' ? 70 : 69) },
      ...(pokemon.heldItemId ? [
        { action: 'move-item' as const, label: storageText(64) },
        { action: 'take-item' as const, label: storageText(80) },
      ] : []),
      { action: 'release', label: storageText(68) },
      { action: 'cancel', label: storageText(73) },
    ]
    showActionEntries(pokemon, pokemonName(pokemon), pokemon.heldItemId ? options.getItemName(pokemon.heldItemId) ?? '' : '', entries)
  }

  function showStatsSummary(pokemon: CanonicalPokemon): void {
    if (!view) return
    const context = options.readContext()
    if (!context.pokemonCatalog || !context.typeNames) return
    const heldItemName = pokemon.heldItemId ? options.getItemName(pokemon.heldItemId) : undefined
    const model = createPokemonSummaryModel(pokemon, context.pokemonCatalog, { typeNames: context.typeNames, heldItemName })
    summaryOpen = true
    actionEntries = []
    actionCursor = 0
    view.actionTitle.textContent = pokemonName(pokemon)
    view.actionMessage.textContent = [model.natureName, ...model.typeNames].join(' · ')
    view.actionMenu.dataset.presentation = 'summary'
    view.actionNav.dataset.pcPanel = 'summary'
    view.actionNav.replaceChildren(createPokemonSummaryStatsPresentation(model, context.summaryMessages ?? {}))
    view.actionMenu.hidden = false
  }

  function beginTransfer(action: Extract<PcBoxAction, 'move' | 'deposit' | 'withdraw' | 'move-item'>): void {
    if (!actionLocation) return
    const context = options.readContext()
    source = actionLocation
    sourceAction = action === 'move-item' ? 'item' : 'pokemon'
    closeActionMenu(false)
    if (action === 'deposit') region = 'box'
    else if (action === 'withdraw') { region = 'party'; partyCursor = Math.min(partyCursor, context.party.members.length) }
    notice = storageText(action === 'move-item' ? 64 : 61)
    syncSelection(context)
  }

  function confirmRelease(): void {
    if (!actionLocation) return
    const context = options.readContext()
    const result = releasePokemonStorage(context.party, context.storage, actionLocation, teamPolicy)
    if (result.kind === 'blocked') { notice = result.reason; closeActionMenu(false); syncSelection(context); return }
    options.onCommit(result.party, result.storage)
    if (actionLocation.kind === 'party') partyCursor = Math.max(0, Math.min(partyCursor, result.party.members.length - 1))
    notice = storageText(68)
    closeActionMenu(false)
    syncView()
  }

  function activateAction(): void {
    const entry = actionEntries[actionCursor]
    const location = actionLocation
    if (!entry || !location) return
    const context = options.readContext()
    const pokemon = pokemonAt(context, location)
    if (!pokemon) { closeActionMenu(); return }
    if (entry.action === 'cancel') { closeActionMenu(); return }
    if (entry.action === 'summary') { showStatsSummary(pokemon); return }
    if (entry.action === 'release-confirm') { confirmRelease(); return }
    if (entry.action === 'release') {
      showActionEntries(pokemon, storageText(68), pokemonName(pokemon), [
        { action: 'cancel', label: storageText(73) },
        { action: 'release-confirm', label: storageText(72) },
      ])
      return
    }
    if (entry.action === 'take-item') {
      notice = options.takeHeldItem(pokemon) ? storageText(80) : storageText(73)
      closeActionMenu(false)
      syncView()
      return
    }
    beginTransfer(entry.action)
  }

  function activate(): void {
    const context = options.readContext()
    const location = currentLocation()
    const pokemon = pokemonAt(context, location)
    if (!source) {
      if (!pokemon) { notice = storageText(92); syncSelection(context); return }
      openActionMenu(location, pokemon)
      return
    }
    if (sameLocation(source, location)) { source = undefined; notice = storageText(73); syncSelection(context); return }
    const result = sourceAction === 'item'
      ? transferPokemonHeldItem(context.party, context.storage, source, location)
      : transferPokemonStorage(context.party, context.storage, source, location, teamPolicy)
    if (result.kind === 'blocked') { notice = result.reason; syncSelection(context); return }
    options.onCommit(result.party, result.storage)
    source = undefined
    notice = storageText(sourceAction === 'item' ? 64 : 61)
    sourceAction = 'pokemon'
    syncView()
  }

  function cancelOrClose(): void {
    if (actionLocation) { closeActionMenu(); return }
    if (source) {
      source = undefined
      sourceAction = 'pokemon'
      notice = storageText(73)
      syncSelection(options.readContext())
    } else controller.close()
  }

  root.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>('button') : null
    if (!button) return
    if (button.dataset.pcAction) {
      const index = actionEntries.findIndex(({ action }) => action === button.dataset.pcAction)
      if (index >= 0) { actionCursor = index; activateAction() }
      return
    }
    if (button.dataset.pcClose !== undefined) { controller.close(); return }
    if (actionLocation) return
    if (button.dataset.pcActivate !== undefined) { activate(); return }
    if (button.dataset.pcPage) { setBox(boxIndex + (button.dataset.pcPage === 'previous' ? -1 : 1)); return }
    if (button.dataset.pcKind === 'party') { region = 'party'; partyCursor = Number(button.dataset.pcSlot); activate(); return }
    if (button.dataset.pcKind === 'box') { region = 'box'; boxCursor = Number(button.dataset.pcSlot); activate() }
  })

  const controller: PcBoxController = {
    isOpen: () => !root.hidden,
    open() {
      const context = options.readContext()
      boxIndex = context.storage.currentBox
      region = 'box'
      source = undefined
      sourceAction = 'pokemon'
      actionLocation = undefined
      notice = storageText(61)
      root.hidden = false
      syncView()
    },
    close() {
      if (root.hidden) return
      root.hidden = true
      source = undefined
      sourceAction = 'pokemon'
      closeActionMenu(false)
      options.onClose()
    },
    handle(action) {
      if (root.hidden) return
      if (actionLocation) {
        if (action === 'cancel' || action === 'menu') closeActionMenu()
        else if (summaryOpen) return
        else if (action === 'confirm') activateAction()
        else if (action === 'up' || action === 'left') { actionCursor = (actionCursor - 1 + actionEntries.length) % actionEntries.length; syncActionCursor() }
        else if (action === 'down' || action === 'right') { actionCursor = (actionCursor + 1) % actionEntries.length; syncActionCursor() }
        return
      }
      if (action === 'cancel' || action === 'menu') { cancelOrClose(); return }
      if (action === 'confirm') { activate(); return }
      if (action === 'page-previous' || action === 'page-next') { setBox(boxIndex + (action === 'page-previous' ? -1 : 1)); return }
      if (region === 'party') {
        if (action === 'right') region = 'box'
        else if (action === 'up' || action === 'down') partyCursor = (partyCursor + (action === 'up' ? -1 : 1) + hgssPartyCapacity) % hgssPartyCapacity
        else return
      } else {
        const column = boxCursor % 6
        if (action === 'left' && column === 0) region = 'party'
        else if (action === 'left' || action === 'right') boxCursor = (boxCursor + (action === 'left' ? -1 : 1) + hgssStorageBoxCapacity) % hgssStorageBoxCapacity
        else if (action === 'up' || action === 'down') boxCursor = (boxCursor + (action === 'up' ? -6 : 6) + hgssStorageBoxCapacity) % hgssStorageBoxCapacity
        else return
      }
      notice = ''
      syncSelection(options.readContext())
    },
  }
  return controller
}
