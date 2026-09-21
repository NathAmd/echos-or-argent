import * as THREE from 'three'
import { hgssVBlanksToMilliseconds } from '../../game/time/hgssFrameTiming'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { getVioletGymElevatorHeight, violetGymElevator } from '../../game/gyms/violetGymMechanism'
import { buildSceneMesh, type SceneMeshPreview } from '../map/mapSceneBuilder'

type ElevatorMotion = {
  fromY: number
  toY: number
  startedAt: number
  durationMs: number
  resolve: () => void
}

export class VioletGymElevatorLayer {
  private readonly group = new THREE.Group()
  private scene?: SceneMeshPreview
  private motion?: ElevatorMotion

  constructor(root: THREE.Object3D) { root.add(this.group) }

  clear(): void {
    this.motion?.resolve()
    this.motion = undefined
    this.scene?.dispose()
    this.scene = undefined
    this.group.clear()
  }

  sync(map: OpeningMapPreview, data: Uint8Array, resolver: RomInventory['mapPropModelResolver']): void {
    this.clear()
    if (map.id !== 135 || !resolver || !map.terrain) return
    const model = resolver(violetGymElevator.modelId, map.header.areaDataBank, 'room')
    if (!model) throw new Error(`Le modèle ROM ${violetGymElevator.modelId} de l’ascenseur de Mauville est absent.`)
    const scene = buildSceneMesh({ ...map, model }, undefined, { indoorDepthLayers: false, replaceLegacyPropShadows: true })
    if (!scene) throw new Error('Le modèle ROM de l’ascenseur de Mauville ne peut pas être affiché.')
    scene.object.position.set(248 - map.terrain.width * 8, getVioletGymElevatorHeight(data), 328 - map.terrain.height * 8)
    this.group.add(scene.object)
    this.scene = scene
  }

  play(targetY: number, durationFrames: number, startedAt = performance.now()): Promise<void> {
    if (!this.scene) return Promise.reject(new Error('L’ascenseur ROM de Mauville est absent de la scène active.'))
    this.motion?.resolve()
    return new Promise((resolve) => {
      this.motion = {
        fromY: this.scene!.object.position.y,
        toY: targetY,
        startedAt,
        durationMs: hgssVBlanksToMilliseconds(Math.max(1, durationFrames)),
        resolve,
      }
    })
  }

  update(now: number): void {
    this.scene?.animate?.(now)
    const motion = this.motion
    if (!motion || !this.scene) return
    const progress = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.durationMs))
    this.scene.object.position.y = THREE.MathUtils.lerp(motion.fromY, motion.toY, progress)
    if (progress < 1) return
    this.motion = undefined
    motion.resolve()
  }

  dispose(): void { this.clear() }
}
