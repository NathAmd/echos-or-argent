import { describe, expect, it, vi } from 'vitest'
import type { RomInventory } from '../../ndsTypes'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority } from '../save/hgssDataOnlySaveDocument'
import { writeHgssDataOnlyBrowserSaveSlot } from '../save/hgssDataOnlySaveStorage'
import {
  createHgssSaveBackup,
  parseHgssSaveBackup,
  serializeHgssSaveBackup,
} from '../save/hgssSaveBackup'
import { createHgssSaveState } from '../save/hgssSaveState'
import {
  getHgssSaveSlotStorageKey,
  inspectHgssBrowserSaveSlot,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSaveSlot,
} from '../save/hgssSaveStorage'
import type { TitleSaveBackupFilePort } from './browserTitleSaveBackupFiles'
import { createTitleSaveBackupRuntime } from './titleSaveBackupRuntime'
import { createSwitchableTitleSaveStorage } from './titleSaveStorageScope'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const savedAt = '2026-09-07T12:00:00.000Z'

function createInventory(gameCode = 'IPKF'): RomInventory {
  return {
    metadata: { gameCode },
    pokemonCatalog: createPokemonTestCatalog(),
  } as unknown as RomInventory
}

function createDocument(gameCode = 'IPKF', name = 'LUTH') {
  const language = gameCode.endsWith('F') ? 3 : 2
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    gameCode,
    { gender: 'male', name, trainerId: 0x12345678, gameVersion: 7, language },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', name),
  ))
}

function serializedBackup(gameCode = 'IPKF'): string {
  return serializeHgssSaveBackup(createHgssSaveBackup({
    gameCode,
    sourceSlot: 1,
    saveKind: 'auto',
    savedAt,
    exportedAt: '2026-09-07T12:05:00.000Z',
    document: createDocument(gameCode),
  }))
}

function picked(contents: string) {
  return {
    name: 'save.json',
    size: new TextEncoder().encode(contents).byteLength,
    readText: vi.fn(async () => contents),
  }
}

function createRuntime(options: {
  storage?: MemoryStorage | ReturnType<typeof createSwitchableTitleSaveStorage>
  inventory?: RomInventory
  files: TitleSaveBackupFilePort
  noteSaved?: Parameters<typeof createTitleSaveBackupRuntime>[0]['noteSaved']
}) {
  const storage = options.storage ?? new MemoryStorage()
  const inventory = options.inventory ?? createInventory()
  const reportStatus = vi.fn()
  const onCatalogRefreshed = vi.fn()
  const onImported = vi.fn()
  const runtime = createTitleSaveBackupRuntime({
    storage,
    readInventory: () => inventory,
    files: options.files,
    reportStatus,
    onCatalogRefreshed,
    onImported,
    noteSaved: options.noteSaved,
    now: () => new Date('2026-09-07T12:05:00.000Z'),
  })
  return { runtime, storage, reportStatus, onCatalogRefreshed, onImported }
}

