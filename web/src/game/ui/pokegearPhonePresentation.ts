import type { NitroGraphic, OpeningMapPreview } from '../../ndsTypes'
import type { HgssEasyChatCatalog } from '../../rom/easyChat/easyChatData'
import type { HgssPhoneBookEntry } from '../../rom/phone/phoneBook'
import type { HgssUiAssets } from '../../rom/ui/hgssUiAssets'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import type { HgssRadioModel } from '../pokegear/hgssRadio'
import type { PokegearMapModel } from '../pokegear/pokegearMapController'
import { applyHgssUiThemePreview, hgssUiThemes, resolveHgssUiTheme } from './hgssUiThemes'
import { createPokegearMapBody, type PokegearMapMarkingsUiState } from './pokegearMapPresentation'
import { createPokegearRadioBody } from './pokegearRadioPresentation'

export {
  POKEGEAR_MARKING_WORD_COLUMNS,
  POKEGEAR_MARKING_WORD_PAGE_SIZE,
  syncPokegearMapMarkingsPresentation,
  syncPokegearMapPresentation,
} from './pokegearMapPresentation'
export type { PokegearMapMarkingsUiState } from './pokegearMapPresentation'

export type PokegearPhoneContactModel = {
  id: number
  name: string
  className?: string
  locationName?: string
  portraitTrainerClass?: number
}

export type PokegearPhoneModel = {
  contacts: PokegearPhoneContactModel[]
  selected?: PokegearPhoneContactModel
}

type PhoneCatalog = {
  phoneContactNames: readonly string[]
  phoneBookEntries: readonly HgssPhoneBookEntry[]
  trainerClassNames: readonly string[]
  maps: readonly OpeningMapPreview[]
}

export function createPokegearPhoneModel(
  contactIds: Iterable<number>,
  selectedContactId: number | undefined,
  catalog: PhoneCatalog,
): PokegearPhoneModel {
  const entries = new Map(catalog.phoneBookEntries.map((entry) => [entry.id, entry]))
  const maps = new Map(catalog.maps.map((map) => [map.id, map]))
  const contacts = [...contactIds].flatMap((id): PokegearPhoneContactModel[] => {
    const name = catalog.phoneContactNames[id]
    const entry = entries.get(id)
    if (!name || !entry) return []
    const className = catalog.trainerClassNames[entry.trainerClass]?.trim() || undefined
    return [{
      id,
      name,
      className,
      locationName: maps.get(entry.mapId)?.label,
      portraitTrainerClass: className ? entry.trainerClass : undefined,
    }]
  })
  const selected = contacts.find(({ id }) => id === selectedContactId) ?? contacts[0]
  return { contacts, selected }
}

export function createPokegearContactMenuItems(model: PokegearPhoneModel): MainMenuItem[] {
  return model.contacts.map(({ id, name }) => ({ id: `pokegear-contact:${id}`, label: name, kind: 'command' }))
}

export function createPokegearConfigureMenuItems(themeNames: readonly string[]): MainMenuItem[] {
  return themeNames.map((name, index) => ({ id: `pokegear-skin:${index}` as const, label: name, kind: 'command' as const }))
}

type PresentationOptions = {
  state: MainMenuState
  selectedCard: number
  phone?: PokegearPhoneModel
  radio?: HgssRadioModel
  map?: PokegearMapModel
  mapMarkingsUi: PokegearMapMarkingsUiState
  easyChatCatalog: HgssEasyChatCatalog
  skin: number
  selectedTheme: number
  uiAssets: HgssUiAssets
  phoneMessages: Record<number, string>
  configureMessages: Record<number, string>
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
  createPortrait: (trainerClass: number) => NitroGraphic
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  createPokemonIcon: (speciesId: number) => HTMLElement | undefined
}

