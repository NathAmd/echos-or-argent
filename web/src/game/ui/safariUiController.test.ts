import { afterEach, describe, expect, it, vi } from 'vitest'
import type { HgssSafariUiAssets } from '../../rom/safari/safariUiAssets'
import type { HgssSafariObjectId } from '../safari/hgssSafariState'
import {
  createSafariCustomizerController,
  createSafariDecoratorController,
  resolveSafariUiRomText,
  type SafariUiMessageBanks,
} from './safariUiController'

class TestElement {
  readonly attributes = new Map<string, string>()
  readonly children: (TestElement | string)[] = []
  readonly dataset: Record<string, string> = {}
  readonly listeners = new Map<string, Array<(event: Event) => void>>()
  className = ''
  disabled = false
  hidden = false
  parentElement: TestElement | undefined
  replacementCount = 0
  tabIndex = 0
  textContent: string | null = null
  type = ''
  focusCount = 0
  readonly classList = {
    add: (...tokens: string[]): void => {
      const values = new Set(this.className.split(/\s+/).filter(Boolean))
      tokens.forEach((token) => values.add(token))
      this.className = [...values].join(' ')
    },
  }

  append(...children: (TestElement | string)[]): void {
    for (const child of children) {
      if (child instanceof TestElement) child.parentElement = this
      this.children.push(child)
    }
  }

  replaceChildren(...children: (TestElement | string)[]): void {
    this.replacementCount += 1
    this.children.splice(0)
    this.append(...children)
  }

  setAttribute(name: string, value: string): void {
    this.attributes.set(name, value)
  }

  addEventListener(type: string, listener: (event: Event) => void): void {
    const listeners = this.listeners.get(type) ?? []
    listeners.push(listener)
    this.listeners.set(type, listeners)
  }

  focus(): void {
    this.focusCount += 1
  }

  dispatch(type: 'pointerdown' | 'click'): void {
    const event = { target: this } as unknown as Event
    this.listeners.get(type)?.forEach((listener) => listener(event))
  }
}

function installTestDom(): void {
  vi.stubGlobal('document', { createElement: () => new TestElement() })
}

function descendants(root: TestElement): TestElement[] {
  return [root, ...root.children.flatMap((child) => child instanceof TestElement ? descendants(child) : [])]
}

function findControl(root: TestElement, key: string, value?: string): TestElement {
  const control = descendants(root).find((element) => (
    element.dataset[key] !== undefined && (value === undefined || element.dataset[key] === value)
  ))
  if (!control) throw new Error(`Missing Safari test control ${key}:${value ?? ''}.`)
  return control
}

function fakeAssets(): HgssSafariUiAssets {
  const graphic = {
    width: 64,
    height: 64,
    pixels: new Uint8ClampedArray(64 * 64 * 4),
    graphicsOffset: 0,
    paletteOffset: 0,
    colorDepth: 4,
  }
  return {
    customizer: {
      backgroundGroups: [{ layers: [{ graphic }] }],
      areaPreviews: Array.from({ length: 12 }, (_, areaId) => ({ areaId, frames: [graphic] })),
      objectSprites: {},
    },
    decorator: {
      backgroundGroups: [{ layers: [{ graphic }] }],
      objectSprites: {},
    },
  } as unknown as HgssSafariUiAssets
}

const areaNames = [
  'Prairie', 'Champ de fleurs', 'Savane', 'Rochers',
  'Rocs et lac', 'Terre humide', 'Bois', 'Bois et lacs',
  'Marais', 'Terre aride', 'Montagne', 'Désert',
]
const objectNames = [
  'Bosquet', 'Fleur rouge', 'Fleur rose', 'Arbre', 'Souche', 'Branches',
  'Petit rocher', 'Gros rocher', 'Roc moussu', 'Flaque', 'Geyser', 'Point d’eau',
  'Banc', 'Mini haie 1', 'Mini haie 2', 'Maxi haie 1', 'Maxi haie 2', 'Panneau',
  'Statue', 'Drapeau', 'Lampadaire', 'Signe droite', 'Signe gauche', 'Corbeille',
]

