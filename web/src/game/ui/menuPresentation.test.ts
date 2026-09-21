import { describe, expect, it, vi } from 'vitest'
import { getMenuArcOffset, getRovingMenuTabIndex, syncGameMenuButtonStatePresentation, syncGameMenuButtonStatesPresentation, syncGameMenuCursorPresentation } from './menuPresentation'

describe('menu arc presentation', () => {
  it('forme un arc symétrique quelle que soit la quantité d’entrées', () => {
    const offsets = Array.from({ length: 6 }, (_, index) => getMenuArcOffset(index, 6))
    expect(offsets).toEqual([22, 8, 1, 1, 8, 22])
  })
})

describe('menu roving tabindex', () => {
  it('ne laisse que la sélection et le retour persistant dans l’ordre de tabulation', () => {
    expect(getRovingMenuTabIndex(false)).toBe(-1)
    expect(getRovingMenuTabIndex(true)).toBe(0)
    expect(getRovingMenuTabIndex(false, true)).toBe(0)
  })

  it('synchronise sélection, tabstop et focus sans recréer les contrôles', () => {
    const createButton = (index: number, back = false) => ({
      dataset: { menuIndex: String(index) },
      classList: { contains: (className: string) => back && className === 'ui-menu-back' },
      setAttribute: vi.fn(),
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
      tabIndex: 0,
    })
    const first = createButton(0)
    const returnButton = createButton(1, true)
    const last = createButton(2)
    const root = { querySelectorAll: () => [first, returnButton, last] } as unknown as ParentNode

    const selected = syncGameMenuCursorPresentation(root, 2, null)

    expect(selected).toBe(last)
    expect(first.setAttribute).toHaveBeenCalledWith('aria-current', 'false')
    expect(returnButton.setAttribute).toHaveBeenCalledWith('aria-current', 'false')
    expect(last.setAttribute).toHaveBeenCalledWith('aria-current', 'true')
    expect([first.tabIndex, returnButton.tabIndex, last.tabIndex]).toEqual([-1, 0, 0])
    expect(last.focus).toHaveBeenCalledWith({ preventScroll: true })
    expect(last.scrollIntoView).toHaveBeenCalledWith({ block: 'nearest', inline: 'nearest' })
  })

  it('ne reprend pas le focus quand la sélection possède déjà le focus DOM', () => {
    const button = {
      dataset: { menuIndex: '3' },
      classList: { contains: () => false },
      setAttribute: vi.fn(),
      focus: vi.fn(),
      scrollIntoView: vi.fn(),
      tabIndex: -1,
    }
    const root = { querySelectorAll: () => [button] } as unknown as ParentNode

    syncGameMenuCursorPresentation(root, 3, button as unknown as HTMLButtonElement)

    expect(button.focus).not.toHaveBeenCalled()
    expect(button.scrollIntoView).toHaveBeenCalledOnce()
  })
})

describe('menu button state presentation', () => {
  it('synchronise valeur, état pressé et nom accessible sans remplacer les nœuds', () => {
    const label = { textContent: 'ANIMAT. COMBAT' }
    const value = { textContent: 'NON', setAttribute: vi.fn() }
    const attributes = new Map<string, string>([['aria-pressed', 'false']])
    const button = {
      dataset: { menuId: 'toggle-battle-animations', menuStateToken: 'false' },
      querySelector: (selector: string) => selector === '.game-menu-button-label' ? label : value,
      setAttribute: (name: string, state: string) => attributes.set(name, state),
      removeAttribute: (name: string) => attributes.delete(name),
    } as unknown as HTMLButtonElement

    expect(syncGameMenuButtonStatePresentation(button, { value: 'OUI', token: 'true', pressed: true })).toBe(true)
    expect(value.textContent).toBe('OUI')
    expect(button.dataset.menuStateToken).toBe('true')
    expect(attributes.get('aria-pressed')).toBe('true')
    expect(attributes.get('aria-label')).toBe('ANIMAT. COMBAT OUI')
    expect(value.setAttribute).toHaveBeenCalledWith('aria-hidden', 'true')
  })

  it('synchronise plusieurs options en place et expose la position du réglage cyclique', () => {
    const label = { textContent: 'VITESSE DU TEXTE' }
    const value = { textContent: '1', setAttribute: vi.fn() }
    const button = {
      dataset: { menuId: 'cycle-text-speed', menuStateToken: 'slow' },
      querySelector: (selector: string) => selector === '.game-menu-button-label' ? label : value,
      setAttribute: vi.fn(), removeAttribute: vi.fn(),
    } as unknown as HTMLButtonElement
    const root = { querySelectorAll: () => [button] } as unknown as ParentNode

    expect(syncGameMenuButtonStatesPresentation(root, () => ({ value: '3', token: 'fast', position: 3, size: 3 }))).toBe(1)
    expect(value.textContent).toBe('3')
    expect(button.dataset).toMatchObject({ menuStateToken: 'fast', menuStatePosition: '3', menuStateSize: '3' })
    expect(button.removeAttribute).toHaveBeenCalledWith('aria-pressed')
  })
})
