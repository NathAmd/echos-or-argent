import * as THREE from 'three'
import { describe, expect, it, vi } from 'vitest'
import { hgssVBlankDurationMs } from '../../game/time/hgssFrameTiming'
import type { NitroModelPreview, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { HgssFieldMoveEffectLayer, type HgssFieldMoveEffectContext } from './hgssFieldMoveEffectLayer'

function model(position = 0): NitroModelPreview {
  const positions = new Float32Array([position, 0, 0, 1, 0, 0, 0, 0, 1])
  return {
    modelId: 3,
    vertexCount: 3,
    triangleCount: 1,
    quadCount: 0,
    materialCount: 1,
    pieceCount: 1,
    positions,
    surfaces: [{ materialIndex: 0, materialColor: [1, 1, 1], positions }],
  }
}

function map(): OpeningMapPreview {
  return {
    id: 1,
    header: {},
    matrix: { hasHeaders: false, width: 1, height: 1 },
    terrain: { modelId: 0, width: 4, height: 4, attributes: new Uint16Array(16) },
  } as OpeningMapPreview
}

function createFixture(mode: 0 | 4 | 5 = 0) {
  const scene = new THREE.Scene()
  const setWorldTranslationOffset = vi.fn()
  const context: HgssFieldMoveEffectContext = {
    map: map(),
    player: { position: new THREE.Vector3(8, 2.08, -8), direction: 'north' },
    follower: { position: new THREE.Vector3(-8, 4.08, 8), direction: 'east' },
  }
  const now = 100
  const layer = new HgssFieldMoveEffectLayer(
    scene,
    { setWorldTranslationOffset },
    () => context,
    () => now,
  )
  const base = model()
  const modelResolver = vi.fn(() => base) as RomInventory['gymOverlayModelResolver']
  const animationResolver = vi.fn(() => ({
    frameCount: 45,
    frames: Array.from({ length: 45 }, (_, frame) => model(frame)),
  })) as RomInventory['gymOverlayAnimationResolver']
  const completion = layer.play(mode, modelResolver, animationResolver)
  return { layer, completion, setWorldTranslationOffset }
}

describe('couche 3D des capacités terrain HGSS', () => {
  it('fige l’ancre une case devant le joueur et publie le résultat après 45 + 2 VBlank', async () => {
    const fixture = createFixture(0)
    const effect = fixture.layer.group.children[0]!
    let result: string | undefined
    void fixture.completion.then((value) => { result = value })

    expect(effect.position.toArray()).toEqual([8, 2, -24])
    expect(effect.visible).toBe(true)
    fixture.layer.update(100 + hgssVBlankDurationMs * 44)
    expect(effect.visible).toBe(true)
    fixture.layer.update(100 + hgssVBlankDurationMs * 45)
    expect(effect.visible).toBe(false)
    fixture.layer.update(100 + hgssVBlankDurationMs * 46)
    await Promise.resolve()
    expect(result).toBeUndefined()
    fixture.layer.update(100 + hgssVBlankDurationMs * 47)
    await expect(fixture.completion).resolves.toBe('completed')
    expect(fixture.layer.group.children).toHaveLength(0)
  })

  it('applique uniquement les deux pulses Headbutt selon la direction du joueur', () => {
    const fixture = createFixture(4)
    const update = (frame: number) => fixture.layer.update(100 + hgssVBlankDurationMs * frame)

    update(1)
    update(2)
    update(3)
    update(5)
    update(6)
    update(7)

    expect(fixture.setWorldTranslationOffset.mock.calls).toEqual([
      [0, -8],
      [0, 0],
      [0, -8],
      [0, 0],
    ])
  })

  it('ancre le mode follower sur le follower tout en gardant la caméra du joueur', () => {
    const fixture = createFixture(5)
    expect(fixture.layer.group.children[0]?.position.toArray()).toEqual([8, 4, 8])

    fixture.layer.update(100 + hgssVBlankDurationMs)
    expect(fixture.setWorldTranslationOffset).toHaveBeenCalledWith(0, -8)
  })

  it('annule proprement une génération et restaure la caméra', async () => {
    const fixture = createFixture(4)
    fixture.layer.update(100 + hgssVBlankDurationMs)
    fixture.layer.clear()

    await expect(fixture.completion).resolves.toBe('cancelled')
    expect(fixture.setWorldTranslationOffset).toHaveBeenLastCalledWith(0, 0)
    expect(fixture.layer.group.children).toHaveLength(0)
  })
})
