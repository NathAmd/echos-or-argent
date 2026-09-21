import {
  createHgssBrowserSaveSlotIfEmpty,
  migrateHgssBrowserSaveSlotIfStorageUnchanged,
  writeHgssBrowserSaveSlot,
  type HgssBrowserSaveKind,
  type HgssBrowserSaveSlot,
  type HgssBrowserSaveSlotDeletionToken,
  type HgssBrowserSaveSlotMigrationResult,
  type HgssBrowserSaveSlotRecord,
} from './hgssSaveStorage'
import {
  hgssDataOnlySaveAuthority,
  type HgssDataOnlySaveDocument,
} from './hgssDataOnlySaveDocument'

type SaveStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>

function requireOwnedDataOnlySave(
  document: HgssDataOnlySaveDocument,
): asserts document is HgssDataOnlySaveDocument {
  if (!hgssDataOnlySaveAuthority.owns(document)) {
    throw new Error('La sauvegarde locale ne possède pas l’attestation data-only HGSS attendue.')
  }
}

/**
 * Barrière d’écriture des nouveaux slots. Le stockage générique reste séparé
 * pour lire et migrer les anciennes sauvegardes, mais une nouvelle émission
 * doit provenir de l’autorité data-only de cette session.
 */
export function writeHgssDataOnlyBrowserSaveSlot(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  document: HgssDataOnlySaveDocument,
  kind: HgssBrowserSaveKind = 'manual',
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotRecord {
  requireOwnedDataOnlySave(document)
  return writeHgssBrowserSaveSlot(storage, gameCode, slot, document, kind, now)
}

/** Valide la provenance avant même de vérifier si le slot cible est libre. */
export function createHgssDataOnlyBrowserSaveSlotIfEmpty(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  document: HgssDataOnlySaveDocument,
  kind: HgssBrowserSaveKind = 'manual',
  now: () => Date = () => new Date(),
): HgssBrowserSaveSlotRecord {
  requireOwnedDataOnlySave(document)
  return createHgssBrowserSaveSlotIfEmpty(storage, gameCode, slot, document, kind, now)
}

/**
 * Réécrit un slot legacy seulement si ses octets sont encore exactement ceux
 * qui ont été inspectés. L'attestation précède toute mutation du Storage.
 */
export function migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
  storage: SaveStorage,
  gameCode: string,
  slot: HgssBrowserSaveSlot,
  expectedToken: HgssBrowserSaveSlotDeletionToken,
  document: HgssDataOnlySaveDocument,
  kind: HgssBrowserSaveKind,
  savedAt: string,
): HgssBrowserSaveSlotMigrationResult {
  requireOwnedDataOnlySave(document)
  return migrateHgssBrowserSaveSlotIfStorageUnchanged(
    storage,
    gameCode,
    slot,
    expectedToken,
    document,
    kind,
    savedAt,
  )
}
