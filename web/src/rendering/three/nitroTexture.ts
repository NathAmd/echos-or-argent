import * as THREE from 'three'
import type { NitroTexturePreview } from '../../ndsTypes'
import { bleedTransparentPixelColors } from '../alphaBleed'
import { setNitroTextureAlphaMode } from './nitroMaterialTransparency'

export function createNitroDataTexture(texture: NitroTexturePreview, flipY = false, smoothing = false): THREE.DataTexture {
  const pixels = smoothing
    ? bleedTransparentPixelColors(texture.pixels, texture.width, texture.height)
    : texture.pixels
  const dataTexture = new THREE.DataTexture(pixels, texture.width, texture.height, THREE.RGBAFormat)
  dataTexture.colorSpace = THREE.SRGBColorSpace
  dataTexture.flipY = flipY
  dataTexture.wrapS = THREE.RepeatWrapping
  dataTexture.wrapT = THREE.RepeatWrapping
  dataTexture.magFilter = smoothing ? THREE.LinearFilter : THREE.NearestFilter
  dataTexture.minFilter = smoothing ? THREE.LinearFilter : THREE.NearestFilter
  dataTexture.generateMipmaps = false
  setNitroTextureAlphaMode(dataTexture, texture.pixels)
  dataTexture.needsUpdate = true
  return dataTexture
}
