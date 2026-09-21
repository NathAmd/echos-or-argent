import type { NitroMapPropPreview } from '../../ndsTypes'
import { hgssVBlanksToMilliseconds } from '../../game/time/hgssFrameTiming'
import type { MapPropAnimationMetadata } from '../model/mapPropAnimationMetadata'

export type { MapPropAnimationMetadata } from '../model/mapPropAnimationMetadata'

export type DoorTransitionDescriptor = {
  tag: 1
  modelId: number
  classId: number
  animationArchiveIds: number[]
  prop: NitroMapPropPreview
}

const doorSoundSequences: Record<number, readonly [open: number, close: number] | undefined> = {
  1: [1540, 1542],
  2: [1543, 0],
  3: [1499, 0],
  4: [2325, 2326],
}

// Les pistes ROM ne comptent que 8 à 12 poses. Les présenter sur deux images
// navigateur par pose évite que l'ouverture et la fermeture se confondent sur
// les écrans modernes, tout en conservant chaque pose et leur ordre natifs.
export const doorPoseHoldVBlanks = 2
export const doorAnimationFrameDurationMs = hgssVBlanksToMilliseconds(doorPoseHoldVBlanks)

export function resolveDoorAnimationDurationMs(frameCount: number): number {
  return Math.max(1, Math.floor(frameCount)) * doorAnimationFrameDurationMs
}

export function resolveDoorSoundSequence(classId: number, isOpen: boolean): number | undefined {
  return doorSoundSequences[classId]?.[isOpen ? 0 : 1]
}

export function resolveDoorTransitionDescriptor(
  playerX: number,
  playerZ: number,
  orderedProps: readonly NitroMapPropPreview[],
  resolveMetadata: (modelId: number) => MapPropAnimationMetadata | undefined,
  phase: 'entry' | 'arrival' | 'script' = 'entry',
  resolvePosition: (prop: NitroMapPropPreview) => { x: number, z: number } = (prop) => ({ x: prop.position[0], z: prop.position[2] }),
): DoorTransitionDescriptor | undefined {
  const minZ = phase === 'entry' ? playerZ - 1 : playerZ
  const maxZ = phase === 'entry' ? playerZ : playerZ + 1
  const maxX = phase === 'arrival' ? playerX + 3 : playerX + 2
  const candidates = orderedProps.filter((prop) => {
    if (prop.modelId === 0) return false
    const position = resolvePosition(prop)
    return position.x >= playerX - 1
      && position.x <= maxX
      && position.z >= minZ
      && position.z <= maxZ
  })

  for (const prop of candidates.slice(0, 4)) {
    const metadata = resolveMetadata(prop.modelId)
    const eligible = phase === 'arrival'
      ? metadata?.animationArchiveIds[0] !== undefined && metadata.animationArchiveIds[0] !== 0
      : metadata?.classId !== 0
    if (!metadata || !eligible || metadata.animationArchiveIds.length < 2) continue
    return {
      tag: 1,
      modelId: prop.modelId,
      classId: metadata.classId,
      animationArchiveIds: [...metadata.animationArchiveIds],
      prop,
    }
  }
  return undefined
}
