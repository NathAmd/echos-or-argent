export type PokegearNavigationDirection = 'left' | 'right' | 'up' | 'down'
export type PokegearGridKind = 'themes' | 'marking-icons' | 'marking-words'

/** Moves to the previous or next received station slot, with wrap-around. */
export function movePokegearStationCursor(
  availableSlots: readonly number[],
  currentSlot: number | undefined,
  step: -1 | 1,
): number | undefined {
  const slots = [...new Set(availableSlots)]
  if (slots.length === 0) return undefined

  const currentIndex = slots.indexOf(currentSlot ?? Number.NaN)
  if (currentIndex < 0) return slots[0]
  return slots[(currentIndex + step + slots.length) % slots.length]
}

/**
 * Mirrors the three responsive Pokematos grids declared in pokegear.css.
 * Keeping this decision pure lets keyboard and gamepad navigation match the
 * visual grid without reading layout from the DOM.
 */
export function getPokegearGridColumnCount(kind: PokegearGridKind, viewportWidth: number): number {
  const mobile = Number.isFinite(viewportWidth) && viewportWidth <= 640
  const tablet = Number.isFinite(viewportWidth) && viewportWidth <= 900
  if (kind === 'themes') return mobile ? 2 : tablet ? 3 : 4
  if (kind === 'marking-icons') return mobile ? 4 : 8
  return mobile ? 2 : 3
}

/**
 * Moves through a CSS grid with wrap-around. Vertical movement preserves the
 * visual column and wraps to the opposite edge, including incomplete rows.
 */
export function movePokegearGridCursor(
  itemCount: number,
  currentIndex: number | undefined,
  direction: PokegearNavigationDirection,
  columns: number,
): number | undefined {
  const count = Math.max(0, Math.floor(itemCount))
  if (count === 0) return undefined
  const current = currentIndex !== undefined && Number.isInteger(currentIndex) && currentIndex >= 0 && currentIndex < count
    ? currentIndex
    : 0
  const safeColumns = Math.max(1, Math.floor(columns))

  if (direction === 'left' || direction === 'right') {
    const step = direction === 'left' ? -1 : 1
    return (current + step + count) % count
  }

  const column = current % safeColumns
  if (direction === 'down') {
    const below = current + safeColumns
    return below < count ? below : Math.min(column, count - 1)
  }

  const above = current - safeColumns
  if (above >= 0) return above
  const lastInColumn = column + Math.floor((count - 1 - column) / safeColumns) * safeColumns
  return lastInColumn >= 0 && lastInColumn < count ? lastInColumn : current
}
