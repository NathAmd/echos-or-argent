import { describe, expect, it } from 'vitest'
import { decodeMapHeader, HGSS_MAP_HEADER_SIZE, locateMapHeaderTable } from './mapHeaders'

function writeOpeningSignature(bytes: Uint8Array, tableOffset: number): void {
  const view = new DataView(bytes.buffer)
  for (let mapId = 60; mapId <= 64; mapId += 1) {
    const offset = tableOffset + mapId * HGSS_MAP_HEADER_SIZE
    view.setUint16(offset + 6, 782 + mapId, true)
    view.setUint16(offset + 8, 555 + mapId, true)
    view.setUint16(offset + 10, 482 + mapId, true)
    view.setUint16(offset + 16, mapId - 3, true)
  }
}

describe('HGSS map headers', () => {
  it('locates the unique opening signature and decodes packed fields', () => {
    const tableOffset = 16
    const bytes = new Uint8Array(tableOffset + 540 * HGSS_MAP_HEADER_SIZE)
    writeOpeningSignature(bytes, tableOffset)
    const offset = tableOffset + 64 * HGSS_MAP_HEADER_SIZE
    const view = new DataView(bytes.buffer)
    bytes[offset] = 255
    bytes[offset + 1] = 25
    view.setUint16(offset + 2, 7 | 21 << 4 | 14 << 10, true)
    view.setUint16(offset + 4, 72, true)
    view.setUint16(offset + 12, 1018, true)
    view.setUint16(offset + 14, 1019, true)
    view.setUint16(offset + 18, 126 | 4 << 8 | 2 << 12, true)
    view.setUint32(offset + 20, 1 | 3 << 1 | 4 << 8 | 9 << 12 | 2 << 18 | 6 << 20 | 1 << 25 | 1 << 28 | 1 << 31, true)

    expect(locateMapHeaderTable(bytes)).toBe(tableOffset)
    expect(decodeMapHeader(bytes, tableOffset, 64)).toMatchObject({
      mapId: 64,
      wildEncounterBank: 255,
      areaDataBank: 25,
      moveModelBank: 7,
      worldMapX: 21,
      worldMapY: 14,
      matrixId: 72,
      scriptsBank: 846,
      scriptHeaderBank: 619,
      msgBank: 546,
      dayMusicId: 1018,
      nightMusicId: 1019,
      eventsBank: 61,
      mapSection: 126,
      areaIcon: 4,
      momCallIntroParam: 2,
      region: 1,
      weather: 3,
      mapType: 4,
      cameraType: 9,
      followMode: 2,
      battleBackground: 6,
      bikeAllowed: true,
      runningAllowed: false,
      flyAllowed: true,
      radioSignal: true,
    })
  })

  it('rejects an absent or ambiguous table', () => {
    expect(() => locateMapHeaderTable(new Uint8Array(540 * HGSS_MAP_HEADER_SIZE))).toThrow('0 candidate')
    const bytes = new Uint8Array(8 + 2 * 540 * HGSS_MAP_HEADER_SIZE)
    writeOpeningSignature(bytes, 4)
    writeOpeningSignature(bytes, 4 + 540 * HGSS_MAP_HEADER_SIZE)
    expect(() => locateMapHeaderTable(bytes)).toThrow('2 candidate')
  })
})