import { describe, expect, it } from 'vitest'
import type { MapMatrixPreview } from '../../ndsTypes'
import { createHgssWednesdayLakeMatrix, shouldUseHgssWednesdayLakeVariant } from './hgssWeeklyWorld'

describe('variante hebdomadaire du Lac Colère', () => {
  it('ne s’active que le mercredi après la planque Rocket', () => {
    expect(shouldUseHgssWednesdayLakeVariant(88, 3, true)).toBe(true)
    expect(shouldUseHgssWednesdayLakeVariant(45, 3, true)).toBe(true)
    expect(shouldUseHgssWednesdayLakeVariant(88, 2, true)).toBe(false)
    expect(shouldUseHgssWednesdayLakeVariant(88, 3, false)).toBe(false)
    expect(shouldUseHgssWednesdayLakeVariant(89, 3, true)).toBe(false)
  })

  it('remplace exactement les six modèles de matrice de la ROM', () => {
    const matrix: MapMatrixPreview = {
      matrixIndex: 0,
      name: 'EVERYWHERE',
      width: 20,
      height: 3,
      headers: new Uint16Array(60),
      altitudes: new Uint8Array(60),
      modelIds: Uint16Array.from({ length: 60 }, (_, index) => index),
    }
    const variant = createHgssWednesdayLakeMatrix(matrix)
    expect([...variant.modelIds.slice(35, 38), ...variant.modelIds.slice(55, 58)]).toEqual([95, 96, 97, 98, 99, 100])
    expect(matrix.modelIds[35]).toBe(35)
  })
})
