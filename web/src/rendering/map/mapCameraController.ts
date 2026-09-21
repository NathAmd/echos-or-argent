import * as THREE from 'three'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import type { FieldCameraParam, OpeningMapPreview } from '../../ndsTypes'
import { resolveFieldCameraGroundMargins, resolveFieldCameraProjection, resolveRemasteredFieldCameraAngles } from '../../rom/maps/fieldCamera'
import { getMapMatrixFillerBoundaries, getMapMatrixTileBounds } from '../../rom/maps/mapFootprint'
import { projectMapPosition, type SceneLayout } from './mapProjection'

export type MapCamera = THREE.OrthographicCamera | THREE.PerspectiveCamera

export type MapCameraViewport = {
  width: number
  height: number
}

const defaultViewport = (): MapCameraViewport => ({ width: 1, height: 1 })

/**
 * Possede les deux projections de terrain et toute la politique de suivi HGSS.
 * Le runtime de carte lui fournit uniquement son contexte et le point acteur a
 * suivre; aucun etat de projection n'est duplique dans la boucle de rendu.
 */
export class MapCameraController {
  readonly orthographicCamera = new THREE.OrthographicCamera(-16, 16, 11, -11, 0.1, 5_000)
  readonly perspectiveCamera = new THREE.PerspectiveCamera(45, 1, 0.1, 5_000)

  private activeCamera: MapCamera = this.orthographicCamera
  private map: OpeningMapPreview | undefined
  private layout: SceneLayout | undefined
  private cameraParams: readonly FieldCameraParam[] | undefined
  private fixedTarget: THREE.Vector3 | undefined
  private viewportWidth = 1
  private viewportHeight = 1
  private viewHeight = 22
  private viewOffsetY = 0
  private readonly worldTranslationOffset = new THREE.Vector3()
  private readonly resolveViewport: () => MapCameraViewport

  constructor(resolveViewport: () => MapCameraViewport = defaultViewport) {
    this.resolveViewport = resolveViewport
    this.activeCamera.position.set(0, 16, 18)
    this.activeCamera.lookAt(0, 0, 0)
    this.readViewport()
  }

  get camera(): MapCamera {
    return this.activeCamera
  }

  setContext(
    map: OpeningMapPreview,
    layout: SceneLayout,
    cameraParams: readonly FieldCameraParam[] | undefined,
  ): void {
    this.setWorldTranslationOffset(0, 0)
    this.map = map
    this.layout = layout
    this.cameraParams = cameraParams
    this.fixedTarget = undefined
  }

  setTileTarget(tileX?: number, tileZ?: number): void {
    this.fixedTarget = tileX === undefined || tileZ === undefined
      ? undefined
      : projectMapPosition(this.layout, this.map, tileX, tileZ, 0.08)
  }

  follow(playerPosition: THREE.Vector3): void {
    this.readViewport()
    const focusPosition = this.fixedTarget ?? playerPosition
    const map = this.map
    const isFieldMap = map ? usesWorldMatrixCoordinates(map) : false
    const cameraParam = map ? this.cameraParams?.[map.header.cameraType] : undefined
    if (cameraParam) this.applyNativeCamera(cameraParam, focusPosition, isFieldMap)
    else this.applyFallbackCamera(focusPosition, isFieldMap)
    this.activeCamera.position.add(this.worldTranslationOffset)
    this.updateProjection()
  }

  resize(width: number, height: number): void {
    this.viewportWidth = Math.max(1, width)
    this.viewportHeight = Math.max(1, height)
    this.updateProjection()
  }

  addDepthOffset(offset: number): void {
    this.activeCamera.position.z += offset
  }

  /** Translate ensemble la position et la cible natives sans recalculer l'orientation. */
  setWorldTranslationOffset(x: number, z: number): void {
    this.activeCamera.position.sub(this.worldTranslationOffset)
    this.worldTranslationOffset.set(x, 0, z)
    this.activeCamera.position.add(this.worldTranslationOffset)
  }

