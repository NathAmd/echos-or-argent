import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { readRomInventory } from '../../nds'
import { resolveSbnkInstrument } from './nitroSamples'
import { decodeSseqTimeline } from './sseq'
import { decodeSdat, readSdatFile } from './sdat'

const romPath = fileURLToPath(new URL('../../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romProbe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('SDAT', () => {
  it('rejects missing and truncated ROM sound archives explicitly', () => {
    expect(() => decodeSdat(new Uint8Array())).toThrow('En-tete SDAT')
    const bytes = new Uint8Array(0x30)
    bytes.set(new TextEncoder().encode('SDAT'))
    new DataView(bytes.buffer).setUint32(8, bytes.length, true)
    expect(() => decodeSdat(bytes)).toThrow('Bloc SDAT INFO')
  })

  it('decodes the native sequence player used to arbitrate BGM, fanfares and sound effects', () => {
    const bytes = new Uint8Array(0x7c)
    const view = new DataView(bytes.buffer)
    bytes.set(new TextEncoder().encode('SDAT'))
    view.setUint32(8, bytes.length, true)
    view.setUint32(0x18, 0x30, true)
    view.setUint32(0x1c, 0x40, true)
    view.setUint32(0x20, 0x70, true)
    view.setUint32(0x24, 0x0c, true)
    bytes.set(new TextEncoder().encode('INFO'), 0x30)
    view.setUint32(0x38, 0x28, true)
    view.setUint32(0x58, 1, true)
    view.setUint32(0x5c, 0x34, true)
    view.setUint16(0x64, 7, true)
    view.setUint16(0x68, 11, true)
    bytes.set([96, 64, 65, 5], 0x6a)
    bytes.set(new TextEncoder().encode('FAT '), 0x70)
    view.setUint32(0x78, 0, true)

    expect(decodeSdat(bytes).sequences[0]).toEqual({
      fileId: 7,
      bankId: 11,
      volume: 96,
      channelPriority: 64,
      playerPriority: 65,
      playerId: 5,
    })
  })

  romProbe('decodes the finite native Pokegear number-registration fanfare', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const sdat = decodeSdat(inventory.soundArchive.bytes)
    const sequence = sdat.sequences[1206]
    expect(sequence).toBeDefined()
    if (!sequence) return
    expect(sequence.playerId).toBe(2)
    const timeline = decodeSseqTimeline(readSdatFile(sdat, sequence.fileId, 'SSEQ'), 48 * 128 * 4)
    expect({
      endTick: timeline.endTick,
      maximumNoteEndTick: Math.max(...timeline.notes.map((note) => note.tick + note.duration)),
      notes: timeline.notes.length,
      lastNote: timeline.notes.at(-1),
    }).toMatchInlineSnapshot(`
      {
        "endTick": 309,
        "lastNote": {
          "duration": 5,
          "expression": 110,
          "masterVolume": 127,
          "note": 84,
          "pan": 20,
          "pitchBend": 0,
          "pitchBendRange": 2,
          "program": 23,
          "tick": 264,
          "trackId": 5,
          "transpose": 0,
          "velocity": 115,
          "volume": 95,
        },
        "maximumNoteEndTick": 309,
        "notes": 139,
      }
    `)
  }, 30_000)

  romProbe('decodes multiple audible tracks from map and battle music', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const sdat = decodeSdat(inventory.soundArchive.bytes)

    for (const sequenceId of [1018, 1116, 1117]) {
      const sequence = sdat.sequences[sequenceId]
      expect(sequence, `sequence ${sequenceId}`).toBeDefined()
      if (!sequence) continue
      const timeline = decodeSseqTimeline(readSdatFile(sdat, sequence.fileId, 'SSEQ'), 48 * 128 * 4)
      const bank = sdat.banks[sequence.bankId]
      expect(bank, `bank for sequence ${sequenceId}`).toBeDefined()
      if (!bank) continue
      const bankBytes = readSdatFile(sdat, bank.fileId, 'SBNK')
      const audibleTracks = new Set(timeline.notes.map((note) => note.trackId))
      expect(audibleTracks.size, `audible tracks in sequence ${sequenceId}`).toBeGreaterThan(1)
      expect(timeline.notes.length, `notes in sequence ${sequenceId}`).toBeGreaterThan(1)
      expect(timeline.loop, `native loop in sequence ${sequenceId}`).toBeDefined()
      if (timeline.loop) {
        expect(timeline.loop.endTick, `loop duration in sequence ${sequenceId}`).toBeGreaterThan(timeline.loop.startTick)
        expect(
          timeline.notes.some((note) => note.tick >= timeline.loop!.startTick && note.tick < timeline.loop!.endTick),
          `audible loop notes in sequence ${sequenceId}`,
        ).toBe(true)
      }
      for (const note of timeline.notes) {
        expect(() => resolveSbnkInstrument(bankBytes, note.program, note.note + note.transpose)).not.toThrow()
      }
    }
  }, 30_000)

  romProbe('identifies the finite title-screen tracks that need BGM fallback loops', async () => {
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const sdat = decodeSdat(inventory.soundArchive.bytes)

    for (const sequenceName of ['SEQ_GS_TITLE', 'SEQ_GS_POKEMON_THEME']) {
      const sequenceId = sdat.sequenceNames.indexOf(sequenceName)
      const sequence = sdat.sequences[sequenceId]
      expect(sequence, sequenceName).toBeDefined()
      if (!sequence) continue
      const timeline = decodeSseqTimeline(readSdatFile(sdat, sequence.fileId, 'SSEQ'), 48 * 128 * 4)
      expect(timeline.loop, sequenceName).toBeUndefined()
      expect(timeline.endTick, sequenceName).toBeGreaterThan(0)
      expect(timeline.notes.length, sequenceName).toBeGreaterThan(0)
    }
  }, 30_000)
})
