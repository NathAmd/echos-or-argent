import * as THREE from 'three'

export type NitroTextureAlphaMode = 'opaque' | 'cutout' | 'blend'

export type NitroMaterialTransparency = {
  alphaTest: number
  depthWrite: boolean
  opacity: number
  transparent: boolean
}

export type NitroAlphaMaterial = THREE.MeshBasicMaterial | THREE.MeshLambertMaterial | THREE.MeshPhysicalMaterial

const alphaTestThreshold = 1 / 255
const textureAlphaModeKey = 'nitroTextureAlphaMode'

export function classifyNitroTextureAlpha(pixels: ArrayLike<number>): NitroTextureAlphaMode {
  let hasTransparentPixel = false
  for (let offset = 3; offset < pixels.length; offset += 4) {
    const alpha = pixels[offset] ?? 255
    if (alpha > 0 && alpha < 255) return 'blend'
    if (alpha === 0) hasTransparentPixel = true
  }
  return hasTransparentPixel ? 'cutout' : 'opaque'
}

export function setNitroTextureAlphaMode(texture: THREE.Texture, pixels: ArrayLike<number>): NitroTextureAlphaMode {
  const mode = classifyNitroTextureAlpha(pixels)
  texture.userData[textureAlphaModeKey] = mode
  return mode
}

export function getNitroTextureAlphaMode(texture: THREE.Texture | null | undefined): NitroTextureAlphaMode {
  const mode = texture?.userData[textureAlphaModeKey]
  return mode === 'cutout' || mode === 'blend' ? mode : 'opaque'
}

export function resolveNitroMaterialTransparency(
  materialAlpha: number | undefined,
  textureAlphaMode: NitroTextureAlphaMode,
  forceBlend = false,
): NitroMaterialTransparency {
  const opacity = Number.isFinite(materialAlpha) ? THREE.MathUtils.clamp(materialAlpha ?? 1, 0, 1) : 1
  const transparent = forceBlend || opacity < 0.999 || textureAlphaMode === 'blend'
  return {
    alphaTest: textureAlphaMode === 'opaque' ? 0 : alphaTestThreshold,
    depthWrite: !transparent,
    opacity,
    transparent,
  }
}

export function applyNitroMaterialTransparency(
  material: NitroAlphaMaterial,
  materialAlpha: number | undefined,
  texture: THREE.Texture | null | undefined = material.map,
  forceBlend = false,
): void {
  const resolved = resolveNitroMaterialTransparency(materialAlpha, getNitroTextureAlphaMode(texture), forceBlend)
  const recompilesShader = material.transparent !== resolved.transparent || material.alphaTest !== resolved.alphaTest
  material.alphaTest = resolved.alphaTest
  material.depthWrite = resolved.depthWrite
  material.opacity = resolved.opacity
  material.transparent = resolved.transparent
  if (recompilesShader) material.needsUpdate = true
}
