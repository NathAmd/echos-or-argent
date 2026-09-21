import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { NitroModelPreview, NitroTexturePreview } from '../../ndsTypes'
import { createNitroDataTexture } from './nitroTexture'
import { applyNitroMapPropFrame, createNitroMapPropRuntime, disposeNitroMapPropFrameTextures } from './nitroMapPropRuntime'

function texture(id: string, alpha: number = 255): NitroTexturePreview {
  return { id, name: id, width: 1, height: 1, pixels: new Uint8ClampedArray([255, 255, 255, alpha]) }
}

function model(baseTexture: NitroTexturePreview): NitroModelPreview {
  return {
    modelId: 1,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    textures: [baseTexture],
    surfaces: [{
      materialIndex: 0,
      textureId: baseTexture.id,
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  }
}

function runtimeFixture(nativeWater = false) {
  const basePreview = texture('base', 0)
  const baseModel = model(basePreview)
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(baseModel.surfaces![0]!.positions.slice(), 3))
  geometry.setAttribute('uv', new THREE.BufferAttribute(baseModel.surfaces![0]!.uvs!.slice(), 2))
  const baseTexture = createNitroDataTexture(basePreview)
  const material = new THREE.MeshLambertMaterial({ color: 0xffffff, map: baseTexture })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.userData.nativeWater = nativeWater
  const object = new THREE.Group()
  object.add(mesh)
  const runtime = createNitroMapPropRuntime(object, baseModel)
  const dispose = (): void => {
    disposeNitroMapPropFrameTextures(runtime)
    geometry.dispose()
    material.dispose()
    baseTexture.dispose()
  }
  return { baseModel, material, runtime, dispose }
}

describe('Nitro MapProp runtime state isolation', () => {
  it('does not reapply a black diffuse multiplier to animated GX vertex colors', () => {
    const fixture = runtimeFixture()
    const colors = new Float32Array([
      0.25, 0.5, 0.75,
      0.25, 0.5, 0.75,
      0.25, 0.5, 0.75,
    ])
    fixture.runtime.meshes[0]!.geometry.setAttribute('color', new THREE.BufferAttribute(colors.slice(), 3))
    fixture.material.vertexColors = true
    const coloredFrame = {
      ...fixture.baseModel,
      surfaces: fixture.baseModel.surfaces!.map((surface) => ({
        ...surface,
        materialColor: [0, 0, 0] as const,
        materialAmbientColor: [1, 1, 1] as const,
        colors,
      })),
    }

    applyNitroMapPropFrame(fixture.runtime, coloredFrame)

    expect(fixture.material.color.getHex()).toBe(0xffffff)
    expect([
      ...(fixture.runtime.meshes[0]!.geometry.getAttribute('color') as THREE.BufferAttribute).array,
    ]).toEqual([...colors])
    fixture.dispose()
  })

  it('restores the implicit white base color after a material animation', () => {
    const fixture = runtimeFixture()
    const colored = {
      ...fixture.baseModel,
      surfaces: fixture.baseModel.surfaces!.map((surface) => ({ ...surface, materialColor: [1, 0, 0] as const })),
    }

    applyNitroMapPropFrame(fixture.runtime, colored)
    expect(fixture.material.color.getHex()).toBe(0xff0000)
    applyNitroMapPropFrame(fixture.runtime, fixture.baseModel)
    expect(fixture.material.color.getHex()).toBe(0xffffff)
    fixture.dispose()
  })

  it('reasserts a held pattern texture after another animator touches the material', () => {
    const fixture = runtimeFixture()
    const replacement = texture('pattern')
    const patterned = {
      ...fixture.baseModel,
      textures: [...fixture.baseModel.textures!, replacement],
      surfaces: fixture.baseModel.surfaces!.map((surface) => ({ ...surface, textureId: replacement.id })),
    }

    applyNitroMapPropFrame(fixture.runtime, patterned)
    const expected = fixture.material.map
    fixture.material.map = fixture.runtime.baseTextures[0]!
    applyNitroMapPropFrame(fixture.runtime, patterned)
    expect(fixture.material.map).toBe(expected)
    fixture.dispose()
  })

  it('preserves forced water blending while applying model frames', () => {
    const fixture = runtimeFixture(true)
    applyNitroMapPropFrame(fixture.runtime, fixture.baseModel)
    expect(fixture.material.transparent).toBe(true)
    expect(fixture.material.depthWrite).toBe(false)
    fixture.dispose()
  })
})