function messageBanks(): SafariUiMessageBanks {
  return {
    45: { 12: 'OUI', 13: 'NON' },
    427: { 9: 'Il n’y a aucun Bloc à poser!' },
    429: {
      0: 'Que voulez-vous faire?',
      1: 'Echanger avec quelle zone?',
      2: 'La mettre où?',
      3: 'Les Blocs posés seront retirés.\nContinuer?',
      4: 'RETOUR',
      6: 'ANNULER',
      7: 'ECHANGER',
      8: 'ORDRE',
      9: '{132 0,0}/2',
      10: 'Herbes',
      11: 'Bois',
      12: 'Rochers',
      13: 'Eau',
      14: 'Autres Blocs',
      15: '{133 0,0}',
      ...Object.fromEntries(areaNames.map((name, id) => [16 + id, name])),
    },
    430: {
      0: 'Poser Bloc {108 0,0}?',
      4: 'Il n’y a plus de place.',
      5: 'Impossible à poser sur la terre.',
      6: 'Impossible à poser sur l’eau.',
      7: 'Vous ne pouvez pas en poser plus.',
      8: 'Retour',
      12: '{132 0,0}/{132 1,0}',
      ...Object.fromEntries(objectNames.map((name, objectId) => [14 + objectId, name])),
      ...Object.fromEntries(objectNames.map((name, objectId) => [38 + objectId, `${name}.`])),
    },
  }
}

afterEach(() => vi.unstubAllGlobals())

describe('Safari ROM UI text contract', () => {
  it('resolves native area/object banks and never supplies an authored fallback', () => {
    const text = resolveSafariUiRomText(messageBanks())
    expect(text.customizer.areaNames).toEqual(areaNames)
    expect(text.customizer.cancelLabel).toBe('ANNULER')
    expect(text.customizer.orderLabel).toBe('ORDRE')
    expect(text.customizer.yesLabel).toBe('OUI')
    expect(text.decorator.objectNames).toEqual(objectNames)
    expect(text.decorator.noObjects).toBe('Il n’y a aucun Bloc à poser!')
    expect(text.decorator.unavailableMessages).toEqual([
      'Il n’y a plus de place.',
      'Impossible à poser sur la terre.',
      'Impossible à poser sur l’eau.',
      'Vous ne pouvez pas en poser plus.',
    ])

    const absent = resolveSafariUiRomText({})
    expect(absent.customizer.prompt).toBe('')
    expect(absent.customizer.areaNames.every((value) => value === '')).toBe(true)
    expect(absent.decorator.objectDescriptions.every((value) => value === '')).toBe(true)
  })
})

describe('Safari Customizer controller', () => {
  it('builds native previews once and only moves focus during digital navigation', () => {
    installTestDom()
    const root = new TestElement()
    const createGraphic = vi.fn(() => new TestElement() as unknown as HTMLElement)
    const controller = createSafariCustomizerController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      initialAreas: [0, 1, 2, 3, 4, 5],
      createGraphic,
      onCommit: vi.fn(),
      onClose: vi.fn(),
    })
    expect(root.replacementCount).toBe(1)
    controller.open()
    const graphicCalls = createGraphic.mock.calls.length
    expect(controller.handle('right')).toBe(true)
    expect(controller.getModel().slotCursor).toBe(1)
    expect(root.replacementCount).toBe(1)
    expect(createGraphic).toHaveBeenCalledTimes(graphicCalls)
  })

  it('uses pointerdown for focus and click as the single semantic activation', () => {
    installTestDom()
    const root = new TestElement()
    const controller = createSafariCustomizerController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      initialAreas: [0, 1, 2, 3, 4, 5],
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onCommit: vi.fn(),
      onClose: vi.fn(),
    })
    controller.open()
    const slot = findControl(root, 'safariSlot', '2')
    slot.dispatch('pointerdown')
    expect(controller.getModel()).toMatchObject({ phase: 'slots', slotCursor: 2 })
    slot.dispatch('click')
    expect(controller.getModel()).toMatchObject({ phase: 'menu', slotCursor: 2 })
  })

  it('commits a replacement through the ROM confirmation without rebuilding the root', () => {
    installTestDom()
    const root = new TestElement()
    const onCommit = vi.fn()
    const controller = createSafariCustomizerController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      initialAreas: [0, 1, 2, 3, 4, 5],
      initialBlockCounts: [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      showBlockCounts: true,
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onCommit,
      onClose: vi.fn(),
    })
    controller.open()
    controller.handle('confirm')
    controller.handle('confirm')
    controller.handle('page-next')
    findControl(root, 'safariArea', '8').dispatch('click')
    expect(controller.getModel()).toMatchObject({ phase: 'confirmation', confirmationCursor: 1 })
    findControl(root, 'safariConfirmation', '0').dispatch('click')
    expect(onCommit).toHaveBeenCalledWith(expect.objectContaining({
      operation: 'replace',
      sourceSlot: 0,
      targetAreaId: 8,
      areas: [8, 1, 2, 3, 4, 5],
    }))
    expect(root.replacementCount).toBe(1)
  })
})

