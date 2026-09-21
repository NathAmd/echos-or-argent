import { describe, expect, it, vi } from 'vitest'
import {
  createGameFullscreenController,
  type FullscreenDocument,
  type FullscreenRuntimePanel,
  type KeyboardLockNavigator,
} from './gameFullscreenController'

class FakeDocument extends EventTarget {
  fullscreenElement: Element | null = null
  webkitFullscreenElement: Element | null = null
  fullscreenEnabled = true
  activeElement: Element | null = null
  readonly body = { tagName: 'BODY' }
  readonly documentElement = { tagName: 'HTML' }
  exitFullscreen: () => Promise<void> = async () => undefined
}

class FakePanel extends EventTarget {
  tagName = 'SECTION'
  readonly focus = vi.fn()
  requestFullscreen: (options?: FullscreenOptions) => Promise<void> = async () => undefined
}

class FakeButton extends EventTarget {
  hidden = false
  title = ''
  readonly attributes = new Map<string, string>()
  setAttribute(name: string, value: string) { this.attributes.set(name, value) }
}

function createFixture(installed = false) {
  const document = new FakeDocument()
  const panel = new FakePanel()
  const button = new FakeButton()
  const keyboard = { lock: vi.fn(async () => undefined), unlock: vi.fn() }
  const changes = vi.fn()
  const results = vi.fn()
  const controller = createGameFullscreenController({
    document: document as unknown as FullscreenDocument,
    window: { matchMedia: vi.fn(() => ({ matches: installed })) } as unknown as Window,
    navigator: { keyboard } as unknown as KeyboardLockNavigator,
    panel: panel as unknown as FullscreenRuntimePanel,
    button: button as unknown as HTMLElement,
    keyboardCodes: ['ArrowUp', 'Escape'],
    onChange: changes,
    onRequestResult: results,
  })
  return { controller, document, panel, button, keyboard, changes, results }
}

describe('contrôleur plein écran du jeu', () => {
  it('centralise la présentation et la transition navigateur', () => {
    const { controller, document, panel, button, changes } = createFixture()
    controller.updatePresentation()
    expect(button.hidden).toBe(false)
    expect(button.attributes.get('aria-label')).toBe('Passer en plein écran')

    document.fullscreenElement = panel as unknown as Element
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(button.hidden).toBe(true)
    expect(button.title).toBe('Quitter le plein écran')
    expect(changes).toHaveBeenLastCalledWith({ previouslyActive: false, active: true, exitRequested: false })
  })

  it('verrouille les commandes à l’entrée et signale une sortie explicitement demandée', async () => {
    const { controller, document, panel, keyboard, changes } = createFixture()
    panel.requestFullscreen = vi.fn(async () => {
      document.fullscreenElement = panel as unknown as Element
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(await controller.setEnabled(true)).toBe(true)
    expect(panel.requestFullscreen).toHaveBeenCalledWith({ navigationUI: 'hide' })
    expect(keyboard.lock).toHaveBeenCalledWith(['ArrowUp', 'Escape'])

    document.exitFullscreen = vi.fn(async () => {
      document.fullscreenElement = null
      document.dispatchEvent(new Event('fullscreenchange'))
    })
    expect(await controller.setEnabled(false)).toBe(true)
    expect(keyboard.unlock).toHaveBeenCalledOnce()
    expect(changes).toHaveBeenLastCalledWith({ previouslyActive: true, active: false, exitRequested: true })
  })

  it('retente le verrouillage sur une reprise de contrôle après un refus Chromium', async () => {
    const { controller, document, panel, keyboard } = createFixture()
    keyboard.lock
      .mockRejectedValueOnce(new Error('activation transitoire absente'))
      .mockRejectedValueOnce(new Error('activation encore absente'))
    panel.requestFullscreen = vi.fn(async () => {
      document.fullscreenElement = panel as unknown as Element
    })

    expect(await controller.setEnabled(true)).toBe(true)
    expect(keyboard.lock).toHaveBeenCalledTimes(2)

    await Promise.resolve()
    await Promise.resolve()
    controller.focus(true)
    await vi.waitFor(() => expect(keyboard.lock).toHaveBeenCalledTimes(3))
    expect(panel.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('ne vole jamais le focus à une saisie et respecte le mode forcé ailleurs', () => {
    const { controller, document, panel } = createFixture()
    document.activeElement = { tagName: 'INPUT' } as Element
    controller.focus(true)
    expect(panel.focus).not.toHaveBeenCalled()

    document.activeElement = { tagName: 'BUTTON' } as Element
    controller.focus()
    expect(panel.focus).not.toHaveBeenCalled()
    controller.focus(true)
    expect(panel.focus).toHaveBeenCalledWith({ preventScroll: true })
  })

  it('porte aussi la requête du bouton et publie son résultat', async () => {
    const { document, panel, button, results } = createFixture()
    panel.requestFullscreen = vi.fn(async () => {
      document.fullscreenElement = panel as unknown as Element
    })
    button.dispatchEvent(new Event('click'))
    await vi.waitFor(() => expect(results).toHaveBeenCalledWith(true))
    expect(button.hidden).toBe(true)
  })

  it('retire ses abonnements lors de la destruction', () => {
    const { controller, document, panel, changes } = createFixture()
    controller.dispose()
    document.fullscreenElement = panel as unknown as Element
    document.dispatchEvent(new Event('fullscreenchange'))
    expect(changes).not.toHaveBeenCalled()
  })
})
