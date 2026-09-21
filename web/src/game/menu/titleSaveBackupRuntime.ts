import type { RomInventory } from '../../ndsTypes'
import {
  createHgssSaveBackup,
  createHgssSaveBackupFileName,
  hgssSaveBackupMaximumBytes,
  parseHgssSaveBackup,
  serializeHgssSaveBackup,
} from '../save/hgssSaveBackup'
import {
  inspectHgssBrowserSaveSlot,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotRecord,
} from '../save/hgssSaveStorage'
import type { HgssDataOnlySaveDocument } from '../save/hgssStoredSavePreparation'
import type { TitleSaveBackupFilePort } from './browserTitleSaveBackupFiles'
import {
  importHgssTitleSaveBackupIntoEmptySlot,
  readHgssTitleSaveCatalog,
  type TitleSaveCatalog,
} from './titleSaveCatalog'

type BackupStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'> & Partial<{
  getScope: () => unknown
}>

export type ImportedTitleSaveBackup = Readonly<{
  slot: HgssBrowserSaveSlot
  catalog?: TitleSaveCatalog
  document: HgssDataOnlySaveDocument
  record: HgssBrowserSaveSlotRecord
}>

export type TitleSaveBackupRuntime = Readonly<{
  exportSlot: (slot: HgssBrowserSaveSlot) => Promise<void>
  importIntoSlot: (slot: HgssBrowserSaveSlot) => Promise<void>
  isBusy: () => boolean
  cancel: () => void
}>

export function createTitleSaveBackupRuntime(options: {
  storage: BackupStorage
  readInventory: () => RomInventory | undefined
  files: TitleSaveBackupFilePort
  reportStatus: (message: string) => void
  onCatalogRefreshed?: (catalog: TitleSaveCatalog) => void
  onImported?: (result: ImportedTitleSaveBackup) => void
  noteSaved?: (
    slot: HgssBrowserSaveSlot,
    document: HgssDataOnlySaveDocument,
    record: HgssBrowserSaveSlotRecord,
  ) => void
  onBusyChange?: (busy: boolean) => void
  now?: () => Date
}): TitleSaveBackupRuntime {
  const now = options.now ?? (() => new Date())
  let busy = false
  let revision = 0

  const begin = (): number | undefined => {
    if (busy) {
      options.reportStatus('Une opération de backup est déjà en cours.')
      return undefined
    }
    busy = true
    options.onBusyChange?.(true)
    return ++revision
  }
  const finish = (operation: number): void => {
    if (operation !== revision) return
    busy = false
    options.onBusyChange?.(false)
  }
  const isCurrent = (operation: number, inventory: RomInventory, scope: unknown): boolean => (
    operation === revision
    && options.readInventory() === inventory
    && options.storage.getScope?.() === scope
  )
  const failureMessage = (error: unknown): string => error instanceof Error
    ? error.message
    : 'Le fichier de backup HGSS est invalide.'

  return Object.freeze({
    async exportSlot(slot) {
      const operation = begin()
      if (operation === undefined) return
      try {
        const inventory = options.readInventory()
        if (!inventory) throw new Error('La ROM doit être chargée avant un export.')
        const scope = options.storage.getScope?.()
        const catalog = readHgssTitleSaveCatalog(options.storage, inventory)
        if (!isCurrent(operation, inventory, scope)) return
        options.onCatalogRefreshed?.(catalog)
        const saved = catalog.documents.get(slot)
        if (!saved) {
          if (catalog.corruptSaves.has(slot)) {
            throw new Error(`L’emplacement ${slot} est corrompu et ne peut pas être exporté.`)
          }
          throw new Error(`L’emplacement ${slot} est vide.`)
        }
        const backup = createHgssSaveBackup({
          gameCode: inventory.metadata.gameCode,
          sourceSlot: slot,
          saveKind: saved.kind,
          savedAt: saved.savedAt,
          exportedAt: now().toISOString(),
          document: saved.document,
        })
        const serialized = serializeHgssSaveBackup(backup)
        const written = await options.files.saveJson(
          createHgssSaveBackupFileName(backup),
          serialized,
        )
        if (!isCurrent(operation, inventory, scope)) return
        options.reportStatus(written
          ? `Backup de l’emplacement ${slot} exporté.`
          : `Export de l’emplacement ${slot} annulé.`)
      } catch (error) {
        if (operation === revision) options.reportStatus(`Export impossible : ${failureMessage(error)}`)
      } finally {
        finish(operation)
      }
    },
    async importIntoSlot(slot) {
      const operation = begin()
      if (operation === undefined) return
      try {
        const inventory = options.readInventory()
        if (!inventory) throw new Error('La ROM doit être chargée avant un import.')
        const scope = options.storage.getScope?.()
        const gameCode = inventory.metadata.gameCode
        if (inspectHgssBrowserSaveSlot(options.storage, gameCode, slot).kind !== 'empty') {
          throw new Error(`L’emplacement ${slot} est occupé, même si ses données sont illisibles.`)
        }
        const file = await options.files.pickJson()
        if (!isCurrent(operation, inventory, scope)) return
        if (!file) {
          options.reportStatus(`Import vers l’emplacement ${slot} annulé.`)
          return
        }
        if (!Number.isSafeInteger(file.size) || file.size < 1 || file.size > hgssSaveBackupMaximumBytes) {
          throw new Error('Le fichier dépasse la limite de 1 Mio.')
        }
        const serialized = await file.readText()
        if (!isCurrent(operation, inventory, scope)) return
        const backup = parseHgssSaveBackup(serialized)
        const imported = importHgssTitleSaveBackupIntoEmptySlot(
          options.storage,
          inventory,
          slot,
          backup,
        )
        let observerFailed = false
        const notify = (callback: (() => void) | undefined): void => {
          if (!callback) return
          try { callback() } catch { observerFailed = true }
        }
        notify(options.noteSaved
          ? () => options.noteSaved?.(slot, imported.document, imported.record)
          : undefined)
        let catalog: TitleSaveCatalog | undefined
        try { catalog = readHgssTitleSaveCatalog(options.storage, inventory) }
        catch { observerFailed = true }
        if (catalog) notify(options.onCatalogRefreshed
          ? () => options.onCatalogRefreshed?.(catalog)
          : undefined)
        notify(options.onImported
          ? () => options.onImported?.(Object.freeze({ slot, ...imported, ...(catalog ? { catalog } : {}) }))
          : undefined)
        options.reportStatus(observerFailed
          ? `Backup importé dans l’emplacement ${slot}, mais son affichage ou sa synchronisation devra être relancé. Aucune sauvegarde existante n’a été remplacée.`
          : `Backup importé dans l’emplacement ${slot}. Aucune sauvegarde existante n’a été remplacée.`)
      } catch (error) {
        if (operation === revision) options.reportStatus(`Import impossible : ${failureMessage(error)}`)
      } finally {
        finish(operation)
      }
    },
    isBusy: () => busy,
    cancel() {
      revision += 1
      if (busy) options.onBusyChange?.(false)
      busy = false
    },
  })
}
