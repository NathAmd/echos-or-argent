import { describe, expect, it } from 'vitest'
import { findFuchsiaGymWall, fuchsiaGymWalls } from './fuchsiaGymMechanism'

describe('Fuchsia Gym native invisible walls', () => {
  it('keeps all sixty exact wall segments and their model offsets', () => {
    expect(fuchsiaGymWalls).toHaveLength(60)
    expect(findFuchsiaGymWall(8, 5)).toMatchObject({ id: 6, modelId: 0, xOffset: -1, zOffset: 0, neighbors: [3, 5, 8] })
    expect(findFuchsiaGymWall(11, 20)).toMatchObject({ id: 59, modelId: 11, neighbors: [58, 48, 57, 46] })
    expect(findFuchsiaGymWall(0, 0)).toBeUndefined()
  })
})
