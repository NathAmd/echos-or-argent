import { describe, expect, it, vi } from 'vitest'
import {
  hgssFieldPoisonEffectFrames,
  hgssFieldPoisonEffectSoundId,
  hgssFieldPoisonKeyframes,
  playHgssFieldPoisonPresentation,
} from './hgssFieldPoisonPresentation'

describe('HGSS field poison presentation', () => {
  it('joue DOKU2 et les six offsets horizontaux natifs sans laisser de translation', async () => {
    const finished = Promise.resolve()
    const animate = vi.fn(() => ({ finished } as unknown as Animation))
    const sound = vi.fn()

    await playHgssFieldPoisonPresentation([
      { animate } as unknown as HTMLElement,
      { animate } as unknown as HTMLElement,
    ], sound)

    expect(sound).toHaveBeenCalledWith(hgssFieldPoisonEffectSoundId)
    expect(animate).toHaveBeenCalledTimes(2)
    expect(animate).toHaveBeenCalledWith([...hgssFieldPoisonKeyframes], expect.objectContaining({
      easing: `steps(${hgssFieldPoisonEffectFrames}, end)`,
    }))
    expect(hgssFieldPoisonKeyframes.at(-1)).toEqual({ transform: 'translateX(0)' })
  })
})
