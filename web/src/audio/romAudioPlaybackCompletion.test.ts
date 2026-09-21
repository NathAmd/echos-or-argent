import { describe, expect, it, vi } from 'vitest'
import { createRomAudioPlaybackCompletion } from './romAudioPlaybackCompletion'

describe('ROM audio playback completion', () => {
  it('attend la fin réelle de toutes les sources Web Audio', async () => {
    vi.useFakeTimers()
    try {
      const completion = createRomAudioPlaybackCompletion(2, 5_000)
      let finished = false
      void completion.finished.then(() => { finished = true })
      completion.markSourceEnded()
      await Promise.resolve()
      expect(finished).toBe(false)
      completion.markSourceEnded()
      await completion.finished
      expect(finished).toBe(true)
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('libère immédiatement une attente quand le son est arrêté', async () => {
    vi.useFakeTimers()
    try {
      const completion = createRomAudioPlaybackCompletion(3, 5_000)
      completion.finish()
      await expect(completion.finished).resolves.toBeUndefined()
      expect(vi.getTimerCount()).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('emploie le délai monotone comme garde-fou si AudioContext est suspendu', async () => {
    vi.useFakeTimers()
    try {
      const completion = createRomAudioPlaybackCompletion(1, 250)
      const finished = vi.fn()
      void completion.finished.then(finished)
      await vi.advanceTimersByTimeAsync(249)
      expect(finished).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(finished).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('conserve le silence final encode dans la timeline avant de liberer le player', async () => {
    vi.useFakeTimers()
    try {
      const completion = createRomAudioPlaybackCompletion(1, 5_000, 250)
      const finished = vi.fn()
      void completion.finished.then(finished)
      completion.markSourceEnded()

      await vi.advanceTimersByTimeAsync(249)
      expect(finished).not.toHaveBeenCalled()
      await vi.advanceTimersByTimeAsync(1)
      expect(finished).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })
})
