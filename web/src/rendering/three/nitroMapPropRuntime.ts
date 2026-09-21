import * as THREE from 'three'
import type { NitroModelPreview, NitroSurfacePreview, NitroTexturePreview } from '../../ndsTypes'
import { applyCreasedSurfaceNormals } from './creasedSurfaceNormals'
import { applyNitroMaterialTransparency } from './nitroMaterialTransparency'
import { createNitroDataTexture } from './nitroTexture'
import { resolveNitroSurfaceMaterialColor } from './nitroSurfaceMaterialColor'

export type NitroMapPropRuntime = {
  object: THREE.Object3D
  meshes: THREE.Mesh[]
  baseModel: NitroModelPreview
  baseTextureIds: Array<string | undefined>
  baseTextures: Array<THREE.Texture | null>
  textureIds: Array<string | undefined>
  frameTextures: Map<string, THREE.DataTexture>
}

export function createNitroMapPropRuntime(object: THREE.Object3D, baseModel: NitroModelPreview): NitroMapPropRuntime {
  const meshes: THREE.Mesh[] = []
  object.traverse((child) => { if (child instanceof THREE.Mesh) meshes.push(child) })
  const baseTextureIds = baseModel.surfaces?.map(({ textureId }) => textureId) ?? []
  const baseTextures = meshes.map((mesh) => {
    const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material
    return material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshPhysicalMaterial ? material.map : null
  })
  return { object, meshes, baseModel, baseTextureIds, baseTextures, textureIds: [...baseTextureIds], frameTextures: new Map() }
}

export function disposeNitroMapPropFrameTextures(entry: NitroMapPropRuntime): void {
  for (const texture of entry.frameTextures.values()) texture.dispose()
  entry.frameTextures.clear()
}

function arrayDiffers(attribute: THREE.BufferAttribute, values: Float32Array): boolean {
  for (let index = 0; index < values.length; index += 1) if (attribute.array[index] !== values[index]) return true
  return false
}

