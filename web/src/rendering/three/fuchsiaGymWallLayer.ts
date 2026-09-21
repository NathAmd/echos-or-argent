import * as THREE from 'three'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { FuchsiaGymWall } from '../../game/gyms/fuchsiaGymMechanism'
import { composeNitroModelAnimationFrames } from '../../rom/model/nitroModelFrameComposition'
import { NitroOverlayAnimationPool } from './nitroOverlayAnimationPool'

const archivePath = '/a/2/4/6'

export class FuchsiaGymWallLayer {
  private readonly pool: NitroOverlayAnimationPool

  constructor(root: THREE.Object3D) { this.pool = new NitroOverlayAnimationPool(root, 3) }

  clear(): void { this.pool.clear() }

  play(map: OpeningMapPreview, wall: FuchsiaGymWall, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver'], startedAt = performance.now()): Promise<void> | undefined {
    if (map.id !== 480 || !map.terrain || !modelResolver || !animationResolver) return undefined
    const model = modelResolver(archivePath, wall.modelId)
    if (!model) return Promise.reject(new Error(`Le segment ROM ${wall.modelId} du mur de Parmanie est absent.`))
    const tracks = Array.from({ length: 4 }, (_, track) => animationResolver(archivePath, wall.modelId, 12 + track * 12 + wall.modelId)?.frames)
    if (tracks.some((frames) => !frames?.length)) return Promise.reject(new Error(`Les animations ROM du mur ${wall.id} de Parmanie sont absentes.`))
    const frames = composeNitroModelAnimationFrames(model, tracks as NonNullable<typeof tracks[number]>[])
    const position = new THREE.Vector3((wall.x + wall.xOffset) * 16 + 8 - map.terrain.width * 8, groundHeight, (wall.z + wall.zOffset) * 16 + 8 - map.terrain.height * 8)
    return this.pool.play(String(wall.id), wall.neighbors.map(String), map, model, frames, position, startedAt)
  }

  update(now: number): void { this.pool.update(now) }

  dispose(): void { this.pool.dispose() }
}
