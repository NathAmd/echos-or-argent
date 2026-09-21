import { describe, expect, it, vi } from 'vitest'
import * as THREE from 'three'
import type { NitroTexturePreview, OpeningMapPreview, PlayerDirection, PlayerTextureFrames, PokemonCatalog, PokemonFollowerTextures } from '../../ndsTypes'
import { hgssVBlankDurationMs } from '../../game/world/hgssWorldAnimationClock'
import type { SceneLayout } from '../map/mapProjection'
import { HgssActorIdlePresentation } from './actorIdlePresentation'
import { ActorTerrainPresentationLayer } from './actorTerrainPresentationLayer'
import {
  createMapDynamicPokemonSpeciesTextureResolver,
  DynamicPokemonActorLayer,
  hgssDynamicEventActorStepVBlanks,
  type DynamicPokemonActorLayerContext,
  type MapDynamicPokemonActor,
  type MapDynamicPokemonActorEventTexture,
} from './dynamicPokemonActorLayer'

const layout: SceneLayout = {
  floorMinX: -64,
  floorMaxX: 64,
  floorMinZ: -64,
  floorMaxZ: 64,
  cameraHeight: 8,
  cameraDistance: 10,
  focusX: 0,
  focusZ: 0,
}

function map(id = 30): OpeningMapPreview {
  return {
    id,
    matrix: {
      matrixIndex: id,
      name: `room-${id}`,
      width: 1,
      height: 1,
      hasHeaders: false,
      headers: new Uint16Array([id]),
      altitudes: new Uint8Array(1),
      modelIds: new Uint16Array(1),
    },
    terrain: { width: 8, height: 8, attributes: new Uint16Array(64) },
    model: { modelId: id, positions: new Float32Array([0, 0, 0]) },
  } as OpeningMapPreview
}

function texture(id: string): NitroTexturePreview {
  return {
    id,
    name: id,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
  }
}

function follower(id: string): PokemonFollowerTextures {
  const preview = texture(`${id}-preview`)
  const north = texture(`${id}-north`)
  const south = texture(`${id}-south`)
  const west = texture(`${id}-west`)
  const east = texture(`${id}-east`)
  return {
    preview,
    textures: [preview, north, south, west, east],
    animationFrames: { north: [north], south: [south], west: [west], east: [east] },
  }
}

function eventTexture(id: string): MapDynamicPokemonActorEventTexture {
  const standing = {} as Record<PlayerDirection, NitroTexturePreview>
  const walking = {} as Record<PlayerDirection, NitroTexturePreview[]>
  for (const direction of ['north', 'south', 'west', 'east'] as const) {
    standing[direction] = texture(`${id}-${direction}-standing`)
    walking[direction] = [
      texture(`${id}-${direction}-walking-a`),
      texture(`${id}-${direction}-walking-b`),
    ]
  }
  const frames: PlayerTextureFrames = { standing, walking }
  return { preview: standing.south, frames }
}

function directActor(id: string, tileX: number, tileY: number): MapDynamicPokemonActor {
  return {
    id,
    tileX,
    tileY,
    direction: 'south',
    collision: 'blocking',
    interaction: 'action',
    texture: texture(`${id}-texture`),
  }
}

function harness() {
  const scene = new THREE.Scene()
  const idle = new HgssActorIdlePresentation()
  const terrain = new ActorTerrainPresentationLayer(scene)
  let context: DynamicPokemonActorLayerContext | undefined = { map: map(), layout }
  const groundEffects = { setActor: vi.fn(), removeActor: vi.fn() }
  let now = 1_000
  const layer = new DynamicPokemonActorLayer(scene, () => context, idle, terrain, () => now, groundEffects)
  return {
    scene,
    layer,
    groundEffects,
    setContext: (value: DynamicPokemonActorLayerContext | undefined) => { context = value },
    setNow: (value: number) => { now = value },
    dispose: () => { layer.dispose(); terrain.dispose() },
  }
}

