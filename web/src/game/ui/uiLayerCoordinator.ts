export type UiLayerDefinition = {
  id: string
  priority: number
  selectors: readonly string[]
  blocksBackground?: boolean
}

export type UiLayerCoordinator = {
  sync: () => void
  getActiveLayer: () => string | undefined
  disconnect: () => void
}

type UiLayerObserver = {
  observe: (target: Node, options?: MutationObserverInit) => void
  disconnect: () => void
}

type UiLayerCoordinatorOptions = {
  definitions?: readonly UiLayerDefinition[]
  createObserver?: (onChange: () => void) => UiLayerObserver
}

type ElementBaseline = {
  inert: boolean
  ariaHidden: string | null
  visibility: string
  visibilityPriority: string
}

type ManagedLayer = UiLayerDefinition & { roots: HTMLElement[] }

const appUiLayers: readonly UiLayerDefinition[] = [
  { id: 'chrome', priority: -10, selectors: ['#game-menu-button', '#fullscreen-button'], blocksBackground: false },
  { id: 'hud', priority: 0, selectors: ['#in-game-hud'], blocksBackground: false },
  { id: 'game-menu', priority: 10, selectors: ['#game-menu'] },
  { id: 'dialogue', priority: 20, selectors: ['#field-dialogue', '#field-choice', '.field-pokemon-portrait'] },
  { id: 'field-number', priority: 30, selectors: ['#field-number'] },
  { id: 'field-nickname', priority: 31, selectors: ['#field-nickname'] },
  { id: 'field-easy-chat', priority: 32, selectors: ['#field-easy-chat'] },
  { id: 'field-frontier-records', priority: 33, selectors: ['#field-frontier-records'] },
  { id: 'field-pokeathlon', priority: 34, selectors: ['#field-pokeathlon'] },
  { id: 'field-alph-puzzle', priority: 35, selectors: ['#field-alph-puzzle'] },
  { id: 'field-alph-inscription', priority: 36, selectors: ['#field-alph-inscription'] },
  { id: 'safari-customizer', priority: 37, selectors: ['#safari-customizer'] },
  { id: 'safari-decorator', priority: 38, selectors: ['#safari-decorator'] },
  { id: 'pc-box', priority: 40, selectors: ['#pc-box'] },
  { id: 'battle', priority: 50, selectors: ['#battle-screen'] },
  { id: 'confirmation', priority: 60, selectors: ['#modal-confirm'] },
  { id: 'bug-report', priority: 70, selectors: ['#bug-report-modal'] },
  { id: 'title-save-delete', priority: 72, selectors: ['.title-save-delete-overlay'] },
  { id: 'new-game-plus', priority: 74, selectors: ['.new-game-plus-creation', '.new-game-plus-unlock'] },
  { id: 'multiplayer', priority: 80, selectors: ['.multiplayer-overlay'] },
  { id: 'title-account', priority: 90, selectors: ['.title-account-gate'] },
  { id: 'text-entry', priority: 100, selectors: ['.game-text-entry-overlay'] },
]

const focusableSelectors = [
  'button[aria-current="true"]:not([disabled])',
  'button[aria-selected="true"]:not([disabled])',
  'input:not([disabled])',
  'textarea:not([disabled])',
  'select:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
  'button:not([disabled]):not([tabindex="-1"])',
] as const

function captureBaseline(element: HTMLElement): ElementBaseline {
  return {
    inert: element.inert,
    ariaHidden: element.getAttribute('aria-hidden'),
    visibility: element.style.getPropertyValue('visibility'),
    visibilityPriority: element.style.getPropertyPriority('visibility'),
  }
}

function restoreBaseline(element: HTMLElement, baseline: ElementBaseline): void {
  element.inert = baseline.inert
  if (baseline.ariaHidden === null) element.removeAttribute('aria-hidden')
  else element.setAttribute('aria-hidden', baseline.ariaHidden)
  restoreVisibility(element, baseline)
}

function restoreVisibility(element: HTMLElement, baseline: ElementBaseline): void {
  if (baseline.visibility === '') element.style.removeProperty('visibility')
  else element.style.setProperty('visibility', baseline.visibility, baseline.visibilityPriority)
}

function activateElement(element: HTMLElement, baseline: ElementBaseline): void {
  element.inert = false
  element.removeAttribute('aria-hidden')
  restoreVisibility(element, baseline)
}

function suppressElement(element: HTMLElement, hideVisually: boolean): void {
  element.inert = true
  element.setAttribute('aria-hidden', 'true')
  if (hideVisually) element.style.setProperty('visibility', 'hidden', 'important')
}

export function createUiLayerCoordinator(host: HTMLElement, options: UiLayerCoordinatorOptions = {}): UiLayerCoordinator {
  const definitions = options.definitions ?? appUiLayers
  const layers: ManagedLayer[] = definitions.map((definition) => ({ ...definition, roots: [] }))
  const baselines = new Map<HTMLElement, ElementBaseline>()
  const observedRoots = new Set<HTMLElement>()
  const observerState: { current?: UiLayerObserver } = {}
  const reconcileChildren = (): void => {
    for (const [element, baseline] of baselines) {
      if (element.parentElement === host) continue
      restoreBaseline(element, baseline)
      baselines.delete(element)
    }
    for (const child of host.children) {
      if ('inert' in child && !baselines.has(child as HTMLElement)) baselines.set(child as HTMLElement, captureBaseline(child as HTMLElement))
    }
    for (const layer of layers) {
      layer.roots = layer.selectors.flatMap((selector) => {
        const root = host.querySelector<HTMLElement>(selector)
        return root?.parentElement === host ? [root] : []
      })
      for (const root of layer.roots) {
        if (observedRoots.has(root)) continue
        observedRoots.add(root)
        observerState.current?.observe(root, { attributes: true, attributeFilter: ['hidden'] })
      }
    }
  }
  let activeLayer: ManagedLayer | undefined

  const syncFocus = (): void => {
    if (!activeLayer || activeLayer.blocksBackground === false) return
    const visibleRoots = activeLayer.roots.filter((root) => !root.hidden)
    const current = host.ownerDocument.activeElement
    if (current && visibleRoots.some((root) => root.contains(current))) return
    const target = focusableSelectors
      .map((selector) => visibleRoots.map((root) => root.querySelector<HTMLElement>(selector)).find(Boolean))
      .find(Boolean)
    target?.focus({ preventScroll: true })
  }

  const sync = (): void => {
    reconcileChildren()
    activeLayer = layers
      .filter(({ roots }) => roots.some((root) => !root.hidden))
      .sort((left, right) => right.priority - left.priority)[0]
    const activeRoots = new Set(activeLayer?.roots.filter((root) => !root.hidden) ?? [])
    const managedRoots = new Set(layers.flatMap(({ roots }) => roots))
    const blocksBackground = activeLayer?.blocksBackground !== false && activeLayer !== undefined
    for (const [element, baseline] of baselines) {
      const active = activeRoots.has(element)
      if (active) activateElement(element, baseline)
      else if (!blocksBackground) restoreBaseline(element, baseline)
      else suppressElement(element, managedRoots.has(element) && !element.hidden)
    }
    syncFocus()
  }

  const createObserver = options.createObserver ?? ((onChange: () => void): UiLayerObserver => new MutationObserver(onChange))
  const observer = createObserver(sync)
  observerState.current = observer
  observer.observe(host, { childList: true })
  sync()

  return {
    sync,
    getActiveLayer: () => activeLayer?.id,
    disconnect: () => {
      observer.disconnect()
      baselines.forEach((baseline, element) => restoreBaseline(element, baseline))
      activeLayer = undefined
    },
  }
}
