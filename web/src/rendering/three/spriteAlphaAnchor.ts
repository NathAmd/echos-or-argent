import type { NitroTexturePreview } from '../../ndsTypes'

const nativeActorTextureSize = 32

export function getSpriteWorldDimensions(texture: NitroTexturePreview, nativeActorHeight: number): { width: number, height: number } {
  return {
    width: nativeActorHeight * texture.width / nativeActorTextureSize,
    height: nativeActorHeight * texture.height / nativeActorTextureSize,
  }
}

export function getSpriteAlphaAnchorY(texture: NitroTexturePreview): number {
  for (let y = texture.height - 1; y >= 0; y -= 1) {
    for (let x = 0; x < texture.width; x += 1) {
      if (texture.pixels[(y * texture.width + x) * 4 + 3]! > 0) {
        return Math.max(0, Math.min(1, (texture.height - 1 - y) / texture.height))
      }
    }
  }
  return 0
}
