import { describe, expect, it, vi } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createHgssDataOnlySaveAuthority,
  hgssDataOnlySaveAuthority,
  type HgssDataOnlySaveDocument,
} from './hgssDataOnlySaveDocument'
import {
  createHgssDataOnlyBrowserSaveSlotIfEmpty,
  migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged,
  writeHgssDataOnlyBrowserSaveSlot,
} from './hgssDataOnlySaveStorage'
import {
  getHgssSaveSlotStorageKey,
  getHgssSaveStorageKey,
  inspectHgssBrowserSaveSlot,
  writeHgssBrowserSave,
  writeHgssBrowserSaveSlot,
} from './hgssSaveStorage'
import { createHgssSaveState } from './hgssSaveState'

function createDocument(): HgssDataOnlySaveDocument {
  const rng = createHgssSessionRng(5489)
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
    rng,
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', 'ALICE'),
  ))
}

function createStorage() {
  const values = new Map<string, string>()
  return {
    values,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    removeItem: vi.fn((key: string) => { values.delete(key) }),
  }
}

describe('stockage local data-only HGSS', () => {
  it('écrit un document possédé par l’autorité exacte', () => {
    const storage = createStorage()
    const document = createDocument()

    const record = writeHgssDataOnlyBrowserSaveSlot(
      storage,
      'IPKF',
      1,
      document,
      'manual',
      () => new Date('2026-08-26T12:00:00.000Z'),
    )

    expect(record).toEqual({
      slot: 1,
      kind: 'manual',
      savedAt: '2026-08-26T12:00:00.000Z',
      value: document,
    })
    expect(storage.setItem).toHaveBeenCalledTimes(2)
  })

  it('ne recopie jamais un texte résolu depuis la ROM dans les octets du slot navigateur', () => {
    const storage = createStorage()
    const rng = createHgssSessionRng(5489)
    const field = createFieldScriptState('male', 'ALICE')
    const romCanary = 'ROM_RESOLVED_LOCAL_SAVE_CANARY'
    field.buffers.set(0, romCanary)
    const document = hgssDataOnlySaveAuthority.project(createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
      rng,
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      field,
    ))

    writeHgssDataOnlyBrowserSaveSlot(storage, 'IPKF', 1, document)

    expect(document.field.buffers).toEqual([])
    expect(storage.setItem.mock.calls.map(([, value]) => value).join('\n')).not.toContain(romCanary)
  })

  it('refuse copie JSON, document forgé et autorité étrangère avant tout accès au stockage', () => {
    const document = createDocument()
    const copy = structuredClone(document) as HgssDataOnlySaveDocument
    const forged = createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
      createHgssSessionRng(5489),
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      createFieldScriptState('male', 'ALICE'),
    ) as unknown as HgssDataOnlySaveDocument
    const foreign = createHgssDataOnlySaveAuthority().project(forged)

    for (const invalid of [copy, forged, foreign]) {
      const storage = createStorage()

      expect(() => writeHgssDataOnlyBrowserSaveSlot(storage, 'IPKF', 1, invalid))
        .toThrow('attestation data-only')
      expect(() => createHgssDataOnlyBrowserSaveSlotIfEmpty(storage, 'IPKF', 1, invalid))
        .toThrow('attestation data-only')
      expect(() => migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
        storage,
        'IPKF',
        1,
        '{}' as never,
        invalid,
        'manual',
        '2026-08-26T12:00:00.000Z',
      )).toThrow('attestation data-only')
      expect(storage.getItem).not.toHaveBeenCalled()
      expect(storage.setItem).not.toHaveBeenCalled()
      expect(storage.removeItem).not.toHaveBeenCalled()
    }
  })

  it.each(['slot', 'legacy'] as const)('restaure exactement la source %s et retire tout commit partiel si l’écriture échoue', (source) => {
    const storage = createStorage()
    const document = createDocument()
    if (source === 'slot') writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { legacy: true })
    else writeHgssBrowserSave(storage, 'IPKF', { legacy: true })
    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 1)
    if (inspection.kind !== 'readable') throw new Error('Sauvegarde lisible attendue.')
    const legacyKey = getHgssSaveStorageKey('IPKF')
    const slotKey = getHgssSaveSlotStorageKey('IPKF', 1)
    const before = new Map(storage.values)
    let failCommit = true
    storage.setItem.mockImplementation((key: string, value: string) => {
      if (key === slotKey && failCommit) {
        failCommit = false
        throw new Error('Quota simulé')
      }
      storage.values.set(key, value)
    })

    expect(() => migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
      storage,
      'IPKF',
      1,
      inspection.deletionToken,
      document,
      inspection.record.kind,
      inspection.record.savedAt,
    )).toThrow('Quota simulé')

    expect(storage.values).toEqual(before)
    if (source === 'legacy') {
      expect(storage.values.has(legacyKey)).toBe(true)
      expect(storage.values.has(slotKey)).toBe(false)
      expect(storage.values.has(`${slotKey}.staging`)).toBe(false)
    }
  })

  it('refuse un token devenu obsolète sans écrire ni supprimer aucun octet', () => {
    const storage = createStorage()
    const document = createDocument()
    writeHgssBrowserSave(storage, 'IPKF', { generation: 1 })
    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 1)
    if (inspection.kind !== 'readable') throw new Error('Mono-save lisible attendue.')
    writeHgssBrowserSave(storage, 'IPKF', { generation: 2 })
    const before = new Map(storage.values)
    const setItemCallsBeforeMigration = storage.setItem.mock.calls.length
    const removeItemCallsBeforeMigration = storage.removeItem.mock.calls.length

    expect(migrateHgssDataOnlyBrowserSaveSlotIfStorageUnchanged(
      storage,
      'IPKF',
      1,
      inspection.deletionToken,
      document,
      inspection.record.kind,
      inspection.record.savedAt,
    )).toEqual({ kind: 'changed' })

    expect(storage.values).toEqual(before)
    expect(storage.setItem).toHaveBeenCalledTimes(setItemCallsBeforeMigration)
    expect(storage.removeItem).toHaveBeenCalledTimes(removeItemCallsBeforeMigration)
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
  })
})
