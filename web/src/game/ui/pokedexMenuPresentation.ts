import type { MainMenuState } from '../menu/mainMenuController'
import type { OpeningMapPreview, PokemonCatalog } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import type { HgssPokedexCatalog } from '../../rom/pokedex/pokedexData'
import {
  countHgssPokedexRegistrations,
  createHgssPokedexAreaEntries,
  createHgssPokedexEntry,
  createHgssPokedexList,
  createHgssPokedexRegistrationEntry,
  type HgssPokedexEntry,
  type HgssPokedexListEntry,
} from '../pokedex/pokedexMenuModel'
import type { HgssPokedexState } from '../pokedex/hgssPokedex'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { getRovingMenuTabIndex } from './menuPresentation'

export type PokedexGridDirection = 'left' | 'right' | 'up' | 'down' | 'page-previous' | 'page-next'

export type PokedexMenuPresentationOptions = {
  state: MainMenuState
  pokedex: HgssPokedexState
  pokemonCatalog: PokemonCatalog
  pokedexCatalog: HgssPokedexCatalog
  maps: readonly OpeningMapPreview[]
  encounterCatalog: readonly HgssWildEncounterData[]
  selectedSpeciesId?: number
  selectedForm?: number
  createGridIcon: (entry: HgssPokedexListEntry) => HTMLElement | undefined
  createPreview: (entry: HgssPokedexEntry, selectedForm?: number, shiny?: boolean) => HTMLElement
  onSelectForm?: (speciesId: number, form: number) => void
}

const speciesCommandPrefix = 'pokedex-species:'
const nativeFormMessageRanges: Readonly<Record<number, readonly [firstMessageId: number, formCount: number]>> = {
  351: [160, 4], // Morphéo
  386: [145, 4], // Deoxys
  412: [118, 3], // Cheniti
  413: [118, 3], // Cheniselle
  421: [164, 2], // Ceriflor
  422: [116, 2], // Sancoki
  423: [116, 2], // Tritosor
  479: [153, 6], // Motisma
  487: [151, 2], // Giratina
  492: [149, 2], // Shaymin
}

/** Reproduit l'indirection de messages de forme de l'overlay Pokédex HGSS. */
export function resolvePokedexFormLabel(
  speciesId: number,
  form: number,
  uiMessages: readonly string[],
  speciesName: string,
): string {
  if (speciesId === 201) {
    const unownLetter = form >= 0 && form < 26 ? uiMessages[69 + form] : undefined
    return unownLetter || uiMessages[121] || speciesName
  }
  const range = nativeFormMessageRanges[speciesId]
  const messageId = speciesId === 172
    ? form === 0 ? 114 : form === 1 ? 115 : form === 2 ? 166 : undefined
    : range && form >= 0 && form < range[1] ? range[0] + form : undefined
  const nativeLabel = messageId === undefined ? undefined : uiMessages[messageId]
  return nativeLabel || speciesName
}

export function movePokedexFormCursor(forms: readonly number[], current: number | undefined, direction: -1 | 1): number | undefined {
  if (forms.length === 0) return undefined
  const currentIndex = Math.max(0, forms.indexOf(current ?? Number.NaN))
  return forms[(currentIndex + direction + forms.length) % forms.length]
}

export function createPokedexFormControlModels(
  speciesId: number,
  forms: readonly number[],
  selectedForm: number | undefined,
  uiMessages: readonly string[],
  speciesName: string,
): Array<{ form: number, label: string, selected: boolean, tabIndex: 0 | -1, position: number, setSize: number }> {
  const current = forms.includes(selectedForm ?? Number.NaN) ? selectedForm : forms[0]
  return forms.map((form, index) => {
    const selected = form === current
    return { form, label: resolvePokedexFormLabel(speciesId, form, uiMessages, speciesName), selected, tabIndex: getRovingMenuTabIndex(selected), position: index + 1, setSize: forms.length }
  })
}

function speciesMenuIndexes(state: MainMenuState): number[] {
  return state.items.flatMap((item, index) => item.id.startsWith(speciesCommandPrefix) ? [index] : [])
}

export function getPokedexGridColumnCount(viewportWidth: number): number {
  if (viewportWidth <= 560) return 3
  if (viewportWidth <= 860) return 4
  return 5
}

