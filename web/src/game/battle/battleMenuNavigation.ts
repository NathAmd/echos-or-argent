export type BattleMenuDirection = 'left' | 'right' | 'up' | 'down'

export interface BattleMenuNavigationPoint {
  x: number
  y: number
  enabled: boolean
}

/** The four semantic positions shared by the combat and Safari command arcs. */
const battleArcPoints = [
  { x: 0, y: 0 },
  { x: 1, y: 1 },
  { x: 1, y: 2 },
  { x: 1, y: 3 },
] as const

/** Navigation géométrique du menu de combat modernisé en grille, avec bouclage. */
export function moveBattleMenuCursor(
  cursor: number,
  itemCount: number,
  direction: BattleMenuDirection,
  columns = 2,
): number {
  if (itemCount <= 0) return 0
  const normalized = ((cursor % itemCount) + itemCount) % itemCount
  const safeColumns = Math.max(1, Math.min(columns, itemCount))
  if (direction === 'left' || direction === 'right') {
    const rowStart = Math.floor(normalized / safeColumns) * safeColumns
    const rowLength = Math.min(safeColumns, itemCount - rowStart)
    const column = normalized - rowStart
    const delta = direction === 'left' ? -1 : 1
    return rowStart + (column + delta + rowLength) % rowLength
  }
  const delta = direction === 'up' ? -safeColumns : safeColumns
  let candidate = normalized + delta
  while (candidate < 0) candidate += itemCount
  while (candidate >= itemCount) candidate -= itemCount
  return candidate
}

/** Conserve la géométrie visuelle quand certaines cases (PP à zéro, Sac vide…) sont verrouillées. */
export function moveBattleMenuCursorSkippingDisabled(
  cursor: number,
  enabled: readonly boolean[],
  direction: BattleMenuDirection,
  columns = 2,
): number {
  if (enabled.length === 0) return 0
  let candidate = ((cursor % enabled.length) + enabled.length) % enabled.length
  for (let step = 0; step < enabled.length; step += 1) {
    candidate = moveBattleMenuCursor(candidate, enabled.length, direction, columns)
    if (enabled[candidate]) return candidate
  }
  return ((cursor % enabled.length) + enabled.length) % enabled.length
}

/**
 * Choisit le voisin dans la direction réellement affichée à l'écran.
 * Les cases désactivées ne participent jamais au calcul et, au bord de la
 * disposition, le curseur reboucle depuis le côté opposé.
 */
export function moveBattleMenuCursorSpatially(
  cursor: number,
  points: readonly BattleMenuNavigationPoint[],
  direction: BattleMenuDirection,
): number {
  if (points.length === 0) return 0
  const normalized = ((cursor % points.length) + points.length) % points.length
  const origin = points[normalized]
  if (!origin) return 0
  const horizontal = direction === 'left' || direction === 'right'
  const sign = direction === 'left' || direction === 'up' ? -1 : 1
  const candidates = points
    .map((point, index) => {
      const primary = ((horizontal ? point.x - origin.x : point.y - origin.y) * sign)
      const perpendicular = Math.abs(horizontal ? point.y - origin.y : point.x - origin.x)
      return { index, enabled: point.enabled, primary, perpendicular }
    })
    .filter(({ index, enabled }) => enabled && index !== normalized)
  if (candidates.length === 0) return normalized
  if (candidates.every(({ primary }) => Math.abs(primary) <= .5)) return normalized
  const forward = candidates.filter(({ primary }) => primary > .5)
  if (forward.length > 0) {
    forward.sort((left, right) => (left.primary + left.perpendicular * 2) - (right.primary + right.perpendicular * 2))
    return forward[0]!.index
  }
  candidates.sort((left, right) => left.primary - right.primary || left.perpendicular - right.perpendicular)
  return candidates[0]!.index
}

/**
 * Resolves a neighbour from the stable semantic arc rather than animated DOM
 * bounds. Combat commands, attacks and Safari commands use these same four
 * visual slots, so keyboard and gamepad navigation must share this graph too.
 */
export function moveBattleArcCursor(
  cursor: number,
  enabled: readonly boolean[],
  direction: BattleMenuDirection,
): number {
  if (enabled.length === 0) return 0
  const itemCount = Math.min(enabled.length, battleArcPoints.length)
  const normalized = ((cursor % itemCount) + itemCount) % itemCount
  return moveBattleMenuCursorSpatially(
    normalized,
    battleArcPoints.slice(0, itemCount).map((point, index) => ({ ...point, enabled: enabled[index] === true })),
    direction,
  )
}

/** Returns the cursor in the enabled-button list for the last confirmed move. */
export function resolveRememberedBattleMoveCursor(
  enabledMoveIndexes: readonly number[],
  rememberedMoveIndex: number | undefined,
): number {
  if (rememberedMoveIndex === undefined) return 0
  const cursor = enabledMoveIndexes.indexOf(rememberedMoveIndex)
  return cursor < 0 ? 0 : cursor
}
