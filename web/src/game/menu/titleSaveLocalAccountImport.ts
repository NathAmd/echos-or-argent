import {
  hgssBrowserSaveSlotCount,
  inspectHgssBrowserSaveSlot,
  type HgssBrowserSaveSlot,
} from '../save/hgssSaveStorage'
import {
  applyHgssTitleCloudSaveSlot,
  type TitleSaveCatalog,
  type TitleSaveCatalogDocument,
  type TitleSaveCatalogExpectedSlot,
} from './titleSaveCatalog'
import type {
  SwitchableTitleSaveStorage,
  TitleSaveLocalTombstone,
  TitleSaveStorageScope,
} from './titleSaveStorageScope'

type OnlineTitleSaveStorageScope = Extract<TitleSaveStorageScope, { kind: 'online' }>

export const titleSaveLocalAccountImportConsent = 'player-confirmed' as const

export type TitleSaveLocalAccountImportTransfer = Readonly<{
  slot: HgssBrowserSaveSlot
  mode: 'create' | 'replace'
  trainerName: string
  source: TitleSaveCatalogDocument
  expectedTarget: TitleSaveCatalogExpectedSlot
}>

export type TitleSaveLocalAccountImportRetained = Readonly<{
  slot: HgssBrowserSaveSlot
  reason: 'account-newer' | 'identical'
}>

export type TitleSaveLocalAccountImportConflict = Readonly<{
  slot: HgssBrowserSaveSlot
  reason: 'local-corrupt' | 'account-corrupt' | 'same-date-divergent'
}>

/**
 * Proposition immuable affichable avant toute copie. La destination est liée au
 * serveur et au compte authentifié afin qu'une validation ne puisse pas être
 * rejouée après un changement d'utilisateur.
 */
export type TitleSaveLocalAccountImportProposal = Readonly<{
  destination: OnlineTitleSaveStorageScope
  transfers: readonly TitleSaveLocalAccountImportTransfer[]
  retained: readonly TitleSaveLocalAccountImportRetained[]
  conflicts: readonly TitleSaveLocalAccountImportConflict[]
}>

export type TitleSaveLocalAccountImportResult = Readonly<{
  created: number
  replaced: number
}>

export class TitleSaveLocalAccountImportChangedError extends Error {
  readonly slot: HgssBrowserSaveSlot

  constructor(slot: HgssBrowserSaveSlot) {
    super(`L'emplacement ${slot} a changé pendant l'importation locale.`)
    this.name = 'TitleSaveLocalAccountImportChangedError'
    this.slot = slot
  }
}

function allSlots(): readonly HgssBrowserSaveSlot[] {
  return Array.from(
    { length: hgssBrowserSaveSlotCount },
    (_, index) => index + 1 as HgssBrowserSaveSlot,
  )
}

function compareTimestamp(left: string, right: string): -1 | 0 | 1 {
  const leftValue = Date.parse(left)
  const rightValue = Date.parse(right)
  if (
    !Number.isFinite(leftValue)
    || !Number.isFinite(rightValue)
    || new Date(leftValue).toISOString() !== left
    || new Date(rightValue).toISOString() !== right
  ) throw new Error("L'importation locale a reçu un horodatage invalide.")
  return leftValue < rightValue ? -1 : leftValue > rightValue ? 1 : 0
}

function sameDocument(
  left: TitleSaveCatalogDocument['document'],
  right: TitleSaveCatalogDocument['document'],
): boolean {
  return JSON.stringify(left) === JSON.stringify(right)
}

function trainerName(catalog: TitleSaveCatalog, slot: HgssBrowserSaveSlot): string {
  const value = catalog.saves.get(slot)?.restored.profile.name.trim()
  return value && value.length > 0 ? value.slice(0, 32) : 'DRESSEUR'
}

function freezeDestination(scope: OnlineTitleSaveStorageScope): OnlineTitleSaveStorageScope {
  return Object.freeze({
    kind: 'online',
    serverUrl: scope.serverUrl,
    accountId: scope.accountId,
  })
}

