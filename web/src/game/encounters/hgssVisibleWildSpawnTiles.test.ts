import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { resolveHgssVisibleWildSpawnTiles } from './hgssVisibleWildSpawnTiles'

const map = {
  id: 1,
  matrix: { matrixIndex: 1, name: 'm', width: 1, height: 1, headers: new Uint16Array([1]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
  terrain: { width: 2, height: 2, attributes: new Uint16Array([0, 0x8000, 16, 0]) },
  events: { objects: [{ x: 0, z: 0 }], warps: [], backgrounds: [], coordinateEvents: [] },
} as unknown as OpeningMapPreview

describe('resolveHgssVisibleWildSpawnTiles', () => {
  it('sépare terre et eau et exclut événements/callback hôte', () => {
    expect(resolveHgssVisibleWildSpawnTiles({ map, method: 'land', isBlocked: (x, z) => x === 1 && z === 1 })).toEqual([])
    expect(resolveHgssVisibleWildSpawnTiles({ map, method: 'surfing' })).toEqual([{ tileX: 0, tileZ: 1 }])
  })

  it('réserve toute la surface rectangulaire d un événement de coordonnées', () => {
    const attributes = new Uint16Array(9)
    const eventMap = {
      ...map,
      terrain: { width: 3, height: 3, attributes },
      events: { objects: [], warps: [], backgrounds: [],
        coordinateEvents: [{ x: 1, z: 1, width: 2, height: 2 }] },
    } as unknown as OpeningMapPreview
    expect(resolveHgssVisibleWildSpawnTiles({ map: eventMap, method: 'land' }).filter(({ tileX, tileZ }) => (
      tileX >= 1 && tileX <= 2 && tileZ >= 1 && tileZ <= 2
    ))).toEqual([])
  })
})
