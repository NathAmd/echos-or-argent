import { describe, expect, it } from 'vitest'
import {
  createSafariCustomizerModel,
  createSafariDecoratorModel,
  moveSafariGridCursor,
  updateSafariCustomizer,
  updateSafariDecorator,
  type SafariCustomizerModel,
  type SafariDecoratorModel,
} from './safariUiModel'

function customizerInput(model: SafariCustomizerModel, action: Parameters<typeof updateSafariCustomizer>[1]): ReturnType<typeof updateSafariCustomizer> {
  return updateSafariCustomizer(model, action)
}

function decoratorInput(model: SafariDecoratorModel, action: Parameters<typeof updateSafariDecorator>[1]): ReturnType<typeof updateSafariDecorator> {
  return updateSafariDecorator(model, action)
}

describe('Safari wrapping grid navigation', () => {
  it('wraps horizontal rows and preserves the column vertically', () => {
    expect(moveSafariGridCursor(0, 12, 4, 'left')).toBe(3)
    expect(moveSafariGridCursor(3, 12, 4, 'right')).toBe(0)
    expect(moveSafariGridCursor(1, 12, 4, 'up')).toBe(9)
    expect(moveSafariGridCursor(9, 12, 4, 'down')).toBe(1)
  })

  it('keeps a partial last row reachable without selecting an absent cell', () => {
    expect(moveSafariGridCursor(1, 5, 3, 'up')).toBe(4)
    expect(moveSafariGridCursor(4, 5, 3, 'down')).toBe(1)
    expect(moveSafariGridCursor(4, 5, 3, 'right')).toBe(3)
  })
})

