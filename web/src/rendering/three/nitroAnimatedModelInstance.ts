import * as THREE from 'three'
import type { NitroModelPreview, OpeningMapPreview } from '../../ndsTypes'
import { buildSceneMesh, type SceneMeshPreview } from '../map/mapSceneBuilder'
import {
  applyNitroMapPropFrame,
  createNitroMapPropRuntime,
  disposeNitroMapPropFrameTextures,
  type NitroMapPropRuntime,
} from './nitroMapPropRuntime'

export class NitroAnimatedModelInstance {
  readonly object: THREE.Object3D
  private readonly scene: SceneMeshPreview
  private readonly runtime: NitroMapPropRuntime

  constructor(map: OpeningMapPreview, model: NitroModelPreview, parent: THREE.Object3D) {
    const scene = buildSceneMesh({ ...map, model }, undefined, { indoorDepthLayers: false, replaceLegacyPropShadows: true })
    if (!scene) throw new Error(`Le modèle Nitro ${model.modelId} ne peut pas être affiché.`)
    this.scene = scene
    this.object = scene.object
    this.runtime = createNitroMapPropRuntime(this.object, model)
    parent.add(this.object)
  }

  applyFrame(frame: NitroModelPreview): void { applyNitroMapPropFrame(this.runtime, frame) }

  animate(now: number): void { this.scene.animate?.(now) }

  dispose(): void {
    disposeNitroMapPropFrameTextures(this.runtime)
    this.scene.dispose()
  }
}
