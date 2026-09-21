import * as THREE from 'three'
import { describe, expect, it } from 'vitest'
import type { HgssFishingBiteEffectAsset } from '../../game/encounters/hgssFishingBiteEffect'
import { hgssVBlankDurationMs } from '../../game/world/hgssWorldAnimationClock'
import type { NitroTexturePreview, OpeningMapPreview } from '../../ndsTypes'
import { HgssFishingBiteEffectLayer, resolveHgssFishingBiteEffectWorldSample } from './hgssFishingBiteEffectLayer'

function texture(index: number): NitroTexturePreview {
  return {
    id: `bite-${index}`,
    name: `saisen_ef.${index}`,
    paletteName: 'saisen_ef_pl',
    width: 16,
    height: 16,
    pixels: new Uint8ClampedArray(16 * 16 * 4).fill(255),
  }
}

const sourceTexture = texture(0)
const effect: HgssFishingBiteEffectAsset = {
  model: {
    modelId: 125,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
    surfaces: [{
      materialIndex: 0,
      materialName: 'saisen_ef_mat',
      textureId: 'source',
      textureName: 'saisen_ef',
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]),
      uvs: new Float32Array([0, 0, 1, 0, 0, 1]),
    }],
  },
  texture: sourceTexture,
  timeline: {
    keyFrames: [0, 4, 8, 12],
    textureAddressOffsets: [0, 1, 2, 3],
    paletteAddressOffsets: [0, 0, 0, 0],
  },
}

const indoorMap = {
  id: 1,
  matrix: { hasHeaders: false, width: 1, height: 1 },
} as OpeningMapPreview

describe('couche 3D de touche de peche HGSS', () => {
  it('convertit la parabole fx32 dans les deux domaines de coordonnees', () => {
    expect(resolveHgssFishingBiteEffectWorldSample([10, 3, 20], 0, false)).toMatchObject({
      position: [10, 35, 21],
      scale: 1,
      textureAddressOffset: 0,
      visible: false,
    })
    expect(resolveHgssFishingBiteEffectWorldSample([10, 3, 20], 1, false)).toMatchObject({
      position: [10, 41, 21],
      scale: 1,
      textureAddressOffset: 0,
      visible: true,
    })
    expect(resolveHgssFishingBiteEffectWorldSample([10, 3, 20], 1, true)).toMatchObject({
      position: [10, 5.375, 20.0625],
      scale: 1 / 16,
      visible: true,
    })
  })

  it('suit la cible sur la texture zero et attend un arret explicite', () => {
    const scene = new THREE.Scene()
    const layer = new HgssFishingBiteEffectLayer(scene)
    const anchor = new THREE.Vector3(4, 2, 7)
    layer.start(indoorMap, effect, 'player', anchor, 0)

    expect(scene.children).toContain(layer.group)
    expect(layer.group.children).toHaveLength(1)
    expect(layer.group.children.every((frame) => !frame.visible)).toBe(true)
    expect(layer.isActive('player')).toBe(true)

    layer.update(hgssVBlankDurationMs, () => anchor)
    expect(layer.group.children.filter((frame) => frame.visible)).toHaveLength(1)
    expect(layer.group.children.find((frame) => frame.visible)?.position.toArray()).toEqual([4, 40, 8])

    anchor.set(9, 5, 11)
    layer.update(hgssVBlankDurationMs * 4, () => anchor)
    expect(layer.group.children.findIndex((frame) => frame.visible)).toBe(0)
    expect(layer.group.children.find((frame) => frame.visible)?.position.toArray()).toEqual([9, 49, 12])

    layer.update(hgssVBlankDurationMs * 100, () => anchor)
    expect(layer.isActive()).toBe(true)
    layer.stop('follower')
    expect(layer.isActive()).toBe(true)
    layer.stop('player')
    expect(layer.isActive()).toBe(false)
    expect(layer.group.children).toHaveLength(0)

    layer.dispose()
    expect(scene.children).not.toContain(layer.group)
  })

  it("nettoie l'effet si son acteur disparait", () => {
    const layer = new HgssFishingBiteEffectLayer(new THREE.Scene())
    layer.start(indoorMap, effect, 'follower', new THREE.Vector3(), 0)
    layer.update(hgssVBlankDurationMs, () => undefined)
    expect(layer.isActive()).toBe(false)
    expect(layer.group.children).toHaveLength(0)
    layer.dispose()
  })
})
