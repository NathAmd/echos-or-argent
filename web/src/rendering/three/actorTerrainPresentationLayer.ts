import * as THREE from 'three'
import { isSurfableMetatile, type PlayerLocomotionMode } from '../../game/player/hgssPlayerMovement'
import type { OpeningMapPreview } from '../../ndsTypes'
import {
  IceActorReflectionLayer,
  isReflectiveTerrainAttribute,
  ProjectedActorShadowLayer,
  usesSceneDepthForSprites,
} from './actorGroundPresentation'

export const hgssNativeWaterSurfaceRenderOrder = -0.5
export const hgssSurfWakeRenderOrderOffset = -0.25

export type ActorTerrainRole = 'player' | 'follower' | 'event'
export type ActorTerrainSurface = 'land' | 'reflective' | 'water'

export type ActorTerrainComposition = {
  surface: ActorTerrainSurface
  showProjectedShadow: boolean
  showReflection: boolean
  showSurfWake: boolean
}

export function getActorTerrainAttribute(
  map: OpeningMapPreview | undefined,
  tileX: number,
  tileZ: number,
): number | undefined {
  const terrain = map?.terrain
  if (!terrain || tileX < 0 || tileZ < 0 || tileX >= terrain.width || tileZ >= terrain.height) return undefined
  return terrain.attributes[tileZ * terrain.width + tileX]
}

export function classifyActorTerrainSurface(attribute: number | undefined): ActorTerrainSurface {
  if (isReflectiveTerrainAttribute(attribute)) return 'reflective'
  if (isSurfableMetatile(attribute)) return 'water'
  return 'land'
}

export function resolveActorTerrainComposition(
  attribute: number | undefined,
  exterior: boolean,
  role: ActorTerrainRole,
  playerLocomotion: PlayerLocomotionMode,
): ActorTerrainComposition {
  const surface = classifyActorTerrainSurface(attribute)
  return {
    surface,
    // Une ombre projetée sur l'eau ou sur le miroir de glace se superpose au
    // reflet/ripple natif et produit une seconde silhouette noire incohérente.
    showProjectedShadow: exterior && surface === 'land',
    showReflection: surface === 'reflective',
    showSurfWake: role === 'player' && playerLocomotion === 'surfing' && surface === 'water',
  }
}

function createSurfWakeRing(innerRadius: number, outerRadius: number, opacity: number): THREE.Mesh<THREE.RingGeometry, THREE.MeshBasicMaterial> {
  const geometry = new THREE.RingGeometry(innerRadius, outerRadius, 40)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshBasicMaterial({
    color: 0xc8f5ff,
    depthTest: true,
    depthWrite: false,
    opacity,
    side: THREE.DoubleSide,
    transparent: true,
  })
  const ring = new THREE.Mesh(geometry, material)
  ring.name = 'hgss-player-surf-wake-ring'
  return ring
}

export function createHgssSurfWake(): THREE.Group {
  const wake = new THREE.Group()
  wake.name = 'hgss-player-surf-wake'
  const inner = createSurfWakeRing(0.27, 0.34, 0.46)
  const outer = createSurfWakeRing(0.42, 0.47, 0.2)
  outer.position.y = -0.004
  wake.add(inner, outer)
  wake.visible = false
  return wake
}

export function syncHgssSurfWake(
  wake: THREE.Group,
  sprite: THREE.Sprite,
  visible: boolean,
  actorRenderOrder: number,
  now: number,
): void {
  wake.visible = visible && sprite.visible
  if (!wake.visible) return
  const actorWidth = Math.abs(sprite.scale.x)
  const pulse = (Math.sin(now / 240) + 1) / 2
  wake.position.set(sprite.position.x, sprite.position.y - Math.max(0.02, actorWidth * 0.035), sprite.position.z)
  wake.scale.set(actorWidth * (0.92 + pulse * 0.05), 1, actorWidth * (0.48 + pulse * 0.035))
  wake.traverse((child) => {
    if (child instanceof THREE.Mesh) child.renderOrder = actorRenderOrder + hgssSurfWakeRenderOrderOffset
  })
}

export function disposeHgssSurfWake(wake: THREE.Group): void {
  wake.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    child.geometry.dispose()
    child.material.dispose()
  })
  wake.removeFromParent()
}

/**
 * Composition unique des effets qui touchent le sol d'un acteur. Elle évite
 * que les couches indépendantes conservent une ancienne carte, locomotion ou
 * texture et garantit l'ordre ombre -> reflet -> eau -> wake -> acteur.
 */
export class ActorTerrainPresentationLayer {
  readonly group = new THREE.Group()
  private readonly reflections: IceActorReflectionLayer
  private readonly shadows: ProjectedActorShadowLayer
  private readonly surfWake = createHgssSurfWake()
  private surfWakeActor: THREE.Sprite | undefined
  private playerLocomotion: PlayerLocomotionMode = 'walking'

  constructor(parent: THREE.Object3D) {
    this.group.name = 'hgss-actor-terrain-presentation'
    parent.add(this.group)
    this.shadows = new ProjectedActorShadowLayer(this.group)
    this.reflections = new IceActorReflectionLayer(this.group)
    this.group.add(this.surfWake)
  }

  setPlayerLocomotion(locomotion: PlayerLocomotionMode): void {
    this.playerLocomotion = locomotion
    if (locomotion !== 'surfing') {
      this.surfWake.visible = false
      this.surfWakeActor = undefined
    }
  }

  sync(
    sprite: THREE.Sprite,
    map: OpeningMapPreview | undefined,
    tileX: number,
    tileZ: number,
    role: ActorTerrainRole,
    actorRenderOrder: number,
    now: number,
  ): ActorTerrainComposition {
    const attribute = getActorTerrainAttribute(map, tileX, tileZ)
    const composition = resolveActorTerrainComposition(
      attribute,
      usesSceneDepthForSprites(map),
      role,
      this.playerLocomotion,
    )
    this.shadows.sync(sprite, composition.showProjectedShadow, actorRenderOrder)
    this.reflections.sync(sprite, composition.showReflection ? map : undefined, tileX, tileZ)
    if (role === 'player') {
      this.surfWakeActor = composition.showSurfWake ? sprite : undefined
      syncHgssSurfWake(this.surfWake, sprite, composition.showSurfWake, actorRenderOrder, now)
    }
    return composition
  }

  unregister(sprite: THREE.Sprite): void {
    this.shadows.unregister(sprite)
    this.reflections.unregister(sprite)
    if (this.surfWakeActor === sprite) {
      this.surfWake.visible = false
      this.surfWakeActor = undefined
    }
  }

  clear(): void {
    this.shadows.clear()
    this.reflections.clear()
    this.surfWake.visible = false
    this.surfWakeActor = undefined
  }

  dispose(): void {
    this.shadows.dispose()
    this.reflections.dispose()
    disposeHgssSurfWake(this.surfWake)
    this.group.removeFromParent()
  }
}
