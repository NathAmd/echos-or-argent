import * as THREE from 'three'
import type { NitroModelPreview } from '../../ndsTypes'
import { getNitroTextureAlphaMode, resolveNitroMaterialTransparency } from '../three/nitroMaterialTransparency'
import { createNitroDataTexture } from '../three/nitroTexture'

type TitleAnimatedPart = 'wing' | 'tail'

export type TitleAnimatedMesh = {
  mesh: THREE.Mesh
  part: TitleAnimatedPart
  baseRotation: THREE.Euler
}

export type TitleAtmosphereMesh = {
  mesh: THREE.Mesh
  basePosition: THREE.Vector3
  texture?: THREE.Texture
}

export type TitleMorphSurface = {
  surfaceIndex: number
  positionAttribute: THREE.BufferAttribute
}

function classifyTitlePart(materialName: string | undefined, textureName: string | undefined): TitleAnimatedPart | undefined {
  const key = `${materialName ?? ''} ${textureName ?? ''}`.toLowerCase()
  if (key.includes('wing') || key.includes('hane')) return 'wing'
  if (key.includes('tail')) return 'tail'
  return undefined
}

export function addTitleModelToGroup(
  group: THREE.Group,
  model: NitroModelPreview,
  texturesToDispose: THREE.DataTexture[],
  animatedMeshes: TitleAnimatedMesh[],
  atmosphereMeshes: TitleAtmosphereMesh[],
  morphSurfaces?: TitleMorphSurface[],
): void {
  const textures = new Map<string, THREE.DataTexture>()
  for (const texture of model.textures ?? []) {
    const dataTexture = createNitroDataTexture(texture, false, true)
    textures.set(texture.id, dataTexture)
    texturesToDispose.push(dataTexture)
  }

  if (model.surfaces?.length) {
    for (let surfaceIndex = 0; surfaceIndex < model.surfaces.length; surfaceIndex += 1) {
      const surface = model.surfaces[surfaceIndex]
      const isLegacyBackdropPlane = surface.materialName === 'sky01'
        || surface.materialName === 'ginga'
        || surface.materialName === 'cloud02'
        || surface.materialName === 'cloud_tex'
        || surface.materialName === 'cloud_tex02'
      if (surface.positions.length === 0 || isLegacyBackdropPlane) continue
      const geometry = new THREE.BufferGeometry()
      const positionAttribute = new THREE.BufferAttribute(new Float32Array(surface.positions), 3)
      geometry.setAttribute('position', positionAttribute)
      if (surface.colors?.length === surface.positions.length) {
        geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(surface.colors), 3))
      }
      if (surface.uvs?.length === (surface.positions.length / 3) * 2) {
        geometry.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(surface.uvs), 2))
      }
      geometry.computeVertexNormals()
      const texture = surface.textureId ? textures.get(surface.textureId) : undefined
      const opacity = surface.materialAlpha ?? 1
      const materialKey = `${surface.materialName ?? ''} ${surface.textureName ?? ''}`.toLowerCase()
      const isAtmosphere = materialKey.includes('cloud') || materialKey.includes('kumo')
      const materialOpacity = isAtmosphere ? opacity * 0.82 : opacity
      const transparency = resolveNitroMaterialTransparency(materialOpacity, getNitroTextureAlphaMode(texture), materialKey.includes('kira') || isAtmosphere)
      const material = new THREE.MeshBasicMaterial({
        alphaToCoverage: Boolean(texture) && !transparency.transparent,
        alphaTest: transparency.alphaTest,
        color: surface.materialColor ? new THREE.Color(...surface.materialColor) : new THREE.Color(1, 1, 1),
        depthWrite: transparency.depthWrite,
        map: texture ?? null,
        opacity: transparency.opacity,
        side: THREE.DoubleSide,
        transparent: transparency.transparent,
        vertexColors: surface.colors?.length === surface.positions.length,
      })
      const mesh = new THREE.Mesh(geometry, material)
      if (isAtmosphere) {
        mesh.renderOrder = -10 + surfaceIndex
        atmosphereMeshes.push({ mesh, basePosition: mesh.position.clone(), texture })
      }
      mesh.frustumCulled = false
      mesh.userData.includeInTitleFit = Boolean(surface.materialName?.startsWith('h_'))
      const animatedPart = classifyTitlePart(surface.materialName, surface.textureName)
      if (animatedPart) animatedMeshes.push({ mesh, part: animatedPart, baseRotation: mesh.rotation.clone() })
      if (morphSurfaces) morphSurfaces.push({ surfaceIndex, positionAttribute })
      group.add(mesh)
    }
    return
  }

  if (!model.positions?.length) return
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(model.positions), 3))
  if (model.colors?.length === model.positions.length) {
    geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(model.colors), 3))
  }
  geometry.computeVertexNormals()
  group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({
    color: 0xffffff,
    side: THREE.DoubleSide,
    vertexColors: Boolean(model.colors),
  })))
}

export function fitTitleRoot(root: THREE.Group): void {
  root.updateMatrixWorld(true)
  const bounds = new THREE.Box3()
  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh) || object.userData.includeInTitleFit !== true) return
    const meshBounds = new THREE.Box3().setFromObject(object)
    if (!meshBounds.isEmpty()) bounds.union(meshBounds)
  })
  if (bounds.isEmpty()) bounds.setFromObject(root)
  if (bounds.isEmpty()) return
  const size = bounds.getSize(new THREE.Vector3())
  const center = bounds.getCenter(new THREE.Vector3())
  const scale = Math.min(138 / Math.max(size.z, 1), 84 / Math.max(size.y, 1))
  root.scale.setScalar(scale)
  root.position.set(-center.x * scale, -center.y * scale + 18, -center.z * scale - 8)
}
