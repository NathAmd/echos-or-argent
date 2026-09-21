import { describe, expect, it, vi } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createPokedexCaptureRegistrationHost } from './pokedexCaptureRegistrationHost'

const pokemon = { speciesId: 74 } as CanonicalPokemon

class FakeElement {
  className = ''
  hidden = false
  dataset: Record<string, string | undefined> = {}
  tabIndex = -1
  childNodes: FakeElement[] = []
  private readonly attributes = new Map<string, string>()
  readonly classList = {
    add: (...names: string[]) => { this.className = [...new Set([...this.className.split(' ').filter(Boolean), ...names])].join(' ') },
    remove: (...names: string[]) => { this.className = this.className.split(' ').filter((name) => !names.includes(name)).join(' ') },
  }
  append(...children: FakeElement[]) { this.childNodes.push(...children) }
  replaceChildren(...children: FakeElement[]) { this.childNodes = children }
  getAttribute(name: string) { return this.attributes.get(name) ?? null }
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
  removeAttribute(name: string) { this.attributes.delete(name) }
  focus() {}
}

const asElement = (element: FakeElement): HTMLElement => element as unknown as HTMLElement

describe('hôte de l’enregistrement Pokédex après capture', () => {
  it('suspend le combat puis restaure exactement le menu et le combat sur A', async () => {
    const root = new FakeElement()
    root.className = 'ui-menu'
    root.hidden = true
    root.dataset.screen = 'root'
    const oldChild = new FakeElement()
    root.append(oldChild)
    const battleScreen = new FakeElement()
    const visibility = vi.fn()
    const host = createPokedexCaptureRegistrationHost({
      root: asElement(root),
      battleScreen: asElement(battleScreen),
      render: (caught) => {
        const entry = new FakeElement()
        entry.dataset.species = String(caught.speciesId)
        return asElement(entry)
      },
      onVisibilityChange: visibility,
    })

    const completion = host.open(pokemon)
    expect(host.isOpen()).toBe(true)
    expect(root.hidden).toBe(false)
    expect(root.dataset.screen).toBe('pokedex')
    expect(root.childNodes[0]?.dataset.species).toBe('74')
    expect(battleScreen.hidden).toBe(true)
    expect(host.handle('confirm')).toBe(true)
    await completion
    expect(host.isOpen()).toBe(false)
    expect(root.hidden).toBe(true)
    expect(root.dataset.screen).toBe('root')
    expect(root.childNodes[0]).toBe(oldChild)
    expect(battleScreen.hidden).toBe(false)
    expect(visibility).toHaveBeenCalledTimes(2)
  })

  it('accepte Échap/menu, ignore les directions et refuse les fermetures hors écran', async () => {
    const root = new FakeElement()
    const battleScreen = new FakeElement()
    battleScreen.hidden = true
    const host = createPokedexCaptureRegistrationHost({ root: asElement(root), battleScreen: asElement(battleScreen), render: () => asElement(new FakeElement()) })
    expect(host.close()).toBe(false)
    const completion = host.open(pokemon)
    expect(host.handle('left')).toBe(true)
    expect(host.isOpen()).toBe(true)
    expect(host.handle('cancel')).toBe(true)
    await completion
    expect(battleScreen.hidden).toBe(true)
  })
})
