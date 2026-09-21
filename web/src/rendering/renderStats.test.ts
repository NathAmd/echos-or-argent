import { describe, expect, it } from 'vitest'
import { createGameRenderStats } from './renderStats'

describe('game render stats', () => {
  it('projects renderer counters into an engine-level snapshot', () => {
    expect(createGameRenderStats(
      { calls: 12, lines: 6, points: 4, triangles: 320 },
      { geometries: 18, textures: 9 },
      8.25,
    )).toEqual({
      calls: 12,
      frameTimeMs: 8.25,
      geometries: 18,
      lines: 6,
      points: 4,
      textures: 9,
      triangles: 320,
    })
  })

  it('does not expose a negative frame duration', () => {
    expect(createGameRenderStats(
      { calls: 0, lines: 0, points: 0, triangles: 0 },
      { geometries: 0, textures: 0 },
      -1,
    ).frameTimeMs).toBe(0)
  })
})