import { describe, expect, it, vi } from 'vitest'
import type { NitroTexturePreview, PlayerDirection, PlayerTextureFrames } from '../../ndsTypes'
import type { MapDynamicPokemonActor } from '../../rendering/three/dynamicPokemonActorLayer'
import {
  createBrowserDynamicWorldActorHost,
  type BrowserDynamicWorldActorEventTextureResolver,
} from './browserDynamicWorldActorHost'
import type { DynamicWorldActor, RemotePlayerWorldActor, VisibleWildWorldActor } from './dynamicWorldActorRegistry'

function preview(id: string): NitroTexturePreview {
  return {
    id,
    name: id,
    width: 1,
    height: 1,
    pixels: new Uint8ClampedArray([255, 255, 255, 255]),
  }
}

function eventFrames(id: string): PlayerTextureFrames {
  const standing = {} as Record<PlayerDirection, NitroTexturePreview>
  const walking = {} as Record<PlayerDirection, NitroTexturePreview[]>
  for (const direction of ['north', 'south', 'west', 'east'] as const) {
    standing[direction] = preview(`${id}-${direction}-standing`)
    walking[direction] = [preview(`${id}-${direction}-walking`)]
  }
  return { standing, walking }
}

function remote(id: string, mapId: number, spriteId = 97): RemotePlayerWorldActor {
  return {
    id,
    kind: 'remote-player',
    displayName: id,
    spriteId,
    mapId,
    tileX: 3,
    tileZ: 4,
    direction: 'south',
    collision: 'blocking',
    interaction: 'none',
  }
}

function visible(id: string, mapId: number): VisibleWildWorldActor {
  return {
    id,
    kind: 'visible-wild',
    speciesId: 25,
    form: 0,
    level: 5,
    mapId,
    tileX: 7,
    tileZ: 8,
    direction: 'west',
    collision: 'blocking',
    interaction: 'action',
  }
}

function harness() {
  let mapId: number | undefined = 30
  const resources = new Map<number, { preview?: NitroTexturePreview, frames?: PlayerTextureFrames }>([
    [97, { preview: preview('remote-97'), frames: eventFrames('remote-97') }],
  ])
  const resolveEventTexture = vi.fn<BrowserDynamicWorldActorEventTextureResolver>(
    (spriteId) => resources.get(spriteId),
  )
  const renderActors = vi.fn<(actors: readonly MapDynamicPokemonActor[]) => void>()
  const clearActors = vi.fn<() => void>()
  const host = createBrowserDynamicWorldActorHost({
    readCurrentMapId: () => mapId,
    resolveEventTexture,
    resolveSpeciesTexture: () => undefined,
    renderActors,
    clearActors,
  })
  return {
    host,
    resources,
    resolveEventTexture,
    renderActors,
    clearActors,
    setMapId: (value: number | undefined) => { mapId = value },
  }
}

describe('browser dynamic world actor host', () => {
  it('aggregates New Game+ and campaign sources without either source erasing the other', () => {
    const runtime = harness()
    const pokemon = visible('visible:25', 30)
    const player = remote('campaign-player:guest', 30)

    runtime.host.setSourceActors('new-game-plus', [pokemon])
    expect(runtime.host.setSourceActors('campaign', [player])).toEqual([pokemon, player])

    const rendered = runtime.renderActors.mock.calls.at(-1)?.[0] ?? []
    expect(rendered).toEqual([
      expect.objectContaining({ id: pokemon.id, speciesId: 25, tileY: 8 }),
      expect.objectContaining({
        id: player.id,
        tileY: 4,
        texture: expect.objectContaining({
          preview: runtime.resources.get(97)?.preview,
          frames: runtime.resources.get(97)?.frames,
        }),
      }),
    ])
    expect(runtime.resolveEventTexture).toHaveBeenCalledWith(97, player)

    expect(runtime.host.clearSourceActors('campaign')).toEqual([pokemon])
    expect(runtime.renderActors.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: pokemon.id }),
    ])
    expect(runtime.host.getSourceActors('new-game-plus')).toEqual([pokemon])
    expect(runtime.host.getSourceActors('campaign')).toEqual([])
  })

  it('filters every source on the active map and can refresh after a map transition', () => {
    const runtime = harness()
    const firstMap = visible('map-30', 30)
    const secondMap = remote('map-31', 31)
    runtime.host.setSourceActors('new-game-plus', [firstMap])
    runtime.host.setSourceActors('campaign', [secondMap])

    expect(runtime.host.getRenderedActors()).toEqual([firstMap])
    runtime.setMapId(31)
    expect(runtime.host.refresh()).toEqual([secondMap])
    expect(runtime.renderActors.mock.calls.at(-1)?.[0]).toEqual([
      expect.objectContaining({ id: secondMap.id, texture: expect.any(Object) }),
    ])

    runtime.setMapId(undefined)
    expect(runtime.host.refresh()).toEqual([])
    expect(runtime.clearActors).toHaveBeenCalledOnce()
    expect(runtime.host.getSourceActors('campaign')).toEqual([secondMap])
  })

  it('rejects an incomplete remote event resource without committing or clearing the last valid source', () => {
    const runtime = harness()
    const stable = remote('stable-player', 30)
    runtime.host.setSourceActors('campaign', [stable])
    const renderedCalls = runtime.renderActors.mock.calls.length
    runtime.resources.set(98, { preview: preview('incomplete') })

    expect(() => runtime.host.setSourceActors('campaign', [remote('incomplete-player', 30, 98)]))
      .toThrow(/absent ou incomplet/)
    expect(runtime.host.getSourceActors('campaign')).toEqual([stable])
    expect(runtime.host.getRenderedActors()).toEqual([stable])
    expect(runtime.renderActors).toHaveBeenCalledTimes(renderedCalls)
    expect(runtime.clearActors).not.toHaveBeenCalled()
  })

  it('rejects cross-source identity collisions transactionally', () => {
    const runtime = harness()
    const first = visible('shared-id', 30)
    runtime.host.setSourceActors('new-game-plus', [first])
    const renderedCalls = runtime.renderActors.mock.calls.length
    const collision: DynamicWorldActor = remote('shared-id', 30)

    expect(() => runtime.host.setSourceActors('campaign', [collision])).toThrow(/plusieurs sources/)
    expect(runtime.host.getSourceActors('campaign')).toEqual([])
    expect(runtime.host.getRenderedActors()).toEqual([first])
    expect(runtime.renderActors).toHaveBeenCalledTimes(renderedCalls)
  })

  it('clears both owned sources together while retaining the render port ownership', () => {
    const runtime = harness()
    runtime.host.setSourceActors('new-game-plus', [visible('visible', 30)])
    runtime.host.setSourceActors('campaign', [remote('guest', 30)])

    runtime.host.clearAll()

    expect(runtime.host.getSourceActors('new-game-plus')).toEqual([])
    expect(runtime.host.getSourceActors('campaign')).toEqual([])
    expect(runtime.host.getRenderedActors()).toEqual([])
    expect(runtime.renderActors.mock.calls.at(-1)?.[0]).toEqual([])
  })
})
