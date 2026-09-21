import { describe, expect, it } from 'vitest'
import type { IntroRenderState } from './game/intro/introTypes'
import { shouldHandleIntroPointerAction } from './introControls'

function state(mode: IntroRenderState['mode']): IntroRenderState {
  return { mode, text: '', showGenderSelect: false }
}

describe('intro pointer controls', () => {
  it('allows empty clicks only for plain dialog text', () => {
    expect(shouldHandleIntroPointerAction(state('dialog'), undefined)).toBe(true)
    expect(shouldHandleIntroPointerAction(state('tutorial-choice'), undefined)).toBe(false)
    expect(shouldHandleIntroPointerAction(state('gender-select'), undefined)).toBe(false)
    expect(shouldHandleIntroPointerAction(state('gender-confirm'), undefined)).toBe(false)
    expect(shouldHandleIntroPointerAction(state('name-input'), undefined)).toBe(false)
    expect(shouldHandleIntroPointerAction(state('name-confirm'), undefined)).toBe(false)
  })

  it('accepts explicit controls on interactive screens', () => {
    expect(shouldHandleIntroPointerAction(state('gender-confirm'), { kind: 'choice', index: 1 })).toBe(true)
  })
})