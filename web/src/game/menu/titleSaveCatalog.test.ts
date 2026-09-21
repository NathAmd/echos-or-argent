import { describe, expect, it, vi } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority, type HgssDataOnlySaveDocument } from '../save/hgssDataOnlySaveDocument'
import type { RestoredHgssSaveState } from '../save/hgssSaveState'
import { createHgssSaveState, restoreHgssSaveState, type HgssSaveStateV1 } from '../save/hgssSaveState'
import {
  getHgssSaveSlotStorageKey,
  getHgssSaveStorageKey,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSave,
  writeHgssBrowserSaveSlot,
} from '../save/hgssSaveStorage'
import { prepareHgssStoredSave, type PreparedHgssStoredSave } from '../save/hgssStoredSavePreparation'
import {
  applyHgssTitleCloudDeletedSlot,
  applyHgssTitleCloudSaveSlot,
  readTitleSaveCatalog,
} from './titleSaveCatalog'

class MemoryStorage {
  readonly values = new Map<string, string>()
  getItem(key: string): string | null { return this.values.get(key) ?? null }
  setItem(key: string, value: string): void { this.values.set(key, value) }
  removeItem(key: string): void { this.values.delete(key) }
}

const migrationDate = new Date('2026-08-26T12:00:00.000Z')

function createLegacySave(canary: string): HgssSaveStateV1 {
  const save = createHgssSaveState(
    'IPKF',
    { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', 'ALICE'),
  )
  save.field.buffers = [[0, canary]]
  return save
}

function prepare(value: unknown): PreparedHgssStoredSave {
  const catalog = createPokemonTestCatalog()
  return prepareHgssStoredSave(value, 'IPKF', (candidate) => restoreHgssSaveState(
    candidate,
    'IPKF',
    catalog,
    () => new Date(migrationDate),
  ))
}

function createCanonicalSave(name = 'ALICE'): HgssDataOnlySaveDocument {
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name, trainerId: 0x12345678, language: 3, gameVersion: 7 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', name),
  ))
}

