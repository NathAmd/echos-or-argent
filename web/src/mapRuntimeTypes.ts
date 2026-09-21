import type { BlackthornGymActionResult } from './game/gyms/blackthornGymMechanism'
import type { FuchsiaGymWall } from './game/gyms/fuchsiaGymMechanism'
import type { HgssGymPropPresentation } from './game/gyms/hgssGymPropAnimations'
import type { PlayerLocomotionMode, PlayerMovementKind } from './game/player/hgssPlayerMovement'
import type { AzaleaGymRide } from './game/scripts/azaleaGymMechanism'
import type { FieldMovementAction } from './game/scripts/fieldMovement'
import type { FieldMapProp, FieldScriptState } from './game/scripts/fieldScriptRunner'
import type { FollowerScriptMovement } from './game/world/followerScriptMovement'
import type { FollowerMapObjectSignal } from './game/world/followerMapObjectSignal'
import type { HgssWorldEnvironmentPresentation } from './game/world/hgssEnvironmentCoordinator'
import type { HgssFieldMoveEffectMode } from './game/world/hgssFieldMoveEffect'
import type { FollowerWorldState } from './game/world/worldSession'
import type {
  NitroTexturePreview,
  OpeningMapPreview,
  PlayerDirection,
  PlayerTextureFrames,
  PokemonFollowerTextures,
  RomInventory,
} from './ndsTypes'
import type { DoorTransitionDescriptor } from './rom/maps/doorTransition'
import type { HgssFollowerEmote } from './rom/overworld/followerEmotes'
import type { HgssFollowerReactionMotion } from './rom/overworld/followerReactions'
import type { EcruteakGymCandlePosition } from './rendering/three/ecruteakGymCandleLayer'
import type { HgssFishingBiteEffectAsset, HgssFishingBiteEffectTarget } from './rendering/three/hgssFishingBiteEffectLayer'
import type { HgssFieldMoveEffectResult } from './rendering/three/hgssFieldMoveEffectLayer'
import type { PlayerTransitionMotion } from './rendering/three/playerTransitionMotion'
import type { MapDynamicPokemonActor, MapDynamicPokemonSpeciesTextureResolver } from './rendering/three/dynamicPokemonActorLayer'
import type { GameRenderStats } from './rendering/renderStats'

export type { PlayerTransitionMotion, PlayerTransitionMotionKind, PlayerTransitionMotionPhase } from './rendering/three/playerTransitionMotion'
export { createMapDynamicPokemonSpeciesTextureResolver } from './rendering/three/dynamicPokemonActorLayer'
export type { MapDynamicPokemonActor, MapDynamicPokemonActorTexture, MapDynamicPokemonSpeciesTextureResolver } from './rendering/three/dynamicPokemonActorLayer'

export type MapSceneResources = Partial<Pick<RomInventory,
  | 'eventTexturePreviews'
  | 'eventTextureFrames'
  | 'fieldTextureAnimations'
  | 'fieldCameraParams'
  | 'eventTextureResolver'
  | 'mapPropModelResolver'
  | 'grassEffectResolver'
  | 'mapPropAnimationResolver'
  | 'mapPropAnimationMetadataResolver'
>>

export type MapSceneRuntime = {
  loadMap: (map: OpeningMapPreview, state: FieldScriptState, resources?: MapSceneResources) => void
  setCameraTarget: (tileX?: number, tileZ?: number) => void
  setWorldEnvironment: (environment: HgssWorldEnvironmentPresentation) => void
  renderFrame: (now?: number) => void
  getRenderStats: () => GameRenderStats
  pauseAnimations: (now?: number) => void
  resumeAnimations: (now?: number) => void
  dispose: () => void
}

export type MapActorRuntime = {
  setPlayerTexture: (texture: NitroTexturePreview | undefined) => void
  setPlayerTextureFrames: (frames: PlayerTextureFrames | undefined) => void
  setPlayerLocomotion: (locomotion: PlayerLocomotionMode) => void
  setPlayerDirection: (direction: PlayerDirection) => void
  setPlayerPosition: (tileX: number, tileZ: number, direction?: PlayerDirection, animate?: boolean, groundHeight?: number, durationFrames?: number, movement?: PlayerMovementKind) => string
  playPlayerTransitionMotion: (motion: PlayerTransitionMotion) => Promise<void>
  setFollowerTexture: (resource: PokemonFollowerTextures | undefined) => void
  setFollowerPosition: (state: FollowerWorldState | undefined, animate?: boolean, durationFrames?: number) => void
  getFollowerMapObjectSignal: () => FollowerMapObjectSignal
  setFollowerMovementPaused: (paused: boolean) => void
  applyFollowerMovement: (state: FollowerWorldState, movement: FollowerScriptMovement) => void
  playFollowerReactionMotion: (motion: HgssFollowerReactionMotion, ignoreHeightAdjustment?: boolean, onStepSound?: (segmentIndex: number) => void) => Promise<void>
  playFollowerEmote: (emote: HgssFollowerEmote, onStart?: (soundId: number) => void) => Promise<void>
  startFishingBiteEffect: (target: HgssFishingBiteEffectTarget, effect: HgssFishingBiteEffectAsset) => void
  stopFishingBiteEffect: (target?: HgssFishingBiteEffectTarget) => void
  refreshFollower: () => void
  isFollowerMoving: () => boolean
  isPlayerMoving: () => boolean
  applyMovement: (objectId: number, actions: FieldMovementAction[]) => Promise<void>
  isActorMoving: (objectId: number) => boolean
  setActorPosition: (objectId: number, tileX: number, tileZ: number, direction?: PlayerDirection) => void
  setActorDirection: (objectId: number, direction: PlayerDirection) => void
  setActorVisibility: (objectId: number, visible: boolean) => void
  setActorSpriteResource: (objectId: number, spriteId: number) => void
  playApricornTreeAnimation: (objectId: number, apricornType: number) => Promise<void>
  syncDaycareObjects: (objects: Array<{ objectId: 250 | 251, tileX: number, tileZ: number, resource: PokemonFollowerTextures }>) => void
  syncEventVisibility: (state: FieldScriptState) => void
  isScriptMoving: () => boolean
}

