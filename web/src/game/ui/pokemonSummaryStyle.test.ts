import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const summaryCss = readFileSync(new URL('../../styles/summary.css', import.meta.url), 'utf8')

describe('matière thématique du résumé Pokémon', () => {
  it('utilise les surfaces semi-transparentes partagées et la texture du thème', () => {
    expect(summaryCss).toContain('background: var(--ui-surface-shell);')
    expect(summaryCss.match(/background: var\(--ui-surface-panel\);/g)?.length).toBeGreaterThanOrEqual(2)
    expect(summaryCss).toContain('background-image: var(--ui-theme-texture);')
    expect(summaryCss).toContain('opacity: var(--ui-theme-texture-opacity);')
  })
})
