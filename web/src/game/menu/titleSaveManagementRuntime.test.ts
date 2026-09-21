import { describe, expect, it, vi } from 'vitest'
import type { HgssBrowserSaveSlot, HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'
import type { TitleMenuSavePreview } from './titleMenuPresentationModel'
import { createTitleSaveManagementRuntime } from './titleSaveManagementRuntime'

const occupied = {
  restored: { profile: { name: 'LUTH' } },
  savedAt: '2026-08-24T18:30:00.000Z',
  kind: 'manual',
  deletionToken: 'slot-1-exact-bytes' as HgssBrowserSaveSlotDeletionToken,
} as TitleMenuSavePreview

function setup(saves = new Map<HgssBrowserSaveSlot, TitleMenuSavePreview>([[1, occupied]])) {
  const corruptSaves = new Map()
  const callbacks = {
    activateSlot: vi.fn(),
    requestDelete: vi.fn(),
    requestDeleteCorrupt: vi.fn(),
    exportSave: vi.fn(),
    importSave: vi.fn(),
    openNewGamePlus: vi.fn(),
    reportStatus: vi.fn(),
    refresh: vi.fn(),
  }
  return {
    callbacks,
    corruptSaves,
    runtime: createTitleSaveManagementRuntime({ readSaves: () => saves, readCorruptSaves: () => corruptSaves, ...callbacks }),
  }
}

describe('gestion des actions de sauvegarde au titre', () => {
  it('continue directement une partie existante sans passer par New Game+', () => {
    const { runtime, callbacks } = setup()
    runtime.activate('continue', 1)

    expect(callbacks.activateSlot).toHaveBeenCalledWith(1)
    expect(callbacks.openNewGamePlus).not.toHaveBeenCalled()
    expect(callbacks.requestDelete).not.toHaveBeenCalled()
  })

  it('démarre une partie normale dans un slot vide même si NG+ est disponible ailleurs', () => {
    const { runtime, callbacks } = setup()
    runtime.activate('new-game', 2)

    expect(callbacks.activateSlot).toHaveBeenCalledWith(2)
    expect(callbacks.openNewGamePlus).not.toHaveBeenCalled()
  })

  it('sépare la demande destructive et capture exactement le slot choisi', () => {
    const { runtime, callbacks } = setup()
    runtime.activate('delete', 1)

    expect(callbacks.requestDelete).toHaveBeenCalledWith(1, occupied)
    expect(callbacks.activateSlot).not.toHaveBeenCalled()
  })

  it('exporte seulement un slot lisible et importe seulement vers un slot vide', () => {
    const { runtime, callbacks, corruptSaves } = setup()
    corruptSaves.set(3, { reason: 'Checksum invalide.', deletionToken: 'raw-token' as never })

    runtime.activate('export', 1)
    runtime.activate('import', 2)
    runtime.activate('import', 1)
    runtime.activate('import', 3)
    runtime.activate('export', 3)

    expect(callbacks.exportSave).toHaveBeenCalledOnce()
    expect(callbacks.exportSave).toHaveBeenCalledWith(1)
    expect(callbacks.importSave).toHaveBeenCalledOnce()
    expect(callbacks.importSave).toHaveBeenCalledWith(2)
    expect(callbacks.reportStatus).toHaveBeenCalledTimes(3)
  })

  it('préselectionne une source occupée ou une destination vide pour NG+', () => {
    const { runtime, callbacks } = setup()
    runtime.activate('new-game-plus', 1)
    runtime.activate('new-game-plus', 2)
    runtime.activate('new-game-plus')

    expect(callbacks.openNewGamePlus.mock.calls).toEqual([
      [{ sourceSlot: 1 }],
      [{ targetSlot: 2 }],
      [{}],
    ])
  })

  it('refuse les actions devenues obsolètes sans muter une partie', () => {
    const { runtime, callbacks } = setup()
    runtime.activate('continue', 2)
    runtime.activate('new-game', 1)
    runtime.activate('delete', 3)

    expect(callbacks.activateSlot).not.toHaveBeenCalled()
    expect(callbacks.requestDelete).not.toHaveBeenCalled()
    expect(callbacks.reportStatus).toHaveBeenCalledTimes(3)
    expect(callbacks.refresh).toHaveBeenCalledOnce()
  })

  it('garde un slot corrompu occupé, supprimable seulement par son action dédiée et hors NG+', () => {
    const { runtime, callbacks, corruptSaves } = setup()
    const corrupt = { reason: 'Checksum invalide.', deletionToken: 'raw-token' as never }
    corruptSaves.set(2, corrupt)

    runtime.activate('new-game', 2)
    runtime.activate('continue', 2)
    runtime.activate('new-game-plus', 2)
    runtime.activate('delete', 2)

    expect(callbacks.activateSlot).not.toHaveBeenCalled()
    expect(callbacks.openNewGamePlus).not.toHaveBeenCalled()
    expect(callbacks.requestDeleteCorrupt).toHaveBeenCalledWith(2, corrupt)
    expect(callbacks.reportStatus).toHaveBeenCalledTimes(3)
  })
})
