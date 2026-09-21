export type MapPropAnimationMetadata = {
  hasAnimations: boolean
  flags: number
  isBicycleSlope: boolean
  controlValue: number
  classId: number
  animationArchiveIds: number[]
}

export type MapPropAnimationLoadMode = 'automatic' | 'deferred-attachment' | 'one-shot' | 'time-of-day' | 'none'

export function decodeMapPropAnimationMetadata(bytes: Uint8Array): MapPropAnimationMetadata | undefined {
  if (bytes.length < 0x18) return undefined
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const hasAnimations = view.getUint8(0) === 1
  const controlValue = view.getUint32(4, true)
  const animationArchiveIds: number[] = []
  if (hasAnimations) for (let offset = 8; offset < 0x18; offset += 4) {
    const archiveId = view.getInt32(offset, true)
    if (archiveId === -1) break
    animationArchiveIds.push(archiveId)
  }
  return {
    hasAnimations,
    flags: view.getUint8(1),
    isBicycleSlope: view.getUint8(2) === 1,
    controlValue,
    classId: controlValue & 0xff,
    animationArchiveIds,
  }
}

/** Reproduit MapPropAnimation_CheckDeferredLoadingFlag. */
export function isMapPropAnimationDeferredLoading(flags: number): boolean {
  return flags !== 1 << 3 && (flags & 1) !== 0
}

/** Reproduit MapPropAnimation_CheckDeferredAddToRenderObjFlag. */
export function isMapPropAnimationDeferredAttachment(flags: number): boolean {
  return flags === 1 << 3 || (flags & (1 << 1)) !== 0
}

export function resolveMapPropAnimationLoadMode(metadata: MapPropAnimationMetadata): MapPropAnimationLoadMode {
  if (!metadata.hasAnimations || metadata.animationArchiveIds.length === 0) return 'none'
  if (metadata.flags === 1 << 3) return 'time-of-day'
  if (isMapPropAnimationDeferredLoading(metadata.flags)) return 'one-shot'
  if (isMapPropAnimationDeferredAttachment(metadata.flags)) return 'deferred-attachment'
  return 'automatic'
}
