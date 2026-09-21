import type * as THREE from 'three'
import type { AzaleaGymRide } from './game/scripts/azaleaGymMechanism'
import type { FieldMovementAction } from './game/scripts/fieldMovement'
import type { ForcedTransportPhase } from './game/world/forcedTransport'
import type {
  OpeningMapPreview,
  PlayerDirection,
  PlayerTextureFrames,
  RomInventory,
} from './ndsTypes'
import type { HgssFollowerEmote } from './rom/overworld/followerEmotes'
import type { HgssFollowerReactionMotion } from './rom/overworld/followerReactions'
import type { EventSpriteRuntimeFrames } from './rendering/three/eventSpriteResource'
import type { NitroMapPropRuntime } from './rendering/three/nitroMapPropRuntime'

export type PlayerRuntimeTextures = {
  standing: Record<PlayerDirection, THREE.DataTexture>
  walking: Record<PlayerDirection, THREE.DataTexture[]>
  running?: Record<PlayerDirection, THREE.DataTexture[]>
}

export type EventRuntimeSprite = {
  id: number
  resolvedSpriteId: number
  eventFlag: number
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  textures: THREE.DataTexture[]
  frames?: PlayerTextureFrames
  runtimeFrames?: EventSpriteRuntimeFrames
  direction: PlayerDirection
  tileX: number
  tileZ: number
  movementHidden: boolean
  animationStartedAt: number
  apricornFruit?: { sprite: THREE.Sprite, material: THREE.SpriteMaterial, texture: THREE.DataTexture, treeIndex: number }
}

export type MapObjectEvent = NonNullable<OpeningMapPreview['events']>['objects'][number]

export type ActorMotion = {
  objectId: number
  actions: FieldMovementAction[]
  actionIndex: number
  repetition: number
  startedAt: number
  duration: number
  start: THREE.Vector3
  target: THREE.Vector3
  resolve: () => void
}

export type StaticMapPropRuntime = NitroMapPropRuntime

export type MapPropAnimationTrack = {
  entry: StaticMapPropRuntime
  frames: NonNullable<ReturnType<NonNullable<RomInventory['mapPropAnimationResolver']>>>['frames']
}

export type AzaleaGymCartRuntime = StaticMapPropRuntime & {
  animate?: (now: number) => void
  dispose: () => void
  routeAnimationFrames?: NonNullable<ReturnType<NonNullable<RomInventory['mapPropAnimationResolver']>>>['frames']
}

export type AzaleaGymRideRuntime = {
  ride: AzaleaGymRide
  cart: AzaleaGymCartRuntime
  startedAt: number
  routeDurationMs: number
  playerStart: THREE.Vector3
  followerStart: THREE.Vector3
  presentationPhase: ForcedTransportPhase
  travelStarted: boolean
  onTravelStart?: () => void
  resolve: () => void
}

export type FollowerReactionMotionRuntime = {
  motion: HgssFollowerReactionMotion
  start: THREE.Vector3
  originalDirection: PlayerDirection
  unitScale: number
  ignoreHeightAdjustment: boolean
  startedAt: number
  nextSoundSegment: number
  onStepSound: ((segmentIndex: number) => void) | undefined
  resolve: () => void
}

export type FollowerEmoteRuntime = {
  emote: HgssFollowerEmote
  textures: THREE.DataTexture[]
  startedAt: number
  resolve: () => void
}
