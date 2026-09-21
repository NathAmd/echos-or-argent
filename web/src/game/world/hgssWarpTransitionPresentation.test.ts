import { describe, expect, it, vi } from 'vitest'
import { hgssWarpMetatileBehaviors as behavior, type HgssWarpActivation } from './hgssWarpActivation'
import {
  hgssWarpTransitionAudio,
  playHgssWarpTransition,
  resolveHgssDirectTransitionNo,
  resolveHgssWarpTransitionPresentation,
} from './hgssWarpTransitionPresentation'

describe('HGSS warp transition presentation', () => {
  it('keeps the native stair step, sound and six-VBlank palette fade', () => {
    const presentation = resolveHgssWarpTransitionPresentation({
      trigger: 'completed-step-held', behavior: behavior.stairsWest,
      transition: 'stairs', direction: 'west', heldDirection: 'west',
    }, { sourceMapType: 4, destinationMapType: 4, destinationBehavior: behavior.stairsEast })
    expect(presentation.exitMovement?.[0]).toMatchObject({ action: 10, direction: 'west', kind: 'walk' })
    expect(presentation.entryMovement?.[0]).toMatchObject({ action: 10, direction: 'west', kind: 'walk' })
    expect(presentation).toMatchObject({
      entryOffset: { x: 1, z: 0, direction: 'west' }, finalDirection: 'west',
      soundEffectId: hgssWarpTransitionAudio.stairs, fadeFrames: 6, transitionNo: 3,
    })
  })

  it('resolves native direct variants and the white cave-to-outdoor fade', () => {
    expect(resolveHgssDirectTransitionNo(4, 1)).toBe(0)
    expect(resolveHgssDirectTransitionNo(1, 3)).toBe(4)
    expect(resolveHgssDirectTransitionNo(3, 1)).toBe(5)
    expect(resolveHgssDirectTransitionNo(3, 4)).toBe(6)
    expect(resolveHgssWarpTransitionPresentation({
      trigger: 'completed-step', behavior: behavior.warpNorth, transition: 'direct', direction: 'north',
    }, { sourceMapType: 3, destinationMapType: 1 })).toMatchObject({ transitionNo: 5, fadeColor: 0x7fff })
  })

  it('derives the source-facing motion of a face-flipping escalator', () => {
    const presentation = resolveHgssWarpTransitionPresentation({
      trigger: 'completed-step', behavior: behavior.escalatorFlipFace,
      transition: 'escalator', direction: 'west',
    })
    expect(presentation.exitMovement?.[0]).toMatchObject({ action: 11, direction: 'east', kind: 'walk' })
    expect(presentation.entryMovement?.[0]).toMatchObject({ action: 10, direction: 'west', repetitions: 2 })
    expect(presentation).toMatchObject({
      entryOffset: { x: 2, z: 0, direction: 'west' }, continuousSound: true,
      soundEffectId: hgssWarpTransitionAudio.escalator, transitionNo: 2,
    })
  })

  it('spins a panel for twenty frames on both sides and leaves no old facing', async () => {
    const events: string[] = []
    const activation: HgssWarpActivation = {
      trigger: 'completed-step', behavior: behavior.panel,
      transition: 'panel', direction: 'east',
    }
    await playHgssWarpTransition({
      activation,
      initialDirection: 'north',
      movePlayer: vi.fn(async () => undefined),
      setPlayerDirection: (direction) => { events.push(`face:${direction}`) },
      setDestinationDirection: (direction) => { events.push(`world:${direction}`) },
      playSoundEffect: (id) => { events.push(`sound:${id}`) },
      fadeScreen: (phase, frames) => { events.push(`fade:${phase}:${frames}`) },
      transition: () => { events.push('transition'); return false },
      waitFrames: async (frames) => { events.push(`wait:${frames}`) },
    })
    // Dix quarts de tour par phase, plus le délai natif de deux VBlank avant
    // le fade-in du panel destination.
    expect(events.filter((event) => event === 'wait:2')).toHaveLength(21)
    expect(events.filter((event) => event === `sound:${hgssWarpTransitionAudio.teleporter}`)).toHaveLength(2)
    expect(events).toContain('fade:out:6')
    expect(events).toContain('fade:in:6')
    expect(events.at(-1)).toBe('face:south')
  })

  it('does not replay a generic entry over a destination door arrival', async () => {
    const events: string[] = []
    await playHgssWarpTransition({
      activation: { trigger: 'completed-step', behavior: behavior.warpNorth, transition: 'direct', direction: 'north' },
      initialDirection: 'north',
      movePlayer: async () => undefined,
      setPlayerDirection: () => undefined,
      playSoundEffect: () => undefined,
      fadeScreen: (phase) => { events.push(phase) },
      transition: async () => true,
      waitFrames: async () => undefined,
    })
    expect(events).toEqual(['out'])
  })
})
