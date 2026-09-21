import { describe, expect, it } from 'vitest'
import type { HgssBrowserSaveSlotDeletionToken } from '../save/hgssSaveStorage'
import { createTitleSaveDeletionController } from './titleSaveDeletionController'

const details = {
  kind: 'readable' as const,
  slot: 2 as const,
  playerName: 'Célesta',
  summary: '42 h 17 · Ligue terminée',
  deletionToken: 'slot-2-exact-bytes' as HgssBrowserSaveSlotDeletionToken,
}

describe('createTitleSaveDeletionController', () => {
  it('ouvre toujours sur Annuler et ne confirme jamais par défaut', () => {
    const controller = createTitleSaveDeletionController()
    expect(controller.open(details)).toMatchObject({ open: true, cursor: 0 })
    expect(controller.handle('confirm')).toMatchObject({ kind: 'cancelled', state: { open: false } })
  })

  it('exige de sélectionner explicitement la suppression', () => {
    const controller = createTitleSaveDeletionController()
    controller.open(details)
    expect(controller.handle('right')).toMatchObject({ kind: 'state', state: { cursor: 1 } })
    expect(controller.handle('confirm')).toEqual({
      kind: 'confirmed',
      details,
      state: { open: false, cursor: 0 },
    })
  })

  it('gère le focus souris, le retour et les entrées hors dialogue', () => {
    const controller = createTitleSaveDeletionController()
    expect(controller.handle('confirm')).toEqual({ kind: 'ignored' })
    controller.open(details)
    expect(controller.focus(1).cursor).toBe(1)
    expect(controller.focus(8).cursor).toBe(1)
    expect(controller.handle('cancel')).toMatchObject({ kind: 'cancelled', state: { open: false } })
  })
})