  private applyNativeCamera(
    cameraParam: FieldCameraParam,
    focusPosition: THREE.Vector3,
    isFieldMap: boolean,
  ): void {
    // Les modeles exterieurs sont ramenes de 16 unites natives par tuile a
    // une unite web. Les parametres camera suivent exactement la meme echelle.
    const scale = isFieldMap ? 1 / 16 : 1
    const distance = cameraParam.distance * scale
    const { angleX, angleY } = resolveRemasteredFieldCameraAngles(cameraParam)
    const projection = resolveFieldCameraProjection(cameraParam, scale)
    this.activeCamera = projection.kind === 'perspective'
      ? this.perspectiveCamera
      : this.orthographicCamera
    this.viewOffsetY = 0
    if (projection.kind === 'perspective') this.perspectiveCamera.fov = projection.verticalFovDegrees
    else this.viewHeight = projection.viewHeight

    const target = new THREE.Vector3(
      focusPosition.x + cameraParam.lookAtOffsetX * scale,
      focusPosition.y + cameraParam.lookAtOffsetY * scale,
      focusPosition.z + cameraParam.lookAtOffsetZ * scale,
    )
    if (isFieldMap && !this.fixedTarget && this.map) this.clampFieldTarget(target, cameraParam, scale)

    const horizontalDistance = Math.cos(angleX) * distance
    this.activeCamera.position.set(
      target.x + Math.sin(angleY) * horizontalDistance,
      target.y + Math.sin(-angleX) * distance,
      target.z + Math.cos(angleY) * horizontalDistance,
    )
    this.activeCamera.near = Math.max(0.001, cameraParam.near * scale)
    this.activeCamera.far = Math.max(this.activeCamera.near + 1, cameraParam.far * scale)
    this.activeCamera.lookAt(target)
  }

  private applyFallbackCamera(focusPosition: THREE.Vector3, isFieldMap: boolean): void {
    this.activeCamera = this.orthographicCamera
    this.viewOffsetY = 0
    this.viewHeight = isFieldMap ? 11.5 : 18
    const layoutCameraHeight = this.layout?.cameraHeight ?? 9
    const layoutCameraDistance = this.layout?.cameraDistance ?? 18
    const fieldCameraHeight = isFieldMap
      ? Math.max(layoutCameraHeight * 1.6, 18)
      : Math.max(layoutCameraHeight, 9)
    const fieldCameraDepth = isFieldMap
      ? THREE.MathUtils.clamp(layoutCameraDistance * 0.18, 16, 26)
      : Math.max(layoutCameraDistance * 0.45, 12)
    this.activeCamera.position.set(
      focusPosition.x,
      focusPosition.y + fieldCameraHeight,
      focusPosition.z + fieldCameraDepth,
    )
    this.activeCamera.near = 0.1
    this.activeCamera.far = 5_000
    this.activeCamera.lookAt(focusPosition.x, focusPosition.y + 0.8, focusPosition.z)
  }

  private clampFieldTarget(target: THREE.Vector3, cameraParam: FieldCameraParam, scale: number): void {
    const map = this.map
    if (!map) return
    const boundaries = getMapMatrixFillerBoundaries(map.id, map.matrix)
    const bounds = getMapMatrixTileBounds(map.id, map.matrix)
    const groundMargins = resolveFieldCameraGroundMargins(
      cameraParam,
      scale,
      this.viewportWidth / this.viewportHeight,
    )
    if (!boundaries || !bounds || !groundMargins) return
    const minX = boundaries.west ? bounds.minX - groundMargins.minX : Number.NEGATIVE_INFINITY
    const maxX = boundaries.east ? bounds.maxX - groundMargins.maxX : Number.POSITIVE_INFINITY
    const minZ = boundaries.north ? bounds.minZ - groundMargins.minZ : Number.NEGATIVE_INFINITY
    const maxZ = boundaries.south ? bounds.maxZ - groundMargins.maxZ : Number.POSITIVE_INFINITY
    target.x = minX <= maxX
      ? THREE.MathUtils.clamp(target.x, minX, maxX)
      : (bounds.minX + bounds.maxX) / 2
    target.z = minZ <= maxZ
      ? THREE.MathUtils.clamp(target.z, minZ, maxZ)
      : (bounds.minZ + bounds.maxZ) / 2
  }

  private readViewport(): void {
    const viewport = this.resolveViewport()
    this.viewportWidth = Math.max(1, viewport.width)
    this.viewportHeight = Math.max(1, viewport.height)
  }

  private updateProjection(): void {
    const aspect = this.viewportWidth / this.viewportHeight
    if (this.activeCamera instanceof THREE.PerspectiveCamera) {
      this.activeCamera.aspect = aspect
    } else {
      this.activeCamera.left = -this.viewHeight * aspect / 2
      this.activeCamera.right = this.viewHeight * aspect / 2
      this.activeCamera.top = this.viewHeight / 2 + this.viewOffsetY
      this.activeCamera.bottom = -this.viewHeight / 2 + this.viewOffsetY
    }
    this.activeCamera.updateProjectionMatrix()
  }
}
