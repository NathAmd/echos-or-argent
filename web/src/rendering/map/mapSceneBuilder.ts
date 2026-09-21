import * as THREE from 'three'
import { hgssVBlanksToMilliseconds } from '../../game/time/hgssFrameTiming'
import type { NitroTextureAnimationPreview, OpeningMapPreview } from '../../ndsTypes'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import { createNitroDataTexture } from '../three/nitroTexture'
import { hgssNativeWaterSurfaceRenderOrder } from '../three/actorTerrainPresentationLayer'
import { applyCreasedSurfaceNormals } from '../three/creasedSurfaceNormals'
import { applyNitroMaterialTransparency, getNitroTextureAlphaMode, resolveNitroMaterialTransparency } from '../three/nitroMaterialTransparency'
import { resolveNitroSurfaceMaterialColor } from '../three/nitroSurfaceMaterialColor'
import type { SceneLayout } from './mapProjection'
import { hgssRemasteredWaterMaterial, isHgssNativeWaterTextureAnimation } from './hgssNativeFieldSurface'
import { getIndoorSurfaceDepthKey, splitIndoorSurfaceLayers } from './indoorSurfaceLayers'
import { isLegacyPropShadowSurface } from './legacyPropShadows'

const indoorSceneRenderOrderBase = 100_000

type SceneTransform = {
  offsetX: number
  offsetY: number
  offsetZ: number
  scale: number
}

export type SceneMeshPreview = {
  object: THREE.Object3D
  layout: SceneLayout | undefined
  usesTextures: boolean
  animate?: (now: number) => void
  dispose: () => void
}

export type SceneMeshBuildOptions = { indoorDepthLayers?: boolean, replaceLegacyPropShadows?: boolean, textureAnimationEpochMs?: number }

type AnimatedSceneTexture = {
  name: string
  frames: THREE.DataTexture[]
  durationsMs: number[]
  totalDurationMs: number
  nativeWater: boolean
}

type AnimatedSceneMaterial = {
  material: THREE.MeshLambertMaterial | THREE.MeshPhysicalMaterial
  materialAlpha: number
  animation: AnimatedSceneTexture
}

export function isReflectiveIceSurface(materialName?: string, textureName?: string): boolean {
  return [materialName, textureName].some((name) => /(?:^|_)ice(?:_|$)/i.test(name ?? ''))
}


function applySceneTransform(source: Float32Array, transform: SceneTransform): Float32Array {
  const positions = new Float32Array(source.length)
  for (let index = 0; index < source.length; index += 3) {
    positions[index] = (source[index] - transform.offsetX) * transform.scale
    positions[index + 1] = (source[index + 1] - transform.offsetY) * transform.scale
    positions[index + 2] = (source[index + 2] - transform.offsetZ) * transform.scale
  }
  return positions
}

function computeSceneLayout(positions: Float32Array): SceneLayout | undefined {
  if (positions.length === 0) return undefined
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.computeBoundingBox()
  const bounds = geometry.boundingBox
  if (!bounds) return undefined
  const positionAttribute = geometry.getAttribute('position')
  const heightAboveFloor = Math.max(bounds.max.y, 1)
  const floorThreshold = Math.max(0.4, heightAboveFloor * 0.05)
  let floorMinX = Infinity
  let floorMaxX = -Infinity
  let floorMinZ = Infinity
  let floorMaxZ = -Infinity
  for (let index = 0; index < positionAttribute.count; index += 1) {
    if (Math.abs(positionAttribute.getY(index)) > floorThreshold) continue
    const x = positionAttribute.getX(index)
    const z = positionAttribute.getZ(index)
    if (x < floorMinX) floorMinX = x
    if (x > floorMaxX) floorMaxX = x
    if (z < floorMinZ) floorMinZ = z
    if (z > floorMaxZ) floorMaxZ = z
  }
  if (!Number.isFinite(floorMinX) || !Number.isFinite(floorMaxX) || !Number.isFinite(floorMinZ) || !Number.isFinite(floorMaxZ)) {
    floorMinX = bounds.min.x
    floorMaxX = bounds.max.x
    floorMinZ = bounds.min.z
    floorMaxZ = bounds.max.z
  }
  return {
    floorMinX,
    floorMaxX,
    floorMinZ,
    floorMaxZ,
    cameraHeight: Math.max(9, heightAboveFloor * 0.7),
    cameraDistance: Math.max(18, (floorMaxZ - floorMinZ) * 1.15, (floorMaxX - floorMinX) * 0.8),
    focusX: (floorMinX + floorMaxX) / 2,
    focusZ: (floorMinZ + floorMaxZ) / 2,
  }
}

