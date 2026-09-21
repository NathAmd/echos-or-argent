import { describe, expect, it, vi } from 'vitest'
import { createRomAudioPlayerChannels } from './romAudioPlayerChannels'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

describe('ROM audio SDAT player arbitration', () => {
  it('remplace deux effets differents qui partagent le meme player natif', async () => {
    const release = vi.fn()
    const players = createRomAudioPlayerChannels(release)
    const first = await players.play(3, 1800, async () => 'throw')
    const second = await players.play(3, 1801, async () => 'bounce')

    expect(first).toBeDefined()
    expect(second).toBeDefined()
    expect(players.current(3)?.sequenceId).toBe(1801)
    expect(release).toHaveBeenCalledExactlyOnceWith('throw')
  })

  it('laisse jouer en parallele des players SDAT distincts', async () => {
    const release = vi.fn()
    const players = createRomAudioPlayerChannels(release)
    await players.play(3, 1800, async () => 'effect')
    await players.play(4, 2200, async () => 'ambient')

    expect(players.current(3)?.playback).toBe('effect')
    expect(players.current(4)?.playback).toBe('ambient')
    expect(release).not.toHaveBeenCalled()
  })

  it('considere le player occupe pendant AudioContext.resume et stoppe seulement la sequence demandee', async () => {
    const pending = deferred<string>()
    const release = vi.fn()
    const players = createRomAudioPlayerChannels(release)
    const playback = players.play(3, 1800, () => pending.promise)

    expect(players.isOccupied(3)).toBe(true)
    expect(players.stop(3, 1801)).toBe(false)
    expect(players.isOccupied(3)).toBe(true)
    expect(players.stop(3, 1800)).toBe(true)
    pending.resolve('late-effect')

    await expect(playback).resolves.toBeUndefined()
    expect(players.isOccupied(3)).toBe(false)
    expect(release).toHaveBeenCalledExactlyOnceWith('late-effect')
  })

  it('ne confond pas une ancienne sequence avec sa remplacante encore en initialisation', async () => {
    const pending = deferred<string>()
    const players = createRomAudioPlayerChannels(vi.fn())
    await players.play(3, 1800, async () => 'first')
    const replacement = players.play(3, 1801, () => pending.promise)

    expect(players.current(3)).toBeUndefined()
    expect(players.isOccupied(3)).toBe(true)
    pending.resolve('second')
    await replacement
  })

  it('ne permet pas a une ancienne fin de liberer le nouveau proprietaire', async () => {
    const players = createRomAudioPlayerChannels(vi.fn())
    const first = await players.play(3, 1800, async () => 'first')
    const second = await players.play(3, 1801, async () => 'second')

    expect(first && players.finish(first)).toBe(false)
    expect(second && players.finish(second)).toBe(true)
    expect(players.hasOccupiedPlayer()).toBe(false)
  })
})
