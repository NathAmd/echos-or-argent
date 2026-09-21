import type { NitroGraphic } from '../../ndsTypes'
import type { HgssEasyChatCatalog } from '../../rom/easyChat/easyChatData'
import type { PokegearMapModel } from '../pokegear/pokegearMapController'

export type PokegearMapMarkingsUiState = {
  mode: 'map' | 'slots' | 'icons' | 'words' | 'delete'
  slotCursor: number
  iconCursor: number
  categoryCursor: number
  wordCursor: number
}

export const POKEGEAR_MARKING_WORD_COLUMNS = 3
export const POKEGEAR_MARKING_WORD_PAGE_SIZE = 12

export type PokegearMapPresentationOptions = {
  model: PokegearMapModel
  markingsUi: PokegearMapMarkingsUiState
  easyChatCatalog: HgssEasyChatCatalog
  markingsBackground: NitroGraphic
  markingIcons: readonly NitroGraphic[]
  createGraphic: (graphic: NitroGraphic) => HTMLElement
  createPokemonIcon: (speciesId: number) => HTMLElement | undefined
}

/**
 * Construit l'application Carte à partir des ressources et libellés décodés de
 * la ROM. La navigation reste la responsabilité du coordinateur Pokématos.
 */
export function createPokegearMapBody(options: PokegearMapPresentationOptions): HTMLElement {
  const { model, markingsUi, easyChatCatalog, markingsBackground, markingIcons, createGraphic, createPokemonIcon } = options
  const body = document.createElement('div')
  body.className = 'pokegear-map-body'
  body.dataset.markingsMode = markingsUi.mode

  if (markingsUi.mode !== 'map') {
    body.append(createPokegearMapMarkingsBody({
      model,
      state: markingsUi,
      easyChatCatalog,
      background: markingsBackground,
      markingIcons,
      createGraphic,
    }))
    return body
  }

  const board = document.createElement('section')
  board.className = 'pokegear-map-board'
  board.dataset.pokegearMapBoard = ''
  board.tabIndex = 0
  board.setAttribute('role', 'application')
  board.setAttribute('aria-label', model.prompt)
  const plane = document.createElement('div')
  plane.className = 'pokegear-map-plane'
  const background = createGraphic(model.background)
  background.classList.add('pokegear-map-rom')
  background.dataset.pokegearGraphicKey = model.backgroundKey
  plane.append(background)
  const highlight = document.createElement('canvas')
  highlight.className = 'pokegear-map-highlight'
  highlight.dataset.pokegearMapHighlight = ''
  highlight.setAttribute('aria-hidden', 'true')
  paintNitroGraphic(highlight, model.highlight, model.highlightKey)
  plane.append(highlight)

  for (const attention of model.phoneAttention) {
    const marker = document.createElement('span')
    marker.className = 'pokegear-map-phone-attention'
    marker.style.setProperty('--map-left', `${attention.x * 100 / 47}%`)
    marker.style.setProperty('--map-top', `${attention.y * 100 / 20}%`)
    marker.setAttribute('aria-label', attention.label)
    plane.append(marker)
  }

  for (const marking of model.markings) {
    const marker = document.createElement('span')
    marker.className = 'pokegear-map-has-markings'
    marker.style.setProperty('--map-left', `${marking.x * 100 / 47}%`)
    marker.style.setProperty('--map-top', `${marking.y * 100 / 20}%`)
    marker.setAttribute('aria-hidden', 'true')
    plane.append(marker)
  }

  for (const roamer of model.roamers) {
    const icon = createPokemonIcon(roamer.speciesId)
    if (!icon) continue
    const marker = document.createElement('span')
    marker.className = 'pokegear-map-roamer'
    marker.dataset.roamerId = String(roamer.roamerId)
    marker.style.setProperty('--map-left', `${roamer.x * 100 / 47}%`)
    marker.style.setProperty('--map-top', `${roamer.y * 100 / 20}%`)
    icon.setAttribute('aria-hidden', 'true')
    marker.append(icon)
    plane.append(marker)
  }

  for (const encounter of model.encounters) {
    const icon = createPokemonIcon(encounter.speciesId)
    if (!icon) continue
    const marker = document.createElement('span')
    marker.className = 'pokegear-map-encounter'
    marker.dataset.completed = String(encounter.completed)
    marker.style.setProperty('--map-left', `${encounter.x * 100 / 47}%`)
    marker.style.setProperty('--map-top', `${encounter.y * 100 / 20}%`)
    icon.setAttribute('aria-hidden', 'true')
    marker.append(icon)
    plane.append(marker)
  }

  const current = document.createElement('span')
  current.className = 'pokegear-current-pin'
  current.style.setProperty('--map-left', `${model.currentPosition.x * 100 / 47}%`)
  current.style.setProperty('--map-top', `${model.currentPosition.y * 100 / 20}%`)
  current.setAttribute('role', 'img')
  current.setAttribute('aria-label', model.currentLocationLabel)
  plane.append(current)

  const selection = document.createElement('span')
  selection.className = 'pokegear-selection-pin'
  selection.dataset.pokegearMapSelection = ''
  selection.style.setProperty('--map-left', `${model.cursor.x * 100 / 47}%`)
  selection.style.setProperty('--map-top', `${model.cursor.y * 100 / 20}%`)
  selection.setAttribute('aria-hidden', 'true')
  plane.append(selection)
  board.append(plane)

  const detail = document.createElement('section')
  detail.className = 'pokegear-map-detail'
  detail.dataset.presentationKey = model.presentationKey
  const preview = document.createElement('canvas')
  preview.className = 'pokegear-map-location-preview'
  preview.dataset.pokegearMapPreview = ''
  preview.setAttribute('aria-hidden', 'true')
  paintNitroGraphic(preview, model.locationPreview, `preview:${model.presentationKey}`)
  const banner = document.createElement('canvas')
  banner.className = 'pokegear-map-area-banner'
  banner.dataset.pokegearMapAreaBanner = ''
  banner.setAttribute('aria-hidden', 'true')
  paintNitroGraphic(banner, model.areaBanner, `banner:${model.presentationKey}`)
  const region = document.createElement('small')
  region.dataset.pokegearMapRegion = ''
  region.textContent = model.regionLabel
  const name = document.createElement('h3')
  name.dataset.pokegearMapName = ''
  name.setAttribute('aria-live', 'polite')
  name.setAttribute('aria-atomic', 'true')
  name.textContent = model.flypoint?.label ?? model.location?.label ?? ''
  const flavor = document.createElement('p')
  flavor.dataset.pokegearMapFlavor = ''
  flavor.textContent = model.location?.flavor ?? ''
  const copy = document.createElement('div')
  copy.className = 'pokegear-map-detail-copy'
  copy.append(banner, region, name, flavor)

  const actions = document.createElement('nav')
  actions.className = 'pokegear-map-actions'
  const fly = document.createElement('button')
  fly.type = 'button'
  fly.className = 'pokegear-map-fly'
  fly.dataset.pokegearMapFly = ''
  fly.hidden = !model.flypoint
  fly.disabled = !model.canFly
  const key = document.createElement('kbd')
  key.dataset.inputKey = 'confirm'
  key.textContent = 'A'
  const label = document.createElement('strong')
  label.textContent = model.flyLabel
  fly.append(key, label)
  actions.append(fly)

  const currentPosition = document.createElement('button')
  currentPosition.type = 'button'
  currentPosition.className = 'pokegear-map-current'
  currentPosition.dataset.pokegearMapCurrent = ''
  currentPosition.hidden = model.cursor.x === model.currentCursor.x && model.cursor.y === model.currentCursor.y
  currentPosition.setAttribute('aria-label', model.currentLocationLabel)
  const currentPositionLabel = document.createElement('strong')
  currentPositionLabel.dataset.pokegearMapCurrentLabel = ''
  currentPositionLabel.textContent = model.currentLocationLabel
  currentPosition.append(currentPositionLabel)
  actions.append(currentPosition)

  const markings = document.createElement('button')
  markings.type = 'button'
  markings.className = 'pokegear-map-markings-toggle'
  markings.dataset.pokegearMapMarkings = ''
  markings.hidden = !model.location
  const markingsIcon = markingIcons[0]
  if (markingsIcon) {
    const icon = createGraphic(markingsIcon)
    icon.classList.add('pokegear-map-markings-icon')
    icon.setAttribute('aria-hidden', 'true')
    markings.append(icon)
  }
  const markingsKey = document.createElement('kbd')
  markingsKey.dataset.inputKey = 'secondary'
  markingsKey.textContent = 'Y'
  markings.append(markingsKey)
  actions.append(markings)

  detail.append(preview, copy, actions)
  const workspace = document.createElement('div')
  workspace.className = 'pokegear-map-workspace'
  workspace.append(board)
  const sidebar = document.createElement('aside')
  sidebar.className = 'pokegear-map-sidebar'
  sidebar.append(detail)
  body.append(workspace, sidebar)
  return body
}

