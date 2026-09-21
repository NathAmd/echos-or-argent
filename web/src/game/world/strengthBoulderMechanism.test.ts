import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { findStrengthHoleTiles, resolveStrengthBoulderFall } from './strengthBoulderMechanism'

function createMap(id: number, mapSection: number, objects: MapEventPreview['objects']): OpeningMapPreview {
  return {
    id,
    label: `Map ${id}`,
    header: { mapId: id, mapSection } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] },
    initScripts: [], messages: {},
    matrix: { matrixIndex: id, name: '', width: 1, height: 1, headers: new Uint16Array([id]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
    events: { backgroundEvents: 0, backgrounds: [], coordinateEvents: [{ scriptId: 1, x: 1, z: 1, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 1 }], objects, warps: [] },
    terrain: { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16).fill(62) },
    model: {
      modelId: 0, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
      surfaces: [{ materialIndex: 0, materialName: 'd_stairhole', positions: new Float32Array([-16, 0, -16, 0, 0, -16, -16, 0, 0]) }],
    },
  }
}

const rock = (id: number, eventFlag: number, scriptId = 10002) => ({
  id, spriteId: 84, movement: 15, type: 0, eventFlag, scriptId, facingDirection: 1,
  xRange: 0, zRange: 0, x: 1, z: 1,
})

describe('strength boulder mechanism', () => {
  it('distinguishes a ROM hole from a ladder sharing the same scene material', () => {
    const map = createMap(1, 9, [rock(0, 490)])
    expect([...findStrengthHoleTiles(map)]).toEqual([])
    map.terrain!.attributes[1 * 4 + 1] = 0
    const uncachedMap = { ...map }
    expect([...findStrengthHoleTiles(uncachedMap)]).toEqual(['1:1'])
  })

  it('pairs upper and fallen boulders by ROM flags without map coordinates', () => {
    const upper = createMap(41, 217, [rock(0, 490), rock(1, 491)])
    upper.terrain!.attributes[1 * 4 + 1] = 0
    const lower = createMap(77, 217, [rock(0, 494, 3), rock(1, 495, 3)])
    expect(resolveStrengthBoulderFall([upper, lower], upper, upper.events!.objects[0]!, 1, 1)).toEqual({
      sourceEventFlag: 490,
      targetEventFlag: 494,
      targetMapId: 77,
    })
  })
})