function appendPhoneDetail(
  detail: HTMLElement,
  selected: PokegearPhoneContactModel | undefined,
  options: Pick<PresentationOptions, 'createPortrait' | 'createGraphic' | 'phoneMessages'>,
): void {
  let identity = detail.querySelector<HTMLElement>('[data-pokegear-contact-identity]')
  if (!identity) {
    identity = document.createElement('header')
    identity.dataset.pokegearContactIdentity = ''
    const portraitSlot = document.createElement('div')
    portraitSlot.className = 'pokegear-phone-portrait-slot'
    portraitSlot.dataset.pokegearContactPortrait = ''
    const copy = document.createElement('div')
    const name = document.createElement('h3')
    name.dataset.pokegearContactName = ''
    const className = document.createElement('p')
    className.dataset.pokegearContactClass = ''
    copy.append(name, className)
    identity.append(portraitSlot, copy)
    const facts = document.createElement('dl')
    facts.dataset.pokegearContactFacts = ''
    const term = document.createElement('dt')
    term.dataset.pokegearContactLocationTerm = ''
    const value = document.createElement('dd')
    value.dataset.pokegearContactLocation = ''
    facts.append(term, value)
    detail.append(identity, facts)
  }

  const portraitSlot = identity.querySelector<HTMLElement>('[data-pokegear-contact-portrait]')
  const name = identity.querySelector<HTMLElement>('[data-pokegear-contact-name]')
  const className = identity.querySelector<HTMLElement>('[data-pokegear-contact-class]')
  const facts = detail.querySelector<HTMLElement>('[data-pokegear-contact-facts]')
  const term = facts?.querySelector<HTMLElement>('[data-pokegear-contact-location-term]')
  const value = facts?.querySelector<HTMLElement>('[data-pokegear-contact-location]')
  identity.hidden = !selected
  if (name) name.textContent = selected?.name ?? ''
  if (className) {
    className.textContent = selected?.className ?? ''
    className.hidden = !selected?.className
  }
  if (facts) facts.hidden = !selected?.locationName
  if (term) term.textContent = selected?.locationName ? options.phoneMessages[5] ?? '' : ''
  if (value) value.textContent = selected?.locationName ?? ''

  if (portraitSlot) {
    const trainerClass = selected?.portraitTrainerClass
    const portraitKey = trainerClass === undefined ? '' : String(trainerClass)
    if (portraitSlot.dataset.trainerClass !== portraitKey) {
      portraitSlot.dataset.trainerClass = portraitKey
      portraitSlot.replaceChildren()
      if (trainerClass !== undefined) {
        const portrait = options.createGraphic(options.createPortrait(trainerClass))
        portrait.classList.add('pokegear-phone-portrait')
        portraitSlot.append(portrait)
      }
    }
    portraitSlot.hidden = trainerClass === undefined
  }
}

