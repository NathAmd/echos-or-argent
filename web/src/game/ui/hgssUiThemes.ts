export const hgssUiThemes = [
  { key: 'hooh', speciesId: 250, nativeSkin: 4, accent: '#c79232', accentRgb: '199 146 50', bright: '#ffe29a', brightRgb: '255 226 154', paper: '#fff3d1', paperRgb: '255 243 209', ink: '#1d1608', panelRgb: '25 18 6', panelSoftRgb: '42 30 9', secondary: '#765015', secondaryRgb: '118 80 21', muted: '#c7ad79', glow: 'rgb(255 202 91 / .34)' },
  { key: 'lugia', speciesId: 249, nativeSkin: 0, accent: '#94a8b6', accentRgb: '148 168 182', bright: '#f4f8fa', brightRgb: '244 248 250', paper: '#e5edf2', paperRgb: '229 237 242', ink: '#071116', panelRgb: '8 14 18', panelSoftRgb: '19 29 35', secondary: '#596a76', secondaryRgb: '89 106 118', muted: '#aebbc3', glow: 'rgb(218 237 247 / .32)' },
  { key: 'rayquaza', speciesId: 384, nativeSkin: 2, accent: '#279768', accentRgb: '39 151 104', bright: '#80efb4', brightRgb: '128 239 180', paper: '#dcf8e8', paperRgb: '220 248 232', ink: '#05180f', panelRgb: '3 20 13', panelSoftRgb: '7 36 23', secondary: '#125a3c', secondaryRgb: '18 90 60', muted: '#8db8a0', glow: 'rgb(52 225 145 / .32)' },
  { key: 'giratina', speciesId: 487, nativeSkin: 1, accent: '#5b466b', accentRgb: '91 70 107', bright: '#b39ac1', brightRgb: '179 154 193', paper: '#d8d0dc', paperRgb: '216 208 220', ink: '#050407', panelRgb: '3 2 5', panelSoftRgb: '12 8 15', secondary: '#24192a', secondaryRgb: '36 25 42', muted: '#8d8094', glow: 'rgb(111 78 133 / .34)' },
  { key: 'pikachu', speciesId: 25, nativeSkin: 4, accent: '#d3ad18', accentRgb: '211 173 24', bright: '#ffe66b', brightRgb: '255 230 107', paper: '#fff6cf', paperRgb: '255 246 207', ink: '#211805', panelRgb: '29 22 5', panelSoftRgb: '47 36 8', secondary: '#7f5e0e', secondaryRgb: '127 94 14', muted: '#c8b985', glow: 'rgb(255 215 54 / .32)' },
  { key: 'charizard', speciesId: 6, nativeSkin: 3, accent: '#d85b2f', accentRgb: '216 91 47', bright: '#ffb04a', brightRgb: '255 176 74', paper: '#ffe5ca', paperRgb: '255 229 202', ink: '#211008', panelRgb: '31 10 5', panelSoftRgb: '52 19 8', secondary: '#812619', secondaryRgb: '129 38 25', muted: '#c9a083', glow: 'rgb(255 101 45 / .32)' },
  { key: 'suicune', speciesId: 245, nativeSkin: 5, accent: '#3f95c4', accentRgb: '63 149 196', bright: '#aeeaff', brightRgb: '174 234 255', paper: '#e2f6ff', paperRgb: '226 246 255', ink: '#04151e', panelRgb: '4 17 25', panelSoftRgb: '7 31 45', secondary: '#174f74', secondaryRgb: '23 79 116', muted: '#9abaca', glow: 'rgb(83 190 240 / .32)' },
  { key: 'celebi', speciesId: 251, nativeSkin: 2, accent: '#65a84d', accentRgb: '101 168 77', bright: '#c9ef8d', brightRgb: '201 239 141', paper: '#ecf7d9', paperRgb: '236 247 217', ink: '#0a1907', panelRgb: '8 24 6', panelSoftRgb: '15 41 11', secondary: '#346f32', secondaryRgb: '52 111 50', muted: '#a7bd91', glow: 'rgb(132 211 91 / .3)' },
] as const

export type HgssUiTheme = (typeof hgssUiThemes)[number]

const themeProperties: ReadonlyArray<readonly [keyof HgssUiTheme, string]> = [
  ['accent', '--ui-theme-accent'], ['accentRgb', '--ui-theme-accent-rgb'],
  ['bright', '--ui-theme-bright'], ['brightRgb', '--ui-theme-bright-rgb'],
  ['paper', '--ui-theme-paper'], ['paperRgb', '--ui-theme-paper-rgb'],
  ['ink', '--ui-theme-ink'], ['panelRgb', '--ui-theme-panel-rgb'],
  ['panelSoftRgb', '--ui-theme-panel-soft-rgb'], ['secondary', '--ui-theme-secondary'],
  ['secondaryRgb', '--ui-theme-secondary-rgb'], ['muted', '--ui-theme-muted'],
  ['glow', '--ui-theme-glow'],
]

export function resolveHgssUiTheme(themeIndex: number): HgssUiTheme {
  const normalizedIndex = Number.isInteger(themeIndex) && themeIndex >= 0 && themeIndex < hgssUiThemes.length ? themeIndex : 0
  return hgssUiThemes[normalizedIndex]!
}

function applyThemeProperties(root: HTMLElement, theme: HgssUiTheme): void {
  for (const [property, cssVariable] of themeProperties) root.style.setProperty(cssVariable, String(theme[property]))
}

export function applyHgssUiTheme(root: HTMLElement, themeIndex: number): void {
  const theme = resolveHgssUiTheme(themeIndex)
  root.dataset.uiTheme = theme.key
  applyThemeProperties(root, theme)
}

export function applyHgssUiThemePreview(root: HTMLElement, themeIndex: number): void {
  const theme = resolveHgssUiTheme(themeIndex)
  root.dataset.theme = theme.key
  applyThemeProperties(root, theme)
}

export function resolveHgssUiThemeNames(speciesNames: readonly string[]): string[] {
  return hgssUiThemes.map(({ speciesId }) => speciesNames[speciesId] ?? '')
}
