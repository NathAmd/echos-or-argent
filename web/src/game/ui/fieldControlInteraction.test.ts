import { describe, expect, it, vi } from 'vitest'
import {
  createFieldControlActivation,
  isPointerInputModality,
  moveSpatialGridCursor,
  syncRovingControlSelection,
} from './fieldControlInteraction'
import { createFocusedControlKeyboardActivation } from './inputPromptController'

describe('canonical field control activation', () => {
  it.each(['ordinary choice', 'starter', 'shop', 'Alpha'])('%s activates exactly once after pointer focus', () => {
    const focus = vi.fn()
    const activate = vi.fn()
    const interaction = createFieldControlActivation(focus, activate)

    interaction.pointerDown(2)
    interaction.click(2)

    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(2)
  })

  it.each(['ordinary choice', 'starter', 'shop', 'Alpha'])('%s Enter activates exactly once', () => {
    const activate = vi.fn()
    const interaction = createFieldControlActivation(vi.fn(), activate)
    const control = { click: () => interaction.click(1), closest: () => control }
    const keyboard = createFocusedControlKeyboardActivation(() => control as unknown as EventTarget)
    const event = { key: 'Enter', repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent
    const repeat = { key: 'Enter', repeat: true, preventDefault: vi.fn() } as unknown as KeyboardEvent

    keyboard(event, true)
    keyboard(repeat, true)

    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(1)
  })
})

describe('roving field focus', () => {
  it('makes only the selected control tabbable and optionally focuses it', () => {
    const controls = Array.from({ length: 3 }, () => ({ tabIndex: 0, setAttribute: vi.fn(), focus: vi.fn() }))

    expect(syncRovingControlSelection(controls, 1, 'aria-selected', true)).toBe(controls[1])
    expect(controls.map(({ tabIndex }) => tabIndex)).toEqual([-1, 0, -1])
    expect(controls[1].setAttribute).toHaveBeenCalledWith('aria-selected', 'true')
    expect(controls[1].focus).toHaveBeenCalledOnce()
    expect(controls[0].focus).not.toHaveBeenCalled()
  })

  it('only follows hover while pointer modality is active', () => {
    expect(isPointerInputModality({ dataset: { inputModality: 'pointer' } })).toBe(true)
    expect(isPointerInputModality({ dataset: { inputModality: 'digital' } })).toBe(false)
  })
})

describe('spatial field grid navigation', () => {
  it('moves by visual rows and wraps within rows and columns', () => {
    expect(moveSpatialGridCursor(0, 8, 3, 'left')).toBe(2)
    expect(moveSpatialGridCursor(2, 8, 3, 'right')).toBe(0)
    expect(moveSpatialGridCursor(1, 8, 3, 'down')).toBe(4)
    expect(moveSpatialGridCursor(1, 8, 3, 'up')).toBe(7)
  })
})