describe('Safari Customizer model', () => {
  it('suit slots -> ECHANGER et ouvre le YesNo ROM sur NON pour protéger le changement destructif', () => {
    let model = createSafariCustomizerModel(
      [0, 1, 2, 3, 4, 5],
      [[1, 2, 3, 4, 5], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      true,
    )
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    expect(model.phase).toBe('menu')
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    const pending = customizerInput(model, { kind: 'activate-area', areaId: 7 })
    expect(pending.model).toMatchObject({
      phase: 'confirmation',
      confirmationCursor: 1,
      pendingChange: { operation: 'replace', sourceSlot: 0, targetAreaId: 7 },
    })

    const noSelected = customizerInput(pending.model, { kind: 'focus-confirmation', choice: 1 }).model
    const cancelled = customizerInput(noSelected, { kind: 'input', action: 'confirm' })
    expect(cancelled.effect).toBeUndefined()
    expect(cancelled.model).toMatchObject({ phase: 'areas', areas: [0, 1, 2, 3, 4, 5] })

    model = customizerInput(cancelled.model, { kind: 'activate-area', areaId: 7 }).model
    model = customizerInput(model, { kind: 'focus-confirmation', choice: 0 }).model
    const committed = customizerInput(model, { kind: 'input', action: 'confirm' })
    expect(committed.effect).toEqual({
      kind: 'commit',
      change: {
        operation: 'replace',
        sourceSlot: 0,
        targetAreaId: 7,
        areas: [7, 1, 2, 3, 4, 5],
      },
    })
    expect(committed.model).toMatchObject({ phase: 'slots', areas: [7, 1, 2, 3, 4, 5] })
    expect(committed.model.blockCounts[0]).toEqual([0, 0, 0, 0, 0])
  })

  it('ECHANGER peut dupliquer une zone active et applique immédiatement avant le déblocage des Blocs', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5])
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    const committed = customizerInput(model, { kind: 'activate-area', areaId: 3 })
    expect(committed.effect).toEqual({
      kind: 'commit',
      change: {
        operation: 'replace',
        sourceSlot: 0,
        targetAreaId: 3,
        areas: [3, 1, 2, 3, 4, 5],
      },
    })
    expect(committed.model).toMatchObject({ phase: 'slots', areas: [3, 1, 2, 3, 4, 5] })
  })

  it('ORDRE est le seul échange et conserve les compteurs des deux structures de zone', () => {
    let model = createSafariCustomizerModel(
      [0, 1, 2, 3, 4, 5],
      [[1, 0, 0, 0, 0], [0, 2, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0], [0, 0, 0, 0, 0]],
      true,
    )
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 1 }).model
    expect(model).toMatchObject({ phase: 'order', slotCursor: 0, orderCursor: 0 })
    const committed = customizerInput(model, { kind: 'activate-order-slot', slot: 1 })
    expect(committed.effect).toEqual({
      kind: 'commit',
      change: {
        operation: 'swap',
        sourceSlot: 0,
        targetAreaId: 1,
        swappedSlot: 1,
        areas: [1, 0, 2, 3, 4, 5],
      },
    })
    expect(committed.model.blockCounts.slice(0, 2)).toEqual([[0, 2, 0, 0, 0], [1, 0, 0, 0, 0]])
  })

  it('revient confirmation -> catalogue -> slots puis ferme sans relancer une couche', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5], undefined, true)
    model = customizerInput(model, { kind: 'input', action: 'confirm' }).model
    model = customizerInput(model, { kind: 'input', action: 'confirm' }).model
    model = customizerInput(model, { kind: 'activate-area', areaId: 8 }).model
    model = customizerInput(model, { kind: 'input', action: 'cancel' }).model
    expect(model.phase).toBe('areas')
    model = customizerInput(model, { kind: 'input', action: 'cancel' }).model
    expect(model.phase).toBe('slots')
    expect(customizerInput(model, { kind: 'input', action: 'cancel' }).effect).toEqual({ kind: 'close' })
  })

  it('garde le catalogue ouvert quand ECHANGER sélectionne la zone source', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5])
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    const unchanged = customizerInput(model, { kind: 'activate-area', areaId: 0 })
    expect(unchanged.effect).toBeUndefined()
    expect(unchanged.model.phase).toBe('areas')
  })

  it('reproduit la rangée virtuelle RETOUR à trois colonnes dans slots, catalogue et ORDRE', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5])
    model = customizerInput(model, { kind: 'focus-slot', slot: 4 }).model
    model = customizerInput(model, { kind: 'input', action: 'down' }).model
    expect(model.returnColumn).toBe(1)
    model = customizerInput(model, { kind: 'input', action: 'up' }).model
    expect(model).toMatchObject({ slotCursor: 4, returnColumn: undefined })

    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    model = customizerInput(model, { kind: 'focus-area', areaId: 2 }).model
    model = customizerInput(model, { kind: 'input', action: 'up' }).model
    expect(model.returnColumn).toBe(2)
    expect(customizerInput(model, { kind: 'input', action: 'confirm' }).model.phase).toBe('slots')
  })

  it('franchit les pages ECHANGER uniquement à la jonction 5/6 et suit les rangées visibles', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5], undefined, true)
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model

    model = customizerInput(model, { kind: 'focus-area', areaId: 2 }).model
    model = customizerInput(model, { kind: 'input', action: 'right' }).model
    expect(model.areaCursor).toBe(0)
    model = customizerInput(model, { kind: 'input', action: 'left' }).model
    expect(model.areaCursor).toBe(2)

    model = customizerInput(model, { kind: 'focus-area', areaId: 5 }).model
    model = customizerInput(model, { kind: 'input', action: 'right' }).model
    expect(model.areaCursor).toBe(6)
    model = customizerInput(model, { kind: 'input', action: 'left' }).model
    expect(model.areaCursor).toBe(5)
  })

  it('oriente OUI/NON sur les deux axes et conserve NON comme choix initial', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5], undefined, true)
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    model = customizerInput(model, { kind: 'activate-area', areaId: 8 }).model
    expect(model.confirmationCursor).toBe(1)
    expect(customizerInput(model, { kind: 'input', action: 'left' }).model.confirmationCursor).toBe(0)
    expect(customizerInput(model, { kind: 'input', action: 'up' }).model.confirmationCursor).toBe(0)
    expect(customizerInput(model, { kind: 'input', action: 'right' }).model.confirmationCursor).toBe(1)
    expect(customizerInput(model, { kind: 'input', action: 'down' }).model.confirmationCursor).toBe(1)
  })

  it('garde RETOUR sélectionné quand une commande de page est déjà au bord', () => {
    let model = createSafariCustomizerModel([0, 1, 2, 3, 4, 5])
    model = customizerInput(model, { kind: 'activate-slot', slot: 0 }).model
    model = customizerInput(model, { kind: 'activate-menu', choice: 0 }).model
    model = customizerInput(model, { kind: 'focus-return', column: 1 }).model
    model = customizerInput(model, { kind: 'input', action: 'page-previous' }).model
    expect(model).toMatchObject({ areaCursor: 0, returnColumn: 1 })
  })

  it('rejects malformed arrangements at the model boundary', () => {
    expect(() => createSafariCustomizerModel([0, 1, 2])).toThrow()
    expect(createSafariCustomizerModel([0, 1, 2, 3, 4, 4]).areas).toEqual([0, 1, 2, 3, 4, 4])
    expect(() => createSafariCustomizerModel([0, 1, 2, 3, 4, 12])).toThrow()
    expect(() => createSafariCustomizerModel([0, 1, 2, 3, 4, 5], [[0, 0]])).toThrow()
  })
})

