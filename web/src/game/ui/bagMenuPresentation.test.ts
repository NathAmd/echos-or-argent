import { describe, expect, it } from 'vitest'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import { getFirstBagActionIndex, moveBagMenuCursor } from './bagMenuPresentation'

const items: MainMenuItem[] = [
  { id: 'bag-pocket:1', label: 'Médicaments', kind: 'command' },
  { id: 'bag-pocket:2', label: 'Objets', kind: 'command' },
  { id: 'bag-item:17', label: 'Potion', kind: 'command' },
  { id: 'bag-item:18', label: 'Antidote', kind: 'command' },
  { id: 'bag-use:17:0', label: 'Utiliser', kind: 'command' },
  { id: 'bag-give:17:0', label: 'Donner', kind: 'command' },
  { id: 'bag-action-cancel:17', label: 'Annuler', kind: 'command' },
  { id: 'root', label: 'Retour', kind: 'screen' },
]

function state(cursor: number): MainMenuState {
  return { open: true, screen: 'bag', cursor, items }
}

describe('navigation du Sac', () => {
  it('reste dans la colonne verticale puis passe horizontalement aux objets', () => {
    expect(moveBagMenuCursor(state(0), 'down', false)).toBe(1)
    expect(moveBagMenuCursor(state(1), 'right', false)).toBe(2)
    expect(moveBagMenuCursor(state(2), 'down', false)).toBe(3)
    expect(moveBagMenuCursor(state(3), 'left', false)).toBe(0)
  })

  it('confine la navigation aux actions lorsque la fenêtre de choix est ouverte', () => {
    expect(getFirstBagActionIndex(state(2))).toBe(4)
    expect(moveBagMenuCursor(state(4), 'down', true)).toBe(5)
    expect(moveBagMenuCursor(state(5), 'down', true)).toBe(6)
    expect(moveBagMenuCursor(state(6), 'down', true)).toBe(4)
  })
})