describe('catalogue des sauvegardes du menu titre', () => {
  it('sépare les slots lisibles, les contenus HGSS invalides et les octets bruts corrompus', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { valid: true })
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, { invalidPayload: true })
    const rawKey = getHgssSaveSlotStorageKey('IPKF', 3)
    storage.values.set(rawKey, '{broken')
    const restored = { profile: { name: 'LUTH' } } as RestoredHgssSaveState
    const restore = vi.fn((value: unknown) => {
      if ((value as { valid?: boolean }).valid) return restored
      throw new Error('Sauvegarde HGSS V1 incomplète.')
    })

    const catalog = readTitleSaveCatalog({
      storage,
      gameCode: 'IPKF',
      prepare: (value) => ({
        document: {} as HgssDataOnlySaveDocument,
        restored: restore(value),
        migrationRequired: false,
      }),
    })

    expect([...catalog.saves]).toEqual([[1, expect.objectContaining({ restored })]])
    expect(catalog.saves.get(1)?.deletionToken).toBe(catalog.documents.get(1)?.storageToken)
    expect([...catalog.corruptSaves.keys()]).toEqual([2, 3])
    expect(catalog.corruptSaves.get(2)?.reason).toContain('incomplète')
    expect(catalog.corruptSaves.get(3)?.reason).toContain('JSON valide')
    expect(catalog.warnings).toHaveLength(2)
    expect(storage.values.get(rawKey)).toBe('{broken')
  })

  it('remplace un payload legacy déjà dans un slot par sa projection attestée sans canari ROM', () => {
    const storage = new MemoryStorage()
    const canary = 'ROM_RESOLVED_SLOT_MIGRATION_CANARY'
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, createLegacySave(canary), 'auto', () => migrationDate)

    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })
    const stored = readHgssBrowserSaveSlot(storage, 'IPKF', 2)

    expect([...catalog.saves.keys()]).toEqual([2])
    expect(catalog.documents.get(2)).toEqual(expect.objectContaining({
      savedAt: migrationDate.toISOString(),
      kind: 'auto',
    }))
    expect(hgssDataOnlySaveAuthority.owns(catalog.documents.get(2)?.document)).toBe(true)
    expect(stored?.kind).toBe('auto')
    expect(stored?.savedAt).toBe(migrationDate.toISOString())
    expect(() => hgssDataOnlySaveAuthority.decode(stored?.value)).not.toThrow()
    expect(storage.values.get(getHgssSaveSlotStorageKey('IPKF', 2))).not.toContain(canary)
  })

  it('crée le slot canonique avant de supprimer l’ancienne clé mono-save', () => {
    const storage = new MemoryStorage()
    const canary = 'ROM_RESOLVED_SINGLE_SAVE_MIGRATION_CANARY'
    writeHgssBrowserSave(storage, 'IPKF', createLegacySave(canary))

    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })
    const stored = readHgssBrowserSaveSlot(storage, 'IPKF', 1)

    expect([...catalog.saves.keys()]).toEqual([1])
    expect(storage.values.has(getHgssSaveStorageKey('IPKF'))).toBe(false)
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(true)
    expect(() => hgssDataOnlySaveAuthority.decode(stored?.value)).not.toThrow()
    expect(storage.values.get(getHgssSaveSlotStorageKey('IPKF', 1))).not.toContain(canary)
  })

  it('déplace aussi une mono-save déjà canonique vers son slot physique', () => {
    const storage = new MemoryStorage()
    const canonical = hgssDataOnlySaveAuthority.project(createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
      createHgssSessionRng(5489),
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      createFieldScriptState('male', 'ALICE'),
    ))
    writeHgssBrowserSave(storage, 'IPKF', canonical)

    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })

    expect([...catalog.saves.keys()]).toEqual([1])
    expect(storage.values.has(getHgssSaveStorageKey('IPKF'))).toBe(false)
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(true)
  })

  it('recommence la préparation si un autre onglet remplace le slot entre les deux inspections', () => {
    const storage = new MemoryStorage()
    const first = createCanonicalSave('ALICE')
    const concurrent = createCanonicalSave('BOB')
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, first, 'manual', () => migrationDate)
    let replaced = false

    const catalog = readTitleSaveCatalog({
      storage,
      gameCode: 'IPKF',
      prepare: (value) => {
        const prepared = prepare(value)
        if (!replaced) {
          replaced = true
          writeHgssBrowserSaveSlot(
            storage,
            'IPKF',
            1,
            concurrent,
            'auto',
            () => new Date('2026-08-27T09:00:00.000Z'),
          )
        }
        return prepared
      },
    })

    expect(catalog.saves.get(1)?.restored.profile.name).toBe('BOB')
    expect(catalog.documents.get(1)).toEqual(expect.objectContaining({
      savedAt: '2026-08-27T09:00:00.000Z',
      kind: 'auto',
    }))
    const observed = catalog.documents.get(1)
    if (!observed) throw new Error('Slot concurrent absent du catalogue')
    applyHgssTitleCloudDeletedSlot(storage, 'IPKF', 1, observed.storageToken)
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1)).toBeUndefined()
  })

  it('relit le slot concurrent au lieu de déclarer corrompue une migration legacy devenue obsolète', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSave(storage, 'IPKF', createLegacySave('LEGACY_ALICE'))
    const concurrent = createCanonicalSave('BOB')
    let replaced = false

    const catalog = readTitleSaveCatalog({
      storage,
      gameCode: 'IPKF',
      prepare: (value) => {
        const prepared = prepare(value)
        if (!replaced) {
          replaced = true
          writeHgssBrowserSaveSlot(
            storage,
            'IPKF',
            1,
            concurrent,
            'auto',
            () => new Date('2026-08-27T10:00:00.000Z'),
          )
        }
        return prepared
      },
    })

    expect([...catalog.corruptSaves]).toEqual([])
    expect(catalog.saves.get(1)?.restored.profile.name).toBe('BOB')
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1)).toEqual(expect.objectContaining({
      savedAt: '2026-08-27T10:00:00.000Z',
      kind: 'auto',
    }))
  })

  it.each(['valid', 'corrupt'] as const)('finalise un staging canonique %s après préparation', (staging) => {
    const storage = new MemoryStorage()
    const canonical = hgssDataOnlySaveAuthority.project(createHgssSaveState(
      'IPKF',
      { gender: 'male', name: 'ALICE', trainerId: 0x12345678, language: 3, gameVersion: 7 },
      createHgssSessionRng(5489),
      { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
      createFieldScriptState('male', 'ALICE'),
    ))
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, canonical, 'auto', () => migrationDate)
    const slotKey = getHgssSaveSlotStorageKey('IPKF', 2)
    storage.values.set(`${slotKey}.staging`, staging === 'valid' ? storage.values.get(slotKey)! : '{broken')

    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })
    const stored = readHgssBrowserSaveSlot(storage, 'IPKF', 2)

    expect([...catalog.saves.keys()]).toEqual([2])
    expect(storage.values.has(`${slotKey}.staging`)).toBe(false)
    expect(() => hgssDataOnlySaveAuthority.decode(stored?.value)).not.toThrow()
  })

  it.each(['slot', 'legacy'] as const)('laisse tous les octets %s inchangés si la projection échoue', (source) => {
    const storage = new MemoryStorage()
    const save = createLegacySave('ROM_PROJECTION_FAILURE_CANARY')
    if (source === 'slot') writeHgssBrowserSaveSlot(storage, 'IPKF', 1, save, 'manual', () => migrationDate)
    else writeHgssBrowserSave(storage, 'IPKF', save)
    const before = new Map(storage.values)

    const catalog = readTitleSaveCatalog({
      storage,
      gameCode: 'IPKF',
      prepare: () => { throw new Error('Projection data-only impossible.') },
    })

    expect(catalog.saves.size).toBe(0)
    expect(catalog.corruptSaves.get(1)?.reason).toContain('Projection data-only impossible')
    expect(storage.values).toEqual(before)
    if (source === 'legacy') expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
  })

  it('applique une copie cloud avec horodatage préservé seulement sur le snapshot local attendu', () => {
    const storage = new MemoryStorage()
    const first = createCanonicalSave('ALICE')
    const second = createCanonicalSave('BOB')
    const firstSavedAt = '2026-08-26T12:00:00.000Z'
    const secondSavedAt = '2026-08-27T08:30:00.000Z'

    const created = applyHgssTitleCloudSaveSlot(
      storage, 'IPKF', 1, { kind: 'empty' }, first, 'auto', firstSavedAt,
    )
    expect(created.savedAt).toBe(firstSavedAt)
    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })
    const observed = catalog.documents.get(1)
    if (!observed) throw new Error('Slot cloud de test absent')

    const replaced = applyHgssTitleCloudSaveSlot(
      storage,
      'IPKF',
      1,
      { kind: 'occupied', storageToken: observed.storageToken },
      second,
      'manual',
      secondSavedAt,
    )
    expect(replaced.savedAt).toBe(secondSavedAt)
    expect(replaced.kind).toBe('manual')
    expect(() => applyHgssTitleCloudSaveSlot(
      storage,
      'IPKF',
      1,
      { kind: 'occupied', storageToken: observed.storageToken },
      first,
      'auto',
      firstSavedAt,
    )).toThrow('a changé')
  })

  it('applique une tombstone cloud sans supprimer un slot modifié entre-temps', () => {
    const storage = new MemoryStorage()
    applyHgssTitleCloudSaveSlot(
      storage,
      'IPKF',
      3,
      { kind: 'empty' },
      createCanonicalSave(),
      'manual',
      migrationDate.toISOString(),
    )
    const catalog = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare })
    const observed = catalog.documents.get(3)
    if (!observed) throw new Error('Slot cloud de test absent')
    writeHgssBrowserSaveSlot(storage, 'IPKF', 3, createCanonicalSave('BOB'))

    expect(() => applyHgssTitleCloudDeletedSlot(
      storage, 'IPKF', 3, observed.storageToken,
    )).toThrow('a changé')
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 3)).toBeDefined()

    const current = readTitleSaveCatalog({ storage, gameCode: 'IPKF', prepare }).documents.get(3)
    if (!current) throw new Error('Slot cloud modifié absent')
    applyHgssTitleCloudDeletedSlot(storage, 'IPKF', 3, current.storageToken)
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 3)).toBeUndefined()
  })
})
