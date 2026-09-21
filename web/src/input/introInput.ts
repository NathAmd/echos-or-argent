import type { GameDigitalAction } from '../gameInput'
import type { OakIntroFlow } from '../oakIntroFlow'

export type IntroInputCallbacks = {
  advance: () => void
  redraw: () => void
  moveGenderCursor: (direction: -1 | 1) => void
}

export function handleIntroDigitalInput(
  action: GameDigitalAction,
  flow: OakIntroFlow,
  callbacks: IntroInputCallbacks,
): boolean {
  const renderState = flow.getRenderState()
  // The central GameTextEntryOverlay exclusively owns every name-entry input.
  if (renderState.mode === 'name-input') return true
  if (action === 'confirm') {
    callbacks.advance()
    return true
  }
  if (action === 'cancel' && (renderState.mode === 'gender-confirm' || renderState.mode === 'name-confirm')) {
    flow.chooseCurrentSelection(1)
    callbacks.redraw()
    return true
  }
  if (renderState.mode === 'gender-select' && (action === 'left' || action === 'right')) {
    callbacks.moveGenderCursor(action === 'left' ? -1 : 1)
    return true
  }
  if (
    (renderState.mode === 'tutorial-choice' || renderState.mode === 'gender-confirm' || renderState.mode === 'name-confirm')
    && (action === 'left' || action === 'right' || action === 'up' || action === 'down')
  ) {
    flow.moveChoiceCursor(action === 'left' || action === 'up' ? -1 : 1)
    callbacks.redraw()
    return true
  }
  return false
}
