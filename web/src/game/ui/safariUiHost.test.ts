import { describe, expect, it, vi } from 'vitest'
import type { HgssSafariUiAssets } from '../../rom/safari/safariUiAssets'
import type { HgssSafariObjectCategoryCounts } from '../safari/hgssSafariState'
import type {
  SafariCustomizerController,
  SafariCustomizerControllerOptions,
  SafariDecoratorController,
  SafariDecoratorControllerOptions,
} from './safariUiController'
import { createSafariUiHost } from './safariUiHost'

function fixture() {
  let customizerOptions: SafariCustomizerControllerOptions | undefined
  let decoratorOptions: SafariDecoratorControllerOptions | undefined
  const customizer = {
    open: vi.fn(),
    close: vi.fn(),
    isOpen: vi.fn(() => false),
    handle: vi.fn(() => true),
    getModel: vi.fn(),
  } as unknown as SafariCustomizerController
  const decorator = {
    open: vi.fn(),
    close: vi.fn(),
    isOpen: vi.fn(() => false),
    handle: vi.fn(() => true),
    getModel: vi.fn(),
  } as unknown as SafariDecoratorController
  const onResume = vi.fn()
  const onStateChange = vi.fn()
  const assets = {} as HgssSafariUiAssets
  const messageBanks = {}
  const host = createSafariUiHost({
    customizerRoot: {} as HTMLElement,
    decoratorRoot: {} as HTMLElement,
    readResources: () => ({ assets, messageBanks, createGraphic: vi.fn() }),
    onResume,
    onStateChange,
    controllerFactories: {
      customizer: (_root, options) => {
        customizerOptions = options
        return customizer
      },
      decorator: (_root, options) => {
        decoratorOptions = options
        return decorator
      },
    },
  })
  return {
    host,
    customizer,
    decorator,
    onResume,
    onStateChange,
    getCustomizerOptions: () => customizerOptions!,
    getDecoratorOptions: () => decoratorOptions!,
  }
}

describe('Safari UI field-app host', () => {
  it('keeps one Customizer suspension alive across commits, then resumes only on Retour', () => {
    const view = fixture()
    const submitSafariCustomizerChange = vi.fn()
    const closeSafariCustomizer = vi.fn()
    const blockCounts: readonly [
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
      HgssSafariObjectCategoryCounts,
    ] = [[1, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]]
    view.host.present({
      kind: 'safariCustomizer',
      areas: [0, 1, 2, 3, 4, 5],
      blockCounts,
      showBlockCounts: true,
    }, {
      submitSafariCustomizerChange,
      closeSafariCustomizer,
    })
    expect(view.customizer.open).toHaveBeenCalledWith([0, 1, 2, 3, 4, 5], blockCounts, true)
    expect(view.host.getKind()).toBe('safariCustomizer')

    const change = {
      areas: [6, 1, 2, 3, 4, 5] as const,
      sourceSlot: 0 as const,
      targetAreaId: 6 as const,
      operation: 'replace' as const,
    }
    view.getCustomizerOptions().onCommit(change)
    expect(submitSafariCustomizerChange).toHaveBeenCalledWith(change)
    expect(view.onResume).not.toHaveBeenCalled()
    expect(view.host.isOpen()).toBe(true)

    view.getCustomizerOptions().onClose()
    expect(closeSafariCustomizer).toHaveBeenCalledOnce()
    expect(view.onResume).toHaveBeenCalledOnce()
    expect(view.host.isOpen()).toBe(false)
  })

  it('forwards every native Decorator candidate and resumes with the selected object', () => {
    const view = fixture()
    const submitSafariDecoratorSelection = vi.fn()
    view.host.present({
      kind: 'safariDecorator',
      candidates: [
        { objectId: 6, unavailableReason: 1 },
        { objectId: 10, placement: { objectId: 10, x: 2, y: 0, z: 3 } },
      ],
    }, { submitSafariDecoratorSelection })
    expect(view.decorator.open).toHaveBeenCalledWith([
      { objectId: 6, unavailableReason: 1 },
      { objectId: 10, unavailableReason: undefined },
    ])

    view.getDecoratorOptions().onSelect(10)
    expect(submitSafariDecoratorSelection).toHaveBeenCalledWith(10)
    expect(view.decorator.close).toHaveBeenCalled()
    expect(view.onResume).toHaveBeenCalledOnce()
    expect(view.host.isOpen()).toBe(false)
  })

  it('consomme Menu sans fermer les overlays et valide les capacités du runner à la frontière', () => {
    const view = fixture()
    expect(() => view.host.present({
      kind: 'safariCustomizer',
      areas: [0, 1, 2, 3, 4, 5],
      blockCounts: [[0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      showBlockCounts: false,
    }, {})).toThrow(
      'submitSafariCustomizerChange',
    )

    view.host.present({ kind: 'safariDecorator', candidates: [] }, {
      submitSafariDecoratorSelection: vi.fn(),
    })
    expect(view.host.handle('menu')).toBe(true)
    expect(view.decorator.handle).not.toHaveBeenCalled()
  })
})