/** Moves only through species cells; the controller's trailing back item is never focused by grid navigation. */
export function movePokedexGridCursor(
  state: MainMenuState,
  direction: PokedexGridDirection,
  columns: number,
  visibleRows = 3,
): number {
  const indexes = speciesMenuIndexes(state)
  if (indexes.length === 0) return state.cursor
  const currentPosition = Math.max(0, indexes.indexOf(state.cursor))
  const safeColumns = Math.max(1, Math.floor(columns))
  const step = direction === 'left' ? -1
    : direction === 'right' ? 1
      : direction === 'up' ? -safeColumns
        : direction === 'down' ? safeColumns
          : direction === 'page-previous' ? -safeColumns * Math.max(1, visibleRows)
            : safeColumns * Math.max(1, visibleRows)
  const nextPosition = (currentPosition + step % indexes.length + indexes.length) % indexes.length
  return indexes[nextPosition] ?? state.cursor
}

function createUnknownSprite(): HTMLElement {
  const unknown = document.createElement('span')
  unknown.className = 'pokedex-sprite pokedex-sprite-unknown'
  unknown.textContent = '?'
  unknown.setAttribute('aria-hidden', 'true')
  return unknown
}

function createCounter(label: string, value: number, tone: 'seen' | 'caught'): HTMLElement {
  const counter = document.createElement('span')
  counter.className = 'pokedex-counter'
  counter.dataset.registration = tone
  const copy = document.createElement('span')
  copy.textContent = label
  const number = document.createElement('strong')
  number.textContent = String(value)
  counter.append(copy, number)
  return counter
}

function createPokedexGridCell(
  entry: HgssPokedexListEntry,
  state: MainMenuState,
  order: number,
  createGridIcon: PokedexMenuPresentationOptions['createGridIcon'],
): HTMLButtonElement | undefined {
  const menuIndex = state.items.findIndex(({ id }) => id === `${speciesCommandPrefix}${entry.speciesId}`)
  if (menuIndex < 0) return undefined
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'pokedex-grid-cell'
  button.dataset.menuIndex = String(menuIndex)
  button.dataset.menuId = `${speciesCommandPrefix}${entry.speciesId}`
  button.dataset.registration = entry.caught ? 'caught' : entry.seen ? 'seen' : 'unknown'
  button.dataset.shiny = String(entry.shinyCaught === true)
  button.style.setProperty('--pokedex-order', String(order))
  button.setAttribute('role', 'gridcell')
  button.setAttribute('aria-current', String(menuIndex === state.cursor))
  button.setAttribute('aria-label', entry.seen ? `${entry.dexNumber} ${entry.speciesName}` : String(entry.dexNumber))
  button.tabIndex = getRovingMenuTabIndex(menuIndex === state.cursor)

  const number = document.createElement('span')
  number.className = 'pokedex-grid-number'
  number.textContent = String(entry.dexNumber).padStart(3, '0')
  const art = document.createElement('span')
  art.className = 'pokedex-grid-art'
  const icon = entry.seen ? createGridIcon(entry) : undefined
  art.append(icon ?? createUnknownSprite())
  const name = document.createElement('strong')
  name.className = 'pokedex-grid-name'
  name.textContent = entry.seen ? entry.speciesName : ''
  const registration = document.createElement('i')
  registration.className = 'pokedex-grid-registration'
  registration.setAttribute('aria-hidden', 'true')
  button.append(number, art, name, registration)
  return button
}

