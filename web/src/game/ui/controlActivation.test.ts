import { describe, expect, it, vi } from 'vitest'
import { createControlActivation, createDelegatedButtonActivation } from './controlActivation'
import { createFocusedControlKeyboardActivation } from './inputPromptController'

const battleContexts = ['commands', 'moves', 'bag', 'party', 'learnMove', 'controlsFooter'] as const

describe('canonical control activation', () => {
  it.each(battleContexts)('%s activates exactly once for a pointer press and click', (context) => {
    const focus = vi.fn()
    const activate = vi.fn()
    const interaction = createControlActivation(focus, activate)

    interaction.pointerDown(context)
    expect(activate).not.toHaveBeenCalled()
    interaction.click(context)

    expect(focus).toHaveBeenCalledTimes(2)
    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(context)
  })

  it.each(battleContexts)('%s activates exactly once with Enter, including key repeat and release', (context) => {
    const activate = vi.fn()
    const interaction = createControlActivation(vi.fn(), activate)
    const control = {
      click: () => interaction.click(context),
      closest: () => control,
      getAttribute: () => null,
    }
    const keyboard = createFocusedControlKeyboardActivation(() => control as unknown as EventTarget)
    const event = (repeat = false) => ({ key: 'Enter', repeat, preventDefault: vi.fn() }) as unknown as KeyboardEvent

    keyboard(event(), true)
    keyboard(event(true), true)
    keyboard(event(), false)

    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(context)
  })

  it('delegates nested pointer targets to one enabled battle button click', () => {
    const button = { focus: vi.fn() } as unknown as HTMLButtonElement
    const closest = vi.fn(() => button)
    const target = { closest } as unknown as EventTarget
    const root = { contains: (node: unknown) => node === button } as unknown as HTMLElement
    const focus = vi.fn()
    const activate = vi.fn()
    const interaction = createDelegatedButtonActivation(root, focus, activate)
    const event = { target } as Event

    interaction.pointerDown(event)
    interaction.click(event)

    expect(closest).toHaveBeenCalledWith('button:not(:disabled):not([hidden]):not([aria-disabled="true"])')
    expect(focus).toHaveBeenCalledTimes(2)
    expect(activate).toHaveBeenCalledOnce()
    expect(activate).toHaveBeenCalledWith(button)
  })

  it('laisse un contrôle marqué déléguer Entrée au routeur numérique du jeu', () => {
    const click = vi.fn()
    const control = {
      click,
      dataset: { digitalInputDelegate: 'true' },
      closest: () => control,
      getAttribute: () => null,
    }
    const keyboard = createFocusedControlKeyboardActivation(() => control as unknown as EventTarget)
    const event = { key: 'Enter', repeat: false, preventDefault: vi.fn() } as unknown as KeyboardEvent

    expect(keyboard(event, true)).toBe(false)
    expect(click).not.toHaveBeenCalled()
  })
})
