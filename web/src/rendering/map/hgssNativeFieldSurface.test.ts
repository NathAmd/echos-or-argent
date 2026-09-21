import { describe, expect, it } from 'vitest'
import type { NitroTextureAnimationPreview } from '../../ndsTypes'
import { hgssNativeWaterTextureAnimationNames, isHgssNativeWaterTextureAnimation } from './hgssNativeFieldSurface'

const animation = (name: string): NitroTextureAnimationPreview => ({ name, sourceMemberIndex: 1, frames: [] })

describe('HGSS native field surface presentation', () => {
  it.each(hgssNativeWaterTextureAnimationNames)('recognizes the decoded ROM water animation %s', (name) => {
    expect(isHgssNativeWaterTextureAnimation(animation(name))).toBe(true)
  })

  it('does not infer water from an unverified material-like name', () => {
    expect(isHgssNativeWaterTextureAnimation(animation('water_custom'))).toBe(false)
    expect(isHgssNativeWaterTextureAnimation(animation('flower01'))).toBe(false)
    expect(isHgssNativeWaterTextureAnimation(undefined)).toBe(false)
  })
})
