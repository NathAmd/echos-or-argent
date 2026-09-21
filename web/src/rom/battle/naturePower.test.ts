import { describe, expect, it } from 'vitest'
import { decodeHgssCamouflageTypeIdsFromOverlay, decodeHgssNaturePowerMoveIdsFromOverlay, decodeHgssSecretPowerEffectIdsFromOverlay, resolveHgssBattleTerrainId } from './naturePower'

describe('table ROM de Force-Nature HGSS', () => {
  it('retrouve les treize capacités de terrain dans un overlay relogeable', () => {
    const expected = [89, 89, 402, 402, 157, 157, 59, 56, 58, 161, 426, 403, 161]
    const overlay = new Uint8Array(10 + expected.length * 2 + 8)
    const view = new DataView(overlay.buffer)
    expected.forEach((moveId, index) => view.setUint16(10 + index * 2, moveId, true))
    expect(decodeHgssNaturePowerMoveIdsFromOverlay(overlay)).toEqual(expected)
  })

  it('rabat les décors spéciaux sur le terrain sentinelle du moteur', () => {
    expect(resolveHgssBattleTerrainId(0)).toBe(0)
    expect(resolveHgssBattleTerrainId(12)).toBe(12)
    expect(resolveHgssBattleTerrainId(16)).toBe(12)
  })

  it('retrouve séparément les types de Camouflage lus dans le même overlay', () => {
    const expected = [4, 4, 12, 12, 5, 5, 15, 11, 15, 0, 4, 2, 0]
    const overlay = new Uint8Array([99, 98, ...expected, 97, 96])
    expect(decodeHgssCamouflageTypeIdsFromOverlay(overlay)).toEqual(expected)
  })

  it('décode les treize effets secondaires bruts de Force Cachée', () => {
    const expected = [0x1b, 0x1b, 1, 1, 8, 8, 4, 0x16, 4, 5, 0x18, 0x1c, 5]
    const overlay = new Uint8Array(8 + expected.length * 4 + 4)
    const view = new DataView(overlay.buffer)
    expected.forEach((effect, index) => view.setUint32(8 + index * 4, effect | 0x80000000, true))
    expect(decodeHgssSecretPowerEffectIdsFromOverlay(overlay)).toEqual(expected)
  })
})
