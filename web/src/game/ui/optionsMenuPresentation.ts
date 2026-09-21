import { getUtilityMenuSection } from '../menu/utilityMenuSections'
import { isAdjustableOptionsCommand, type MainMenuItem, type MainMenuState } from '../menu/mainMenuController'

type OptionsMenuNotice = { text: string, tone: 'info' | 'success' | 'warning' }

export type OptionsMenuGroup = {
  section: 'settings' | 'system'
  entries: Array<{ item: MainMenuItem, index: number, adjustable: boolean }>
}

export function createOptionsMenuGroups(state: MainMenuState): OptionsMenuGroup[] {
  const groups: OptionsMenuGroup[] = [
    { section: 'settings', entries: [] },
    { section: 'system', entries: [] },
  ]
  state.items.forEach((item, index) => {
    if (item.id === 'root') return
    const section = getUtilityMenuSection('options', item)
    const group = groups.find((candidate) => candidate.section === section)
    group?.entries.push({ item, index, adjustable: isAdjustableOptionsCommand(item.id) })
  })
  return groups.filter(({ entries }) => entries.length > 0)
}

/** Présentation compacte : une seule colonne suit exactement l'ordre haut/bas. */
export function createOptionsMenuPresentation(options: {
  state: MainMenuState
  notice?: OptionsMenuNotice
  createButton: (item: MainMenuItem, index: number, selected: boolean, withAsset?: boolean) => HTMLButtonElement
}): HTMLElement {
  const root = document.createElement('div')
  root.className = 'game-menu-list options-menu'
  if (options.notice) {
    const notice = document.createElement('p')
    notice.className = 'game-menu-notice options-menu-notice'
    notice.dataset.tone = options.notice.tone
    notice.setAttribute('role', 'status')
    notice.textContent = options.notice.text
    root.append(notice)
  }
  for (const group of createOptionsMenuGroups(options.state)) {
    const section = document.createElement('section')
    section.className = 'game-menu-list-section options-menu-section'
    section.dataset.optionsSection = group.section
    section.append(...group.entries.map(({ item, index, adjustable }) => {
      const button = options.createButton(item, index, index === options.state.cursor, false)
      if (adjustable) button.dataset.optionsAdjustable = 'true'
      return button
    }))
    root.append(section)
  }
  return root
}
