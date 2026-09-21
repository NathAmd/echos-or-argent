import { describe, expect, it, vi } from 'vitest'
import { createRomAudioFanfareGate } from './romAudioFanfareGate'
import { createRomAudioMusicBus } from './romAudioMusicBus'

function fakeAudioContext() {
  const destination = {} as AudioDestinationNode
  const gains: Array<GainNode & { disconnect: ReturnType<typeof vi.fn> }> = []
  const context = {
    currentTime: 4,
    destination,
    createGain: vi.fn(() => {
      const gainParam = {
        value: 1,
        cancelScheduledValues: vi.fn(),
        setValueAtTime: vi.fn(function (this: { value: number }, value: number) {
          this.value = value
          return this
        }),
      }
      const gain = {
        context,
        gain: gainParam,
        connect: vi.fn(),
        disconnect: vi.fn(),
      } as unknown as GainNode & { disconnect: ReturnType<typeof vi.fn> }
      gains.push(gain)
      return gain
    }),
  } as unknown as AudioContext
  return { context, destination, gains }
}

describe('ROM audio global music bus', () => {
  it('branche une nouvelle BGM deja mutee lorsqu une fanfare possede le gate', () => {
    const audio = fakeAudioContext()
    const musicBus = createRomAudioMusicBus()
    const fanfareGate = createRomAudioFanfareGate({
      graceMilliseconds: 250,
      setMusicMuted: musicBus.setMuted,
    })

    fanfareGate.begin()
    const destination = musicBus.route(audio.context)

    expect(destination).toBe(audio.gains[0])
    expect(audio.gains[0]?.gain.value).toBe(0)
    expect(audio.gains[0]?.connect).toHaveBeenCalledExactlyOnceWith(audio.destination)
    expect(musicBus.isMuted()).toBe(true)
    fanfareGate.stop()
    expect(audio.gains[0]?.gain.setValueAtTime).toHaveBeenLastCalledWith(1, 4)
  })

  it('reutilise un seul bus par contexte et deconnecte le contexte ferme', () => {
    const audio = fakeAudioContext()
    const musicBus = createRomAudioMusicBus()

    expect(musicBus.route(audio.context)).toBe(musicBus.route(audio.context))
    expect(audio.context.createGain).toHaveBeenCalledOnce()
    musicBus.disconnect()
    expect(audio.gains[0]?.disconnect).toHaveBeenCalledOnce()
  })
})
