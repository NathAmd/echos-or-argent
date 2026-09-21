import { describe, expect, it } from 'vitest'
import type { NitroGraphic } from '../../ndsTypes'
import type { HgssBattleBallSpriteAsset } from '../../rom/battle/battleBallSprites'
import { resolveBattleBallSendOutCell } from './battleBallSendOutPresentation'

const graphic: NitroGraphic = {
  width: 16,
  height: 16,
  pixels: new Uint8ClampedArray(16 * 16 * 4),
  graphicsOffset: 0,
  paletteOffset: 0,
  colorDepth: 4,
}

function asset(playbackMode: number): HgssBattleBallSpriteAsset {
  return {
    ballId: 4,
    characterMemberId: 1,
    paletteMemberId: 2,
    cellMemberId: 3,
    animationMemberId: 4,
    closedSequenceIndex: 0,
    activeSequenceIndex: 1,
    frames: [graphic, graphic],
    animation: {
      declaredFrameCount: 2,
      sequences: [{
        loopStartFrame: 0,
        animationElement: 0,
        animationType: 1,
        playbackMode,
        frames: [
          { cellIndex: 0, durationFrames: 2, positionX: 0, positionY: 0 },
          { cellIndex: 1, durationFrames: 3, positionX: 0, positionY: 0 },
        ],
      }],
    },
  }
}

describe("timeline NANR de la Ball d'envoi", () => {
  it('respecte les durées natives et reboucle sans accélérer les cellules', () => {
    const looping = asset(2)
    expect(Array.from({ length: 11 }, (_, frame) => (
      resolveBattleBallSendOutCell(looping, 0, frame)
    ))).toEqual([0, 0, 1, 1, 1, 0, 0, 1, 1, 1, 0])
  })

  it('inverse les séquences reverse et fige une lecture unique sur sa dernière cellule', () => {
    const reverseLoop = asset(4)
    expect(Array.from({ length: 7 }, (_, frame) => (
      resolveBattleBallSendOutCell(reverseLoop, 0, frame)
    ))).toEqual([1, 1, 1, 0, 0, 1, 1])

    const once = asset(1)
    expect(resolveBattleBallSendOutCell(once, 0, 99)).toBe(1)
    expect(resolveBattleBallSendOutCell(once, 1, 0)).toBeUndefined()
  })
})
