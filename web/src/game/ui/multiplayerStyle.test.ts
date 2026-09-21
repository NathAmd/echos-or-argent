import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const multiplayerCss = readFileSync(new URL('../../styles/multiplayer.css', import.meta.url), 'utf8')

describe('gabarit responsive du hub multijoueur', () => {
  it('adapte les quatre raccourcis en deux colonnes sur écran étroit', () => {
    expect(multiplayerCss).toContain('grid-template-columns: repeat(4, minmax(0, 1fr));')
    expect(multiplayerCss).toContain('@media (max-width: 680px)')
    expect(multiplayerCss).toContain('grid-template-columns: repeat(2, minmax(0, 1fr));')
  })

  it('garde les actions utiles de chaque ami dans une rangée adaptable', () => {
    expect(multiplayerCss).toContain('.multiplayer-shell-friend-actions {')
    expect(multiplayerCss).toContain('flex-wrap: wrap;')
  })

  it('présente un seul formulaire de compte à la fois avec des cibles console', () => {
    expect(multiplayerCss).toContain('.multiplayer-shell-account-forms,')
    expect(multiplayerCss).toContain('.multiplayer-shell-account-form[hidden] { display: none; }')
    expect(multiplayerCss).toContain('min-height: 44px;')
  })

  it('borne tous les écrans et interdit le scroll interne', () => {
    expect(multiplayerCss).toContain('.multiplayer-overlay-frame {')
    expect(multiplayerCss).toContain('height: min(640px, 100%);')
    expect(multiplayerCss).toContain('.multiplayer-shell-pagination { justify-content: center; }')
    expect(multiplayerCss).not.toMatch(/overflow(?:-y)?:\s*auto/)
    expect(multiplayerCss).not.toMatch(/overflow(?:-y)?:\s*scroll/)
  })

  it('réutilise le thème du jeu pour le burger sans recréer de clavier local', () => {
    expect(multiplayerCss).not.toContain('.multiplayer-global-menu {')
    expect(multiplayerCss).not.toContain('.multiplayer-global-menu-button {')
    expect(multiplayerCss).not.toContain('.multiplayer-text-keyboard')
  })

  it('laisse le burger d’accueil à l’air libre sans retirer le cadre des écrans métier', () => {
    const homeSelector = ".multiplayer-overlay-content[data-multiplayer-current-screen='home']"
    expect(multiplayerCss).toContain(`.multiplayer-overlay:has(${homeSelector}) {`)
    expect(multiplayerCss).toContain(`.multiplayer-overlay-frame:has(${homeSelector}) {`)
    expect(multiplayerCss).toContain('background: transparent;')
    expect(multiplayerCss).toContain('box-shadow: none;')
    expect(multiplayerCss).toContain(`.multiplayer-overlay-frame:has(${homeSelector}) > .multiplayer-overlay-header {`)
    expect(multiplayerCss).toContain(`${homeSelector} > .multiplayer-shell-surface {`)
    expect(multiplayerCss).toContain('display: contents;')
    expect(multiplayerCss).toContain('.multiplayer-global-page {')
    expect(multiplayerCss).toContain('background: var(--ui-surface-shell);')
  })

  it('met en scène les états réseau et échange avec le rythme discret des UI HGSS', () => {
    expect(multiplayerCss).toContain("[data-multiplayer-session-state='consent']")
    expect(multiplayerCss).toContain("[data-multiplayer-trade-state='committing']")
    expect(multiplayerCss).toContain("[data-multiplayer-trade-state='committed']")
    expect(multiplayerCss).toContain('@keyframes multiplayer-trade-send-local')
    expect(multiplayerCss).toContain('steps(4, end)')
    expect(multiplayerCss).toContain('@media (prefers-reduced-motion: reduce)')
  })
})
