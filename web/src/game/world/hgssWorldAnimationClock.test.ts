import { describe, expect, it } from 'vitest'
import {
  createHgssAnimationClock,
  createHgssVBlankClock,
  hgssVBlankDurationMs,
  hgssVBlanksToMilliseconds,
  sampleBoundedFixedSteps,
  sampleHgssActorSpriteFrame,
  sampleHgssVBlankFrame,
} from './hgssWorldAnimationClock'

describe('HGSS world animation clock', () => {
  it.each([60, 120, 144, 240])('keeps one 60 Hz VBlank clock on a %i Hz display', (refreshRate) => {
    const clock = createHgssVBlankClock()
    clock.sample(0)
    for (let frame = 1; frame <= refreshRate; frame += 1) clock.sample(frame * 1000 / refreshRate)
    expect(clock.sample(1000)).toBe(60)
  })

  it('does not fast-forward ROM animations after a suspended page resumes', () => {
    const clock = createHgssVBlankClock(12)
    expect(clock.sample(100)).toBe(12)
    clock.resynchronize(10_000)
    expect(clock.sample(10_000)).toBe(12)
    expect(clock.sample(10_000 + hgssVBlankDurationMs)).toBe(13)
  })

  it('does not count a frame delta twice when an older render timestamp arrives late', () => {
    const clock = createHgssVBlankClock()
    expect(clock.sample(100)).toBe(0)
    expect(clock.sample(100 + 2 * hgssVBlankDurationMs)).toBe(2)
    expect(clock.sample(100 + hgssVBlankDurationMs)).toBe(2)
    expect(clock.sample(100 + 2 * hgssVBlankDurationMs)).toBe(2)
  })

  it('keeps every decoded native frame in the VBlank timebase', () => {
    expect(hgssVBlankDurationMs).toBeCloseTo(1000 / 60)
    expect(hgssVBlanksToMilliseconds(8)).toBeCloseTo(8000 / 60)
    expect(sampleHgssVBlankFrame(100 + 1000 / 60, 100)).toBe(1)
  })

  it('pauses the shared animation timeline instead of fast-forwarding after resume', () => {
    const clock = createHgssAnimationClock()
    expect(clock.sample(100)).toBe(0)
    expect(clock.sample(150)).toBe(50)
    clock.pause(160)
    expect(clock.sample(5_000)).toBe(60)
    clock.resume(10_000)
    expect(clock.sample(10_000)).toBe(60)
    expect(clock.sample(10_025)).toBe(85)
  })

  it('keeps the shared timeline monotonic across setter and render samples', () => {
    const clock = createHgssAnimationClock()
    expect(clock.sample(100)).toBe(0)
    expect(clock.sample(120)).toBe(20)
    // Un setter a deja echantillonne 120, puis le rendu reutilise le timestamp
    // 110 capture plus tot dans la meme frame.
    expect(clock.sample(110)).toBe(20)
    expect(clock.sample(120)).toBe(20)
    expect(clock.sample(130)).toBe(30)
  })

  it('spreads every follower or NPC cell over one complete movement cycle', () => {
    const cycle = hgssVBlanksToMilliseconds(8)
    expect(sampleHgssActorSpriteFrame(0, 0, 4, cycle)).toBe(0)
    expect(sampleHgssActorSpriteFrame(cycle / 4, 0, 4, cycle)).toBe(1)
    expect(sampleHgssActorSpriteFrame(cycle - .01, 0, 4, cycle)).toBe(3)
    expect(sampleHgssActorSpriteFrame(cycle, 0, 4, cycle)).toBe(0)
  })

  it('bounds fixed-step catch-up to avoid an accelerated burst after a stalled paint', () => {
    expect(sampleBoundedFixedSteps(0, hgssVBlankDurationMs, hgssVBlankDurationMs, 2)).toMatchObject({ steps: 1 })
    const stalled = sampleBoundedFixedSteps(0, 6 * hgssVBlankDurationMs, hgssVBlankDurationMs, 2)
    expect(stalled.steps).toBe(2)
    expect(stalled.remainderMs).toBeLessThan(hgssVBlankDurationMs)
  })
})
