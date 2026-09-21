import { describe, expect, it } from 'vitest'
import { getVioletGymElevatorHeight, resolveVioletGymHeight, violetGymElevator } from './violetGymMechanism'

describe('Violet Gym native elevator', () => {
  it('projects the saved dynamic 3×3 floor at the exact native heights', () => {
    const data = new Uint8Array(0x20)
    expect(getVioletGymElevatorHeight(data)).toBe(32)
    expect(resolveVioletGymHeight(data, 14, 19)).toBe(32)
    new DataView(data.buffer).setUint32(0, 1, true)
    expect(resolveVioletGymHeight(data, 16, 21)).toBe(496)
    expect(resolveVioletGymHeight(data, 13, 19)).toBeUndefined()
    expect((violetGymElevator.upY - violetGymElevator.downY) / violetGymElevator.speedPerFrame).toBe(29)
  })
})
