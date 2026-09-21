import { createControlActivation, type ControlActivation } from './controlActivation'

export type FieldControlActivation<T> = ControlActivation<T>

type RovingControl = {
  tabIndex: number
  setAttribute: (name: string, value: string) => void
  focus: (options?: FocusOptions) => void
}

export type SpatialGridDirection = 'left' | 'right' | 'up' | 'down'

/** Pointerdown only moves focus; click is the single semantic activation path. */
export function createFieldControlActivation<T>(
  focus: (value: T) => void,
  activate: (value: T) => void,
): FieldControlActivation<T> {
  return createControlActivation(focus, activate)
}

export function syncRovingControlSelection<T extends RovingControl>(
  controls: readonly T[],
  cursor: number,
  attribute: 'aria-current' | 'aria-selected',
  focusSelected = false,
): T | undefined {
  let selected: T | undefined
  controls.forEach((control, index) => {
    const active = index === cursor
    control.tabIndex = active ? 0 : -1
    control.setAttribute(attribute, String(active))
    if (active) selected = control
  })
  if (focusSelected) selected?.focus({ preventScroll: true })
  return selected
}

export function isPointerInputModality(root: { dataset: { inputModality?: string } }): boolean {
  return root.dataset.inputModality === 'pointer'
}

export function resolveIndexedButton(
  target: EventTarget | null,
  root: HTMLElement,
  attribute: `data-${string}`,
  count: number,
): number | undefined {
  if (!(target instanceof Element)) return undefined
  const button = target.closest<HTMLButtonElement>(`button[${attribute}]`)
  const rawIndex = button?.getAttribute(attribute)
  const index = rawIndex === null || rawIndex === undefined ? Number.NaN : Number.parseInt(rawIndex, 10)
  return button && root.contains(button) && Number.isInteger(index) && index >= 0 && index < count ? index : undefined
}

export function moveSpatialGridCursor(
  cursor: number,
  count: number,
  columns: number,
  direction: SpatialGridDirection,
): number {
  if (count <= 0) return 0
  const width = Math.max(1, Math.min(count, Math.floor(columns)))
  const current = Math.max(0, Math.min(count - 1, cursor))
  const row = Math.floor(current / width)
  const column = current % width
  const rowStart = row * width
  const rowEnd = Math.min(count - 1, rowStart + width - 1)
  if (direction === 'left') return current > rowStart ? current - 1 : rowEnd
  if (direction === 'right') return current < rowEnd ? current + 1 : rowStart
  const rows = Math.ceil(count / width)
  const nextRow = (row + (direction === 'up' ? -1 : 1) + rows) % rows
  return Math.min(count - 1, nextRow * width + column)
}
