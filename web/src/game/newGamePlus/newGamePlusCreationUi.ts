import type { GameDigitalAction } from '../../gameInput'
import {
  createNewGamePlusCreationController,
  type NewGamePlusCreationController,
  type NewGamePlusCreationModuleOption,
  type NewGamePlusCreationResult,
  type NewGamePlusCreationSelection,
  type NewGamePlusCreationSource,
  type NewGamePlusCreationState,
} from './newGamePlusCreationController'
import type { HgssBrowserSaveSlot } from '../save/hgssSaveStorage'

export type NewGamePlusCreationUi = {
  isOpen: () => boolean
  open: (options: {
    sources: readonly NewGamePlusCreationSource[]
    targets: readonly HgssBrowserSaveSlot[]
    modules: readonly NewGamePlusCreationModuleOption[]
    preferredSourceSlot?: HgssBrowserSaveSlot
    preferredTargetSlot?: HgssBrowserSaveSlot
  }) => void
  close: () => void
  handle: (action: GameDigitalAction) => boolean
}

type CreationUiCallbacks = {
  /** `true` confirme la création ; `false` conserve le draft affiché. */
  onCreate: (selection: NewGamePlusCreationSelection) => boolean
  onCancel: () => void
}

function optionButton(index: number, title: string, detail: string): HTMLButtonElement {
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'new-game-plus-option'
  button.dataset.newGamePlusIndex = String(index)
  const heading = document.createElement('strong')
  heading.textContent = title
  const copy = document.createElement('small')
  copy.textContent = detail
  button.append(heading, copy)
  return button
}

function createSection(title: string): { section: HTMLElement, body: HTMLElement } {
  const section = document.createElement('section')
  section.className = 'new-game-plus-section'
  const heading = document.createElement('h3')
  heading.textContent = title
  const body = document.createElement('div')
  body.className = 'new-game-plus-options'
  section.append(heading, body)
  return { section, body }
}

