import { describe, expect, it } from 'vitest'
import { hgssAllGymMapIds, hgssBadgeAwardMapIds, hgssGymMapCatalog } from './hgssGymMapCatalog'

describe('HGSS native gym map catalog', () => {
  it('separates the sixteen physical gyms from their badge-award locations', () => {
    expect(hgssGymMapCatalog).toHaveLength(16)
    expect(hgssGymMapCatalog.map(({ badgeIndex }) => badgeIndex)).toEqual(Array.from({ length: 16 }, (_, index) => index))
    expect(hgssAllGymMapIds).toHaveLength(18)
    expect(new Set(hgssAllGymMapIds).size).toBe(18)
    expect(hgssGymMapCatalog[6]).toMatchObject({ gymMapIds: [397, 396, 140], badgeAwardMapId: 140 })
    expect(hgssGymMapCatalog[7]).toMatchObject({ gymMapIds: [141], badgeAwardMapId: 288 })
    expect(hgssBadgeAwardMapIds).toHaveLength(16)
  })
})
