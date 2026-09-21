import { describe, expect, it } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority } from '../save/hgssDataOnlySaveDocument'
import { writeHgssDataOnlyBrowserSaveSlot } from '../save/hgssDataOnlySaveStorage'
import {
  inspectHgssBrowserSaveSlot,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSaveSlot,
  type HgssBrowserSaveKind,
  type HgssBrowserSaveSlot,
} from '../save/hgssSaveStorage'
import { createHgssSaveState } from '../save/hgssSaveState'
import type { TitleSaveCatalog, TitleSaveCatalogDocument } from './titleSaveCatalog'
import {
  applyTitleSaveLocalAccountImport,
  createTitleSaveLocalAccountImportProposal,
  titleSaveLocalAccountImportConsent,
} from './titleSaveLocalAccountImport'
import { createSwitchableTitleSaveStorage } from './titleSaveStorageScope'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, String(value)) }
  removeItem(key: string): void { this.values.delete(key) }
}

const serverUrl = 'https://online.example.test'

function document(name: string) {
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name, trainerId: 0x12345678, language: 3, gameVersion: 7 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', name),
  ))
}

function storagePair(accountId = 'alice') {
  const raw = new MemoryStorage()
  const local = createSwitchableTitleSaveStorage(raw)
  const account = createSwitchableTitleSaveStorage(raw)
  local.selectLocal()
  account.selectOnline(serverUrl, accountId)
  return { raw, local, account }
}

function store(
  storage: ReturnType<typeof createSwitchableTitleSaveStorage>,
  slot: HgssBrowserSaveSlot,
  name: string,
  savedAt: string,
  kind: HgssBrowserSaveKind = 'manual',
): TitleSaveCatalogDocument {
  const value = document(name)
  writeHgssDataOnlyBrowserSaveSlot(storage, 'IPKF', slot, value, kind, () => new Date(savedAt))
  const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', slot)
  if (inspection.kind !== 'readable') throw new Error('Slot de test illisible.')
  return Object.freeze({
    document: value,
    savedAt,
    kind,
    storageToken: inspection.deletionToken,
  })
}

function catalog(entries: readonly (readonly [HgssBrowserSaveSlot, TitleSaveCatalogDocument])[]): TitleSaveCatalog {
  return {
    documents: new Map(entries),
    saves: new Map(entries.map(([slot, entry]) => [slot, {
      restored: { profile: { name: entry.document.profile.name } },
      savedAt: entry.savedAt,
      kind: entry.kind,
      deletionToken: entry.storageToken,
    } as never])),
    corruptSaves: new Map(),
    warnings: [],
  }
}

