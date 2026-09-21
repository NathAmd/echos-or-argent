import { describe, expect, it } from 'vitest'
import { decodeNitroCellAnimationPayload } from './nitroCellAnimations'

function writeMagic(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) bytes[offset + index] = value.charCodeAt(index)
}

function createNanr(): Uint8Array {
  const bytes = new Uint8Array(88)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, 'RNAN')
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  writeMagic(bytes, 16, 'KNBA')
  view.setUint32(20, 72, true)
  view.setUint16(24, 1, true)
  view.setUint16(26, 1, true)
  view.setUint32(28, 24, true) // séquences à 0x30
  view.setUint32(32, 40, true) // frames à 0x40
  view.setUint32(36, 48, true) // résultats à 0x48
  view.setUint16(48, 1, true)
  view.setUint16(50, 0, true)
  view.setUint16(52, 1, true)
  view.setUint16(54, 2, true)
  view.setUint32(56, 1, true)
  view.setUint32(60, 0, true)
  view.setUint32(64, 0, true)
  view.setUint16(68, 3, true)
  view.setUint16(72, 4, true)
  view.setUint16(74, 0x4000, true)
  view.setInt32(76, 6144, true)
  view.setInt32(80, 2048, true)
  view.setInt16(84, -3, true)
  view.setInt16(86, 5, true)
  return bytes
}

describe('Nitro NANR cell animations', () => {
  it('decodes an ABNK SRT sequence and its signed/fixed-point result', () => {
    expect(decodeNitroCellAnimationPayload(createNanr())).toEqual({
      declaredFrameCount: 1,
      sequences: [{
        loopStartFrame: 0,
        animationElement: 1,
        animationType: 2,
        playbackMode: 1,
        frames: [{
          durationFrames: 3,
          cellIndex: 4,
          rotation: 0x4000,
          scaleX: 1.5,
          scaleY: 0.5,
          positionX: -3,
          positionY: 5,
        }],
      }],
    })
  })

  it('rejects invalid and truncated ABNK data', () => {
    expect(decodeNitroCellAnimationPayload(new Uint8Array(32))).toBeUndefined()
    expect(decodeNitroCellAnimationPayload(createNanr().subarray(0, 70))).toBeUndefined()
  })
})
