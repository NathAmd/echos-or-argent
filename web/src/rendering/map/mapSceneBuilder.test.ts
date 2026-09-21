import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import * as THREE from 'three'
import { hgssNativeWaterSurfaceRenderOrder } from '../three/actorTerrainPresentationLayer'
import { buildSceneMesh, isReflectiveIceSurface } from './mapSceneBuilder'

describe('map scene builder render order', () => {
  it('keeps decoded GX vertex colors independent from a black diffuse channel', () => {
    const colors = new Float32Array([
      0.5, 0.75, 1,
      0.5, 0.75, 1,
      0.5, 0.75, 1,
    ])
    const map = {
      id: 300,
      matrix: { matrixIndex: 300, name: '', width: 1, height: 1, headers: new Uint16Array([300]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 241, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        surfaces: [{
          materialIndex: 0,
          materialColor: [0, 0, 0] as const,
          materialAmbientColor: [1, 1, 1] as const,
          positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
          colors,
        }],
      },
    } as OpeningMapPreview

    const scene = buildSceneMesh(map, undefined, { indoorDepthLayers: false })
    const mesh = scene?.object.children[0] as THREE.Mesh
    const material = mesh.material as THREE.MeshLambertMaterial
    expect(material.vertexColors).toBe(true)
    expect(material.color.getHex()).toBe(0xffffff)
    expect([...((mesh.geometry.getAttribute('color') as THREE.BufferAttribute).array)]).toEqual([...colors])
    scene?.dispose()
  })

  it('keeps cached ROM vertex channels isolated from mutable Three attributes', () => {
    const colors = new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1])
    const uvs = new Float32Array([4.84375, 0, 5, 0, 4.84375, 1])
    const map = {
      id: 77,
      matrix: { matrixIndex: 77, name: '', width: 2, height: 1, headers: new Uint16Array([77, 77]), altitudes: new Uint8Array([0, 0]), modelIds: new Uint16Array([0, 0]) },
      model: {
        modelId: 119, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        surfaces: [{ materialIndex: 0, materialColor: [1, 1, 1] as const, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), colors, uvs }],
      },
    } as OpeningMapPreview
    const scene = buildSceneMesh(map)
    const geometry = (scene?.object.children[0] as THREE.Mesh).geometry
    const renderedUvs = geometry.getAttribute('uv') as THREE.BufferAttribute
    const renderedColors = geometry.getAttribute('color') as THREE.BufferAttribute
    renderedUvs.setX(0, 26.53125)
    renderedColors.setXYZ(0, 0, 0, 0)
    expect([...uvs]).toEqual([4.84375, 0, 5, 0, 4.84375, 1])
    expect([...colors]).toEqual([1, 0, 0, 0, 1, 0, 0, 0, 1])
    scene?.dispose()
  })

  it('holds each ROM field-texture pose for its native VBlank duration', () => {
    const texture = (id: string, red: number) => ({
      id,
      name: 'water',
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([red, 0, 0, 255]),
    })
    const map = {
      id: 61,
      matrix: { matrixIndex: 61, name: '', width: 1, height: 1, headers: new Uint16Array([61]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        textures: [texture('base', 1)],
        surfaces: [{ materialIndex: 0, textureId: 'base', textureName: 'water', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) }],
      },
    } as OpeningMapPreview
    const scene = buildSceneMesh(map, {
      water: { name: 'water', sourceMemberIndex: 1, frames: [{ texture: texture('first', 10), durationFrames: 1 }, { texture: texture('second', 20), durationFrames: 1 }] },
    }, { textureAnimationEpochMs: 100 })
    const material = (scene?.object.children[0] as THREE.Mesh).material as THREE.MeshLambertMaterial
    const red = () => ((material.map as THREE.DataTexture).image.data as Uint8Array)[0]
    scene?.animate?.(100 + 1000 / 60 - .01)
    expect(red()).toBe(10)
    scene?.animate?.(100 + 1000 / 60)
    expect(red()).toBe(20)
    scene?.dispose()
  })

  it('replaces native water tiles frame by frame like lava animations', () => {
    const texture = (id: string, red: number) => ({
      id, name: id, width: 1, height: 1,
      pixels: new Uint8ClampedArray([red, 0, 0, 255]),
    })
    const map = {
      id: 61,
      matrix: { matrixIndex: 61, name: '', width: 1, height: 1, headers: new Uint16Array([61]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]),
        textures: [texture('sea_on', 0)],
        surfaces: [{ materialIndex: 0, textureId: 'sea_on', textureName: 'sea_on', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) }],
      },
    } as OpeningMapPreview
    const scene = buildSceneMesh(map, {
      sea_on: { name: 'sea_on', sourceMemberIndex: 1, frames: [{ texture: texture('sea_on.1', 0), durationFrames: 2 }, { texture: texture('sea_on.2', 100), durationFrames: 2 }] },
    }, { textureAnimationEpochMs: 0 })
    const material = (scene?.object.children[0] as THREE.Mesh).material as THREE.MeshPhysicalMaterial
    const firstTexture = material.map
    scene?.animate?.(1000 / 60)
    expect(material.map).toBe(firstTexture)
    expect(((material.map as THREE.DataTexture).image.data as Uint8ClampedArray)[0]).toBe(0)
    scene?.animate?.(2 * 1000 / 60)
    expect(material.map).not.toBe(firstTexture)
    expect(((material.map as THREE.DataTexture).image.data as Uint8ClampedArray)[0]).toBe(100)
    scene?.dispose()
  })

  it('remasters only water proven by a decoded fldtanime ROM entry', () => {
    const texture = (id: string) => ({
      id,
      name: id,
      width: 1,
      height: 1,
      pixels: new Uint8ClampedArray([48, 112, 176, 255]),
    })
    const map = {
      id: 61,
      matrix: { matrixIndex: 61, name: '', width: 2, height: 1, headers: new Uint16Array([60, 61]), altitudes: new Uint8Array(2), modelIds: new Uint16Array(2) },
      model: {
        modelId: 0, vertexCount: 6, triangleCount: 2, quadCount: 0, materialCount: 2, pieceCount: 2,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 2, 0, 0, 1, 0, 1]),
        textures: [texture('sea_on'), texture('water_custom')],
        surfaces: [
          { materialIndex: 0, textureId: 'sea_on', textureName: 'sea_on', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) },
          { materialIndex: 1, textureId: 'water_custom', textureName: 'water_custom', positions: new Float32Array([1, 0, 0, 2, 0, 0, 1, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) },
        ],
      },
    } as OpeningMapPreview
    const scene = buildSceneMesh(map, {
      sea_on: { name: 'sea_on', sourceMemberIndex: 1, frames: [{ texture: texture('sea_on.1'), durationFrames: 18 }] },
      water_custom: { name: 'water_custom', sourceMemberIndex: 99, frames: [{ texture: texture('water_custom.1'), durationFrames: 18 }] },
    })
    const meshes = scene?.object.children as THREE.Mesh[]
    expect(meshes[0]?.userData.nativeWater).toBe(true)
    expect(meshes[0]?.material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect((meshes[0]?.material as THREE.MeshPhysicalMaterial).clearcoat).toBeCloseTo(0.72)
    expect((meshes[0]?.material as THREE.MeshPhysicalMaterial).transparent).toBe(true)
    expect((meshes[0]?.material as THREE.MeshPhysicalMaterial).depthWrite).toBe(false)
    expect(meshes[0]?.renderOrder).toBe(hgssNativeWaterSurfaceRenderOrder)
    expect(meshes[1]?.userData.nativeWater).toBe(false)
    expect(meshes[1]?.material).toBeInstanceOf(THREE.MeshLambertMaterial)
    scene?.dispose()
  })

  it('shares one synchronized physical material across identical native water surfaces', () => {
    const texture = {
      id: 'sea_on', name: 'sea_on', width: 1, height: 1,
      pixels: new Uint8ClampedArray([48, 112, 176, 255]),
    }
    const map = {
      id: 61,
      matrix: { matrixIndex: 61, name: '', width: 1, height: 1, headers: new Uint16Array([61]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 6, triangleCount: 2, quadCount: 0, materialCount: 1, pieceCount: 2,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 2, 0, 0, 1, 0, 1]),
        textures: [texture],
        surfaces: [
          { materialIndex: 0, textureId: 'sea_on', textureName: 'sea_on', positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) },
          { materialIndex: 0, textureId: 'sea_on', textureName: 'sea_on', positions: new Float32Array([1, 0, 0, 2, 0, 0, 1, 0, 1]), uvs: new Float32Array([0, 0, 1, 0, 0, 1]) },
        ],
      },
    } as OpeningMapPreview
    const scene = buildSceneMesh(map, {
      sea_on: { name: 'sea_on', sourceMemberIndex: 1, frames: [{ texture, durationFrames: 18 }] },
    })
    const meshes = scene?.object.children as THREE.Mesh[]
    expect(meshes).toHaveLength(2)
    expect(meshes[0]?.material).toBe(meshes[1]?.material)
    scene?.dispose()

    const propScene = buildSceneMesh(map, {
      sea_on: { name: 'sea_on', sourceMemberIndex: 1, frames: [{ texture, durationFrames: 18 }] },
    }, { indoorDepthLayers: false })
    const propMeshes = propScene?.object.children as THREE.Mesh[]
    expect(propMeshes[0]?.material).not.toBe(propMeshes[1]?.material)
    propScene?.dispose()
  })

  it('gives ROM ice surfaces a shared mirror-like physical material', () => {
    expect(isReflectiveIceSurface('ice_fe01', undefined)).toBe(true)
    expect(isReflectiveIceSurface('office_wall', undefined)).toBe(false)
    const map = {
      id: 237,
      matrix: { matrixIndex: 237, name: '', width: 1, height: 1, headers: new Uint16Array([237]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 3, triangleCount: 1, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 16, 0, 0, 0, 0, 16]),
        surfaces: [{ materialIndex: 0, materialName: 'ice_fe01', materialColor: [1, 1, 1] as const, positions: new Float32Array([0, 0, 0, 16, 0, 0, 0, 0, 16]) }],
      },
    } as OpeningMapPreview
    const mesh = buildSceneMesh(map)?.object.children[0] as THREE.Mesh
    expect(mesh.userData.reflectiveIce).toBe(true)
    expect(mesh.material).toBeInstanceOf(THREE.MeshPhysicalMaterial)
    expect((mesh.material as THREE.MeshPhysicalMaterial).clearcoat).toBe(1)
  })

  it('applies the Nitro PolygonAttr fog flag independently to every material', () => {
    const map = {
      id: 123,
      matrix: { matrixIndex: 123, name: '', width: 1, height: 1, headers: new Uint16Array([123]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 6, triangleCount: 2, quadCount: 0, materialCount: 2, pieceCount: 2,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
        surfaces: [
          { materialIndex: 0, materialColor: [1, 1, 1] as const, fogEnabled: true, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) },
          { materialIndex: 1, materialColor: [1, 1, 1] as const, fogEnabled: false, positions: new Float32Array([1, 0, 0, 1, 0, 1, 0, 0, 1]) },
        ],
      },
    } as OpeningMapPreview

    const scene = buildSceneMesh(map)
    const materials = scene?.object.children.map((child) => (child as THREE.Mesh).material as THREE.MeshLambertMaterial)
    expect(materials?.map(({ fog }) => fog)).toEqual([true, false])
    scene?.dispose()
  })

  it('assigns indoor surface render order by south-most row so later rows can overlay sprites globally', () => {
    const map = {
      id: 63,
      matrix: {
        matrixIndex: 63,
        name: 'room-matrix',
        width: 1,
        height: 1,
        headers: new Uint16Array([63]),
        altitudes: new Uint8Array([0]),
        modelIds: new Uint16Array([0]),
      },
      model: {
        modelId: 0,
        vertexCount: 12,
        triangleCount: 4,
        quadCount: 0,
        materialCount: 2,
        pieceCount: 2,
        positions: new Float32Array([
          0, 0, 4,
          1, 0, 4,
          0, 0, 5,
          1, 0, 4,
          1, 0, 5,
          0, 0, 5,
          0, 0, 6,
          1, 0, 6,
          0, 0, 7,
          1, 0, 6,
          1, 0, 7,
          0, 0, 7,
        ]),
        surfaces: [{
          materialIndex: 0,
          materialColor: [1, 1, 1] as const,
          positions: new Float32Array([
            0, 0, 4,
            1, 0, 4,
            0, 0, 5,
            1, 0, 4,
            1, 0, 5,
            0, 0, 5,
          ]),
        }, {
          materialIndex: 1,
          materialColor: [1, 1, 1] as const,
          positions: new Float32Array([
            0, 0, 6,
            1, 0, 6,
            0, 0, 7,
            1, 0, 6,
            1, 0, 7,
            0, 0, 7,
          ]),
        }],
      },
    } as OpeningMapPreview

    const scene = buildSceneMesh(map)
    expect(scene?.object.children.map((child) => child.renderOrder)).toEqual([100500, 100700])
  })

  it('does not let one material spanning multiple rows collapse them into one world layer', () => {
    const map = {
      id: 63,
      matrix: { matrixIndex: 63, name: '', width: 1, height: 1, headers: new Uint16Array([63]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
      model: {
        modelId: 0, vertexCount: 6, triangleCount: 2, quadCount: 0, materialCount: 1, pieceCount: 1,
        positions: new Float32Array([0, 0, 2, 1, 0, 2, 0, 0, 3, 0, 0, 8, 1, 0, 8, 0, 0, 9]),
        surfaces: [{ materialIndex: 0, materialColor: [1, 1, 1] as const, positions: new Float32Array([0, 0, 2, 1, 0, 2, 0, 0, 3, 0, 0, 8, 1, 0, 8, 0, 0, 9]) }],
      },
    } as OpeningMapPreview
    expect(buildSceneMesh(map)?.object.children.map((child) => child.renderOrder)).toEqual([100300, 100900])
  })

  it('leaves exterior surface render order at default so 3D depth still controls outdoor occlusion', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 61,
        name: 'field-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
      model: {
        modelId: 0,
        vertexCount: 6,
        triangleCount: 2,
        quadCount: 0,
        materialCount: 1,
        pieceCount: 1,
        positions: new Float32Array([
          0, 0, 0,
          1, 0, 0,
          0, 0, 1,
          1, 0, 0,
          1, 0, 1,
          0, 0, 1,
        ]),
        surfaces: [{
          materialIndex: 0,
          mapMatrixCellIndex: 1,
          materialColor: [1, 1, 1] as const,
          positions: new Float32Array([
            0, 0, 0,
            1, 0, 0,
            0, 0, 1,
            1, 0, 0,
            1, 0, 1,
            0, 0, 1,
          ]),
        }],
      },
    } as OpeningMapPreview

    const scene = buildSceneMesh(map)
    expect(scene?.object.children[0]?.renderOrder).toBe(0)
    expect(scene?.object.children[0]?.userData.mapMatrixCellIndex).toBe(1)
  })

  it('replaces baked prop shadows only when the remastered exterior shadow map is active', () => {
    const createMap = (exterior: boolean) => ({
      id: 61,
      matrix: {
        matrixIndex: 61, name: '', width: exterior ? 2 : 1, height: 1,
        headers: new Uint16Array(exterior ? [60, 61] : [61]), altitudes: new Uint8Array(exterior ? [0, 0] : [0]),
        modelIds: new Uint16Array(exterior ? [0, 0] : [0]),
      },
      model: {
        modelId: 0, vertexCount: 6, triangleCount: 2, quadCount: 0, materialCount: 2, pieceCount: 2,
        positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 0, 1, 0, 1, 0, 0, 1]),
        surfaces: [
          { materialIndex: 0, materialName: 'tree', materialColor: [1, 1, 1] as const, positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 0, 1]) },
          { materialIndex: 1, textureName: 'h_kage', materialColor: [0, 0, 0] as const, positions: new Float32Array([1, 0, 0, 1, 0, 1, 0, 0, 1]) },
        ],
      },
    } as OpeningMapPreview)

    const exteriorMeshes = buildSceneMesh(createMap(true), undefined, { replaceLegacyPropShadows: true })?.object.children as THREE.Mesh[]
    expect(exteriorMeshes.map(({ visible }) => visible)).toEqual([true, false])
    expect(exteriorMeshes[0]?.castShadow).toBe(true)
    expect(exteriorMeshes[1]?.userData.replacedLegacyPropShadow).toBe(true)
    const indoorMeshes = buildSceneMesh(createMap(false), undefined, { replaceLegacyPropShadows: true })?.object.children as THREE.Mesh[]
    expect(indoorMeshes.every(({ visible }) => visible)).toBe(true)
  })

  it('does not invent a rotation from a material name', () => {
    const map = {
      id: 61,
      matrix: {
        matrixIndex: 61,
        name: 'field-matrix',
        width: 2,
        height: 1,
        headers: new Uint16Array([60, 61]),
        altitudes: new Uint8Array([0, 0]),
        modelIds: new Uint16Array([0, 0]),
      },
      model: {
        modelId: 0,
        vertexCount: 3,
        triangleCount: 1,
        quadCount: 0,
        materialCount: 1,
        pieceCount: 1,
        positions: new Float32Array([0, 0, 0, 2, 0, 0, 1, 0, 2]),
        surfaces: [{
          materialIndex: 0,
          materialName: 'wind_1',
          materialColor: [1, 1, 1] as const,
          positions: new Float32Array([0, 0, 0, 2, 0, 0, 1, 0, 2]),
        }],
      },
    } as OpeningMapPreview

    const scene = buildSceneMesh(map)
    expect(scene?.animate).toBeUndefined()
    expect(scene?.object.children[0]?.rotation.y).toBe(0)
  })
})
