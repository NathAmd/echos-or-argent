import { describe, expect, it } from 'vitest'
import type { MainMenuItem, MainMenuState } from '../menu/mainMenuController'
import { moveTeamMenuCursor } from './teamMenuPresentation'

const items: MainMenuItem[] = [
  { id: 'team-member:0', label: 'Héricendre', kind: 'command' },
  { id: 'team-member:1', label: 'Fouinette', kind: 'command' },
  { id: 'team-member:2', label: 'Roucool', kind: 'command' },
  { id: 'team-summary:1', label: 'Résumé', kind: 'command' },
  { id: 'team-move-up:1', label: 'Monter', kind: 'command' },
  { id: 'team-move-down:1', label: 'Descendre', kind: 'command' },
  { id: 'root', label: 'Retour', kind: 'screen' },
]

function state(cursor: number): MainMenuState {
  return { open: true, screen: 'team', cursor, items }
}

describe('navigation du menu Équipe', () => {
  it('reste dans chaque colonne et passe horizontalement aux actions', () => {
    expect(moveTeamMenuCursor(state(1), 'down', 1)).toBe(2)
    expect(moveTeamMenuCursor(state(2), 'down', 1)).toBe(0)
    expect(moveTeamMenuCursor(state(1), 'right', 1)).toBe(3)
    expect(moveTeamMenuCursor(state(4), 'left', 1)).toBe(1)
    expect(moveTeamMenuCursor(state(4), 'down', 1)).toBe(5)
  })

  it('utilise les gâchettes pour changer de membre sans entrer dans les actions', () => {
    expect(moveTeamMenuCursor(state(4), 'page-previous', 1)).toBe(0)
    expect(moveTeamMenuCursor(state(4), 'page-next', 1)).toBe(2)
  })
})