describe('dynamic Pokémon actor layer', () => {
  it('renders direct and species-backed actors and exposes deterministic tile queries', () => {
    const runtime = harness()
    const speciesTexture = follower('species-25')
    const resolveSpecies = vi.fn(() => speciesTexture)
    const actors: MapDynamicPokemonActor[] = [
      directActor('blocker', 2, 3),
      {
        id: 'ambient',
        tileX: 4,
        tileY: 1,
        direction: 'east',
        collision: 'non-blocking',
        interaction: 'none',
        speciesId: 25,
        shiny: true,
      },
    ]

    expect(runtime.layer.syncDynamicPokemonActors(actors, resolveSpecies).map(({ id }) => id)).toEqual(['ambient', 'blocker'])
    expect(runtime.layer.group.children).toHaveLength(2)
    expect(resolveSpecies).toHaveBeenCalledWith(25, expect.objectContaining({ id: 'ambient', shiny: true }))
    expect(runtime.layer.getSprite('blocker')?.position.toArray()).toEqual([-24, 0.08, -8])
    expect(runtime.layer.getSprite('ambient')?.material.map?.name).toBe('')
    expect(runtime.layer.getDynamicPokemonActorsAt(2, 3).map(({ id }) => id)).toEqual(['blocker'])
    expect(runtime.layer.getBlockingDynamicPokemonActorAt(2, 3)?.id).toBe('blocker')
    expect(runtime.layer.isDynamicPokemonActorTileBlocked(2, 3, 'blocker')).toBe(false)
    expect(runtime.layer.isDynamicPokemonActorTileBlocked(4, 1)).toBe(false)
    expect(runtime.layer.getActionDynamicPokemonActorAt(2, 3)?.id).toBe('blocker')
    expect(runtime.layer.getActionDynamicPokemonActorAt(4, 1)).toBeUndefined()
    expect(runtime.groundEffects.setActor).toHaveBeenCalledTimes(2)
    runtime.groundEffects.setActor.mockClear()

    runtime.layer.update(1_500)

    expect(runtime.groundEffects.setActor).not.toHaveBeenCalled()

    runtime.dispose()
  })

  it('atomically replaces actors and disposes superseded GPU resources', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('old', 1, 1)])
    const oldSprite = runtime.layer.getSprite('old')!
    const disposeMaterial = vi.spyOn(oldSprite.material, 'dispose')

    runtime.layer.syncDynamicPokemonActors([directActor('new', 5, 6)])

    expect(runtime.layer.listDynamicPokemonActors().map(({ id }) => id)).toEqual(['new'])
    expect(runtime.layer.group.children).toHaveLength(1)
    expect(runtime.layer.getSprite('old')).toBeUndefined()
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:old')

    runtime.dispose()
  })

  it('reuses a sprite and its GPU resources while updating movement and gameplay metadata', () => {
    const runtime = harness()
    const speciesTexture = follower('moving-species-25')
    const resolveSpecies = vi.fn(() => speciesTexture)
    runtime.layer.syncDynamicPokemonActors([{
      id: 'moving',
      tileX: 1,
      tileY: 1,
      direction: 'south',
      collision: 'blocking',
      interaction: 'action',
      speciesId: 25,
    }], resolveSpecies)
    const sprite = runtime.layer.getSprite('moving')!
    const material = sprite.material
    const firstFrame = material.map!
    const initialPosition = sprite.position.clone()
    const disposeMaterial = vi.spyOn(material, 'dispose')
    const disposeFirstFrame = vi.spyOn(firstFrame, 'dispose')
    runtime.groundEffects.setActor.mockClear()
    runtime.groundEffects.removeActor.mockClear()

    runtime.layer.syncDynamicPokemonActors([{
      id: 'moving',
      tileX: 5,
      tileY: 4,
      groundHeight: 2,
      direction: 'east',
      collision: 'non-blocking',
      interaction: 'none',
      speciesId: 25,
      shiny: false,
    }], resolveSpecies)

    expect(runtime.layer.getSprite('moving')).toBe(sprite)
    expect(sprite.material).toBe(material)
    expect(sprite.position.equals(initialPosition)).toBe(false)
    expect(runtime.layer.listDynamicPokemonActors()).toEqual([
      expect.objectContaining({ id: 'moving', tileX: 5, tileY: 4, direction: 'east', collision: 'non-blocking', interaction: 'none' }),
    ])
    expect(runtime.layer.getBlockingDynamicPokemonActorAt(5, 4)).toBeUndefined()
    expect(runtime.layer.getActionDynamicPokemonActorAt(5, 4)).toBeUndefined()
    expect(resolveSpecies).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).not.toHaveBeenCalled()
    expect(disposeFirstFrame).not.toHaveBeenCalled()
    expect(runtime.groundEffects.removeActor).not.toHaveBeenCalled()
    expect(runtime.groundEffects.setActor).toHaveBeenCalledWith('dynamic:moving', 5, 4, expect.any(Number), true)

    runtime.dispose()
  })

  it('only disposes actors removed from a differential synchronization', () => {
    const runtime = harness()
    const keptTexture = texture('kept-texture')
    const removedTexture = texture('removed-texture')
    const kept: MapDynamicPokemonActor = {
      id: 'kept', tileX: 1, tileY: 1, direction: 'south', collision: 'blocking', interaction: 'action', texture: keptTexture,
    }
    const removed: MapDynamicPokemonActor = {
      id: 'removed', tileX: 2, tileY: 2, direction: 'south', collision: 'blocking', interaction: 'action', texture: removedTexture,
    }
    runtime.layer.syncDynamicPokemonActors([kept, removed])
    const keptSprite = runtime.layer.getSprite('kept')!
    const removedSprite = runtime.layer.getSprite('removed')!
    const disposeKept = vi.spyOn(keptSprite.material, 'dispose')
    const disposeRemoved = vi.spyOn(removedSprite.material, 'dispose')
    runtime.groundEffects.removeActor.mockClear()

    runtime.layer.syncDynamicPokemonActors([{ ...kept, tileX: 3 }])

    expect(runtime.layer.getSprite('kept')).toBe(keptSprite)
    expect(runtime.layer.group.children).toEqual([keptSprite])
    expect(disposeKept).not.toHaveBeenCalled()
    expect(disposeRemoved).toHaveBeenCalledOnce()
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledTimes(1)
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:removed')

    runtime.dispose()
  })

  it('rebuilds a matching identity when its species visual source changes', () => {
    const runtime = harness()
    const resolveSpecies = vi.fn((_speciesId: number, actor: Readonly<{ shiny?: boolean }>) => (
      follower(actor.shiny ? 'shiny' : 'normal')
    ))
    const normal: MapDynamicPokemonActor = {
      id: 'forme', tileX: 1, tileY: 1, direction: 'south', collision: 'blocking', interaction: 'action', speciesId: 25,
    }
    runtime.layer.syncDynamicPokemonActors([normal], resolveSpecies)
    const normalSprite = runtime.layer.getSprite('forme')!
    const disposeNormal = vi.spyOn(normalSprite.material, 'dispose')

    runtime.layer.syncDynamicPokemonActors([{ ...normal, shiny: true }], resolveSpecies)

    expect(runtime.layer.getSprite('forme')).not.toBe(normalSprite)
    expect(disposeNormal).toHaveBeenCalledOnce()
    expect(resolveSpecies).toHaveBeenCalledTimes(2)
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:forme')

    runtime.dispose()
  })

  it('projects an actor on its explicit bridge or tunnel ground layer', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([{
      ...directActor('lower-layer', 2, 3),
      groundHeight: -3.5,
    }])

    expect(runtime.layer.getSprite('lower-layer')?.position.y).toBeCloseTo(-3.42)
    runtime.dispose()
  })

  it('preserves the active set when preparing a replacement fails', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('stable', 1, 0)])
    const stableSprite = runtime.layer.getSprite('stable')
    runtime.groundEffects.removeActor.mockClear()

    expect(() => runtime.layer.syncDynamicPokemonActors([
      directActor('stable', 2, 0),
      {
        id: 'unresolved',
        tileX: 2,
        tileY: 1,
        direction: 'north',
        collision: 'non-blocking',
        interaction: 'none',
        speciesId: 150,
      },
    ])).toThrow(/texture/)

    expect(runtime.layer.listDynamicPokemonActors().map(({ id }) => id)).toEqual(['stable'])
    expect(runtime.layer.getSprite('stable')).toBe(stableSprite)
    expect(runtime.layer.group.children).toEqual([stableSprite])
    expect(runtime.groundEffects.removeActor).not.toHaveBeenCalled()

    runtime.dispose()
  })

  it('clears actors and their resources when the active map object changes, even with the same id', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('map-owned', 3, 3)])
    const sprite = runtime.layer.getSprite('map-owned')!
    const disposeMaterial = vi.spyOn(sprite.material, 'dispose')

    runtime.setContext({ map: map(30), layout })
    runtime.layer.update(2_000)

    expect(runtime.layer.listDynamicPokemonActors()).toEqual([])
    expect(runtime.layer.group.children).toHaveLength(0)
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:map-owned')

    runtime.dispose()
  })

  it('does not leak actors from the previous map when preparing the new map fails', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('previous-map', 3, 3)])
    const previousSprite = runtime.layer.getSprite('previous-map')!
    const disposeMaterial = vi.spyOn(previousSprite.material, 'dispose')

    runtime.setContext({ map: map(31), layout })
    expect(() => runtime.layer.syncDynamicPokemonActors([{
      id: 'unresolved-new-map',
      tileX: 1,
      tileY: 1,
      direction: 'south',
      collision: 'blocking',
      interaction: 'action',
      speciesId: 150,
    }])).toThrow(/texture/)

    expect(runtime.layer.listDynamicPokemonActors()).toEqual([])
    expect(runtime.layer.group.children).toEqual([])
    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:previous-map')

    runtime.dispose()
  })

  it('keeps optional grass failures out of the atomic actor replacement', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('old', 1, 1)])
    runtime.groundEffects.setActor.mockImplementationOnce(() => { throw new Error('grass asset missing') })

    expect(() => runtime.layer.syncDynamicPokemonActors([directActor('new', 2, 2)])).not.toThrow()

    expect(runtime.layer.listDynamicPokemonActors().map(({ id }) => id)).toEqual(['new'])
    expect(runtime.groundEffects.removeActor).toHaveBeenCalledWith('dynamic:new')
    runtime.dispose()
  })

  it('still releases owned GPU resources when optional grass cleanup fails', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('disposable', 2, 2)])
    const material = runtime.layer.getSprite('disposable')!.material
    const disposeMaterial = vi.spyOn(material, 'dispose')
    runtime.groundEffects.removeActor.mockImplementation(() => { throw new Error('grass cleanup failed') })

    expect(() => runtime.layer.clearDynamicPokemonActors()).not.toThrow()

    expect(disposeMaterial).toHaveBeenCalledOnce()
    expect(runtime.layer.group.children).toHaveLength(0)
    runtime.dispose()
  })

  it('maps a species through the ROM follower catalog without inventing a fallback', () => {
    const resource = follower('catalog-entry')
    const followerTextureResolver = vi.fn(() => resource)
    const modelIndexBySpecies: number[] = []
    modelIndexBySpecies[25] = 7
    const catalog = { followers: { modelIndexBySpecies } } as PokemonCatalog
    const resolver = createMapDynamicPokemonSpeciesTextureResolver(catalog, followerTextureResolver)

    expect(resolver(25, { id: 'pikachu', shiny: true })).toBe(resource)
    expect(followerTextureResolver).toHaveBeenCalledWith(7, true)
    expect(resolver(26, { id: 'raichu' })).toBeUndefined()
    expect(followerTextureResolver).toHaveBeenCalledTimes(1)
  })

  it('rejects duplicate identities before touching the active set', () => {
    const runtime = harness()
    runtime.layer.syncDynamicPokemonActors([directActor('stable', 0, 0)])

    expect(() => runtime.layer.syncDynamicPokemonActors([
      directActor('duplicate', 1, 1),
      directActor('duplicate', 2, 2),
    ])).toThrow(/dupliquée/)
    expect(runtime.layer.listDynamicPokemonActors().map(({ id }) => id)).toEqual(['stable'])

    runtime.dispose()
  })

  it('interpolates an adjacent event actor for eight VBlanks, then restores its standing ROM frame', () => {
    const runtime = harness()
    const resource = eventTexture('remote-player')
    const actor: MapDynamicPokemonActor = {
      id: 'campaign-player:guest',
      tileX: 1,
      tileY: 1,
      direction: 'east',
      collision: 'blocking',
      interaction: 'none',
      texture: resource,
    }
    runtime.layer.syncDynamicPokemonActors([actor])
    const sprite = runtime.layer.getSprite(actor.id)!
    const origin = sprite.position.clone()
    const standingTexture = sprite.material.map
    const durationMs = hgssDynamicEventActorStepVBlanks * hgssVBlankDurationMs

    runtime.layer.syncDynamicPokemonActors([{ ...actor, tileX: 2 }])

    expect(sprite.position.toArray()).toEqual(origin.toArray())
    expect(sprite.material.map).not.toBe(standingTexture)

    runtime.layer.update(1_000 + durationMs / 2)
    expect(sprite.position.x).toBeCloseTo(origin.x + 8)
    expect(sprite.position.z).toBeCloseTo(origin.z)
    expect(sprite.material.map).not.toBe(standingTexture)

    runtime.layer.update(1_000 + durationMs)
    expect(sprite.position.x).toBeCloseTo(origin.x + 16)
    expect(sprite.position.z).toBeCloseTo(origin.z)
    expect(sprite.material.map).toBe(standingTexture)

    runtime.dispose()
  })

  it('teleports event actors on a coalesced or non-adjacent snapshot instead of replaying stale steps', () => {
    const runtime = harness()
    const actor: MapDynamicPokemonActor = {
      id: 'campaign-player:coalesced',
      tileX: 1,
      tileY: 1,
      direction: 'east',
      collision: 'blocking',
      interaction: 'none',
      texture: eventTexture('coalesced'),
    }
    runtime.layer.syncDynamicPokemonActors([actor])
    runtime.layer.syncDynamicPokemonActors([{ ...actor, tileX: 2 }])
    const durationMs = hgssDynamicEventActorStepVBlanks * hgssVBlankDurationMs
    runtime.setNow(1_000 + durationMs / 4)
    runtime.layer.update()

    runtime.layer.syncDynamicPokemonActors([{ ...actor, tileX: 3 }])
    const sprite = runtime.layer.getSprite(actor.id)!
    expect(sprite.position.x).toBeCloseTo(3.5 * 16 - 64)
    expect(sprite.material.map).toBeDefined()

    runtime.layer.syncDynamicPokemonActors([{ ...actor, tileX: 7, tileY: 6 }])
    expect(sprite.position.x).toBeCloseTo(7.5 * 16 - 64)
    expect(sprite.position.z).toBeCloseTo(6.5 * 16 - 64)

    runtime.dispose()
  })

  it('disposes every event-frame GPU texture and material during cleanup', () => {
    const runtime = harness()
    const disposeTexture = vi.spyOn(THREE.DataTexture.prototype, 'dispose')
    runtime.layer.syncDynamicPokemonActors([{
      id: 'campaign-player:disposable',
      tileX: 1,
      tileY: 1,
      direction: 'south',
      collision: 'blocking',
      interaction: 'none',
      texture: eventTexture('disposable-event'),
    }])
    const material = runtime.layer.getSprite('campaign-player:disposable')!.material
    const disposeMaterial = vi.spyOn(material, 'dispose')

    runtime.layer.clearDynamicPokemonActors()

    expect(disposeTexture).toHaveBeenCalledTimes(12)
    expect(disposeMaterial).toHaveBeenCalledOnce()
    disposeTexture.mockRestore()
    runtime.dispose()
  })
})
