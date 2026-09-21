export type HgssDialogPageOptions = {
  maxColumns?: number
  maxLines?: number
}

export function getResponsiveHgssDialogColumns(viewportWidth: number): number {
  if (!Number.isFinite(viewportWidth) || viewportWidth <= 0) return 52
  if (viewportWidth <= 430) return 40
  if (viewportWidth <= 760) return 48
  return 64
}

function wrapLine(line: string, maxColumns: number): string[] {
  const words = line.trim().split(/\s+/).filter(Boolean)
  if (words.length === 0) return ['']
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word
    if (candidate.length <= maxColumns || current.length === 0) {
      current = candidate
      continue
    }
    lines.push(current)
    current = word
  }
  if (current) lines.push(current)
  return lines
}

/**
 * Reproduit la structure des fenêtres de messages HGSS : deux lignes visibles,
 * retour ligne explicite (E000) et attente/effacement explicite (25BC/25BD).
 */
export function splitHgssDialogPages(
  message: string,
  { maxColumns = 52, maxLines = 2 }: HgssDialogPageOptions = {},
): string[] {
  if (!Number.isInteger(maxColumns) || maxColumns < 1) throw new Error('La largeur du dialogue HGSS est invalide.')
  if (!Number.isInteger(maxLines) || maxLines < 1) throw new Error('Le nombre de lignes du dialogue HGSS est invalide.')

  const explicitPages = message
    .replace(/[ \t]+([\n\r\f])/g, '$1')
    .split(/[\r\f]/)
  const pages: string[] = []
  for (const explicitPage of explicitPages) {
    const lines = explicitPage.split('\n').flatMap((line) => wrapLine(line, maxColumns))
    for (let index = 0; index < lines.length; index += maxLines) {
      pages.push(lines.slice(index, index + maxLines).join('\n').trim())
    }
  }
  return pages.filter((page, index) => page.length > 0 || index === 0).length > 0
    ? pages.filter((page, index) => page.length > 0 || index === 0)
    : ['']
}
