import { describe, expect, it } from 'vitest'
import { projectHgssSavedWorldPosition } from './hgssSavedWorldPosition'

describe('HGSS saved world position projection', () => {
  it('projects the exact player and follower fields persisted by the browser save', () => {
    const world = {
      map: { id: 61, ignored: 'map-runtime-only' },
      tileX: 4,
      tileZ: 7,
      direction: 'north' as const,
      locomotion: 'cycling' as const,
      groundHeight: 3,
    }
    const follower = {
      tileX: 5,
      tileZ: 7,
      direction: 'west' as const,
      movement: 48,
      groundHeight: 2,
    }

    expect(projectHgssSavedWorldPosition(world, follower)).toEqual({
      mapId: 61,
      tileX: 4,
      tileZ: 7,
      direction: 'north',
      locomotion: 'cycling',
      follower: { tileX: 5, tileZ: 7, direction: 'west', movement: 48 },
    })
  })

  it('preserves an absent follower without mutating its inputs', () => {
    const world = {
      map: { id: 60 },
      tileX: 6,
      tileZ: 6,
      direction: 'south' as const,
      locomotion: 'walking' as const,
    }
    const snapshot = projectHgssSavedWorldPosition(world, undefined)

    expect(snapshot).toEqual({
      mapId: 60,
      tileX: 6,
      tileZ: 6,
      direction: 'south',
      locomotion: 'walking',
      follower: undefined,
    })
    expect(world).toEqual({ map: { id: 60 }, tileX: 6, tileZ: 6, direction: 'south', locomotion: 'walking' })
  })
})
