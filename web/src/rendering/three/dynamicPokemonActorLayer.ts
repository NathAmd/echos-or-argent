import * as THREE from 'three'
import { dynamicWorldActorLimits, type DynamicWorldActorCollision, type DynamicWorldActorInteraction } from '../../game/world/dynamicWorldActorRegistry'
import { hgssVBlankDurationMs, sampleHgssActorSpriteFrame } from '../../game/world/hgssWorldAnimationClock'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import type { NitroTexturePreview, OpeningMapPreview, PlayerDirection, PlayerTextureFrames, PokemonCatalog, PokemonFollowerTextures, RomInventory } from '../../ndsTypes'
import { projectMapPosition, type SceneLayout } from '../map/mapProjection'
import { getActorSpriteRenderOrder, resolveActorSpriteDepthMode } from './actorGroundPresentation'
import { ActorTerrainPresentationLayer } from './actorTerrainPresentationLayer'
import { HgssActorIdlePresentation } from './actorIdlePresentation'
import { createActorSpriteMaterial } from './actorSpriteMaterial'
import { createEventSpriteResource } from './eventSpriteResource'
import { createNitroDataTexture } from './nitroTexture'

export type MapDynamicPokemonActorEventTexture = Readonly<{
  preview: NitroTexturePreview
  frames?: PlayerTextureFrames
}>

export type MapDynamicPokemonActorTexture = NitroTexturePreview | PokemonFollowerTextures | MapDynamicPokemonActorEventTexture

type MapDynamicPokemonActorBase = Readonly<{
  id: string
  tileX: number
  /** Axe vertical de la grille 2D, projeté sur l’axe Z de la scène Three.js. */
  tileY: number
  /** Couche de sol de rendu ; collision et action restent volontairement 2D. */
  groundHeight?: number
  direction: PlayerDirection
  collision: DynamicWorldActorCollision
  interaction: DynamicWorldActorInteraction
}>

export type MapDynamicPokemonActor = MapDynamicPokemonActorBase & (
  | Readonly<{ texture: MapDynamicPokemonActorTexture, speciesId?: never, shiny?: never }>
  | Readonly<{ speciesId: number, shiny?: boolean, texture?: never }>
)

export type MapDynamicPokemonSpeciesTextureResolver = (
  speciesId: number,
  actor: Readonly<{ id: string, shiny?: boolean }>,
) => MapDynamicPokemonActorTexture | undefined

export type DynamicPokemonActorLayerContext = Readonly<{
  map: OpeningMapPreview
  layout: SceneLayout
}>

export type DynamicPokemonActorGroundEffects = Readonly<{
  setActor: (key: string, tileX: number, tileY: number, referenceGroundHeight: number, visible: boolean) => void
  removeActor: (key: string) => void
}>

type DirectionalFrame = Readonly<{ preview: NitroTexturePreview, texture: THREE.DataTexture }>
type DirectionalFrames = Readonly<{
  standing: DirectionalFrame
  walking: readonly DirectionalFrame[]
}>

type DynamicPokemonActorMotion = Readonly<{
  startedAt: number
  durationMs: number
  start: THREE.Vector3
  target: THREE.Vector3
}>

type DynamicPokemonActorEntry = {
  actor: MapDynamicPokemonActor
  sprite: THREE.Sprite
  material: THREE.SpriteMaterial
  textures: THREE.DataTexture[]
  frames: Record<PlayerDirection, DirectionalFrames>
  animateCardinalSteps: boolean
  motion?: DynamicPokemonActorMotion
  presentedPreview?: NitroTexturePreview
  groundEffectSynced: boolean
}

const directions: readonly PlayerDirection[] = ['north', 'south', 'west', 'east']
const actorIdentifier = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
export const hgssDynamicEventActorStepVBlanks = 8
const dynamicEventActorStepDurationMs = hgssDynamicEventActorStepVBlanks * hgssVBlankDurationMs
const motionCompletionEpsilonMs = 0.000_001

function isFollowerTexture(value: MapDynamicPokemonActorTexture): value is PokemonFollowerTextures {
  return 'animationFrames' in value
}

function isEventTexture(value: MapDynamicPokemonActorTexture): value is MapDynamicPokemonActorEventTexture {
  return !isFollowerTexture(value) && 'preview' in value
}