function createPokedexDetail(options: PokedexMenuPresentationOptions, registrationPokemon?: CanonicalPokemon): HTMLElement {
  const detail = document.createElement('section')
  detail.className = 'pokedex-detail'
  detail.dataset.pokedexDetail = 'true'
  const entries = createHgssPokedexList(options.pokedex, options.pokemonCatalog, options.pokedexCatalog)
  const selectedSpeciesId = registrationPokemon?.speciesId ?? (entries.some(({ speciesId }) => speciesId === options.selectedSpeciesId)
    ? options.selectedSpeciesId
    : entries[0]?.speciesId)
  if (selectedSpeciesId === undefined) {
    const empty = document.createElement('strong')
    empty.className = 'pokedex-detail-empty'
    empty.textContent = `${options.pokedexCatalog.uiMessages[23] ?? ''} ${options.pokedexCatalog.uiMessages[24] ?? ''}`.trim()
    detail.append(empty)
    return detail
  }
  const entry = registrationPokemon
    ? createHgssPokedexRegistrationEntry(registrationPokemon, options.pokemonCatalog, options.pokedexCatalog, options.pokedex.nationalDexEnabled)
    : createHgssPokedexEntry(options.pokedex, options.pokemonCatalog, options.pokedexCatalog, selectedSpeciesId)
  if (!entry) return detail
  detail.dataset.pokedexSpeciesId = String(entry.speciesId)

  const identity = document.createElement('div')
  identity.className = 'pokedex-detail-identity'
  identity.dataset.shiny = String(entry.shinyCaught === true)
  let preview = entry.seen ? options.createPreview(entry, options.selectedForm, entry.shinyCaught === true) : createUnknownSprite()
  preview.dataset.pokedexPreview = 'true'
  if (entry.seen && !entry.caught) preview.classList.add('pokedex-sprite-seen')
  identity.append(preview)
  const identityCopy = document.createElement('div')
  const heading = document.createElement('h3')
  const dexNumber = document.createElement('span')
  dexNumber.textContent = String(entry.dexNumber).padStart(3, '0')
  const name = document.createElement('strong')
  name.textContent = entry.seen ? entry.speciesName : options.pokedexCatalog.uiMessages[67] ?? ''
  heading.append(dexNumber, name)
  const category = document.createElement('small')
  category.className = 'pokedex-category'
  category.textContent = entry.categoryName ?? ''
  if (entry.categoryName) identityCopy.append(heading, category)
  else identityCopy.append(heading)
  const registration = document.createElement('p')
  registration.className = 'pokedex-registration'
  registration.dataset.registration = entry.caught ? 'caught' : entry.seen ? 'seen' : 'unknown'
  registration.textContent = options.pokedexCatalog.uiMessages[entry.caught ? 1 : entry.seen ? 0 : 67] ?? ''
  identityCopy.append(registration)
  if (entry.shinyCaught) {
    const shinyMark = document.createElement('i')
    shinyMark.className = 'pokedex-shiny-mark'
    shinyMark.setAttribute('aria-hidden', 'true')
    identityCopy.append(shinyMark)
  }

  if (entry.caught && entry.typeNames) {
    const types = document.createElement('div')
    types.className = 'pokedex-types'
    for (const typeName of new Set(entry.typeNames)) {
      const type = document.createElement('span')
      type.textContent = typeName
      types.append(type)
    }
    identityCopy.append(types)
  }
  if (entry.caught && (entry.heightLabel || entry.weightLabel)) {
    const measurements = document.createElement('div')
    measurements.className = 'pokedex-measurements'
    for (const [label, value] of [[options.pokedexCatalog.uiMessages[10], entry.heightLabel], [options.pokedexCatalog.uiMessages[11], entry.weightLabel]]) {
      if (!label || !value) continue
      const measurement = document.createElement('p')
      measurement.className = 'pokedex-measurement'
      measurement.append(label)
      const amount = document.createElement('strong')
      amount.textContent = value
      measurement.append(amount)
      measurements.append(measurement)
    }
    identityCopy.append(measurements)
  }
  if (entry.forms.length > 1) {
    const forms = document.createElement('div')
    forms.className = 'pokedex-form-pips'
    forms.setAttribute('role', 'radiogroup')
    forms.setAttribute('aria-label', options.pokedexCatalog.uiMessages[170] || entry.speciesName)
    const formControls = createPokedexFormControlModels(entry.speciesId, entry.forms, options.selectedForm, options.pokedexCatalog.uiMessages, entry.speciesName)
    let selectedForm = formControls.find(({ selected }) => selected)!.form
    let formButtons: HTMLButtonElement[] = []
    const syncFormButtons = (focus: boolean): void => {
      for (const button of formButtons) {
        const current = Number(button.dataset.pokedexForm) === selectedForm
        button.dataset.current = String(current)
        button.setAttribute('aria-checked', String(current))
        button.tabIndex = getRovingMenuTabIndex(current)
        if (focus && current) button.focus({ preventScroll: true })
      }
    }
    const selectForm = (form: number, focus: boolean): void => {
      if (!entry.forms.includes(form)) return
      if (form !== selectedForm) {
        const nextPreview = options.createPreview(entry, form, entry.shinyCaught === true)
        nextPreview.dataset.pokedexPreview = 'true'
        if (!entry.caught) nextPreview.classList.add('pokedex-sprite-seen')
        preview.replaceWith(nextPreview)
        preview = nextPreview
        selectedForm = form
        options.onSelectForm?.(entry.speciesId, form)
      }
      syncFormButtons(focus)
    }
    formButtons = formControls.map(({ form, label, position, setSize }) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.setAttribute('role', 'radio')
      button.dataset.pokedexForm = String(form)
      button.setAttribute('aria-label', label)
      button.setAttribute('aria-posinset', String(position))
      button.setAttribute('aria-setsize', String(setSize))
      const pip = document.createElement('i')
      pip.setAttribute('aria-hidden', 'true')
      const copy = document.createElement('span')
      copy.textContent = label
      button.append(pip, copy)
      button.addEventListener('click', () => selectForm(form, true))
      button.addEventListener('keydown', (event) => {
        const direction = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : undefined
        const targetForm = event.key === 'Home' ? entry.forms[0] : event.key === 'End' ? entry.forms.at(-1) : direction ? movePokedexFormCursor(entry.forms, selectedForm, direction) : undefined
        if (targetForm === undefined) return
        event.preventDefault()
        selectForm(targetForm, true)
      })
      return button
    })
    syncFormButtons(false)
    forms.replaceChildren(...formButtons)
    identityCopy.append(forms)
  }
  identity.append(identityCopy)
  detail.append(identity)

  if (entry.seen && !registrationPokemon) {
    const areas = createHgssPokedexAreaEntries(entry.speciesId, options.maps, options.encounterCatalog)
    const areaSection = document.createElement('section')
    areaSection.className = 'pokedex-detail-section pokedex-areas'
    const areaLabel = document.createElement('strong')
    areaLabel.className = 'pokedex-info-label'
    areaLabel.textContent = options.pokedexCatalog.uiMessages[142] ?? ''
    areaSection.append(areaLabel)
    if (areas.length === 0) {
      const unavailable = document.createElement('p')
      unavailable.className = 'pokedex-area-empty'
      unavailable.textContent = options.pokedexCatalog.uiMessages[128] ?? ''
      areaSection.append(unavailable)
    } else {
      const list = document.createElement('ul')
      list.className = 'pokedex-area-list'
      for (const area of areas.slice(0, 4)) {
        const row = document.createElement('li')
        row.textContent = area.label
        list.append(row)
      }
      areaSection.append(list)
    }
    detail.append(areaSection)
  }

  if (entry.caught && entry.description) {
    const info = document.createElement('section')
    info.className = 'pokedex-detail-section pokedex-info'
    const label = document.createElement('strong')
    label.className = 'pokedex-info-label'
    label.textContent = options.pokedexCatalog.uiMessages[8] ?? ''
    const description = document.createElement('p')
    description.className = 'pokedex-description'
    description.textContent = entry.description
    info.append(label, description)
    detail.append(info)
  }
  return detail
}

