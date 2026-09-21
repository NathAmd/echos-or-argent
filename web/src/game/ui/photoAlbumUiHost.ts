import type { GameDigitalAction } from '../../gameInput'
import { startRomAudioPresentation } from '../../audio/romAudioPresentation'
import type { HgssPhotoFieldStep, HgssPhotoRunnerControls } from '../photo/hgssPhotoFieldRuntime'
import type { HgssPhotoMon, HgssSavedPhoto } from '../photo/hgssPhotoAlbum'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import { formatHgssRomMessage } from './romMessageFormatting'
import {
  createPhotoAlbumUiModel,
  focusPhotoAlbumAction,
  focusPhotoAlbumConfirmation,
  focusPhotoAlbumEntry,
  updatePhotoAlbumUi,
  type PhotoAlbumUiModel,
} from './photoAlbumUiModel'

export type PhotoAlbumUiResources = {
  messages: Readonly<Record<number, string>>
  mapLabel: (mapId: number) => string
  speciesName: (speciesId: number) => string
  createPokemonPreview: (mon: HgssPhotoMon) => HTMLElement | undefined
  createSubjectPreview: (spriteId: number) => HTMLElement | undefined
}

export type PhotoAlbumUiHostOptions = {
  root: HTMLElement
  readResources: () => PhotoAlbumUiResources | undefined
  createWorldSnapshot?: () => HTMLElement | undefined
  playSoundEffect?: (sequenceId: number) => void | Promise<void>
  onResume: () => void
  onStateChange?: () => void
  schedule?: (callback: () => void, milliseconds: number) => number
  cancelSchedule?: (timer: number) => void
}

export type PhotoAlbumUiHost = {
  present: (step: HgssPhotoFieldStep, runner: Partial<HgssPhotoRunnerControls>) => void
  handle: (action: GameDigitalAction) => boolean
  close: () => void
  isOpen: () => boolean
  getKind: () => HgssPhotoFieldStep['kind'] | undefined
}

export type PhotoAlbumRomText = {
  exit: string
  view: string
  delete: string
  move: string
  cancel: string
  selectPrompt: string
  actionPrompt: string
  movePrompt: string
  switched: string
  deletePrompt: string
  singleDetailTemplate: string
  groupDetailTemplate: string
}

export function resolvePhotoAlbumRomText(messages: Readonly<Record<number, string>>): PhotoAlbumRomText {
  return {
    exit: messages[0] ?? '', view: messages[1] ?? '', delete: messages[2] ?? '', move: messages[3] ?? '', cancel: messages[4] ?? '',
    selectPrompt: messages[5] ?? '', actionPrompt: messages[6] ?? '', movePrompt: messages[7] ?? '', switched: messages[8] ?? '',
    deletePrompt: messages[9] ?? '', singleDetailTemplate: messages[10] ?? '', groupDetailTemplate: messages[11] ?? '',
  }
}

type AlbumView = {
  surface: HTMLElement
  prompt: HTMLElement
  grid: HTMLElement
  page: HTMLOutputElement
  exit: HTMLButtonElement
  actions: HTMLElement
  actionButtons: HTMLButtonElement[]
  confirmation: HTMLElement
  confirmationPrompt: HTMLElement
  confirmationButtons: HTMLButtonElement[]
  detail: HTMLElement
  detailVisual: HTMLElement
  detailText: HTMLElement
  photoButtons: HTMLButtonElement[]
}

type ActivePhotoApp =
  | { kind: 'photoCapture', finish: () => void }
  | { kind: 'photoAlbum', finish: (photos: readonly HgssSavedPhoto[]) => void, model: PhotoAlbumUiModel, view: AlbumView, resources: PhotoAlbumUiResources, text: PhotoAlbumRomText }

const createElement = <K extends keyof HTMLElementTagNameMap>(tag: K, className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag)
  element.className = className
  return element
}

function createButton(className: string, label: string, key?: 'confirm' | 'cancel'): HTMLButtonElement {
  const button = createElement('button', className)
  button.type = 'button'
  const span = createElement('span')
  span.textContent = label
  button.append(span)
  if (key) {
    const keycap = createElement('kbd', 'photo-album-keycap')
    keycap.dataset.inputKey = key
    keycap.textContent = key === 'confirm' ? 'A' : 'B'
    button.append(keycap)
  }
  return button
}

