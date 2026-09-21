import { describe, expect, it } from 'vitest'
import { decodeHgssPokegearMapDataFromOverlay } from './mapData'

function createOverlay(): Uint8Array {
  const overlay = new Uint8Array(4_000)
  const locations = 64
  overlay.set([
    0x09, 0x02, 19, 2, 0x33, 0xc0, 65, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    0x33, 0x01, 24, 16, 0x33, 0xc0, 69, 0, 0, 0, 0, 0, 0, 0, 0, 0,
    120, 0, 21, 6, 0x11, 0, 55, 0, 0, 0, 0, 0, 5, 40, 1, 1,
  ], locations)
  const view = new DataView(overlay.buffer)
  for (let index = 3; index < 100; index += 1) {
    const offset = locations + index * 16
    view.setUint16(offset, index, true)
    view.setUint16(offset + 4, 0x11, true)
  }
  const flypoints = 2_000
  const first = [49, 0, 49, 0, 0, 0, 32, 11, 0, 20, 0x11, 0x33, 0x11, 0]
  const second = [50, 0, 50, 0, 1, 1, 31, 7, 5, 20, 0x22, 0x44, 0x11, 0]
  const third = [51, 0, 51, 0, 2, 2, 32, 2, 10, 20, 0x22, 0x44, 0x11, 0]
  overlay.set([...first, ...second, ...third], flypoints)
  for (let index = 3; index < 27; index += 1) {
    const offset = flypoints + index * 14
    view.setUint16(offset, 49 + index, true)
    view.setUint16(offset + 2, 49 + index, true)
    view.setUint8(offset + 4, index)
    view.setUint8(offset + 6, index)
    view.setUint8(offset + 7, index)
    view.setUint8(offset + 10, 0x11)
  }
  return overlay
}

describe('tables Carte du Pokematos HGSS', () => {
  it('decode les 100 zones et les 27 points de Vol depuis l overlay', () => {
    const data = decodeHgssPokegearMapDataFromOverlay(createOverlay())
    expect(data.locations).toHaveLength(100)
    expect(data.flypoints).toHaveLength(27)
    expect(data.locations[0]).toMatchObject({ mapId: 521, x: 19, y: 2, width: 3, height: 3, objectOffsetY: 12, flavorMessageId: 65 })
    expect(data.flypoints[1]).toMatchObject({ nameMapId: 50, warpMapId: 50, flagIndex: 1, x: 31, y: 7, width: 2, height: 2 })
  })

  it('refuse une table partielle au lieu de fabriquer des donnees', () => {
    expect(() => decodeHgssPokegearMapDataFromOverlay(new Uint8Array(80))).toThrow('unique')
  })
})
