import {
  createHgssDataOnlyBrowserSaveSlotIfEmpty,
  migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged,
} from '../save/hgssDataOnlySaveStorage'
import {
  deleteHgssBrowserSaveSlotIfStorageUnchanged,
  hgssBrowserSaveSlotCount,
  inspectHgssBrowserSaveSlot,
  type HgssBrowserSaveKind,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
  type HgssBrowserSaveSlotRecord,
} from '../save/hgssSaveStorage'
import type { PreparedHgssStoredSave } from '../save/hgssStoredSavePreparation'
import { prepareHgssStoredSave } from '../save/hgssStoredSavePreparation'
import type { HgssDataOnlySaveDocument } from '../save/hgssDataOnlySaveDocument'
import type { HgssSaveBackupV1 } from '../save/hgssSaveBackup'
import { restoreHgssSaveState } from '../save/hgssSaveState'
import type { RomInventory } from '../../ndsTypes'
import type { TitleMenuCorruptSavePreview, TitleMenuSavePreview } from './titleMenuPresentationModel'

type TitleSaveCatalogStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>
const maximumStableSlotReadAttempts = 4

export type TitleSaveCatalog = Readonly<{
  saves: Map<HgssBrowserSaveSlot, TitleMenuSavePreview>
  documents: Map<HgssBrowserSaveSlot, TitleSaveCatalogDocument>
  corruptSaves: Map<HgssBrowserSaveSlot, TitleMenuCorruptSavePreview>
  warnings: readonly string[]
}>

export type TitleSaveCatalogDocument = Readonly<{
  document: HgssDataOnlySaveDocument
  savedAt: string
  kind: HgssBrowserSaveKind
  storageToken: HgssBrowserSaveSlotDeletionToken
}>

export type TitleSaveCatalogExpectedSlot =
  | Readonly<{ kind: 'empty' }>
  | Readonly<{ kind: 'occupied', storageToken: HgssBrowserSaveSlotDeletionToken }>

/** Reads every raw slot once and keeps malformed storage or payloads visibly occupied. */
export function readTitleSaveCatalog(options: {
  storage: TitleSaveCatalogStorage
  gameCode: string
  prepare: (value: unknown) => PreparedHgssStoredSave
}): TitleSaveCatalog {
  const saves = new Map<HgssBrowserSaveSlot, TitleMenuSavePreview>()
  const documents = new Map<HgssBrowserSaveSlot, TitleSaveCatalogDocument>()
  const corruptSaves = new Map<HgssBrowserSaveSlot, TitleMenuCorruptSavePreview>()
  const warnings: string[] = []
  const markUnavailable = (
    slot: HgssBrowserSaveSlot,
    reason: string,
    deletionToken: HgssBrowserSaveSlotDeletionToken,
  ): void => {
    corruptSaves.set(slot, { reason, deletionToken })
    warnings.push(`Slot ${slot} corrompu : ${reason}`)
  }
  slotLoop: for (let index = 1; index <= hgssBrowserSaveSlotCount; index += 1) {
    const slot = index as HgssBrowserSaveSlot
    for (let attempt = 0; attempt < maximumStableSlotReadAttempts; attempt += 1) {
      const inspection = inspectHgssBrowserSaveSlot(options.storage, options.gameCode, slot)
      if (inspection.kind === 'empty') continue slotLoop
      if (inspection.kind === 'corrupt') {
        markUnavailable(slot, inspection.reason, inspection.deletionToken)
        continue slotLoop
      }
      try {
        const prepared = options.prepare(inspection.record.value)
        if (prepared.migrationRequired || inspection.storageMigrationRequired) {
          migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
            options.storage,
            options.gameCode,
            slot,
            inspection.deletionToken,
            prepared.document,
            inspection.record.kind,
            inspection.record.savedAt,
          )
          // Une migration réussie change elle-même le token. Une migration
          // concurrente signifie qu'un autre onglet a publié un nouveau slot.
          // Dans les deux cas, on repart d'une inspection complète au lieu
          // d'associer le document préparé à des octets observés ensuite.
          continue
        }
        const verification = inspectHgssBrowserSaveSlot(options.storage, options.gameCode, slot)
        if (
          verification.kind !== 'readable'
          || verification.deletionToken !== inspection.deletionToken
        ) continue
        saves.set(slot, {
          restored: prepared.restored,
          savedAt: inspection.record.savedAt,
          kind: inspection.record.kind,
          deletionToken: inspection.deletionToken,
        })
        documents.set(slot, Object.freeze({
          document: prepared.document,
          savedAt: inspection.record.savedAt,
          kind: inspection.record.kind,
          storageToken: inspection.deletionToken,
        }))
        continue slotLoop
      } catch (error) {
        const verification = inspectHgssBrowserSaveSlot(options.storage, options.gameCode, slot)
        if (
          verification.kind !== 'readable'
          || verification.deletionToken !== inspection.deletionToken
        ) continue
        const reason = error instanceof Error
          ? error.message
          : `Le contenu de l’emplacement ${slot} est invalide.`
        markUnavailable(slot, reason, inspection.deletionToken)
        continue slotLoop
      }
    }
    const current = inspectHgssBrowserSaveSlot(options.storage, options.gameCode, slot)
    if (current.kind === 'empty') continue
    if (current.kind === 'corrupt') markUnavailable(slot, current.reason, current.deletionToken)
    else markUnavailable(
      slot,
      `L’emplacement ${slot} change continuellement dans un autre onglet. Réessayez.`,
      current.deletionToken,
    )
  }
  return { saves, documents, corruptSaves, warnings: Object.freeze(warnings) }
}