function appendPhotoVisual(container: HTMLElement, photo: HgssSavedPhoto, resources: PhotoAlbumUiResources, compact: boolean): void {
  container.replaceChildren()
  const mons = photo.party.filter(({ speciesId }) => speciesId !== 0)
  for (const mon of compact ? mons.slice(0, 1) : mons) {
    const preview = resources.createPokemonPreview(mon)
    if (!preview) continue
    preview.classList.add('photo-album-pokemon')
    preview.dataset.shiny = String(mon.shiny)
    container.append(preview)
  }
  if (photo.subjectSpriteId !== 0) {
    const subject = resources.createSubjectPreview(photo.subjectSpriteId)
    if (subject) {
      subject.classList.add('photo-album-subject')
      container.prepend(subject)
    }
  }
}

function detailText(photo: HgssSavedPhoto, resources: PhotoAlbumUiResources, text: PhotoAlbumRomText): string {
  const leadSpeciesId = photo.party.find(({ speciesId }) => speciesId !== 0)?.speciesId ?? 0
  const leadName = photo.leadPokemonNickname ?? resources.speciesName(leadSpeciesId)
  return formatHgssRomMessage(
    photo.numMons > 1 ? text.groupDetailTemplate : text.singleDetailTemplate,
    [
      photo.playerName,
      resources.mapLabel(photo.mapId),
      leadName,
      String(2000 + photo.rtc.year),
      String(photo.rtc.month),
      String(photo.rtc.day),
    ],
  ).trim()
}

function requireRunnerMethod<K extends keyof HgssPhotoRunnerControls>(runner: Partial<HgssPhotoRunnerControls>, key: K): HgssPhotoRunnerControls[K] {
  const method = runner[key]
  if (typeof method !== 'function') throw new Error(`Le runner PhotoAlbum HGSS ne fournit pas ${key}.`)
  return method as HgssPhotoRunnerControls[K]
}

