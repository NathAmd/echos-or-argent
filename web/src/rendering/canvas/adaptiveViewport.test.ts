import { describe, expect, it } from 'vitest'
import { displayToViewportPosition, getAdaptiveViewport } from './adaptiveViewport'

describe('adaptive story viewport', () => {
  it('expands horizontally for a wide display', () => {
    expect(getAdaptiveViewport(1920, 1080)).toEqual({ width: 683, height: 384, safeX: 86, safeY: 0 })
  })

  it('expands vertically for a portrait display', () => {
    expect(getAdaptiveViewport(1080, 1920)).toEqual({ width: 512, height: 910, safeX: 0, safeY: 263 })
  })

  it('maps the display center to the center of the fluid viewport', () => {
    expect(displayToViewportPosition(960, 540, 1920, 1080)).toEqual({ x: 341.5, y: 192 })
    expect(displayToViewportPosition(540, 960, 1080, 1920)).toEqual({ x: 256, y: 455 })
  })

  it('keeps viewport edges interactive', () => {
    expect(displayToViewportPosition(0, 0, 1920, 1080)).toEqual({ x: 0, y: 0 })
    expect(displayToViewportPosition(1920, 1080, 1920, 1080)).toEqual({ x: 683, y: 384 })
  })
})