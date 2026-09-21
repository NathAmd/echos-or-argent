import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { OpeningMapPreview } from '../../ndsTypes'
import {
  ActorTerrainPresentationLayer,
  classifyActorTerrainSurface,
  createHgssSurfWake,
  hgssNativeWaterSurfaceRenderOrder,
  hgssSurfWakeRenderOrderOffset,
  resolveActorTerrainComposition,
  syncHgssSurfWake,
} from './actorTerrainPresentationLayer'

function exteriorMap(attributes: number[]): OpeningMapPreview {
  return {
    id: 61,
    matrix: {
      matrixIndex: 61,
      name: 'field',
      width: 2,
      height: 1,
      headers: new Uint16Array([60, 61]),
      altitudes: new Uint8Array(2),
      modelIds: new Uint16Array(2),
    },
    terrain: { width: attributes.length, height: 1, attributes: new Uint16Array(attributes) },
    model: { modelId: 0, positions: new Float32Array([0, 0, 0]) },
  } as OpeningMapPreview
}

function actor(): THREE.Sprite {
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() }))
  sprite.visible = true
  sprite.position.set(2, 0.08, 3)
  sprite.scale.set(1.55, 1.55, 1)
  return sprite
}

describe('actor terrain presentation layer', () => {
  it('separates land, reflective ice, and native Surf terrain', () => {
    expect(classifyActorTerrainSurface(0)).toBe('land')
    expect(classifyActorTerrainSurface(32)).toBe('reflective')
    expect(classifyActorTerrainSurface(0x8010)).toBe('water')
    expect(resolveActorTerrainComposition(0, true, 'player', 'walking')).toEqual({
      surface: 'land', showProjectedShadow: true, showReflection: false, showSurfWake: false,
    })
    expect(resolveActorTerrainComposition(32, true, 'player', 'walking')).toEqual({
      surface: 'reflective', showProjectedShadow: false, showReflection: true, showSurfWake: false,
    })
    expect(resolveActorTerrainComposition(16, true, 'player', 'surfing')).toEqual({
      surface: 'water', showProjectedShadow: false, showReflection: false, showSurfWake: true,
    })
  })

  it('places the Surf wake between the water surface and the player', () => {
    const sprite = actor()
    const wake = createHgssSurfWake()

    syncHgssSurfWake(wake, sprite, true, 0, 120)

    expect(wake.visible).toBe(true)
    expect(wake.position.y).toBeGreaterThan(0)
    expect(wake.position.y).toBeLessThan(sprite.position.y)
    expect(hgssNativeWaterSurfaceRenderOrder).toBeLessThan(hgssSurfWakeRenderOrderOffset)
    expect(hgssSurfWakeRenderOrderOffset).toBeLessThan(sprite.renderOrder)
    expect(wake.children.every(({ renderOrder }) => renderOrder === hgssSurfWakeRenderOrderOffset)).toBe(true)
    expect(wake.children.every((child) => ((child as THREE.Mesh).material as THREE.Material).depthWrite === false)).toBe(true)
  })

  it('switches shadow, reflection, and wake without leaking the previous terrain state', () => {
    const scene = new THREE.Scene()
    const layer = new ActorTerrainPresentationLayer(scene)
    const sprite = actor()
    const map = exteriorMap([0, 32, 16])

    layer.sync(sprite, map, 0, 0, 'player', 0, 0)
    const shadow = layer.group.getObjectByName('hgss-actor-projected-shadow') as THREE.Mesh
    expect(shadow.visible).toBe(true)
    expect(shadow.renderOrder).toBe(-2)
    expect((shadow.material as THREE.Material).depthWrite).toBe(false)
    expect(layer.group.getObjectByName('hgss-actor-ice-reflection')?.visible).toBe(false)

    layer.sync(sprite, map, 1, 0, 'player', 0, 1)
    const reflection = layer.group.getObjectByName('hgss-actor-ice-reflection') as THREE.Sprite
    expect(shadow.visible).toBe(false)
    expect(reflection.visible).toBe(true)
    expect(reflection.renderOrder).toBe(-1)
    expect(reflection.material.depthWrite).toBe(false)

    layer.setPlayerLocomotion('surfing')
    layer.sync(sprite, map, 2, 0, 'player', 0, 2)
    expect(layer.group.getObjectByName('hgss-actor-ice-reflection')?.visible).toBe(false)
    expect(layer.group.getObjectByName('hgss-player-surf-wake')?.visible).toBe(true)

    layer.setPlayerLocomotion('walking')
    expect(layer.group.getObjectByName('hgss-player-surf-wake')?.visible).toBe(false)
  })

  it('clears map-owned effects and disposes the focused layer', () => {
    const scene = new THREE.Scene()
    const layer = new ActorTerrainPresentationLayer(scene)
    const sprite = actor()
    layer.sync(sprite, exteriorMap([32]), 0, 0, 'player', 0, 0)
    const wake = layer.group.getObjectByName('hgss-player-surf-wake') as THREE.Group
    const wakeGeometry = (wake.children[0] as THREE.Mesh).geometry
    const disposeGeometry = vi.spyOn(wakeGeometry, 'dispose')

    layer.clear()
    expect(layer.group.getObjectByName('hgss-actor-projected-shadows')?.children).toHaveLength(0)
    expect(layer.group.getObjectByName('hgss-actor-ice-reflections')?.children).toHaveLength(0)
    expect(wake.visible).toBe(false)

    layer.dispose()
    expect(disposeGeometry).toHaveBeenCalledOnce()
    expect(scene.children).not.toContain(layer.group)
  })
})
