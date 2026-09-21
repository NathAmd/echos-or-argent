import type { NitroTexturePreview, PlayerTextureFrames } from '../../ndsTypes'
import type {
  MapDynamicPokemonActor,
  MapDynamicPokemonActorEventTexture,
  MapDynamicPokemonSpeciesTextureResolver,
} from '../../rendering/three/dynamicPokemonActorLayer'
import type { DynamicWorldActor, RemotePlayerWorldActor } from './dynamicWorldActorRegistry'

export const browserDynamicWorldActorSources = Object.freeze([
  'new-game-plus',
  'campaign',
] as const)

export type BrowserDynamicWorldActorSource = typeof browserDynamicWorldActorSources[number]

export type BrowserDynamicWorldActorEventTextureResolver = (
  spriteId: number,
  actor: RemotePlayerWorldActor,
) => Readonly<{ preview?: NitroTexturePreview, frames?: PlayerTextureFrames }> | undefined

export type BrowserDynamicWorldActorHostOptions = Readonly<{
  readCurrentMapId: () => number | undefined
  resolveEventTexture: BrowserDynamicWorldActorEventTextureResolver
  resolveSpeciesTexture?: MapDynamicPokemonSpeciesTextureResolver
  renderActors: (
    actors: readonly MapDynamicPokemonActor[],
    speciesResolver?: MapDynamicPokemonSpeciesTextureResolver,
  ) => void
  clearActors: () => void
}>

export type BrowserDynamicWorldActorHost = Readonly<{
  setSourceActors: (
    source: BrowserDynamicWorldActorSource,
    actors: readonly DynamicWorldActor[],
  ) => readonly DynamicWorldActor[]
  clearSourceActors: (source: BrowserDynamicWorldActorSource) => readonly DynamicWorldActor[]
  refresh: () => readonly DynamicWorldActor[]
  getSourceActors: (source: BrowserDynamicWorldActorSource) => readonly DynamicWorldActor[]
  getRenderedActors: () => readonly DynamicWorldActor[]
  clearAll: () => void
}>

type ActorSources = Readonly<Record<BrowserDynamicWorldActorSource, readonly DynamicWorldActor[]>>

const emptyActors: readonly DynamicWorldActor[] = Object.freeze([])

function replaceSource(
  sources: ActorSources,
  source: BrowserDynamicWorldActorSource,
  actors: readonly DynamicWorldActor[],
): ActorSources {
  return Object.freeze({
    ...sources,
    [source]: Object.freeze([...actors]),
  })
}

function mergeSources(sources: ActorSources): readonly DynamicWorldActor[] {
  const identities = new Set<string>()
  const merged: DynamicWorldActor[] = []
  for (const source of browserDynamicWorldActorSources) {
    for (const actor of sources[source]) {
      if (identities.has(actor.id)) {
        throw new Error(`L’identité d’acteur dynamique ${actor.id} appartient à plusieurs sources.`)
      }
      identities.add(actor.id)
      merged.push(actor)
    }
  }
  return Object.freeze(merged)
}

function requireEventTexture(
  actor: RemotePlayerWorldActor,
  resolve: BrowserDynamicWorldActorEventTextureResolver,
): MapDynamicPokemonActorEventTexture {
  const resource = resolve(actor.spriteId, actor)
  if (!resource?.preview || !resource.frames) {
    throw new Error(`Le sprite ROM animé ${actor.spriteId} du joueur distant ${actor.id} est absent ou incomplet.`)
  }
  return Object.freeze({
    preview: resource.preview,
    frames: resource.frames,
  })
}

function toMapActor(
  actor: DynamicWorldActor,
  resolveEventTexture: BrowserDynamicWorldActorEventTextureResolver,
): MapDynamicPokemonActor {
  const base = {
    id: actor.id,
    tileX: actor.tileX,
    tileY: actor.tileZ,
    direction: actor.direction,
    collision: actor.collision,
    interaction: actor.interaction,
  } as const
  return actor.kind === 'remote-player'
    ? Object.freeze({ ...base, texture: requireEventTexture(actor, resolveEventTexture) })
    : Object.freeze({ ...base, speciesId: actor.speciesId })
}

/**
 * Propriétaire unique du port de rendu dynamique. Chaque fonctionnalité garde
 * sa source, puis l’hôte présente leur union sans qu’un clear Coop puisse
 * effacer les Pokémon visibles du New Game+ (et inversement).
 */
export function createBrowserDynamicWorldActorHost(
  options: BrowserDynamicWorldActorHostOptions,
): BrowserDynamicWorldActorHost {
  let sources: ActorSources = Object.freeze({
    'new-game-plus': emptyActors,
    campaign: emptyActors,
  })
  let renderedActors = emptyActors

  const present = (candidate: ActorSources): readonly DynamicWorldActor[] => {
    const merged = mergeSources(candidate)
    const mapId = options.readCurrentMapId()
    if (mapId === undefined) {
      options.clearActors()
      return emptyActors
    }
    const current = Object.freeze(merged.filter((actor) => actor.mapId === mapId))
    options.renderActors(
      current.map((actor) => toMapActor(actor, options.resolveEventTexture)),
      options.resolveSpeciesTexture,
    )
    return current
  }

  const setSourceActors = (
    source: BrowserDynamicWorldActorSource,
    actors: readonly DynamicWorldActor[],
  ): readonly DynamicWorldActor[] => {
    const candidate = replaceSource(sources, source, actors)
    const nextRendered = present(candidate)
    sources = candidate
    renderedActors = nextRendered
    return renderedActors
  }

  const clearSourceActors = (source: BrowserDynamicWorldActorSource): readonly DynamicWorldActor[] => (
    setSourceActors(source, emptyActors)
  )

  const refresh = (): readonly DynamicWorldActor[] => {
    renderedActors = present(sources)
    return renderedActors
  }

  const clearAll = (): void => {
    const candidate: ActorSources = Object.freeze({
      'new-game-plus': emptyActors,
      campaign: emptyActors,
    })
    const nextRendered = present(candidate)
    sources = candidate
    renderedActors = nextRendered
  }

  return Object.freeze({
    setSourceActors,
    clearSourceActors,
    refresh,
    getSourceActors: (source) => sources[source],
    getRenderedActors: () => renderedActors,
    clearAll,
  })
}
