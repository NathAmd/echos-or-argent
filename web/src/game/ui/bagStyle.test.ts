import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const bagCss = readFileSync(new URL('../../styles/bag.css', import.meta.url), 'utf8')
const romUiTheme = readFileSync(new URL('./romUiTheme.ts', import.meta.url), 'utf8')

describe('contrat visuel du Sac', () => {
  it('laisse le fond et le chrome au shell de menu partagé', () => {
    expect(bagCss).not.toContain('--ui-rom-bag-background')
    expect(bagCss).not.toContain('--ui-rom-bag-pocket-panel')
    expect(bagCss).not.toContain("#app .runtime-panel #game-menu.ui-menu.ui-menu-detail[data-screen='bag']")
    expect(bagCss).toContain('background: var(--ui-surface-soft);')
  })

  it('ne sérialise plus les anciens écrans du Sac en arrière-plans CSS globaux', () => {
    expect(romUiTheme).not.toContain("setProperty('--ui-rom-bag-background'")
    expect(romUiTheme).not.toContain("setProperty('--ui-rom-bag-pocket-panel'")
  })
})
