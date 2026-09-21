import * as THREE from 'three'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { getViridianGymTileAnimationIndex } from '../../game/gyms/viridianGymMechanism'
import { NitroOverlayAnimationPool } from './nitroOverlayAnimationPool'

const archivePath = '/a/2/5/5'

export class ViridianGymTileLayer {
  private readonly pool: NitroOverlayAnimationPool
  private sequence = 0

  constructor(root: THREE.Object3D) { this.pool = new NitroOverlayAnimationPool(root, 3) }

  clear(): void { this.pool.clear() }

  play(map: OpeningMapPreview, behavior: number, tileX: number, tileZ: number, groundHeight: number, modelResolver: RomInventory['gymOverlayModelResolver'], animationResolver: RomInventory['gymOverlayAnimationResolver'], startedAt = performance.now()): Promise<void> | undefined {
    const index = getViridianGymTileAnimationIndex(behavior)
    if (map.id !== 496 || index === undefined || !map.terrain || !modelResolver || !animationResolver) return undefined
    const model = modelResolver(archivePath, 4 + index)
    const animation = animationResolver(archivePath, 4 + index, index)
    if (!model || !animation?.frames.length) return Promise.reject(new Error(`L’animation ROM ${index} des flèches de Jadielle est absente.`))
    const position = new THREE.Vector3(tileX * 16 + 8 - map.terrain.width * 8, groundHeight, tileZ * 16 + 8 - map.terrain.height * 8)
    return this.pool.play(`tile:${this.sequence++}`, [], map, model, animation.frames, position, startedAt)
  }

  update(now: number): void { this.pool.update(now) }
  dispose(): void { this.pool.dispose() }
}
