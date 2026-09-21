import { describe, expect, it } from 'vitest'
import { decodeMapPropAnimationMetadata, resolveMapPropAnimationLoadMode } from './mapPropAnimationMetadata'

function metadata(flags: number, ids = [17, 29]): Uint8Array {
  const bytes = new Uint8Array(0x18)
  const view = new DataView(bytes.buffer)
  bytes.set([1, flags, 0, 0])
  view.setUint32(4, 0x01020304, true)
  ids.forEach((id, index) => view.setInt32(8 + index * 4, id, true))
  view.setInt32(8 + ids.length * 4, -1, true)
  return bytes
}

describe('native MapProp animation metadata', () => {
  it('retains the complete ROM control header and archive order', () => {
    expect(decodeMapPropAnimationMetadata(metadata(3))).toEqual({
      hasAnimations: true,
      flags: 3,
      isBicycleSlope: false,
      controlValue: 0x01020304,
      classId: 4,
      animationArchiveIds: [17, 29],
    })
  })

  it('classifies every native loading path globally', () => {
    expect([0, 2, 3, 8].map((flags) => resolveMapPropAnimationLoadMode(decodeMapPropAnimationMetadata(metadata(flags))!)))
      .toEqual(['automatic', 'deferred-attachment', 'one-shot', 'time-of-day'])
    expect(resolveMapPropAnimationLoadMode(decodeMapPropAnimationMetadata(new Uint8Array(0x18).fill(0xff))!)).toBe('none')
  })
})
