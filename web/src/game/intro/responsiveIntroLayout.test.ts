import { describe, expect, it } from 'vitest'
import { getAdaptiveViewport } from '../../rendering/canvas/adaptiveViewport'
import { confirmationChoiceGap, getResponsiveIntroLayout } from './responsiveIntroLayout'

describe('responsive intro layout', () => {
  it('uses extra width for dialog instead of retaining a centered 4:3 box', () => {
    const layout = getResponsiveIntroLayout(getAdaptiveViewport(1920, 1080))
    expect(layout.dialog).toEqual({ x: 28, y: 282, width: 627, height: 78 })
    expect(layout.dialogText.width).toBe(587)
  })

  it('anchors dialog to the bottom of a portrait viewport', () => {
    const viewport = getAdaptiveViewport(1080, 1920)
    const layout = getResponsiveIntroLayout(viewport)
    expect(layout.dialog.y + layout.dialog.height).toBe(viewport.height - 24)
    expect(layout.dialog.width).toBe(456)
  })

  it('reserves responsive dialog space for confirmation choices', () => {
    const viewport = getAdaptiveViewport(2560, 1080)
    const layout = getResponsiveIntroLayout(viewport, true)
    const choicesWidth = layout.confirmationChoices.width * 2 + confirmationChoiceGap
    expect(layout.confirmationChoices.x).toBe(layout.dialog.x + layout.dialog.width - choicesWidth - 20)
    expect(layout.dialogText.width).toBe(layout.dialog.width - choicesWidth - 80)
    expect(layout.confirmationChoices.x).toBeGreaterThan(layout.dialogText.x + layout.dialogText.width)
    expect(layout.confirmationChoices.x + choicesWidth).toBeLessThan(layout.dialog.x + layout.dialog.width)
  })
})