function applySurfaceTexture(
  entry: NitroMapPropRuntime,
  index: number,
  surface: NitroSurfacePreview,
  textures: ReadonlyMap<string, NitroTexturePreview>,
): void {
  const mesh = entry.meshes[index]
  const textureId = surface.textureId ?? entry.baseTextureIds[index]
  if (!textureId || !mesh) return
  const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
  const materialMaps = materials.flatMap((material) => (
    material instanceof THREE.MeshLambertMaterial || material instanceof THREE.MeshPhysicalMaterial
      ? [material.map]
      : []
  ))
  // Une texture de terrain animee peut continuer a piloter la texture de base.
  // En revanche, une pose BTP explicite doit etre reappliquee si un autre
  // animateur a modifie le materiau depuis la frame precedente.
  if (entry.textureIds[index] === textureId && textureId === entry.baseTextureIds[index]) return
  let texture: THREE.Texture | null | undefined
  if (textureId === entry.baseTextureIds[index]) texture = entry.baseTextures[index]
  else {
    const preview = textures.get(textureId)
    if (!preview) return
    texture = entry.frameTextures.get(textureId)
    if (!texture) {
      const frameTexture = createNitroDataTexture(preview, false)
      entry.frameTextures.set(textureId, frameTexture)
      texture = frameTexture
    }
  }
  if (entry.textureIds[index] === textureId && materialMaps.every((map) => map === texture)) return
  entry.textureIds[index] = textureId
  for (const material of materials) {
    if (!(material instanceof THREE.MeshLambertMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue
    material.map = texture
    material.needsUpdate = true
  }
}

export function applyNitroMapPropFrame(entry: NitroMapPropRuntime, frame: NitroModelPreview): void {
  const surfaces = frame.surfaces ?? []
  const baseSurfaces = entry.baseModel.surfaces ?? []
  const textures = new Map((frame.textures ?? []).map((texture) => [texture.id, texture]))
  for (let index = 0; index < Math.min(entry.meshes.length, surfaces.length); index += 1) {
    const mesh = entry.meshes[index]!, surface = surfaces[index]!
    const baseSurface = baseSurfaces[index]
    const position = mesh.geometry.getAttribute('position')
    if (position instanceof THREE.BufferAttribute && position.count * 3 === surface.positions.length && arrayDiffers(position, surface.positions)) {
      position.array.set(surface.positions); position.needsUpdate = true; applyCreasedSurfaceNormals(mesh.geometry)
    }
    const uv = mesh.geometry.getAttribute('uv')
    if (surface.uvs && uv instanceof THREE.BufferAttribute && uv.count * 2 === surface.uvs.length && arrayDiffers(uv, surface.uvs)) {
      uv.array.set(surface.uvs); uv.needsUpdate = true
    }
    const colorAttribute = mesh.geometry.getAttribute('color')
    if (surface.colors && colorAttribute instanceof THREE.BufferAttribute && colorAttribute.count * 3 === surface.colors.length && arrayDiffers(colorAttribute, surface.colors)) {
      colorAttribute.array.set(surface.colors); colorAttribute.needsUpdate = true
    }
    applySurfaceTexture(entry, index, surface, textures)
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshLambertMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue
      const color = resolveNitroSurfaceMaterialColor(surface, baseSurface, colorAttribute instanceof THREE.BufferAttribute)
      if (material.color.r !== color[0] || material.color.g !== color[1] || material.color.b !== color[2]) material.color.setRGB(...color)
      applyNitroMaterialTransparency(material, surface.materialAlpha ?? baseSurface?.materialAlpha ?? 1, undefined, mesh.userData.nativeWater === true)
    }
  }
}

export function captureNitroMapPropPositions(entry: NitroMapPropRuntime): Float32Array[] {
  return entry.meshes.map((mesh) => {
    const attribute = mesh.geometry.getAttribute('position')
    return attribute instanceof THREE.BufferAttribute ? new Float32Array(attribute.array as ArrayLike<number>) : new Float32Array()
  })
}

export function applyNitroMapPropTransition(entry: NitroMapPropRuntime, starts: Float32Array[] | undefined, target: NitroModelPreview, progress: number): void {
  const eased = progress * progress * (3 - 2 * progress), surfaces = target.surfaces ?? []
  for (let index = 0; index < Math.min(entry.meshes.length, surfaces.length); index += 1) {
    const mesh = entry.meshes[index]!, attribute = mesh.geometry.getAttribute('position')
    const start = starts?.[index], destination = surfaces[index]!.positions
    if (!(attribute instanceof THREE.BufferAttribute) || !start || start.length !== destination.length || attribute.count * 3 !== destination.length) continue
    for (let component = 0; component < destination.length; component += 1) attribute.array[component] = start[component]! + (destination[component]! - start[component]!) * eased
    attribute.needsUpdate = true; applyCreasedSurfaceNormals(mesh.geometry)
  }
  if (progress < 0.5) return
  const textures = new Map((target.textures ?? []).map((texture) => [texture.id, texture]))
  const baseSurfaces = entry.baseModel.surfaces ?? []
  for (let index = 0; index < Math.min(entry.meshes.length, surfaces.length); index += 1) {
    const surface = surfaces[index]!
    applySurfaceTexture(entry, index, surface, textures)
    const mesh = entry.meshes[index]
    if (!mesh) continue
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshLambertMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue
      const color = resolveNitroSurfaceMaterialColor(
        surface,
        baseSurfaces[index],
        mesh.geometry.getAttribute('color') instanceof THREE.BufferAttribute,
      )
      material.color.setRGB(...color)
      applyNitroMaterialTransparency(material, surface.materialAlpha ?? baseSurfaces[index]?.materialAlpha ?? 1, undefined, mesh.userData.nativeWater === true)
    }
  }
}
