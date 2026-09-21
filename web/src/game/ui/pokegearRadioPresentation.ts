import type { NitroCellSpritePreview, NitroGraphic } from '../../ndsTypes'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import type { HgssRadioModel, HgssRadioProgram } from '../pokegear/hgssRadio'
import { createNitroCellSprite } from './nitroCellSpritePresentation'

const nativeRadioWidth = 256
const nativeRadioHeight = 192
const nativeTunerLeft = 76
const nativeTunerTop = 40
const nativeTunerSize = 104
const radioMenuIdPrefix = 'pokegear-radio:'

export function createPokegearRadioMenuItems(model: HgssRadioModel): MainMenuItem[] {
  return model.programs.map(({ slot, title }) => ({ id: `${radioMenuIdPrefix}${slot}`, label: title, kind: 'command' }))
}

type PokegearRadioPresentationOptions = {
  state: MainMenuState
  model: HgssRadioModel
  background: NitroGraphic
  broadcastBackground: NitroGraphic
  objectSprites: NitroCellSpritePreview
  phoneMessages: Record<number, string>
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
  createGraphic: (graphic: NitroGraphic) => HTMLElement
}

function nativePercent(value: number, origin: number, size: number): string {
  return `${(value - origin) / size * 100}%`
}

function setText(element: HTMLElement | null | undefined, text: string): void {
  if (element && element.textContent !== text) element.textContent = text
}

function setHidden(element: HTMLElement | null | undefined, hidden: boolean): void {
  if (element && element.hidden !== hidden) element.hidden = hidden
}

function setTunerPosition(element: HTMLElement, model: HgssRadioModel): void {
  element.dataset.cursorX = String(model.cursorX)
  element.dataset.cursorY = String(model.cursorY)
  element.style.setProperty('--radio-cursor-x', nativePercent(model.cursorX, nativeTunerLeft, nativeTunerSize))
  element.style.setProperty('--radio-cursor-y', nativePercent(model.cursorY, nativeTunerTop, nativeTunerSize))
}

function createRadioScreen(options: PokegearRadioPresentationOptions): HTMLElement {
  const screen = document.createElement('div')
  screen.className = 'pokegear-radio-screen'
  screen.dataset.nativeWidth = String(nativeRadioWidth)
  screen.dataset.nativeHeight = String(nativeRadioHeight)
  screen.style.position = 'relative'
  screen.style.width = '100%'
  screen.style.aspectRatio = `${nativeRadioWidth} / ${nativeRadioHeight}`
  screen.style.overflow = 'hidden'

  const background = options.createGraphic(options.background)
  background.classList.add('pokegear-rom-texture', 'pokegear-radio-background')
  background.dataset.nativeWidth = String(nativeRadioWidth)
  background.dataset.nativeHeight = String(nativeRadioHeight)
  background.setAttribute('aria-hidden', 'true')
  background.style.position = 'absolute'
  background.style.inset = '0'
  background.style.zIndex = '0'
  background.style.width = '100%'
  background.style.height = '100%'
  background.style.opacity = '1'
  background.style.filter = 'none'
  background.style.mixBlendMode = 'normal'
  background.style.objectFit = 'contain'
  background.style.translate = 'none'

  const dial = document.createElement('div')
  dial.className = 'pokegear-radio-dial'
  dial.dataset.radioTuner = ''
  dial.dataset.nativeLeft = String(nativeTunerLeft)
  dial.dataset.nativeTop = String(nativeTunerTop)
  dial.dataset.nativeSize = String(nativeTunerSize)
  dial.dataset.tuned = options.model.selected ? String(options.model.selected.slot) : ''
  dial.style.position = 'absolute'
  dial.style.left = `${nativeTunerLeft / nativeRadioWidth * 100}%`
  dial.style.top = `${nativeTunerTop / nativeRadioHeight * 100}%`
  dial.style.width = `${nativeTunerSize / nativeRadioWidth * 100}%`
  dial.style.height = `${nativeTunerSize / nativeRadioHeight * 100}%`
  dial.style.zIndex = '1'
  dial.style.aspectRatio = '1'

  // resourceSet 0 / séquence 0 du header resdat 81. Les quatre autres
  // séquences correspondent aux sprites laissés masqués par l'overlay HGSS.
  const cursor = createNitroCellSprite(options.objectSprites, 0, options.createGraphic, 'pokegear-radio-native-cursor')
  cursor.dataset.pokegearRadioNativeCursor = ''
  cursor.style.position = 'absolute'
  cursor.style.left = 'var(--radio-cursor-x)'
  cursor.style.top = 'var(--radio-cursor-y)'
  setTunerPosition(cursor, options.model)

  dial.append(cursor)
  screen.append(background, dial)
  return screen
}

