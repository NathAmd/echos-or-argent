import { describe, expect, it } from 'vitest'
import type { NitroTexturePreview, PlayerTextureFrames } from '../../ndsTypes'
import { createEventSpriteResource, disposeEventSpriteResource } from './eventSpriteResource'

const preview = (id: string): NitroTexturePreview => ({ id, name: id, width: 1, height: 1, pixels: new Uint8ClampedArray([255, 255, 255, 255]) })

describe('event sprite resource binding', () => {
  it('shares identical ROM frames while retaining distinct standing poses', () => {
    const a = preview('a')
    const b = preview('b')
    const frames = { standing: { north: a, south: b, west: a, east: b }, walking: { north: [a, b], south: [b], west: [a], east: [b] } } as PlayerTextureFrames
    const binding = createEventSpriteResource(a, frames)
    expect(binding.textures).toHaveLength(2)
    expect(binding.primaryTexture).toBe(binding.runtimeFrames?.standing.south)
    expect(binding.runtimeFrames?.standing.north).not.toBe(binding.runtimeFrames?.standing.south)
    disposeEventSpriteResource(binding)
  })
})
