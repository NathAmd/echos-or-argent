import type { NitroModelPreview } from '../../ndsTypes'
import { decodeNitroMaterialColorFrames } from './nitroMaterialColorAnimation'
import { hasNitroMagic } from './nitroResource'
import { decodeNitroTextureTransformFrames } from './nitroTextureTransformAnimation'

/** Façade stable des animations Nitro de matrice de texture et de matériau. */
export function decodeNitroMaterialAnimationFrames(bytes: Uint8Array, model: NitroModelPreview): NitroModelPreview[] | undefined {
  if (hasNitroMagic(bytes, 0, 'BTA0')) return decodeNitroTextureTransformFrames(bytes, model)
  if (hasNitroMagic(bytes, 0, 'BMA0')) return decodeNitroMaterialColorFrames(bytes, model)
  return undefined
}