export function createPhotoAlbumUiHost(options: PhotoAlbumUiHostOptions): PhotoAlbumUiHost {
  const schedule = options.schedule ?? ((callback, milliseconds) => window.setTimeout(callback, milliseconds))
  const cancelSchedule = options.cancelSchedule ?? ((timer) => window.clearTimeout(timer))
  let active: ActivePhotoApp | undefined
  let timer: number | undefined
  let lastRenderedCursor = -1
  let renderedPhotoCount = -1

  const notify = (): void => options.onStateChange?.()
  const hideRoot = (): void => {
    options.root.hidden = true
    options.root.className = 'field-photo-album'
    options.root.replaceChildren()
  }
  const resume = (): void => {
    active = undefined
    hideRoot()
    notify()
    options.onResume()
  }

  function finishAlbum(): void {
    if (active?.kind !== 'photoAlbum') return
    const { finish, model } = active
    finish(model.photos)
    resume()
  }

  function createAlbumView(text: PhotoAlbumRomText): AlbumView {
    const surface = createElement('section', 'photo-album-surface')
    surface.setAttribute('role', 'dialog')
    surface.setAttribute('aria-modal', 'true')
    const header = createElement('header', 'photo-album-header')
    const prompt = createElement('h2', 'photo-album-prompt')
    const page = createElement('output', 'photo-album-page')
    header.append(prompt, page)
    const grid = createElement('div', 'photo-album-grid')
    grid.setAttribute('role', 'grid')
    const detail = createElement('article', 'photo-album-detail')
    detail.hidden = true
    const detailVisual = createElement('div', 'photo-album-detail-visual')
    const detailTextElement = createElement('p', 'photo-album-detail-text')
    detail.append(detailVisual, detailTextElement)
    const actions = createElement('nav', 'photo-album-actions')
    actions.hidden = true
    const actionButtons = [text.view, text.delete, text.move, text.cancel].map((label, index) => {
      const button = createButton('photo-album-action', label, index === 3 ? 'cancel' : 'confirm')
      button.dataset.photoAction = String(index)
      actions.append(button)
      return button
    })
    const confirmation = createElement('section', 'photo-album-confirmation')
    confirmation.hidden = true
    const confirmationPrompt = createElement('p')
    const confirmationButtons = [text.delete, text.cancel].map((label, index) => {
      const button = createButton('photo-album-action', label, index === 1 ? 'cancel' : 'confirm')
      button.dataset.photoConfirmation = String(index)
      return button
    })
    const confirmationNav = createElement('nav')
    confirmationNav.append(...confirmationButtons)
    confirmation.append(confirmationPrompt, confirmationNav)
    const exit = createButton('photo-album-exit', text.exit, 'cancel')
    exit.addEventListener('click', finishAlbum)
    surface.append(header, grid, detail, actions, confirmation, exit)
    return { surface, prompt, grid, page, exit, actions, actionButtons, confirmation, confirmationPrompt, confirmationButtons, detail, detailVisual, detailText: detailTextElement, photoButtons: [] }
  }

  function rebuildPhotoButtons(app: Extract<ActivePhotoApp, { kind: 'photoAlbum' }>): void {
    const { model, view, resources } = app
    view.grid.replaceChildren()
    view.photoButtons = model.photos.map((photo, index) => {
      const button = createElement('button', 'photo-album-card')
      button.type = 'button'
      button.dataset.photoIndex = String(index)
      button.setAttribute('role', 'gridcell')
      const visual = createElement('span', 'photo-album-card-visual')
      appendPhotoVisual(visual, photo, resources, true)
      const map = createElement('strong')
      map.textContent = resources.mapLabel(photo.mapId)
      const date = createElement('time')
      date.textContent = `${photo.rtc.day}/${photo.rtc.month}/${2000 + photo.rtc.year}`
      button.append(visual, map, date)
      button.setAttribute('aria-label', detailText(photo, resources, app.text))
      button.addEventListener('pointerdown', () => {
        focusPhotoAlbumEntry(model, index)
        syncAlbum(app, true)
      })
      button.addEventListener('click', () => {
        focusPhotoAlbumEntry(model, index)
        const effect = updatePhotoAlbumUi(model, 'confirm')
        if (effect === 'close') finishAlbum(); else syncAlbum(app, true)
      })
      view.grid.append(button)
      return button
    })
    renderedPhotoCount = model.photos.length
  }

  function syncAlbum(app: Extract<ActivePhotoApp, { kind: 'photoAlbum' }>, focus = false): void {
    const { model, view, resources, text } = app
    if (renderedPhotoCount !== model.photos.length) rebuildPhotoButtons(app)
    const page = Math.floor(model.cursor / 12)
    const pages = Math.max(1, Math.ceil(model.photos.length / 12))
    view.page.textContent = `${page + 1}/${pages}`
    view.photoButtons.forEach((button, index) => {
      const current = index === model.cursor
      button.hidden = Math.floor(index / 12) !== page
      button.tabIndex = current ? 0 : -1
      button.setAttribute('aria-current', String(current))
      button.dataset.moveSource = String(model.phase === 'move' && index === model.moveSource)
    })
    view.actions.hidden = model.phase !== 'actions'
    view.confirmation.hidden = model.phase !== 'deleteConfirm'
    view.detail.hidden = model.phase !== 'view'
    view.grid.hidden = model.phase === 'view'
    view.exit.hidden = model.phase !== 'grid'
    view.prompt.textContent = model.phase === 'actions' ? text.actionPrompt
      : model.phase === 'move' ? text.movePrompt
        : model.notice === 'switched' ? text.switched : text.selectPrompt
    view.actionButtons.forEach((button, index) => {
      const current = index === model.actionCursor
      button.tabIndex = current ? 0 : -1
      button.setAttribute('aria-current', String(current))
    })
    view.confirmationPrompt.textContent = text.deletePrompt
    view.confirmationButtons.forEach((button, index) => {
      const current = index === model.confirmCursor
      button.tabIndex = current ? 0 : -1
      button.setAttribute('aria-current', String(current))
    })
    const photo = model.photos[model.cursor]
    if (model.phase === 'view' && photo && lastRenderedCursor !== model.cursor) {
      appendPhotoVisual(view.detailVisual, photo, resources, false)
      view.detailText.textContent = detailText(photo, resources, text)
      lastRenderedCursor = model.cursor
    }
    if (focus) {
      const selected = model.phase === 'actions' ? view.actionButtons[model.actionCursor]
        : model.phase === 'deleteConfirm' ? view.confirmationButtons[model.confirmCursor]
          : model.phase === 'grid' || model.phase === 'move' ? view.photoButtons[model.cursor]
            : view.detail
      selected?.focus({ preventScroll: true })
    }
    notify()
  }

  function handleAlbum(action: GameDigitalAction): boolean {
    if (active?.kind !== 'photoAlbum') return false
    const previousCount = active.model.photos.length
    const effect = updatePhotoAlbumUi(active.model, action)
    if (effect === 'close') finishAlbum()
    else {
      if (previousCount !== active.model.photos.length) renderedPhotoCount = -1
      syncAlbum(active, true)
    }
    return true
  }

  function wireAlbumButtons(app: Extract<ActivePhotoApp, { kind: 'photoAlbum' }>): void {
    app.view.actionButtons.forEach((button, index) => {
      button.addEventListener('pointerdown', () => { focusPhotoAlbumAction(app.model, index); syncAlbum(app, true) })
      button.addEventListener('click', () => { focusPhotoAlbumAction(app.model, index); updatePhotoAlbumUi(app.model, 'confirm'); syncAlbum(app, true) })
    })
    app.view.confirmationButtons.forEach((button, index) => {
      button.addEventListener('pointerdown', () => { focusPhotoAlbumConfirmation(app.model, index as 0 | 1); syncAlbum(app, true) })
      button.addEventListener('click', () => {
        focusPhotoAlbumConfirmation(app.model, index as 0 | 1)
        const effect = updatePhotoAlbumUi(app.model, 'confirm')
        if (effect === 'changed') renderedPhotoCount = -1
        syncAlbum(app, true)
      })
    })
  }

  return {
    present(step, runner): void {
      if (active) throw new Error(`L'application ${active.kind} est déjà ouverte.`)
      options.root.hidden = false
      if (step.kind === 'photoCapture') {
        const finish = requireRunnerMethod(runner, 'finishPhotoCapture')
        active = { kind: step.kind, finish }
        options.root.className = 'field-photo-album is-capturing'
        const scene = options.createWorldSnapshot?.()
        if (scene) { scene.classList.add('photo-capture-scene'); options.root.append(scene) }
        timer = schedule(() => {
          if (active?.kind !== 'photoCapture') return
          startRomAudioPresentation(options.playSoundEffect
            ? () => options.playSoundEffect?.(step.shutterSequenceId)
            : undefined)
          options.root.classList.add('is-flashing')
          active.finish()
          timer = schedule(resume, 140)
        }, hgssVBlanksToMilliseconds(step.exposureDelayFrames))
        notify()
        return
      }
      const resources = options.readResources()
      if (!resources) throw new Error('Les ressources ROM du PhotoAlbum HGSS sont absentes.')
      const text = resolvePhotoAlbumRomText(resources.messages)
      const view = createAlbumView(text)
      const app: Extract<ActivePhotoApp, { kind: 'photoAlbum' }> = {
        kind: step.kind,
        finish: requireRunnerMethod(runner, 'closePhotoAlbum'),
        model: createPhotoAlbumUiModel(step.photos),
        view,
        resources,
        text,
      }
      active = app
      renderedPhotoCount = -1
      lastRenderedCursor = -1
      options.root.className = 'field-photo-album is-album'
      options.root.replaceChildren(view.surface)
      wireAlbumButtons(app)
      syncAlbum(app, true)
    },
    handle(action): boolean {
      if (!active) return false
      return active.kind === 'photoCapture' ? true : handleAlbum(action)
    },
    close(): void {
      if (timer !== undefined) cancelSchedule(timer)
      timer = undefined
      active = undefined
      hideRoot()
      notify()
    },
    isOpen: () => active !== undefined,
    getKind: () => active?.kind,
  }
}
