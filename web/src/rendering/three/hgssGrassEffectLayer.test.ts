import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import { hgssVBlankDurationMs } from '../../game/time/hgssFrameTiming'
import type { NitroModelPreview, NitroTexturePreview, OpeningMapPreview } from '../../ndsTypes'
import type { HgssGrassEffect } from '../../rom/overworld/grassEffects'
import { HgssGrassEffectLayer } from './hgssGrassEffectLayer'

function createTexture(id: string): NitroTexturePreview {
  return {
    id,
    name: id,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
  }
}

function createModel(texture: NitroTexturePreview): NitroModelPreview {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1])
  return {
    modelId: 0,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    positions,
    textures: [texture],
    surfaces: [{
      materialIndex: 0,
      textureId: texture.id,
      textureName: texture.name,
      positions,
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  }
}

const firstTexture = createTexture('grass-0')
const secondTexture = createTexture('grass-1')
const effect: HgssGrassEffect = {
  kind: 'tallGrass',
  model: createModel(firstTexture),
  textures: [firstTexture, secondTexture],
  timeline: {
    keyFrames: [0, 2],
    textureIndexes: [0, 1],
    paletteIndexes: [0, 0],
  },
}

function createMap(): OpeningMapPreview {
  return {
    id: 1,
    matrix: { hasHeaders: false, width: 1, height: 1 },
    terrain: {
      modelId: 0,
      width: 1,
      height: 1,
      attributes: new Uint16Array([2]),
    },
  } as OpeningMapPreview
}

describe("couche 3D d'effets d'herbe HGSS", () => {
  it('possede les meshes, leur visibilite et leur cadence VBlank', () => {
    const scene = new THREE.Scene()
    let clockSamples = 0
    const layer = new HgssGrassEffectLayer(scene, () => {
      clockSamples += 1
      return 100
    })
    const map = createMap()
    layer.setContext(map, {
      floorMinX: 0,
      floorMaxX: 1,
      floorMinZ: 0,
      floorMaxZ: 1,
      cameraHeight: 1,
      cameraDistance: 1,
      focusX: 0,
      focusZ: 0,
    }, () => effect)

    layer.setActor('player', 0, 0, { animate: false })
    expect(clockSamples).toBe(0)
    expect(layer.hasActor('player')).toBe(true)
    expect(layer.group.children).toHaveLength(2)
    expect(layer.group.children.findIndex((frame) => frame.visible)).toBe(1)

    layer.setActor('player', 0, 0, { animate: true })
    expect(clockSamples).toBe(1)
    expect(layer.group.children.findIndex((frame) => frame.visible)).toBe(0)
    layer.update(100 + hgssVBlankDurationMs * 2)
    expect(layer.group.children.findIndex((frame) => frame.visible)).toBe(1)

    layer.setActorVisible('player', false)
    expect(layer.group.children.every((frame) => !frame.visible)).toBe(true)
    layer.setActorVisible('player', true)
    expect(layer.group.children.findIndex((frame) => frame.visible)).toBe(1)

    map.terrain!.attributes[0] = 0
    layer.setActor('player', 0, 0, { animate: false })
    expect(layer.hasActor('player')).toBe(false)
    expect(layer.group.children).toHaveLength(0)

    layer.dispose()
    expect(scene.children).not.toContain(layer.group)
  })
})
