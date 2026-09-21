import { describe, expect, it } from 'vitest'
import { applyBlackthornGymAction, blackthornMagmaMetatileBehavior, getBlackthornGymActionAt, readBlackthornGymPlatforms, resolveBlackthornGymCollision, transformBlackthornGymPassenger } from './blackthornGymMechanism'

function createState(): Uint8Array {
  const data = new Uint8Array(0x20)
  const view = new DataView(data.buffer)
  ;[[13, 75, 0], [9, 58, 1], [14, 32, 0]].forEach(([x, z, rotation], index) => {
    view.setUint16(index * 2, x!, true)
    view.setUint16(6 + index * 2, z!, true)
    data[12 + index] = rotation!
  })
  return data
}

describe('Blackthorn Gym native platforms', () => {
  it('rebuilds the three native shapes and their rotated buttons', () => {
    const [first, second] = readBlackthornGymPlatforms(createState())
    expect(first).toMatchObject({ shape: 0, width: 5, height: 7, rotateButton: { x: 13, z: 75 }, moveLeftButton: { x: 14, z: 75 } })
    expect(second).toMatchObject({ shape: 1, width: 4, height: 8, rotateButton: { x: 9, z: 58 }, moveLeftButton: { x: 9, z: 59 } })
    expect(first?.floor).toHaveLength(18)
    expect(second?.rotateCollisionCheck).toHaveLength(24)
  })

  it('moves a platform and the player by its native width only when every magma edge is clear', () => {
    const data = createState()
    const action = getBlackthornGymActionAt(data, 14, 75)
    expect(action).toEqual({ kind: 'move-right', platformIndex: 0 })
    const result = applyBlackthornGymAction(data, action!, () => true)
    expect(result).toMatchObject({ applied: true, playerX: 19, playerZ: 75, durationFrames: 10 })
    expect(readBlackthornGymPlatforms(data)[0]).toMatchObject({ x: 18, z: 75, rotation: 0 })
  })

  it('returns to the starting state when a leading edge bonks', () => {
    const data = createState()
    const result = applyBlackthornGymAction(data, { kind: 'move-right', platformIndex: 0 }, (x) => x < 18)
    expect(result.applied).toBe(false)
    expect(readBlackthornGymPlatforms(data)[0]).toMatchObject({ x: 13, z: 75 })
  })

  it('rotates clockwise and projects platform floor over blocked magma', () => {
    const data = createState()
    const result = applyBlackthornGymAction(data, { kind: 'rotate', platformIndex: 0 }, () => true)
    expect(result).toMatchObject({ applied: true, playerX: 13, playerZ: 75, durationFrames: 16 })
    expect(readBlackthornGymPlatforms(data)[0]?.rotation).toBe(1)
    expect(resolveBlackthornGymCollision(data, 13, 75, blackthornMagmaMetatileBehavior)).toBe(false)
    expect(resolveBlackthornGymCollision(data, 0, 0, blackthornMagmaMetatileBehavior)).toBe(true)
    expect(resolveBlackthornGymCollision(data, 0, 0, 45)).toBeUndefined()
    expect(resolveBlackthornGymCollision(data, 0, 0, 0)).toBeUndefined()
  })

  it('carries another actor only when it stands on the moving platform', () => {
    const data = createState()
    const moved = applyBlackthornGymAction(data, { kind: 'move-right', platformIndex: 0 }, () => true)
    expect(transformBlackthornGymPassenger(moved, { x: 13, z: 74 })).toEqual({ x: 18, z: 74 })
    expect(transformBlackthornGymPassenger(moved, { x: 1, z: 1 })).toBeUndefined()
    const rotated = applyBlackthornGymAction(createState(), { kind: 'rotate', platformIndex: 0 }, () => true)
    expect(transformBlackthornGymPassenger(rotated, { x: 13, z: 74 })).toEqual({ x: 14, z: 75 })
  })
})
