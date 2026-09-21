import { describe, expect, it } from 'vitest'
import { getHgssSpecialMartItemIds, getHgssStandardMartItemIds } from './hgssMarts'

describe('HGSS marts', () => {
  it('applies the native badge tiers to the standard inventory', () => {
    expect(getHgssStandardMartItemIds(0)).toEqual([4, 17, 18, 22])
    expect(getHgssStandardMartItemIds(8)).toHaveLength(19)
  })

  it('returns an isolated copy of the native special-mart list', () => {
    const first = getHgssSpecialMartItemIds(0)
    first.push(999)
    expect(getHgssSpecialMartItemIds(0)).toEqual([146, 14])
    expect(() => getHgssSpecialMartItemIds(30)).toThrow('absente')
  })
})
