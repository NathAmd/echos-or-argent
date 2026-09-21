import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import {
  createBrowserRomLoader,
  type BrowserRomLoaderDiagnostic,
  type BrowserRomLoaderOptions,
} from './browserRomLoader'

type TestListener = () => void

class TestDocument {
  createElement(): TestElement {
    return new TestElement(this)
  }
}

class TestElement {
  readonly ownerDocument: TestDocument
  readonly listeners = new Map<string, Set<TestListener>>()
  children: TestElement[] = []
  className = ''
  textContent = ''
  hidden = false

  constructor(ownerDocument: TestDocument) {
    this.ownerDocument = ownerDocument
  }

  addEventListener(type: string, listener: TestListener): void {
    const listeners = this.listeners.get(type) ?? new Set<TestListener>()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: string, listener: TestListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  emit(type: string): void {
    for (const listener of this.listeners.get(type) ?? []) listener()
  }

  replaceChildren(...children: TestElement[]): void {
    this.children = children
  }
}

class TestButton extends TestElement {
  disabled = false

  click(): void {
    this.emit('click')
  }
}

class TestInput extends TestElement {
  files: File[] | null = null
  value = ''
  clickCount = 0

  click(): void {
    this.clickCount += 1
    this.emit('click')
  }
}

function romFile(name: string, size = 4): File {
  return { name, size, type: 'application/octet-stream', lastModified: 1 } as File
}

function romInventory(mapCount = 1): RomInventory {
  return {
    resolvedMapCatalog: {
      maps: Array.from({ length: mapCount }, (_, id) => ({ id })),
    },
  } as unknown as RomInventory
}

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

function fixture(overrides: Partial<BrowserRomLoaderOptions> = {}) {
  const document = new TestDocument()
  const picker = new TestInput(document)
  const chooseRom = new TestButton(document)
  chooseRom.textContent = 'Charger la ROM'
  const status = new TestElement(document)
  const details = new TestElement(document)
  const inventorySection = new TestElement(document)
  const readInventory = vi.fn(async () => romInventory())
  const readCachedFile = vi.fn(async (): Promise<File | undefined> => undefined)
  const cacheFile = vi.fn(async () => undefined)
  const beforeLoad = vi.fn()
  const onInventoryReady = vi.fn()
  const onInvalid = vi.fn()
  const diagnostics: BrowserRomLoaderDiagnostic[] = []
  const elements = {
    picker: picker as unknown as HTMLInputElement,
    chooseRom: chooseRom as unknown as HTMLButtonElement,
    status: status as unknown as HTMLElement,
    details: details as unknown as HTMLElement,
    inventorySection: inventorySection as unknown as HTMLElement,
  }
  const options: BrowserRomLoaderOptions = {
    elements,
    readInventory,
    readCachedFile,
    cacheFile,
    beforeLoad,
    onInventoryReady,
    onInvalid,
    recordDiagnostic: (diagnostic) => { diagnostics.push(diagnostic) },
    now: () => new Date('2026-08-27T12:00:00.000Z'),
    ...overrides,
  }
  const loader = createBrowserRomLoader(options)
  return {
    loader,
    picker,
    chooseRom,
    status,
    details,
    inventorySection,
    readInventory,
    readCachedFile,
    cacheFile,
    beforeLoad,
    onInventoryReady,
    onInvalid,
    diagnostics,
  }
}

describe('createBrowserRomLoader', () => {
  it('preserves the picker loading, inventory activation and local-cache sequence', async () => {
    const loaded = deferred<RomInventory>()
    const readInventory = vi.fn(() => loaded.promise)
    const onInventoryReady = vi.fn(() => undefined)
    const context = fixture({ readInventory, onInventoryReady })
    const file = romFile('heartgold.nds', 128)

    const loading = context.loader.load(file, 'picker')

    expect(context.beforeLoad).toHaveBeenCalledOnce()
    expect(context.chooseRom.disabled).toBe(true)
    expect(context.chooseRom.textContent).toBe('Chargement...')
    expect(context.status.textContent).toBe('Cartographie des archives locales...')
    expect(context.inventorySection.hidden).toBe(true)

    loaded.resolve(romInventory(0))
    await loading

    expect(onInventoryReady).toHaveBeenCalledOnce()
    expect(context.status.textContent).toBe('Archives indexees localement')
    expect(context.cacheFile).toHaveBeenCalledWith(file)
    expect(context.diagnostics).toEqual([{
      target: 'statuses',
      maximumEntries: 80,
      entry: {
        at: '2026-08-27T12:00:00.000Z',
        kind: 'rom-cache-written',
        detail: { name: 'heartgold.nds', size: 128 },
      },
    }])
    expect(context.chooseRom.disabled).toBe(false)
    expect(context.chooseRom.textContent).toBe('Charger la ROM')
  })

  it('keeps a decoded ROM active when only its local cache write fails', async () => {
    const cacheError = new Error('IndexedDB indisponible')
    const cacheFile = vi.fn(async () => { throw cacheError })
    const context = fixture({
      cacheFile,
      onInventoryReady: () => { context.status.textContent = 'ROM chargée' },
    })

    await context.loader.load(romFile('soulsilver.nds'), 'picker')

    expect(context.onInvalid).not.toHaveBeenCalled()
    expect(context.status.textContent).toBe('ROM chargée La ROM fonctionne, mais sa copie locale a échoué.')
    expect(context.diagnostics).toHaveLength(1)
    expect(context.diagnostics[0]).toMatchObject({
      target: 'errors',
      maximumEntries: 40,
      entry: { kind: 'rom-cache-write-error' },
    })
  })

  it('renders the same invalid-ROM state and delegates application cleanup', async () => {
    const failure = new Error('En-tête NDS invalide')
    const context = fixture({ readInventory: async () => { throw failure } })
    context.chooseRom.hidden = true

    await context.loader.load(romFile('broken.nds'), 'picker')

    expect(context.status.textContent).toBe('ROM non validee')
    expect(context.details.children).toHaveLength(2)
    expect(context.details.children[0]).toMatchObject({
      className: 'detail-label error',
      textContent: 'Lecture interrompue',
    })
    expect(context.details.children[1]).toMatchObject({
      className: 'detail-value',
      textContent: 'En-tête NDS invalide',
    })
    expect(context.onInvalid).toHaveBeenCalledWith({
      source: 'picker',
      error: failure,
      message: 'En-tête NDS invalide',
    })
    expect(context.chooseRom.hidden).toBe(false)
    expect(context.chooseRom.disabled).toBe(false)
  })

  it('lets only the newest asynchronous decode activate the inventory', async () => {
    const first = deferred<RomInventory>()
    const second = deferred<RomInventory>()
    const firstFile = romFile('first.nds')
    const secondFile = romFile('second.nds')
    const readInventory = vi.fn((file: File) => file === firstFile ? first.promise : second.promise)
    const context = fixture({ readInventory })

    const firstLoad = context.loader.load(firstFile, 'picker')
    const secondLoad = context.loader.load(secondFile, 'picker')
    first.resolve(romInventory())
    await firstLoad

    expect(context.onInventoryReady).not.toHaveBeenCalled()
    expect(context.cacheFile).not.toHaveBeenCalled()
    expect(context.chooseRom.disabled).toBe(true)

    const latestInventory = romInventory()
    second.resolve(latestInventory)
    await secondLoad

    expect(context.onInventoryReady).toHaveBeenCalledOnce()
    expect(context.onInventoryReady).toHaveBeenCalledWith(latestInventory)
    expect(context.cacheFile).toHaveBeenCalledOnce()
    expect(context.cacheFile).toHaveBeenCalledWith(secondFile)
    expect(context.chooseRom.disabled).toBe(false)
  })

  it('restores a cached ROM only while the host still accepts startup restoration', async () => {
    const cached = romFile('cached.nds')
    const blocked = fixture({
      readCachedFile: async () => cached,
      canRestoreCachedFile: () => false,
    })
    await blocked.loader.restoreCached()
    expect(blocked.readInventory).not.toHaveBeenCalled()

    const accepted = fixture({
      readCachedFile: async () => cached,
      canRestoreCachedFile: () => true,
    })
    await accepted.loader.restoreCached()

    expect(accepted.readInventory).toHaveBeenCalledWith(cached)
    expect(accepted.beforeLoad).toHaveBeenCalledOnce()
    expect(accepted.cacheFile).not.toHaveBeenCalled()
    expect(accepted.onInventoryReady).toHaveBeenCalledOnce()
    expect(accepted.chooseRom.textContent).toBe('Charger la ROM')
  })

  it('reports a cache-read failure without entering the invalid-ROM path', async () => {
    const context = fixture({
      readCachedFile: async () => { throw new Error('lecture IndexedDB refusée') },
    })

    await context.loader.restoreCached()

    expect(context.status.textContent).toBe('La ROM locale n’a pas pu être restaurée. Sélectionne-la pour remplacer la copie.')
    expect(context.onInvalid).not.toHaveBeenCalled()
    expect(context.diagnostics).toHaveLength(1)
    expect(context.diagnostics[0]).toMatchObject({
      target: 'errors',
      maximumEntries: 40,
      entry: { kind: 'rom-cache-read-error' },
    })
  })

  it('owns detachable picker listeners and invalidates work still in flight', async () => {
    const pending = deferred<RomInventory>()
    const readInventory = vi.fn(() => pending.promise)
    const context = fixture({ readInventory })
    const firstFile = romFile('picker.nds')

    context.chooseRom.click()
    expect(context.picker.clickCount).toBe(1)

    context.picker.files = [firstFile]
    context.picker.value = '/fake/picker.nds'
    context.picker.emit('change')
    expect(context.picker.value).toBe('')
    expect(readInventory).toHaveBeenCalledWith(firstFile)

    context.loader.destroy()
    pending.resolve(romInventory())
    await pending.promise
    await Promise.resolve()

    expect(context.onInventoryReady).not.toHaveBeenCalled()
    expect(context.chooseRom.disabled).toBe(false)
    expect(context.chooseRom.textContent).toBe('Charger la ROM')

    context.chooseRom.click()
    context.picker.files = [romFile('ignored.nds')]
    context.picker.emit('change')
    expect(context.picker.clickCount).toBe(1)
    expect(readInventory).toHaveBeenCalledOnce()
  })
})
