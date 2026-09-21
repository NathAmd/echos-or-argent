import { describe, expect, it } from 'vitest'
import { decodeSseqTimeline } from './sseq'

function sseq(stream: readonly number[]): Uint8Array {
  const bytes = new Uint8Array(0x1c + stream.length)
  const view = new DataView(bytes.buffer)
  bytes.set(new TextEncoder().encode('SSEQ'))
  view.setUint32(0x18, 0x1c, true)
  bytes.set(stream, 0x1c)
  return bytes
}

describe('SSEQ timeline', () => {
  it('decodes every track opened by the conductor', () => {
    const timeline = decodeSseqTimeline(sseq([
      0x93, 0x01, 0x09, 0x00, 0x00,
      60, 127, 4,
      0xff,
      0x81, 0x02,
      67, 100, 6,
      0xff,
    ]))

    expect(timeline.notes).toEqual([
      expect.objectContaining({ trackId: 0, note: 60, program: 0, tick: 0, duration: 4 }),
      expect.objectContaining({ trackId: 1, note: 67, program: 2, tick: 0, duration: 6 }),
    ])
    expect(timeline.endTick).toBe(6)
  })

  it('keeps tied notes on one voice and preserves their portamento', () => {
    const timeline = decodeSseqTimeline(sseq([
      0xc8, 1,
      60, 127, 12,
      0xce, 1,
      0xcf, 8,
      67, 127, 24,
      0xc8, 0,
      72, 127, 6,
      0xff,
    ]))

    expect(timeline.notes).toHaveLength(2)
    expect(timeline.notes[0]).toMatchObject({
      note: 60,
      tick: 0,
      duration: 36,
      pitchTransitions: [{ tick: 12, note: 67, portamentoTime: 8 }],
    })
    expect(timeline.notes[1]).toMatchObject({ note: 72, tick: 36, duration: 6 })
  })

  it('preserves native ADSR overrides and initial pitch sweep controls', () => {
    const timeline = decodeSseqTimeline(sseq([
      0xd0, 109, 0xd1, 80, 0xd2, 96, 0xd3, 70,
      0xc9, 48, 0xce, 1, 0xcf, 12, 0xe3, 0xc0, 0xff,
      60, 127, 24,
      0xff,
    ]))

    expect(timeline.notes[0]).toMatchObject({
      note: 60,
      attack: 109,
      decay: 80,
      sustain: 96,
      release: 70,
      sweepPitch: -64,
      portamentoFromNote: 48,
      portamentoTime: 12,
    })
  })

  it('exposes the native loop region of a backward jump', () => {
    const timeline = decodeSseqTimeline(sseq([
      60, 127, 12,
      62, 127, 6,
      0x94, 0x03, 0x00, 0x00,
    ]), 48)

    expect(timeline.loop).toEqual({ startTick: 12, endTick: 18 })
  })

  it('exposes an infinite LoopStart and LoopEnd region', () => {
    const timeline = decodeSseqTimeline(sseq([
      0xd4, 0,
      64, 127, 8,
      0xfc,
    ]), 32)

    expect(timeline.loop).toEqual({ startTick: 0, endTick: 8 })
  })
})