export type MapDynamicPokemonActorRuntime = {
  syncDynamicPokemonActors: (actors: readonly MapDynamicPokemonActor[], resolver?: MapDynamicPokemonSpeciesTextureResolver) => readonly MapDynamicPokemonActor[]
  clearDynamicPokemonActors: () => void
  listDynamicPokemonActors: () => readonly MapDynamicPokemonActor[]
  getDynamicPokemonActorsAt: (tileX: number, tileY: number) => readonly MapDynamicPokemonActor[]
  getBlockingDynamicPokemonActorAt: (tileX: number, tileY: number, excludedId?: string) => MapDynamicPokemonActor | undefined
  isDynamicPokemonActorTileBlocked: (tileX: number, tileY: number, excludedId?: string) => boolean
  getActionDynamicPokemonActorAt: (tileX: number, tileY: number) => MapDynamicPokemonActor | undefined
}

export type MapPropRuntime = {
  syncMapProps: (props: FieldMapProp[], resolver: RomInventory['mapPropModelResolver'], animationResolver?: RomInventory['mapPropAnimationResolver'], metadataResolver?: RomInventory['mapPropAnimationMetadataResolver']) => void
  setMapPropDeferredAnimations: (bindings: readonly { modelId: number, animationIndex: number }[]) => void
  loadMapPropOneShotAnimation: (tag: number, modelIds: readonly number[], animationCount: number, loopCount: number, reversed: boolean, animationResolver: RomInventory['mapPropAnimationResolver'], metadataResolver: RomInventory['mapPropAnimationMetadataResolver']) => void
  playMapPropOneShotAnimation: (tag: number, animationIndex: number) => void
  waitMapPropOneShotAnimation: (tag: number) => Promise<void>
  unloadMapPropOneShotAnimation: (tag: number) => void
  playDoorAnimation: (door: DoorTransitionDescriptor, animationIndex: 0 | 1, resolver: RomInventory['mapPropAnimationResolver']) => Promise<void>
}

export type MapFieldMoveEffectRuntime = {
  playFieldMoveEffect: (mode: HgssFieldMoveEffectMode, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver']) => Promise<HgssFieldMoveEffectResult>
  clearFieldMoveEffect: () => void
}

export type MapGymRuntime = {
  syncAzaleaGymMechanism: (spiderNodes: readonly number[], switchState: number, modelResolver: RomInventory['mapPropModelResolver'], animationResolver: RomInventory['mapPropAnimationResolver'], metadataResolver: RomInventory['mapPropAnimationMetadataResolver']) => void
  setAzaleaGymSwitchState: (switchState: number, animationResolver: RomInventory['mapPropAnimationResolver'], metadataResolver: RomInventory['mapPropAnimationMetadataResolver']) => void
  playAzaleaGymSwitch: (switchNumber: number, switchState: number, animationResolver: RomInventory['mapPropAnimationResolver'], metadataResolver: RomInventory['mapPropAnimationMetadataResolver']) => Promise<void>
  playAzaleaGymRide: (ride: AzaleaGymRide, onTravelStart?: () => void) => Promise<void>
  syncBlackthornGymMechanism: (data: Uint8Array, resolver: RomInventory['mapPropModelResolver']) => void
  playBlackthornGymAction: (result: BlackthornGymActionResult) => Promise<void>
  presentGymProps: (presentations: readonly HgssGymPropPresentation[], animate: boolean) => Promise<void>
  playFuchsiaGymWall: (wall: FuchsiaGymWall, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver']) => Promise<void> | undefined
  playViridianGymTile: (behavior: number, tileX: number, tileZ: number, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver']) => Promise<void> | undefined
  syncVioletGymElevator: (data: Uint8Array, resolver: RomInventory['mapPropModelResolver']) => void
  playVioletGymElevator: (targetY: number, durationFrames: number) => Promise<void>
  syncEcruteakGymCandles: (data: Uint8Array, positions: readonly EcruteakGymCandlePosition[], resolver: RomInventory['mapPropModelResolver']) => void
  trackEcruteakGymCandle: (objectId?: number) => void
  lightEcruteakGymCandle: (objectId: number) => void
  extinguishEcruteakGymCandle: (objectId: number) => Promise<void>
}

export type MapRuntime = MapSceneRuntime & MapActorRuntime & MapDynamicPokemonActorRuntime & MapPropRuntime & MapFieldMoveEffectRuntime & MapGymRuntime
