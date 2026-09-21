import * as THREE from 'three'
import { sampleHgssVBlankFrame } from '../../game/time/hgssFrameTiming'
import type { NitroModelPreview, OpeningMapPreview } from '../../ndsTypes'
import { NitroAnimatedModelInstance } from './nitroAnimatedModelInstance'

type ActiveOverlay = {
  key: string
  instance: NitroAnimatedModelInstance
  frames: readonly NitroModelPreview[]
  startedAt: number
  lastFrameIndex: number
  resolve: () => void
}

export class NitroOverlayAnimationPool {
  private readonly group = new THREE.Group()
  private readonly active: ActiveOverlay[] = []
  private readonly capacity: number

  constructor(root: THREE.Object3D, capacity = 3) { this.capacity = capacity; root.add(this.group) }

  clear(): void {
    for (const entry of [...this.active]) this.kill(entry)
    this.group.clear()
  }

  play(
    key: string,
    conflictingKeys: readonly string[],
    map: OpeningMapPreview,
    model: NitroModelPreview,
    frames: readonly NitroModelPreview[],
    position: THREE.Vector3,
    startedAt = performance.now(),
  ): Promise<void> | undefined {
    if (this.active.some((entry) => entry.key === key) || this.active.length >= this.capacity || frames.length === 0) return undefined
    for (const entry of [...this.active]) if (conflictingKeys.includes(entry.key)) this.kill(entry)
    const instance = new NitroAnimatedModelInstance(map, model, this.group)
    instance.object.position.copy(position)
    return new Promise((resolve) => this.active.push({ key, instance, frames, startedAt, lastFrameIndex: -1, resolve }))
  }

  update(now: number): void {
    for (const entry of [...this.active]) {
      const frameIndex = sampleHgssVBlankFrame(now, entry.startedAt)
      if (frameIndex >= entry.frames.length) { this.kill(entry); continue }
      if (entry.lastFrameIndex !== frameIndex) {
        entry.instance.applyFrame(entry.frames[Math.max(0, frameIndex)]!)
        entry.lastFrameIndex = frameIndex
      }
      entry.instance.animate(now)
    }
  }

  dispose(): void { this.clear() }

  private kill(entry: ActiveOverlay): void {
    const index = this.active.indexOf(entry)
    if (index >= 0) this.active.splice(index, 1)
    this.group.remove(entry.instance.object)
    entry.instance.dispose()
    entry.resolve()
  }
}
