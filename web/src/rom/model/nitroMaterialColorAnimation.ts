import type { NitroModelPreview } from '../../ndsTypes'
import { interpolateNitroInteger, selectNitroSample } from './nitroAnimationSampling'
import { openNitroMaterialAnimation } from './nitroMaterialAnimationResource'

const elementConstant = 0x20000000

function rgb15(value: number): readonly [number, number, number] {
  return [(value & 31) / 31, ((value >>> 5) & 31) / 31, ((value >>> 10) & 31) / 31]
}

function interpolateRgb15(from: number, to: number, toParts: 1 | 2 | 3): number {
  const channel = (shift: number): number => interpolateNitroInteger((from >>> shift) & 31, (to >>> shift) & 31, toParts)
  return channel(0) | (channel(5) << 5) | (channel(10) << 10)
}

function readChannel(
  view: DataView,
  animationOffset: number,
  channelOffset: number,
  frame: number,
  fileSize: number,
  kind: 'color' | 'alpha',
): number | undefined {
  if (channelOffset + 4 > fileSize) return undefined
  const info = view.getUint32(channelOffset, true)
  if ((info & elementConstant) !== 0) return info & 0xffff
  const stride = kind === 'alpha' ? 1 : 2
  const selection = selectNitroSample(frame, info, (info >>> 16) & 0x1fff)
  const read = (index: number): number | undefined => {
    const offset = animationOffset + (info & 0xffff) + index * stride
    if (offset < animationOffset || offset + stride > fileSize) return undefined
    return stride === 1 ? view.getUint8(offset) : view.getUint16(offset, true)
  }
  if ('index' in selection) return read(selection.index)
  const from = read(selection.from)
  const to = read(selection.to)
  if (from === undefined || to === undefined) return undefined
  return kind === 'color'
    ? interpolateRgb15(from, to, selection.toParts)
    : interpolateNitroInteger(from, to, selection.toParts)
}

export function decodeNitroMaterialColorFrames(bytes: Uint8Array, model: NitroModelPreview): NitroModelPreview[] | undefined {
  const animation = openNitroMaterialAnimation(bytes, 'BMA0', 'MAT0')
  if (!animation) return undefined
  const { view, fileSize, animationOffset } = animation
  return Array.from({ length: animation.frameCount }, (_, frame) => ({
    ...model,
    surfaces: model.surfaces?.map((surface) => {
      const trackOffset = surface.materialName ? animation.tracksByName.get(surface.materialName) : undefined
      if (trackOffset === undefined) return surface
      const diffuse = readChannel(view, animationOffset, trackOffset, frame, fileSize, 'color')
      const ambient = readChannel(view, animationOffset, trackOffset + 4, frame, fileSize, 'color')
      const specular = readChannel(view, animationOffset, trackOffset + 8, frame, fileSize, 'color')
      const emission = readChannel(view, animationOffset, trackOffset + 12, frame, fileSize, 'color')
      const alpha = readChannel(view, animationOffset, trackOffset + 16, frame, fileSize, 'alpha')
      return {
        ...surface,
        materialColor: diffuse === undefined ? surface.materialColor : rgb15(diffuse),
        materialDiffuseColor: diffuse === undefined ? surface.materialDiffuseColor : rgb15(diffuse),
        materialAmbientColor: ambient === undefined ? surface.materialAmbientColor : rgb15(ambient),
        materialSpecularColor: specular === undefined ? surface.materialSpecularColor : rgb15(specular),
        materialEmissionColor: emission === undefined ? surface.materialEmissionColor : rgb15(emission),
        materialAlpha: alpha === undefined ? surface.materialAlpha : Math.min(31, alpha & 31) / 31,
      }
    }),
  }))
}