describe('Safari Decorator selector model', () => {
  it('présélectionne NON et émet l’objet seulement après confirmation explicite', () => {
    let model = createSafariDecoratorModel([0, 6, 23])
    model = decoratorInput(model, { kind: 'focus-object', index: 2 }).model
    model = decoratorInput(model, { kind: 'input', action: 'confirm' }).model
    expect(model).toMatchObject({ phase: 'confirmation', cursor: 2, confirmationCursor: 1 })
    model = decoratorInput(model, { kind: 'focus-confirmation', choice: 1 }).model
    const cancelled = decoratorInput(model, { kind: 'input', action: 'confirm' })
    expect(cancelled.effect).toBeUndefined()
    expect(cancelled.model.phase).toBe('objects')

    model = decoratorInput(cancelled.model, { kind: 'activate-object', index: 2 }).model
    model = decoratorInput(model, { kind: 'focus-confirmation', choice: 0 }).model
    expect(decoratorInput(model, { kind: 'input', action: 'confirm' }).effect).toEqual({
      kind: 'select',
      objectId: 23,
    })
  })

  it('sélectionne RETOUR dans un catalogue vide pour que A/Entrée puisse fermer', () => {
    const model = createSafariDecoratorModel([])
    expect(model.returnColumn).toBe(0)
    expect(decoratorInput(model, { kind: 'input', action: 'confirm' }).effect).toEqual({ kind: 'close' })
    expect(decoratorInput(model, { kind: 'input', action: 'cancel' }).effect).toEqual({ kind: 'close' })
  })

  it('keeps a native unavailable Block focusable and opens its ROM notice instead of selecting it', () => {
    let model = createSafariDecoratorModel([
      { objectId: 6, unavailableReason: 2 },
      { objectId: 10 },
    ])
    const blocked = decoratorInput(model, { kind: 'input', action: 'confirm' })
    expect(blocked.effect).toBeUndefined()
    expect(blocked.model).toMatchObject({ phase: 'notice', cursor: 0, noticeReason: 2 })

    model = decoratorInput(blocked.model, { kind: 'input', action: 'right' }).model
    expect(model).toMatchObject({ phase: 'objects', cursor: 0 })
    expect(model.noticeReason).toBeUndefined()
    model = decoratorInput(model, { kind: 'input', action: 'right' }).model
    expect(model.cursor).toBe(1)
  })

  it('n’affiche logiquement que six Blocs par page et conserve la case locale entre les pages', () => {
    let model = createSafariDecoratorModel(Array.from({ length: 24 }, (_, objectId) => objectId))
    model = decoratorInput(model, { kind: 'focus-object', index: 3 }).model
    model = decoratorInput(model, { kind: 'input', action: 'right' }).model
    expect(model.cursor).toBe(9)
    model = decoratorInput(model, { kind: 'input', action: 'page-next' }).model
    expect(model.cursor).toBe(15)
    model = decoratorInput(model, { kind: 'input', action: 'page-previous' }).model
    expect(model.cursor).toBe(9)
  })

  it.each([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23])(
    'reste sur la dernière carte d’un catalogue impair de %i Blocs quand la cellule droite est absente',
    (count) => {
      let model = createSafariDecoratorModel(Array.from({ length: count }, (_, objectId) => objectId))
      model = decoratorInput(model, { kind: 'focus-object', index: count - 1 }).model
      expect(() => decoratorInput(model, { kind: 'input', action: 'right' })).not.toThrow()
      expect(decoratorInput(model, { kind: 'input', action: 'right' }).model.cursor).toBe(count - 1)
    },
  )

  it('reproduit la quatrième ligne virtuelle RETOUR des deux colonnes natives', () => {
    let model = createSafariDecoratorModel([0, 1, 2, 3, 4, 5])
    model = decoratorInput(model, { kind: 'focus-object', index: 4 }).model
    model = decoratorInput(model, { kind: 'input', action: 'down' }).model
    expect(model.returnColumn).toBe(0)
    model = decoratorInput(model, { kind: 'input', action: 'left' }).model
    expect(model.returnColumn).toBe(0)
    model = decoratorInput(model, { kind: 'input', action: 'up' }).model
    expect(model).toMatchObject({ cursor: 4, returnColumn: undefined })
    model = decoratorInput(model, { kind: 'focus-object', index: 1 }).model
    model = decoratorInput(model, { kind: 'input', action: 'up' }).model
    expect(model.returnColumn).toBe(1)
    expect(decoratorInput(model, { kind: 'input', action: 'confirm' }).effect).toEqual({ kind: 'close' })
  })

  it('oriente OUI/NON du décorateur sur les deux axes et démarre sur NON', () => {
    let model = createSafariDecoratorModel([0, 1, 2, 3, 4, 5])
    model = decoratorInput(model, { kind: 'activate-object', index: 0 }).model
    expect(model.confirmationCursor).toBe(1)
    expect(decoratorInput(model, { kind: 'input', action: 'left' }).model.confirmationCursor).toBe(0)
    expect(decoratorInput(model, { kind: 'input', action: 'up' }).model.confirmationCursor).toBe(0)
    expect(decoratorInput(model, { kind: 'input', action: 'right' }).model.confirmationCursor).toBe(1)
    expect(decoratorInput(model, { kind: 'input', action: 'down' }).model.confirmationCursor).toBe(1)
  })

  it('validates unlocked object IDs and duplicate entries', () => {
    expect(() => createSafariDecoratorModel([24])).toThrow()
    expect(() => createSafariDecoratorModel([0, 0])).toThrow()
    expect(() => createSafariDecoratorModel([{ objectId: 0, unavailableReason: 0 }])).toThrow()
    expect(() => createSafariDecoratorModel([{ objectId: 0, unavailableReason: 5 }])).toThrow()
  })
})
