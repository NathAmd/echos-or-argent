import { describe, expect, it } from 'vitest'
import type {
  HgssFullSaveCloudDeletedSnapshot,
  HgssFullSaveCloudPresentSnapshot,
} from '../save/hgssFullSaveCloudVault'
import type { HgssDataOnlySaveDocument } from '../save/hgssDataOnlySaveDocument'
import {
  resolveTitleSaveCloudVersion,
  titleSaveCloudSnapshotTimestamp,
} from './titleSaveCloudVersionPolicy'

const romIdentity = Object.freeze({ gameVersion: 7, language: 3 })

function present(
  marker: number,
  savedAt: string,
  saveKind: 'manual' | 'auto' = 'manual',
): HgssFullSaveCloudPresentSnapshot {
  return Object.freeze({
    kind: 'present',
    slot: 1,
    romIdentity,
    savedAt,
    saveKind,
    document: { version: 1, marker, romIdentity } as unknown as HgssDataOnlySaveDocument,
  })
}

function deleted(changedAt: string): HgssFullSaveCloudDeletedSnapshot {
  return Object.freeze({ kind: 'deleted', slot: 1, romIdentity, changedAt })
}

describe('politique de version des sauvegardes cloud', () => {
  it('fait gagner la sauvegarde datée la plus récente sans examiner son origine', () => {
    const older = present(1, '2026-08-27T10:00:00.000Z')
    const newer = present(2, '2026-08-27T11:00:00.000Z')

    expect(resolveTitleSaveCloudVersion(newer, older)).toBe('candidate-newer')
    expect(resolveTitleSaveCloudVersion(older, newer)).toBe('current-newer')
  })

  it('ordonne sauvegardes et tombstones avec la même règle de date', () => {
    const save = present(1, '2026-08-27T10:00:00.000Z')
    const laterDeletion = deleted('2026-08-27T11:00:00.000Z')
    const laterSave = present(2, '2026-08-27T12:00:00.000Z')

    expect(resolveTitleSaveCloudVersion(laterDeletion, save)).toBe('candidate-newer')
    expect(resolveTitleSaveCloudVersion(save, laterDeletion)).toBe('current-newer')
    expect(resolveTitleSaveCloudVersion(laterSave, laterDeletion)).toBe('candidate-newer')
  })

  it('considère comme équivalents les mêmes octets au même instant', () => {
    const manual = present(1, '2026-08-27T10:00:00.000Z', 'manual')
    const automatic = present(1, '2026-08-27T10:00:00.000Z', 'auto')
    const tombstone = deleted('2026-08-27T10:00:00.000Z')

    expect(resolveTitleSaveCloudVersion(manual, automatic)).toBe('equivalent')
    expect(resolveTitleSaveCloudVersion(tombstone, tombstone)).toBe('equivalent')
    expect(titleSaveCloudSnapshotTimestamp(manual)).toBe(manual.savedAt)
    expect(titleSaveCloudSnapshotTimestamp(tombstone)).toBe(tombstone.changedAt)
  })

  it('réserve le conflit aux contenus ou états opposés au même instant exact', () => {
    const timestamp = '2026-08-27T10:00:00.000Z'

    expect(resolveTitleSaveCloudVersion(present(1, timestamp), present(2, timestamp)))
      .toBe('simultaneous-conflict')
    expect(resolveTitleSaveCloudVersion(present(1, timestamp), deleted(timestamp)))
      .toBe('simultaneous-conflict')
  })

  it('refuse un horodatage non canonique à la frontière pure', () => {
    expect(() => resolveTitleSaveCloudVersion(
      present(1, '2026-08-27T10:00:00Z'),
      present(2, '2026-08-27T11:00:00.000Z'),
    )).toThrow('horodatage invalide')
  })
})
