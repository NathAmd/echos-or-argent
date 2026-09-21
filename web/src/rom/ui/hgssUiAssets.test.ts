import { describe, expect, it } from 'vitest'
import { decodeHgssUiAssets, resolvePokegearLocationPreviewMember } from './hgssUiAssets'

describe('HGSS UI assets', () => {
  it('requires the proven window-frame archive instead of selecting an arbitrary graphic', () => {
    expect(() => decodeHgssUiAssets(new Uint8Array(), [])).toThrow('/pbr/winframe.narc')
  })

  it("résout les variantes horaires exactes des écrans d'entrée ROM", () => {
    expect([0, 1, 2, 3].map((time) => resolvePokegearLocationPreviewMember(117, time as 0 | 1 | 2 | 3))).toEqual([54, 57, 60, 63])
    expect([0, 1, 2, 3].map((time) => resolvePokegearLocationPreviewMember(120, time as 0 | 1 | 2 | 3))).toEqual([123, 126, 126, 129])
    expect(resolvePokegearLocationPreviewMember(491, 3)).toBe(33)
    expect(resolvePokegearLocationPreviewMember(1, 1)).toBeUndefined()
  })
})