function createRadioStationList(options: PokegearRadioPresentationOptions): HTMLElement {
  const stationList = document.createElement('div')
  stationList.className = 'pokegear-radio-station-list'
  stationList.dataset.radioStations = ''
  stationList.setAttribute('role', 'radiogroup')
  stationList.setAttribute('aria-labelledby', 'game-menu-title')
  const stationItems = options.state.items
    .map((item, index) => ({ item, index }))
    .filter(({ item }) => item.id.startsWith(radioMenuIdPrefix))
  const firstSlot = options.model.programs[0]?.slot
  stationList.replaceChildren(...stationItems.flatMap(({ item, index }): HTMLButtonElement[] => {
    const slot = Number.parseInt(item.id.slice(radioMenuIdPrefix.length), 10)
    const program = options.model.programs.find((candidate) => candidate.slot === slot)
    if (!program) return []
    const tuned = program.slot === options.model.selected?.slot
    const button = options.createButton(item, index, false, false)
    button.removeAttribute('data-menu-index')
    button.dataset.pokegearRadioSlot = String(program.slot)
    button.classList.add('pokegear-radio-station')
    button.dataset.radioStation = ''
    button.dataset.slot = String(program.slot)
    button.dataset.program = String(program.id)
    button.dataset.nativeX = String(program.tunerX)
    button.dataset.nativeY = String(program.tunerY)
    button.dataset.tuned = String(tuned)
    button.setAttribute('role', 'radio')
    button.setAttribute('aria-checked', String(tuned))
    button.tabIndex = tuned || (options.model.selected === undefined && program.slot === firstSlot) ? 0 : -1
    return [button]
  }))
  return stationList
}

function createPokegearRadioBroadcast(options: PokegearRadioPresentationOptions): HTMLElement {
  const broadcast = document.createElement('section')
  broadcast.className = 'pokegear-radio-broadcast'
  broadcast.setAttribute('aria-live', 'polite')
  broadcast.setAttribute('aria-atomic', 'false')

  const background = options.createGraphic(options.broadcastBackground)
  background.classList.add('pokegear-rom-texture', 'pokegear-radio-broadcast-background')
  background.setAttribute('aria-hidden', 'true')

  const title = document.createElement('h3')
  title.className = 'pokegear-radio-title'
  const host = document.createElement('p')
  host.className = 'pokegear-radio-host'
  const copy = document.createElement('p')
  copy.className = 'pokegear-radio-copy'
  broadcast.append(background, title, host, copy)
  syncPokegearRadioBroadcast(broadcast, options.model.selected)
  return broadcast
}

function syncPokegearRadioBroadcast(broadcast: HTMLElement, selected: HgssRadioProgram | undefined): void {
  const title = broadcast.querySelector<HTMLElement>('.pokegear-radio-title')
  const host = broadcast.querySelector<HTMLElement>('.pokegear-radio-host')
  const copy = broadcast.querySelector<HTMLElement>('.pokegear-radio-copy')
  broadcast.dataset.program = selected ? `${selected.slot}:${selected.id}` : ''
  broadcast.dataset.empty = String(!selected)
  setText(title, selected?.title ?? '')
  setText(host, selected?.host ?? '')
  setText(copy, selected?.broadcast ?? '')
  setHidden(title, !selected?.title)
  setHidden(host, !selected?.host)
  setHidden(copy, !selected?.broadcast)
}

