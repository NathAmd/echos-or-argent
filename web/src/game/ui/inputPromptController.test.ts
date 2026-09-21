import { describe, expect, it, vi } from 'vitest'
import {
  createFocusedControlKeyboardActivation,
  createPointerModalityArbiter,
  syncFocusedMenuControl,
} from './inputPromptController'

function keyboardEvent(key: string, repeat = false): KeyboardEvent {
  return { key, repeat, preventDefault: vi.fn() } as unknown as KeyboardEvent
}

function focusedControl(options: {
  index?: string
  disabled?: boolean
  ariaDisabled?: boolean
  disconnected?: boolean
  hiddenAncestor?: boolean
} = {}) {
  const control = {
    click: vi.fn(),
    closest: vi.fn((selector: string) => selector.includes('[hidden]') ? options.hiddenAncestor ? { hidden: true } : null : control),
    dataset: options.index === undefined ? {} : { menuIndex: options.index },
    disabled: options.disabled,
    isConnected: !options.disconnected,
    nodeType: 1,
    getAttribute: vi.fn((name: string) => name === 'aria-disabled' && options.ariaDisabled ? 'true' : null),
  }
  return control
}

describe('focused control keyboard activation', () => {
  it.each(['Enter', ' '])('activates the focused control exactly once for %j and owns its release', (key) => {
    let focused: EventTarget | null = focusedControl() as unknown as EventTarget
    const control = focused as unknown as ReturnType<typeof focusedControl>
    const activate = createFocusedControlKeyboardActivation(() => focused)
    const down = keyboardEvent(key)
    const repeat = keyboardEvent(key, true)

    expect(activate(down, true)).toBe(true)
    expect(activate(repeat, true)).toBe(true)
    expect(control.click).toHaveBeenCalledTimes(1)
    expect(down.preventDefault).toHaveBeenCalledOnce()
    expect(repeat.preventDefault).toHaveBeenCalledOnce()

    focused = null
    const up = keyboardEvent(key)
    expect(activate(up, false)).toBe(true)
    expect(up.preventDefault).toHaveBeenCalledOnce()
    expect(control.click).toHaveBeenCalledTimes(1)
  })

  it('leaves gameplay confirmation untouched without an activatable focus target', () => {
    const activate = createFocusedControlKeyboardActivation(() => ({ closest: () => null }) as unknown as EventTarget)
    const event = keyboardEvent('Enter')

    expect(activate(event, true)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })

  it('does not activate disabled or aria-disabled controls', () => {
    for (const control of [focusedControl({ disabled: true }), focusedControl({ ariaDisabled: true })]) {
      const activate = createFocusedControlKeyboardActivation(() => control as unknown as EventTarget)
      expect(activate(keyboardEvent('Enter'), true)).toBe(false)
      expect(control.click).not.toHaveBeenCalled()
    }
  })

  it('leaves gameplay confirmation untouched when focus remains in a hidden or detached screen', () => {
    for (const control of [focusedControl({ hiddenAncestor: true }), focusedControl({ disconnected: true })]) {
      const activate = createFocusedControlKeyboardActivation(() => control as unknown as EventTarget)
      const event = keyboardEvent('Enter')

      expect(activate(event, true)).toBe(false)
      expect(event.preventDefault).not.toHaveBeenCalled()
      expect(control.click).not.toHaveBeenCalled()
    }
  })
})

describe('menu focus synchronization', () => {
  it('synchronizes a valid focused menu index and rejects unrelated focus targets', () => {
    const focus = vi.fn()

    expect(syncFocusedMenuControl(focusedControl({ index: '7' }) as unknown as EventTarget, focus)).toBe(true)
    expect(syncFocusedMenuControl(focusedControl({ index: 'invalid' }) as unknown as EventTarget, focus)).toBe(false)
    expect(focus).toHaveBeenCalledOnce()
    expect(focus).toHaveBeenCalledWith(7)
  })
})

describe('pointer modality arbitration', () => {
  it('requires meaningful mouse movement and ignores touch or tiny mouse jitter', () => {
    const now = 0
    const arbiter = createPointerModalityArbiter({ now: () => now, digitalLockMs: 500, movementThresholdPx: 8 })

    expect(arbiter.shouldUsePointerForMovement('touch', 20, 20)).toBe(false)
    expect(arbiter.shouldUsePointerForMovement('mouse', 0, 0)).toBe(false)
    expect(arbiter.shouldUsePointerForMovement('mouse', 7, 0)).toBe(false)
    expect(arbiter.shouldUsePointerForMovement('mouse', 8, 0)).toBe(true)
  })

  it('keeps digital modality locked through mouse noise, then accepts deliberate movement', () => {
    let now = 0
    const arbiter = createPointerModalityArbiter({ now: () => now, digitalLockMs: 500, movementThresholdPx: 8 })
    arbiter.shouldUsePointerForMovement('mouse', 10, 10)
    arbiter.noteDigitalInput()

    now = 100
    expect(arbiter.shouldUsePointerForMovement('mouse', 30, 10)).toBe(false)
    now = 499
    expect(arbiter.shouldUsePointerForMovement('mouse', 31, 10)).toBe(false)
    now = 500
    expect(arbiter.shouldUsePointerForMovement('mouse', 31, 10)).toBe(false)
    expect(arbiter.shouldUsePointerForMovement('mouse', 39, 10)).toBe(true)
  })

  it('lets pointerdown immediately clear the digital movement lock', () => {
    let now = 0
    const arbiter = createPointerModalityArbiter({ now: () => now, digitalLockMs: 500, movementThresholdPx: 8 })
    arbiter.shouldUsePointerForMovement('mouse', 0, 0)
    arbiter.noteDigitalInput()
    now = 10
    arbiter.notePointerDown('mouse', 20, 20)

    expect(arbiter.shouldUsePointerForMovement('mouse', 28, 20)).toBe(true)
  })
})