export type PokegearMapMarkingsPresentationOptions = {
  model: PokegearMapModel
  state: PokegearMapMarkingsUiState
  easyChatCatalog: HgssEasyChatCatalog
  background: NitroGraphic
  markingIcons: readonly NitroGraphic[]
  createGraphic: (graphic: NitroGraphic) => HTMLElement
}

export function createPokegearMapMarkingsBody(options: PokegearMapMarkingsPresentationOptions): HTMLElement {
  const { model, state, easyChatCatalog, background, markingIcons, createGraphic } = options
  const panel = document.createElement('section')
  panel.className = 'pokegear-map-markings-panel'
  const texture = createGraphic(background)
  texture.classList.add('pokegear-map-markings-rom')
  const header = document.createElement('header')
  const title = document.createElement('h3')
  title.textContent = model.location?.label ?? ''
  header.append(title)

  const slots = document.createElement('div')
  slots.className = 'pokegear-map-marking-slots'
  const selected = model.selectedMarkings
  for (let slot = 0; slot < 4; slot += 1) {
    const iconButton = document.createElement('button')
    iconButton.type = 'button'
    iconButton.dataset.pokegearMarkingSlot = String(slot * 2)
    iconButton.setAttribute('aria-current', String(state.mode !== 'words' && state.slotCursor === slot * 2))
    const icon = selected?.icons[slot]
    if (icon !== null && icon !== undefined && markingIcons[icon]) iconButton.append(createGraphic(markingIcons[icon]!))
    const wordButton = document.createElement('button')
    wordButton.type = 'button'
    wordButton.dataset.pokegearMarkingSlot = String(slot * 2 + 1)
    wordButton.setAttribute('aria-current', String(state.mode !== 'icons' && state.slotCursor === slot * 2 + 1))
    const wordId = selected?.words[slot]
    const word = wordId !== null && wordId !== undefined ? easyChatCatalog.words.find((candidate) => candidate.wordId === wordId) : undefined
    wordButton.textContent = word?.text ?? ''
    slots.append(iconButton, wordButton)
  }

  const picker = document.createElement('div')
  picker.className = 'pokegear-map-marking-picker'
  if (state.mode === 'icons') {
    picker.dataset.kind = 'icons'
    picker.replaceChildren(...markingIcons.map((graphic, icon) => {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.pokegearMarkingIcon = String(icon)
      button.setAttribute('aria-current', String(icon === state.iconCursor))
      button.append(createGraphic(graphic))
      return button
    }))
  } else if (state.mode === 'words') {
    picker.dataset.kind = 'words'
    const category = easyChatCatalog.categories[state.categoryCursor] ?? easyChatCatalog.categories[0]
    const categories = document.createElement('nav')
    for (const [delta, keyName, glyph] of [[-1, 'page-previous', '‹'], [1, 'page-next', '›']] as const) {
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.pokegearMarkingCategoryDelta = String(delta)
      const categoryKey = document.createElement('kbd')
      categoryKey.dataset.inputKey = keyName
      categoryKey.textContent = glyph
      button.append(categoryKey)
      categories.append(button)
    }
    const words = document.createElement('div')
    const available = category?.words.filter(({ text }) => text.length > 0) ?? []
    const pageStart = Math.floor(state.wordCursor / POKEGEAR_MARKING_WORD_PAGE_SIZE) * POKEGEAR_MARKING_WORD_PAGE_SIZE
    words.dataset.pokegearMarkingWordPage = String(pageStart / POKEGEAR_MARKING_WORD_PAGE_SIZE)
    words.replaceChildren(...available.slice(pageStart, pageStart + POKEGEAR_MARKING_WORD_PAGE_SIZE).map((word, pageIndex) => {
      const index = pageStart + pageIndex
      const button = document.createElement('button')
      button.type = 'button'
      button.dataset.pokegearMarkingWord = String(word.wordId)
      button.dataset.pokegearMarkingWordIndex = String(index)
      button.setAttribute('aria-current', String(index === state.wordCursor))
      button.textContent = word.text
      return button
    }))
    picker.append(categories, words)
  } else if (state.mode === 'delete') {
    picker.dataset.kind = 'delete'
    const remove = document.createElement('button')
    remove.type = 'button'
    remove.dataset.pokegearMarkingDelete = ''
    const confirmKey = document.createElement('kbd')
    confirmKey.dataset.inputKey = 'confirm'
    confirmKey.textContent = 'A'
    remove.append(confirmKey)
    picker.append(remove)
  } else {
    picker.dataset.kind = 'slots'
    const pool = document.createElement('div')
    pool.replaceChildren(...markingIcons.map((graphic) => {
      const icon = createGraphic(graphic)
      icon.setAttribute('aria-hidden', 'true')
      return icon
    }))
    picker.append(pool)
  }
  panel.append(texture, header, slots, picker)
  return panel
}

