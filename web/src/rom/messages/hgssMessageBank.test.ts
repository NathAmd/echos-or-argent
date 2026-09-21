import { describe, expect, it } from 'vitest'
import type { NarcMember } from '../../ndsTypes'
import { decodeHgssMessageBank, stripMessageControls } from './hgssMessageBank'

describe('HGSS message banks', () => {
  it('decrypts a message entry', () => {
    const bytes = new Uint8Array(18)
    const view = new DataView(bytes.buffer)
    const key = 1
    const allocKeyLow = 765 * key
    const allocKey = (allocKeyLow | (allocKeyLow << 16)) >>> 0
    view.setUint16(0, 1, true)
    view.setUint16(2, key, true)
    view.setUint32(4, (12 ^ allocKey) >>> 0, true)
    view.setUint32(8, (3 ^ allocKey) >>> 0, true)
    let seed = 596947 & 0xffff
    view.setUint16(12, 0x012b ^ seed, true)
    seed = (seed + 18749) & 0xffff
    view.setUint16(14, 0x25bc ^ seed, true)
    seed = (seed + 18749) & 0xffff
    view.setUint16(16, 0xffff ^ seed, true)
    const member: NarcMember = { index: 0, offset: 0, size: bytes.length, signature: '' }

    expect(decodeHgssMessageBank(bytes, member)).toEqual({ 0: 'A\r' })
  })

  it('removes controls and normalizes whitespace', () => {
    expect(stripMessageControls('Bonjour {103 0,0}  \n monde')).toBe('Bonjour \n monde')
  })
})
