import * as THREE from 'three'
import { hgssVBlanksToMilliseconds } from '../../game/time/hgssFrameTiming'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { BlackthornGymActionResult, BlackthornGymPlatform } from '../../game/gyms/blackthornGymMechanism'
import { readBlackthornGymPlatforms } from '../../game/gyms/blackthornGymMechanism'
import { buildSceneMesh, type SceneMeshPreview } from '../map/mapSceneBuilder'

type PlatformRuntime = { scene: SceneMeshPreview, platform: BlackthornGymPlatform }
type ActiveMotion = {
  entry: PlatformRuntime
  startPosition: THREE.Vector3
  targetPosition: THREE.Vector3
  startRotation: number
  targetRotation: number
  startedAt: number
  durationMs: number
  applied: boolean
  resolve: () => void
}

function platformPosition(map: OpeningMapPreview, platform: BlackthornGymPlatform): THREE.Vector3 {
  const terrain = map.terrain
  if (!terrain) throw new Error(`La carte ${map.id} de l’arène d’Ébènelle n’a aucun terrain ROM.`)
  return new THREE.Vector3(
    platform.x * 16 + 8 - terrain.width * 8,
    48,
    platform.z * 16 + 8 - terrain.height * 8,
  )
}

export class BlackthornGymPlatformLayer {
  private readonly group = new THREE.Group()
  private readonly entries: PlatformRuntime[] = []
  private motion?: ActiveMotion

  constructor(root: THREE.Object3D) { root.add(this.group) }

  clear(): void {
    this.motion?.resolve()
    this.motion = undefined
    for (const entry of this.entries) entry.scene.dispose()
    this.entries.length = 0
    this.group.clear()
  }

  sync(map: OpeningMapPreview, data: Uint8Array, resolver: RomInventory['mapPropModelResolver']): void {
    this.clear()
    if (map.id !== 141 || !resolver) return
    const modelIds = [120, 121, 120] as const
    for (const platform of readBlackthornGymPlatforms(data)) {
      const model = resolver(modelIds[platform.index]!, map.header.areaDataBank, 'room')
      if (!model) throw new Error(`Le modèle ROM ${modelIds[platform.index]} de la plateforme ${platform.index} d’Ébènelle est absent.`)
      const scene = buildSceneMesh({ ...map, model }, undefined, { indoorDepthLayers: false, replaceLegacyPropShadows: true })
      if (!scene) throw new Error(`La plateforme ROM ${platform.index} d’Ébènelle ne peut pas être affichée.`)
      scene.object.position.copy(platformPosition(map, platform))
      scene.object.rotation.y = -platform.rotation * Math.PI / 2
      this.group.add(scene.object)
      this.entries.push({ scene, platform })
    }
  }

  play(map: OpeningMapPreview, result: BlackthornGymActionResult, startedAt = performance.now()): Promise<void> {
    const entry = this.entries[result.action.platformIndex]
    if (!entry) return Promise.resolve()
    this.motion?.resolve()
    const startRotation = entry.scene.object.rotation.y
    const targetRotation = result.action.kind === 'rotate' && result.applied
      ? startRotation - Math.PI / 2
      : -result.platform.rotation * Math.PI / 2
    return new Promise((resolve) => {
      this.motion = {
        entry,
        startPosition: entry.scene.object.position.clone(),
        targetPosition: platformPosition(map, result.platform),
        startRotation,
        targetRotation,
        startedAt,
        durationMs: Math.max(1, hgssVBlanksToMilliseconds(result.durationFrames)),
        applied: result.applied,
        resolve,
      }
      entry.platform = result.platform
    })
  }

  update(now: number): void {
    const motion = this.motion
    if (!motion) {
      for (const entry of this.entries) entry.scene.animate?.(now)
      return
    }
    const linear = Math.min(1, Math.max(0, (now - motion.startedAt) / motion.durationMs))
    const eased = linear * linear * (3 - 2 * linear)
    if (motion.applied) {
      motion.entry.scene.object.position.lerpVectors(motion.startPosition, motion.targetPosition, eased)
      motion.entry.scene.object.rotation.y = motion.startRotation + (motion.targetRotation - motion.startRotation) * eased
    } else {
      const bonk = Math.sin(linear * Math.PI * 2) * (1 - linear) * .08
      motion.entry.scene.object.rotation.y = motion.startRotation + bonk
    }
    motion.entry.scene.animate?.(now)
    if (linear >= 1) {
      motion.entry.scene.object.position.copy(motion.targetPosition)
      motion.entry.scene.object.rotation.y = motion.targetRotation
      this.motion = undefined
      motion.resolve()
    }
  }

  dispose(): void { this.clear() }
}
