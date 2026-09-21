import { describe, expect, it } from 'vitest'
import { readNarcMembers } from './narc'
import { parseNitroFileNames } from './nitrofs'

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  for (let index = 0; index < magic.length; index += 1) bytes[offset + index] = magic.charCodeAt(index)
}

describe('NARC', () => {
  it('reads member bounds from BTAF and GMIF blocks', () => {
    const bytes = new Uint8Array(48)
    const view = new DataView(bytes.buffer)
    writeMagic(bytes, 0, 'NARC')
    view.setUint16(12, 16, true)
    view.setUint16(14, 2, true)
    writeMagic(bytes, 16, 'BTAF')
    view.setUint32(20, 20, true)
    view.setUint16(24, 1, true)
    view.setUint32(28, 0, true)
    view.setUint32(32, 4, true)
    writeMagic(bytes, 36, 'GMIF')
    view.setUint32(40, 12, true)
    writeMagic(bytes, 44, 'TEST')

    expect(readNarcMembers(bytes, 0, bytes.length)).toEqual([
      { index: 0, offset: 44, size: 4, signature: 'T E S T' },
    ])
  })
})

describe('NitroFS', () => {
  it('resolves root file names', () => {
    const fnt = new Uint8Array(13)
    const view = new DataView(fnt.buffer)
    view.setUint32(0, 8, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 1, true)
    fnt.set([3, 0x61, 0x62, 0x63, 0], 8)

    expect([...parseNitroFileNames(fnt, 1, 1)]).toEqual([[0, '/abc']])
  })
})