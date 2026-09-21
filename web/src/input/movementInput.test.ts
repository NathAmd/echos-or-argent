import { describe, expect, it } from 'vitest'
import { createMovementInput, observePhysicalMovementInput, resolveMovementInputKey } from './movementInput'

describe('movement input', () => {
  it('normalise les directions clavier et manette à la frontière physique', () => {
    expect(resolveMovementInputKey({ action: 'left', inputId: 'ArrowLeft' })).toBe('ArrowLeft')
    expect(resolveMovementInputKey({ action: 'up', inputId: 'GamepadUp' })).toBe('GamepadUp')
    expect(resolveMovementInputKey({ action: 'right' })).toBe('GamepadRight')
    expect(resolveMovementInputKey({ action: 'confirm', inputId: 'Enter' })).toBeUndefined()
  })

  it('keeps every held direction while exposing the most recent as active', () => {
    const input = createMovementInput()
    input.remember('ArrowRight')
    input.remember('ArrowUp')

    expect(input.getActive()?.direction).toBe('north')
    expect(input.isDirectionHeld('east')).toBe(true)
    expect(input.isDirectionHeld('north')).toBe(true)

    input.release('ArrowRight')
    expect(input.isDirectionHeld('east')).toBe(false)
  })

  it('libère une direction avant qu’une couche modale puisse consommer le keyup', () => {
    const input = createMovementInput()
    const runStates: boolean[] = []
    input.remember('ArrowUp')

    const movementKey = observePhysicalMovementInput(
      { action: 'up', pressed: false, inputId: 'ArrowUp' },
      input,
      (pressed) => { runStates.push(pressed) },
    )

    expect(movementKey).toBe('ArrowUp')
    expect(input.getActive()).toBeUndefined()
    observePhysicalMovementInput({ action: 'cancel', pressed: true, inputId: 'Shift' }, input, (pressed) => { runStates.push(pressed) })
    observePhysicalMovementInput({ action: 'cancel', pressed: false, inputId: 'Shift' }, input, (pressed) => { runStates.push(pressed) })
    expect(runStates).toEqual([true, false])
  })
})
