import { describe, expect, it } from 'vitest'
import type { MapMatrixPreview } from '../../ndsTypes'
import { createHgssSafariAreaSet } from './hgssSafariState'
import {
  HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE,
  applyHgssSafariCollisionTiles,
  composeHgssSafariMatrix,
  getHgssSafariNativeObjectTranslation,
  hgssSafariObjectConfigs,
  resolveHgssSafariAreaCellAtWorldPosition,
  resolveHgssSafariAreaIdAtWorldPosition,
  resolveHgssSafariAreaSetPlacements,
  resolveHgssSafariObjectModelId,
  resolveHgssSafariPlacement,
} from './hgssSafariMap'

function createSafariMatrix(): MapMatrixPreview {
  const altitudes = new Uint8Array(20)
  altitudes[12] = 2
  return {
    matrixIndex: 212,
    name: 'm_safari_',
    width: 5,
    height: 4,
    hasHeaders: true,
    headers: new Uint16Array([
      0, 0, 0, 0, 0,
      0, 357, 357, 357, 0,
      0, 357, 357, 357, 0,
      0, 0, 357, 0, 0,
    ]),
    altitudes,
    modelIds: Uint16Array.from({ length: 20 }, (_, index) => 600 + index),
  }
}

describe('composition native de la carte Safari HGSS', () => {
  it('remplace uniquement les six cellules centrales de la matrice 212', () => {
    const matrix = createSafariMatrix()
    const originalModels = [...matrix.modelIds]
    const areaSet = createHgssSafariAreaSet([0, 7, 1, 5, 3, 6])
    const composed = composeHgssSafariMatrix(matrix, areaSet)

    expect([...composed.modelIds]).toEqual([
      600, 601, 602, 603, 604,
      605, 652, 659, 653, 609,
      610, 657, 655, 658, 614,
      615, 616, 617, 618, 619,
    ])
    expect([...matrix.modelIds]).toEqual(originalModels)
    expect(composed).not.toBe(matrix)
  })

  it('laisse une autre matrice intacte comme PlaceSafariZoneAreas', () => {
    const matrix = { ...createSafariMatrix(), matrixIndex: 211 }
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    expect(composeHgssSafariMatrix(matrix, areaSet)).toBe(matrix)
  })

  it('resout les six cellules et leurs coordonnees locales depuis la position monde', () => {
    const areaSet = createHgssSafariAreaSet([0, 7, 1, 5, 3, 6])
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 32, 32)).toMatchObject({
      areaSlot: 0, areaId: 0, column: 0, row: 0, matrixCellIndex: 6, localX: 0, localZ: 0,
    })
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 95.5, 63.75)).toMatchObject({
      areaSlot: 1, areaId: 7, column: 1, row: 0, matrixCellIndex: 7, localX: 31.5, localZ: 31.75,
    })
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 127, 95)).toMatchObject({
      areaSlot: 5, areaId: 6, column: 2, row: 1, matrixCellIndex: 13, localX: 31, localZ: 31,
    })
    expect(resolveHgssSafariAreaIdAtWorldPosition(areaSet, 70, 70)).toBe(3)
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 31, 32)).toBeUndefined()
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 128, 32)).toBeUndefined()
    expect(resolveHgssSafariAreaCellAtWorldPosition(areaSet, 32, 96)).toBeUndefined()
  })
})

