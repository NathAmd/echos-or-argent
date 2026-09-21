import type { NitroModelPreview, NitroSurfacePreview } from '../../ndsTypes'
import { sampleNitroInteger, selectNitroSample } from './nitroAnimationSampling'
import { openNitroMaterialAnimation } from './nitroMaterialAnimationResource'

const fx32One = 4096
const elementConstant = 0x20000000
const elementFx16 = 0x10000000

function readVector(
  view: DataView,
  animationOffset: number,
  channelOffset: number,
  frame: number,
  fileSize: number,
  fallback: number,
): number {
  if (channelOffset + 8 > fileSize) return fallback
  const info = view.getUint32(channelOffset, true)
  const data = view.getUint32(channelOffset + 4, true)
  if ((info & elementConstant) !== 0) {
    const raw = (info & elementFx16) !== 0 ? (data << 16) >> 16 : data | 0
    return raw / fx32One
  }
  const stride = (info & elementFx16) !== 0 ? 2 : 4
  const selection = selectNitroSample(frame, info, info & 0xffff)
  const raw = sampleNitroInteger(selection, (index) => {
    const offset = animationOffset + data + index * stride
    if (offset < animationOffset || offset + stride > fileSize) return undefined
    return stride === 2 ? view.getInt16(offset, true) : view.getInt32(offset, true)
  })
  return raw === undefined ? fallback : raw / fx32One
}

type SinCos = { sin: number, cos: number }

function readRotation(view: DataView, animationOffset: number, channelOffset: number, frame: number, fileSize: number): SinCos {
  if (channelOffset + 8 > fileSize) return { sin: 0, cos: 1 }
  const info = view.getUint32(channelOffset, true)
  const data = view.getUint32(channelOffset + 4, true)
  if ((info & elementConstant) !== 0) return { sin: ((data << 16) >> 16) / fx32One, cos: (data >> 16) / fx32One }
  const selection = selectNitroSample(frame, info, info & 0xffff)
  const read = (index: number, componentOffset: 0 | 2): number | undefined => {
    const offset = animationOffset + data + index * 4 + componentOffset
    return offset >= animationOffset && offset + 2 <= fileSize ? view.getInt16(offset, true) : undefined
  }
  const sin = sampleNitroInteger(selection, (index) => read(index, 0))
  const cos = sampleNitroInteger(selection, (index) => read(index, 2))
  return { sin: (sin ?? 0) / fx32One, cos: (cos ?? fx32One) / fx32One }
}

type TextureSrt = SinCos & { scaleS: number, scaleT: number, transS: number, transT: number }

function transformMayaUvs(surface: NitroSurfacePreview, transform: TextureSrt): NitroSurfacePreview {
  if (!surface.uvs) return surface
  const { scaleS, scaleT, sin, cos, transS, transT } = transform
  if (scaleS === 1 && scaleT === 1 && sin === 0 && cos === 1 && transS === 0 && transT === 0) return surface
  const offsetS = scaleS * (-sin - cos + 1) / 2 - scaleS * transS
  const offsetT = (scaleT * sin - scaleT * cos - scaleT + 2) / 2 + scaleT * transT
  const uvs = new Float32Array(surface.uvs)
  for (let index = 0; index < uvs.length; index += 2) {
    const u = surface.uvs[index]!
    const v = surface.uvs[index + 1]!
    uvs[index] = scaleS * (u * cos + v * sin) + offsetS
    uvs[index + 1] = scaleT * (-u * sin + v * cos) + offsetT
  }
  return { ...surface, uvs }
}

function transformUvs(surface: NitroSurfacePreview, transform: TextureSrt, texMtxMode: number): NitroSurfacePreview {
  if (texMtxMode === 0) return transformMayaUvs(surface, transform)
  if (!surface.uvs) return surface
  const { scaleS, scaleT, sin, cos, transS, transT } = transform
  const uvs = new Float32Array(surface.uvs)
  for (let index = 0; index < uvs.length; index += 2) {
    const u = surface.uvs[index]! * scaleS
    const v = surface.uvs[index + 1]! * scaleT
    uvs[index] = u * cos - v * sin + transS
    uvs[index + 1] = u * sin + v * cos + transT
  }
  return { ...surface, uvs }
}

export function decodeNitroTextureTransformFrames(bytes: Uint8Array, model: NitroModelPreview): NitroModelPreview[] | undefined {
  const animation = openNitroMaterialAnimation(bytes, 'BTA0', 'SRT0')
  if (!animation) return undefined
  const { view, fileSize, animationOffset } = animation
  return Array.from({ length: animation.frameCount }, (_, frame) => ({
    ...model,
    surfaces: model.surfaces?.map((surface) => {
      const trackOffset = surface.materialName ? animation.tracksByName.get(surface.materialName) : undefined
      if (trackOffset === undefined) return surface
      return transformUvs(surface, {
        scaleS: readVector(view, animationOffset, trackOffset, frame, fileSize, 1),
        scaleT: readVector(view, animationOffset, trackOffset + 8, frame, fileSize, 1),
        ...readRotation(view, animationOffset, trackOffset + 16, frame, fileSize),
        transS: readVector(view, animationOffset, trackOffset + 24, frame, fileSize, 0),
        transT: readVector(view, animationOffset, trackOffset + 32, frame, fileSize, 0),
      }, animation.texMtxMode)
    }),
  }))
}