export function createPokedexMenuPresentation(options: PokedexMenuPresentationOptions): HTMLElement {
  const entries = createHgssPokedexList(options.pokedex, options.pokemonCatalog, options.pokedexCatalog)
  const counts = countHgssPokedexRegistrations(entries)
  const layout = document.createElement('div')
  layout.className = 'pokedex-menu-layout'
  const counters = document.createElement('div')
  counters.className = 'pokedex-counters'
  counters.append(
    createCounter(options.pokedexCatalog.uiMessages[0] ?? '', counts.seen, 'seen'),
    createCounter(options.pokedexCatalog.uiMessages[1] ?? '', counts.caught, 'caught'),
  )
  const body = document.createElement('div')
  body.className = 'pokedex-menu-body'
  const grid = document.createElement('div')
  grid.className = 'pokedex-grid'
  grid.setAttribute('role', 'grid')
  grid.setAttribute('aria-colcount', String(getPokedexGridColumnCount(window.innerWidth)))
  grid.setAttribute('aria-rowcount', String(Math.ceil(entries.length / getPokedexGridColumnCount(window.innerWidth))))
  const cells = entries.flatMap((entry, order) => {
    const cell = createPokedexGridCell(entry, options.state, order, options.createGridIcon)
    return cell ? [cell] : []
  })
  grid.replaceChildren(...cells)
  body.append(grid, createPokedexDetail(options))
  layout.append(counters, body)
  return layout
}

/** Écran compact alimenté uniquement par le Pokémon capturé et les tables ROM. */
export function createPokedexRegistrationPresentation(
  options: PokedexMenuPresentationOptions,
  pokemon: CanonicalPokemon,
): HTMLElement {
  const presentation = document.createElement('div')
  presentation.className = 'pokedex-capture-registration'
  presentation.append(createPokedexDetail({ ...options, selectedSpeciesId: pokemon.speciesId }, pokemon))
  return presentation
}

export function syncPokedexMenuSelectionPresentation(
  host: HTMLElement,
  options: PokedexMenuPresentationOptions,
): boolean {
  const current = host.querySelector<HTMLElement>('[data-pokedex-detail="true"]')
  if (!current) return false
  current.replaceWith(createPokedexDetail(options))
  return true
}
