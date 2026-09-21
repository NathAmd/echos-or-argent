import { describe, expect, it } from 'vitest'
import { createTitleMenuController } from './titleMenuController'

describe('createTitleMenuController', () => {
  it('propose les trois slots sans fabriquer de libellé de présentation', () => {
    const menu = createTitleMenuController()
    const state = menu.open()
    expect(state.items.map(({ id }) => id)).toEqual(['slot-1', 'slot-2', 'slot-3'])
    expect(state.items.map(({ kind }) => kind)).toEqual(['save-slot', 'save-slot', 'save-slot'])
  })

  it('injecte l’action New Game+ seulement après son déblocage', () => {
    const menu = createTitleMenuController()
    expect(menu.open().items.map(({ id }) => id)).not.toContain('new-game-plus')
    expect(menu.open({ newGamePlusUnlocked: true }).items.map(({ id }) => id)).toEqual([
      'slot-1', 'slot-2', 'slot-3', 'new-game-plus',
    ])
  })

  it('confirme toujours un slot normal avant la carte NG+, même après déblocage', () => {
    const menu = createTitleMenuController()
    menu.open({ newGamePlusUnlocked: true })
    menu.focus(1)

    expect(menu.handle('confirm')).toMatchObject({ kind: 'choice', choice: 'slot-2' })
  })

  it('partage navigation cyclique, focus pointer, confirmation et annulation', () => {
    const menu = createTitleMenuController()
    menu.open()

    expect(menu.handle('up')).toMatchObject({ kind: 'state', state: { cursor: 2 } })
    expect(menu.handle('confirm')).toMatchObject({ kind: 'choice', choice: 'slot-3' })
    menu.focus(0)
    expect(menu.handle('confirm')).toMatchObject({ kind: 'choice', choice: 'slot-1' })
    expect(menu.handle('cancel')).toMatchObject({ kind: 'state', state: { open: false } })
  })
})
