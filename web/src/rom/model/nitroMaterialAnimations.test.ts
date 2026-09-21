import { describe, expect, it } from 'vitest'
import type { NitroModelPreview } from '../../ndsTypes'
import { decodeNitroMaterialAnimationFrames } from './nitroMaterialAnimations'

const constant = 0x20000000
const fx16 = 0x10000000

function writeMagic(bytes: Uint8Array, offset: number, magic: string): void {
  bytes.set([...magic].map((value) => value.charCodeAt(0)), offset)
}

function writeInfo(bytes: Uint8Array, view: DataView, offset: number, elementSize: number, name: string): number {
  const size = 36 + elementSize
  view.setUint8(offset + 1, 1)
  view.setUint16(offset + 2, size, true)
  view.setUint16(offset + 16, elementSize, true)
  view.setUint16(offset + 18, elementSize + 4, true)
  writeMagic(bytes, offset + 20 + elementSize, name)
  return offset + 20
}

function setBtaChannel(view: DataView, offset: number, info: number, data: number): void {
  view.setUint32(offset, info, true)
  view.setUint32(offset + 4, data, true)
}

function createFixture(kind: 'BTA' | 'BMA', frameCount = 2, byteLength = 2048): { bytes: Uint8Array, animationOffset: number, trackOffset: number } {
  const bytes = new Uint8Array(byteLength)
  const view = new DataView(bytes.buffer)
  writeMagic(bytes, 0, `${kind}0`)
  view.setUint16(4, 0xfeff, true)
  view.setUint16(6, 1, true)
  view.setUint32(8, bytes.length, true)
  view.setUint16(12, 16, true)
  view.setUint16(14, 1, true)
  view.setUint32(16, 20, true)
  writeMagic(bytes, 20, kind === 'BTA' ? 'SRT0' : 'MAT0')
  view.setUint32(24, bytes.length - 20, true)
  const outerDatum = writeInfo(bytes, view, 28, 4, 'animation')
  view.setUint32(outerDatum, 60, true)
  const animationOffset = 80
  writeMagic(bytes, animationOffset, kind === 'BTA' ? 'M\0AT' : 'M\0AM')
  view.setUint16(animationOffset + 4, frameCount, true)
  const trackOffset = writeInfo(bytes, view, animationOffset + 8, kind === 'BTA' ? 40 : 20, 'material')
  if (kind === 'BTA') {
    setBtaChannel(view, trackOffset, constant | fx16, 4096)
    setBtaChannel(view, trackOffset + 8, constant | fx16, 4096)
    setBtaChannel(view, trackOffset + 16, constant, 0x10000000)
    setBtaChannel(view, trackOffset + 24, constant | fx16, 0)
    setBtaChannel(view, trackOffset + 32, constant | fx16, 0)
  } else {
    view.setUint32(trackOffset, constant | 31, true)
    view.setUint32(trackOffset + 4, constant, true)
    view.setUint32(trackOffset + 8, constant, true)
    view.setUint32(trackOffset + 12, constant, true)
    view.setUint32(trackOffset + 16, constant | 31, true)
  }
  return { bytes, animationOffset, trackOffset }
}

