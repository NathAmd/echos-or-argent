import { describe, expect, it } from 'vitest'
import { decodeLandDataMapPropRecord, resolveLandDataPropListOffset } from './nds'
import { decodeAreaMapPropDomain, resolveAreaMapPropDomains } from './rom/maps/areaMapPropDomain'

describe('land data prop list layout', () => {
  it('uses the native area flag to choose the shared map-prop model archive', () => {
    expect(decodeAreaMapPropDomain(new Uint8Array([0, 0, 0, 0, 0, 0, 0]))).toBe('room')
    expect(decodeAreaMapPropDomain(new Uint8Array([0, 0, 0, 0, 0, 0, 1]))).toBe('field')
    expect(decodeAreaMapPropDomain(new Uint8Array(6))).toBeUndefined()
    const rom = new Uint8Array([0, 0, 0, 0, 0, 0, 1])
    expect(resolveAreaMapPropDomains(rom, { index: 0, offset: 0, size: rom.length, signature: '' }, 'room')).toEqual(['field'])
    expect(resolveAreaMapPropDomains(rom, undefined, 'room')).toEqual(['room', 'field'])
  })

  it('keeps the declared offset when props start immediately after terrain data', () => {
    expect(resolveLandDataPropListOffset(2048, 48, 2116)).toBe(2068)
  })

  it('shifts the prop list forward when the member carries a gap before the embedded model', () => {
    expect(resolveLandDataPropListOffset(2048, 816, 2972)).toBe(2156)
  })

  it('uses the declared offset for zero-length prop lists', () => {
    expect(resolveLandDataPropListOffset(2048, 0, 2092)).toBe(2068)
  })

  it('preserves a map prop identity and its three native transforms', () => {
    const bytes = new Uint8Array(0x30)
    const view = new DataView(bytes.buffer)
    view.setUint32(0, 224, true)
    ;[4096, -8192, 12288, 0, 2048, -4096, 4096, 8192, 2048].forEach((value, index) => {
      view.setInt32(4 + index * 4, value, true)
    })

    expect(decodeLandDataMapPropRecord(view, 0)).toEqual({
      modelId: 224,
      position: [1, -2, 3],
      rotation: [0, 0.5, -1],
      scale: [1, 2, 0.5],
    })
  })
})
