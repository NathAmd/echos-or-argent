import { describe, expect, it } from 'vitest'
import { decodeFieldCameraTable, locateFieldCameraTable, resolveFieldCameraGroundMargins, resolveFieldCameraProjection, resolveRemasteredFieldCameraAngles } from './fieldCamera'

describe('HGSS field camera table', () => {
  it('locates and decodes native camera records from overlay bytes', () => {
    const tableOffset = 8
    const bytes = new Uint8Array(tableOffset + 17 * 36)
    const view = new DataView(bytes.buffer)
    const writeRecord = (index: number, values: { distance: number, angleX: number, perspective: number, near: number, far: number }): void => {
      const offset = tableOffset + index * 36
      view.setUint32(offset, values.distance, true)
      view.setUint16(offset + 4, values.angleX, true)
      view.setUint16(offset + 14, values.perspective, true)
      view.setUint32(offset + 16, values.near, true)
      view.setUint32(offset + 20, values.far, true)
    }
    writeRecord(0, { distance: 0x0029aec1, angleX: 0xdd62, perspective: 0x05c1, near: 0x00096000, far: 0x004b0000 })
    writeRecord(1, { distance: 0x0019465c, angleX: 0xe383, perspective: 0x0981, near: 0x00086000, far: 0x004b0000 })
    const type4 = tableOffset + 4 * 36
    view.setInt32(type4, 4096 * 125, true)
    view.setUint16(type4 + 4, 0xdc82, true)
    view.setUint8(type4 + 12, 1)
    view.setUint16(type4 + 14, 0x0281, true)
    view.setInt32(type4 + 16, 4096 * 10, true)
    view.setInt32(type4 + 20, 4096 * 200, true)
    view.setInt32(type4 + 24, 4096 * 2, true)

    expect(locateFieldCameraTable(bytes)).toBe(tableOffset)
    expect(decodeFieldCameraTable(bytes)[4]).toEqual({
      type: 4,
      distance: 125,
      angleX: 0xdc82,
      angleY: 0,
      angleZ: 0,
      perspectiveType: 1,
      perspectiveAngle: 0x0281,
      near: 10,
      far: 200,
      lookAtOffsetX: 2,
      lookAtOffsetY: 0,
      lookAtOffsetZ: 0,
    })
  })

  it('preserves the native perspective projection instead of flattening it into an orthographic view', () => {
    const camera = {
      type: 0,
      distance: 0x0029aec1 / 4096,
      angleX: 0xdd62,
      angleY: 0,
      angleZ: 0,
      perspectiveType: 0,
      perspectiveAngle: 0x05c1,
      near: 150,
      far: 1200,
      lookAtOffsetX: 0,
      lookAtOffsetY: 0,
      lookAtOffsetZ: 0,
    }

    expect(resolveFieldCameraProjection(camera, 1 / 16)).toEqual({
      kind: 'perspective',
      verticalFovDegrees: 0x05c1 * 720 / 0x10000,
    })
  })

  it('lowers elevation while preserving each ROM camera azimuth', () => {
    const camera = {
      type: 0,
      distance: 0x0029aec1 / 4096,
      angleX: 0xdd62,
      angleY: 0x0800,
      angleZ: 0,
      perspectiveType: 0,
      perspectiveAngle: 0x05c1,
      near: 150,
      far: 1200,
      lookAtOffsetX: 0,
      lookAtOffsetY: 0,
      lookAtOffsetZ: 0,
    }
    const angles = resolveRemasteredFieldCameraAngles(camera)

    expect(angles.angleX * 180 / Math.PI).toBeCloseTo(-42.84, 1)
    expect(angles.angleY * 180 / Math.PI).toBeCloseTo(11.25)
  })

  it('keeps the native distance-derived extent for orthographic camera profiles', () => {
    const camera = {
      type: 4,
      distance: 125,
      angleX: 0xdc82,
      angleY: 0,
      angleZ: 0,
      perspectiveType: 1,
      perspectiveAngle: 0x0281,
      near: 10,
      far: 200,
      lookAtOffsetX: 2,
      lookAtOffsetY: 0,
      lookAtOffsetZ: 0,
    }
    const projection = resolveFieldCameraProjection(camera)

    expect(projection.kind).toBe('orthographic')
    expect(projection.kind === 'orthographic' && projection.viewHeight).toBeCloseTo(
      Math.tan(0x0281 * Math.PI * 2 / 0x10000) * 125 * 2,
    )
  })

  it('projects the ROM perspective frustum onto the ground for map-edge camera limits', () => {
    const camera = {
      type: 0,
      distance: 0x0029aec1 / 4096,
      angleX: 0xdd62,
      angleY: 0,
      angleZ: 0,
      perspectiveType: 0,
      perspectiveAngle: 0x05c1,
      near: 150,
      far: 1200,
      lookAtOffsetX: 0,
      lookAtOffsetY: 0,
      lookAtOffsetZ: 0,
    }
    const margins = resolveFieldCameraGroundMargins(camera, 1 / 16, 918 / 771)

    expect(margins).toBeDefined()
    expect(margins!.minX).toBeCloseTo(-8.33, 1)
    expect(margins!.maxX).toBeCloseTo(8.33, 1)
    expect(margins!.minZ).toBeCloseTo(-10.29, 1)
    expect(margins!.maxZ).toBeCloseTo(7.56, 1)
  })
})
