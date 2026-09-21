import { describe, expect, it } from 'vitest'
import { createActorSpriteMaterial, getActorSpriteDepthMode, patchActorSpriteVertexShader, setActorSpriteDepthMode } from './actorSpriteMaterial'

describe('actor sprite depth contract', () => {
  it('adds a world-vertical depth gradient without moving the sprite on screen', () => {
    const source = 'before\n\tgl_Position = projectionMatrix * mvPosition;\nafter'
    const patched = patchActorSpriteVertexShader(source)

    expect(patched).toContain('gl_Position = projectionMatrix * mvPosition;')
    expect(patched).toContain('uprightDepthPosition.z * gl_Position.w / uprightDepthPosition.w')
    expect(patched).not.toContain('mvPosition.z +=')
  })

  it('only patches actors that participate in scene depth', () => {
    expect(createActorSpriteMaterial(null, true).customProgramCacheKey()).toBe('hgss-actor-depth-upright-v3')
    expect(createActorSpriteMaterial(null, false).customProgramCacheKey()).toBe('hgss-actor-depth-none-v3')
  })

  it('keeps the foot at its ROM anchor while giving higher pixels world depth', () => {
    const material = createActorSpriteMaterial(null, 'upright')
    const shader = { vertexShader: 'before\n\tgl_Position = projectionMatrix * mvPosition;\nafter' }
    material.onBeforeCompile(shader as never, {} as never)

    expect(material.depthTest).toBe(true)
    expect(material.depthWrite).toBe(false)
    expect(getActorSpriteDepthMode(material)).toBe('upright')
    expect(shader.vertexShader).toContain('uprightDepthSlope')
  })

  it('recompiles a persistent player material when the map depth domain changes', () => {
    const material = createActorSpriteMaterial(null, 'upright')
    setActorSpriteDepthMode(material, 'none')
    expect(material.depthTest).toBe(false)
    expect(getActorSpriteDepthMode(material)).toBe('none')
    setActorSpriteDepthMode(material, 'upright')
    expect(material.customProgramCacheKey()).toBe('hgss-actor-depth-upright-v3')
    expect(material.depthTest).toBe(true)
    expect(getActorSpriteDepthMode(material)).toBe('upright')
  })

  it('does not bias an actor in front of opaque ROM geometry', () => {
    expect(createActorSpriteMaterial(null, true).polygonOffset).toBe(false)
  })

  it('fails loudly if a Three.js update changes the sprite shader contract', () => {
    expect(() => patchActorSpriteVertexShader('void main() {}')).toThrow(/point d'ancrage/)
  })
})