function paintNitroGraphic(canvas: HTMLCanvasElement, graphic: NitroGraphic | undefined, key = ''): void {
  if (canvas.dataset.pokegearGraphicKey === key && canvas.hidden === !graphic) return
  canvas.dataset.pokegearGraphicKey = key
  canvas.hidden = !graphic
  if (!graphic) return
  if (canvas.width !== graphic.width) canvas.width = graphic.width
  if (canvas.height !== graphic.height) canvas.height = graphic.height
  const context = canvas.getContext('2d')
  if (!context) return
  const image = context.createImageData(graphic.width, graphic.height)
  image.data.set(graphic.pixels)
  context.putImageData(image, 0, 0)
}

function updatePokegearMapCanvas(root: HTMLElement, graphic: NitroGraphic, key: string): void {
  const canvas = root.querySelector<HTMLCanvasElement>('canvas.pokegear-map-rom')
  if (canvas) paintNitroGraphic(canvas, graphic, key)
}

/** Met à jour la sélection et les pixels ROM sans reconstruire la vue. */
export function syncPokegearMapPresentation(root: HTMLElement, model: PokegearMapModel): void {
  const body = root.querySelector<HTMLElement>('.pokegear-map-body')
  if (!body) return
  updatePokegearMapCanvas(body, model.background, model.backgroundKey)
  const highlight = body.querySelector<HTMLCanvasElement>('[data-pokegear-map-highlight]')
  if (highlight) paintNitroGraphic(highlight, model.highlight, model.highlightKey)

  const region = body.querySelector<HTMLElement>('[data-pokegear-map-region]')
  const name = body.querySelector<HTMLElement>('[data-pokegear-map-name]')
  const flavor = body.querySelector<HTMLElement>('[data-pokegear-map-flavor]')
  if (region) region.textContent = model.regionLabel
  if (name) name.textContent = model.flypoint?.label ?? model.location?.label ?? ''
  if (flavor) flavor.textContent = model.location?.flavor ?? ''
  const detail = body.querySelector<HTMLElement>('.pokegear-map-detail')
  const presentationChanged = detail?.dataset.presentationKey !== model.presentationKey
  if (detail) detail.dataset.presentationKey = model.presentationKey
  const preview = body.querySelector<HTMLCanvasElement>('[data-pokegear-map-preview]')
  const banner = body.querySelector<HTMLCanvasElement>('[data-pokegear-map-area-banner]')
  if (preview) paintNitroGraphic(preview, model.locationPreview, `preview:${model.presentationKey}`)
  if (banner) paintNitroGraphic(banner, model.areaBanner, `banner:${model.presentationKey}`)
  if (presentationChanged && detail && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    detail.animate(
      [{ opacity: 0.55, transform: 'translateY(4px)' }, { opacity: 1, transform: 'translateY(0)' }],
      { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' },
    )
  }
  const selection = body.querySelector<HTMLElement>('[data-pokegear-map-selection]')
  selection?.style.setProperty('--map-left', `${model.cursor.x * 100 / 47}%`)
  selection?.style.setProperty('--map-top', `${model.cursor.y * 100 / 20}%`)
  const board = body.querySelector<HTMLElement>('[data-pokegear-map-board]')
  board?.setAttribute('aria-label', [model.prompt, model.location?.label].filter(Boolean).join(' · '))

  const fly = body.querySelector<HTMLButtonElement>('[data-pokegear-map-fly]')
  if (fly) {
    fly.hidden = !model.flypoint
    fly.disabled = !model.canFly
  }
  const currentPosition = body.querySelector<HTMLButtonElement>('[data-pokegear-map-current]')
  const currentPositionLabel = currentPosition?.querySelector<HTMLElement>('[data-pokegear-map-current-label]')
  if (currentPosition) {
    currentPosition.hidden = model.cursor.x === model.currentCursor.x && model.cursor.y === model.currentCursor.y
    currentPosition.setAttribute('aria-label', model.currentLocationLabel)
  }
  if (currentPositionLabel) currentPositionLabel.textContent = model.currentLocationLabel
  const markings = body.querySelector<HTMLButtonElement>('[data-pokegear-map-markings]')
  if (markings) markings.hidden = !model.location
}

/** Garde le focus sur la carte, unique surface de navigation des lieux. */
export function focusPokegearMapBoard(root: ParentNode): boolean {
  const board = root.querySelector<HTMLElement>('[data-pokegear-map-board]')
  if (!board) return false
  board.focus({ preventScroll: true })
  return true
}

export function syncPokegearMapMarkingsPresentation(root: HTMLElement, state: PokegearMapMarkingsUiState): void {
  const body = root.querySelector<HTMLElement>('.pokegear-map-body')
  if (!body || state.mode === 'map') return
  body.querySelectorAll<HTMLElement>('[data-pokegear-marking-slot]').forEach((button) => {
    button.setAttribute('aria-current', String(Number(button.dataset.pokegearMarkingSlot) === state.slotCursor))
  })
  body.querySelectorAll<HTMLElement>('[data-pokegear-marking-icon]').forEach((button) => {
    button.setAttribute('aria-current', String(Number(button.dataset.pokegearMarkingIcon) === state.iconCursor))
  })
  body.querySelectorAll<HTMLElement>('[data-pokegear-marking-word-index]').forEach((button) => {
    button.setAttribute('aria-current', String(Number(button.dataset.pokegearMarkingWordIndex) === state.wordCursor))
  })
  const focused = state.mode === 'icons'
    ? body.querySelector<HTMLElement>(`[data-pokegear-marking-icon="${state.iconCursor}"]`)
    : state.mode === 'words'
      ? body.querySelector<HTMLElement>(`[data-pokegear-marking-word-index="${state.wordCursor}"]`)
      : state.mode === 'delete'
        ? body.querySelector<HTMLElement>('[data-pokegear-marking-delete]')
        : body.querySelector<HTMLElement>(`[data-pokegear-marking-slot="${state.slotCursor}"]`)
  focused?.focus({ preventScroll: true })
  focused?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
}
