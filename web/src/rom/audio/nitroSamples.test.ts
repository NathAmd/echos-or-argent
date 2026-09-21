import { describe, expect, it } from 'vitest'
import { resolveSbnkInstrument } from './nitroSamples'

describe('Nitro SBNK instruments', () => {
  it('decodes a hardware PSG square instrument without requiring a SWAR sample', () => {
    const bytes = new Uint8Array(0x50)
    bytes.set([0x53, 0x42, 0x4e, 0x4b], 0)
    new DataView(bytes.buffer).setUint32(0x38, 1, true)
    bytes.set([2, 0x40, 0, 0], 0x3c)
    bytes.set([3, 0, 0, 0, 69, 1, 2, 3, 4, 64], 0x40)

    expect(resolveSbnkInstrument(bytes, 0, 69)).toMatchObject({
      type: 'psg', waveId: 3, rootNote: 69,
    })
  })

  it('decodes a hardware noise instrument without requiring a SWAR sample', () => {
    const bytes = new Uint8Array(0x4a)
    bytes.set([0x53, 0x42, 0x4e, 0x4b])
    const view = new DataView(bytes.buffer)
    view.setUint32(0x38, 1, true)
    bytes[0x3c] = 3
    bytes.set([0x40, 0, 0], 0x3d)
    bytes.set([0, 0, 0, 0, 60, 1, 2, 100, 3, 64], 0x40)

    expect(resolveSbnkInstrument(bytes, 0, 60)).toEqual({
      type: 'noise',
      waveId: 0,
      waveArchiveSlot: 0,
      rootNote: 60,
      attack: 1,
      decay: 2,
      sustain: 100,
      release: 3,
      pan: 64,
    })
  })
})