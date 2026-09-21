import { describe, expect, it, vi } from 'vitest'
import { createRomAudioExclusiveChannel } from './romAudioExclusiveChannel'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ROM audio exclusive channel ownership', () => {
  it('conserve la derniere demande meme si une ancienne initialisation finit apres elle', async () => {
    const first = deferred<string>()
    const second = deferred<string>()
    const release = vi.fn()
    const channel = createRomAudioExclusiveChannel(release)

    const firstPlayback = channel.replace(() => first.promise)
    const secondPlayback = channel.replace(() => second.promise)
    second.resolve('new-fanfare')
    await expect(secondPlayback).resolves.toBe('new-fanfare')
    first.resolve('old-fanfare')

    await expect(firstPlayback).resolves.toBeUndefined()
    expect(channel.peek()).toBe('new-fanfare')
    expect(release).toHaveBeenCalledExactlyOnceWith('old-fanfare')
  })

  it('ne ressuscite pas une lecture qui termine son demarrage apres stop', async () => {
    const pending = deferred<string>()
    const release = vi.fn()
    const channel = createRomAudioExclusiveChannel(release)
    const playback = channel.replace(() => pending.promise)

    channel.stop()
    pending.resolve('late-cry')

    await expect(playback).resolves.toBeUndefined()
    expect(channel.peek()).toBeUndefined()
    expect(release).toHaveBeenCalledExactlyOnceWith('late-cry')
  })

  it('libere une lecture terminee seulement si elle possede encore le canal', async () => {
    const release = vi.fn()
    const channel = createRomAudioExclusiveChannel(release)
    const first = await channel.replace(async () => 'first')
    const second = await channel.replace(async () => 'second')

    expect(first).toBe('first')
    expect(second).toBe('second')
    expect(channel.releaseIfCurrent('first')).toBe(false)
    expect(channel.releaseIfCurrent('second')).toBe(true)
    expect(channel.peek()).toBeUndefined()
    expect(release.mock.calls).toEqual([['first'], ['second']])
  })

  it('ignore l’erreur tardive d’une demande deja remplacee', async () => {
    const pending = deferred<string>()
    const channel = createRomAudioExclusiveChannel(vi.fn())
    const obsolete = channel.replace(() => pending.promise)
    await channel.replace(async () => 'current')
    pending.reject(new Error('contexte ferme'))

    await expect(obsolete).resolves.toBeUndefined()
    expect(channel.peek()).toBe('current')
  })
})
