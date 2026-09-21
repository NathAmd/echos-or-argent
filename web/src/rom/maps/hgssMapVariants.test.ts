import { describe, expect, it } from 'vitest'
import type { MapMatrixPreview, NitroMapPropPreview, OpeningMapPreview } from '../../ndsTypes'
import { createHgssSafariState, placeHgssSafariObject } from '../../game/safari/hgssSafariState'
import { createHgssMapVariantResolver } from './hgssMapVariants'

const staticProp: NitroMapPropPreview = {
  modelId: 211,
  position: [48, 0, 80],
  rotation: [0, 0, 0],
  scale: [1, 1, 1],
  mapMatrixCellIndex: 17,
}

function createSafariMatrix(): MapMatrixPreview {
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
    altitudes: new Uint8Array(20),
    modelIds: new Uint16Array([
      211, 211, 211, 211, 211,
      211, 0xffff, 0xffff, 0xffff, 211,
      211, 0xffff, 0xffff, 0xffff, 211,
      211, 211, 666, 211, 211,
    ]),
  }
}

function createMap(id: number, matrix: MapMatrixPreview): OpeningMapPreview {
  return {
    id,
    label: `map-${id}`,
    header: { mapId: id } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix,
  }
}

function buildDecodedVariant(map: OpeningMapPreview, matrix: MapMatrixPreview): OpeningMapPreview {
  return {
    ...map,
    matrix,
    model: {
      modelId: 666,
      vertexCount: 0,
      triangleCount: 0,
      quadCount: 0,
      materialCount: 0,
      pieceCount: 0,
      mapProps: [staticProp],
    },
    terrain: {
      modelId: 652,
      width: 96,
      height: 96,
      attributes: new Uint16Array(96 * 96).fill(7),
    },
  }
}

describe('résolveur global des variantes de carte HGSS', () => {
  it('compose map357 avant le build et fusionne les props/collisions Safari sans cache périmé', () => {
    const source = createMap(357, createSafariMatrix())
    const matricesBuilt: number[][] = []
    const resolver = createHgssMapVariantResolver((map, matrix) => {
      matricesBuilt.push([...matrix.modelIds])
      return buildDecodedVariant(map, matrix)
    })
    let safari = createHgssSafariState(0)
    safari = placeHgssSafariObject(safari, 0, 0, { objectId: 18, x: 2, y: 0, z: 2 })

    const first = resolver(source, {
      weekday: 1,
      rocketHideoutCleared: false,
      safariZone: safari,
      playerGender: 'female',
    })
    expect([6, 7, 8, 11, 12, 13].map((index) => matricesBuilt[0]![index])).toEqual([652, 659, 653, 657, 655, 658])
    expect(source.matrix.modelIds[6]).toBe(0xffff)
    expect(first.model?.mapProps).toEqual([
      staticProp,
      {
        modelId: 208,
        position: [2.5, 0, 2.5],
        rotation: [0, 0, 0],
        scale: [1, 1, 1],
        mapMatrixCellIndex: 6,
      },
    ])
    expect(first.terrain?.attributes[2 * 96 + 2]).toBe(0x8023)
    expect(source.terrain).toBeUndefined()

    const changedSafari = placeHgssSafariObject(safari, 0, 1, { objectId: 0, x: 1, y: 0, z: 1 })
    const second = resolver(source, {
      weekday: 1,
      rocketHideoutCleared: false,
      safariZone: changedSafari,
      playerGender: 'female',
    })
    expect(matricesBuilt).toHaveLength(2)
    expect(second).not.toBe(first)
    expect(first.model?.mapProps).toHaveLength(2)
    expect(second.model?.mapProps).toHaveLength(3)
    expect(second.terrain?.attributes[1 * 96 + 33]).toBe(0x8023)
  })

  it('ne construit pas map357 sans contexte Safari complet', () => {
    const source = createMap(357, createSafariMatrix())
    let builds = 0
    const resolver = createHgssMapVariantResolver((map, matrix) => {
      builds += 1
      return buildDecodedVariant(map, matrix)
    })
    const safari = createHgssSafariState(0)
    expect(resolver(source, { weekday: 1, rocketHideoutCleared: false })).toBe(source)
    expect(resolver(source, { weekday: 1, rocketHideoutCleared: false, safariZone: safari })).toBe(source)
    expect(builds).toBe(0)
  })

  it('préserve la variante hebdomadaire et son cache stable', () => {
    const matrix: MapMatrixPreview = {
      matrixIndex: 0,
      name: 'EVERYWHERE',
      width: 20,
      height: 3,
      headers: new Uint16Array(60),
      altitudes: new Uint8Array(60),
      modelIds: Uint16Array.from({ length: 60 }, (_, index) => index),
    }
    const lake = createMap(88, matrix)
    let builds = 0
    const resolver = createHgssMapVariantResolver((map, variantMatrix) => {
      builds += 1
      return { ...map, matrix: variantMatrix }
    })
    const first = resolver(lake, { weekday: 3, rocketHideoutCleared: true })
    const second = resolver(lake, { weekday: 3, rocketHideoutCleared: true })
    expect([...first.matrix.modelIds.slice(35, 38), ...first.matrix.modelIds.slice(55, 58)]).toEqual([95, 96, 97, 98, 99, 100])
    expect(second).toBe(first)
    expect(builds).toBe(1)
  })
})
