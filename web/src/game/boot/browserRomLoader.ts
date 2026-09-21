import type { RomInventory } from '../../ndsTypes'
import { diagnosticErrorDetail } from '../diagnostics/runtimeDiagnosticLog'
import { cacheRomFile, readCachedRomFile } from '../save/romBrowserCache'

export type BrowserRomLoadSource = 'picker' | 'cache'

export type BrowserRomLoadFailure = Readonly<{
  source: BrowserRomLoadSource
  error: unknown
  message: string
}>

export type BrowserRomLoaderDiagnostic = Readonly<{
  target: 'statuses' | 'errors'
  maximumEntries: 80 | 40
  entry: Readonly<{
    at: string
    kind: 'rom-cache-written' | 'rom-cache-write-error' | 'rom-cache-read-error'
    detail: unknown
  }>
}>

export type BrowserRomLoaderElements = Readonly<{
  picker: HTMLInputElement
  chooseRom: HTMLButtonElement
  status: HTMLElement
  details: HTMLElement
  inventorySection: HTMLElement
}>

export type BrowserRomLoaderOptions = Readonly<{
  elements: BrowserRomLoaderElements
  beforeLoad?: () => void
  readInventory?: (file: File) => Promise<RomInventory>
  readCachedFile?: () => Promise<File | undefined>
  cacheFile?: (file: File) => Promise<void>
  shouldCachePickedFile?: () => boolean
  canRestoreCachedFile?: () => boolean
  onInventoryReady: (inventory: RomInventory) => void
  onInvalid: (failure: BrowserRomLoadFailure) => void
  recordDiagnostic?: (diagnostic: BrowserRomLoaderDiagnostic) => void
  now?: () => Date
}>

export type BrowserRomLoader = Readonly<{
  load: (file: File, source: BrowserRomLoadSource) => Promise<void>
  restoreCached: () => Promise<void>
  destroy: () => void
}>

async function readInventoryFromRom(file: File): Promise<RomInventory> {
  const { readRomInventory } = await import('../../nds')
  return readRomInventory(file)
}

/**
 * Owns the browser picker/cache lifecycle while leaving application-state
 * transitions behind explicit ports. A generation token prevents an older
 * asynchronous decode from replacing the latest selected ROM.
 */
export function createBrowserRomLoader(options: BrowserRomLoaderOptions): BrowserRomLoader {
  const { picker, chooseRom, status, details, inventorySection } = options.elements
  const readInventory = options.readInventory ?? readInventoryFromRom
  const readCachedFile = options.readCachedFile ?? readCachedRomFile
  const cacheFile = options.cacheFile ?? cacheRomFile
  const now = options.now ?? (() => new Date())
  let generation = 0
  let destroyed = false

  const recordDiagnostic = (
    target: BrowserRomLoaderDiagnostic['target'],
    maximumEntries: BrowserRomLoaderDiagnostic['maximumEntries'],
    kind: BrowserRomLoaderDiagnostic['entry']['kind'],
    detail: unknown,
  ): void => {
    options.recordDiagnostic?.({
      target,
      maximumEntries,
      entry: { at: now().toISOString(), kind, detail },
    })
  }

  const renderInvalidDetails = (message: string): void => {
    const errorLabel = details.ownerDocument.createElement('span')
    errorLabel.className = 'detail-label error'
    errorLabel.textContent = 'Lecture interrompue'
    const errorMessage = details.ownerDocument.createElement('span')
    errorMessage.className = 'detail-value'
    errorMessage.textContent = message
    details.replaceChildren(errorLabel, errorMessage)
  }

  const load = async (file: File, source: BrowserRomLoadSource): Promise<void> => {
    if (destroyed) return
    options.beforeLoad?.()
    const activeGeneration = ++generation
    chooseRom.disabled = true
    chooseRom.textContent = source === 'cache' ? 'Restauration...' : 'Chargement...'
    status.textContent = source === 'cache' ? 'Restauration de la ROM locale…' : 'Cartographie des archives locales...'
    inventorySection.hidden = true

    try {
      const inventory = await readInventory(file)
      if (destroyed || activeGeneration !== generation) return
      options.onInventoryReady(inventory)
      if (inventory.resolvedMapCatalog.maps.length === 0) status.textContent = 'Archives indexees localement'
      if (source === 'picker' && (options.shouldCachePickedFile?.() ?? true)) {
        try {
          await cacheFile(file)
          recordDiagnostic('statuses', 80, 'rom-cache-written', {
            name: file.name,
            size: file.size,
          })
        } catch (error) {
          recordDiagnostic('errors', 40, 'rom-cache-write-error', diagnosticErrorDetail(error))
          status.textContent = `${status.textContent} La ROM fonctionne, mais sa copie locale a échoué.`
        }
      }
    } catch (error) {
      if (destroyed || activeGeneration !== generation) return
      const message = error instanceof Error ? error.message : 'Impossible de lire ce fichier.'
      status.textContent = source === 'cache' ? 'ROM locale non restaurée' : 'ROM non validee'
      renderInvalidDetails(message)
      options.onInvalid({ source, error, message })
      chooseRom.hidden = false
    } finally {
      if (!destroyed && activeGeneration === generation) {
        chooseRom.disabled = false
        chooseRom.textContent = 'Charger la ROM'
      }
    }
  }

  const restoreCached = async (): Promise<void> => {
    if (destroyed) return
    try {
      const cachedRom = await readCachedFile()
      if (destroyed) return
      if (cachedRom && (options.canRestoreCachedFile?.() ?? true)) await load(cachedRom, 'cache')
    } catch (error) {
      if (destroyed) return
      recordDiagnostic('errors', 40, 'rom-cache-read-error', diagnosticErrorDetail(error))
      status.textContent = 'La ROM locale n’a pas pu être restaurée. Sélectionne-la pour remplacer la copie.'
    }
  }

  const handleChooseRom = (): void => { picker.click() }
  const handlePickerChange = (): void => {
    const file = picker.files?.[0]
    picker.value = ''
    if (file) void load(file, 'picker')
  }

  chooseRom.addEventListener('click', handleChooseRom)
  picker.addEventListener('change', handlePickerChange)

  const destroy = (): void => {
    if (destroyed) return
    destroyed = true
    generation += 1
    chooseRom.removeEventListener('click', handleChooseRom)
    picker.removeEventListener('change', handlePickerChange)
    chooseRom.disabled = false
    chooseRom.textContent = 'Charger la ROM'
  }

  return { load, restoreCached, destroy }
}
