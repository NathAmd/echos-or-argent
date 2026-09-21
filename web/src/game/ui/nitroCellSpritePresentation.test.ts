import { describe, expect, it } from 'vitest'
import type { NitroCellSpritePreview, NitroGraphic } from '../../ndsTypes'
import { resolveNitroCellSpriteTimeline } from './nitroCellSpritePresentation'

function graphic(width: number, height: number): NitroGraphic {
  return { width, height, pixels: new Uint8ClampedArray(width * height * 4), graphicsOffset: 0, paletteOffset: 0, colorDepth: 4 }
}

function sprite(playbackMode = 2, loopStartFrame = 0): NitroCellSpritePreview {
  return {
    frames: [graphic(16, 16), graphic(32, 24)],
    animation: {
      declaredFrameCount: 2,
      sequences: [{
        animationElement: 2,
        animationType: 1,
        playbackMode,
        loopStartFrame,
        frames: [
          { cellIndex: 0, durationFrames: 15, positionX: 0, positionY: 0 },
          { cellIndex: 1, durationFrames: 5, positionX: -2, positionY: 3 },
        ],
      }],
    },
  }
}

describe('Nitro cell sprite presentation', () => {
  it('préserve les durées, positions et dimensions de la séquence NANR', () => {
    expect(resolveNitroCellSpriteTimeline(sprite(), 0)).toEqual({
      width: 32,
      height: 24,
      originX: -18,
      originY: -9,
      durationFrames: 20,
      repeats: true,
      frames: [
        expect.objectContaining({ durationFrames: 15, startFrame: 0, endFrame: 15, positionX: 0, positionY: 0, left: -8, top: -8 }),
        expect.objectContaining({ durationFrames: 5, startFrame: 15, endFrame: 20, positionX: -2, positionY: 3, left: -18, top: -9 }),
      ],
    })
  })

  it("ne répète pas depuis zéro une séquence dont l'introduction précède la boucle", () => {
    expect(resolveNitroCellSpriteTimeline(sprite(2, 1), 0)?.repeats).toBe(false)
  })

  it('rejette une séquence ou une cellule absente', () => {
    const invalid = sprite()
    invalid.animation.sequences[0]!.frames[1]!.cellIndex = 7
    expect(resolveNitroCellSpriteTimeline(invalid, 0)).toBeUndefined()
    expect(resolveNitroCellSpriteTimeline(sprite(), 9)).toBeUndefined()
  })
})
