import { describe, expect, it, vi } from 'vitest'
import type { HgssDataOnlySaveDocument } from './hgssDataOnlySaveDocument'
import {
  createHgssSessionPersistenceCoordinator,
  isVisualMovementSaveBlocked,
} from './hgssSessionPersistenceCoordinator'

describe('coordinateur de persistance de session', () => {
  it('ne laisse une animation visuelle passer que pour un checkpoint terrain explicite', () => {
    expect(isVisualMovementSaveBlocked(true, false)).toBe(true)
    expect(isVisualMovementSaveBlocked(true, true)).toBe(false)
    expect(isVisualMovementSaveBlocked(false, false)).toBe(false)
  })

  it('ne projette ni écrit un état transitoire refusé', () => {
    const createDocument = vi.fn()
    const write = vi.fn()
    const coordinator = createHgssSessionPersistenceCoordinator<number, [string], HgssDataOnlySaveDocument>({
      readArguments: () => undefined,
      createDocument: createDocument as () => HgssDataOnlySaveDocument,
      write,
    })
    expect(coordinator.persist(1)).toBe(false)
    expect(createDocument).not.toHaveBeenCalled()
    expect(write).not.toHaveBeenCalled()
  })

  it('écrit le document data-only avant de notifier la publication durable', () => {
    const args: [string] = ['IPKF']
    const document = { version: 1 } as HgssDataOnlySaveDocument
    const events: string[] = []
    const coordinator = createHgssSessionPersistenceCoordinator<number, [string], HgssDataOnlySaveDocument>({
      readArguments: (state, explicit) => {
        expect({ state, explicit }).toEqual({ state: 7, explicit: true })
        return args
      },
      createDocument: vi.fn(() => document),
      write: vi.fn((gameCode, value, kind) => {
        expect({ gameCode, value, kind }).toEqual({ gameCode: 'IPKF', value: document, kind: 'manual' })
        events.push('write')
        return { savedAt: '2026-08-26T18:00:00.000Z' }
      }),
      onSaved: (savedAt) => events.push(`saved:${savedAt}`),
    })
    expect(coordinator.persist(7, 'manual', true)).toBe(true)
    expect(events).toEqual(['write', 'saved:2026-08-26T18:00:00.000Z'])
  })

  it('convertit toute erreur en échec sans publication implicite', () => {
    const reportError = vi.fn()
    const coordinator = createHgssSessionPersistenceCoordinator<number, [string], HgssDataOnlySaveDocument>({
      readArguments: () => { throw new Error('stockage plein') },
      createDocument: () => ({}) as HgssDataOnlySaveDocument,
      write: vi.fn(),
      reportError,
    })
    expect(coordinator.persist(1)).toBe(false)
    expect(reportError).toHaveBeenCalledWith('Sauvegarde impossible : stockage plein')
  })
})
