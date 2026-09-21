import * as THREE from 'three'
import { resolveGameRenderQualityProfile, type GameRenderQuality } from './rendering/renderQuality'
import { createGameRenderStats } from './rendering/renderStats'
import { getMapOrigin, usesWorldMatrixCoordinates } from './game/world/mapCoordinates'
import { hgssFollowerObjectId, type FollowerWorldState } from './game/world/worldSession'
import type { PlayerLocomotionMode, PlayerMovementKind } from './game/player/hgssPlayerMovement'
import type { FollowerScriptMovement } from './game/world/followerScriptMovement'
import { sampleHgssFollowerReactionMotion, type HgssFollowerReactionMotion } from './rom/overworld/followerReactions'
import { sampleHgssFollowerEmote, type HgssFollowerEmote } from './rom/overworld/followerEmotes'
import { doorAnimationFrameDurationMs, resolveDoorAnimationDurationMs, type DoorTransitionDescriptor } from './rom/maps/doorTransition'
import type { NitroMapPropPreview, NitroModelPreview, NitroTextureAnimationPreview, NitroTexturePreview, OpeningMapPreview, PlayerDirection, PlayerTextureFrames, PokemonFollowerTextures, RomInventory } from './ndsTypes'
import { projectMapPosition, unprojectMapTile, type SceneLayout } from './rendering/map/mapProjection'
import { resolveGameRenderPixelRatio } from './rendering/renderResolution'
import { buildSceneMesh } from './rendering/map/mapSceneBuilder'
import { createNitroDataTexture } from './rendering/three/nitroTexture'
import { getActorSpriteRenderOrder, resolveActorSpriteDepthMode } from './rendering/three/actorGroundPresentation'
import { ActorTerrainPresentationLayer } from './rendering/three/actorTerrainPresentationLayer'
import { createActorSpriteMaterial, setActorSpriteDepthMode, type ActorSpriteDepthMode } from './rendering/three/actorSpriteMaterial'
import { HgssActorIdlePresentation } from './rendering/three/actorIdlePresentation'
import { getFieldMovementDurationFrames, type FieldMovementAction } from './game/scripts/fieldMovement'
import { resolveHgssApricornType, resolveObjectSpriteId, type FieldMapProp, type FieldScriptState } from './game/scripts/fieldScriptRunner'
import type { AzaleaGymRide, AzaleaGymRouteNode } from './game/scripts/azaleaGymMechanism'
import { getMapMatrixRenderableCellIndices } from './rom/maps/mapFootprint'
import { HgssWorldEnvironmentLayer } from './rendering/three/hgssWorldEnvironmentLayer'
import { getForcedTransportRouteDistance, hgssAzaleaTransportTiming, sampleForcedTransportRoute, sampleForcedTransportTimeline } from './game/world/forcedTransport'
import type { BlackthornGymActionResult } from './game/gyms/blackthornGymMechanism'
import { BlackthornGymPlatformLayer } from './rendering/three/blackthornGymPlatformLayer'
import type { HgssGymPropPresentation } from './game/gyms/hgssGymPropAnimations'
import type { FuchsiaGymWall } from './game/gyms/fuchsiaGymMechanism'
import { FuchsiaGymWallLayer } from './rendering/three/fuchsiaGymWallLayer'
import { ViridianGymTileLayer } from './rendering/three/viridianGymTileLayer'
import { VioletGymElevatorLayer } from './rendering/three/violetGymElevatorLayer'
import { EcruteakGymCandleLayer, type EcruteakGymCandlePosition } from './rendering/three/ecruteakGymCandleLayer'
import { createEventSpriteResource, disposeEventSpriteResource } from './rendering/three/eventSpriteResource'
import { MapPropAnimationController } from './rendering/three/mapPropAnimationController'
import { MapPropAnimationPlayback } from './rendering/three/mapPropAnimationPlayback'
import { MapPropOneShotAnimationController } from './rendering/three/mapPropOneShotAnimationController'
import { resolveMapPropAnimationLoadMode } from './rom/model/mapPropAnimationMetadata'
import { resolveHgssFieldVisualTime } from './game/time/hgssRtc'
import { createHgssAnimationClock, hgssVBlankDurationMs, hgssVBlanksToMilliseconds, sampleHgssVBlankFrame } from './game/time/hgssFrameTiming'
import { sampleHgssActorSpriteFrame } from './game/world/hgssWorldAnimationClock'
import { applyNitroMapPropFrame as applyMapPropFrame, applyNitroMapPropTransition, captureNitroMapPropPositions as captureMapPropPositions, createNitroMapPropRuntime as createStaticMapPropRuntime, disposeNitroMapPropFrameTextures as disposeMapPropFrameTextures } from './rendering/three/nitroMapPropRuntime'
import { HgssFishingBiteEffectLayer, type HgssFishingBiteEffectAsset, type HgssFishingBiteEffectTarget } from './rendering/three/hgssFishingBiteEffectLayer'
import { HgssFieldMoveEffectLayer } from './rendering/three/hgssFieldMoveEffectLayer'
import { HgssGrassEffectLayer } from './rendering/three/hgssGrassEffectLayer'
import { MapCameraController } from './rendering/map/mapCameraController'
import { MapPlayerTransitionMotion } from './rendering/three/mapPlayerTransitionMotion'
import type { PlayerTransitionMotion } from './rendering/three/playerTransitionMotion'
import { DynamicPokemonActorLayer } from './rendering/three/dynamicPokemonActorLayer'
import type {
  ActorMotion,
  AzaleaGymCartRuntime,
  AzaleaGymRideRuntime,
  EventRuntimeSprite,
  FollowerEmoteRuntime,
  FollowerReactionMotionRuntime,
  MapObjectEvent,
  MapPropAnimationTrack,
  PlayerRuntimeTextures,
  StaticMapPropRuntime,
} from './mapRuntimeInternalTypes'
import type { MapRuntime, MapSceneResources } from './mapRuntimeTypes'
export { getMapOrigin } from './game/world/mapCoordinates'
export { createMapDynamicPokemonSpeciesTextureResolver, type MapDynamicPokemonActor, type MapDynamicPokemonActorTexture, type MapDynamicPokemonSpeciesTextureResolver, type MapRuntime } from './mapRuntimeTypes'
const playerDirections: PlayerDirection[] = ['north', 'south', 'west', 'east']
const walkDurationFrames = 8

