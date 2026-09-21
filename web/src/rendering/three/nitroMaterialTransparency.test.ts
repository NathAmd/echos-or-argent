import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { NitroTexturePreview } from '../../ndsTypes'
import {
  applyNitroMaterialTransparency,
  classifyNitroTextureAlpha,
  getNitroTextureAlphaMode,
  resolveNitroMaterialTransparency,
} from './nitroMaterialTransparency'
import { createNitroDataTexture } from './nitroTexture'

function createTexturePreview(alpha: readonly number[]): NitroTexturePreview {
  const pixels = new Uint8ClampedArray(alpha.length * 4)
  alpha.forEach((value, index) => {
    pixels.set([255, 255, 255, value], index * 4)
  })
  return { id: 'texture', name: 'texture', width: alpha.length, height: 1, pixels }
}

describe('Nitro material transparency', () => {
  it('classifies the decoded ROM alpha without inferring from texture names', () => {
    expect(classifyNitroTextureAlpha(createTexturePreview([255, 255]).pixels)).toBe('opaque')
    expect(classifyNitroTextureAlpha(createTexturePreview([0, 255]).pixels)).toBe('cutout')
    expect(classifyNitroTextureAlpha(createTexturePreview([0, 128, 255]).pixels)).toBe('blend')
  })

  it('keeps the alpha classification on the uploaded Three texture', () => {
    const texture = createNitroDataTexture(createTexturePreview([0, 64, 255]))
    expect(getNitroTextureAlphaMode(texture)).toBe('blend')
    texture.dispose()
  })

  it('uses depth-writing alpha test for cutouts and blending for partial texture alpha', () => {
    expect(resolveNitroMaterialTransparency(1, 'cutout')).toMatchObject({
      depthWrite: true,
      opacity: 1,
      transparent: false,
    })
    expect(resolveNitroMaterialTransparency(1, 'cutout').alphaTest).toBeGreaterThan(0)
    expect(resolveNitroMaterialTransparency(1, 'blend')).toMatchObject({
      depthWrite: false,
      opacity: 1,
      transparent: true,
    })
  })

  it('reconfigures an existing material when an animated ROM texture changes alpha mode', () => {
    const cutout = createNitroDataTexture(createTexturePreview([0, 255]))
    const blend = createNitroDataTexture(createTexturePreview([0, 64]))
    const material = new THREE.MeshLambertMaterial({ map: cutout })

    applyNitroMaterialTransparency(material, 1, cutout)
    expect(material.transparent).toBe(false)
    expect(material.depthWrite).toBe(true)

    material.map = blend
    applyNitroMaterialTransparency(material, 1, blend)
    expect(material.transparent).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(material.alphaTest).toBeGreaterThan(0)

    material.dispose()
    cutout.dispose()
    blend.dispose()
  })
})