export function createTitleSaveLocalAccountImportProposal(options: Readonly<{
  localCatalog: TitleSaveCatalog
  accountCatalog: TitleSaveCatalog
  accountTombstones?: ReadonlyMap<HgssBrowserSaveSlot, TitleSaveLocalTombstone>
  destination: OnlineTitleSaveStorageScope
}>): TitleSaveLocalAccountImportProposal {
  const transfers: TitleSaveLocalAccountImportTransfer[] = []
  const retained: TitleSaveLocalAccountImportRetained[] = []
  const conflicts: TitleSaveLocalAccountImportConflict[] = []

  for (const slot of allSlots()) {
    const local = options.localCatalog.documents.get(slot)
    const account = options.accountCatalog.documents.get(slot)
    if (options.localCatalog.corruptSaves.has(slot)) {
      conflicts.push(Object.freeze({ slot, reason: 'local-corrupt' }))
      continue
    }
    if (options.accountCatalog.corruptSaves.has(slot)) {
      if (local) conflicts.push(Object.freeze({ slot, reason: 'account-corrupt' }))
      continue
    }
    if (!local) continue
    const observedTombstone = options.accountTombstones?.get(slot)
    const accountTombstone = observedTombstone && (
      !account
      || !observedTombstone.supersededStorageHashes
        && compareTimestamp(account.savedAt, observedTombstone.changedAt) <= 0
    ) ? observedTombstone : undefined
    if (accountTombstone) {
      const order = compareTimestamp(local.savedAt, accountTombstone.changedAt)
      if (order < 0) {
        retained.push(Object.freeze({ slot, reason: 'account-newer' }))
        continue
      }
      if (order === 0) {
        conflicts.push(Object.freeze({ slot, reason: 'same-date-divergent' }))
        continue
      }
      transfers.push(Object.freeze({
        slot,
        mode: account ? 'replace' : 'create',
        trainerName: trainerName(options.localCatalog, slot),
        source: local,
        expectedTarget: account
          ? Object.freeze({ kind: 'occupied', storageToken: account.storageToken })
          : Object.freeze({ kind: 'empty' }),
      }))
      continue
    }
    if (!account) {
      transfers.push(Object.freeze({
        slot,
        mode: 'create',
        trainerName: trainerName(options.localCatalog, slot),
        source: local,
        expectedTarget: Object.freeze({ kind: 'empty' }),
      }))
      continue
    }

    const order = compareTimestamp(local.savedAt, account.savedAt)
    if (order > 0) {
      transfers.push(Object.freeze({
        slot,
        mode: 'replace',
        trainerName: trainerName(options.localCatalog, slot),
        source: local,
        expectedTarget: Object.freeze({
          kind: 'occupied',
          storageToken: account.storageToken,
        }),
      }))
    } else if (order < 0) {
      retained.push(Object.freeze({ slot, reason: 'account-newer' }))
    } else if (sameDocument(local.document, account.document)) {
      retained.push(Object.freeze({ slot, reason: 'identical' }))
    } else {
      conflicts.push(Object.freeze({ slot, reason: 'same-date-divergent' }))
    }
  }

  return Object.freeze({
    destination: freezeDestination(options.destination),
    transfers: Object.freeze(transfers),
    retained: Object.freeze(retained),
    conflicts: Object.freeze(conflicts),
  })
}

function sameDestination(
  current: TitleSaveStorageScope,
  expected: OnlineTitleSaveStorageScope,
): boolean {
  return current.kind === 'online'
    && current.serverUrl === expected.serverUrl
    && current.accountId === expected.accountId
}

function sourceIsCurrent(
  storage: SwitchableTitleSaveStorage,
  gameCode: string,
  transfer: TitleSaveLocalAccountImportTransfer,
): boolean {
  const inspection = inspectHgssBrowserSaveSlot(storage, gameCode, transfer.slot)
  return inspection.kind === 'readable'
    && inspection.deletionToken === transfer.source.storageToken
}

function targetIsCurrent(
  storage: SwitchableTitleSaveStorage,
  gameCode: string,
  transfer: TitleSaveLocalAccountImportTransfer,
): boolean {
  const inspection = inspectHgssBrowserSaveSlot(storage, gameCode, transfer.slot)
  return transfer.expectedTarget.kind === 'empty'
    ? inspection.kind === 'empty'
    : inspection.kind !== 'empty'
      && inspection.deletionToken === transfer.expectedTarget.storageToken
}

/**
 * Copie les seules versions locales plus récentes après consentement explicite.
 * La source locale n'est jamais supprimée. Chaque écriture cible conserve le
 * `savedAt` original et emploie le token exact observé lors de la proposition.
 * Une reprise est convergente : les slots déjà copiés deviennent identiques.
 */
export function applyTitleSaveLocalAccountImport(options: Readonly<{
  sourceStorage: SwitchableTitleSaveStorage
  destinationStorage: SwitchableTitleSaveStorage
  gameCode: string
  proposal: TitleSaveLocalAccountImportProposal
  consent: typeof titleSaveLocalAccountImportConsent
}>): TitleSaveLocalAccountImportResult {
  if (options.consent !== titleSaveLocalAccountImportConsent) {
    throw new Error("L'importation locale exige la validation du joueur.")
  }
  if (options.sourceStorage.getScope().kind !== 'local') {
    throw new Error("La source de l'importation doit être le mode local global.")
  }
  if (!sameDestination(options.destinationStorage.getScope(), options.proposal.destination)) {
    throw new Error("Le compte cible a changé depuis la validation de l'importation.")
  }
  if (!/^[A-Z0-9]{4}$/.test(options.gameCode)) {
    throw new Error("Le code ROM de l'importation locale est invalide.")
  }
  for (const transfer of options.proposal.transfers) {
    if (
      !sourceIsCurrent(options.sourceStorage, options.gameCode, transfer)
      || !targetIsCurrent(options.destinationStorage, options.gameCode, transfer)
    ) throw new TitleSaveLocalAccountImportChangedError(transfer.slot)
  }

  let created = 0
  let replaced = 0
  for (const transfer of options.proposal.transfers) {
    // Une dernière lecture réduit la fenêtre entre la validation et la copie.
    if (!sourceIsCurrent(options.sourceStorage, options.gameCode, transfer)) {
      throw new TitleSaveLocalAccountImportChangedError(transfer.slot)
    }
    try {
      applyHgssTitleCloudSaveSlot(
        options.destinationStorage,
        options.gameCode,
        transfer.slot,
        transfer.expectedTarget,
        transfer.source.document,
        transfer.source.kind,
        transfer.source.savedAt,
      )
    } catch {
      throw new TitleSaveLocalAccountImportChangedError(transfer.slot)
    }
    if (transfer.mode === 'create') created += 1
    else replaced += 1
  }
  return Object.freeze({ created, replaced })
}
