import { describe, expect, it } from 'vitest'
import { hgssWarpMetatileBehaviors as behavior, resolveHgssWarpActivation } from './hgssWarpActivation'

describe('HGSS warp activation', () => {
  it('reserves facing transitions for colliding behavior-105 doors', () => {
    expect(resolveHgssWarpActivation(0x8069, 'north', 'facing-door')).toEqual({
      trigger: 'facing-door', behavior: 105, transition: 'door', direction: 'north',
    })
    expect(resolveHgssWarpActivation(0x0069, 'north', 'facing-door')).toBeUndefined()
    expect(resolveHgssWarpActivation(0x806e, 'north', 'facing-door')).toBeUndefined()
  })

  it.each([
    [behavior.ladderNorth, 'north', 'ladder'],
    [behavior.ladderSouth, 'south', 'ladder'],
    [behavior.stairsEast, 'east', 'stairs'],
    [behavior.stairsWest, 'west', 'stairs'],
    [behavior.entranceEast, 'east', 'direct'],
    [behavior.entranceWest, 'west', 'direct'],
    [behavior.entranceSouth, 'south', 'direct'],
    [behavior.warpEast, 'east', 'direct'],
    [behavior.warpWest, 'west', 'direct'],
    [behavior.warpSouth, 'south', 'direct'],
  ] as const)('requires the native held direction for behavior %i', (metatileBehavior, direction, transition) => {
    expect(resolveHgssWarpActivation(metatileBehavior, direction, 'current-held')).toEqual({
      trigger: 'current-held', behavior: metatileBehavior, transition, direction, heldDirection: direction,
    })
    expect(resolveHgssWarpActivation(metatileBehavior, direction === 'east' ? 'west' : 'east', 'current-held')).toBeUndefined()
    expect(resolveHgssWarpActivation(metatileBehavior, direction, 'completed-step')).toEqual({
      trigger: 'completed-step-held', behavior: metatileBehavior, transition, direction, heldDirection: direction,
    })
  })

  it.each([
    [behavior.ladderDown, 'ladder-down', 'north'],
    [behavior.entranceNorth, 'direct', 'north'],
    [behavior.panel, 'panel', 'south'],
    [behavior.warpNorth, 'direct', 'north'],
  ] as const)('activates immediate behavior %i only after a completed step', (metatileBehavior, transition, direction) => {
    expect(resolveHgssWarpActivation(metatileBehavior, 'south', 'completed-step')).toEqual({
      trigger: 'completed-step', behavior: metatileBehavior, transition, direction,
    })
    expect(resolveHgssWarpActivation(metatileBehavior, 'south', 'current-held')).toBeUndefined()
  })

  it('preserves or flips the destination facing on escalators', () => {
    expect(resolveHgssWarpActivation(behavior.escalator, 'east', 'completed-step')).toMatchObject({
      transition: 'escalator', direction: 'east',
    })
    expect(resolveHgssWarpActivation(behavior.escalatorFlipFace, 'east', 'completed-step')).toMatchObject({
      transition: 'escalator', direction: 'west',
    })
    expect(resolveHgssWarpActivation(behavior.escalatorFlipFace, 'west', 'completed-step')).toMatchObject({
      transition: 'escalator', direction: 'east',
    })
    expect(resolveHgssWarpActivation(behavior.escalator, 'north', 'completed-step')).toBeUndefined()
  })

  it('passes the current facing into a panel task before its arrival routine forces south', () => {
    expect(resolveHgssWarpActivation(behavior.panel, 'east', 'completed-step')).toEqual({
      trigger: 'completed-step', behavior: behavior.panel, transition: 'panel', direction: 'east',
    })
  })

  it.each([0, 6, 8])('keeps inert behavior-%i WarpEvents as anchors only', (metatileBehavior) => {
    for (const phase of ['facing-door', 'current-held', 'completed-step'] as const) {
      expect(resolveHgssWarpActivation(0x8000 | metatileBehavior, 'north', phase)).toBeUndefined()
    }
  })
})
