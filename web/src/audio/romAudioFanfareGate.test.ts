import { describe, expect, it, vi } from 'vitest'
import { createRomAudioFanfareGate } from './romAudioFanfareGate'

describe('HGSS fanfare music gate', () => {
  it('demute la BGM si le demarrage de la fanfare courante echoue', () => {
    const setMusicMuted = vi.fn()
    const gate = createRomAudioFanfareGate({ graceMilliseconds: 250, setMusicMuted })
    const session = gate.begin()

    session.fail()

    expect(gate.isPlaying()).toBe(false)
    expect(setMusicMuted.mock.calls).toEqual([[true], [false]])
  })

  it('ne laisse pas une demande remplacee demuter la nouvelle fanfare', () => {
    const setMusicMuted = vi.fn()
    const gate = createRomAudioFanfareGate({ graceMilliseconds: 250, setMusicMuted })
    const obsolete = gate.begin()
    const current = gate.begin()

    obsolete.fail()

    expect(obsolete.isCurrent()).toBe(false)
    expect(current.markPlaying()).toBe(true)
    expect(gate.isPlaying()).toBe(true)
    expect(setMusicMuted).not.toHaveBeenLastCalledWith(false)
    gate.stop()
  })

  it('reste mute lors du remplacement pendant la grace', () => {
    const setMusicMuted = vi.fn()
    const gate = createRomAudioFanfareGate({ graceMilliseconds: 250, setMusicMuted })
    const first = gate.begin()
    first.markPlaying()
    first.beginGrace(vi.fn())

    const second = gate.begin()
    second.markPlaying()

    expect(gate.getPhase()).toBe('playing')
    expect(setMusicMuted).not.toHaveBeenLastCalledWith(false)
    gate.stop()
  })

  it('annule un demarrage pending lors du stop ou dispose', () => {
    const setMusicMuted = vi.fn()
    const gate = createRomAudioFanfareGate({ graceMilliseconds: 250, setMusicMuted })
    const pending = gate.begin()

    gate.stop()

    expect(pending.markPlaying()).toBe(false)
    expect(gate.isPlaying()).toBe(false)
    expect(setMusicMuted).toHaveBeenLastCalledWith(false)
  })

  it('expose les quinze frames de grace a WaitFanfare avant de reprendre la BGM', () => {
    vi.useFakeTimers()
    try {
      let timestamp = 1_000
      const releasePlayback = vi.fn()
      const setMusicMuted = vi.fn()
      const gate = createRomAudioFanfareGate({
        graceMilliseconds: 250,
        setMusicMuted,
        now: () => timestamp,
      })
      const session = gate.begin()
      session.markPlaying()
      session.beginGrace(releasePlayback)

      timestamp = 1_249
      expect(gate.isPlaying()).toBe(true)
      expect(releasePlayback).not.toHaveBeenCalled()
      timestamp = 1_250
      expect(gate.isPlaying()).toBe(false)
      expect(releasePlayback).toHaveBeenCalledOnce()
      expect(setMusicMuted).toHaveBeenLastCalledWith(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