describe('import explicite du mode local vers un compte', () => {
  it('propose seulement les slots locaux absents ou plus récents', () => {
    const view = storagePair()
    const localOne = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const localTwo = store(view.local, 2, 'LOCAL', '2026-08-26T12:00:00.000Z')
    const accountOne = store(view.account, 1, 'ANCIEN', '2026-08-27T14:00:00.000Z')
    const accountTwo = store(view.account, 2, 'RECENT', '2026-08-27T12:00:00.000Z')

    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, localOne], [2, localTwo]]),
      accountCatalog: catalog([[1, accountOne], [2, accountTwo]]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })

    expect(proposal.transfers).toEqual([
      expect.objectContaining({ slot: 1, mode: 'replace', trainerName: 'LOCAL' }),
    ])
    expect(proposal.retained).toEqual([{ slot: 2, reason: 'account-newer' }])
    expect(proposal.conflicts).toEqual([])
  })

  it('ne tranche jamais automatiquement deux contenus différents à date égale', () => {
    const view = storagePair()
    const local = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const account = store(view.account, 1, 'COMPTE', '2026-08-27T15:00:00.000Z')

    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([[1, account]]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })

    expect(proposal.transfers).toEqual([])
    expect(proposal.conflicts).toEqual([{ slot: 1, reason: 'same-date-divergent' }])
  })

  it('respecte une suppression de compte plus récente et remplace une suppression plus ancienne', () => {
    const view = storagePair()
    const local = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const destination = { kind: 'online' as const, serverUrl, accountId: 'alice' }

    const newerDeletion = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([]),
      accountTombstones: new Map([[1, { changedAt: '2026-08-27T16:00:00.000Z' }]]),
      destination,
    })
    const olderDeletion = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([]),
      accountTombstones: new Map([[1, { changedAt: '2026-08-27T14:00:00.000Z' }]]),
      destination,
    })

    expect(newerDeletion.transfers).toEqual([])
    expect(newerDeletion.retained).toEqual([{ slot: 1, reason: 'account-newer' }])
    expect(olderDeletion.transfers).toEqual([
      expect.objectContaining({ slot: 1, mode: 'create' }),
    ])
  })

  it('copie les slots sûrs sans toucher à un autre slot corrompu', () => {
    const view = storagePair()
    const local = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const localCatalog = catalog([[1, local]])
    localCatalog.corruptSaves.set(2, {
      reason: 'Octets invalides.',
      deletionToken: 'corrupt-slot-2' as never,
    })
    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog,
      accountCatalog: catalog([]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })

    expect(proposal.conflicts).toEqual([{ slot: 2, reason: 'local-corrupt' }])
    expect(applyTitleSaveLocalAccountImport({
      sourceStorage: view.local,
      destinationStorage: view.account,
      gameCode: 'IPKF',
      proposal,
      consent: titleSaveLocalAccountImportConsent,
    })).toEqual({ created: 1, replaced: 0 })
    expect(readHgssBrowserSaveSlot(view.account, 'IPKF', 1)).toBeDefined()
    expect(readHgssBrowserSaveSlot(view.account, 'IPKF', 2)).toBeUndefined()
  })

  it('copie après consentement en préservant la date et sans supprimer la source', () => {
    const view = storagePair()
    const savedAt = '2026-08-27T15:00:00.000Z'
    const local = store(view.local, 1, 'LOCAL', savedAt, 'auto')
    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })

    expect(applyTitleSaveLocalAccountImport({
      sourceStorage: view.local,
      destinationStorage: view.account,
      gameCode: 'IPKF',
      proposal,
      consent: titleSaveLocalAccountImportConsent,
    })).toEqual({ created: 1, replaced: 0 })

    expect(readHgssBrowserSaveSlot(view.local, 'IPKF', 1)).toEqual(expect.objectContaining({ savedAt, kind: 'auto' }))
    expect(readHgssBrowserSaveSlot(view.account, 'IPKF', 1)).toEqual(expect.objectContaining({ savedAt, kind: 'auto' }))
  })

  it('refuse une validation rejouée après changement de compte', () => {
    const view = storagePair()
    const local = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })
    view.account.selectOnline(serverUrl, 'bob')

    expect(() => applyTitleSaveLocalAccountImport({
      sourceStorage: view.local,
      destinationStorage: view.account,
      gameCode: 'IPKF',
      proposal,
      consent: titleSaveLocalAccountImportConsent,
    })).toThrow('compte cible a changé')
    expect(readHgssBrowserSaveSlot(view.account, 'IPKF', 1)).toBeUndefined()
  })

  it('refuse la copie si la source ou la destination change après la proposition', () => {
    const view = storagePair()
    const local = store(view.local, 1, 'LOCAL', '2026-08-27T15:00:00.000Z')
    const proposal = createTitleSaveLocalAccountImportProposal({
      localCatalog: catalog([[1, local]]),
      accountCatalog: catalog([]),
      destination: { kind: 'online', serverUrl, accountId: 'alice' },
    })
    writeHgssBrowserSaveSlot(
      view.local,
      'IPKF',
      1,
      document('AUTRE'),
      'manual',
      () => new Date('2026-08-27T16:00:00.000Z'),
    )

    expect(() => applyTitleSaveLocalAccountImport({
      sourceStorage: view.local,
      destinationStorage: view.account,
      gameCode: 'IPKF',
      proposal,
      consent: titleSaveLocalAccountImportConsent,
    })).toThrow('a changé')
    expect(readHgssBrowserSaveSlot(view.account, 'IPKF', 1)).toBeUndefined()
  })
})