describe('runtime de backup du catalogue titre', () => {
  it('exporte le document stable du slot avec ses métadonnées', async () => {
    const storage = new MemoryStorage()
    writeHgssDataOnlyBrowserSaveSlot(
      storage,
      'IPKF',
      2,
      createDocument(),
      'manual',
      () => new Date(savedAt),
    )
    const saveJson = vi.fn(async (fileName: string, contents: string) => (
      fileName.length > 0 && contents.length > 0
    ))
    const view = createRuntime({
      storage,
      files: { pickJson: vi.fn(), saveJson },
    })

    await view.runtime.exportSlot(2)

    expect(saveJson).toHaveBeenCalledOnce()
    const [fileName, contents] = saveJson.mock.calls[0]!
    expect(fileName).toContain('IPKF-slot-2')
    expect(parseHgssSaveBackup(contents)).toMatchObject({
      metadata: { sourceSlot: 2, saveKind: 'manual', savedAt },
      rom: { gameCode: 'IPKF', gameVersion: 7, language: 3 },
    })
    expect(view.reportStatus).toHaveBeenLastCalledWith('Backup de l’emplacement 2 exporté.')
  })

  it('importe vers le scope compte sélectionné, préserve la date et notifie le cloud', async () => {
    const physicalStorage = new MemoryStorage()
    const selectedStorage = createSwitchableTitleSaveStorage(physicalStorage)
    selectedStorage.selectOnline('https://save.example.test', 'alice')
    const contents = serializedBackup()
    const noteSaved = vi.fn()
    const view = createRuntime({
      storage: selectedStorage,
      files: { pickJson: vi.fn(async () => picked(contents)), saveJson: vi.fn() },
      noteSaved,
    })

    await view.runtime.importIntoSlot(3)

    expect(readHgssBrowserSaveSlot(selectedStorage, 'IPKF', 3)).toMatchObject({
      slot: 3,
      savedAt,
      kind: 'auto',
    })
    expect(noteSaved).toHaveBeenCalledOnce()
    expect(noteSaved).toHaveBeenCalledWith(3, expect.any(Object), expect.objectContaining({ savedAt }))
    expect(view.onCatalogRefreshed).toHaveBeenCalledOnce()
    expect(view.onImported).toHaveBeenCalledWith(expect.objectContaining({ slot: 3 }))
    selectedStorage.selectLocal()
    expect(inspectHgssBrowserSaveSlot(selectedStorage, 'IPKF', 3).kind).toBe('empty')
  })

  it('ne lit aucun fichier lorsque le slot est corrompu et conserve ses octets', async () => {
    const storage = new MemoryStorage()
    const key = getHgssSaveSlotStorageKey('IPKF', 1)
    storage.values.set(key, '{cassé')
    const pickJson = vi.fn(async () => picked(serializedBackup()))
    const view = createRuntime({ storage, files: { pickJson, saveJson: vi.fn() } })

    await view.runtime.importIntoSlot(1)

    expect(pickJson).not.toHaveBeenCalled()
    expect(storage.values.get(key)).toBe('{cassé')
    expect(view.reportStatus).toHaveBeenLastCalledWith(expect.stringContaining('occupé'))
  })

  it('refuse atomiquement un slot rempli pendant le sélecteur de fichier', async () => {
    const storage = new MemoryStorage()
    const concurrent = { owner: 'autre onglet' }
    const contents = serializedBackup()
    const view = createRuntime({
      storage,
      files: {
        pickJson: vi.fn(async () => {
          writeHgssBrowserSaveSlot(storage, 'IPKF', 2, concurrent)
          return picked(contents)
        }),
        saveJson: vi.fn(),
      },
    })

    await view.runtime.importIntoSlot(2)

    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 2)?.value).toEqual(concurrent)
    expect(view.onImported).not.toHaveBeenCalled()
    expect(view.reportStatus).toHaveBeenLastCalledWith(expect.stringContaining('déjà occupé'))
  })

  it('annule l’import si le scope de stockage change pendant le sélecteur', async () => {
    const physicalStorage = new MemoryStorage()
    const selectedStorage = createSwitchableTitleSaveStorage(physicalStorage)
    selectedStorage.selectOnline('https://save.example.test', 'alice')
    const view = createRuntime({
      storage: selectedStorage,
      files: {
        pickJson: vi.fn(async () => {
          selectedStorage.selectLocal()
          return picked(serializedBackup())
        }),
        saveJson: vi.fn(),
      },
    })

    await view.runtime.importIntoSlot(1)

    expect(inspectHgssBrowserSaveSlot(selectedStorage, 'IPKF', 1).kind).toBe('empty')
    expect(view.onImported).not.toHaveBeenCalled()
  })

  it('annonce le commit irréversible même si tous les observateurs échouent ensuite', async () => {
    const storage = new MemoryStorage()
    const inventory = createInventory()
    const contents = serializedBackup()
    const reportStatus = vi.fn()
    const noteSaved = vi.fn(() => { throw new Error('cloud indisponible') })
    const onCatalogRefreshed = vi.fn(() => { throw new Error('vue indisponible') })
    const onImported = vi.fn(() => { throw new Error('observateur indisponible') })
    const runtime = createTitleSaveBackupRuntime({
      storage,
      readInventory: () => inventory,
      files: { pickJson: vi.fn(async () => picked(contents)), saveJson: vi.fn() },
      reportStatus,
      noteSaved,
      onCatalogRefreshed,
      onImported,
    })

    await runtime.importIntoSlot(1)

    expect(inspectHgssBrowserSaveSlot(storage, 'IPKF', 1).kind).toBe('readable')
    expect(noteSaved).toHaveBeenCalledOnce()
    expect(onCatalogRefreshed).toHaveBeenCalledOnce()
    expect(onImported).toHaveBeenCalledOnce()
    expect(reportStatus).toHaveBeenLastCalledWith(expect.stringMatching(/^Backup importé/))
    expect(reportStatus).not.toHaveBeenCalledWith(expect.stringMatching(/^Import impossible/))
  })

  it('rejette une autre identité ROM et les fichiers surdimensionnés avant mutation', async () => {
    const storage = new MemoryStorage()
    const wrongRom = serializedBackup('IPKE')
    const oversized = picked(wrongRom)
    Object.defineProperty(oversized, 'size', { value: 1024 * 1024 + 1 })
    const files = {
      pickJson: vi.fn()
        .mockResolvedValueOnce(oversized)
        .mockResolvedValueOnce(picked(wrongRom)),
      saveJson: vi.fn(),
    }
    const view = createRuntime({ storage, files })

    await view.runtime.importIntoSlot(1)
    expect(oversized.readText).not.toHaveBeenCalled()
    await view.runtime.importIntoSlot(1)

    expect(inspectHgssBrowserSaveSlot(storage, 'IPKF', 1).kind).toBe('empty')
    expect(view.onImported).not.toHaveBeenCalled()
    expect(view.reportStatus.mock.calls.flat().join(' ')).toContain('limite de 1 Mio')
    expect(view.reportStatus).toHaveBeenLastCalledWith(expect.stringContaining('IPKE'))
  })
})