describe('Safari Decorator controller', () => {
  it('shows the ROM object prompt and confirms the selected unlocked object', () => {
    installTestDom()
    const root = new TestElement()
    const onSelect = vi.fn()
    const controller = createSafariDecoratorController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      objectIds: [0, 6, 23],
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onSelect,
      onClose: vi.fn(),
    })
    controller.open()
    findControl(root, 'safariObject', '6').dispatch('click')
    expect(controller.getModel()).toMatchObject({ phase: 'confirmation', cursor: 1, confirmationCursor: 1 })
    const prompt = descendants(root).find((element) => element.className === 'safari-ui-confirmation-prompt')
    expect(prompt?.textContent).toBe('Poser Bloc Petit rocher?')
    findControl(root, 'safariConfirmation', '0').dispatch('click')
    expect(onSelect).toHaveBeenCalledOnce()
    expect(onSelect).toHaveBeenCalledWith(6)
  })

  it('keeps the native empty-state message and closes its selected RETOUR with A/Enter', () => {
    installTestDom()
    const root = new TestElement()
    const onClose = vi.fn()
    const controller = createSafariDecoratorController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      objectIds: [],
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onSelect: vi.fn(),
      onClose,
    })
    controller.open()
    expect(descendants(root).some((element) => element.textContent === 'Il n’y a aucun Bloc à poser!')).toBe(true)
    expect(controller.getModel().returnColumn).toBe(0)
    expect(findControl(root, 'safariReturn').attributes.get('aria-current')).toBe('true')
    expect(controller.handle('confirm')).toBe(true)
    expect(controller.isOpen()).toBe(false)
    expect(onClose).toHaveBeenCalledOnce()
  })

  it('renders an unavailable native Block as focusable and shows its ROM reason on activation', () => {
    installTestDom()
    const root = new TestElement()
    const onSelect = vi.fn()
    const controller = createSafariDecoratorController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      candidates: [
        { objectId: 6, unavailableReason: 2 },
        { objectId: 10 },
        { objectId: 0 },
        { objectId: 1 },
        { objectId: 2 },
        { objectId: 3 },
        { objectId: 4 },
      ],
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onSelect,
      onClose: vi.fn(),
    })
    controller.open()
    const blocked = findControl(root, 'safariObject', '6')
    const nextPage = findControl(root, 'safariPage', 'next')
    expect(nextPage.disabled).toBe(false)
    expect(blocked.attributes.get('aria-disabled')).toBe('true')
    blocked.dispatch('click')
    expect(controller.getModel()).toMatchObject({ phase: 'notice', noticeReason: 2 })
    expect(descendants(root).some((element) => element.textContent === 'Impossible à poser sur la terre.')).toBe(true)
    expect(onSelect).not.toHaveBeenCalled()
    const notice = descendants(root).find((element) => element.className === 'safari-ui-notice')
    expect(notice?.focusCount).toBeGreaterThan(0)
    expect(nextPage.disabled).toBe(true)
    notice?.dispatch('click')
    expect(controller.getModel().phase).toBe('objects')
    expect(nextPage.disabled).toBe(false)
    blocked.dispatch('click')
    expect(controller.handle('cancel')).toBe(true)
    expect(controller.getModel().phase).toBe('objects')
  })

  it('garde six cartes visibles, affiche la page ROM et mémorise l’objet entre deux ouvertures', () => {
    installTestDom()
    const root = new TestElement()
    const controller = createSafariDecoratorController(root as unknown as HTMLElement, {
      assets: fakeAssets(),
      messageBanks: messageBanks(),
      objectIds: Array.from({ length: 12 }, (_, objectId) => objectId as HgssSafariObjectId),
      createGraphic: () => new TestElement() as unknown as HTMLElement,
      onSelect: vi.fn(),
      onClose: vi.fn(),
    })
    controller.open()
    expect(descendants(root).filter((element) => element.dataset.safariObject !== undefined && !element.hidden)).toHaveLength(6)
    expect(findControl(root, 'safariPage', 'previous').attributes.get('aria-label')).toBe('1/2')
    expect(findControl(root, 'safariPage', 'next').attributes.get('aria-label')).toBe('2/2')
    controller.handle('page-next')
    expect(controller.getModel().cursor).toBe(6)
    expect(descendants(root).some((element) => element.textContent === '2/2')).toBe(true)
    findControl(root, 'safariObject', '8').dispatch('pointerdown')
    controller.close()
    controller.open()
    expect(controller.getModel().cursor).toBe(8)
    expect(descendants(root).filter((element) => element.dataset.safariObject !== undefined && !element.hidden)).toHaveLength(6)
  })
})
