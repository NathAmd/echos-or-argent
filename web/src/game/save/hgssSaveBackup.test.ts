import { describe, expect, it } from 'vitest'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { hgssDataOnlySaveAuthority } from './hgssDataOnlySaveDocument'
import {
  createHgssSaveBackup,
  createHgssSaveBackupFileName,
  hgssSaveBackupFormat,
  hgssSaveBackupMaximumBytes,
  parseHgssSaveBackup,
  serializeHgssSaveBackup,
} from './hgssSaveBackup'
import { createHgssSaveState } from './hgssSaveState'

const savedAt = '2026-09-07T12:00:00.000Z'
const exportedAt = '2026-09-07T12:05:00.000Z'

function createDocument() {
  return hgssDataOnlySaveAuthority.project(createHgssSaveState(
    'IPKF',
    { gender: 'male', name: 'LUTH', trainerId: 0x12345678, gameVersion: 7, language: 3 },
    createHgssSessionRng(5489),
    { mapId: 61, tileX: 4, tileZ: 7, direction: 'north' },
    createFieldScriptState('male', 'LUTH'),
  ))
}

function createSerializedBackup(): string {
  return serializeHgssSaveBackup(createHgssSaveBackup({
    gameCode: 'IPKF',
    sourceSlot: 2,
    saveKind: 'auto',
    savedAt,
    exportedAt,
    document: createDocument(),
  }))
}

describe('backup portable des sauvegardes HGSS', () => {
  it('émet un JSON versionné, data-only et lié à l’identité ROM', () => {
    const parsed = parseHgssSaveBackup(createSerializedBackup())

    expect(parsed).toMatchObject({
      format: hgssSaveBackupFormat,
      version: 1,
      rom: { gameCode: 'IPKF', gameVersion: 7, language: 3 },
      metadata: { sourceSlot: 2, saveKind: 'auto', savedAt, exportedAt },
    })
    expect(hgssDataOnlySaveAuthority.owns(parsed.document)).toBe(true)
    expect(createHgssSaveBackupFileName(parsed)).toBe(
      'pokemaster-IPKF-slot-2-20260907120500.json',
    )
  })

  it.each([
    ['champ racine inconnu', (backup: Record<string, unknown>) => { backup.extra = true }],
    ['champ metadata inconnu', (backup: Record<string, unknown>) => {
      (backup.metadata as Record<string, unknown>).extra = true
    }],
    ['version inconnue', (backup: Record<string, unknown>) => { backup.version = 2 }],
    ['identité divergente', (backup: Record<string, unknown>) => {
      (backup.rom as Record<string, unknown>).language = 2
    }],
    ['document enrichi', (backup: Record<string, unknown>) => {
      (backup.document as Record<string, unknown>).resolvedRomText = 'FUITE ROM'
    }],
  ])('refuse strictement %s', (label, mutate) => {
    void label
    const value = JSON.parse(createSerializedBackup()) as Record<string, unknown>
    mutate(value)

    expect(() => parseHgssSaveBackup(JSON.stringify(value))).toThrow()
  })

  it('refuse le JSON invalide et borne les fichiers à 1 Mio', () => {
    expect(() => parseHgssSaveBackup('{invalide')).toThrow('JSON valide')
    expect(() => parseHgssSaveBackup('x'.repeat(hgssSaveBackupMaximumBytes + 1))).toThrow(
      'limite de 1 Mio',
    )
  })
})