/**
 * Applique une copie cloud uniquement si le slot observé au début de la
 * réconciliation n’a pas changé entre-temps (autre onglet, staging ou legacy).
 */
export function applyHgssTitleCloudSaveSlot(
  storage: TitleSaveCatalogStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  expected: TitleSaveCatalogExpectedSlot,
  document: HgssDataOnlySaveDocument,
  kind: HgssBrowserSaveKind,
  savedAt: string,
): HgssBrowserSaveSlotRecord {
  const timestamp = new Date(savedAt)
  if (!Number.isFinite(timestamp.getTime()) || timestamp.toISOString() !== savedAt) {
    throw new Error(`L’horodatage cloud de l’emplacement ${slot} est invalide.`)
  }
  if (expected.kind === 'empty') {
    return createHgssDataOnlyBrowserSaveSlotIfEmpty(
      storage,
      gameCode,
      slot,
      document,
      kind,
      () => timestamp,
    )
  }
  const result = migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
    storage,
    gameCode,
    slot,
    expected.storageToken,
    document,
    kind,
    savedAt,
  )
  if (result.kind === 'changed') {
    throw new Error(`L’emplacement ${slot} a changé pendant la synchronisation cloud.`)
  }
  return result.record
}

/** Une suppression distante obéit à la même précondition exacte que l’UI locale. */
export function applyHgssTitleCloudDeletedSlot(
  storage: TitleSaveCatalogStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  expectedToken: HgssBrowserSaveSlotDeletionToken,
): void {
  const result = deleteHgssBrowserSaveSlotIfStorageUnchanged(
    storage,
    gameCode,
    slot,
    expectedToken,
  )
  if (result === 'changed') {
    throw new Error(`L’emplacement ${slot} a changé pendant la synchronisation cloud.`)
  }
}

type HgssTitleSaveInventory = Pick<RomInventory,
  'metadata' | 'pokemonCatalog' | 'itemCatalog' | 'pokedexCatalog' | 'npcTradeCatalog' | 'photoDataCatalog'>

export function prepareHgssTitleStoredSave(
  value: unknown,
  inventory: HgssTitleSaveInventory,
): PreparedHgssStoredSave {
  const gameCode = inventory.metadata.gameCode
  return prepareHgssStoredSave(value, gameCode, (candidate) => restoreHgssSaveState(
    candidate,
    gameCode,
    inventory.pokemonCatalog,
    () => new Date(),
    inventory.itemCatalog,
    inventory.pokedexCatalog,
    {},
    { npcTradeCatalog: inventory.npcTradeCatalog, photoDataCatalog: inventory.photoDataCatalog },
  ))
}

export function readHgssTitleSaveCatalog(
  storage: TitleSaveCatalogStorage,
  inventory: HgssTitleSaveInventory,
): TitleSaveCatalog {
  const gameCode = inventory.metadata.gameCode
  return readTitleSaveCatalog({
    storage,
    gameCode,
    prepare: (value) => prepareHgssTitleStoredSave(value, inventory),
  })
}

export type ImportedHgssTitleSaveBackup = Readonly<{
  document: HgssDataOnlySaveDocument
  record: HgssBrowserSaveSlotRecord
}>

/**
 * Publie un backup déjà décodé via l'unique primitive atomique "si vide".
 * Une corruption, un staging ou une écriture concurrente compte donc comme
 * occupé et n'est jamais remplacé implicitement.
 */
export function importHgssTitleSaveBackupIntoEmptySlot(
  storage: TitleSaveCatalogStorage,
  inventory: HgssTitleSaveInventory,
  slot: HgssBrowserSaveSlot,
  backup: HgssSaveBackupV1,
): ImportedHgssTitleSaveBackup {
  const gameCode = inventory.metadata.gameCode
  if (backup.rom.gameCode !== gameCode) {
    throw new Error(`Ce backup appartient à la ROM ${backup.rom.gameCode}, pas à ${gameCode}.`)
  }
  const prepared = prepareHgssTitleStoredSave(backup.document, inventory)
  if (prepared.migrationRequired) {
    throw new Error('Le backup HGSS ne contient pas un document data-only canonique.')
  }
  const savedAt = new Date(backup.metadata.savedAt)
  const record = createHgssDataOnlyBrowserSaveSlotIfEmpty(
    storage,
    gameCode,
    slot,
    prepared.document,
    backup.metadata.saveKind,
    () => savedAt,
  )
  return Object.freeze({
    document: prepared.document,
    record,
  })
}
