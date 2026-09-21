import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const pokegearCss = readFileSync(new URL('../../styles/pokegear.css', import.meta.url), 'utf8')
const menuShellCss = readFileSync(new URL('../../styles/menu-shell.css', import.meta.url), 'utf8')

describe('gabarit responsive du Pokematos', () => {
  it('reserve a la Carte un canevas panoramique sans agrandir les autres applications', () => {
    expect(pokegearCss).toContain('#game-menu.ui-menu.ui-menu-detail:has(.pokegear-map-body)')
    expect(pokegearCss).toContain('width: min(1240px, calc(100% - 32px));')
    expect(pokegearCss).toContain('grid-template-columns: minmax(0, 1fr) minmax(210px, 250px);')
  })

  it('rend toute la largeur aux 47 colonnes ROM sur un ecran tactile portrait', () => {
    expect(pokegearCss).toContain('@media (max-width: 640px) and (orientation: portrait)')
    expect(pokegearCss).toContain('grid-template: auto minmax(0, 1fr) / minmax(0, 1fr);')
  })

  it("n'applique jamais la taille d'une icone generique aux canevas des applications", () => {
    expect(menuShellCss).toContain(":not([data-screen^='pokegear-']) .game-menu-rom-asset")
  })
})
