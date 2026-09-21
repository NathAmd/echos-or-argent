import { describe, expect, it, vi } from 'vitest'
import { playRomCrySequence, playRomCryThenFanfare, playRomPresentationWithSoundEffect, startRomCry, startRomSoundEffect } from './romAudioPresentation'

describe('coordination des presentations audio ROM', () => {
  it('ne bloque pas une animation sur la duree complete de son effet sonore', async () => {
    let rejectPlayback!: (reason?: unknown) => void
    const playback = new Promise<void>((_, reject) => { rejectPlayback = reject })
    const error = vi.fn()
    const audio = { playSoundEffect: vi.fn(() => playback) }

    startRomSoundEffect(audio, 1510, error)

    expect(audio.playSoundEffect).toHaveBeenCalledExactlyOnceWith(1510)
    expect(error).not.toHaveBeenCalled()
    rejectPlayback(new Error('lecture interrompue'))
    await playback.catch(() => undefined)
    await Promise.resolve()
    expect(error).toHaveBeenCalledOnce()
  })

  it('attend seulement la presentation quand elle possede un effet sonore', async () => {
    let finishSound!: () => void
    let finishPresentation!: (value: string) => void
    const sound = new Promise<void>((resolve) => { finishSound = resolve })
    const presentation = new Promise<string>((resolve) => { finishPresentation = resolve })
    const audio = { playSoundEffect: vi.fn(() => sound) }

    const playback = playRomPresentationWithSoundEffect(() => presentation, audio, 1510)
    finishPresentation('porte ouverte')

    await expect(playback).resolves.toBe('porte ouverte')
    expect(audio.playSoundEffect).toHaveBeenCalledExactlyOnceWith(1510)
    finishSound()
  })

  it('demarre un cri fire-and-forget avec un motif distinct de la forme', () => {
    const audio = { playCry: vi.fn(async () => undefined) }

    startRomCry(audio, 479)

    expect(audio.playCry).toHaveBeenCalledExactlyOnceWith(479, 0, undefined, undefined)
  })

  it('serialise les deux cris d’une entrée double', async () => {
    let finishFirst!: () => void
    const first = new Promise<void>((resolve) => { finishFirst = resolve })
    const playCryAndWait = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValueOnce(undefined)
    const playback = playRomCrySequence({ playCryAndWait }, [{ speciesId: 74 }, { speciesId: 95 }])
    await Promise.resolve()

    expect(playCryAndWait).toHaveBeenCalledTimes(1)
    finishFirst()
    await expect(playback).resolves.toBe(true)
    expect(playCryAndWait.mock.calls).toEqual([
      [74, 0, undefined, undefined],
      [95, 0, undefined, undefined],
    ])
  })

  it('attend la fin reelle du cri avant de lancer la fanfare', async () => {
    let finishCry!: () => void
    const cry = new Promise<void>((resolve) => { finishCry = resolve })
    const audio = {
      playCryAndWait: vi.fn(() => cry),
      playFanfare: vi.fn(async () => undefined),
    }
    const playback = playRomCryThenFanfare(audio, { speciesId: 74, pattern: 0 }, 1188)
    await Promise.resolve()

    expect(audio.playCryAndWait).toHaveBeenCalledExactlyOnceWith(74, 0, undefined, undefined)
    expect(audio.playFanfare).not.toHaveBeenCalled()
    finishCry()
    await expect(playback).resolves.toBe(true)
    expect(audio.playFanfare).toHaveBeenCalledExactlyOnceWith(1188)
  })

  it('ne lance pas la fanfare d’une scene remplacee', async () => {
    let current = true
    let finishCry!: () => void
    const cry = new Promise<void>((resolve) => { finishCry = resolve })
    const audio = {
      playCryAndWait: vi.fn(() => cry),
      playFanfare: vi.fn(async () => undefined),
    }
    const playback = playRomCryThenFanfare(
      audio,
      { speciesId: 74, pattern: 0 },
      1188,
      { isCurrent: () => current },
    )
    await Promise.resolve()
    current = false
    finishCry()

    await expect(playback).resolves.toBe(false)
    expect(audio.playFanfare).not.toHaveBeenCalled()
  })
})
