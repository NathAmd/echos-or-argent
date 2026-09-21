import type { IntroRenderState } from './game/intro/introTypes'
import { confirmationChoiceGap, getResponsiveIntroLayout } from './game/intro/responsiveIntroLayout'
import { displayToViewportPosition, getAdaptiveViewport } from './rendering/canvas/adaptiveViewport'

export type IntroPointerAction =
  | { kind: 'gender', gender: 'male' | 'female' }
  | { kind: 'choice', index: number }
export function shouldHandleIntroPointerAction(renderState: IntroRenderState, action: IntroPointerAction | undefined): boolean {
  return action !== undefined || renderState.mode === 'dialog'
}

export function getStoryPointerPosition(canvas: HTMLCanvasElement, event: PointerEvent): { x: number, y: number } | undefined {
  const rect = canvas.getBoundingClientRect()
  return displayToViewportPosition(
    event.clientX - rect.left,
    event.clientY - rect.top,
    rect.width,
    rect.height,
  )
}

function hitRect(position: { x: number, y: number }, rect: { x: number, y: number, width: number, height: number }): boolean {
  return position.x >= rect.x
    && position.x <= rect.x + rect.width
    && position.y >= rect.y
    && position.y <= rect.y + rect.height
}

export function getIntroPointerAction(canvas: HTMLCanvasElement, event: PointerEvent, renderState: IntroRenderState): IntroPointerAction | undefined {
  const position = getStoryPointerPosition(canvas, event)
  if (!position) return undefined
  const rect = canvas.getBoundingClientRect()
  const viewport = getAdaptiveViewport(rect.width, rect.height)
  const hasDialogChoices = renderState.mode === 'gender-confirm' || renderState.mode === 'name-confirm'
  const layout = getResponsiveIntroLayout(viewport, hasDialogChoices)

  if (renderState.mode === 'gender-select') {
    if (hitRect(position, layout.genderMale)) return { kind: 'gender', gender: 'male' }
    if (hitRect(position, layout.genderFemale)) return { kind: 'gender', gender: 'female' }
    return undefined
  }

  if (renderState.mode === 'tutorial-choice' && renderState.choices?.length) {
    for (let index = 0; index < renderState.choices.length; index += 1) {
      const y = layout.tutorialChoices.y + index * 54
      if (hitRect(position, { ...layout.tutorialChoices, y })) return { kind: 'choice', index }
    }
    return undefined
  }

  if (renderState.mode === 'gender-confirm' || renderState.mode === 'name-confirm') {
    for (let index = 0; index < 2; index += 1) {
      const x = layout.confirmationChoices.x + index * (layout.confirmationChoices.width + confirmationChoiceGap)
      if (hitRect(position, { ...layout.confirmationChoices, x })) return { kind: 'choice', index }
    }
    return undefined
  }

  return undefined
}
