import * as THREE from 'three'
import {
  HGSS_FISHING_BITE_TRACKED_Y_OFFSET_FX32,
  HGSS_FISHING_BITE_TRACKED_Z_OFFSET_FX32,
  HGSS_FX32_ONE,
  sampleHgssFishingBiteEffect,
  type HgssFishingBiteEffectAsset,
  type HgssFishingBiteEffectPhase,
} from '../../game/encounters/hgssFishingBiteEffect'
import { usesWorldMatrixCoordinates } from '../../game/world/mapCoordinates'
import { hgssVBlankDurationMs } from '../../game/world/hgssWorldAnimationClock'
import type { NitroModelPreview, NitroTexturePreview, OpeningMapPreview } from '../../ndsTypes'
import { buildSceneMesh } from '../map/mapSceneBuilder'
import { getActorSpriteRenderOrder, setActorEffectRenderOrder } from './actorGroundPresentation'

export type { HgssFishingBiteEffectAsset } from '../../game/encounters/hgssFishingBiteEffect'
export type HgssFishingBiteEffectTarget = 'player' | 'follower'

export type HgssFishingBiteEffectWorldSample = {
  position: readonly [x: number, y: number, z: number]
  scale: number
  textureAddressOffset: number
  visible: boolean
  phase: HgssFishingBiteEffectPhase
  animationComplete: boolean
}

type FishingBiteFrame = { object: THREE.Object3D, dispose: () => void }
type ActiveFishingBiteEffect = {
  map: OpeningMapPreview
  target: HgssFishingBiteEffectTarget
  frames: Map<number, FishingBiteFrame>
  startedAt: number
}

/**
 * Convertit les offsets MapObject fx32 de ov01_021F93AC dans le domaine Three.
 * Le `facingVector` natif est l'offset transitoire du mouvement, pas la direction
 * cardinale. L'ancre web est deja la position interpolee/rendue de l'acteur :
 * aucun deplacement artificiel d'une case selon son orientation n'est ajoute.
 */
export function resolveHgssFishingBiteEffectWorldSample(
  anchor: readonly [x: number, y: number, z: number],
  elapsedUpdates: number,
  worldMatrixCoordinates: boolean,
): HgssFishingBiteEffectWorldSample {
  if (anchor.some((component) => !Number.isFinite(component))) {
    throw new Error(`L'ancre monde de la touche de peche HGSS [${anchor.join(', ')}] est invalide.`)
  }
  const sample = sampleHgssFishingBiteEffect(elapsedUpdates)
  const unitScale = worldMatrixCoordinates ? 1 / 16 : 1
  return {
    position: [
      anchor[0],
      anchor[1] + (HGSS_FISHING_BITE_TRACKED_Y_OFFSET_FX32 + sample.verticalOffsetFx32) / HGSS_FX32_ONE * unitScale,
      anchor[2] + HGSS_FISHING_BITE_TRACKED_Z_OFFSET_FX32 / HGSS_FX32_ONE * unitScale,
    ],
    scale: unitScale,
    textureAddressOffset: sample.textureAddressOffset,
    // ov01_02200540 masque le modele a l'initialisation; le premier callback
    // ov01_02200614 le rend visible apres avoir applique la premiere impulsion.
    visible: elapsedUpdates > 0,
    phase: sample.phase,
    animationComplete: sample.animationComplete,
  }
}

function createFrameModel(effect: HgssFishingBiteEffectAsset, texture: NitroTexturePreview): NitroModelPreview {
  return {
    ...effect.model,
    textures: [texture],
    surfaces: effect.model.surfaces?.map((surface) => ({
      ...surface,
      textureId: texture.id,
      textureName: texture.name,
      paletteName: texture.paletteName,
    })),
  }
}

function disableFog(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return
    const materials = Array.isArray(child.material) ? child.material : [child.material]
    for (const material of materials) {
      if (!(material instanceof THREE.MeshLambertMaterial) && !(material instanceof THREE.MeshPhysicalMaterial)) continue
      material.fog = false
      material.needsUpdate = true
    }
  })
}