function createCutoutSpriteMaterial(texture: THREE.Texture | null, depthMode: ActorSpriteDepthMode | boolean = 'upright'): THREE.SpriteMaterial {
  return createActorSpriteMaterial(texture, depthMode)
}
export function createMapRuntime(canvas: HTMLCanvasElement, quality: GameRenderQuality = 'balanced'): MapRuntime {
  const animationClock = createHgssAnimationClock()
  const animationNow = (now = performance.now()): number => animationClock.sample(now)
  const qualityProfile = resolveGameRenderQualityProfile(quality)
  let lastFrameTimeMs = 0
  // The diagnostic reporter must be able to read the last fully rendered 3D
  // frame after the user notices a bug and pauses input.
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: qualityProfile.antialias,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: true,
  })
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = 1.05
  renderer.shadowMap.enabled = qualityProfile.shadows
  renderer.shadowMap.type = THREE.PCFSoftShadowMap
  const cameraController = new MapCameraController(() => ({
    width: canvas.clientWidth,
    height: canvas.clientHeight,
  }))
  let rendererCssWidth = 0
  let rendererCssHeight = 0
  let rendererPixelRatio = 0
  const syncRendererSize = (): boolean => {
    const width = Math.max(1, canvas.clientWidth)
    const height = Math.max(1, canvas.clientHeight)
    const pixelRatio = resolveGameRenderPixelRatio(
      width,
      height,
      window.devicePixelRatio || 1,
      qualityProfile.pixelBudget,
    )
    if (rendererCssWidth === width && rendererCssHeight === height && rendererPixelRatio === pixelRatio) return false
    rendererCssWidth = width
    rendererCssHeight = height
    rendererPixelRatio = pixelRatio
    renderer.setPixelRatio(pixelRatio)
    renderer.setSize(width, height, false)
    cameraController.resize(width, height)
    return true
  }
  const scene = new THREE.Scene()
  scene.background = new THREE.Color(0x000000)
  const hemisphereLight = new THREE.HemisphereLight(0xd8f2f5, 0x34485b, 2.2)
  scene.add(hemisphereLight)
  const keyLight = new THREE.DirectionalLight(0xffe4ae, 2.4)
  keyLight.position.set(-18, 30, 14)
  keyLight.castShadow = true
  keyLight.shadow.mapSize.set(qualityProfile.shadowMapSize, qualityProfile.shadowMapSize)
  keyLight.shadow.bias = -0.00035
  keyLight.shadow.normalBias = 0.035
  keyLight.shadow.camera.left = -52
  keyLight.shadow.camera.right = 52
  keyLight.shadow.camera.top = 52
  keyLight.shadow.camera.bottom = -52
  keyLight.shadow.camera.near = 1
  keyLight.shadow.camera.far = 90
  scene.add(keyLight)
  const worldEnvironment = new HgssWorldEnvironmentLayer(scene, hemisphereLight, keyLight)
  const blackthornGymPlatforms = new BlackthornGymPlatformLayer(scene)
  const fuchsiaGymWalls = new FuchsiaGymWallLayer(scene)
  const viridianGymTiles = new ViridianGymTileLayer(scene)
  const violetGymElevator = new VioletGymElevatorLayer(scene)
  const ecruteakGymCandles = new EcruteakGymCandleLayer(scene)
  const fishingBiteEffects = new HgssFishingBiteEffectLayer(scene)
  const terrain = new THREE.Group()
  scene.add(terrain)
  const staticMapProps = new THREE.Group()
  scene.add(staticMapProps)
  const dynamicMapProps = new THREE.Group()
  scene.add(dynamicMapProps)
  const azaleaGymMapProps = new THREE.Group()
  scene.add(azaleaGymMapProps)
  const eventSprites = new THREE.Group()
  scene.add(eventSprites)
  const grassEffectLayer = new HgssGrassEffectLayer(scene, animationNow)
  const playerMaterial = createCutoutSpriteMaterial(null)
  const playerSprite = new THREE.Sprite(playerMaterial)
  playerSprite.center.set(0.5, 0)
  playerSprite.renderOrder = 10
  playerSprite.visible = false
  scene.add(playerSprite)
  const actorTerrainPresentation = new ActorTerrainPresentationLayer(scene)
  const actorIdlePresentation = new HgssActorIdlePresentation()
  const followerMaterial = createCutoutSpriteMaterial(null)
  const followerSprite = new THREE.Sprite(followerMaterial)
  followerSprite.center.set(0.5, 0)
  followerSprite.visible = false
  scene.add(followerSprite)
  const followerEmoteMaterial = createCutoutSpriteMaterial(null)
  const followerEmoteSprite = new THREE.Sprite(followerEmoteMaterial)
  followerEmoteSprite.center.set(0.5, 0.5)
  followerEmoteSprite.visible = false
  scene.add(followerEmoteSprite)
  let activeLayout: SceneLayout | undefined
  let activeMap: OpeningMapPreview | undefined
  let activeMapMatrixChunkWindow = ''
  let playerTexture: THREE.DataTexture | undefined
  let playerTexturePreview: NitroTexturePreview | undefined
  let playerFrameTextures: THREE.DataTexture[] = []
  let playerRuntimeTextures: PlayerRuntimeTextures | undefined
  let playerFramePreviews: PlayerTextureFrames | undefined
  let playerDirection: PlayerDirection = 'south'
  let playerStartPosition = new THREE.Vector3()
  let playerTargetPosition = new THREE.Vector3()
  let playerMoveStartTime = 0
  let playerMoveDurationMs = walkDurationFrames * hgssVBlankDurationMs
  let playerMovementKind: PlayerMovementKind = 'walk'
  let playerMoving = false
  let hasPlayerPosition = false
  let followerTextureResource: PokemonFollowerTextures | undefined
  let followerTextures: THREE.DataTexture[] = []
  let followerTexturesById = new Map<string, THREE.DataTexture>()
  let followerDirection: PlayerDirection = 'south'
  let followerAnimationStartedAt = 0
  let followerStartPosition = new THREE.Vector3()
  let followerTargetPosition = new THREE.Vector3()
  let followerMoveStartTime = 0
  let followerMoveDurationMs = walkDurationFrames * hgssVBlankDurationMs
  let followerMoving = false
  let followerReactionMotion: FollowerReactionMotionRuntime | undefined
  let followerEmote: FollowerEmoteRuntime | undefined
  let hasFollowerPosition = false
  let activeSceneAnimation: ((now: number) => void) | undefined
  let activeSceneDispose: (() => void) | undefined
  let activeStaticMapPropAnimations: Array<(now: number) => void> = []
  let activeDynamicMapPropAnimations: Array<(now: number) => void> = []
  let activeStaticMapPropDisposers: Array<() => void> = []
  const mapPropAnimationPlayback = new MapPropAnimationPlayback<StaticMapPropRuntime, NitroModelPreview, Float32Array[]>({
    applyFrame: applyMapPropFrame,
    captureTransition: captureMapPropPositions,
    applyTransition: applyNitroMapPropTransition,
    minimumDurationMs: hgssVBlankDurationMs,
  })
  const managedMapPropAnimations = new MapPropAnimationController<StaticMapPropRuntime>()
  const oneShotMapPropAnimations = new MapPropOneShotAnimationController<StaticMapPropRuntime, NitroModelPreview>()
  let azaleaGymCarts: AzaleaGymCartRuntime[] = []
  let activeAzaleaGymRide: AzaleaGymRideRuntime | undefined
  let staticMapPropRuntime = new WeakMap<NitroMapPropPreview, StaticMapPropRuntime>()
  let activeMapPropDisposers: (() => void)[] = []
  let eventRuntimeSprites: EventRuntimeSprite[] = []
  let activeFieldTextureAnimations: Record<string, NitroTextureAnimationPreview> | undefined
  let activeTextureAnimationEpochMs = 0
  let activeEventTexturePreviews: Record<number, NitroTexturePreview> | undefined
  let activeEventTextureFrames: Record<number, PlayerTextureFrames> | undefined
  let activeEventTextureResolver: RomInventory['eventTextureResolver'] | undefined
  const actorMotions = new Map<number, ActorMotion>()
  const playerTransitionMotion = new MapPlayerTransitionMotion(playerSprite, animationNow, () => Boolean(activeMap && hasPlayerPosition), () => playerMoving || actorMotions.has(255) || Boolean(activeAzaleaGymRide), () => Boolean(activeMap && usesWorldMatrixCoordinates(activeMap)))
  const fieldMoveEffects = new HgssFieldMoveEffectLayer(scene, cameraController, () => ({ map: activeMap, player: hasPlayerPosition ? { position: playerSprite.position, direction: playerDirection } : undefined, follower: hasFollowerPosition ? { position: followerSprite.position, direction: followerDirection } : undefined }), animationNow)
  const setActorGrassEffect = (actorKey: string, tileX: number, tileZ: number, animate: boolean, referenceGroundHeight?: number, actorVisible = true): void => {
    grassEffectLayer.setActor(actorKey, tileX, tileZ, {
      animate,
      referenceGroundHeight,
      actorVisible,
    })
  }
  const dynamicPokemonActors = new DynamicPokemonActorLayer(scene, () => activeMap && activeLayout ? { map: activeMap, layout: activeLayout } : undefined, actorIdlePresentation, actorTerrainPresentation, animationNow, { setActor: (key, tileX, tileY, groundHeight, visible) => setActorGrassEffect(key, tileX, tileY, false, groundHeight, visible), removeActor: (key) => grassEffectLayer.removeActor(key) })
  const hasPlayerTexture = (): boolean => Boolean(playerTexturePreview || playerFramePreviews)
  const disposeTerrain = (): void => {
    activeSceneAnimation = undefined
    activeSceneDispose?.()
    activeSceneDispose = undefined
    terrain.clear()
    activeMapMatrixChunkWindow = ''
  }
  const updateMapMatrixChunkVisibility = (): void => {
    if (!activeMap || !usesWorldMatrixCoordinates(activeMap)) return
    const visibleCellIndices = new Set(getMapMatrixRenderableCellIndices(
      activeMap.id,
      activeMap.matrix,
    ))
    const windowKey = [...visibleCellIndices].sort((left, right) => left - right).join(':')
    if (windowKey === activeMapMatrixChunkWindow) return
    activeMapMatrixChunkWindow = windowKey
    terrain.traverse((object) => {
      const cellIndex = object.userData.mapMatrixCellIndex
      if (typeof cellIndex === 'number') object.visible = visibleCellIndices.has(cellIndex)
    })
    for (const object of staticMapProps.children) {
      const cellIndex = object.userData.mapMatrixCellIndex
      if (typeof cellIndex === 'number') object.visible = visibleCellIndices.has(cellIndex)
    }
  }
  const disposeMapProps = (): void => {
    activeDynamicMapPropAnimations = []
    for (const dispose of activeMapPropDisposers) dispose()
    activeMapPropDisposers = []
    dynamicMapProps.clear()
  }

  const disposeStaticMapProps = (): void => {
    mapPropAnimationPlayback.clear()
    oneShotMapPropAnimations.clear((entry) => applyMapPropFrame(entry, entry.baseModel))
    managedMapPropAnimations.clear()
    activeStaticMapPropAnimations = []
    for (const dispose of activeStaticMapPropDisposers) dispose()
    activeStaticMapPropDisposers = []
    staticMapPropRuntime = new WeakMap()
    staticMapProps.clear()
  }

  const disposeAzaleaGymMechanism = (): void => {
    activeAzaleaGymRide?.resolve()
    activeAzaleaGymRide = undefined
    for (const cart of azaleaGymCarts) cart.dispose()
    azaleaGymCarts = []
    azaleaGymMapProps.clear()
  }
  const disposePlayerFrameTextures = (): void => {
    for (const texture of playerFrameTextures) texture.dispose()
    playerFrameTextures = []
    playerRuntimeTextures = undefined
    playerFramePreviews = undefined
  }
  const disposeEventSprite = (entry: EventRuntimeSprite): void => {
    eventSprites.remove(entry.sprite)
    if (entry.apricornFruit) {
      eventSprites.remove(entry.apricornFruit.sprite)
      entry.apricornFruit.material.dispose()
      entry.apricornFruit.texture.dispose()
    }
    actorIdlePresentation.unregister(entry.sprite)
    actorTerrainPresentation.unregister(entry.sprite)
    for (const texture of entry.textures) texture.dispose()
    entry.material.dispose()
  }
  const disposeEventSprites = (): void => {
    for (const motion of actorMotions.values()) motion.resolve()
    for (const entry of eventRuntimeSprites) disposeEventSprite(entry)
    eventRuntimeSprites = []
    actorMotions.clear()
    eventSprites.clear()
  }
  const resolveActorMotion = (objectId: number): void => {
    const motion = actorMotions.get(objectId)
    if (!motion) return
    actorMotions.delete(objectId)
    motion.resolve()
  }
  const buildPlayerTexture = (texture: NitroTexturePreview): THREE.DataTexture => {
    const dataTexture = createNitroDataTexture(texture, true)
    dataTexture.wrapS = THREE.ClampToEdgeWrapping
    dataTexture.wrapT = THREE.ClampToEdgeWrapping
    playerFrameTextures.push(dataTexture)
    return dataTexture
  }
  const applySpriteScale = (sprite: THREE.Sprite, texturePreview: NitroTexturePreview): void => {
    actorIdlePresentation.setRomFrame(sprite, texturePreview, activeMap && usesWorldMatrixCoordinates(activeMap) ? 1.55 : 32)
  }

  const getSpriteRenderOrder = (positionZ: number): number => getActorSpriteRenderOrder(activeMap, positionZ)

  const updateSpriteRenderOrder = (now = animationNow()): void => {
    playerSprite.renderOrder = getSpriteRenderOrder(playerSprite.position.z)
    const playerTile = worldPositionToTile(playerSprite.position)
    actorTerrainPresentation.sync(playerSprite, activeMap, playerTile.x, playerTile.z, 'player', playerSprite.renderOrder, now)
    followerSprite.renderOrder = getSpriteRenderOrder(followerSprite.position.z)
    const followerTile = worldPositionToTile(followerSprite.position)
    actorTerrainPresentation.sync(followerSprite, activeMap, followerTile.x, followerTile.z, 'follower', followerSprite.renderOrder, now)
    followerEmoteSprite.renderOrder = getSpriteRenderOrder(followerEmoteSprite.position.z) + 1
    for (const entry of eventRuntimeSprites) {
      entry.sprite.renderOrder = getSpriteRenderOrder(entry.sprite.position.z)
      if (entry.apricornFruit) entry.apricornFruit.sprite.renderOrder = entry.sprite.renderOrder + 1
      actorTerrainPresentation.sync(entry.sprite, activeMap, entry.tileX, entry.tileZ, 'event', entry.sprite.renderOrder, now)
    }
  }

  const applyPlayerFrame = (texturePreview: NitroTexturePreview | undefined, dataTexture: THREE.DataTexture | undefined): void => {
    playerTexturePreview = texturePreview
    playerMaterial.map = dataTexture ?? null
    playerMaterial.needsUpdate = true
    playerSprite.visible = Boolean(texturePreview && activeMap)
    if (!texturePreview) return
    applySpriteScale(playerSprite, texturePreview)
  }

  const applyDirectionalPlayerFrame = (now = animationNow(), moving = playerMoving): void => {
    if (!playerRuntimeTextures || !playerFramePreviews) {
      applyPlayerFrame(playerTexturePreview, playerTexture)
      return
    }
    const runningPreviews = playerMovementKind === 'run' ? playerFramePreviews.running?.[playerDirection] : undefined
    const runningTextures = playerMovementKind === 'run' ? playerRuntimeTextures.running?.[playerDirection] : undefined
    const animateStride = moving && playerMovementKind !== 'ice-slide' && playerMovementKind !== 'forced-slide'
    const previews = animateStride
      ? runningPreviews ?? playerFramePreviews.walking[playerDirection]
      : [playerFramePreviews.standing[playerDirection]]
    const textures = animateStride
      ? runningTextures ?? playerRuntimeTextures.walking[playerDirection]
      : [playerRuntimeTextures.standing[playerDirection]]
    const frameIndex = animateStride ? sampleHgssActorSpriteFrame(now, playerMoveStartTime, textures.length, playerMoveDurationMs) : 0
    applyPlayerFrame(previews[frameIndex] ?? previews[0], textures[frameIndex] ?? textures[0])
  }

  const applyEventFrame = (entry: EventRuntimeSprite, moving: boolean, now = animationNow(), cycleDurationMs?: number): void => {
    if (!entry.frames || !entry.runtimeFrames) return
    const previews = moving ? entry.frames.walking[entry.direction] : [entry.frames.standing[entry.direction]]
    const textures = moving ? entry.runtimeFrames.walking[entry.direction] : [entry.runtimeFrames.standing[entry.direction]]
    const frameIndex = moving ? sampleHgssActorSpriteFrame(now, entry.animationStartedAt, textures.length, cycleDurationMs ?? hgssVBlanksToMilliseconds(walkDurationFrames)) : 0
    entry.material.map = textures[frameIndex] ?? textures[0]
    entry.material.needsUpdate = true
    const preview = previews[frameIndex] ?? previews[0]
    if (preview) applySpriteScale(entry.sprite, preview)
  }

  const updatePlayerMotion = (now = animationNow()): void => {
    if (!playerMoving) return
    const progress = THREE.MathUtils.clamp((now - playerMoveStartTime) / playerMoveDurationMs, 0, 1)
    // Le moteur DS avance d'une quantite fixe a chaque VBlank. Un easing par
    // tuile provoque un arret visible entre chaque pas lorsque la touche reste
    // enfoncee.
    playerSprite.position.lerpVectors(playerStartPosition, playerTargetPosition, progress)
    if (playerMovementKind === 'ledge-jump') {
      const tileHeight = activeMap && usesWorldMatrixCoordinates(activeMap) ? 0.52 : 8
      playerSprite.position.y += Math.sin(progress * Math.PI) * tileHeight
    }
    if (progress >= 1) {
      playerMoving = false
      playerSprite.position.copy(playerTargetPosition)
    }
    applyDirectionalPlayerFrame(now)
    updateMapMatrixChunkVisibility()
    cameraController.follow(playerSprite.position)
  }

  const resolveEventSpriteId = (object: MapObjectEvent, state: FieldScriptState): number | undefined => {
    if (object.spriteId < 101 || object.spriteId > 117) return object.spriteId
    const variableId = 0x4020 + object.spriteId - 101
    return state.variables.has(variableId) ? resolveObjectSpriteId(object.spriteId, state) : undefined
  }

  const createEventSprite = (map: OpeningMapPreview, object: MapObjectEvent, state: FieldScriptState): EventRuntimeSprite | undefined => {
    const origin = getMapOrigin(map)
    const visible = (object.eventFlag === 0 || !state.flags.has(object.eventFlag))
      && !state.hiddenObjectIds.has(object.id)
      && !state.invisibleObjectIds.has(object.id)
    const spriteId = resolveEventSpriteId(object, state)
    // Les sprites variables sont initialises par le script de chargement de
    // carte. Le gestionnaire natif ne cree l'objet qu'apres cette commande.
    if (spriteId === undefined) return undefined
    const resolvedResource = activeEventTextureResolver?.(spriteId)
    const texturePreview = activeEventTexturePreviews?.[spriteId] ?? resolvedResource?.preview
    if (!texturePreview) {
      if (visible) throw new Error(`La texture ROM du PNJ ${object.id}, sprite ${spriteId}, est absente.`)
      return undefined
    }
    const binding = createEventSpriteResource(texturePreview, activeEventTextureFrames?.[spriteId] ?? resolvedResource?.frames)
    const material = createCutoutSpriteMaterial(binding.primaryTexture, resolveActorSpriteDepthMode(map))
    const sprite = new THREE.Sprite(material)
    const actor = state.objects.get(object.id)
    const tileX = (actor?.x ?? object.x) - origin.x
    const tileZ = (actor?.z ?? object.z) - origin.z
    const direction = actor?.direction ?? playerDirections[object.facingDirection] ?? 'south'
    sprite.center.set(0.5, 0)
    sprite.visible = visible
    sprite.position.copy(projectMapPosition(activeLayout, map, tileX, tileZ, 0.08))
    applySpriteScale(sprite, texturePreview)
    eventSprites.add(sprite)
    const entry: EventRuntimeSprite = { id: object.id, resolvedSpriteId: spriteId, eventFlag: object.eventFlag, sprite, material, textures: binding.textures, frames: binding.frames, runtimeFrames: binding.runtimeFrames, direction, tileX, tileZ, movementHidden: false, animationStartedAt: animationNow() }
    const treeIndex = object.spriteId >= 262 && object.spriteId <= 269 ? object.parameters?.[0] : undefined
    const apricornType = treeIndex === undefined ? undefined : resolveHgssApricornType(treeIndex)
    const fruitResource = apricornType === undefined ? undefined : activeEventTextureResolver?.(270 + apricornType)
    if (treeIndex !== undefined && fruitResource?.preview) {
      const fruitTexture = createNitroDataTexture(fruitResource.preview, true)
      const fruitMaterial = createCutoutSpriteMaterial(fruitTexture, resolveActorSpriteDepthMode(map))
      const fruitSprite = new THREE.Sprite(fruitMaterial)
      fruitSprite.center.set(0.5, 0)
      fruitSprite.position.copy(sprite.position)
      fruitSprite.position.y += usesWorldMatrixCoordinates(map) ? 1.15 : 18.4
      fruitSprite.visible = visible && !state.harvestedApricornTrees.has(treeIndex)
      fruitSprite.renderOrder = sprite.renderOrder + 1
      applySpriteScale(fruitSprite, fruitResource.preview)
      eventSprites.add(fruitSprite)
      entry.apricornFruit = { sprite: fruitSprite, material: fruitMaterial, texture: fruitTexture, treeIndex }
    }
    eventRuntimeSprites.push(entry)
    setActorGrassEffect(`actor:${object.id}`, tileX, tileZ, false, sprite.position.y - 0.08, visible)
    applyEventFrame(entry, false)
    return entry
  }
  const loadEventSprites = (map: OpeningMapPreview, state: FieldScriptState, eventTexturePreviews: Record<number, NitroTexturePreview> | undefined, eventTextureFrames: Record<number, PlayerTextureFrames> | undefined, eventTextureResolver: RomInventory['eventTextureResolver'] | undefined): void => {
    disposeEventSprites()
    activeEventTexturePreviews = eventTexturePreviews
    activeEventTextureFrames = eventTextureFrames
    activeEventTextureResolver = eventTextureResolver
    for (const object of map.events?.objects ?? []) createEventSprite(map, object, state)
    updateSpriteRenderOrder()
  }
  const syncDaycareObjects = (objects: Array<{ objectId: 250 | 251, tileX: number, tileZ: number, resource: PokemonFollowerTextures }>): void => {
    for (const entry of eventRuntimeSprites.filter((candidate) => candidate.id === 250 || candidate.id === 251)) {
      grassEffectLayer.removeActor(`actor:${entry.id}`)
      disposeEventSprite(entry)
    }
    eventRuntimeSprites = eventRuntimeSprites.filter((candidate) => candidate.id !== 250 && candidate.id !== 251)
    if (!activeMap || !activeLayout) return
    for (const object of objects) {
      const textures: THREE.DataTexture[] = []
      const buildTexture = (preview: NitroTexturePreview): THREE.DataTexture => {
        const texture = createNitroDataTexture(preview, true)
        texture.wrapS = THREE.ClampToEdgeWrapping
        texture.wrapT = THREE.ClampToEdgeWrapping
        textures.push(texture)
        return texture
      }
      const standing = {} as Record<PlayerDirection, THREE.DataTexture>
      const walking = {} as Record<PlayerDirection, THREE.DataTexture[]>
      for (const direction of playerDirections) {
        const frames = object.resource.animationFrames[direction]
        walking[direction] = (frames.length > 0 ? frames : [object.resource.preview]).map(buildTexture)
        standing[direction] = walking[direction][0]!
      }
      const material = createCutoutSpriteMaterial(standing.south, resolveActorSpriteDepthMode(activeMap))
      const sprite = new THREE.Sprite(material)
      sprite.center.set(0.5, 0)
      sprite.position.copy(projectMapPosition(activeLayout, activeMap, object.tileX, object.tileZ, 0.08))
      applySpriteScale(sprite, object.resource.preview)
      eventSprites.add(sprite)
      const entry: EventRuntimeSprite = {
        id: object.objectId,
        resolvedSpriteId: 0x10000 + object.objectId,
        eventFlag: 0,
        sprite,
        material,
        textures,
        runtimeFrames: { standing, walking },
        direction: 'south',
        tileX: object.tileX,
        tileZ: object.tileZ,
        movementHidden: false,
        animationStartedAt: animationNow(),
      }
      eventRuntimeSprites.push(entry)
      setActorGrassEffect(`actor:${object.objectId}`, object.tileX, object.tileZ, false, sprite.position.y - 0.08)
      applyEventFrame(entry, false)
    }
    updateSpriteRenderOrder()
  }

  const registerManagedMapPropAnimations = (
    entry: StaticMapPropRuntime,
    modelId: number,
    areaDataBank: number,
    domain: 'field' | 'room',
    animationResolver?: RomInventory['mapPropAnimationResolver'],
    metadataResolver?: RomInventory['mapPropAnimationMetadataResolver'],
    startedAt = animationNow(),
  ): void => {
    const metadata = metadataResolver?.(modelId, domain, areaDataBank)
    if (!metadata?.hasAnimations || !animationResolver) return
    const tracks = metadata.animationArchiveIds.map((archiveId) => animationResolver(modelId, areaDataBank, archiveId, domain)?.frames)
    if (tracks.some((track) => !track?.length)) return
    managedMapPropAnimations.register(entry, entry.baseModel, metadata, tracks as NonNullable<(typeof tracks)[number]>[], startedAt)
  }

  const loadMap = (
    map: OpeningMapPreview,
    state: FieldScriptState,
    resources: MapSceneResources = {},
  ): void => {
    const {
      eventTexturePreviews,
      eventTextureFrames,
      fieldTextureAnimations,
      fieldCameraParams,
      eventTextureResolver,
      mapPropModelResolver,
      grassEffectResolver,
      mapPropAnimationResolver,
      mapPropAnimationMetadataResolver,
    } = resources
    // Construire et valider la scène destination avant de libérer la scène
    // courante rend le changement atomique. Une erreur de décodage ne laisse
    // plus le renderer avec un groupe vide (le flash noir observé aux bords).
    const textureAnimationEpochMs = animationNow()
    const sceneMesh = buildSceneMesh(map, fieldTextureAnimations, { textureAnimationEpochMs })
    if (!sceneMesh) throw new Error(`La scene ROM de la carte ${map.id} est absente ou non affichable.`)
    if (!sceneMesh.layout) {
      sceneMesh.dispose()
      throw new Error(`Les limites de la scene ROM de la carte ${map.id} sont invalides.`)
    }
    playerTransitionMotion.clear()
    disposeTerrain()
    disposeStaticMapProps()
    disposeMapProps()
    disposeAzaleaGymMechanism()
    blackthornGymPlatforms.clear()
    fuchsiaGymWalls.clear()
    viridianGymTiles.clear()
    violetGymElevator.clear()
    ecruteakGymCandles.clear()
    disposeEventSprites(); dynamicPokemonActors.clearDynamicPokemonActors()
    actorTerrainPresentation.clear()
    grassEffectLayer.clear(); fishingBiteEffects.clear(); fieldMoveEffects.clear()
    activeMap = map
    activeFieldTextureAnimations = fieldTextureAnimations
    activeTextureAnimationEpochMs = textureAnimationEpochMs
    scene.fog = null
    activeLayout = undefined
    playerMoving = false
    hasPlayerPosition = false
    followerMoving = false
    followerReactionMotion?.resolve()
    followerReactionMotion = undefined
    if (followerEmote) {
      for (const texture of followerEmote.textures) texture.dispose()
      followerEmote.resolve()
      followerEmote = undefined
    }
    followerEmoteSprite.visible = false
    hasFollowerPosition = false
    followerSprite.visible = false
    for (const material of [playerMaterial, followerMaterial, followerEmoteMaterial]) {
      setActorSpriteDepthMode(material, resolveActorSpriteDepthMode(map))
      material.fog = true
      material.needsUpdate = true
    }
    playerSprite.visible = hasPlayerTexture()

    activeLayout = sceneMesh.layout
    cameraController.setContext(map, sceneMesh.layout, fieldCameraParams)
    grassEffectLayer.setContext(map, sceneMesh.layout, grassEffectResolver)
    activeSceneAnimation = sceneMesh.animate
    activeSceneDispose = sceneMesh.dispose
    terrain.add(sceneMesh.object)
    if (mapPropModelResolver) {
      const worldCoordinates = usesWorldMatrixCoordinates(map)
      for (const prop of map.model?.mapProps ?? []) {
        const model = mapPropModelResolver(prop.modelId, map.header.areaDataBank, worldCoordinates ? 'field' : 'room')
        if (!model) continue
        const propMesh = buildSceneMesh({ ...map, model }, fieldTextureAnimations, { indoorDepthLayers: false, replaceLegacyPropShadows: true, textureAnimationEpochMs })
        if (!propMesh) continue
        if (prop.mapMatrixCellIndex !== undefined) propMesh.object.userData.mapMatrixCellIndex = prop.mapMatrixCellIndex
        propMesh.object.position.set(prop.position[0], prop.position[1], prop.position[2])
        const unitScale = worldCoordinates ? 1 / 16 : 1
        propMesh.object.scale.set(prop.scale[0] * unitScale, prop.scale[1] * unitScale, prop.scale[2] * unitScale)
        if (!worldCoordinates) {
          propMesh.object.traverse((child) => {
            if (child instanceof THREE.Mesh) child.renderOrder += Math.round(prop.position[2] * 100)
          })
        }
        staticMapProps.add(propMesh.object)
        const entry = createStaticMapPropRuntime(propMesh.object, model)
        staticMapPropRuntime.set(prop, entry)
        registerManagedMapPropAnimations(entry, prop.modelId, map.header.areaDataBank, worldCoordinates ? 'field' : 'room', mapPropAnimationResolver, mapPropAnimationMetadataResolver, textureAnimationEpochMs)
        if (propMesh.animate) activeStaticMapPropAnimations.push(propMesh.animate)
        activeStaticMapPropDisposers.push(() => {
          managedMapPropAnimations.unregister(entry)
          disposeMapPropFrameTextures(entry)
          propMesh.dispose()
        })
      }
    }
    updateMapMatrixChunkVisibility()
    loadEventSprites(map, state, eventTexturePreviews, eventTextureFrames, eventTextureResolver)
    applyDirectionalPlayerFrame()
  }

  const syncMapProps = (props: FieldMapProp[], resolver: RomInventory['mapPropModelResolver'], animationResolver?: RomInventory['mapPropAnimationResolver'], metadataResolver?: RomInventory['mapPropAnimationMetadataResolver']): void => {
    disposeMapProps()
    if (!activeMap || !resolver || props.length === 0) return
    if (!activeMap.terrain) throw new Error(`La carte ROM ${activeMap.id} ne contient aucun terrain pour placer ses MapProps.`)
    const domain = usesWorldMatrixCoordinates(activeMap) ? 'field' : 'room'
    for (const prop of props) {
      const model = resolver(prop.modelId, activeMap.header.areaDataBank, domain)
      if (!model) throw new Error(`Le modele MapProp ROM ${prop.modelId} est absent pour la carte ${activeMap.id}.`)
      const sceneMesh = buildSceneMesh({ ...activeMap, model }, activeFieldTextureAnimations, { indoorDepthLayers: false, replaceLegacyPropShadows: true, textureAnimationEpochMs: activeTextureAnimationEpochMs })
      if (!sceneMesh) throw new Error(`Le modele MapProp ROM ${prop.modelId} ne peut pas etre affiche.`)
      sceneMesh.object.position.set(
        prop.x - activeMap.terrain.width * 8,
        prop.y,
        prop.z - activeMap.terrain.height * 8,
      )
      if (!usesWorldMatrixCoordinates(activeMap)) {
        sceneMesh.object.traverse((child) => {
          if (child instanceof THREE.Mesh) child.renderOrder += Math.round(sceneMesh.object.position.z * 100)
        })
      }
      dynamicMapProps.add(sceneMesh.object)
      const entry = createStaticMapPropRuntime(sceneMesh.object, model)
      registerManagedMapPropAnimations(entry, prop.modelId, activeMap.header.areaDataBank, domain, animationResolver, metadataResolver)
      if (sceneMesh.animate) activeDynamicMapPropAnimations.push(sceneMesh.animate)
      activeMapPropDisposers.push(() => {
        managedMapPropAnimations.unregister(entry)
        disposeMapPropFrameTextures(entry)
        sceneMesh.dispose()
      })
    }
  }

  const setMapPropDeferredAnimations = (bindings: readonly { modelId: number, animationIndex: number }[]): void => {
    if (!activeMap) throw new Error('Aucune carte ROM active pour attacher les animations MapProp differees.')
    for (const { modelId, animationIndex } of bindings) {
      const entries = (activeMap.model?.mapProps ?? [])
        .filter((prop) => prop.modelId === modelId)
        .map((prop) => staticMapPropRuntime.get(prop))
        .filter((entry): entry is StaticMapPropRuntime => entry !== undefined)
      if (entries.length === 0) {
        throw new Error(`Le MapProp ROM ${modelId} a animer n'est pas charge sur la carte ${activeMap.id}.`)
      }
      for (const entry of entries) if (!managedMapPropAnimations.setDeferredTracks(entry, [animationIndex])) {
        throw new Error(`La piste differee ROM ${modelId}:${animationIndex} n'existe pas sur la carte ${activeMap.id}.`)
      }
    }
  }

  const loadMapPropOneShotAnimation = (
    tag: number,
    modelIds: readonly number[],
    animationCount: number,
    loopCount: number,
    reversed: boolean,
    animationResolver: RomInventory['mapPropAnimationResolver'],
    metadataResolver: RomInventory['mapPropAnimationMetadataResolver'],
  ): void => {
    if (!activeMap || !animationResolver || !metadataResolver) {
      throw new Error(`Le runtime MapProp ROM requis par le tag ${tag} est absent.`)
    }
    const prop = activeMap.model?.mapProps?.find((candidate) => modelIds.includes(candidate.modelId))
    const entry = prop ? staticMapPropRuntime.get(prop) : undefined
    if (!prop || !entry) {
      throw new Error(`Aucun MapProp ROM ${modelIds.join('/')} n'est charge pour le tag ${tag}.`)
    }
    const domain = usesWorldMatrixCoordinates(activeMap) ? 'field' : 'room'
    const metadata = metadataResolver(prop.modelId, domain, activeMap.header.areaDataBank)
    if (!metadata || resolveMapPropAnimationLoadMode(metadata) !== 'one-shot') {
      throw new Error(`Le MapProp ROM ${prop.modelId} du tag ${tag} n'est pas une animation one-shot.`)
    }
    const archiveIds = metadata.animationArchiveIds.slice(0, Math.max(1, Math.floor(animationCount)))
    if (archiveIds.length !== animationCount) {
      throw new Error(`Le MapProp ROM ${prop.modelId} ne fournit pas les ${animationCount} pistes du tag ${tag}.`)
    }
    const tracks = archiveIds.map((archiveId) => animationResolver(
      prop.modelId,
      activeMap!.header.areaDataBank,
      archiveId,
      domain,
    )?.frames)
    if (tracks.some((track) => !track?.length)) {
      throw new Error(`Une piste MapProp ROM du tag ${tag} est absente.`)
    }
    mapPropAnimationPlayback.releaseTargets(new Set([entry]))
    oneShotMapPropAnimations.load({
      tag,
      modelId: prop.modelId,
      targets: [entry],
      tracks: tracks as NitroModelPreview[][],
      loopCount,
      reversed,
    })
  }

  const playMapPropOneShotAnimation = (tag: number, animationIndex: number): void => {
    oneShotMapPropAnimations.play(tag, animationIndex, animationNow())
  }

  const waitMapPropOneShotAnimation = (tag: number): Promise<void> => oneShotMapPropAnimations.wait(tag)

  const unloadMapPropOneShotAnimation = (tag: number): void => {
    oneShotMapPropAnimations.unload(tag, (entry) => applyMapPropFrame(entry, entry.baseModel))
  }

  const setPlayerTexture = (texture: NitroTexturePreview | undefined): void => {
    playerTexture?.dispose()
    disposePlayerFrameTextures()
    playerTexture = texture ? createNitroDataTexture(texture, true) : undefined
    if (playerTexture) {
      playerTexture.wrapS = THREE.ClampToEdgeWrapping
      playerTexture.wrapT = THREE.ClampToEdgeWrapping
    }
    applyPlayerFrame(texture, playerTexture)
  }

  const setPlayerTextureFrames = (frames: PlayerTextureFrames | undefined): void => {
    playerTexture?.dispose()
    playerTexture = undefined
    disposePlayerFrameTextures()
    if (!frames) {
      applyPlayerFrame(undefined, undefined)
      return
    }
    const standing = {} as Record<PlayerDirection, THREE.DataTexture>
    const walking = {} as Record<PlayerDirection, THREE.DataTexture[]>
    const running = frames.running ? {} as Record<PlayerDirection, THREE.DataTexture[]> : undefined
    for (const direction of playerDirections) {
      standing[direction] = buildPlayerTexture(frames.standing[direction])
      walking[direction] = frames.walking[direction].map((frame) => buildPlayerTexture(frame))
      if (running && frames.running) running[direction] = frames.running[direction].map((frame) => buildPlayerTexture(frame))
    }
    playerFramePreviews = frames
    playerRuntimeTextures = { standing, walking, running }
    applyDirectionalPlayerFrame()
  }
  const setPlayerDirection = (direction: PlayerDirection): void => {
    playerDirection = direction
    if (!playerMoving) applyDirectionalPlayerFrame()
  }
  const setPlayerLocomotion = (locomotion: PlayerLocomotionMode): void => { actorTerrainPresentation.setPlayerLocomotion(locomotion); updateSpriteRenderOrder() }

  const setCameraTarget = (tileX?: number, tileZ?: number): void => {
    cameraController.setTileTarget(tileX, tileZ)
    cameraController.follow(playerSprite.position)
  }

  const setPlayerPosition = (tileX: number, tileZ: number, direction = playerDirection, animate = false, groundHeight?: number, durationFrames = walkDurationFrames, movement: PlayerMovementKind = 'walk'): string => {
    playerTransitionMotion.clear()
    playerDirection = direction
    const referenceGroundHeight = groundHeight ?? (hasPlayerPosition ? playerSprite.position.y - 0.08 : undefined)
    const playerPosition = projectMapPosition(activeLayout, activeMap, tileX, tileZ, 0.08, referenceGroundHeight)
    setActorGrassEffect('player', tileX, tileZ, animate && hasPlayerPosition, playerPosition.y - 0.08)
    if (animate && hasPlayerPosition) {
      playerStartPosition = playerSprite.position.clone()
      playerTargetPosition = playerPosition
      playerMoveStartTime = animationNow()
      playerMoveDurationMs = Math.max(1, durationFrames) * hgssVBlankDurationMs
      playerMovementKind = movement
      playerMoving = true
    } else {
      playerMoving = false
      playerSprite.position.copy(playerPosition)
      playerTargetPosition = playerPosition
    }
    hasPlayerPosition = true
    updateMapMatrixChunkVisibility()
    playerSprite.visible = Boolean(hasPlayerTexture() && activeMap)
    applyDirectionalPlayerFrame()
    updateSpriteRenderOrder()
    cameraController.follow(playerSprite.position)
    return `${activeMap?.label ?? 'Carte'} - ${tileX}, ${tileZ}`
  }

  const playPlayerTransitionMotion = (motion: PlayerTransitionMotion): Promise<void> => playerTransitionMotion.play(motion)

  const setFollowerTexture = (resource: PokemonFollowerTextures | undefined): void => {
    if (resource === followerTextureResource) return
    for (const texture of followerTextures) texture.dispose()
    followerTextures = []
    followerTexturesById = new Map()
    followerTextureResource = resource
    if (!resource) {
      followerMaterial.map = null
      followerMaterial.needsUpdate = true
      followerSprite.visible = false
      return
    }
    followerTextures = resource.textures.map((preview) => createNitroDataTexture(preview, true))
    followerTexturesById = new Map(resource.textures.map((preview, index) => [preview.id, followerTextures[index]!]))
    followerAnimationStartedAt = animationNow()
    applyFollowerFrame(followerAnimationStartedAt)
    followerSprite.visible = hasFollowerPosition
  }

  const applyFollowerFrame = (now: number, animatedOverride?: boolean, cycleDurationMs = followerMoveDurationMs): void => {
    const frames = followerTextureResource?.animationFrames[followerDirection]
    if (!followerTextureResource || !frames || frames.length === 0) return
    const animated = animatedOverride ?? (
      followerMoving
      || followerReactionMotion !== undefined
      || actorMotions.has(hgssFollowerObjectId)
    )
    const frameIndex = animated
      ? sampleHgssActorSpriteFrame(now, followerAnimationStartedAt, frames.length, cycleDurationMs)
      : 0
    const preview = frames[frameIndex] ?? frames[0]!
    const texture = followerTexturesById.get(preview.id)
    if (!texture) throw new Error(`La texture d'animation follower ROM ${preview.name} est absente du runtime.`)
    if (followerMaterial.map !== texture) {
      followerMaterial.map = texture
      followerMaterial.needsUpdate = true
      applySpriteScale(followerSprite, preview)
    }
  }

  const setFollowerPosition = (follower: FollowerWorldState | undefined, animate = false, durationFrames = walkDurationFrames): void => {
    resolveActorMotion(hgssFollowerObjectId)
    followerReactionMotion?.resolve()
    followerReactionMotion = undefined
    if (!follower || !activeMap || follower.map.id !== activeMap.id) {
      grassEffectLayer.removeActor('follower')
      followerMoving = false
      hasFollowerPosition = false
      followerSprite.visible = false
      return
    }
    if (follower.direction !== followerDirection) {
      followerDirection = follower.direction
      followerAnimationStartedAt = animationNow()
    }
    const position = projectMapPosition(activeLayout, activeMap, follower.tileX, follower.tileZ, 0.08, follower.groundHeight)
    setActorGrassEffect('follower', follower.tileX, follower.tileZ, animate && hasFollowerPosition, position.y - 0.08)
    if (animate && hasFollowerPosition) {
      followerStartPosition = followerSprite.position.clone()
      followerTargetPosition = position
      const startedAt = animationNow()
      followerMoveStartTime = startedAt
      followerAnimationStartedAt = startedAt
      followerMoveDurationMs = Math.max(1, durationFrames) * hgssVBlankDurationMs
      followerMoving = true
    } else {
      followerMoving = false
      followerSprite.position.copy(position)
      followerTargetPosition = position
    }
    hasFollowerPosition = true
    followerSprite.visible = Boolean(followerTextureResource)
    applyFollowerFrame(animationNow())
    updateSpriteRenderOrder()
  }

  const setFollowerMovementPaused = (paused: boolean): void => {
    void paused
  }

  const getFollowerMapObjectSignal = () => ({ present: hasFollowerPosition, visible: followerSprite.visible })

  const applyFollowerMovement = (follower: FollowerWorldState, movement: FollowerScriptMovement): void => {
    if (!activeMap || follower.map.id !== activeMap.id || !hasFollowerPosition) {
      throw new Error(`Le comportement follower scripté ne peut pas être appliqué hors de sa carte active.`)
    }
    if (follower.movement !== movement.movementId) {
      throw new Error(`Le comportement follower ROM ${movement.movementId} n'a pas ete conserve dans l'etat monde.`)
    }
  }

  const playFollowerReactionMotion = (
    motion: HgssFollowerReactionMotion,
    ignoreHeightAdjustment = false,
    onStepSound?: (segmentIndex: number) => void,
  ): Promise<void> => {
    if (!activeMap || !hasFollowerPosition || followerMoving) {
      return Promise.reject(new Error(`Le mouvement de réaction follower ROM ${motion.movementId} ne peut pas démarrer maintenant.`))
    }
    followerReactionMotion?.resolve()
    followerReactionMotion = undefined
    if (motion.segments.length === 0) return Promise.resolve()
    const reactionMap = activeMap
    return new Promise((resolve) => {
      followerReactionMotion = {
        motion,
        start: followerSprite.position.clone(),
        originalDirection: followerDirection,
        // Les coordonnées MapObject HGSS utilisent 16 unités par case.
        unitScale: (usesWorldMatrixCoordinates(reactionMap) ? 1 : 16) / 16,
        ignoreHeightAdjustment,
        startedAt: animationNow(),
        nextSoundSegment: 0,
        onStepSound,
        resolve,
      }
    })
  }

  const playFollowerEmote = (emote: HgssFollowerEmote, onStart?: (soundId: number) => void): Promise<void> => {
    if (!activeMap || !hasFollowerPosition || followerEmote) {
      return Promise.reject(new Error(`L’emote follower ROM ${emote.emoteId} ne peut pas démarrer maintenant.`))
    }
    const textures = emote.textures.map((preview) => createNitroDataTexture(preview, true))
    if (textures.length === 0) return Promise.reject(new Error(`L’emote follower ROM ${emote.emoteId} ne contient aucune texture.`))
    setActorSpriteDepthMode(followerEmoteMaterial, resolveActorSpriteDepthMode(activeMap))
    followerEmoteMaterial.map = textures[emote.timeline.textureIndexes[0] ?? 0] ?? textures[0]!
    followerEmoteMaterial.needsUpdate = true
    followerEmoteSprite.visible = true
    onStart?.(emote.soundId)
    return new Promise((resolve) => {
      followerEmote = { emote, textures, startedAt: animationNow(), resolve }
    })
  }
  const resolveFishingBiteAnchor = (target: HgssFishingBiteEffectTarget): THREE.Vector3 | undefined => target === 'player' ? (hasPlayerPosition ? playerSprite.position : undefined) : (hasFollowerPosition ? followerSprite.position : undefined)
  const startFishingBiteEffect = (target: HgssFishingBiteEffectTarget, effect: HgssFishingBiteEffectAsset): void => { const anchor = resolveFishingBiteAnchor(target); if (!activeMap || !anchor) throw new Error(`La touche de peche ROM ne peut pas suivre l'acteur ${target} sur la carte active.`); fishingBiteEffects.start(activeMap, effect, target, anchor, animationNow()) }
  const stopFishingBiteEffect = (target?: HgssFishingBiteEffectTarget): void => fishingBiteEffects.stop(target)

  const updateFollowerEmote = (now: number): void => {
    if (!followerEmote || !activeMap) return
    const active = followerEmote
    const elapsedFrames = Math.max(0, Math.floor((now - active.startedAt) / hgssVBlankDurationMs))
    const sample = sampleHgssFollowerEmote(active.emote, elapsedFrames)
    if (sample.complete) {
      followerEmoteSprite.visible = false
      followerEmoteMaterial.map = null
      followerEmoteMaterial.needsUpdate = true
      for (const texture of active.textures) texture.dispose()
      followerEmote = undefined
      active.resolve()
      return
    }
    const texture = active.textures[sample.textureIndex]
    const preview = active.emote.textures[sample.textureIndex]
    if (!texture || !preview) throw new Error(`La texture ${sample.textureIndex} de l’emote follower ROM ${active.emote.emoteId} est absente.`)
    if (followerEmoteMaterial.map !== texture) {
      followerEmoteMaterial.map = texture
      followerEmoteMaterial.needsUpdate = true
    }
    const tileSize = usesWorldMatrixCoordinates(activeMap) ? 1 : 16
    const unitScale = tileSize / 16
    const forward = {
      north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
    }[followerDirection]!
    followerEmoteSprite.position.copy(followerSprite.position)
    followerEmoteSprite.position.x += forward[0] * tileSize
    followerEmoteSprite.position.y += 2 * tileSize + sample.heightUnits * unitScale
    followerEmoteSprite.position.z += forward[1] * tileSize + unitScale
    const spriteHeight = tileSize
    followerEmoteSprite.scale.set(spriteHeight * preview.width / Math.max(1, preview.height), spriteHeight, 1)
  }

  const refreshFollower = (): void => {
    followerAnimationStartedAt = animationNow()
    applyFollowerFrame(followerAnimationStartedAt)
    followerSprite.visible = hasFollowerPosition && Boolean(followerTextureResource)
  }

  const updateFollowerMotion = (now: number): void => {
    if (!followerMoving && !followerReactionMotion) return
    applyFollowerFrame(now, undefined, followerReactionMotion ? walkDurationFrames * hgssVBlankDurationMs : followerMoveDurationMs)
    if (followerReactionMotion) {
      const runtime = followerReactionMotion
      const elapsedFrames = Math.max(0, Math.floor((now - runtime.startedAt) / hgssVBlankDurationMs))
      let segmentStartFrame = 0
      for (let index = 0; index < runtime.motion.segments.length; index += 1) {
        if (index >= runtime.nextSoundSegment && segmentStartFrame <= elapsedFrames) {
          if (runtime.motion.segments[index]!.triggerStepSound) runtime.onStepSound?.(index)
          runtime.nextSoundSegment = index + 1
        }
        segmentStartFrame += Math.max(1, runtime.motion.segments[index]!.durationFrames)
      }
      const sample = sampleHgssFollowerReactionMotion(runtime.motion, elapsedFrames)
      if (sample.complete) {
        followerSprite.position.copy(runtime.start)
        followerDirection = runtime.originalDirection
        followerAnimationStartedAt = now
        followerReactionMotion = undefined
        applyFollowerFrame(now)
        runtime.resolve()
        return
      }
      followerSprite.position.copy(runtime.start)
      followerSprite.position.x += sample.offsetX * runtime.unitScale
      followerSprite.position.y += (runtime.ignoreHeightAdjustment ? 0 : sample.heightAdjustment) * runtime.unitScale
      followerSprite.position.z += sample.offsetZ * runtime.unitScale
      const direction = sample.facingDirection === undefined
        ? undefined
        : playerDirections[sample.facingDirection - 1]
      if (direction && direction !== followerDirection) {
        followerDirection = direction
        followerAnimationStartedAt = now
        applyFollowerFrame(now)
      }
      return
    }
    if (!followerMoving) return
    const progress = THREE.MathUtils.clamp((now - followerMoveStartTime) / followerMoveDurationMs, 0, 1)
    followerSprite.position.lerpVectors(followerStartPosition, followerTargetPosition, progress)
    if (progress >= 1) {
      followerMoving = false
      followerSprite.position.copy(followerTargetPosition)
    }
  }

  const isFollowerMoving = (): boolean => {
    if (followerMoving || followerReactionMotion) updateFollowerMotion(animationNow())
    return followerMoving || followerReactionMotion !== undefined || actorMotions.has(hgssFollowerObjectId)
  }

  const isPlayerMoving = (): boolean => {
    // `processMovementInput` interroge cet etat avant le rendu de la frame.
    // Finaliser ici un pas arrive a son terme permet d'enchainer le suivant
    // sans une VBlank d'arret entre deux cases.
    if (playerMoving) updatePlayerMotion(animationNow())
    return playerMoving
  }

  const actorSprite = (objectId: number): THREE.Sprite | undefined => objectId === 255
    ? playerSprite
    : objectId === hgssFollowerObjectId
      ? followerSprite
      : eventRuntimeSprites.find((entry) => entry.id === objectId)?.sprite

  const startMotionAction = (motion: ActorMotion, now: number): void => {
    const action = motion.actions[motion.actionIndex]
    const sprite = actorSprite(motion.objectId)
    if (!action || !sprite) {
      resolveActorMotion(motion.objectId)
      return
    }
    motion.startedAt = now
    motion.start.copy(sprite.position)
    motion.target.copy(sprite.position)
    const event = eventRuntimeSprites.find((entry) => entry.id === motion.objectId)
    if (event && (action.action === 69 || action.action === 70)) {
      event.movementHidden = action.action === 69
      event.sprite.visible = !event.movementHidden
      grassEffectLayer.setActorVisible(`actor:${event.id}`, event.sprite.visible)
    }
    if (event && (action.kind === 'walk' || action.kind === 'walkInPlace')) event.animationStartedAt = now
    motion.duration = getFieldMovementDurationFrames(action) * hgssVBlankDurationMs
    if (motion.objectId === 255) {
      // Les déplacements scriptés utilisent les mêmes compteurs VBlank que le
      // terrain. Sans réinitialiser cette horloge, l'avatar recyclait la durée
      // du dernier pas libre et ses poses défilaient beaucoup trop vite.
      playerMoveStartTime = now
      playerMoveDurationMs = motion.duration
      playerMovementKind = 'walk'
    }
    if (action.direction) {
      if (motion.objectId === 255) setPlayerDirection(action.direction)
      else if (motion.objectId === hgssFollowerObjectId) {
        followerMoveDurationMs = motion.duration
        followerDirection = action.direction
        followerAnimationStartedAt = now
      }
      else setActorDirection(motion.objectId, action.direction)
      if (action.kind === 'walk' || (action.kind === 'jump' && action.tileDistance > 0)) {
        const delta = {
          north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0],
        }[action.direction]
        const tileDistance = action.kind === 'jump' ? action.tileDistance : 1
        const event = eventRuntimeSprites.find((entry) => entry.id === motion.objectId)
        if (event) {
          event.tileX += delta[0] * tileDistance
          event.tileZ += delta[1] * tileDistance
          motion.target.copy(projectMapPosition(activeLayout, activeMap, event.tileX, event.tileZ, 0.08, motion.start.y - 0.08))
          setActorGrassEffect(`actor:${event.id}`, event.tileX, event.tileZ, true, motion.target.y - 0.08)
        } else if (motion.objectId === 255) {
          const current = worldPositionToTile(playerSprite.position)
          motion.target.copy(projectMapPosition(activeLayout, activeMap, current.x + delta[0] * tileDistance, current.z + delta[1] * tileDistance, 0.08, motion.start.y - 0.08))
          setActorGrassEffect('player', current.x + delta[0] * tileDistance, current.z + delta[1] * tileDistance, true, motion.target.y - 0.08)
        } else if (motion.objectId === hgssFollowerObjectId) {
          const current = worldPositionToTile(followerSprite.position)
          motion.target.copy(projectMapPosition(activeLayout, activeMap, current.x + delta[0] * tileDistance, current.z + delta[1] * tileDistance, 0.08, motion.start.y - 0.08))
          setActorGrassEffect('follower', current.x + delta[0] * tileDistance, current.z + delta[1] * tileDistance, true, motion.target.y - 0.08)
        }
      }
    }
  }

  const worldPositionToTile = (position: THREE.Vector3): { x: number, z: number } => unprojectMapTile(activeMap, position)

  const applyMovement = (objectId: number, actions: FieldMovementAction[]): Promise<void> => {
    if (!actorSprite(objectId) || actions.length === 0) return Promise.resolve()
    resolveActorMotion(objectId)
    return new Promise<void>((resolve) => {
      const motion: ActorMotion = {
        objectId, actions, actionIndex: 0, repetition: 0, startedAt: 0, duration: 0,
        start: new THREE.Vector3(), target: new THREE.Vector3(), resolve,
      }
      actorMotions.set(objectId, motion)
      startMotionAction(motion, animationNow())
    })
  }

  const setActorPosition = (objectId: number, tileX: number, tileZ: number, direction?: PlayerDirection): void => {
    const entry = eventRuntimeSprites.find((candidate) => candidate.id === objectId)
    if (!entry) return
    resolveActorMotion(objectId)
    entry.tileX = tileX
    entry.tileZ = tileZ
    if (direction) entry.direction = direction
    entry.sprite.position.copy(projectMapPosition(activeLayout, activeMap, tileX, tileZ, 0.08, entry.sprite.position.y - 0.08))
    setActorGrassEffect(`actor:${objectId}`, tileX, tileZ, false, entry.sprite.position.y - 0.08)
    applyEventFrame(entry, false)
    updateSpriteRenderOrder()
  }

  const setActorDirection = (objectId: number, direction: PlayerDirection): void => {
    const entry = eventRuntimeSprites.find((candidate) => candidate.id === objectId)
    if (!entry) return
    entry.direction = direction
    applyEventFrame(entry, false)
    updateSpriteRenderOrder()
  }

  const setActorVisibility = (objectId: number, visible: boolean): void => {
    const sprite = actorSprite(objectId)
    if (!sprite) return
    sprite.visible = visible
    grassEffectLayer.setActorVisible(`actor:${objectId}`, visible)
    updateSpriteRenderOrder()
  }
  const setActorSpriteResource = (objectId: number, spriteId: number): void => {
    const entry = eventRuntimeSprites.find((candidate) => candidate.id === objectId)
    const resource = activeEventTextureResolver?.(spriteId)
    if (!entry || !resource?.preview) throw new Error(`Le sprite ROM ${spriteId} de l’objet ${objectId} est absent.`)
    const binding = createEventSpriteResource(resource.preview, resource.frames)
    disposeEventSpriteResource(entry)
    entry.resolvedSpriteId = spriteId; entry.textures = binding.textures; entry.frames = binding.frames; entry.runtimeFrames = binding.runtimeFrames
    entry.material.map = binding.primaryTexture; entry.material.needsUpdate = true; entry.animationStartedAt = animationNow()
    applySpriteScale(entry.sprite, binding.preview); applyEventFrame(entry, false)
    updateSpriteRenderOrder()
  }

  const playApricornTreeAnimation = (objectId: number, apricornType: number): Promise<void> => {
    const entry = eventRuntimeSprites.find((candidate) => candidate.id === objectId)
    if (!activeMap || !entry) return Promise.reject(new Error(`L'arbre Noigrume ROM ${objectId} est absent de la scène active.`))
    if (!Number.isInteger(apricornType) || apricornType < 0 || apricornType >= 7) {
      return Promise.reject(new Error(`Le type de Noigrume ROM ${apricornType} est invalide.`))
    }
    if (entry.apricornFruit) entry.apricornFruit.sprite.visible = false
    const resource = activeEventTextureResolver?.(270 + apricornType)
    const preview = resource?.preview
    if (!preview) return Promise.reject(new Error(`Le sprite ROM du Noigrume ${apricornType} est absent.`))
    const animationMap = activeMap
    const texture = createNitroDataTexture(preview, true)
    const material = createCutoutSpriteMaterial(texture, resolveActorSpriteDepthMode(animationMap))
    const apricorn = new THREE.Sprite(material)
    apricorn.center.set(0.5, 0.5)
    apricorn.visible = false
    apricorn.renderOrder = entry.sprite.renderOrder + 2
    applySpriteScale(apricorn, preview)
    scene.add(apricorn)
    const startedAt = animationNow()
    const tileSize = usesWorldMatrixCoordinates(animationMap) ? 1 : 16
    const jumpDirection = {
      north: [0, 1], south: [0, -1], west: [1, 0], east: [-1, 0],
    }[playerDirection]!
    return new Promise((resolve) => {
      const finish = (): void => {
        entry.sprite.material.rotation = 0
        scene.remove(apricorn)
        material.dispose()
        texture.dispose()
        resolve()
      }
      const animate = (browserNow: number): void => {
        const now = animationNow(browserNow)
        if (activeMap !== animationMap) {
          finish()
          return
        }
        const frame = (now - startedAt) / hgssVBlankDurationMs
        if (frame < 32) {
          // Deux oscillations de seize VBlank, comme TREE_WIGGLE_FRAMES.
          entry.sprite.material.rotation = Math.sin(frame * Math.PI / 4) * 0.065
        } else {
          entry.sprite.material.rotation = 0
          apricorn.visible = true
          const progress = THREE.MathUtils.clamp((frame - 40) / 16, 0, 1)
          apricorn.position.copy(entry.sprite.position)
          apricorn.position.y += tileSize * (1.15 + Math.sin(progress * Math.PI) * 0.9)
          apricorn.position.x += jumpDirection[0] * tileSize * progress
          apricorn.position.z += jumpDirection[1] * tileSize * progress
        }
        if (frame >= 56) {
          finish()
          return
        }
        window.requestAnimationFrame(animate)
      }
      window.requestAnimationFrame(animate)
    })
  }

  const syncEventVisibility = (state: FieldScriptState): void => {
    if (!activeMap) return
    for (const object of activeMap.events?.objects ?? []) {
      const resolvedSpriteId = resolveEventSpriteId(object, state)
      let entry = eventRuntimeSprites.find((candidate) => candidate.id === object.id)
      if (entry && resolvedSpriteId !== undefined && entry.resolvedSpriteId !== resolvedSpriteId) {
        resolveActorMotion(entry.id)
        disposeEventSprite(entry)
        eventRuntimeSprites = eventRuntimeSprites.filter((candidate) => candidate !== entry)
        entry = undefined
      }
      entry ??= createEventSprite(activeMap, object, state)
      if (!entry) continue
      entry.sprite.visible = !entry.movementHidden
        && (entry.eventFlag === 0 || !state.flags.has(entry.eventFlag))
        && !state.hiddenObjectIds.has(entry.id)
        && !state.invisibleObjectIds.has(entry.id)
      if (entry.apricornFruit) {
        entry.apricornFruit.sprite.visible = entry.sprite.visible
          && !state.harvestedApricornTrees.has(entry.apricornFruit.treeIndex)
      }
      grassEffectLayer.setActorVisible(`actor:${entry.id}`, entry.sprite.visible)
    }
    updateSpriteRenderOrder()
  }

  const updateActorMotions = (now: number): void => {
    for (const motion of [...actorMotions.values()]) {
      const action = motion.actions[motion.actionIndex]
      const sprite = actorSprite(motion.objectId)
      if (!action || !sprite) {
        resolveActorMotion(motion.objectId)
        continue
      }
      const progress = THREE.MathUtils.clamp((now - motion.startedAt) / Math.max(1, motion.duration), 0, 1)
      const event = eventRuntimeSprites.find((entry) => entry.id === motion.objectId)
      const walking = action.kind === 'walk' || action.kind === 'walkInPlace'
      if (event) applyEventFrame(event, walking, now, motion.duration)
      else if (motion.objectId === 255) applyDirectionalPlayerFrame(now, walking)
      else if (motion.objectId === hgssFollowerObjectId) applyFollowerFrame(now, undefined, motion.duration)
      if (action.kind === 'walk' || action.kind === 'jump') sprite.position.lerpVectors(motion.start, motion.target, progress)
      if (action.kind === 'jump') {
        const jumpHeight = activeMap && usesWorldMatrixCoordinates(activeMap) ? 0.75 : 12
        sprite.position.y += Math.sin(progress * Math.PI) * jumpHeight
      }
      if (motion.objectId === 255) {
        updateMapMatrixChunkVisibility()
        cameraController.follow(sprite.position)
      }
      if (progress < 1) continue
      sprite.position.copy(motion.target)
      motion.repetition += 1
      if (motion.repetition < Math.max(1, action.repetitions)) {
        startMotionAction(motion, now)
        continue
      }
      motion.actionIndex += 1
      motion.repetition = 0
      if (motion.actionIndex >= motion.actions.length) resolveActorMotion(motion.objectId)
      else startMotionAction(motion, now)
    }
  }

  const isScriptMoving = (): boolean => actorMotions.size > 0
  const isActorMoving = (objectId: number): boolean => actorMotions.has(objectId)

  const playMapPropAnimation = (
    tracks: MapPropAnimationTrack[],
    durationMs: number,
    interpolate: boolean,
    frameDurationMs = hgssVBlankDurationMs,
  ): Promise<void> => {
    return mapPropAnimationPlayback.play(
      tracks.map(({ entry, frames }) => ({ target: entry, frames })),
      { startedAt: animationNow(), durationMs, frameDurationMs, interpolate },
    )
  }

  const projectContinuousAzaleaPosition = (tileX: number, tileZ: number, yOffset = 0.08): THREE.Vector3 => {
    if (!activeMap?.terrain) return new THREE.Vector3(tileX, yOffset, tileZ)
    const rounded = projectMapPosition(activeLayout, activeMap, Math.round(tileX), Math.round(tileZ), yOffset)
    if (usesWorldMatrixCoordinates(activeMap)) {
      rounded.x = tileX + 0.5
      rounded.z = tileZ + 0.5
    } else {
      rounded.x = (tileX + 0.5 - activeMap.terrain.width / 2) * 16
      rounded.z = (tileZ + 0.5 - activeMap.terrain.height / 2) * 16
    }
    return rounded
  }

  const setAzaleaCartNode = (cart: AzaleaGymCartRuntime, node: AzaleaGymRouteNode): void => {
    cart.object.position.copy(projectContinuousAzaleaPosition(node.x, node.z, 0.02))
    if (!usesWorldMatrixCoordinates(activeMap!)) {
      for (const mesh of cart.meshes) {
        const baseOrder = typeof mesh.userData.azaleaBaseRenderOrder === 'number'
          ? mesh.userData.azaleaBaseRenderOrder
          : mesh.renderOrder
        mesh.userData.azaleaBaseRenderOrder = baseOrder
        mesh.renderOrder = baseOrder + Math.round(cart.object.position.z * 100)
      }
    }
  }

  const setAzaleaGymSwitchState = (
    switchState: number,
    animationResolver: RomInventory['mapPropAnimationResolver'],
    metadataResolver: RomInventory['mapPropAnimationMetadataResolver'],
  ): void => {
    if (!activeMap || !animationResolver || !metadataResolver) return
    const state = switchState & 3
    const animationIndexByModel = new Map<number, number>([
      [115, (state >> 1) & 1],
      [116, state & 1],
      [117, state & 1],
      [122, (state >> 1) & 1],
    ])
    for (const prop of activeMap.model?.mapProps ?? []) {
      const animationIndex = animationIndexByModel.get(prop.modelId)
      const entry = staticMapPropRuntime.get(prop)
      if (animationIndex === undefined || !entry) continue
      const archiveId = metadataResolver(prop.modelId, 'room', activeMap.header.areaDataBank)?.animationArchiveIds[animationIndex]
      const animation = archiveId === undefined
        ? undefined
        : animationResolver(prop.modelId, activeMap.header.areaDataBank, archiveId, 'room')
      const frame = animation?.frames.at(-1)
      if (frame) applyMapPropFrame(entry, frame)
    }
  }

  const playAzaleaGymSwitch = (
    switchNumber: number,
    switchState: number,
    animationResolver: RomInventory['mapPropAnimationResolver'],
    metadataResolver: RomInventory['mapPropAnimationMetadataResolver'],
  ): Promise<void> => {
    if (!activeMap || !animationResolver || !metadataResolver || (switchNumber !== 0 && switchNumber !== 1)) return Promise.resolve()
    const state = switchState & 3
    const models = switchNumber === 0 ? new Set([116, 117]) : new Set([115, 122])
    const tracks: MapPropAnimationTrack[] = []
    for (const prop of activeMap.model?.mapProps ?? []) {
      if (!models.has(prop.modelId)) continue
      const entry = staticMapPropRuntime.get(prop)
      if (!entry) continue
      const animationIndex = switchNumber === 0 ? state & 1 : (state >> 1) & 1
      const archiveId = metadataResolver(prop.modelId, 'room', activeMap.header.areaDataBank)?.animationArchiveIds[animationIndex]
      const frames = archiveId === undefined
        ? undefined
        : animationResolver(prop.modelId, activeMap.header.areaDataBank, archiveId, 'room')?.frames
      if (frames?.length) tracks.push({ entry, frames })
    }
    // Les fichiers ROM fournissent les deux poses exactes, mais pas leurs
    // interpolations (chaque BCA répète sa pose trois fois). Une transition
    // courte conserve les extrémités natives tout en rendant le levier lisible
    // sur un écran moderne.
    return playMapPropAnimation(tracks, hgssVBlanksToMilliseconds(10), true)
  }

  const syncAzaleaGymMechanism = (
    spiderNodes: readonly number[],
    switchState: number,
    modelResolver: RomInventory['mapPropModelResolver'],
    animationResolver: RomInventory['mapPropAnimationResolver'],
    metadataResolver: RomInventory['mapPropAnimationMetadataResolver'],
  ): void => {
    disposeAzaleaGymMechanism()
    if (!activeMap || !modelResolver || spiderNodes.length !== 4) return
    const model = modelResolver(118, activeMap.header.areaDataBank, 'room')
    if (!model) return
    const routeArchiveId = metadataResolver?.(118, 'room', activeMap.header.areaDataBank)?.animationArchiveIds[0]
    const routeAnimationFrames = routeArchiveId === undefined
      ? undefined
      : animationResolver?.(118, activeMap.header.areaDataBank, routeArchiveId, 'room')?.frames
    for (const nodeIndex of spiderNodes) {
      const node = (nodeIndex >= 0 && nodeIndex < 12)
        ? { x: [3, 9, 15][nodeIndex % 3]!, z: [31, 24, 16, 9][Math.floor(nodeIndex / 3)]! }
        : undefined
      if (!node) continue
      const sceneMesh = buildSceneMesh({ ...activeMap, model }, activeFieldTextureAnimations, { indoorDepthLayers: false, replaceLegacyPropShadows: true, textureAnimationEpochMs: activeTextureAnimationEpochMs })
      if (!sceneMesh) continue
      if (usesWorldMatrixCoordinates(activeMap)) sceneMesh.object.scale.setScalar(1 / 16)
      const cart: AzaleaGymCartRuntime = {
        ...createStaticMapPropRuntime(sceneMesh.object, model),
        animate: sceneMesh.animate,
        dispose: () => {
          disposeMapPropFrameTextures(cart)
          sceneMesh.dispose()
        },
        routeAnimationFrames,
      }
      setAzaleaCartNode(cart, node)
      azaleaGymMapProps.add(cart.object)
      azaleaGymCarts.push(cart)
    }
    setAzaleaGymSwitchState(switchState, animationResolver, metadataResolver)
  }

  const playAzaleaGymRide = (ride: AzaleaGymRide, onTravelStart?: () => void): Promise<void> => {
    const cart = azaleaGymCarts[ride.spiderIndex]
    if (!cart || ride.route.length < 2) return Promise.resolve()
    activeAzaleaGymRide?.resolve()
    const routeDistance = getForcedTransportRouteDistance(ride.route)
    const routeDurationMs = Math.max(1, routeDistance * 8 * hgssVBlankDurationMs)
    const startedAt = animationNow()
    playerDirection = ride.direction
    playerMoveStartTime = startedAt
    playerMoveDurationMs = hgssAzaleaTransportTiming.mountFrames * hgssVBlankDurationMs
    followerMoveDurationMs = playerMoveDurationMs
    applyDirectionalPlayerFrame(startedAt, true)
    followerDirection = ride.direction
    followerAnimationStartedAt = startedAt
    applyFollowerFrame(startedAt, true)
    return new Promise((resolve) => {
      activeAzaleaGymRide = {
        ride,
        cart,
        startedAt,
        routeDurationMs,
        playerStart: playerSprite.position.clone(),
        followerStart: followerSprite.position.clone(),
        presentationPhase: 'mount',
        travelStarted: false,
        onTravelStart,
        resolve,
      }
    })
  }

  const updateAzaleaGymRide = (now: number): void => {
    const active = activeAzaleaGymRide
    if (!active) return
    const elapsed = now - active.startedAt
    const sample = sampleForcedTransportTimeline(
      elapsed,
      active.routeDurationMs,
      hgssVBlankDurationMs,
      hgssAzaleaTransportTiming,
    )
    if (sample.phase !== active.presentationPhase) {
      active.presentationPhase = sample.phase
      playerMoveStartTime = now
      followerAnimationStartedAt = now
      playerMoveDurationMs = (sample.phase === 'mount'
        ? hgssAzaleaTransportTiming.mountFrames
        : hgssAzaleaTransportTiming.dismountFrames) * hgssVBlankDurationMs
      followerMoveDurationMs = playerMoveDurationMs
    }
    if (sample.phase === 'travel' && !active.travelStarted) {
      active.travelStarted = true
      active.onTravelStart?.()
    }
    const routeDistance = getForcedTransportRouteDistance(active.ride.route)
    const point = sampleForcedTransportRoute(active.ride.route, routeDistance * sample.routeProgress)
    const reverseOffset = active.ride.direction === 'south' ? 1 : 0
    const playerOnCart = projectContinuousAzaleaPosition(point.x, point.z + reverseOffset)
    const followerOnCart = projectContinuousAzaleaPosition(point.x, point.z + (1 - reverseOffset))
    setAzaleaCartNode(active.cart, point)
    const playerDestination = projectContinuousAzaleaPosition(active.ride.destination.x, active.ride.destination.z)
    const followerDestination = projectContinuousAzaleaPosition(active.ride.followerDestination.x, active.ride.followerDestination.z)
    if (sample.phase === 'mount') {
      playerSprite.position.lerpVectors(active.playerStart, playerOnCart, sample.phaseProgress)
      if (followerSprite.visible) followerSprite.position.lerpVectors(active.followerStart, followerOnCart, sample.phaseProgress)
    } else if (sample.phase === 'dismount') {
      playerSprite.position.lerpVectors(playerOnCart, playerDestination, sample.phaseProgress)
      if (followerSprite.visible) followerSprite.position.lerpVectors(followerOnCart, followerDestination, sample.phaseProgress)
    } else {
      playerSprite.position.copy(playerOnCart)
      if (followerSprite.visible) followerSprite.position.copy(followerOnCart)
    }
    const actorIsStepping = sample.phase === 'mount' || sample.phase === 'dismount'
    applyDirectionalPlayerFrame(now, actorIsStepping)
    applyFollowerFrame(now, actorIsStepping)
    const animationFrames = active.cart.routeAnimationFrames
    if (sample.phase === 'travel' && animationFrames?.length) {
      const travelElapsed = sample.routeProgress * active.routeDurationMs
      applyMapPropFrame(active.cart, animationFrames[sampleHgssVBlankFrame(travelElapsed, 0) % animationFrames.length]!)
    }
    cameraController.follow(playerSprite.position)
    if (sample.phase === 'shake') {
      const shakeUnit = usesWorldMatrixCoordinates(activeMap!) ? 0.08 : 1.25
      cameraController.addDepthOffset(Math.sin(sample.phaseProgress * Math.PI * 8) * shakeUnit)
    }
    if (sample.phase !== 'complete') return
    playerSprite.position.copy(playerDestination)
    if (followerSprite.visible) followerSprite.position.copy(followerDestination)
    setAzaleaCartNode(active.cart, active.ride.route.at(-1)!)
    activeAzaleaGymRide = undefined
    applyDirectionalPlayerFrame(now, false)
    applyFollowerFrame(now, false)
    active.resolve()
  }

  const playDoorAnimation = (door: DoorTransitionDescriptor, animationIndex: 0 | 1, resolver: RomInventory['mapPropAnimationResolver']): Promise<void> => {
    const entry = staticMapPropRuntime.get(door.prop)
    const archiveId = door.animationArchiveIds[animationIndex]
    const animation = activeMap && entry && archiveId !== undefined && resolver
      ? resolver(door.modelId, activeMap.header.areaDataBank, archiveId, usesWorldMatrixCoordinates(activeMap) ? 'field' : 'room')
      : undefined
    if (!entry || !animation || animation.frames.length === 0) {
      return Promise.reject(new Error(`Animation ROM de porte ${door.modelId}:${animationIndex} indisponible.`))
    }
    return playMapPropAnimation(
      [{ entry, frames: animation.frames }],
      resolveDoorAnimationDurationMs(animation.frames.length),
      false,
      doorAnimationFrameDurationMs,
    )
  }

  const syncBlackthornGymMechanism = (data: Uint8Array, resolver: RomInventory['mapPropModelResolver']): void => { if (activeMap) blackthornGymPlatforms.sync(activeMap, data, resolver) }
  const playBlackthornGymAction = (result: BlackthornGymActionResult): Promise<void> => activeMap ? blackthornGymPlatforms.play(activeMap, result, animationNow()) : Promise.resolve()
  const presentGymProps = (presentations: readonly HgssGymPropPresentation[], animate: boolean): Promise<void> => {
    if (!activeMap) return Promise.resolve()
    const tracks: MapPropAnimationTrack[] = []
    for (const presentation of presentations) for (const prop of activeMap.model?.mapProps ?? []) {
      if (prop.modelId !== presentation.modelId) continue
      const entry = staticMapPropRuntime.get(prop); if (!entry) continue
      if (presentation.frames?.length) tracks.push({ entry, frames: presentation.frames }); else applyMapPropFrame(entry, presentation.base)
    }
    if (animate) return playMapPropAnimation(tracks, hgssVBlanksToMilliseconds(Math.max(...tracks.map(({ frames }) => frames.length), 1)), false)
    for (const track of tracks) applyMapPropFrame(track.entry, track.frames.at(-1)!); return Promise.resolve()
  }
  const playFuchsiaGymWall = (wall: FuchsiaGymWall, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver']): Promise<void> | undefined => activeMap ? fuchsiaGymWalls.play(activeMap, wall, groundHeight, modelResolver, animationResolver, animationNow()) : undefined
  const playViridianGymTile = (behavior: number, tileX: number, tileZ: number, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver']): Promise<void> | undefined => activeMap ? viridianGymTiles.play(activeMap, behavior, tileX, tileZ, groundHeight, modelResolver, animationResolver, animationNow()) : undefined
  const syncVioletGymElevator = (data: Uint8Array, resolver: RomInventory['mapPropModelResolver']): void => { if (activeMap) violetGymElevator.sync(activeMap, data, resolver) }
  const playVioletGymElevator = (targetY: number, durationFrames: number): Promise<void> => violetGymElevator.play(targetY, durationFrames, animationNow())
  const syncEcruteakGymCandles = (data: Uint8Array, positions: readonly EcruteakGymCandlePosition[], resolver: RomInventory['mapPropModelResolver']): void => { if (!activeMap) return; ecruteakGymCandles.sync(activeMap, data, positions, resolver); for (const material of [playerMaterial, followerMaterial, followerEmoteMaterial, ...eventRuntimeSprites.map(({ material }) => material)]) { material.fog = false; material.needsUpdate = true } }
  const trackEcruteakGymCandle = (objectId?: number): void => ecruteakGymCandles.track(objectId)
  const lightEcruteakGymCandle = (objectId: number): void => ecruteakGymCandles.light(objectId)
  const extinguishEcruteakGymCandle = (objectId: number): Promise<void> => ecruteakGymCandles.extinguish(objectId, animationNow())

  const renderFrame = (browserNow = performance.now()): void => {
    const frameStartedAt = performance.now()
    syncRendererSize()

    const now = animationNow(browserNow)
    activeSceneAnimation?.(now)
    for (const animate of activeStaticMapPropAnimations) animate(now)
    for (const animate of activeDynamicMapPropAnimations) animate(now)
    managedMapPropAnimations.update(now, applyMapPropFrame)
    oneShotMapPropAnimations.update(now, applyMapPropFrame)
    for (const cart of azaleaGymCarts) cart.animate?.(now)
    mapPropAnimationPlayback.update(now)
    updatePlayerMotion(now)
    updateFollowerMotion(now)
    updateFollowerEmote(now)
    updateActorMotions(now)
    playerTransitionMotion.update(now, hgssVBlankDurationMs)
    updateAzaleaGymRide(now)
    actorIdlePresentation.syncWorldActors(
      now,
      playerSprite, !playerMoving && !actorMotions.has(255) && !playerTransitionMotion.isActive && activeAzaleaGymRide === undefined,
      followerSprite, !followerMoving && followerReactionMotion === undefined && !actorMotions.has(hgssFollowerObjectId) && activeAzaleaGymRide === undefined,
      eventRuntimeSprites, actorMotions,
    ); dynamicPokemonActors.update(now)
    fishingBiteEffects.update(now, resolveFishingBiteAnchor)
    fieldMoveEffects.update(now)
    blackthornGymPlatforms.update(now)
    fuchsiaGymWalls.update(now)
    viridianGymTiles.update(now)
    violetGymElevator.update(now)
    ecruteakGymCandles.update(now, (objectId) => { const entry = eventRuntimeSprites.find((candidate) => candidate.id === objectId); return entry ? entry.sprite.position.clone().setY(entry.sprite.position.y - .08) : undefined })
    grassEffectLayer.update(now)
    // Les textures, la respiration idle et la locomotion peuvent changer sans
    // mouvement. Resynchroniser cette couche évite de conserver un reflet,
    // une ombre ou un wake provenant de l'état précédent.
    updateSpriteRenderOrder(now)
    const camera = cameraController.camera
    worldEnvironment.update(now, camera, playerSprite.position)
    renderer.render(scene, camera)
    lastFrameTimeMs = performance.now() - frameStartedAt
  }

  const getRenderStats = () => createGameRenderStats(
    renderer.info.render,
    renderer.info.memory,
    lastFrameTimeMs,
  )

  const pauseAnimations = (browserNow = performance.now()): void => { animationClock.pause(browserNow) }
  const resumeAnimations = (browserNow = performance.now()): void => { animationClock.resume(browserNow) }

  const dispose = (): void => {
    playerTransitionMotion.clear()
    worldEnvironment.dispose()
    dynamicPokemonActors.dispose(); actorTerrainPresentation.dispose()
    followerReactionMotion?.resolve()
    followerReactionMotion = undefined
    if (followerEmote) {
      for (const texture of followerEmote.textures) texture.dispose()
      followerEmote.resolve()
      followerEmote = undefined
    }
    disposeTerrain()
    disposeStaticMapProps()
    disposeMapProps()
    disposeAzaleaGymMechanism()
    blackthornGymPlatforms.dispose()
    fuchsiaGymWalls.dispose()
    viridianGymTiles.dispose()
    violetGymElevator.dispose()
    ecruteakGymCandles.dispose()
    disposeEventSprites()
    grassEffectLayer.dispose(); fishingBiteEffects.dispose(); fieldMoveEffects.dispose()
    playerTexture?.dispose()
    playerTexture = undefined
    disposePlayerFrameTextures()
    followerTextureResource = undefined
    for (const texture of followerTextures) texture.dispose()
    followerTextures = []
    followerTexturesById.clear()
    followerMaterial.dispose()
    followerEmoteMaterial.dispose()
    playerMaterial.dispose()
    renderer.dispose()
  }

  return { loadMap, setPlayerTexture, setPlayerTextureFrames, setPlayerDirection, setPlayerLocomotion, setCameraTarget, setPlayerPosition, playPlayerTransitionMotion, setFollowerTexture, setFollowerPosition, getFollowerMapObjectSignal, setFollowerMovementPaused, applyFollowerMovement, playFollowerReactionMotion, playFollowerEmote, startFishingBiteEffect, stopFishingBiteEffect, refreshFollower, isFollowerMoving, isPlayerMoving, applyMovement, isActorMoving, setActorPosition, setActorDirection, setActorVisibility, setActorSpriteResource, playApricornTreeAnimation, syncDaycareObjects, syncEventVisibility, syncMapProps, setMapPropDeferredAnimations, loadMapPropOneShotAnimation, playMapPropOneShotAnimation, waitMapPropOneShotAnimation, unloadMapPropOneShotAnimation, playDoorAnimation, syncAzaleaGymMechanism, setAzaleaGymSwitchState, playAzaleaGymSwitch, playAzaleaGymRide, syncBlackthornGymMechanism, playBlackthornGymAction, presentGymProps, playFuchsiaGymWall, playViridianGymTile, syncVioletGymElevator, playVioletGymElevator, syncEcruteakGymCandles, trackEcruteakGymCandle, lightEcruteakGymCandle, extinguishEcruteakGymCandle, isScriptMoving, setWorldEnvironment: (environment) => { worldEnvironment.setEnvironment(environment); managedMapPropAnimations.setVisualTime(resolveHgssFieldVisualTime(environment.timeOfDay)) }, ...dynamicPokemonActors.runtime, ...fieldMoveEffects.runtime, renderFrame, getRenderStats, pauseAnimations, resumeAnimations, dispose }
}