function compareActors(left: MapDynamicPokemonActor, right: MapDynamicPokemonActor): number {
  if (left.tileY !== right.tileY) return left.tileY - right.tileY
  if (left.tileX !== right.tileX) return left.tileX - right.tileX
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function hasSameTextureSource(left: MapDynamicPokemonActorTexture, right: MapDynamicPokemonActorTexture): boolean {
  if (left === right) return true
  return isEventTexture(left) && isEventTexture(right)
    && left.preview === right.preview && left.frames === right.frames
}

function hasSameVisualSource(left: MapDynamicPokemonActor, right: MapDynamicPokemonActor): boolean {
  if (left.texture !== undefined || right.texture !== undefined) {
    return left.texture !== undefined && right.texture !== undefined
      && hasSameTextureSource(left.texture, right.texture)
  }
  return left.speciesId === right.speciesId && Boolean(left.shiny) === Boolean(right.shiny)
}

function isCardinalStep(left: MapDynamicPokemonActor, right: MapDynamicPokemonActor): boolean {
  return Math.abs(left.tileX - right.tileX) + Math.abs(left.tileY - right.tileY) === 1
}

function normalizeActors(actors: readonly MapDynamicPokemonActor[]): MapDynamicPokemonActor[] {
  if (actors.length > dynamicWorldActorLimits.maxActors) throw new Error('La carte contient trop d’acteurs Pokémon dynamiques.')
  const ids = new Set<string>()
  return actors.map((candidate) => {
    if (!actorIdentifier.test(candidate.id) || candidate.id.length > dynamicWorldActorLimits.maxIdentifierLength || ids.has(candidate.id)) {
      throw new Error(`L’identité d’acteur Pokémon dynamique ${candidate.id || '(vide)'} est invalide ou dupliquée.`)
    }
    ids.add(candidate.id)
    if (!Number.isSafeInteger(candidate.tileX) || !Number.isSafeInteger(candidate.tileY)
      || Math.abs(candidate.tileX) > dynamicWorldActorLimits.maxCoordinate
      || Math.abs(candidate.tileY) > dynamicWorldActorLimits.maxCoordinate
      || candidate.groundHeight !== undefined && (!Number.isFinite(candidate.groundHeight)
        || Math.abs(candidate.groundHeight) > dynamicWorldActorLimits.maxCoordinate)) {
      throw new Error(`La position de l’acteur Pokémon dynamique ${candidate.id} est invalide.`)
    }
    if (!directions.includes(candidate.direction)
      || candidate.collision !== 'blocking' && candidate.collision !== 'non-blocking'
      || candidate.interaction !== 'action' && candidate.interaction !== 'none') {
      throw new Error(`Le comportement de l’acteur Pokémon dynamique ${candidate.id} est invalide.`)
    }
    const hasTexture = candidate.texture !== undefined
    const hasSpecies = candidate.speciesId !== undefined
    if (hasTexture === hasSpecies || hasSpecies && (!Number.isInteger(candidate.speciesId) || candidate.speciesId! < 1 || candidate.speciesId! > dynamicWorldActorLimits.maxSpeciesId)) {
      throw new Error(`L’apparence de l’acteur Pokémon dynamique ${candidate.id} est invalide.`)
    }
    return Object.freeze({ ...candidate })
  }).sort(compareActors)
}

export function createMapDynamicPokemonSpeciesTextureResolver(
  catalog: PokemonCatalog,
  resolver: RomInventory['followerTextureResolver'],
): MapDynamicPokemonSpeciesTextureResolver {
  return (speciesId, actor) => {
    const parameterIndex = catalog.followers.modelIndexBySpecies[speciesId]
    return Number.isInteger(parameterIndex) && parameterIndex! >= 0
      ? resolver?.(parameterIndex!, actor.shiny)
      : undefined
  }
}

/** Rendu et requêtes locales des acteurs non issus des object-events de la ROM. */
export class DynamicPokemonActorLayer {
  readonly group = new THREE.Group()
  private entries: DynamicPokemonActorEntry[] = []
  private map: OpeningMapPreview | undefined
  private readonly getContext: () => DynamicPokemonActorLayerContext | undefined
  private readonly idlePresentation: HgssActorIdlePresentation
  private readonly terrainPresentation: ActorTerrainPresentationLayer
  private readonly now: () => number
  private readonly groundEffects: DynamicPokemonActorGroundEffects | undefined

  constructor(
    parent: THREE.Object3D,
    getContext: () => DynamicPokemonActorLayerContext | undefined,
    idlePresentation: HgssActorIdlePresentation,
    terrainPresentation: ActorTerrainPresentationLayer,
    now: () => number = () => performance.now(),
    groundEffects?: DynamicPokemonActorGroundEffects,
  ) {
    this.getContext = getContext
    this.idlePresentation = idlePresentation
    this.terrainPresentation = terrainPresentation
    this.now = now
    this.groundEffects = groundEffects
    this.group.name = 'hgss-dynamic-pokemon-actors'
    parent.add(this.group)
  }

  private textureFor(
    actor: MapDynamicPokemonActor,
    resolver?: MapDynamicPokemonSpeciesTextureResolver,
  ): MapDynamicPokemonActorTexture {
    const texture = actor.texture ?? resolver?.(actor.speciesId!, actor)
    if (!texture) throw new Error(`La texture de l’acteur Pokémon dynamique ${actor.id} est absente.`)
    return texture
  }

  private createEntry(
    actor: MapDynamicPokemonActor,
    context: DynamicPokemonActorLayerContext,
    resolver?: MapDynamicPokemonSpeciesTextureResolver,
  ): DynamicPokemonActorEntry {
    const resource = this.textureFor(actor, resolver)
    const textures: THREE.DataTexture[] = []
    let material: THREE.SpriteMaterial | undefined
    let sprite: THREE.Sprite | undefined
    try {
      const frames = {} as Record<PlayerDirection, DirectionalFrames>
      const animateCardinalSteps = isEventTexture(resource)
      if (animateCardinalSteps) {
        const binding = createEventSpriteResource(resource.preview, resource.frames)
        textures.push(...binding.textures)
        for (const direction of directions) {
          const standingPreview = resource.frames?.standing[direction] ?? resource.preview
          const standingTexture = binding.runtimeFrames?.standing[direction] ?? binding.primaryTexture
          const walkingPreviews = resource.frames?.walking[direction] ?? []
          const walkingTextures = binding.runtimeFrames?.walking[direction] ?? []
          const walking = walkingTextures.map((texture, index) => ({
            preview: walkingPreviews[index] ?? standingPreview,
            texture,
          }))
          frames[direction] = {
            standing: { preview: standingPreview, texture: standingTexture },
            walking: walking.length > 0 ? walking : [{ preview: standingPreview, texture: standingTexture }],
          }
        }
      } else {
        const byPreview = new Map<NitroTexturePreview, THREE.DataTexture>()
        const build = (preview: NitroTexturePreview): DirectionalFrame => {
          let texture = byPreview.get(preview)
          if (!texture) {
            texture = createNitroDataTexture(preview, true)
            texture.wrapS = THREE.ClampToEdgeWrapping
            texture.wrapT = THREE.ClampToEdgeWrapping
            byPreview.set(preview, texture)
            textures.push(texture)
          }
          return { preview, texture }
        }
        for (const direction of directions) {
          const walkingPreviews = isFollowerTexture(resource)
            ? resource.animationFrames[direction]
            : [resource]
          const standing = build(walkingPreviews[0] ?? (isFollowerTexture(resource) ? resource.preview : resource))
          frames[direction] = {
            standing,
            walking: walkingPreviews.length > 0 ? walkingPreviews.map(build) : [standing],
          }
        }
      }
      const frame = frames[actor.direction].standing
      material = createActorSpriteMaterial(frame.texture, resolveActorSpriteDepthMode(context.map))
      material.fog = true
      sprite = new THREE.Sprite(material)
      sprite.name = `dynamic-pokemon-actor:${actor.id}`
      sprite.userData.dynamicPokemonActorId = actor.id
      sprite.center.set(0.5, 0)
      sprite.position.copy(projectMapPosition(context.layout, context.map, actor.tileX, actor.tileY, 0.08, actor.groundHeight))
      sprite.visible = true
      this.idlePresentation.setRomFrame(sprite, frame.preview, usesWorldMatrixCoordinates(context.map) ? 1.55 : 32)
      return {
        actor,
        sprite,
        material,
        textures,
        frames,
        animateCardinalSteps,
        presentedPreview: frame.preview,
        groundEffectSynced: false,
      }
    } catch (error) {
      if (sprite) this.idlePresentation.unregister(sprite)
      sprite?.removeFromParent()
      for (const texture of textures) texture.dispose()
      material?.dispose()
      throw error
    }
  }

  private disposeEntry(entry: DynamicPokemonActorEntry, removeGroundEffect = true): void {
    if (removeGroundEffect) {
      try { this.groundEffects?.removeActor(`dynamic:${entry.actor.id}`) } catch { /* best effort */ }
    }
    this.idlePresentation.unregister(entry.sprite)
    this.terrainPresentation.unregister(entry.sprite)
    entry.sprite.removeFromParent()
    for (const texture of entry.textures) texture.dispose()
    entry.material.dispose()
  }

  private syncEntryPresentation(
    entry: DynamicPokemonActorEntry,
    context: DynamicPokemonActorLayerContext,
    now: number,
  ): void {
    const { actor, sprite } = entry
    let moving = false
    if (entry.motion) {
      const elapsedMs = Math.max(0, now - entry.motion.startedAt)
      const progress = THREE.MathUtils.clamp(elapsedMs / entry.motion.durationMs, 0, 1)
      if (elapsedMs + motionCompletionEpsilonMs < entry.motion.durationMs) {
        sprite.position.lerpVectors(entry.motion.start, entry.motion.target, progress)
        moving = true
      } else {
        sprite.position.copy(entry.motion.target)
        entry.motion = undefined
      }
    } else {
      sprite.position.copy(projectMapPosition(context.layout, context.map, actor.tileX, actor.tileY, 0.08, actor.groundHeight))
    }
    const directional = entry.frames[actor.direction]
    const candidates = moving ? directional.walking : [directional.standing]
    const frameIndex = moving
      ? sampleHgssActorSpriteFrame(now, entry.motion!.startedAt, candidates.length, entry.motion!.durationMs)
      : 0
    const frame = candidates[frameIndex] ?? candidates[0]!
    if (entry.material.map !== frame.texture) {
      entry.material.map = frame.texture
      entry.material.needsUpdate = true
    }
    if (entry.presentedPreview !== frame.preview) {
      this.idlePresentation.setRomFrame(sprite, frame.preview, usesWorldMatrixCoordinates(context.map) ? 1.55 : 32)
      entry.presentedPreview = frame.preview
    }
    this.idlePresentation.sync(sprite, now, !moving)
    sprite.renderOrder = getActorSpriteRenderOrder(context.map, sprite.position.z)
    this.terrainPresentation.sync(sprite, context.map, actor.tileX, actor.tileY, 'event', sprite.renderOrder, now)
  }

  private syncGroundEffect(entry: DynamicPokemonActorEntry): void {
    if (entry.groundEffectSynced) return
    const key = `dynamic:${entry.actor.id}`
    try {
      this.groundEffects?.setActor(key, entry.actor.tileX, entry.actor.tileY, entry.sprite.position.y - 0.08, entry.sprite.visible)
    } catch {
      // L’herbe est une présentation optionnelle : un asset absent ne doit
      // jamais invalider un acteur déjà préparé ni provoquer une boucle GPU.
      try { this.groundEffects?.removeActor(key) } catch { /* best effort */ }
    }
    entry.groundEffectSynced = true
  }

  readonly syncDynamicPokemonActors = (
    actors: readonly MapDynamicPokemonActor[],
    resolver?: MapDynamicPokemonSpeciesTextureResolver,
  ): readonly MapDynamicPokemonActor[] => {
    const context = this.getContext()
    if (!context) throw new Error('Aucune carte active ne peut recevoir les acteurs Pokémon dynamiques.')
    // Une entrée appartient à l'objet carte qui l'a projetée. En cas de
    // changement de carte, ne jamais laisser l'ancien groupe survivre à une
    // erreur de résolution des nouvelles textures.
    if (this.map !== undefined && context.map !== this.map) this.clearDynamicPokemonActors()
    const normalized = normalizeActors(actors)
    const currentById = new Map(this.entries.map((entry) => [entry.actor.id, entry]))
    const retained = new Map<string, DynamicPokemonActorEntry>()
    const prepared = new Map<string, DynamicPokemonActorEntry>()
    const now = this.now()
    try {
      for (const actor of normalized) {
        const current = currentById.get(actor.id)
        if (current && hasSameVisualSource(current.actor, actor)) retained.set(actor.id, current)
        else prepared.set(actor.id, this.createEntry(actor, context, resolver))
      }
      for (const entry of prepared.values()) this.syncEntryPresentation(entry, context, now)
    } catch (error) {
      for (const entry of prepared.values()) this.disposeEntry(entry, false)
      throw error
    }

    const previousActors = new Map<DynamicPokemonActorEntry, Readonly<{
      actor: MapDynamicPokemonActor
      motion?: DynamicPokemonActorMotion
      groundEffectSynced: boolean
    }>>()
    try {
      for (const actor of normalized) {
        const entry = retained.get(actor.id)
        if (!entry) continue
        if (entry.motion && now - entry.motion.startedAt + motionCompletionEpsilonMs >= entry.motion.durationMs) {
          this.syncEntryPresentation(entry, context, now)
        }
        const previousActor = entry.actor
        previousActors.set(entry, {
          actor: previousActor,
          motion: entry.motion,
          groundEffectSynced: entry.groundEffectSynced,
        })
        const positionChanged = previousActor.tileX !== actor.tileX
          || previousActor.tileY !== actor.tileY
          || previousActor.groundHeight !== actor.groundHeight
        const coalesced = entry.motion !== undefined
        entry.actor = actor
        if (positionChanged) {
          entry.groundEffectSynced = false
          entry.motion = entry.animateCardinalSteps && isCardinalStep(previousActor, actor) && !coalesced
            ? {
                startedAt: now,
                durationMs: dynamicEventActorStepDurationMs,
                start: projectMapPosition(context.layout, context.map, previousActor.tileX, previousActor.tileY, 0.08, previousActor.groundHeight),
                target: projectMapPosition(context.layout, context.map, actor.tileX, actor.tileY, 0.08, actor.groundHeight),
              }
            : undefined
        }
        this.syncEntryPresentation(entry, context, now)
      }
    } catch (error) {
      for (const [entry, previous] of previousActors) {
        entry.actor = previous.actor
        entry.motion = previous.motion
        entry.groundEffectSynced = previous.groundEffectSynced
        try { this.syncEntryPresentation(entry, context, now) } catch { /* best effort rollback */ }
      }
      for (const entry of prepared.values()) this.disposeEntry(entry, false)
      throw error
    }

    for (const entry of this.entries) {
      if (retained.get(entry.actor.id) !== entry) this.disposeEntry(entry)
    }
    const nextEntries = normalized.map((actor) => retained.get(actor.id) ?? prepared.get(actor.id)!)
    this.map = context.map
    this.entries = nextEntries
    for (const entry of prepared.values()) this.group.add(entry.sprite)
    for (const entry of nextEntries) this.syncGroundEffect(entry)
    return this.listDynamicPokemonActors()
  }

  readonly clearDynamicPokemonActors = (): void => {
    for (const entry of this.entries) this.disposeEntry(entry)
    this.entries = []
    this.map = undefined
    this.group.clear()
  }

  readonly listDynamicPokemonActors = (): readonly MapDynamicPokemonActor[] => (
    this.isCurrentMap() ? this.entries.map(({ actor }) => actor) : []
  )

  readonly getDynamicPokemonActorsAt = (tileX: number, tileY: number): readonly MapDynamicPokemonActor[] => (
    this.listDynamicPokemonActors().filter((actor) => actor.tileX === tileX && actor.tileY === tileY)
  )

  readonly getBlockingDynamicPokemonActorAt = (tileX: number, tileY: number, excludedId?: string): MapDynamicPokemonActor | undefined => (
    this.getDynamicPokemonActorsAt(tileX, tileY).find((actor) => actor.id !== excludedId && actor.collision === 'blocking')
  )

  readonly isDynamicPokemonActorTileBlocked = (tileX: number, tileY: number, excludedId?: string): boolean => (
    this.getBlockingDynamicPokemonActorAt(tileX, tileY, excludedId) !== undefined
  )

  readonly getActionDynamicPokemonActorAt = (tileX: number, tileY: number): MapDynamicPokemonActor | undefined => (
    this.getDynamicPokemonActorsAt(tileX, tileY).find((actor) => actor.interaction === 'action')
  )

  getSprite(id: string): THREE.Sprite | undefined {
    return this.entries.find(({ actor }) => actor.id === id)?.sprite
  }

  private isCurrentMap(): boolean {
    return this.map !== undefined && this.getContext()?.map === this.map
  }

  update(now = this.now()): void {
    const context = this.getContext()
    if (!context || context.map !== this.map) {
      if (this.entries.length > 0) this.clearDynamicPokemonActors()
      return
    }
    for (const entry of this.entries) {
      this.syncEntryPresentation(entry, context, now)
      this.syncGroundEffect(entry)
    }
  }

  dispose(): void {
    this.clearDynamicPokemonActors()
    this.group.removeFromParent()
  }

  get runtime() {
    return {
      syncDynamicPokemonActors: this.syncDynamicPokemonActors,
      clearDynamicPokemonActors: this.clearDynamicPokemonActors,
      listDynamicPokemonActors: this.listDynamicPokemonActors,
      getDynamicPokemonActorsAt: this.getDynamicPokemonActorsAt,
      getBlockingDynamicPokemonActorAt: this.getBlockingDynamicPokemonActorAt,
      isDynamicPokemonActorTileBlocked: this.isDynamicPokemonActorTileBlocked,
      getActionDynamicPokemonActorAt: this.getActionDynamicPokemonActorAt,
    }
  }
}
