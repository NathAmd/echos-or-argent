import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { auditWorldWarps } from './worldAudit'

function createMap(id: number, warps: NonNullable<OpeningMapPreview['events']>['warps']): OpeningMapPreview {
  return {
    id,
    label: `Map ${id}`,
    header: { mapId: id, msgBank: 0, mapSection: 0 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array([0, 0]), headerSize: 2, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: { matrixIndex: id, name: String(id), width: 1, height: 1, headers: new Uint16Array([id]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
    terrain: { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16) },
    events: { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps },
  }
}

describe('world warp audit', () => {
  it('reports a missing destination and accepts an exact non-reciprocal anchor', () => {
    const source = createMap(1, [
      { x: 1, z: 1, header: 2, anchor: 1 },
      { x: 2, z: 1, header: 99, anchor: 0 },
    ])
    const destination = createMap(2, [
      { x: 0, z: 0, header: 1, anchor: 0 },
      { x: 3, z: 2, header: 1, anchor: 0 },
    ])

    expect(auditWorldWarps([source, destination])).toEqual([
      expect.objectContaining({ kind: 'missing-destination', sourceMapId: 1, sourceWarpIndex: 1, destinationMapId: 99 }),
    ])
  })

  it('keeps HGSS dynamic-warp sentinels out of the static map audit', () => {
    const source = createMap(1, [{ x: 1, z: 1, header: 0x0fff, anchor: 0x0100 }])

    expect(auditWorldWarps([source])).toEqual([])
  })
})
