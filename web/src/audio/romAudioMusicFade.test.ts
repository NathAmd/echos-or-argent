import { describe, expect, it, vi } from 'vitest'
import { hgssVBlanksToMilliseconds } from '../game/time/hgssFrameTiming'
import { createRomAudioMusicFadeController } from './romAudioMusicFade'

function fakePlayback(nominalVolume = 0.5) {
  const context = { currentTime: 3 } as BaseAudioContext
  const gain = {
    value: nominalVolume,
    cancelScheduledValues: vi.fn(),
    setValueAtTime: vi.fn(function (this: { value: number }, value: number) {
      this.value = value
      return this
    }),
    linearRampToValueAtTime: vi.fn(),
  }
  return {
    playback: { output: { context, gain } as unknown as GainNode, nominalVolume },
    context,
    gain,
  }
}

describe('ROM BGM fade arbitration', () => {
  it('applique le volume player au volume nominal de la sequence SDAT', async () => {
    vi.useFakeTimers()
    try {
      const { playback, gain } = fakePlayback(0.4)
      const controller = createRomAudioMusicFadeController()
      const fade = controller.fade(playback, 127, 6, () => true)

      expect(gain.linearRampToValueAtTime).toHaveBeenCalledWith(0.4, 3 + hgssVBlanksToMilliseconds(6) / 1000)
      await vi.runAllTimersAsync()
      await fade
      expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0.4, 3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ne laisse pas le timer d un ancien fondu ecraser le plus recent', async () => {
    vi.useFakeTimers()
    try {
      const { playback, gain } = fakePlayback()
      const controller = createRomAudioMusicFadeController()
      const obsolete = controller.fade(playback, 0, 120, () => true)
      const current = controller.fade(playback, 127, 6, () => true)

      await vi.advanceTimersByTimeAsync(hgssVBlanksToMilliseconds(6))
      await current
      await vi.runAllTimersAsync()
      await obsolete
      expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0.5, 3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('force la valeur finale meme si l horloge Web Audio est suspendue', async () => {
    vi.useFakeTimers()
    try {
      const { playback, gain } = fakePlayback()
      const controller = createRomAudioMusicFadeController()
      const fade = controller.fade(playback, 0, 6, () => true)

      await vi.runAllTimersAsync()
      await fade
      expect(gain.setValueAtTime).toHaveBeenLastCalledWith(0, 3)
    } finally {
      vi.useRealTimers()
    }
  })

  it('ignore la fin d un fondu dont la piste a ete remplacee', async () => {
    vi.useFakeTimers()
    try {
      const { playback, gain } = fakePlayback()
      const controller = createRomAudioMusicFadeController()
      const fade = controller.fade(playback, 0, 6, () => false)

      await vi.runAllTimersAsync()
      await fade
      expect(gain.setValueAtTime).not.toHaveBeenLastCalledWith(0, 3)
    } finally {
      vi.useRealTimers()
    }
  })
})
