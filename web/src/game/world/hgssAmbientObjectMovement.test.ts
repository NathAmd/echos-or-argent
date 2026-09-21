import { describe, expect, it } from 'vitest'
import type { MapEventPreview, PlayerDirection } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  createHgssAmbientObjectMovementController,
  hgssAmbientVBlankFrame,
  resolveHgssAmbientObjectBehavior,
  type HgssAmbientMotion,
  type HgssAmbientObjectMovementHooks,
  type HgssAmbientObjectState,
} from './hgssAmbientObjectMovement'

type ObjectTemplate = MapEventPreview['objects'][number]

function object(movement: number, overrides: Partial<ObjectTemplate> = {}): ObjectTemplate {
  return {
    id: 1,
    spriteId: 1,
    movement,
    type: 0,
    eventFlag: 0,
    scriptId: 0,
    facingDirection: 1,
    parameters: [0, 0, 0],
    xRange: 4,
    zRange: 4,
    x: 10,
    z: 10,
    ...overrides,
  }
}

function rng(values: number[]): HgssLcrng {
  let index = 0
  return { getSeed: () => index, nextU16: () => values[index++] ?? 0 }
}

function harness(template: ObjectTemplate, tryResults: boolean[] = []) {
  const actor: HgssAmbientObjectState = { x: template.x, z: template.z, direction: 'south', movement: template.movement }
  const faces: PlayerDirection[] = []
  const motions: HgssAmbientMotion[] = []
  const completions: Array<() => void> = []
  const hooks: HgssAmbientObjectMovementHooks = {
    getObjectState: () => actor,
    getPlayerState: () => undefined,
    isObjectActive: () => true,
    isObjectBusy: () => false,
    faceObject: (_objectId, direction) => { actor.direction = direction; faces.push(direction) },
    tryMoveObject: (_objectId, direction) => {
      const moved = tryResults.shift() ?? true
      if (moved) {
        if (direction === 'north') actor.z -= 1
        else if (direction === 'south') actor.z += 1
        else if (direction === 'west') actor.x -= 1
        else actor.x += 1
      }
      return moved
    },
    startMotion: (motion, complete) => { motions.push(motion); completions.push(complete) },
  }
  return { actor, faces, motions, completions, hooks }
}

describe('HGSS autonomous map-object movement', () => {
  it('uses the native 60 Hz VBlank clock', () => {
    expect(hgssAmbientVBlankFrame(0)).toBe(0)
    expect(hgssAmbientVBlankFrame(1000 / 60)).toBe(1)
    expect(hgssAmbientVBlankFrame(1000)).toBe(60)
  })

  it('draws the native random-facing wait before the direction', () => {
    const template = object(2)
    const source = rng([0, 1, 2])
    const controller = createHgssAmbientObjectMovementController()
    const runtime = harness(template)
    controller.reset([template], 0, source)

    controller.update(15, source, runtime.hooks)
    expect(runtime.faces).toEqual([])
    controller.update(16, source, runtime.hooks)
    expect(runtime.faces).toEqual(['west'])
    controller.update(47, source, runtime.hooks)
    expect(runtime.faces).toEqual(['west'])
  })

  it('runs a random walk through its held pose, wait, direction and 8-frame motion', () => {
    const template = object(3)
    const source = rng([0, 2])
    const controller = createHgssAmbientObjectMovementController()
    const runtime = harness(template)
    controller.reset([template], 0, source)

    controller.update(0, source, runtime.hooks)
    controller.update(1, source, runtime.hooks)
    controller.update(16, source, runtime.hooks)
    expect(runtime.motions).toEqual([])
    controller.update(17, source, runtime.hooks)
    expect(runtime.motions).toEqual([{ objectId: 1, direction: 'west', kind: 'walk' }])
    expect(runtime.actor.x).toBe(9)

    runtime.completions[0]!()
    controller.update(18, source, runtime.hooks)
    expect(runtime.faces.at(-1)).toBe('west')
  })

  it('applies fixed directions and both native turning orders', () => {
    for (const [movement, expected] of [[14, 'north'], [15, 'south'], [16, 'west'], [17, 'east']] as const) {
      const template = object(movement)
      const source = rng([])
      const controller = createHgssAmbientObjectMovementController()
      const runtime = harness(template)
      controller.reset([template], 0, source)
      controller.update(0, source, runtime.hooks)
      expect(runtime.faces).toEqual([expected])
    }

    const leftTemplate = object(18)
    const leftSource = rng([])
    const left = createHgssAmbientObjectMovementController()
    const leftRuntime = harness(leftTemplate)
    left.reset([leftTemplate], 0, leftSource)
    left.update(0, leftSource, leftRuntime.hooks)
    expect(leftRuntime.faces).toEqual(['east'])
    left.update(25, leftSource, leftRuntime.hooks)
    expect(leftRuntime.faces).toEqual(['east', 'north'])
  })

  it('uses the ROM route table and tries its next direction after a collision', () => {
    const template = object(38)
    const source = rng([])
    const controller = createHgssAmbientObjectMovementController()
    const runtime = harness(template, [false, true])
    controller.reset([template], 0, source)
    controller.update(0, source, runtime.hooks)

    expect(runtime.faces).toEqual(['south', 'east'])
    expect(runtime.motions).toEqual([{ objectId: 1, direction: 'east', kind: 'walk' }])
  })

  it('reinitializes a behavior changed by SetObjectMovementType', () => {
    const template = object(0)
    const source = rng([])
    const controller = createHgssAmbientObjectMovementController()
    const runtime = harness(template)
    controller.reset([template], 0, source)
    controller.update(0, source, runtime.hooks)
    runtime.actor.movement = 14
    controller.update(1, source, runtime.hooks)
    expect(runtime.faces).toEqual(['north'])
  })

  it('classifies all native positional movement families without treating specialized objects as walkers', () => {
    expect(resolveHgssAmbientObjectBehavior(0).kind).toBe('still')
    expect(resolveHgssAmbientObjectBehavior(2).kind).toBe('random-facing')
    expect([3, 4, 5].map((movement) => resolveHgssAmbientObjectBehavior(movement).kind)).toEqual(['random-walk', 'random-walk', 'random-walk'])
    expect([14, 15, 16, 17].map((movement) => resolveHgssAmbientObjectBehavior(movement).kind)).toEqual(['fixed-facing', 'fixed-facing', 'fixed-facing', 'fixed-facing'])
    expect(resolveHgssAmbientObjectBehavior(20).kind).toBe('continuous-walk')
    expect(Array.from({ length: 24 }, (_, index) => resolveHgssAmbientObjectBehavior(21 + index).kind).every((kind) => kind === 'route')).toBe(true)
    expect([47, 48, 49, 50, 51, 52, 53, 54, 55, 56].map((movement) => resolveHgssAmbientObjectBehavior(movement).kind).every((kind) => kind === 'still')).toBe(true)
  })
})
