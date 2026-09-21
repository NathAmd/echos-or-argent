import * as THREE from 'three'
import type { OpeningMapPreview } from '../../ndsTypes'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import type { ActorSpriteDepthMode } from './actorSpriteMaterial'

const indoorSpriteRenderOrderBase = 100_000

export function usesSceneDepthForSprites(map: OpeningMapPreview | undefined): boolean {
  return Boolean(map && usesWorldMatrixCoordinates(map))
}

/**
 * Un acteur HGSS est debout dans les deux domaines de scene. Sa silhouette
 * reste un billboard 2D, mais ses pixels suivent la pente verticale de la
 * camera afin que la tete passe au-dessus d'un comptoir pendant que le corps
 * reste masque par sa facade. Une profondeur constante a l'ancre inverse ces
 * deux occultations dans les grandes pieces ROM (unite de tuile: 16).
 */
export function resolveActorSpriteDepthMode(map: OpeningMapPreview | undefined): ActorSpriteDepthMode {
  if (!map?.model) return 'none'
  return 'upright'
}

/**
 * Tous les acteurs appartiennent au Z-buffer de la scène ROM, y compris dans
 * une pièce. Le renderOrder intérieur reste nécessaire pour départager les
 * sprites transparents entre eux, mais ne doit jamais leur permettre de
 * traverser un mur, un meuble ou un MapProp opaque.
 */
export function usesActorDepthBuffer(map: OpeningMapPreview | undefined): boolean {
  return resolveActorSpriteDepthMode(map) !== 'none'
}

export function getActorSpriteRenderOrder(map: OpeningMapPreview | undefined, positionZ: number): number {
  // En extérieur, le Z-buffer et le shader upright portent la profondeur. En
  // intérieur, acteurs et plans ROM partagent le même tri sud -> nord.
  return usesSceneDepthForSprites(map) ? 0 : indoorSpriteRenderOrderBase + Math.round(positionZ * 100) + 50
}

export function isReflectiveTerrainAttribute(attribute: number | undefined): boolean {
  const behavior = attribute === undefined ? undefined : attribute & 0xff
  return behavior === 32 || behavior === 45
}

const projectedShadowDirection = new THREE.Vector2(18, -14).normalize()

export function createProjectedActorShadow(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.PlaneGeometry(1, 1)
  geometry.translate(0, 0.5, 0)
  geometry.rotateX(Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    alphaTest: 0.02,
    color: 0x05070b,
    depthTest: true,
    depthWrite: false,
    opacity: 0.22,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const shadow = new THREE.Mesh(geometry, material)
  shadow.name = 'hgss-actor-projected-shadow'
  shadow.rotation.y = Math.atan2(projectedShadowDirection.x, projectedShadowDirection.y)
  shadow.visible = false
  return shadow
}

export function syncProjectedActorShadow(
  shadow: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>,
  sprite: THREE.Sprite,
  exterior: boolean,
  renderOrder: number,
): void {
  const sourceTexture = sprite.material.map
  shadow.visible = exterior && sprite.visible && Boolean(sourceTexture)
  if (!shadow.visible) return
  if (shadow.material.map !== sourceTexture) {
    shadow.material.map = sourceTexture
    shadow.material.needsUpdate = true
  }
  const length = Math.abs(sprite.scale.y) * 0.62
  shadow.scale.set(Math.abs(sprite.scale.x) * 0.72, 1, length)
  const transparentFootPadding = sprite.center.y * length
  shadow.position.set(
    sprite.position.x - projectedShadowDirection.x * transparentFootPadding,
    sprite.position.y - (exterior ? 0.07 : 0.065),
    sprite.position.z - projectedShadowDirection.y * transparentFootPadding,
  )
  shadow.renderOrder = renderOrder - 2
}

export class ProjectedActorShadowLayer {
  readonly group = new THREE.Group()
  private readonly shadows = new Map<THREE.Sprite, THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>>()

  constructor(parent: THREE.Object3D) {
    this.group.name = 'hgss-actor-projected-shadows'
    parent.add(this.group)
  }

  sync(sprite: THREE.Sprite, exterior: boolean, renderOrder: number): void {
    let shadow = this.shadows.get(sprite)
    if (!shadow) {
      shadow = createProjectedActorShadow()
      this.shadows.set(sprite, shadow)
      this.group.add(shadow)
    }
    syncProjectedActorShadow(shadow, sprite, exterior, renderOrder)
  }

  unregister(sprite: THREE.Sprite): void {
    const shadow = this.shadows.get(sprite)
    if (!shadow) return
    this.shadows.delete(sprite)
    this.group.remove(shadow)
    shadow.geometry.dispose()
    shadow.material.dispose()
  }

  clear(): void {
    for (const sprite of [...this.shadows.keys()]) this.unregister(sprite)
  }

  dispose(): void {
    this.clear()
    this.group.removeFromParent()
  }
}

export function setActorEffectRenderOrder(object: THREE.Object3D, renderOrder: number): void {
  object.traverse((child) => { if (child instanceof THREE.Mesh) child.renderOrder = renderOrder })
}

export function createIceActorReflection(): THREE.Sprite {
  const reflection = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0xb8ecf2, transparent: true, opacity: 0.22, alphaTest: 0.04, depthTest: true, depthWrite: false, side: THREE.DoubleSide }))
  reflection.name = 'hgss-actor-ice-reflection'
  reflection.center.set(0.5, 1)
  reflection.visible = false
  return reflection
}

