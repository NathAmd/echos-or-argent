import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { decodeHgssWaveOutPcm8, isScheduledRomAudioPlaying, resolveConfirmedHgssCryModulation, resolveConfirmedHgssCryPlayback, resolveHgssCryBankId, resolveHgssMovingPanAutomation, resolveHgssWaveOutStereoPan, resolveNitroEnvelope, resolveNitroPitchRatio, resolveNitroStereoPan, resolveNitroSweepSeconds, resolveRomMusicLoop } from './romAudioRuntime'

const romPath = fileURLToPath(new URL('../../../Pokemon - Version Or HeartGold (France).nds', import.meta.url))
const romProbe = process.env.RUN_ROM_PROBES === '1' && existsSync(romPath) ? it : it.skip

describe('Nitro sequence synthesis', () => {
  it('repeats an entire finite sequence when it is routed as background music', () => {
    expect(resolveRomMusicLoop({
      notes: [{ trackId: 0 }] as never,
      tempos: [{ tick: 0, bpm: 120 }],
      endTick: 240,
    })).toEqual({ startTick: 0, endTick: 240 })
  })

  it('preserves a native music loop instead of replaying its introduction', () => {
    expect(resolveRomMusicLoop({
      notes: [{ trackId: 0 }] as never,
      tempos: [{ tick: 0, bpm: 120 }],
      endTick: 480,
      loop: { startTick: 96, endTick: 480 },
    })).toEqual({ startTick: 96, endTick: 480 })
  })

  it('combines track and instrument pan around the native center', () => {
    expect(resolveNitroStereoPan(64, 64)).toBe(0)
    expect(resolveNitroStereoPan(127, 127)).toBe(1)
    expect(resolveNitroStereoPan(0, 0)).toBe(-1)
  })

  it('convertit le déplacement panoramique ROM en rampe Web Audio', () => {
    expect(resolveHgssMovingPanAutomation(117, -117, 4, 2)).toEqual({
      start: 117 / 127,
      end: -117 / 127,
      durationSeconds: 118 / 60,
    })
  })

  it('applies signed pitch bend using the selected range', () => {
    expect(resolveNitroPitchRatio({ pitchBend: 64, pitchBendRange: 2 })).toBeCloseTo(2 ** (1 / 12))
    expect(resolveNitroPitchRatio({ pitchBend: -64, pitchBendRange: 12 })).toBeCloseTo(2 ** (-0.5))
  })

  it('uses the native Nitro control-rate ADSR conversions', () => {
    expect(resolveNitroEnvelope({ attack: 127, decay: 127, sustain: 64, release: 127 })).toEqual({
      attackSeconds: 1 / 192,
      decaySeconds: 1 / 192,
      sustainLevel: 10 ** (-6 / 20),
      releaseSeconds: 2 / 192,
    })
    expect(resolveNitroEnvelope({ attack: 0, decay: 0, sustain: 0, release: 0 }).attackSeconds).toBe(Number.POSITIVE_INFINITY)
  })

  it('uses the native squared portamento-time sweep length', () => {
    expect(resolveNitroSweepSeconds(64, 8, 1)).toBe((64 * 8 ** 2 >> 11) / 192)
    expect(resolveNitroSweepSeconds(-768, 0, 2.5)).toBe(2.5)
  })
})

