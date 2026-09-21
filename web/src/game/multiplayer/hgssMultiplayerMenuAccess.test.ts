import { describe, expect, it, vi } from 'vitest'
import type { MainMenuState } from '../menu/mainMenuController'
import { applyHgssMultiplayerMenuAccess } from './hgssMultiplayerMenuAccess'

const closedMenu: MainMenuState = Object.freeze({
  open: false,
  screen: 'root',
  cursor: 0,
  items: Object.freeze([]),
})

describe('accès rapide multijoueur du menu burger', () => {
  it('laisse le solo inchangé tant que la commande multijoueur n’est jamais activée', () => {
    const closeMenu = vi.fn(() => closedMenu)
    const renderMenu = vi.fn()
    const openMultiplayer = vi.fn()

    expect(applyHgssMultiplayerMenuAccess('save', { closeMenu, renderMenu, openMultiplayer })).toBe(false)
    expect(closeMenu).not.toHaveBeenCalled()
    expect(renderMenu).not.toHaveBeenCalled()
    expect(openMultiplayer).not.toHaveBeenCalled()
  })

  it('ferme et rend le burger avant d’ouvrir le dialogue multijoueur', () => {
    const order: string[] = []
    const closeMenu = vi.fn(() => { order.push('close'); return closedMenu })
    const renderMenu = vi.fn((state: MainMenuState) => { order.push(`render:${state.open}`) })
    const openMultiplayer = vi.fn(() => { order.push('open') })

    expect(applyHgssMultiplayerMenuAccess('multiplayer', { closeMenu, renderMenu, openMultiplayer })).toBe(true)
    expect(order).toEqual(['close', 'render:false', 'open'])
  })
})