function createModel(): NitroModelPreview {
  const positions = new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0])
  return {
    modelId: 1,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    positions,
    surfaces: [{
      materialIndex: 0,
      materialName: 'material',
      positions,
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  }
}

describe('Nitro material animations', () => {
  it.each([
    { name: 'fx32 sampled', info: 1, stride: 4, sampled: true },
    { name: 'fx16 sampled', info: fx16 | 1, stride: 2, sampled: true },
    { name: 'fx32 constant', info: constant, stride: 4, sampled: false },
    { name: 'fx16 constant', info: constant | fx16, stride: 2, sampled: false },
  ])('decodes a Q12 BTA $name channel', ({ info, stride, sampled }) => {
    const { bytes, animationOffset, trackOffset } = createFixture('BTA')
    const view = new DataView(bytes.buffer)
    const dataOffset = 160
    setBtaChannel(view, trackOffset + 32, info, sampled ? dataOffset : 4096)
    if (sampled) {
      if (stride === 2) {
        view.setInt16(animationOffset + dataOffset, 0, true)
        view.setInt16(animationOffset + dataOffset + stride, 4096, true)
      } else {
        view.setInt32(animationOffset + dataOffset, 0, true)
        view.setInt32(animationOffset + dataOffset + stride, 4096, true)
      }
    }
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())
    expect(frames).toHaveLength(2)
    expect([...frames![1]!.surfaces![0]!.uvs!]).toEqual([0, 1, 1, 1, 0, 2])
  })

  it('applies the native Maya translation sign on S', () => {
    const { bytes, animationOffset, trackOffset } = createFixture('BTA')
    const view = new DataView(bytes.buffer)
    setBtaChannel(view, trackOffset + 24, fx16 | 1, 160)
    view.setInt16(animationOffset + 160, 0, true)
    view.setInt16(animationOffset + 162, 4096, true)
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())
    expect([...frames![0]!.surfaces![0]!.uvs!]).toEqual([0, 0, 1, 0, 0, 1])
    expect([...frames![1]!.surfaces![0]!.uvs!]).toEqual([-1, 0, 0, 0, -1, 1])
  })

  it('applies Maya scale and a quarter-turn around the texture center', () => {
    const { bytes, trackOffset } = createFixture('BTA')
    const view = new DataView(bytes.buffer)
    setBtaChannel(view, trackOffset, constant | fx16, 8192)
    setBtaChannel(view, trackOffset + 8, constant | fx16, 4096)
    setBtaChannel(view, trackOffset + 16, constant, 0x00001000)
    const frame = decodeNitroMaterialAnimationFrames(bytes, createModel())![0]!
    expect([...frame.surfaces![0]!.uvs!]).toEqual([0, 1, 0, 0, 2, 1])
  })

  it('interpolates compressed BTA step-4 samples on their native frames', () => {
    const { bytes, animationOffset, trackOffset } = createFixture('BTA', 5)
    const view = new DataView(bytes.buffer)
    setBtaChannel(view, trackOffset + 32, 0x80000004 | fx16, 160)
    view.setInt16(animationOffset + 160, 0, true)
    view.setInt16(animationOffset + 162, 4096, true)
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())!
    expect(frames.map((frame) => frame.surfaces![0]!.uvs![1])).toEqual([0, 0.25, 0.5, 0.75, 1])
  })

  it('reads sampled BMA colors as u16 and alpha as contiguous u8 values', () => {
    const { bytes, animationOffset, trackOffset } = createFixture('BMA', 60)
    const view = new DataView(bytes.buffer)
    view.setUint32(trackOffset, (59 << 16) | 160, true)
    view.setUint32(trackOffset + 16, (59 << 16) | 320, true)
    for (let frame = 0; frame < 60; frame += 1) {
      view.setUint16(animationOffset + 160 + frame * 2, (frame & 31) << 5, true)
      view.setUint8(animationOffset + 320 + frame, 31 - (frame & 31))
    }
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())!
    expect(frames[1]!.surfaces![0]!.materialColor).toEqual([0, 1 / 31, 0])
    expect([0, 1, 2, 29, 30, 59].map((frame) => frames[frame]!.surfaces![0]!.materialAlpha)).toEqual([31, 30, 29, 2, 1, 4].map((alpha) => alpha / 31))
  })

  it('keeps BMA frame counts above 255 instead of truncating the high byte', () => {
    const { bytes, animationOffset, trackOffset } = createFixture('BMA', 300)
    const view = new DataView(bytes.buffer)
    view.setUint32(trackOffset, (300 << 16) | 256, true)
    for (let frame = 0; frame < 300; frame += 1) view.setUint16(animationOffset + 256 + frame * 2, frame & 31, true)
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())!
    expect(frames).toHaveLength(300)
    expect(frames[299]!.surfaces![0]!.materialColor).toEqual([11 / 31, 0, 0])
  })

  it('interpolates compressed BMA alpha step-4 samples', () => {
    const { bytes, animationOffset, trackOffset } = createFixture('BMA', 5)
    const view = new DataView(bytes.buffer)
    view.setUint32(trackOffset + 16, 0x80040000 | 200, true)
    view.setUint8(animationOffset + 200, 0)
    view.setUint8(animationOffset + 201, 28)
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())!
    expect(frames.map((frame) => frame.surfaces![0]!.materialAlpha)).toEqual([0, 7, 14, 21, 28].map((alpha) => alpha / 31))
  })

  it('preserves every BMA color channel while rendering the diffuse channel', () => {
    const { bytes, trackOffset } = createFixture('BMA')
    const view = new DataView(bytes.buffer)
    view.setUint32(trackOffset, constant | 31, true)
    view.setUint32(trackOffset + 4, constant | (31 << 10), true)
    view.setUint32(trackOffset + 8, constant | (31 << 5), true)
    view.setUint32(trackOffset + 12, constant | 31 | (31 << 10), true)
    const frames = decodeNitroMaterialAnimationFrames(bytes, createModel())!
    expect(frames[0]!.surfaces![0]!.materialColor).toEqual([1, 0, 0])
    expect(frames[0]!.surfaces![0]).toMatchObject({
      materialDiffuseColor: [1, 0, 0],
      materialAmbientColor: [0, 0, 1],
      materialSpecularColor: [0, 1, 0],
      materialEmissionColor: [1, 0, 1],
    })
  })
})
