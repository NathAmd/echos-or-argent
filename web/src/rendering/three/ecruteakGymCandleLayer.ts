import * as THREE from 'three'
import { sampleHgssVBlankFrame } from '../../game/time/hgssFrameTiming'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { ecruteakGymCandleObjectIds, ecruteakGymPresentation, isEcruteakGymCandleExtinguished } from '../../game/gyms/ecruteakGymMechanism'
import { projectMapPosition } from '../map/mapProjection'
import { buildSceneMesh, type SceneMeshPreview } from '../map/mapSceneBuilder'

export type EcruteakGymCandlePosition = { objectId: number, tileX: number, tileZ: number }
type CandleRuntime = { scene: SceneMeshPreview, objectId: number }
type CandleMotion = { candle: CandleRuntime, startedAt: number, resolve: () => void }

export class EcruteakGymCandleLayer {
  private readonly group = new THREE.Group()
  private readonly scene: THREE.Scene
  private readonly candles = new Map<number, CandleRuntime>()
  private motion?: CandleMotion
  private trackedObjectId?: number

  constructor(scene: THREE.Scene) { this.scene = scene; scene.add(this.group) }

  clear(): void {
    this.motion?.resolve()
    this.motion = undefined
    this.trackedObjectId = undefined
    for (const candle of this.candles.values()) candle.scene.dispose()
    this.candles.clear()
    this.group.clear()
    this.scene.fog = null
  }

  sync(map: OpeningMapPreview, data: Uint8Array, positions: readonly EcruteakGymCandlePosition[], resolver: RomInventory['mapPropModelResolver']): void {
    this.clear()
    if (map.id !== 80 || !resolver) return
    const model = resolver(ecruteakGymPresentation.modelId, map.header.areaDataBank, 'room')
    if (!model) throw new Error(`Le modèle ROM ${ecruteakGymPresentation.modelId} des chandelles de Rosalia est absent.`)
    for (const objectId of ecruteakGymCandleObjectIds) {
      const position = positions.find((candidate) => candidate.objectId === objectId)
      if (!position) throw new Error(`Le Dresseur ROM ${objectId} portant une chandelle à Rosalia est absent.`)
      const scene = buildSceneMesh({ ...map, model }, undefined, { indoorDepthLayers: false, replaceLegacyPropShadows: true })
      if (!scene) throw new Error(`La chandelle ROM du Dresseur ${objectId} à Rosalia ne peut pas être affichée.`)
      scene.object.position.copy(projectMapPosition(undefined, map, position.tileX, position.tileZ, 0))
      scene.object.visible = !isEcruteakGymCandleExtinguished(data, objectId)
      scene.object.traverse((child) => { if (child instanceof THREE.Mesh) child.renderOrder += Math.round(scene.object.position.z * 100) })
      this.group.add(scene.object)
      this.candles.set(objectId, { scene, objectId })
    }
    this.scene.fog = new THREE.Fog(ecruteakGymPresentation.fogColor, 0, Number.EPSILON)
  }

  track(objectId: number | undefined): void { this.trackedObjectId = this.candles.has(objectId ?? -1) ? objectId : undefined }

  light(objectId: number): void {
    const candle = this.candles.get(objectId)
    if (!candle) return
    candle.scene.object.scale.setScalar(1)
    candle.scene.object.visible = true
  }

  extinguish(objectId: number, startedAt = performance.now()): Promise<void> {
    const candle = this.candles.get(objectId)
    if (!candle) return Promise.reject(new Error(`La chandelle ROM ${objectId} de Rosalia est absente de la scène.`))
    this.motion?.resolve()
    candle.scene.object.visible = true
    return new Promise((resolve) => { this.motion = { candle, startedAt, resolve } })
  }

  update(now: number, resolveTrackedPosition: (objectId: number) => THREE.Vector3 | undefined): void {
    for (const candle of this.candles.values()) candle.scene.animate?.(now)
    const tracked = this.trackedObjectId === undefined ? undefined : this.candles.get(this.trackedObjectId)
    const trackedPosition = tracked ? resolveTrackedPosition(tracked.objectId) : undefined
    if (tracked && trackedPosition) tracked.scene.object.position.copy(trackedPosition)
    const motion = this.motion
    if (!motion) return
    const frame = Math.min(ecruteakGymPresentation.extinguishScales.length, sampleHgssVBlankFrame(now, motion.startedAt))
    const scale = ecruteakGymPresentation.extinguishScales[Math.min(frame, ecruteakGymPresentation.extinguishScales.length - 1)]!
    motion.candle.scene.object.scale.setScalar(scale)
    if (frame < ecruteakGymPresentation.extinguishScales.length) return
    motion.candle.scene.object.visible = false
    motion.candle.scene.object.scale.setScalar(1)
    this.motion = undefined
    motion.resolve()
  }

  dispose(): void { this.clear(); this.group.removeFromParent() }
}