/** Couche 3D unique de l'effet ROM 0x44; elle reste active jusqu'a stop(). */
export class HgssFishingBiteEffectLayer {
  readonly group = new THREE.Group()
  private active: ActiveFishingBiteEffect | undefined

  constructor(parent: THREE.Object3D) {
    this.group.name = 'hgss-fishing-bite-effect'
    parent.add(this.group)
  }

  start(
    map: OpeningMapPreview,
    effect: HgssFishingBiteEffectAsset,
    target: HgssFishingBiteEffectTarget,
    anchor: THREE.Vector3,
    startedAt = performance.now(),
  ): void {
    const textureAddressOffset = effect.timeline.textureAddressOffsets[0]
    if (textureAddressOffset === undefined || effect.timeline.paletteAddressOffsets[0] === undefined) {
      throw new Error('La timeline ROM de la touche de peche HGSS est vide.')
    }
    const frames = new Map<number, FishingBiteFrame>()
    try {
      // ov01_02200614 ne fait pas avancer sub_02023F04 : le renderer reste sur
      // l'adresse texture/palette de la cle zero de la timeline 140.
      const sceneMesh = buildSceneMesh(
        { ...map, model: createFrameModel(effect, effect.texture) },
        undefined,
        { indoorDepthLayers: false, replaceLegacyPropShadows: true },
      )
      if (!sceneMesh) throw new Error(`Le modele ROM de la touche de peche HGSS ne peut pas etre affiche.`)
      disableFog(sceneMesh.object)
      sceneMesh.object.visible = false
      frames.set(textureAddressOffset, { object: sceneMesh.object, dispose: sceneMesh.dispose })
    } catch (error) {
      for (const frame of frames.values()) frame.dispose()
      throw error
    }

    this.stop()
    for (const frame of frames.values()) this.group.add(frame.object)
    this.active = { map, target, frames, startedAt }
    this.present(anchor, 0)
  }

  stop(target?: HgssFishingBiteEffectTarget): void {
    const active = this.active
    if (!active || (target !== undefined && active.target !== target)) return
    this.active = undefined
    for (const frame of active.frames.values()) {
      this.group.remove(frame.object)
      frame.dispose()
    }
  }

  clear(): void { this.stop() }

  isActive(target?: HgssFishingBiteEffectTarget): boolean {
    return Boolean(this.active && (target === undefined || this.active.target === target))
  }

  update(now: number, resolveAnchor: (target: HgssFishingBiteEffectTarget) => THREE.Vector3 | undefined): void {
    const active = this.active
    if (!active) return
    const anchor = resolveAnchor(active.target)
    if (!anchor) {
      this.stop(active.target)
      return
    }
    const elapsedUpdates = Math.max(0, Math.floor((now - active.startedAt) / hgssVBlankDurationMs))
    this.present(anchor, elapsedUpdates)
  }

  dispose(): void {
    this.stop()
    this.group.removeFromParent()
  }

  private present(anchor: THREE.Vector3, elapsedUpdates: number): void {
    const active = this.active
    if (!active) return
    const presentation = resolveHgssFishingBiteEffectWorldSample(
      [anchor.x, anchor.y, anchor.z],
      elapsedUpdates,
      usesWorldMatrixCoordinates(active.map),
    )
    const visibleFrame = active.frames.get(presentation.textureAddressOffset)
    if (!visibleFrame) throw new Error(`La frame ROM ${presentation.textureAddressOffset} de la touche de peche HGSS est absente.`)
    for (const frame of active.frames.values()) {
      frame.object.position.fromArray(presentation.position)
      frame.object.scale.setScalar(presentation.scale)
      frame.object.visible = presentation.visible && frame === visibleFrame
      setActorEffectRenderOrder(frame.object, getActorSpriteRenderOrder(active.map, presentation.position[2]) + 1)
    }
  }
}
