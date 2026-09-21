import { describe, expect, it } from 'vitest'
import { decompressLz10 } from './lz10'

describe('decompressLz10', () => {
  it('decodes literal bytes', () => {
    const source = new Uint8Array([0x10, 0x03, 0x00, 0x00, 0x00, 0x41, 0x42, 0x43])

    expect(decompressLz10(source)).toEqual(new Uint8Array([0x41, 0x42, 0x43]))
  })

  it('decodes a back reference', () => {
    const source = new Uint8Array([0x10, 0x06, 0x00, 0x00, 0x20, 0x41, 0x42, 0x10, 0x01])

    expect(decompressLz10(source)).toEqual(new Uint8Array([0x41, 0x42, 0x41, 0x42, 0x41, 0x42]))
  })

  it('rejects truncated or invalid streams', () => {
    expect(decompressLz10(new Uint8Array([0x11, 0x01, 0x00, 0x00, 0x00, 0x41]))).toBeUndefined()
    expect(decompressLz10(new Uint8Array([0x10, 0x03, 0x00, 0x00, 0x80, 0x00, 0x00]))).toBeUndefined()
    expect(decompressLz10(new Uint8Array([0x10, 0x03, 0x00, 0x00, 0x00, 0x41]))).toBeUndefined()
  })
})