function prepareSceneGeometry(map: OpeningMapPreview): { positions: Float32Array, layout: SceneLayout | undefined, transform: SceneTransform } {
  const source = new Float32Array(map.model?.positions ?? [])
  const transform = { offsetX: 0, offsetY: 0, offsetZ: 0, scale: 1 }
  return { positions: source, layout: computeSceneLayout(source), transform }
}

function parseNumberedTextureName(textureName: string): { baseName: string, frameIndex: number } | undefined {
  const match = /^(.*)\.(\d+)$/.exec(textureName)
  if (!match) return undefined
  const frameNumber = Number.parseInt(match[2], 10)
  if (!Number.isInteger(frameNumber) || frameNumber <= 0) return undefined
  return { baseName: match[1], frameIndex: frameNumber - 1 }
}

function disposeSceneObject(object: THREE.Object3D, textures: Set<THREE.Texture>): void {
  const disposedMaterials = new Set<THREE.Material>()
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) if (!disposedMaterials.has(material)) {
      disposedMaterials.add(material)
      material.dispose()
    }
  })
  for (const texture of textures) texture.dispose()
}

export function buildSceneMesh(map: OpeningMapPreview, textureAnimationsByName?: Record<string, NitroTextureAnimationPreview>, options: SceneMeshBuildOptions = {}): SceneMeshPreview | undefined {
  if (!map.model?.positions) return undefined
  const normalized = prepareSceneGeometry(map)
  const usesSceneDepth = usesWorldMatrixCoordinates(map)
  const texturesToDispose = new Set<THREE.Texture>()
  if (map.model.surfaces?.length) {
    const textures = new Map((map.model.textures ?? []).map((texture) => {
      const dataTexture = createNitroDataTexture(texture, false)
      texturesToDispose.add(dataTexture)
      return [texture.id, { dataTexture, preview: texture }] as const
    }))
    const animatedTextures = new Map<string, AnimatedSceneTexture>()
    const animatedMaterials: AnimatedSceneMaterial[] = []
    const sceneMaterials = new Map<string, THREE.MeshLambertMaterial | THREE.MeshPhysicalMaterial>()
    const resolveAnimatedTexture = (textureName: string | undefined): AnimatedSceneTexture | undefined => {
      if (!textureName) return undefined
      const cached = animatedTextures.get(textureName)
      if (cached) return cached
      const numberedTexture = parseNumberedTextureName(textureName)
      const providedAnimation = textureAnimationsByName?.[textureName]
        ?? (numberedTexture ? textureAnimationsByName?.[numberedTexture.baseName] : undefined)
      if (!providedAnimation || providedAnimation.frames.length === 0) return undefined
      const shared = animatedTextures.get(providedAnimation.name)
      if (shared) {
        animatedTextures.set(textureName, shared)
        return shared
      }
      const frames = providedAnimation.frames.map((frame) => {
        const dataTexture = createNitroDataTexture(frame.texture, false)
        texturesToDispose.add(dataTexture)
        return dataTexture
      })
      const durationsMs = providedAnimation.frames.map((frame) => {
        const durationFrames = Math.max(1, frame.durationFrames)
        return hgssVBlanksToMilliseconds(durationFrames)
      })
      const animation = {
        name: providedAnimation.name,
        frames,
        durationsMs,
        totalDurationMs: durationsMs.reduce((sum, duration) => sum + duration, 0),
        nativeWater: isHgssNativeWaterTextureAnimation(providedAnimation),
      }
      animatedTextures.set(providedAnimation.name, animation)
      animatedTextures.set(textureName, animation)
      return animation
    }
    const group = new THREE.Group()
    let texturedSurfaceCount = 0
    for (const surface of map.model.surfaces) {
      if (surface.positions.length === 0) continue
      const replacedLegacyShadow = Boolean(options.replaceLegacyPropShadows && usesSceneDepth && isLegacyPropShadowSurface(surface))
      const hasUvs = Boolean(surface.uvs && surface.uvs.length === (surface.positions.length / 3) * 2)
      const transformedPositions = applySceneTransform(new Float32Array(surface.positions), normalized.transform)
      const textureEntry = hasUvs && surface.textureId ? textures.get(surface.textureId) : undefined
      const texture = textureEntry?.dataTexture
      const usesVertexColors = surface.colors?.length === surface.positions.length
      const hasNativeMaterialColor = Boolean(
        surface.materialColor
        || surface.materialDiffuseColor
        || surface.materialAmbientColor
        || surface.materialEmissionColor,
      )
      const opacity = surface.materialAlpha ?? 1
      const textureAnimation = resolveAnimatedTexture(textureEntry?.preview.name ?? surface.textureName)
      const materialTexture = textureAnimation?.frames[0]
        ?? texture
      const nativeWater = textureAnimation?.nativeWater ?? false
      // Les textures d'eau HGSS sont souvent des cutouts 0/255. Sans blend
      // forcé elles écrivent toute leur silhouette dans le Z-buffer avant le
      // billboard Surf et en découpent la monture basse.
      const transparency = resolveNitroMaterialTransparency(opacity, getNitroTextureAlphaMode(materialTexture), nativeWater)
      const usesBlending = transparency.transparent
      if (!materialTexture && !hasNativeMaterialColor && !usesVertexColors) continue
      const materialColor = new THREE.Color(...resolveNitroSurfaceMaterialColor(surface, undefined, usesVertexColors))
      const materialParameters = {
        alphaTest: transparency.alphaTest,
        color: materialColor,
        depthWrite: transparency.depthWrite,
        map: materialTexture ?? null,
        transparent: transparency.transparent,
        opacity: transparency.opacity,
        side: THREE.DoubleSide,
        vertexColors: usesVertexColors,
        fog: surface.fogEnabled ?? true,
      }
      const reflectiveIce = isReflectiveIceSurface(surface.materialName, textureEntry?.preview.name ?? surface.textureName)
      const materialKind = nativeWater ? 'water' : reflectiveIce ? 'ice' : 'lambert'
      const materialKey = [
        materialKind,
        textureAnimation?.name ?? materialTexture?.uuid ?? '',
        materialColor.getHexString(),
        usesVertexColors ? 1 : 0,
        surface.fogEnabled ?? true ? 1 : 0,
        transparency.alphaTest,
        transparency.depthWrite ? 1 : 0,
        transparency.opacity,
        transparency.transparent ? 1 : 0,
      ].join(':')
      const shareNativeWaterMaterial = nativeWater && options.indoorDepthLayers !== false
      let material = shareNativeWaterMaterial ? sceneMaterials.get(materialKey) : undefined
      if (!material) {
        material = reflectiveIce || nativeWater
          ? new THREE.MeshPhysicalMaterial({
              ...materialParameters,
              ...(nativeWater ? hgssRemasteredWaterMaterial : {
                clearcoat: 1,
                clearcoatRoughness: 0.08,
                ior: 1.31,
                metalness: 0.08,
                reflectivity: 0.95,
                roughness: 0.16,
                sheen: 0.22,
                sheenColor: new THREE.Color(0xbdefff),
              }),
            })
          : new THREE.MeshLambertMaterial(materialParameters)
        if (shareNativeWaterMaterial) sceneMaterials.set(materialKey, material)
        if (textureAnimation) animatedMaterials.push({ material, materialAlpha: opacity, animation: textureAnimation })
      }
      if (materialTexture) texturedSurfaceCount += 1
      const surfaceColors = surface.colors?.length === surface.positions.length ? surface.colors : undefined
      const layers = !usesSceneDepth && options.indoorDepthLayers !== false
        ? splitIndoorSurfaceLayers(transformedPositions, surfaceColors, hasUvs ? surface.uvs : undefined)
        : [{ positions: transformedPositions, colors: surfaceColors, uvs: hasUvs ? surface.uvs : undefined, depthKey: getIndoorSurfaceDepthKey(transformedPositions) }]
      for (const layer of layers) {
        const geometry = new THREE.BufferGeometry()
        geometry.setAttribute('position', new THREE.BufferAttribute(layer.positions, 3))
        // Les BufferAttribute sont mutés en place par les animations de
        // MapProps. Ils ne doivent jamais partager les tableaux du modèle ROM
        // mis en cache, sinon une pose devient la nouvelle base des suivantes.
        if (layer.colors) geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(layer.colors), 3))
        if (layer.uvs) geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(layer.uvs), 2))
        const mesh = new THREE.Mesh(applyCreasedSurfaceNormals(geometry), material)
        mesh.userData.reflectiveIce = reflectiveIce
        mesh.userData.nativeWater = nativeWater
        mesh.userData.replacedLegacyPropShadow = replacedLegacyShadow
        if (surface.mapMatrixCellIndex !== undefined) mesh.userData.mapMatrixCellIndex = surface.mapMatrixCellIndex
        mesh.visible = !replacedLegacyShadow
        mesh.castShadow = usesSceneDepth && !usesBlending && !replacedLegacyShadow
        mesh.receiveShadow = !replacedLegacyShadow
        if (!usesSceneDepth) mesh.renderOrder = indoorSceneRenderOrderBase + layer.depthKey
        else if (nativeWater) mesh.renderOrder = hgssNativeWaterSurfaceRenderOrder
        group.add(mesh)
      }
    }
    if (group.children.length > 0) {
      const animationEpochMs = options.textureAnimationEpochMs ?? performance.now()
      const animate = animatedMaterials.length === 0
        ? undefined
        : (now: number): void => {
          for (const entry of animatedMaterials) {
            if (entry.animation.frames.length === 0 || entry.animation.totalDurationMs <= 0) continue
            let elapsed = Math.max(0, now - animationEpochMs) % entry.animation.totalDurationMs
            let frameIndex = 0
            while (frameIndex < entry.animation.durationsMs.length - 1 && elapsed >= entry.animation.durationsMs[frameIndex]) {
              elapsed -= entry.animation.durationsMs[frameIndex]
              frameIndex += 1
            }
            const textureFrame = entry.animation.frames[frameIndex]
            if (entry.material.map === textureFrame) continue
            entry.material.map = textureFrame
            applyNitroMaterialTransparency(entry.material, entry.materialAlpha, textureFrame, entry.animation.nativeWater)
            entry.material.needsUpdate = true
          }
        }
      return {
        object: group,
        layout: normalized.layout,
        usesTextures: texturedSurfaceCount > 0,
        animate,
        dispose: () => disposeSceneObject(group, texturesToDispose),
      }
    }
    for (const texture of texturesToDispose) texture.dispose()
    texturesToDispose.clear()
  }
  if (!map.model.colors || map.model.colors.length !== map.model.positions.length) return undefined
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(normalized.positions, 3))
  geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(map.model.colors), 3))
  const mesh = new THREE.Mesh(applyCreasedSurfaceNormals(geometry), new THREE.MeshBasicMaterial({ color: 0xffffff, side: THREE.DoubleSide, vertexColors: true }))
  return {
    object: mesh,
    layout: normalized.layout,
    usesTextures: false,
    dispose: () => disposeSceneObject(mesh, texturesToDispose),
  }
}
