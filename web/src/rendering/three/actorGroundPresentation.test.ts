import { describe, expect, it } from 'vitest'
import * as THREE from 'three'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createIceActorReflection, createProjectedActorShadow, getActorSpriteRenderOrder, IceActorReflectionLayer, isReflectiveTerrainAttribute, ProjectedActorShadowLayer, resolveActorSpriteDepthMode, syncIceActorReflection, syncProjectedActorShadow, usesActorDepthBuffer, usesSceneDepthForSprites } from './actorGroundPresentation'

describe('actor ground presentation', () => {
  it('shares the native exterior depth and indoor south-to-north ordering', () => {
    const exterior = {
      id: 61,
      matrix: {
        matrixIndex: 0, name: 'world', width: 2, height: 1,
        headers: new Uint16Array([60, 61]), altitudes: new Uint8Array(2), modelIds: new Uint16Array(2),
      },
      model: { modelId: 0, positions: new Float32Array([0, 0, 0]) },
    } as OpeningMapPreview
    expect(usesSceneDepthForSprites(exterior)).toBe(true)
    expect(resolveActorSpriteDepthMode(exterior)).toBe('upright')
    expect(getActorSpriteRenderOrder(exterior, 7)).toBe(0)
    expect(getActorSpriteRenderOrder(undefined, 7)).toBe(100_750)
  })

  it('keeps indoor actors upright in the ROM scene depth buffer', () => {
    const indoor = {
      id: 63,
      matrix: {
        matrixIndex: 63, name: 'room', width: 1, height: 1,
        headers: new Uint16Array([63]), altitudes: new Uint8Array(1), modelIds: new Uint16Array(1),
      },
      model: { modelId: 0, positions: new Float32Array([0, 0, 0]) },
    } as OpeningMapPreview

    expect(usesSceneDepthForSprites(indoor)).toBe(false)
    expect(usesActorDepthBuffer(indoor)).toBe(true)
    expect(resolveActorSpriteDepthMode(indoor)).toBe('upright')
    expect(usesActorDepthBuffer(undefined)).toBe(false)
    expect(resolveActorSpriteDepthMode(undefined)).toBe('none')
  })

  it('recognizes the two reflective HGSS terrain behaviors', () => {
    expect(isReflectiveTerrainAttribute(0x8020)).toBe(true)
    expect(isReflectiveTerrainAttribute(45)).toBe(true)
    expect(isReflectiveTerrainAttribute(62)).toBe(false)
  })

  it('shows a mirrored ground projection only while the actor stands on reflective terrain', () => {
    const map = { terrain: { width: 2, height: 1, attributes: new Uint16Array([32, 0]) } } as OpeningMapPreview
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() }))
    sprite.center.set(0.5, 0.125)
    sprite.scale.set(32, 32, 1)
    sprite.position.set(0, 0.08, 0)
    const reflection = createIceActorReflection()
    syncIceActorReflection(reflection, sprite, map, 0, 0)
    expect(reflection.visible).toBe(true)
    expect(reflection.scale.y).toBeCloseTo(26.24)
    expect(reflection.center.y).toBe(0.875)
    expect(reflection.material.map).not.toBe(sprite.material.map)
    expect(reflection.material.map?.repeat.y).toBe(-1)
    expect(reflection.material.map?.offset.y).toBe(1)
    expect(reflection.material.depthTest).toBe(true)
    expect(reflection.material.depthWrite).toBe(false)
    syncIceActorReflection(reflection, sprite, map, 1, 0)
    expect(reflection.visible).toBe(false)
  })

  it('maintains independent reflections for the player, follower, and world actors', () => {
    const scene = new THREE.Scene()
    const layer = new IceActorReflectionLayer(scene)
    const map = { terrain: { width: 2, height: 1, attributes: new Uint16Array([32, 32]) } } as OpeningMapPreview
    const actors = Array.from({ length: 3 }, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() })))
    actors.forEach((actor, index) => layer.sync(actor, map, index % 2, 0))
    expect(layer.group.children).toHaveLength(3)
    layer.unregister(actors[2]!)
    expect(layer.group.children).toHaveLength(2)
    layer.dispose()
    expect(scene.children).not.toContain(layer.group)
  })

  it('projects the real actor silhouette along the world light direction', () => {
    const texture = new THREE.Texture()
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: texture }))
    sprite.center.set(0.5, 0.125)
    sprite.position.set(4, 2.08, 7)
    sprite.scale.set(1.55, 1.55, 1)
    const shadow = createProjectedActorShadow()
    syncProjectedActorShadow(shadow, sprite, true, 120)
    expect(shadow.visible).toBe(true)
    expect(shadow.material.map).toBe(texture)
    expect(shadow.position.y).toBeCloseTo(2.01)
    expect(shadow.scale.x).toBeCloseTo(1.116)
    expect(shadow.scale.z).toBeCloseTo(0.961)
    expect(shadow.renderOrder).toBe(118)
    syncProjectedActorShadow(shadow, sprite, false, 120)
    expect(shadow.visible).toBe(false)
  })

  it('maintains projected shadows independently for player, follower, and NPCs', () => {
    const scene = new THREE.Scene()
    const layer = new ProjectedActorShadowLayer(scene)
    const actors = Array.from({ length: 3 }, () => new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.Texture() })))
    actors.forEach((actor) => layer.sync(actor, true, 10))
    expect(layer.group.children).toHaveLength(3)
    layer.unregister(actors[2]!)
    expect(layer.group.children).toHaveLength(2)
    layer.dispose()
    expect(scene.children).not.toContain(layer.group)
  })
})
