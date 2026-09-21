import * as THREE from 'three'
import { hgssVBlankDurationMs } from '../../game/time/hgssFrameTiming'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { sampleHgssGrassTexture, type HgssGrassEffect, type HgssGrassEffectKind } from '../../rom/overworld/grassEffects'
import { projectMapPosition, type SceneLayout } from '../map/mapProjection'
import { buildSceneMesh } from '../map/mapSceneBuilder'
import { getActorSpriteRenderOrder, setActorEffectRenderOrder } from './actorGroundPresentation'

type GrassEffectFrame = {
  object: THREE.Object3D
  dispose: () => void
}

type ActiveGrassEffect = {
  frames: GrassEffectFrame[]
  textureIndexes: number[]
  timeline: HgssGrassEffect['timeline']
  startedAt: number
  textureIndex: number
  actorVisible: boolean
}

export type HgssGrassEffectActorOptions = {
  animate: boolean
  referenceGroundHeight?: number
  actorVisible?: boolean
  startedAt?: number
}

function resolveGrassEffectKind(map: OpeningMapPreview, tileX: number, tileZ: number): HgssGrassEffectKind | undefined {
  const terrain = map.terrain
  if (!terrain || tileX < 0 || tileZ < 0 || tileX >= terrain.width || tileZ >= terrain.height) return undefined
  const behavior = terrain.attributes[tileZ * terrain.width + tileX]! & 0xff
  return behavior === 2 ? 'tallGrass' : behavior === 3 ? 'veryTallGrass' : undefined
}

function createGrassFrameModel(effect: HgssGrassEffect, textureIndex: number): OpeningMapPreview['model'] {
  const texture = effect.textures[textureIndex]
  if (!texture) throw new Error(`La texture ${textureIndex} de l'effet d'herbe ${effect.kind} est absente.`)
  return {
    ...effect.model,
    textures: [texture],
    surfaces: effect.model.surfaces?.map((surface) => ({
      ...surface,
      textureId: texture.id,
      textureName: texture.name,
    })),
  }
}

/**
 * Possede tout le cycle de vie des effets d'herbe lies aux acteurs d'une carte.
 * Le runtime de carte ne conserve que les identifiants d'acteur et lui delegue
 * la creation, l'animation VBlank, la visibilite et la liberation des meshes.
 */
export class HgssGrassEffectLayer {
  readonly group = new THREE.Group()

  private map: OpeningMapPreview | undefined
  private layout: SceneLayout | undefined
  private resolver: RomInventory['grassEffectResolver'] | undefined
  private readonly activeEffects = new Map<string, ActiveGrassEffect>()
  private readonly now: () => number

  constructor(
    parent: THREE.Object3D,
    now: () => number = () => performance.now(),
  ) {
    this.now = now
    this.group.name = 'hgss-grass-effects'
    parent.add(this.group)
  }

  setContext(
    map: OpeningMapPreview,
    layout: SceneLayout,
    resolver: RomInventory['grassEffectResolver'] | undefined,
  ): void {
    if (this.map && this.map !== map) this.clear()
    this.map = map
    this.layout = layout
    this.resolver = resolver
  }

  setActor(
    actorKey: string,
    tileX: number,
    tileZ: number,
    options: HgssGrassEffectActorOptions,
  ): void {
    this.removeActor(actorKey)
    const map = this.map
    const kind = map ? resolveGrassEffectKind(map, tileX, tileZ) : undefined
    if (!kind || !map || !this.resolver) return

    const effect = this.resolver(kind)
    const textureIndexes = [...new Set(effect.timeline.textureIndexes)]
    const frames: GrassEffectFrame[] = []
    try {
      for (const textureIndex of textureIndexes) {
        const sceneMesh = buildSceneMesh(
          { ...map, model: createGrassFrameModel(effect, textureIndex) },
          undefined,
          { indoorDepthLayers: false },
        )
        if (!sceneMesh) throw new Error(`Le modele ROM de l'effet d'herbe ${kind} ne peut pas etre affiche.`)
        const position = projectMapPosition(
          this.layout,
          map,
          tileX,
          tileZ,
          0,
          options.referenceGroundHeight,
        )
        const tileSize = usesWorldMatrixCoordinates(map) ? 1 : 16
        sceneMesh.object.position.set(position.x, position.y, position.z + tileSize * 0.625)
        setActorEffectRenderOrder(
          sceneMesh.object,
          usesWorldMatrixCoordinates(map) ? 0 : getActorSpriteRenderOrder(map, position.z) + 1,
        )
        if (usesWorldMatrixCoordinates(map)) sceneMesh.object.scale.setScalar(1 / 16)
        sceneMesh.object.visible = false
        frames.push({ object: sceneMesh.object, dispose: sceneMesh.dispose })
      }
    } catch (error) {
      for (const frame of frames) frame.dispose()
      throw error
    }

    for (const frame of frames) this.group.add(frame.object)
    const textureIndex = sampleHgssGrassTexture(
      effect.timeline,
      options.animate ? 0 : Number.POSITIVE_INFINITY,
    )
    const actorVisible = options.actorVisible ?? true
    const visibleFrame = textureIndexes.indexOf(textureIndex)
    if (visibleFrame >= 0) frames[visibleFrame]!.object.visible = actorVisible
    this.activeEffects.set(actorKey, {
      frames,
      textureIndexes,
      timeline: effect.timeline,
      startedAt: options.animate ? (options.startedAt ?? this.now()) : Number.NEGATIVE_INFINITY,
      textureIndex,
      actorVisible,
    })
  }

  setActorVisible(actorKey: string, visible: boolean): void {
    const effect = this.activeEffects.get(actorKey)
    if (!effect) return
    effect.actorVisible = visible
    effect.frames.forEach((frame, index) => {
      frame.object.visible = visible && effect.textureIndexes[index] === effect.textureIndex
    })
  }

  hasActor(actorKey: string): boolean {
    return this.activeEffects.has(actorKey)
  }

  removeActor(actorKey: string): void {
    const effect = this.activeEffects.get(actorKey)
    if (!effect) return
    for (const frame of effect.frames) {
      this.group.remove(frame.object)
      frame.dispose()
    }
    this.activeEffects.delete(actorKey)
  }

  update(now: number): void {
    for (const effect of this.activeEffects.values()) {
      if (!Number.isFinite(effect.startedAt)) continue
      const elapsedFrames = Math.max(0, Math.floor((now - effect.startedAt) / hgssVBlankDurationMs))
      const textureIndex = sampleHgssGrassTexture(effect.timeline, elapsedFrames)
      if (textureIndex === effect.textureIndex) continue
      effect.textureIndex = textureIndex
      effect.frames.forEach((frame, index) => {
        frame.object.visible = effect.actorVisible && effect.textureIndexes[index] === textureIndex
      })
      if (elapsedFrames >= effect.timeline.keyFrames[effect.timeline.keyFrames.length - 1]!) {
        effect.startedAt = Number.NEGATIVE_INFINITY
      }
    }
  }

  clear(): void {
    for (const actorKey of [...this.activeEffects.keys()]) this.removeActor(actorKey)
    this.group.clear()
  }

  dispose(): void {
    this.clear()
    this.map = undefined
    this.layout = undefined
    this.resolver = undefined
    this.group.removeFromParent()
  }
}
