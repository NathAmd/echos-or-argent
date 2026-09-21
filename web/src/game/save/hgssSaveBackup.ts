import {
  decodeHgssStoredDataOnlySave,
  ownsHgssStoredDataOnlySave,
  type HgssDataOnlySaveDocument,
} from './hgssStoredSavePreparation'
import type { HgssBrowserSaveKind, HgssBrowserSaveSlot } from './hgssSaveStorage'

export const hgssSaveBackupFormat = 'pokemaster-hgss-save-backup'
export const hgssSaveBackupVersion = 1
export const hgssSaveBackupMaximumBytes = 1024 * 1024

export type HgssSaveBackupRomIdentity = Readonly<{
  gameCode: string
  gameVersion: number
  language: number
}>

export type HgssSaveBackupMetadata = Readonly<{
  sourceSlot: HgssBrowserSaveSlot
  saveKind: HgssBrowserSaveKind
  savedAt: string
  exportedAt: string
}>

export type HgssSaveBackupV1 = Readonly<{
  format: typeof hgssSaveBackupFormat
  version: typeof hgssSaveBackupVersion
  rom: HgssSaveBackupRomIdentity
  metadata: HgssSaveBackupMetadata
  document: HgssDataOnlySaveDocument
}>

function requirePlainRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} doit être un objet JSON exact.`)
  }
  if (Object.getPrototypeOf(value) !== Object.prototype) {
    throw new Error(`${label} doit être un objet JSON simple.`)
  }
  return value as Record<string, unknown>
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort()
  const canonical = [...expected].sort()
  if (
    actual.length !== canonical.length
    || !actual.every((key, index) => key === canonical[index])
  ) throw new Error(`${label} contient des champs inconnus ou manquants.`)
}

function requireByte(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 0xff) {
    throw new Error(`${label} doit être un entier sur 8 bits.`)
  }
  return value as number
}

function requireSlot(value: unknown): HgssBrowserSaveSlot {
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 3) {
    throw new Error('Le slot source du backup HGSS doit être compris entre 1 et 3.')
  }
  return value as HgssBrowserSaveSlot
}

function requireTimestamp(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length > 32) {
    throw new Error(`${label} doit être une date ISO canonique.`)
  }
  const date = new Date(value)
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== value) {
    throw new Error(`${label} doit être une date ISO canonique.`)
  }
  return value
}

function requireSaveKind(value: unknown): HgssBrowserSaveKind {
  if (value !== 'manual' && value !== 'auto') {
    throw new Error('Le type de sauvegarde du backup HGSS est invalide.')
  }
  return value
}

function requireRomIdentity(value: unknown): HgssSaveBackupRomIdentity {
  const rom = requirePlainRecord(value, 'L’identité ROM du backup HGSS')
  requireExactKeys(rom, ['gameCode', 'gameVersion', 'language'], 'L’identité ROM du backup HGSS')
  if (typeof rom.gameCode !== 'string' || !/^[A-Z0-9]{4}$/.test(rom.gameCode)) {
    throw new Error('Le code ROM du backup HGSS est invalide.')
  }
  return Object.freeze({
    gameCode: rom.gameCode,
    gameVersion: requireByte(rom.gameVersion, 'La version ROM du backup HGSS'),
    language: requireByte(rom.language, 'La langue ROM du backup HGSS'),
  })
}

function requireMetadata(value: unknown): HgssSaveBackupMetadata {
  const metadata = requirePlainRecord(value, 'Les métadonnées du backup HGSS')
  requireExactKeys(
    metadata,
    ['exportedAt', 'savedAt', 'saveKind', 'sourceSlot'],
    'Les métadonnées du backup HGSS',
  )
  return Object.freeze({
    sourceSlot: requireSlot(metadata.sourceSlot),
    saveKind: requireSaveKind(metadata.saveKind),
    savedAt: requireTimestamp(metadata.savedAt, 'metadata.savedAt'),
    exportedAt: requireTimestamp(metadata.exportedAt, 'metadata.exportedAt'),
  })
}

function requireMatchingDocumentIdentity(
  document: HgssDataOnlySaveDocument,
  rom: HgssSaveBackupRomIdentity,
): void {
  if (
    document.romIdentity?.gameVersion !== rom.gameVersion
    || document.romIdentity.language !== rom.language
  ) throw new Error('L’identité ROM du backup ne correspond pas à son document HGSS.')
}

function normalizeBackup(value: unknown): HgssSaveBackupV1 {
  const backup = requirePlainRecord(value, 'Le backup HGSS')
  requireExactKeys(backup, ['document', 'format', 'metadata', 'rom', 'version'], 'Le backup HGSS')
  if (backup.format !== hgssSaveBackupFormat || backup.version !== hgssSaveBackupVersion) {
    throw new Error('Le format ou la version du backup HGSS n’est pas pris en charge.')
  }
  const rom = requireRomIdentity(backup.rom)
  const metadata = requireMetadata(backup.metadata)
  const document = decodeHgssStoredDataOnlySave(backup.document)
  requireMatchingDocumentIdentity(document, rom)
  return Object.freeze({
    format: hgssSaveBackupFormat,
    version: hgssSaveBackupVersion,
    rom,
    metadata,
    document,
  })
}

function requireBoundedSerializedBackup(serialized: string): void {
  const bytes = new TextEncoder().encode(serialized).byteLength
  if (bytes === 0 || bytes > hgssSaveBackupMaximumBytes) {
    throw new Error('Le backup HGSS dépasse la limite de 1 Mio.')
  }
}

export function createHgssSaveBackup(options: {
  gameCode: string
  sourceSlot: HgssBrowserSaveSlot
  saveKind: HgssBrowserSaveKind
  savedAt: string
  exportedAt?: string
  document: HgssDataOnlySaveDocument
}): HgssSaveBackupV1 {
  if (!ownsHgssStoredDataOnlySave(options.document)) {
    throw new Error('Le backup exige un document HGSS attesté data-only.')
  }
  const identity = options.document.romIdentity
  return normalizeBackup({
    format: hgssSaveBackupFormat,
    version: hgssSaveBackupVersion,
    rom: {
      gameCode: options.gameCode,
      gameVersion: identity?.gameVersion,
      language: identity?.language,
    },
    metadata: {
      sourceSlot: options.sourceSlot,
      saveKind: options.saveKind,
      savedAt: options.savedAt,
      exportedAt: options.exportedAt ?? new Date().toISOString(),
    },
    document: options.document,
  })
}

export function serializeHgssSaveBackup(backup: HgssSaveBackupV1): string {
  const normalized = normalizeBackup(backup)
  const serialized = JSON.stringify(normalized)
  requireBoundedSerializedBackup(serialized)
  return serialized
}

export function parseHgssSaveBackup(serialized: string): HgssSaveBackupV1 {
  requireBoundedSerializedBackup(serialized)
  let value: unknown
  try {
    value = JSON.parse(serialized)
  } catch {
    throw new Error('Le fichier de backup HGSS ne contient pas un JSON valide.')
  }
  return normalizeBackup(value)
}

export function createHgssSaveBackupFileName(backup: HgssSaveBackupV1): string {
  const timestamp = backup.metadata.exportedAt.replaceAll(/[^0-9]/g, '').slice(0, 14)
  return `pokemaster-${backup.rom.gameCode}-slot-${backup.metadata.sourceSlot}-${timestamp}.json`
}