describe('Blocs et collisions Safari HGSS', () => {
  it('verrouille les 24 configurations BUILD_MODEL natives', () => {
    expect(hgssSafariObjectConfigs.map(({ baseModelId }) => baseModelId)).toEqual([
      189, 190, 191, 192, 193, 194, 195, 196, 197, 198, 199, 200,
      201, 202, 203, 204, 205, 206, 207, 209, 211, 212, 213, 214,
    ])
    expect(hgssSafariObjectConfigs.map(({ width, height }) => `${width}x${height}`)).toEqual([
      '1x1', '1x1', '1x1', '2x2', '2x2', '2x2', '1x1', '2x2', '2x2', '2x2', '2x2', '2x2',
      '2x1', '1x1', '1x1', '2x1', '1x2', '1x1', '1x1', '1x1', '1x1', '1x1', '1x1', '1x1',
    ])
    expect(hgssSafariObjectConfigs.map(({ objectType }) => objectType)).toEqual([
      1, 1, 1, 2, 2, 2, 3, 3, 3, 4, 4, 4,
      0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    ])
    expect(hgssSafariObjectConfigs.filter(({ isAnimated }) => isAnimated).map(({ objectId }) => objectId)).toEqual([10])
    expect(hgssSafariObjectConfigs.filter(({ hasGenderedLayout }) => hasGenderedLayout).map(({ objectId }) => objectId)).toEqual([18, 19])
    expect(resolveHgssSafariObjectModelId(18, 'male')).toBe(207)
    expect(resolveHgssSafariObjectModelId(18, 'female')).toBe(208)
    expect(resolveHgssSafariObjectModelId(19, 'male')).toBe(209)
    expect(resolveHgssSafariObjectModelId(19, 'female')).toBe(210)
  })

  it('reproduit la translation Nitro et le rectangle de collision inverse en Z', () => {
    const matrix = createSafariMatrix()
    const areaSet = createHgssSafariAreaSet([0, 7, 1, 5, 3, 6])
    const placement = { objectId: 3 as const, x: 4, y: 32, z: 8 }

    expect(getHgssSafariNativeObjectTranslation(placement)).toEqual([-176, 32, -128])
    const resolved = resolveHgssSafariPlacement(matrix, areaSet, 4, placement, 0, 'male')
    expect(resolved).toMatchObject({ areaSlot: 4, areaId: 3, placementIndex: 0 })
    expect(resolved.mapProp).toEqual({
      modelId: 192,
      position: [37, 18, 40],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      mapMatrixCellIndex: 12,
    })
    expect(resolved.collisionTiles).toEqual([
      { worldX: 68, worldZ: 72, tileX: 36, tileZ: 40, areaCollisionIndex: 260, attribute: 0x8023 },
      { worldX: 69, worldZ: 72, tileX: 37, tileZ: 40, areaCollisionIndex: 261, attribute: 0x8023 },
      { worldX: 68, worldZ: 71, tileX: 36, tileZ: 39, areaCollisionIndex: 228, attribute: 0x8023 },
      { worldX: 69, worldZ: 71, tileX: 37, tileZ: 39, areaCollisionIndex: 229, attribute: 0x8023 },
    ])
  })

  it('convertit tout le set et applique les collisions sans muter le terrain source', () => {
    const matrix = createSafariMatrix()
    const areaSet = createHgssSafariAreaSet([0, 1, 2, 3, 4, 5])
    areaSet.areas[0].placements.push({ objectId: 0, x: 1, y: 0, z: 1 })
    areaSet.areas[5].placements.push({ objectId: 12, x: 10, y: 0, z: 10 })
    const placements = resolveHgssSafariAreaSetPlacements(matrix, areaSet, 'female')
    expect(placements).toHaveLength(2)
    expect(placements.map(({ mapProp }) => mapProp.modelId)).toEqual([189, 201])

    const source = new Uint16Array(96 * 96).fill(7)
    const collisionTiles = placements.flatMap(({ collisionTiles }) => collisionTiles)
    const result = applyHgssSafariCollisionTiles(source, 96, 96, collisionTiles)
    expect(result).not.toBe(source)
    expect(source.every((attribute) => attribute === 7)).toBe(true)
    for (const tile of collisionTiles) {
      expect(result[tile.tileZ * 96 + tile.tileX]).toBe(HGSS_SAFARI_OBJECT_COLLISION_ATTRIBUTE)
    }
  })

  it('rejette un objet dont le pied depasse la parcelle native 32x32', () => {
    expect(() => getHgssSafariNativeObjectTranslation({ objectId: 3, x: 31, y: 0, z: 0 })).toThrow(/depasse/)
  })
})
