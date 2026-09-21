import { describe, expect, it } from 'vitest'
import { createNewGamePlusCreationController } from './newGamePlusCreationController'

describe('createNewGamePlusCreationController', () => {
  it('compose plusieurs modules tout en gardant source et destination séparées', () => {
    const controller = createNewGamePlusCreationController()
    const state = controller.open({
      sources: [{ slot: 1, playerName: 'OR', summary: '16 badges' }],
      targets: [2, 3],
      modules: [
        { id: 'carry-pokedex', title: 'Pokédex', description: '', configChoices: [{ label: 'Standard', config: {} }] },
        { id: 'carry-money', title: 'Argent', description: '', configChoices: [{ label: 'Standard', config: { percentage: 100 } }] },
      ],
    })
    const firstModule = state.items.findIndex((item) => item.kind === 'module')
    controller.focus(firstModule)
    controller.handle('confirm')
    controller.focus(firstModule + 1)
    controller.handle('confirm')
    controller.focus(state.items.findIndex((item) => item.kind === 'submit'))

    expect(controller.handle('confirm')).toEqual(expect.objectContaining({
      kind: 'created',
      selection: { sourceSlot: 1, targetSlot: 2, modules: [
        { id: 'carry-pokedex', config: {} },
        { id: 'carry-money', config: { percentage: 100 } },
      ] },
    }))
    expect(controller.getState().open).toBe(true)
    controller.resolveCreation(true)
    expect(controller.getState().open).toBe(false)
  })

  it('conserve le choix configuré d’un module dans la sélection créée', () => {
    const controller = createNewGamePlusCreationController()
    const state = controller.open({
      sources: [{ slot: 1, playerName: 'OR', summary: '16 badges' }], targets: [2],
      modules: [{ id: 'monotype', title: 'Monotype', description: '', configChoices: [
        { label: 'Feu', config: { typeId: 10 } },
        { label: 'Eau', config: { typeId: 11 } },
      ] }],
    })
    const moduleIndex = state.items.findIndex((item) => item.kind === 'module')
    controller.focus(moduleIndex)
    controller.handle('confirm')
    controller.handle('right')
    controller.focus(state.items.findIndex((item) => item.kind === 'submit'))

    expect(controller.handle('confirm')).toMatchObject({
      kind: 'created',
      selection: { modules: [{ id: 'monotype', config: { typeId: 11 } }] },
    })
  })

  it('conserve tout le draft lorsque la validation finale refuse la création', () => {
    const controller = createNewGamePlusCreationController()
    const state = controller.open({
      sources: [
        { slot: 1, playerName: 'OR', summary: '16 badges' },
        { slot: 2, playerName: 'ARGENT', summary: '16 badges' },
      ],
      targets: [3],
      modules: [{ id: 'monotype', title: 'Monotype', description: '', configChoices: [
        { label: 'Feu', config: { typeId: 10 } },
        { label: 'Eau', config: { typeId: 11 } },
      ] }],
    })
    controller.focus(state.items.findIndex((item) => item.kind === 'source' && item.slot === 2))
    controller.handle('confirm')
    controller.focus(state.items.findIndex((item) => item.kind === 'target' && item.slot === 3))
    controller.handle('confirm')
    const moduleIndex = state.items.findIndex((item) => item.kind === 'module')
    controller.focus(moduleIndex)
    controller.handle('confirm')
    controller.configureModule('monotype', 1)
    controller.focus(state.items.findIndex((item) => item.kind === 'submit'))
    const draft = controller.getState()

    expect(controller.handle('confirm')).toMatchObject({
      kind: 'created',
      selection: {
        sourceSlot: 2,
        targetSlot: 3,
        modules: [{ id: 'monotype', config: { typeId: 11 } }],
      },
    })
    expect(controller.resolveCreation(false)).toEqual(draft)
    expect(controller.getState()).toEqual(draft)
  })

  it('reste ouvert et sûr lorsqu’aucun emplacement vide n’existe', () => {
    const controller = createNewGamePlusCreationController()
    const state = controller.open({
      sources: [{ slot: 1, playerName: 'OR', summary: 'Ligue terminée' }],
      targets: [],
      modules: [],
    })
    controller.focus(state.items.findIndex((item) => item.kind === 'submit'))
    expect(controller.handle('confirm')).toMatchObject({ kind: 'state', state: { open: true, targetSlot: undefined } })
  })

  it('préselectionne la source ou la destination demandée depuis la fiche Continuer', () => {
    const controller = createNewGamePlusCreationController()
    expect(controller.open({
      sources: [
        { slot: 1, playerName: 'OR', summary: 'Ligue terminée' },
        { slot: 3, playerName: 'ARGENT', summary: 'Ligue terminée' },
      ],
      targets: [2],
      modules: [],
      preferredSourceSlot: 3,
      preferredTargetSlot: 2,
    })).toMatchObject({ sourceSlot: 3, targetSlot: 2 })
  })

  it('retombe sur les premiers choix valides si une préférence est devenue obsolète', () => {
    const controller = createNewGamePlusCreationController()
    expect(controller.open({
      sources: [{ slot: 1, playerName: 'OR', summary: 'Ligue terminée' }],
      targets: [2],
      modules: [],
      preferredSourceSlot: 3,
      preferredTargetSlot: 3,
    })).toMatchObject({ sourceSlot: 1, targetSlot: 2 })
  })
})
