import { describe, expect, it, vi } from 'vitest'
import {
  createHgssBrowserSaveSlotIfEmpty,
  deleteHgssBrowserSave,
  deleteHgssBrowserSaveSlot,
  deleteHgssBrowserSaveSlotIfStorageUnchanged,
  enumerateHgssBrowserSaveDeletionTransitionTokens,
  getHgssSaveSlotStorageKey,
  getHgssSaveStorageKey,
  inspectHgssBrowserSaveSlot,
  migrateHgssBrowserSaveSlotIfStorageUnchanged,
  readHgssBrowserSave,
  readHgssBrowserSaveSlot,
  writeHgssBrowserSave,
  writeHgssBrowserSaveSlot,
  type HgssBrowserSaveSlot,
} from './hgssSaveStorage'

class MemoryStorage {
  readonly values = new Map<string, string>()

  getItem(key: string): string | null {
    return this.values.get(key) ?? null
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value)
  }

  removeItem(key: string): void {
    this.values.delete(key)
  }
}

describe('HGSS browser save storage', () => {
  it('writes a checksummed envelope and reads its payload', () => {
    const storage = new MemoryStorage()
    const save = { version: 1, romGameCode: 'IPKF', field: { money: 3000 } }

    writeHgssBrowserSave(storage, 'IPKF', save)

    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual(save)
    expect(storage.values.has(`${getHgssSaveStorageKey('IPKF')}.staging`)).toBe(false)
  })

  it('rejects a committed payload whose checksum no longer matches', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSave(storage, 'IPKF', { money: 3000 })
    const key = getHgssSaveStorageKey('IPKF')
    storage.values.set(key, storage.values.get(key)!.replace('3000', '9999'))

    expect(() => readHgssBrowserSave(storage, 'IPKF')).toThrow('checksum')
  })

  it('reads a valid staged write without mutating the inspected bytes', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSave(storage, 'IPKF', { money: 3000 })
    const key = getHgssSaveStorageKey('IPKF')
    const valid = storage.values.get(key)!
    storage.values.set(`${key}.staging`, valid)
    storage.values.set(key, '{broken')

    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual({ money: 3000 })
    expect(storage.values.get(key)).toBe('{broken')
    expect(storage.values.get(`${key}.staging`)).toBe(valid)
  })

  it('prefers a newer staged write without promoting it during a read', () => {
    const storage = new MemoryStorage()
    const newerStorage = new MemoryStorage()
    const key = getHgssSaveStorageKey('IPKF')
    writeHgssBrowserSave(storage, 'IPKF', { checkpoint: 1 })
    writeHgssBrowserSave(newerStorage, 'IPKF', { checkpoint: 2 })
    storage.values.set(`${key}.staging`, newerStorage.values.get(key)!)

    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual({ checkpoint: 2 })
    expect(storage.values.get(key)).not.toBe(newerStorage.values.get(key))
    expect(storage.values.get(`${key}.staging`)).toBe(newerStorage.values.get(key))
  })

  it('falls back from a corrupt staged write without discarding either source', () => {
    const storage = new MemoryStorage()
    const key = getHgssSaveStorageKey('IPKF')
    writeHgssBrowserSave(storage, 'IPKF', { checkpoint: 1 })
    storage.values.set(`${key}.staging`, '{broken')

    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual({ checkpoint: 1 })
    expect(storage.values.get(`${key}.staging`)).toBe('{broken')
  })

  it('reads legacy raw V1 JSON without wrapping it before data-only migration', () => {
    const storage = new MemoryStorage()
    const key = getHgssSaveStorageKey('IPKF')
    storage.values.set(key, JSON.stringify({ version: 1, romGameCode: 'IPKF' }))

    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual({ version: 1, romGameCode: 'IPKF' })
    expect(storage.values.get(key)).toBe(JSON.stringify({ version: 1, romGameCode: 'IPKF' }))

    storage.values.set(`${key}.staging`, 'pending')
    deleteHgssBrowserSave(storage, 'IPKF')
    expect(storage.values.size).toBe(0)
  })

  it('stores three isolated checksummed slots with save metadata', () => {
    const storage = new MemoryStorage()
    const now = () => new Date('2026-08-15T10:20:30.000Z')
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { player: 'Luth' }, 'auto', now)
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, { player: 'Célesta' }, 'manual', now)

    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1)).toEqual({
      slot: 1,
      savedAt: '2026-08-15T10:20:30.000Z',
      kind: 'auto',
      value: { player: 'Luth' },
    })
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 2)?.value).toEqual({ player: 'Célesta' })
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 3)).toBeUndefined()
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(true)
  })

  it('creates a campaign only when its destination slot is empty', () => {
    const storage = new MemoryStorage()
    const now = () => new Date('2026-08-24T10:20:30.000Z')

    expect(createHgssBrowserSaveSlotIfEmpty(storage, 'IPKF', 2, { campaign: 'new-game-plus' }, 'manual', now)).toEqual({
      slot: 2,
      savedAt: '2026-08-24T10:20:30.000Z',
      kind: 'manual',
      value: { campaign: 'new-game-plus' },
    })
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 2)?.value).toEqual({ campaign: 'new-game-plus' })
  })

  it('refuses to replace an occupied slot and preserves its exact record', () => {
    const storage = new MemoryStorage()
    const originalDate = () => new Date('2026-08-20T08:00:00.000Z')
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { campaign: 'source' }, 'auto', originalDate)
    const before = storage.values.get(getHgssSaveSlotStorageKey('IPKF', 1))

    expect(() => createHgssBrowserSaveSlotIfEmpty(
      storage,
      'IPKF',
      1,
      { campaign: 'new-game-plus' },
      'manual',
      () => new Date('2026-08-24T10:20:30.000Z'),
    )).toThrow('déjà occupé')
    expect(storage.values.get(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(before)
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1)).toEqual({
      slot: 1,
      savedAt: '2026-08-20T08:00:00.000Z',
      kind: 'auto',
      value: { campaign: 'source' },
    })
  })

  it('keeps malformed raw bytes occupied until their explicit guarded deletion', () => {
    const storage = new MemoryStorage()
    const key = getHgssSaveSlotStorageKey('IPKF', 2)
    storage.values.set(key, '{broken')

    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 2)

    expect(inspection).toMatchObject({
      kind: 'corrupt',
      slot: 2,
      reason: expect.stringContaining('JSON valide'),
    })
    expect(storage.values.get(key)).toBe('{broken')
    expect(() => createHgssBrowserSaveSlotIfEmpty(storage, 'IPKF', 2, { replacement: true }))
      .toThrow('déjà occupé')
    expect(storage.values.get(key)).toBe('{broken')
    if (inspection.kind !== 'corrupt') throw new Error('Inspection corrompue attendue.')
    expect(deleteHgssBrowserSaveSlotIfStorageUnchanged(storage, 'IPKF', 2, inspection.deletionToken)).toBe('deleted')
    expect(storage.values.has(key)).toBe(false)
  })

  it('preserves malformed bytes changed after the deletion confirmation', () => {
    const storage = new MemoryStorage()
    const key = getHgssSaveSlotStorageKey('IPKF', 3)
    storage.values.set(key, '{first-corruption')
    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 3)
    if (inspection.kind !== 'corrupt') throw new Error('Inspection corrompue attendue.')

    storage.values.set(key, '{newer-corruption')

    expect(deleteHgssBrowserSaveSlotIfStorageUnchanged(storage, 'IPKF', 3, inspection.deletionToken)).toBe('changed')
    expect(storage.values.get(key)).toBe('{newer-corruption')
  })

  it('restaure la paire exacte si la seconde suppression échoue et couvre l’état intermédiaire', () => {
    class FailingRemovalStorage extends MemoryStorage {
      removals = 0
      override removeItem(key: string): void {
        this.removals += 1
        if (this.removals === 2) throw new Error('suppression interrompue')
        super.removeItem(key)
      }
    }
    const storage = new FailingRemovalStorage()
    const key = getHgssSaveSlotStorageKey('IPKF', 2)
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, { marker: 'committed' })
    storage.values.set(`${key}.staging`, storage.values.get(key)!)
    storage.removals = 0
    const before = new Map(storage.values)
    const inspection = inspectHgssBrowserSaveSlot(storage, 'IPKF', 2)
    if (inspection.kind !== 'readable') throw new Error('Inspection lisible attendue.')
    const journalIntent = vi.fn()

    expect(enumerateHgssBrowserSaveDeletionTransitionTokens(inspection.deletionToken)).toHaveLength(2)
    expect(() => deleteHgssBrowserSaveSlotIfStorageUnchanged(
      storage,
      'IPKF',
      2,
      inspection.deletionToken,
      journalIntent,
    )).toThrow('suppression interrompue')
    expect(journalIntent).toHaveBeenCalledOnce()
    expect(storage.values).toEqual(before)
  })

  it('does not discard a sole corrupt staged slot while inspecting it', () => {
    const storage = new MemoryStorage()
    const stagingKey = `${getHgssSaveSlotStorageKey('IPKF', 1)}.staging`
    storage.values.set(stagingKey, '{interrupted-corruption')

    expect(inspectHgssBrowserSaveSlot(storage, 'IPKF', 1)).toMatchObject({ kind: 'corrupt', slot: 1 })
    expect(storage.values.get(stagingKey)).toBe('{interrupted-corruption')
  })

  it('treats interrupted and legacy saves as occupied destinations', () => {
    const interrupted = new MemoryStorage()
    const stagedSource = new MemoryStorage()
    writeHgssBrowserSaveSlot(stagedSource, 'IPKF', 3, { checkpoint: 'staged' })
    const slotKey = getHgssSaveSlotStorageKey('IPKF', 3)
    interrupted.values.set(`${slotKey}.staging`, stagedSource.values.get(slotKey)!)

    expect(() => createHgssBrowserSaveSlotIfEmpty(interrupted, 'IPKF', 3, { checkpoint: 'replacement' })).toThrow('déjà occupé')
    expect(readHgssBrowserSaveSlot(interrupted, 'IPKF', 3)?.value).toEqual({ checkpoint: 'staged' })
    expect(interrupted.values.has(`${slotKey}.staging`)).toBe(true)

    const legacy = new MemoryStorage()
    writeHgssBrowserSave(legacy, 'IPKF', { checkpoint: 'legacy' })
    expect(() => createHgssBrowserSaveSlotIfEmpty(legacy, 'IPKF', 1, { checkpoint: 'replacement' })).toThrow('déjà occupé')
    expect(readHgssBrowserSaveSlot(legacy, 'IPKF', 1)?.value).toEqual({ checkpoint: 'legacy' })
  })

  it('exposes the former single save as slot 1 without promoting or deleting it', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSave(storage, 'IPKF', { checkpoint: 42 })

    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 2)).toBeUndefined()
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 1, () => new Date('2026-08-15T12:00:00.000Z'))).toMatchObject({
      slot: 1,
      kind: 'manual',
      value: { checkpoint: 42 },
    })
    expect(storage.values.has(getHgssSaveStorageKey('IPKF'))).toBe(true)
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
  })

  it('termine après redémarrage la purge legacy déjà publiée dans le slot', () => {
    const legacyKey = getHgssSaveStorageKey('IPKF')
    class CrashSnapshotStorage extends MemoryStorage {
      crashedValues: Map<string, string> | undefined
      override removeItem(key: string): void {
        if (key === legacyKey && !this.crashedValues) {
          this.crashedValues = new Map(this.values)
          throw new Error('coupure brutale simulée')
        }
        super.removeItem(key)
      }
    }
    const interrupted = new CrashSnapshotStorage()
    writeHgssBrowserSave(interrupted, 'IPKF', { checkpoint: 'legacy' })
    const source = inspectHgssBrowserSaveSlot(interrupted, 'IPKF', 1)
    if (source.kind !== 'readable') throw new Error('Source legacy attendue.')

    expect(() => migrateHgssBrowserSaveSlotIfStorageUnchanged(
      interrupted,
      'IPKF',
      1,
      source.deletionToken,
      { checkpoint: 'canonical' },
      'manual',
      '2026-08-27T12:00:00.000Z',
    )).toThrow('coupure brutale simulée')
    const rebooted = new MemoryStorage()
    rebooted.values.clear()
    for (const [key, value] of interrupted.crashedValues ?? []) rebooted.values.set(key, value)

    const recovered = inspectHgssBrowserSaveSlot(rebooted, 'IPKF', 1)

    expect(recovered).toMatchObject({ kind: 'readable', storageSource: 'slot' })
    expect(readHgssBrowserSaveSlot(rebooted, 'IPKF', 1)?.value).toEqual({ checkpoint: 'canonical' })
    expect(rebooted.values.has(legacyKey)).toBe(false)
    expect([...rebooted.values.keys()].some((key) => key.includes('.migration.slot.1'))).toBe(false)
  })

  it('abandonne le slot revendiqué si une nouvelle mono-save remplace la source après le crash', () => {
    const legacyKey = getHgssSaveStorageKey('IPKF')
    class CrashSnapshotStorage extends MemoryStorage {
      crashedValues: Map<string, string> | undefined
      override removeItem(key: string): void {
        if (key === legacyKey && !this.crashedValues) {
          this.crashedValues = new Map(this.values)
          throw new Error('coupure brutale simulée')
        }
        super.removeItem(key)
      }
    }
    const interrupted = new CrashSnapshotStorage()
    writeHgssBrowserSave(interrupted, 'IPKF', { checkpoint: 'old-legacy' })
    const source = inspectHgssBrowserSaveSlot(interrupted, 'IPKF', 1)
    if (source.kind !== 'readable') throw new Error('Source legacy attendue.')
    expect(() => migrateHgssBrowserSaveSlotIfStorageUnchanged(
      interrupted, 'IPKF', 1, source.deletionToken, { checkpoint: 'old-canonical' },
      'manual', '2026-08-27T12:00:00.000Z',
    )).toThrow()
    const rebooted = new MemoryStorage()
    for (const [key, value] of interrupted.crashedValues ?? []) rebooted.values.set(key, value)
    writeHgssBrowserSave(rebooted, 'IPKF', { checkpoint: 'new-legacy' })

    const recovered = inspectHgssBrowserSaveSlot(rebooted, 'IPKF', 1)

    expect(recovered).toMatchObject({ kind: 'readable', storageSource: 'legacy' })
    expect(readHgssBrowserSaveSlot(rebooted, 'IPKF', 1)?.value).toEqual({ checkpoint: 'new-legacy' })
    expect(rebooted.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
  })

  it('préserve une mono-save remplacée pendant la publication de la phase de purge', () => {
    class ConcurrentLegacyStorage extends MemoryStorage {
      replaced = false
      override setItem(key: string, value: string): void {
        super.setItem(key, value)
        if (
          !this.replaced
          && key.includes('.migration.slot.1')
          && value.includes('"phase":"purging"')
        ) {
          this.replaced = true
          writeHgssBrowserSave(this, 'IPKF', { checkpoint: 'new-concurrent-legacy' })
        }
      }
    }
    const storage = new ConcurrentLegacyStorage()
    writeHgssBrowserSave(storage, 'IPKF', { checkpoint: 'old-legacy' })
    const source = inspectHgssBrowserSaveSlot(storage, 'IPKF', 1)
    if (source.kind !== 'readable') throw new Error('Source legacy attendue.')

    const result = migrateHgssBrowserSaveSlotIfStorageUnchanged(
      storage, 'IPKF', 1, source.deletionToken, { checkpoint: 'old-canonical' },
      'manual', '2026-08-27T12:00:00.000Z',
    )

    expect(result).toEqual({ kind: 'changed' })
    expect(readHgssBrowserSave(storage, 'IPKF')).toEqual({ checkpoint: 'new-concurrent-legacy' })
    expect(storage.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
    expect([...storage.values.keys()].some((key) => key.includes('.migration.slot.1'))).toBe(false)
  })

  it('ne ressuscite pas la destination préparée si la source disparaît avant la phase de purge', () => {
    class PreparedCrashStorage extends MemoryStorage {
      crashedValues: Map<string, string> | undefined
      override setItem(key: string, value: string): void {
        if (
          !this.crashedValues
          && key.includes('.migration.slot.1')
          && value.includes('"phase":"purging"')
        ) {
          this.crashedValues = new Map(this.values)
          throw new Error('coupure avant attestation de purge')
        }
        super.setItem(key, value)
      }
    }
    const interrupted = new PreparedCrashStorage()
    writeHgssBrowserSave(interrupted, 'IPKF', { checkpoint: 'source' })
    const source = inspectHgssBrowserSaveSlot(interrupted, 'IPKF', 1)
    if (source.kind !== 'readable') throw new Error('Source legacy attendue.')
    expect(() => migrateHgssBrowserSaveSlotIfStorageUnchanged(
      interrupted, 'IPKF', 1, source.deletionToken, { checkpoint: 'prepared-destination' },
      'manual', '2026-08-27T12:00:00.000Z',
    )).toThrow('coupure avant attestation de purge')
    const rebooted = new MemoryStorage()
    for (const [key, value] of interrupted.crashedValues ?? []) rebooted.values.set(key, value)
    rebooted.values.delete(getHgssSaveStorageKey('IPKF'))
    rebooted.values.delete(`${getHgssSaveStorageKey('IPKF')}.staging`)

    expect(inspectHgssBrowserSaveSlot(rebooted, 'IPKF', 1)).toEqual({ kind: 'empty', slot: 1 })
    expect(rebooted.values.has(getHgssSaveSlotStorageKey('IPKF', 1))).toBe(false)
  })

  it('rejette un horodatage de slot non canonique', () => {
    const storage = new MemoryStorage()
    const envelopeStorage = new MemoryStorage()
    writeHgssBrowserSave(envelopeStorage, 'IPKF', {
      format: 'pokemaster-hgss-save-slot',
      revision: 1,
      slot: 2,
      savedAt: '2026-08-27',
      kind: 'manual',
      value: { checkpoint: 'ambiguous-date' },
    })
    storage.values.set(
      getHgssSaveSlotStorageKey('IPKF', 2),
      envelopeStorage.values.get(getHgssSaveStorageKey('IPKF'))!,
    )

    expect(inspectHgssBrowserSaveSlot(storage, 'IPKF', 2)).toMatchObject({ kind: 'corrupt', slot: 2 })
  })

  it('explicitly deletes only the requested slot and its staging value', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { checkpoint: 1 })
    writeHgssBrowserSaveSlot(storage, 'IPKF', 2, { checkpoint: 2 })
    writeHgssBrowserSaveSlot(storage, 'IPGE', 1, { checkpoint: 'other-rom' })
    const targetKey = getHgssSaveSlotStorageKey('IPKF', 1)
    const secondSlotKey = getHgssSaveSlotStorageKey('IPKF', 2)
    storage.values.set(`${targetKey}.staging`, storage.values.get(targetKey)!)
    storage.values.set(`${secondSlotKey}.staging`, storage.values.get(secondSlotKey)!)

    expect(deleteHgssBrowserSaveSlot(storage, 'IPKF', 1)).toBe(true)

    expect(storage.values.has(targetKey)).toBe(false)
    expect(storage.values.has(`${targetKey}.staging`)).toBe(false)
    expect(storage.values.has(`${secondSlotKey}.staging`)).toBe(true)
    expect(readHgssBrowserSaveSlot(storage, 'IPKF', 2)?.value).toEqual({ checkpoint: 2 })
    expect(storage.values.has(`${secondSlotKey}.staging`)).toBe(true)
    expect(readHgssBrowserSaveSlot(storage, 'IPGE', 1)?.value).toEqual({ checkpoint: 'other-rom' })
    expect(deleteHgssBrowserSaveSlot(storage, 'IPKF', 1)).toBe(false)
  })

  it('never deletes the legacy single-save keys when removing slot 1', () => {
    const storage = new MemoryStorage()
    const legacyKey = getHgssSaveStorageKey('IPKF')
    writeHgssBrowserSave(storage, 'IPKF', { checkpoint: 'legacy' })
    storage.values.set(`${legacyKey}.staging`, storage.values.get(legacyKey)!)

    expect(deleteHgssBrowserSaveSlot(storage, 'IPKF', 1)).toBe(false)
    expect(storage.values.has(legacyKey)).toBe(true)
    expect(storage.values.has(`${legacyKey}.staging`)).toBe(true)
  })

  it('rejects invalid ROM codes and slots before removing any key', () => {
    const storage = new MemoryStorage()
    writeHgssBrowserSaveSlot(storage, 'IPKF', 1, { checkpoint: 1 })
    const before = new Map(storage.values)

    expect(() => deleteHgssBrowserSaveSlot(storage, 'IPK', 1)).toThrow('code ROM')
    expect(() => deleteHgssBrowserSaveSlot(storage, 'ipkf', 1)).toThrow('code ROM')
    expect(() => deleteHgssBrowserSaveSlot(storage, 'IPKF', 0 as HgssBrowserSaveSlot)).toThrow('emplacement')
    expect(() => deleteHgssBrowserSaveSlot(storage, 'IPKF', 4 as HgssBrowserSaveSlot)).toThrow('emplacement')
    expect(storage.values).toEqual(before)
  })

})