function syncCreationPresentation(root: HTMLElement, state: NewGamePlusCreationState): void {
  root.hidden = !state.open
  if (!state.open) {
    root.replaceChildren()
    return
  }
  const panel = document.createElement('article')
  panel.className = 'new-game-plus-panel'
  panel.setAttribute('role', 'dialog')
  panel.setAttribute('aria-modal', 'true')
  panel.setAttribute('aria-labelledby', 'new-game-plus-creation-title')

  const header = document.createElement('header')
  const kicker = document.createElement('span')
  kicker.textContent = 'MODE DÉBLOQUÉ'
  const title = document.createElement('h2')
  title.id = 'new-game-plus-creation-title'
  title.textContent = 'NOUVELLE PARTIE+'
  const intro = document.createElement('p')
  intro.textContent = 'Créez une partie indépendante. La sauvegarde terminée reste intacte.'
  header.append(kicker, title, intro)

  const content = document.createElement('div')
  content.className = 'new-game-plus-content'
  const source = createSection('Partie source')
  const target = createSection('Nouvel emplacement')
  const modules = createSection('Options cumulables')

  state.items.forEach((item, index) => {
    let button: HTMLButtonElement | undefined
    if (item.kind === 'source') {
      const value = state.sources.find(({ slot }) => slot === item.slot)
      button = optionButton(index, `Emplacement ${item.slot} · ${value?.playerName ?? ''}`, value?.summary ?? '')
      button.dataset.selected = String(state.sourceSlot === item.slot)
      button.setAttribute('aria-pressed', String(state.sourceSlot === item.slot))
      source.body.append(button)
    } else if (item.kind === 'target') {
      button = optionButton(index, `Emplacement ${item.slot}`, 'Vide · réservé à cette nouvelle partie')
      button.dataset.selected = String(state.targetSlot === item.slot)
      button.setAttribute('aria-pressed', String(state.targetSlot === item.slot))
      target.body.append(button)
    } else if (item.kind === 'module') {
      const value = state.modules.find(({ id }) => id === item.moduleId)
      const configIndex = state.moduleConfigIndexes.get(item.moduleId) ?? 0
      const configChoice = value?.configChoices[configIndex]
      const detail = [value?.description ?? '', value && value.configChoices.length > 1 ? `Choix : ${configChoice?.label ?? ''}` : '']
        .filter(Boolean).join(' · ')
      button = optionButton(index, value?.title ?? item.moduleId, detail)
      button.classList.add('new-game-plus-module')
      button.dataset.selected = String(state.enabledModuleIds.has(item.moduleId))
      button.setAttribute('aria-pressed', String(state.enabledModuleIds.has(item.moduleId)))
      modules.body.append(button)
      if (value && value.configChoices.length > 1) {
        const select = document.createElement('select')
        select.className = 'new-game-plus-config'
        select.dataset.newGamePlusConfigModule = value.id
        select.setAttribute('aria-label', `Configuration : ${value.title}`)
        select.value = String(configIndex)
        select.append(...value.configChoices.map((choice, choiceIndex) => {
          const option = document.createElement('option')
          option.value = String(choiceIndex)
          option.textContent = choice.label
          option.selected = choiceIndex === configIndex
          return option
        }))
        modules.body.append(select)
      }
    }
    if (button) {
      button.tabIndex = state.cursor === index ? 0 : -1
      button.setAttribute('aria-current', String(state.cursor === index))
    }
  })
  if (state.sources.length === 0) {
    const warning = document.createElement('p')
    warning.className = 'new-game-plus-warning'
    warning.textContent = 'La victoire reste débloquée, mais aucune sauvegarde terminée n’est disponible comme source.'
    source.body.append(warning)
  }
  if (state.targets.length === 0) {
    const warning = document.createElement('p')
    warning.className = 'new-game-plus-warning'
    warning.textContent = 'Aucun emplacement vide. Libérez-en un depuis une partie normale : rien ne sera écrasé ici.'
    target.body.append(warning)
  }
  if (state.modules.length === 0) {
    const baseline = document.createElement('p')
    baseline.className = 'new-game-plus-baseline'
    baseline.textContent = 'Aucun modificateur sélectionnable pour cette version. Le profil NG+ restera extensible.'
    modules.body.append(baseline)
  }
  content.append(source.section, target.section, modules.section)

  const footer = document.createElement('footer')
  const submitIndex = state.items.findIndex((item) => item.kind === 'submit')
  const cancelIndex = state.items.findIndex((item) => item.kind === 'cancel')
  const submit = optionButton(submitIndex, 'Créer la partie+', 'Démarrer l’introduction dans le nouvel emplacement')
  submit.classList.add('new-game-plus-submit')
  submit.disabled = state.sourceSlot === undefined || state.targetSlot === undefined
  submit.tabIndex = state.cursor === submitIndex ? 0 : -1
  submit.setAttribute('aria-current', String(state.cursor === submitIndex))
  const cancel = optionButton(cancelIndex, 'Retour', 'Revenir aux sauvegardes')
  cancel.classList.add('new-game-plus-cancel')
  cancel.tabIndex = state.cursor === cancelIndex ? 0 : -1
  cancel.setAttribute('aria-current', String(state.cursor === cancelIndex))
  footer.append(submit, cancel)
  panel.append(header, content, footer)
  root.replaceChildren(panel)
  root.querySelector<HTMLButtonElement>(`[data-new-game-plus-index="${state.cursor}"]`)?.focus({ preventScroll: true })
}

export function createNewGamePlusCreationUi(host: HTMLElement, callbacks: CreationUiCallbacks): NewGamePlusCreationUi {
  const root = document.createElement('section')
  root.className = 'new-game-plus-overlay new-game-plus-creation'
  root.hidden = true
  host.append(root)
  const controller: NewGamePlusCreationController = createNewGamePlusCreationController()

  const apply = (result: NewGamePlusCreationResult): boolean => {
    if (result.kind === 'ignored') return false
    if (result.kind === 'created') {
      const accepted = callbacks.onCreate(result.selection)
      syncCreationPresentation(root, controller.resolveCreation(accepted))
      return true
    }
    syncCreationPresentation(root, result.state)
    if (result.kind === 'cancelled') callbacks.onCancel()
    return true
  }
  root.addEventListener('click', (event) => {
    const origin = event.target
    if (!(origin instanceof Element)) return
    const button = origin.closest<HTMLButtonElement>('button[data-new-game-plus-index]')
    if (!button || !root.contains(button) || button.disabled) return
    controller.focus(Number.parseInt(button.dataset.newGamePlusIndex ?? '', 10))
    apply(controller.handle('confirm'))
  })
  root.addEventListener('change', (event) => {
    const select = event.target
    if (!(select instanceof HTMLSelectElement) || !select.dataset.newGamePlusConfigModule) return
    const next = controller.configureModule(
      select.dataset.newGamePlusConfigModule,
      Number.parseInt(select.value, 10),
    )
    syncCreationPresentation(root, next)
  })
  return {
    isOpen: () => controller.getState().open,
    open: (options) => syncCreationPresentation(root, controller.open(options)),
    close: () => syncCreationPresentation(root, controller.close()),
    handle: (action) => apply(controller.handle(action)),
  }
}