export function createPokegearPresentation(options: PresentationOptions): HTMLElement {
  const root = document.createElement('div')
  root.className = 'pokegear-menu-layout pokegear-app-page'
  root.dataset.skin = String(options.skin)
  const nativeSkin = resolveHgssUiTheme(options.skin).nativeSkin % options.uiAssets.pokegearPhoneBackgrounds.length
  const stage = document.createElement('section')
  stage.id = 'pokegear-app-stage'
  stage.className = 'pokegear-app-stage'
  stage.dataset.pokegearCard = String(options.selectedCard)
  stage.setAttribute('role', 'region')
  stage.setAttribute('aria-labelledby', 'game-menu-title')
  root.append(stage)

  if (options.selectedCard === 3) {
    const body = document.createElement('div')
    body.className = 'pokegear-configure-body'
    const background = options.createGraphic(options.uiAssets.pokegearConfigureBackgrounds[nativeSkin]!)
    background.classList.add('pokegear-rom-texture')
    background.setAttribute('aria-hidden', 'true')
    const heading = document.createElement('header')
    const title = document.createElement('h3')
    title.textContent = options.configureMessages[0] ?? ''
    heading.append(title)
    const choices = document.createElement('div')
    const skinItems = options.state.items.map((item, index) => ({ item, index })).filter(({ item }) => item.id.startsWith('pokegear-skin:'))
    choices.replaceChildren(...skinItems.map(({ item, index }) => {
      const skin = Number.parseInt(item.id.slice('pokegear-skin:'.length), 10)
      const button = options.createButton(item, index, skin === options.selectedTheme, false)
      button.removeAttribute('data-menu-index')
      button.dataset.pokegearTheme = String(skin)
      button.tabIndex = skin === options.selectedTheme ? 0 : -1
      const theme = hgssUiThemes[skin]
      button.dataset.active = String(skin === options.skin)
      applyHgssUiThemePreview(button, skin)
      const icon = theme ? options.createPokemonIcon(theme.speciesId) : undefined
      if (icon) {
        icon.classList.add('pokegear-theme-pokemon-icon')
        icon.setAttribute('aria-hidden', 'true')
        button.prepend(icon)
      }
      return button
    }))
    body.append(background, heading, choices)
    stage.append(body)
    return root
  }

  if (options.selectedCard === 2 && options.radio) {
    stage.append(createPokegearRadioBody({
      state: options.state,
      model: options.radio,
      background: options.uiAssets.pokegearRadioBackgrounds[nativeSkin]!,
      broadcastBackground: options.uiAssets.pokegearRadioBroadcastBackgrounds[nativeSkin]!,
      objectSprites: options.uiAssets.pokegearRadioObjectSprites,
      phoneMessages: options.phoneMessages,
      createButton: options.createButton,
      createGraphic: options.createGraphic,
    }))
    return root
  }

  if (options.selectedCard === 1 && options.map) {
    stage.append(createPokegearMapBody({
      model: options.map,
      markingsUi: options.mapMarkingsUi,
      easyChatCatalog: options.easyChatCatalog,
      markingsBackground: options.uiAssets.pokegearMapMarkingBackgrounds[nativeSkin]!,
      markingIcons: options.uiAssets.pokegearMapMarkingIcons,
      createGraphic: options.createGraphic,
      createPokemonIcon: options.createPokemonIcon,
    }))
    return root
  }

  if (options.selectedCard !== 0 || !options.phone) return root
  const body = document.createElement('div')
  body.className = 'pokegear-phone-body'
  const list = document.createElement('section')
  list.className = 'pokegear-phone-list'
  const background = options.createGraphic(options.uiAssets.pokegearPhoneBackgrounds[nativeSkin]!)
  background.classList.add('pokegear-rom-texture')
  background.setAttribute('aria-hidden', 'true')
  const heading = document.createElement('h3')
  heading.textContent = options.phoneMessages[20] ?? ''
  const entries = document.createElement('div')
  const contactItems = options.state.items.map((item, index) => ({ item, index })).filter(({ item }) => item.id.startsWith('pokegear-contact:'))
  entries.replaceChildren(...contactItems.map(({ item, index }) => {
    const contactId = Number.parseInt(item.id.slice('pokegear-contact:'.length), 10)
    const selected = contactId === options.phone?.selected?.id
    const button = options.createButton(item, index, selected)
    button.removeAttribute('data-menu-index')
    button.dataset.pokegearContact = String(contactId)
    button.tabIndex = selected ? 0 : -1
    return button
  }))
  list.append(background, heading, entries)
  const detail = document.createElement('section')
  detail.className = 'pokegear-phone-detail'
  appendPhoneDetail(detail, options.phone.selected, options)
  body.append(list, detail)
  stage.append(body)
  return root
}

export function syncPokegearPhonePresentation(
  root: HTMLElement,
  model: PokegearPhoneModel,
  createPortrait: (trainerClass: number) => NitroGraphic,
  createGraphic: (graphic: NitroGraphic) => HTMLElement,
  phoneMessages: Record<number, string>,
): void {
  const detail = root.querySelector<HTMLElement>('.pokegear-phone-detail')
  if (!detail) return
  appendPhoneDetail(detail, model.selected, { createPortrait, createGraphic, phoneMessages })
  root.querySelectorAll<HTMLButtonElement>('[data-menu-id^="pokegear-contact:"]').forEach((button) => {
    const active = button.dataset.menuId === `pokegear-contact:${model.selected?.id}`
    button.dataset.active = String(active)
    button.setAttribute('aria-current', String(active))
    button.tabIndex = active ? 0 : -1
  })
}

/** Synchronise la présélection sans confondre le thème survolé et le thème actif. */
export function syncPokegearConfigureSelection(
  root: ParentNode,
  selectedTheme: number,
  activeTheme: number,
): HTMLButtonElement | undefined {
  let selected: HTMLButtonElement | undefined
  for (const button of root.querySelectorAll<HTMLButtonElement>('[data-pokegear-theme]')) {
    const theme = Number.parseInt(button.dataset.pokegearTheme ?? '', 10)
    const current = theme === selectedTheme
    button.dataset.active = String(theme === activeTheme)
    button.setAttribute('aria-current', String(current))
    button.tabIndex = current ? 0 : -1
    if (current) selected = button
  }
  return selected
}
