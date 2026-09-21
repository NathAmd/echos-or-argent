import { describe, expect, it } from 'vitest'
import type { MainMenuState } from '../menu/mainMenuController'
import { createOptionsMenuGroups } from './optionsMenuPresentation'

describe('modèle de présentation des Options', () => {
  it('garde une navigation linéaire et sépare réglages et commandes système', () => {
    const state: MainMenuState = {
      open: true,
      screen: 'options',
      cursor: 1,
      items: [
        { id: 'cycle-text-speed', label: '', kind: 'command' },
        { id: 'toggle-battle-animations', label: '', kind: 'command' },
        { id: 'save', label: '', kind: 'command' },
        { id: 'report-bug', label: '', kind: 'command' },
        { id: 'root', label: '', kind: 'screen' },
      ],
    }

    expect(createOptionsMenuGroups(state)).toEqual([
      { section: 'settings', entries: [
        { item: state.items[0], index: 0, adjustable: true },
        { item: state.items[1], index: 1, adjustable: true },
      ] },
      { section: 'system', entries: [
        { item: state.items[2], index: 2, adjustable: false },
        { item: state.items[3], index: 3, adjustable: false },
      ] },
    ])
  })
})
