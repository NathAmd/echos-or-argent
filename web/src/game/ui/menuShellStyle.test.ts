import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const menuShellCss = readFileSync(new URL('../../styles/menu-shell.css', import.meta.url), 'utf8')
const foundationCss = readFileSync(new URL('../../styles/foundation.css', import.meta.url), 'utf8')
const fieldAppsCss = readFileSync(new URL('../../styles/field-apps.css', import.meta.url), 'utf8')
const modalCss = readFileSync(new URL('../../styles/modal.css', import.meta.url), 'utf8')
const safariCss = readFileSync(new URL('../../styles/safari.css', import.meta.url), 'utf8')
const titleCss = readFileSync(new URL('../../styles/title.css', import.meta.url), 'utf8')
const stylesIndex = readFileSync(new URL('../../styles/index.css', import.meta.url), 'utf8')
const runtimeOwnedStyles = [
  'choice.css',
  'menu-shell.css',
  'pc-box.css',
  'pokedex.css',
  'pokegear.css',
  'safari.css',
  'shop.css',
  'summary.css',
  'team.css',
  'title.css',
].map((name) => readFileSync(new URL(`../../styles/${name}`, import.meta.url), 'utf8'))

describe('contrat visuel du menu burger partagé', () => {
  it('applique le burger par composant et non uniquement à l’écran racine', () => {
    expect(menuShellCss).toContain('.ui-menu.ui-menu-root {')
    expect(menuShellCss).toContain('.ui-menu-root .ui-menu-navigation-root {')
    expect(menuShellCss).not.toContain('#game-menu.ui-menu.ui-menu-root {')
    expect(menuShellCss).not.toContain("ui-menu-root[data-screen='root']")
  })

  it('calcule le cadre depuis le panneau de jeu et non depuis la page', () => {
    expect(menuShellCss).toContain('width: min(390px, calc(100% - 36px));')
    expect(menuShellCss).toContain('width: min(860px, calc(100% - 28px));')
    expect(menuShellCss).toContain('height: min(620px, calc(100% - 28px), calc(var(--visual-viewport-height, 100svh) - 28px));')
    expect(menuShellCss).not.toContain('width: min(860px, calc(100vw - 28px));')
  })

  it('conserve le centrage après la minification CSS de production', () => {
    expect(menuShellCss).toContain('transform: translateY(-50%);')
    expect(menuShellCss).toContain('transform: translate(-50%, -50%);')
    expect(menuShellCss).toContain(
      'from { opacity: 0; transform: translate(-50%, calc(-50% + 8px)) scale(.995); }',
    )
    expect(menuShellCss).toContain('to { opacity: 1; transform: translate(-50%, -50%) scale(1); }')
    expect(menuShellCss).not.toContain('translate: 0 -50%;')
    expect(menuShellCss).not.toContain('translate: -50% -50%;')
  })

  it('rend la largeur du bouton consommée par son arc pour ne jamais sortir du burger', () => {
    expect(menuShellCss).toContain('width: min(calc(100% - var(--arc-offset, 0px)), 370px);')
    expect(menuShellCss).toContain('width: min(calc(100% - var(--arc-offset, 0px) - 7px), 392px);')
    expect(menuShellCss).not.toContain('width: min(calc(100% + 22px), 392px);')
  })

  it('conserve le conteneur générique dans la fondation et chaque écran dans son propriétaire', () => {
    expect(stylesIndex.trimEnd().endsWith("@import './multiplayer.css';")).toBe(true)
    expect(stylesIndex).not.toContain('viewport-guard.css')
    expect(foundationCss).toContain('container-type: size;')
    expect(menuShellCss).toContain('max-inline-size: calc(100cqw - var(--runtime-safe-left) - var(--runtime-safe-right));')
    expect(menuShellCss).toContain('max-block-size: calc(100cqh - var(--runtime-safe-top) - var(--runtime-safe-bottom));')
    expect(menuShellCss).toContain('.ui-menu-root .ui-menu-navigation-root {')
    expect(safariCss).toContain('.safari-ui-surface {')
    expect(safariCss).toContain('overscroll-behavior: contain;')
    expect(fieldAppsCss).toContain('.photo-album-surface {')
    expect(modalCss).toContain('calc(100cqh - var(--runtime-safe-top) - var(--runtime-safe-bottom))')
    expect(titleCss).toContain('.new-game-plus-panel {')
    expect(titleCss).toContain('overscroll-behavior: contain;')
  })

  it('ne dimensionne plus les panneaux enfants depuis la largeur de la page', () => {
    for (const css of runtimeOwnedStyles) {
      expect(css).not.toContain('100vw')
      expect(css).not.toContain('calc(100svh')
    }
  })

  it('arrête aussi la texture animée du titre lorsque les mouvements sont réduits', () => {
    expect(titleCss).toContain(`@media (prefers-reduced-motion: reduce) {
  #app .runtime-panel #game-menu.game-menu-title,
  #app .runtime-panel #game-menu.game-menu-title::before,`)
  })
})