export function createPokegearRadioBody(options: PokegearRadioPresentationOptions): HTMLElement {
  const body = document.createElement('div')
  body.className = 'pokegear-radio-body'
  body.dataset.reception = options.model.selection
  body.dataset.signalStrength = String(options.model.signalStrength)
  body.dataset.noSignalMessage = options.phoneMessages[30] ?? ''

  const receiver = document.createElement('section')
  receiver.className = 'pokegear-radio-receiver'
  const reception = document.createElement('p')
  reception.className = 'pokegear-radio-reception'
  reception.dataset.radioReception = ''
  reception.setAttribute('role', 'status')
  reception.setAttribute('aria-live', 'polite')
  reception.textContent = options.model.selection === 'no-signal' ? body.dataset.noSignalMessage : ''
  receiver.append(reception, createRadioScreen(options))

  body.append(receiver, createRadioStationList(options), createPokegearRadioBroadcast(options))
  return body
}

export function syncPokegearRadioPresentation(root: HTMLElement, model: HgssRadioModel): void {
  const body = root.querySelector<HTMLElement>('.pokegear-radio-body')
  const dial = body?.querySelector<HTMLElement>('.pokegear-radio-dial')
  const cursor = dial?.querySelector<HTMLElement>('[data-pokegear-radio-native-cursor]')
  if (!body || !dial || !cursor) return

  body.dataset.reception = model.selection
  body.dataset.signalStrength = String(model.signalStrength)
  dial.dataset.tuned = model.selected ? String(model.selected.slot) : ''
  dial.dataset.cursorX = String(model.cursorX)
  dial.dataset.cursorY = String(model.cursorY)
  setTunerPosition(cursor, model)

  const firstSlot = model.programs[0]?.slot
  for (const button of body.querySelectorAll<HTMLButtonElement>('.pokegear-radio-station')) {
    const slot = Number.parseInt(button.dataset.slot ?? '', 10)
    const program = model.programs.find((candidate) => candidate.slot === slot)
    const tuned = slot === model.selected?.slot
    button.hidden = !program
    if (!program) continue
    button.dataset.program = String(program.id)
    button.dataset.nativeX = String(program.tunerX)
    button.dataset.nativeY = String(program.tunerY)
    button.dataset.tuned = String(tuned)
    button.setAttribute('aria-checked', String(tuned))
    button.tabIndex = tuned || (model.selected === undefined && slot === firstSlot) ? 0 : -1
    button.style.setProperty('--radio-x', nativePercent(program.tunerX, nativeTunerLeft, nativeTunerSize))
    button.style.setProperty('--radio-y', nativePercent(program.tunerY, nativeTunerTop, nativeTunerSize))
    button.style.setProperty('--radio-native-x', String(program.tunerX))
    button.style.setProperty('--radio-native-y', String(program.tunerY))
    setText(button.querySelector<HTMLElement>('.game-menu-button-label'), program.title)
  }

  const reception = body.querySelector<HTMLElement>('.pokegear-radio-reception')
  setText(reception, model.selection === 'no-signal' ? body.dataset.noSignalMessage ?? '' : '')
  const broadcast = body.querySelector<HTMLElement>('.pokegear-radio-broadcast')
  if (broadcast) syncPokegearRadioBroadcast(broadcast, model.selected)
}

/** Transfère le focus à la station réglée après une navigation digitale. */
export function focusPokegearRadioSelection(root: ParentNode): boolean {
  const tuned = root.querySelector<HTMLButtonElement>('.pokegear-radio-station[data-tuned="true"]')
  if (!tuned) return false
  tuned.focus({ preventScroll: true })
  tuned.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  return true
}
