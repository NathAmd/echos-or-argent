import * as THREE from 'three'
import type { NitroTexturePreview, PlayerDirection, PlayerTextureFrames } from '../../ndsTypes'
import { createNitroDataTexture } from './nitroTexture'

export type EventSpriteRuntimeFrames = {
  standing: Record<PlayerDirection, THREE.DataTexture>
  walking: Record<PlayerDirection, THREE.DataTexture[]>
}

export type EventSpriteResourceBinding = {
  preview: NitroTexturePreview
  frames?: PlayerTextureFrames
  textures: THREE.DataTexture[]
  runtimeFrames?: EventSpriteRuntimeFrames
  primaryTexture: THREE.DataTexture
}

const directions: PlayerDirection[] = ['north', 'south', 'west', 'east']

export function createEventSpriteResource(preview: NitroTexturePreview, frames?: PlayerTextureFrames): EventSpriteResourceBinding {
  const textures: THREE.DataTexture[] = []
  const byId = new Map<string, THREE.DataTexture>()
  const build = (frame: NitroTexturePreview): THREE.DataTexture => {
    const cached = byId.get(frame.id)
    if (cached) return cached
    const texture = createNitroDataTexture(frame, true)
    texture.wrapS = THREE.ClampToEdgeWrapping
    texture.wrapT = THREE.ClampToEdgeWrapping
    textures.push(texture)
    byId.set(frame.id, texture)
    return texture
  }
  if (!frames) return { preview, textures, primaryTexture: build(preview) }
  const standing = {} as Record<PlayerDirection, THREE.DataTexture>
  const walking = {} as Record<PlayerDirection, THREE.DataTexture[]>
  for (const direction of directions) {
    standing[direction] = build(frames.standing[direction])
    walking[direction] = frames.walking[direction].map(build)
  }
  return { preview, frames, textures, runtimeFrames: { standing, walking }, primaryTexture: standing.south }
}

export function disposeEventSpriteResource(binding: Pick<EventSpriteResourceBinding, 'textures'>): void {
  for (const texture of binding.textures) texture.dispose()
}