function syncMirroredTexture(reflection: THREE.Sprite, sourceTexture: THREE.Texture): void {
  if (reflection.userData.sourceTexture === sourceTexture) return
  reflection.material.map?.dispose()
  const mirroredTexture = sourceTexture.clone()
  mirroredTexture.wrapT = THREE.RepeatWrapping
  mirroredTexture.repeat.y = -Math.abs(mirroredTexture.repeat.y || 1)
  mirroredTexture.offset.y = 1
  mirroredTexture.needsUpdate = true
  reflection.material.map = mirroredTexture
  reflection.material.needsUpdate = true
  reflection.userData.sourceTexture = sourceTexture
}

export function syncIceActorReflection(
  reflection: THREE.Sprite,
  sprite: THREE.Sprite,
  map: OpeningMapPreview | undefined,
  tileX: number,
  tileZ: number,
): void {
  const terrain = map?.terrain
  const attribute = terrain && tileX >= 0 && tileZ >= 0 && tileX < terrain.width && tileZ < terrain.height
    ? terrain.attributes[tileZ * terrain.width + tileX]
    : undefined
  reflection.visible = sprite.visible && Boolean(sprite.material.map) && isReflectiveTerrainAttribute(attribute)
  if (!reflection.visible) return
  syncMirroredTexture(reflection, sprite.material.map!)
  reflection.center.set(sprite.center.x, 1 - sprite.center.y)
  reflection.scale.set(Math.abs(sprite.scale.x) * 0.86, Math.abs(sprite.scale.y) * 0.82, 1)
  reflection.position.copy(sprite.position)
  reflection.material.rotation = sprite.material.rotation
  reflection.renderOrder = sprite.renderOrder - 1
}

export function disposeIceActorReflection(reflection: THREE.Sprite): void {
  reflection.geometry.dispose()
  reflection.material.map?.dispose()
  reflection.material.dispose()
}

export class IceActorReflectionLayer {
  readonly group = new THREE.Group()
  private readonly reflections = new Map<THREE.Sprite, THREE.Sprite>()

  constructor(parent: THREE.Object3D) {
    this.group.name = 'hgss-actor-ice-reflections'
    parent.add(this.group)
  }

  sync(sprite: THREE.Sprite, map: OpeningMapPreview | undefined, tileX: number, tileZ: number): void {
    let reflection = this.reflections.get(sprite)
    if (!reflection) {
      reflection = createIceActorReflection()
      this.reflections.set(sprite, reflection)
      this.group.add(reflection)
    }
    syncIceActorReflection(reflection, sprite, map, tileX, tileZ)
  }

  unregister(sprite: THREE.Sprite): void {
    const reflection = this.reflections.get(sprite)
    if (!reflection) return
    this.reflections.delete(sprite)
    this.group.remove(reflection)
    disposeIceActorReflection(reflection)
  }

  clear(): void {
    for (const sprite of [...this.reflections.keys()]) this.unregister(sprite)
  }

  dispose(): void {
    this.clear()
    this.group.removeFromParent()
  }
}
