import { describe, expect, it } from 'vitest'
import { applyHgssUiTheme, applyHgssUiThemePreview, hgssUiThemes, resolveHgssUiTheme, resolveHgssUiThemeNames } from './hgssUiThemes'

describe('HGSS UI themes', () => {
  it('falls back to the first ROM-backed theme for invalid indexes', () => {
    expect(resolveHgssUiTheme(-1)).toBe(hgssUiThemes[0])
    expect(resolveHgssUiTheme(99)).toBe(hgssUiThemes[0])
    expect(resolveHgssUiTheme(Number.NaN)).toBe(hgssUiThemes[0])
  })

  it('keeps every theme tied to its ROM species name and a complete palette', () => {
    const names = Array.from({ length: 500 }, (_, index) => `species-${index}`)
    expect(resolveHgssUiThemeNames(names)).toEqual(hgssUiThemes.map(({ speciesId }) => `species-${speciesId}`))
    for (const theme of hgssUiThemes) {
      expect(theme.nativeSkin).toBeGreaterThanOrEqual(0)
      expect(theme.nativeSkin).toBeLessThan(6)
      expect(theme.accentRgb).toMatch(/^\d+ \d+ \d+$/)
      expect(theme.panelRgb).toMatch(/^\d+ \d+ \d+$/)
      expect(theme.paper).toMatch(/^#[\da-f]{6}$/i)
    }
  })

  it('applies the complete palette to the game root and to an isolated preview', () => {
    const createRoot = () => {
      const properties = new Map<string, string>()
      const root = { dataset: {}, style: { setProperty: (name: string, value: string) => properties.set(name, value) } } as unknown as HTMLElement
      return { root, properties }
    }
    const game = createRoot()
    applyHgssUiTheme(game.root, 1)
    expect(game.root.dataset.uiTheme).toBe('lugia')
    expect(game.properties.get('--ui-theme-accent')).toBe(hgssUiThemes[1].accent)
    expect(game.properties.get('--ui-theme-panel-rgb')).toBe(hgssUiThemes[1].panelRgb)

    const preview = createRoot()
    applyHgssUiThemePreview(preview.root, 6)
    expect(preview.root.dataset.theme).toBe('suicune')
    expect(preview.properties.get('--ui-theme-secondary')).toBe(hgssUiThemes[6].secondary)
  })
})
