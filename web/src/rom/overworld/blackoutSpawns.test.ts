import { describe, expect, it } from 'vitest'
import { locateHgssSpawnTable } from './blackoutSpawns'

describe('HGSS blackout spawn table', () => {
  it('locates the unique ARM9 table from native flags and death coordinates', () => {
    const arm9 = new Uint8Array(800)
    const view = new DataView(arm9.buffer)
    const flags = [
      0x30b, 0x30c, 0x30d, 0x30e, 0x30f, 0x310, 0x311, 0x312, 0x313, 0x214,
      0x315, 0x316, 0x200, 0x301, 0x302, 0x303, 0x304, 0x305, 0x306, 0x307,
      0x208, 0x309, 0x30a, 0x31e, 0x31f, 0x023, 0x021, 0x11b, 0x124, 0x125,
    ]
    const coordinates = [0x0806, ...Array(20).fill(0x0d08), 0x1506, ...Array(8).fill(0x0d08)]
    flags.forEach((value, index) => {
      view.setUint16(64 + index * 18, value, true)
      view.setUint16(64 + index * 18 + 4, coordinates[index]!, true)
    })

    expect(locateHgssSpawnTable(arm9)).toBe(64)
  })
})