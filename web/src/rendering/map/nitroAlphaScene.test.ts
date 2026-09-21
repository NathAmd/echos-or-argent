import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { NitroModelPreview, NitroTextureAnimationPreview, NitroTexturePreview, OpeningMapPreview } from '../../ndsTypes'
import { applyNitroMapPropFrame, createNitroMapPropRuntime } from '../three/nitroMapPropRuntime'
import { buildSceneMesh } from './mapSceneBuilder'

function createTexture(id: string, alpha: readonly number[]): NitroTexturePreview {
  const pixels = new Uint8ClampedArray(alpha.length * 4)
  alpha.forEach((value, index) => pixels.set([255, 255, 255, value], index * 4))
  return { id, name: id, width: alpha.length, height: 1, pixels }
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
      materialAlpha: 1,
      textureId: texture.id,
      textureName: texture.name,
      positions,
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  }
}

function createMap(model: NitroModelPreview): OpeningMapPreview {
  return {
    id: 1,
    matrix: {
      matrixIndex: 1,
      name: '',
      width: 1,
      height: 1,
      headers: new Uint16Array([1]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    model,
  } as OpeningMapPreview
}

function firstMaterial(scene: NonNullable<ReturnType<typeof buildSceneMesh>>): THREE.MeshLambertMaterial {
  return (scene.object.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial
}

describe('Nitro alpha scene integration', () => {
  it('preserves binary cutouts while enabling blending for partial ROM alpha', () => {
    const cutoutScene = buildSceneMesh(createMap(createModel(createTexture('cutout', [0, 255]))), undefined, { indoorDepthLayers: false })
    const blendScene = buildSceneMesh(createMap(createModel(createTexture('blend', [0, 96]))), undefined, { indoorDepthLayers: false })
    if (!cutoutScene || !blendScene) throw new Error('Expected both Nitro scenes')

    expect(firstMaterial(cutoutScene)).toMatchObject({ transparent: false, depthWrite: true })
    expect(firstMaterial(cutoutScene).alphaTest).toBeGreaterThan(0)
    expect(firstMaterial(blendScene)).toMatchObject({ transparent: true, depthWrite: false })

    cutoutScene.dispose()
    blendScene.dispose()
  })

  it('updates blending and depth when a field texture animation changes alpha mode', () => {
    const base = createTexture('mist', [255, 255])
    const opaqueFrame = createTexture('mist-opaque', [255, 255])
    const blendFrame = createTexture('mist-blend', [0, 96])
    const animation: NitroTextureAnimationPreview = {
      name: 'mist',
      sourceMemberIndex: 0,
      frames: [
        { texture: opaqueFrame, durationFrames: 1 },
        { texture: blendFrame, durationFrames: 1 },
      ],
    }
    const scene = buildSceneMesh(createMap(createModel(base)), { mist: animation }, { indoorDepthLayers: false, textureAnimationEpochMs: 100 })
    if (!scene) throw new Error('Expected animated Nitro scene')
    const material = firstMaterial(scene)

    expect(material.transparent).toBe(false)
    scene.animate?.(118)
    expect(material.map?.userData.nitroTextureAlphaMode).toBe('blend')
    expect(material).toMatchObject({ transparent: true, depthWrite: false })
    scene.dispose()
  })

  it('updates a map prop material when a ROM pattern frame swaps its texture', () => {
    const opaque = createTexture('opaque', [255, 255])
    const blend = createTexture('blend', [0, 64])
    const baseModel = createModel(opaque)
    const scene = buildSceneMesh(createMap(baseModel), undefined, { indoorDepthLayers: false })
    if (!scene) throw new Error('Expected map prop scene')
    const runtime = createNitroMapPropRuntime(scene.object, baseModel)
    const frame = createModel(blend)

    applyNitroMapPropFrame(runtime, frame)
    expect(firstMaterial(scene).map?.userData.nitroTextureAlphaMode).toBe('blend')
    expect(firstMaterial(scene)).toMatchObject({ transparent: true, depthWrite: false })
    scene.dispose()
  })

  it('does not let an unchanged model channel reset an active field texture frame', () => {
    const base = createTexture('mist', [255, 255])
    const first = createTexture('mist-first', [255, 255])
    const second = createTexture('mist-second', [0, 64])
    const baseModel = createModel(base)
    const scene = buildSceneMesh(createMap(baseModel), {
      mist: {
        name: 'mist',
        sourceMemberIndex: 0,
        frames: [{ texture: first, durationFrames: 1 }, { texture: second, durationFrames: 1 }],
      },
    }, { indoorDepthLayers: false, textureAnimationEpochMs: 100 })
    if (!scene) throw new Error('Expected animated map prop scene')
    const runtime = createNitroMapPropRuntime(scene.object, baseModel)

    scene.animate?.(100 + 1000 / 60)
    const animatedTexture = firstMaterial(scene).map
    applyNitroMapPropFrame(runtime, baseModel)

    expect(firstMaterial(scene).map).toBe(animatedTexture)
    expect(firstMaterial(scene).map?.userData.nitroTextureAlphaMode).toBe('blend')
    scene.dispose()
  })
})