describe('HGSS ROM cry modulation', () => {
  it('sélectionne la banque de cri dédiée de Shaymin Céleste comme sub_02006A0C', () => {
    expect(resolveHgssCryBankId(492, 0)).toBe(492)
    expect(resolveHgssCryBankId(492, 1)).toBe(494)
    expect(resolveHgssCryBankId(25, 1)).toBe(25)
  })

  it('keeps an ordinary cry unchanged', () => {
    expect(resolveConfirmedHgssCryModulation(0)).toEqual({ reverse: false, playbackRate: 1 })
  })

  it('reproduces the native short and low single-voice patterns', () => {
    expect(resolveConfirmedHgssCryModulation(1)).toEqual({
      reverse: false,
      playbackRate: 1,
      maximumFrames: 20,
      fadeFrames: 10,
    })
    expect(resolveConfirmedHgssCryModulation(11)).toEqual({
      reverse: false,
      playbackRate: 2 ** (-96 / 64 / 12),
    })
    expect(resolveConfirmedHgssCryModulation(12)).toEqual({
      reverse: false,
      playbackRate: 2 ** (-96 / 64 / 12),
      maximumFrames: 20,
      fadeFrames: 10,
    })
  })

  it('reproduces both simultaneous native chorus handles', () => {
    expect(resolveConfirmedHgssCryModulation(2)).toEqual({
      reverse: false,
      playbackRate: 2 ** (64 / 64 / 12),
      chorus: {
        playbackRate: 2 ** (20 / 64 / 12),
        volumeReduction: 30,
        minimumVolume: 1,
      },
    })
    expect(resolveConfirmedHgssCryModulation(3)).toEqual({
      reverse: false,
      playbackRate: 2 ** (192 / 64 / 12),
      chorus: {
        playbackRate: 2 ** (16 / 64 / 12),
        volumeReduction: 30,
        minimumVolume: 1,
      },
      maximumFrames: 30,
      fadeFrames: 10,
    })
  })

  it.each([
    [0, 1],
    [1, 1],
    [30, 1],
    [31, 1],
    [127, 97],
  ])('clamps the chorus volume max(%i - 30, 1) to %i', (volume, chorusVolume) => {
    expect(resolveConfirmedHgssCryPlayback(128, 2, volume)?.voices.map((voice) => voice.volume)).toEqual([
      volume,
      chorusVolume,
    ])
  })

  it('keeps both chorus voices in one bounded playback plan', () => {
    expect(resolveConfirmedHgssCryPlayback(128, 3, 100)).toEqual({
      renderer: 'sequence',
      voices: [
        { reverse: false, playbackRate: 2 ** (192 / 64 / 12), volume: 100, stereoPan: 0 },
        { reverse: false, playbackRate: 2 ** (16 / 64 / 12), volume: 70, stereoPan: 0 },
      ],
      maximumFrames: 30,
      fadeFrames: 10,
    })
  })

  it.each([1, 2, 5, 11, 12])('bypasses pattern %i modulation for Chatot like PlayCryEx', (pattern) => {
    expect(resolveConfirmedHgssCryPlayback(441, pattern, 100)).toEqual({
      renderer: 'sequence',
      voices: [{ reverse: false, playbackRate: 1, volume: 100, stereoPan: 0 }],
    })
  })

  it('keeps pattern 3 generic after disabling the recorded Chatot cry', () => {
    expect(resolveConfirmedHgssCryPlayback(441, 3, 100)).toEqual({
      renderer: 'sequence',
      voices: [
        { reverse: false, playbackRate: 2 ** (192 / 64 / 12), volume: 100, stereoPan: 0 },
        { reverse: false, playbackRate: 2 ** (16 / 64 / 12), volume: 70, stereoPan: 0 },
      ],
      maximumFrames: 30,
      fadeFrames: 10,
    })
  })

  it('reproduces pattern 4 with the two reversed raw WaveOut handles', () => {
    expect(resolveConfirmedHgssCryPlayback(25, 4, 100, -127)).toEqual({
      renderer: 'wave-out-pcm8',
      voices: [
        { reverse: true, playbackRate: 0x8600 / 0x8000, volume: 100, stereoPan: -1 },
        { reverse: true, playbackRate: 0x8600 / 0x8000, volume: 70, stereoPan: -1 },
      ],
      maximumFrames: 15,
    })
  })

  it.each([
    [5, -224, undefined, undefined],
    [7, -128, 11, 10],
    [8, 60, 60, 10],
  ] as const)('reproduces single-handle pattern %i from the PlayCryEx jump table', (pattern, pitch, maximumFrames, fadeFrames) => {
    expect(resolveConfirmedHgssCryModulation(pattern)).toEqual({
      reverse: false,
      playbackRate: 2 ** (pitch / 64 / 12),
      ...(maximumFrames === undefined ? {} : { maximumFrames }),
      ...(fadeFrames === undefined ? {} : { fadeFrames }),
    })
  })

  it('reproduces the asymmetric pitches and reduced second volume of pattern 6', () => {
    expect(resolveConfirmedHgssCryPlayback(25, 6, 31, 127)).toEqual({
      renderer: 'sequence',
      voices: [
        { reverse: false, playbackRate: 2 ** (44 / 64 / 12), volume: 31, stereoPan: 1 },
        { reverse: false, playbackRate: 2 ** (-64 / 64 / 12), volume: 1, stereoPan: 1 },
      ],
    })
  })

  it('keeps pattern 13 primary pan native and applies requested pan/volume only to CHORUS', () => {
    expect(resolveConfirmedHgssCryPlayback(25, 13, 40, 127)).toEqual({
      renderer: 'sequence',
      voices: [
        { reverse: false, playbackRate: 1, volume: 127 },
        { reverse: false, playbackRate: 2 ** (20 / 64 / 12), volume: 40, stereoPan: 1 },
      ],
    })
  })

  it('ignores requested pan and volume for bare-PlayCry pattern 14', () => {
    expect(resolveConfirmedHgssCryPlayback(25, 14, 3, -127)).toEqual({
      renderer: 'sequence',
      voices: [{ reverse: false, playbackRate: 1, volume: 127 }],
    })
  })

  it('uses signed truncation and the native 0..127 center for WaveOut pan', () => {
    expect(resolveHgssWaveOutStereoPan(-127)).toBe(-1)
    expect(resolveHgssWaveOutStereoPan(-1)).toBe(0)
    expect(resolveHgssWaveOutStereoPan(0)).toBe(0)
    expect(resolveHgssWaveOutStereoPan(127)).toBe(1)
  })

  it('feeds WaveOut the complete SWAR byte stream as signed PCM8 before or after reversal', () => {
    const bytes = Uint8Array.of(0x53, 0x57, 0x80, 0xff)
    expect([...decodeHgssWaveOutPcm8(bytes, false)]).toEqual([0x53 / 128, 0x57 / 128, -1, -1 / 128])
    expect([...decodeHgssWaveOutPcm8(bytes, true)]).toEqual([-1 / 128, -1, 0x57 / 128, 0x53 / 128])
  })

  it('has an explicit playback plan for every native PlayCryEx pattern', () => {
    expect(Array.from({ length: 15 }, (_, pattern) => resolveConfirmedHgssCryPlayback(25, pattern, 100))).not.toContain(undefined)
  })

  romProbe('inventories the cry sequence and direct WaveOut archives in the local ROM', async () => {
    const [{ readRomInventory }, { decodeSdat, readSdatFile }] = await Promise.all([
      import('../nds'),
      import('../rom/audio/sdat'),
    ])
    const romBuffer = await readFile(romPath)
    const inventory = await readRomInventory(new File([romBuffer], basename(romPath)))
    const sdat = decodeSdat(inventory.soundArchive.bytes)
    expect(sdat.sequences[2]).toEqual({
      fileId: 0,
      bankId: 1,
      volume: 120,
      channelPriority: 127,
      playerPriority: 64,
      playerId: 0,
    })
    expect([1, 25, 441, 492, 493, 494].map((id) => {
      const bank = sdat.banks[id]
      const waveArchive = sdat.waveArchives[id]
      const bytes = waveArchive ? readSdatFile(sdat, waveArchive.fileId, 'SWAR') : undefined
      return { id, waveArchiveIds: bank?.waveArchiveIds, size: bytes?.byteLength }
    })).toEqual([
      { id: 1, waveArchiveIds: [1], size: 8260 },
      { id: 25, waveArchiveIds: [25], size: 8312 },
      { id: 441, waveArchiveIds: [441], size: 10732 },
      { id: 492, waveArchiveIds: [492], size: 23196 },
      { id: 493, waveArchiveIds: [493], size: 21412 },
      { id: 494, waveArchiveIds: [494], size: 16820 },
    ])
  }, 30_000)

  it('uses the official first Growl cry settings', () => {
    expect(resolveConfirmedHgssCryModulation(9)).toEqual({
      reverse: true,
      playbackRate: 0.8125,
      maximumFrames: 13,
    })
  })

  it('uses the official second Growl cry pitch and duration', () => {
    expect(resolveConfirmedHgssCryModulation(10)).toEqual({
      reverse: false,
      playbackRate: 2 ** (-0.6875 / 12),
      maximumFrames: 100,
      fadeFrames: 10,
    })
  })

  it('does not invent patterns outside the native 0..14 jump table', () => {
    expect(resolveConfirmedHgssCryModulation(15)).toBeUndefined()
  })
})

describe('HGSS ROM finite field audio', () => {
  const playback = { endTime: 12, wallClockEndTime: 4_000 }

  it('stays active while both the audio and monotonic clocks are inside the sequence', () => {
    expect(isScheduledRomAudioPlaying(playback, 11, 3_999)).toBe(true)
  })

  it('releases field scripts when Web Audio is suspended past the real-time deadline', () => {
    expect(isScheduledRomAudioPlaying(playback, 3, 4_000)).toBe(false)
  })

  it('finishes normally when the audio clock reaches the ROM sequence ending', () => {
    expect(isScheduledRomAudioPlaying(playback, 12, 1_000)).toBe(false)
  })
})
