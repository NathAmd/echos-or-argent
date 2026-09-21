import type { PlayerDirection } from '../../../ndsTypes'
import type { PreparedFieldWildEncounter } from '../../encounters/wildEncounterSelection'
import {
  defineVersionedSaveExtension,
  type VersionedSaveExtensionContributor,
} from '../../save/versionedSaveExtensions'
import {
  createDynamicWorldActorRegistry,
  dynamicWorldActorLimits,
  dynamicWorldActorSnapshotVersion,
  type DynamicWorldActorRegistry,
  type VisibleWildWorldActor,
} from '../../world/dynamicWorldActorRegistry'
import type { WorldSessionExtensionPorts } from '../../world/worldSession'
import {
  decodeVisibleWildPokemonConfig,
  defaultVisibleWildPokemonConfig,
  type VisibleWildPokemonConfig,
} from './visibleWildPokemonModule'
import {
  createEmptyVisibleWildPokemonState,
  isVisibleWildPokemonStateV1,
  parseVisibleWildPokemonStateV1,
  requireVisibleWildEncounterKey,
  visibleWildPokemonStateLimits,
  type PersistedVisibleWildActorV1,
  type RetiredVisibleWildEncounterV1,
  type VisibleWildEncounterMethod,
  type VisibleWildPopulationCycleV1,
  type VisibleWildPokemonStateV1,
} from './visibleWildPokemonState'

export const visibleWildPokemonSaveExtensionKey = 'new-game-plus.visible-wild-pokemon'
export const visibleWildPokemonSaveExtensionVersion = 1

export type VisibleWildSpawnTile = Readonly<{
  tileX: number
  tileZ: number
}>

/** Rencontre déjà préparée par le moteur hôte, jamais générée par ce module. */
export type VisibleWildPreparedCandidate = Readonly<{
  encounterKey: string
  prepared: PreparedFieldWildEncounter
  form?: number
  /** Lie une identite dependante d'une zone (Safari) a la case qui l'a produite. */
  spawnTile?: VisibleWildSpawnTile
}>

export type VisibleWildMapPreparation = Readonly<{
  mapId: number
  spawnTiles: readonly VisibleWildSpawnTile[]
  /** Le callback doit appliquer en amont les autres ports d'identité NG+. */
  prepareEncounters: () => readonly VisibleWildPreparedCandidate[]
  /** Couture terrain/NPC/joueur possédée par le host ; les tuiles doivent déjà être praticables si elle est absente. */
  canOccupy?: (tile: Readonly<{ mapId: number, tileX: number, tileZ: number }>) => boolean
  /** Empêche notamment de placer un candidat terrestre sur une case de Surf, et inversement. */
  canPlaceCandidate?: (
    candidate: Readonly<{ encounterKey: string, encounterMethod: VisibleWildEncounterMethod }>,
    tile: Readonly<{ mapId: number, tileX: number, tileZ: number }>,
  ) => boolean
}>

export type VisibleWildInteraction = Readonly<{
  actorId: string
  encounterKey: string
  mapId: number
  source: 'visible-world'
  encounterMethod: VisibleWildEncounterMethod
  identity: Readonly<{
    speciesId: number
    form: number
    level: number
  }>
}>

export type PreparedVisibleWildInteraction = VisibleWildInteraction & Readonly<{
  prepared: PreparedFieldWildEncounter
}>

export type VisibleWildMovementContext = Readonly<{
  mapId: number
  /** Doit inclure le terrain, les objets ROM, le joueur et les autres fournisseurs dynamiques du host. */
  canOccupy: (
    tile: Readonly<{ mapId: number, tileX: number, tileZ: number }>,
    actor: VisibleWildWorldActor,
  ) => boolean
}>

export type VisibleWildPokemonRuntime = Readonly<{
  config: VisibleWildPokemonConfig
  registry: DynamicWorldActorRegistry
  worldSessionExtensionPorts: WorldSessionExtensionPorts
  syncMap: (preparation: VisibleWildMapPreparation) => readonly VisibleWildWorldActor[]
  advanceMovement: (context: VisibleWildMovementContext) => readonly VisibleWildWorldActor[]
  getInteraction: (actorId: string) => VisibleWildInteraction | undefined
  resolvePreparedInteraction: (
    actorId: string,
    resolve: (interaction: VisibleWildInteraction) => PreparedFieldWildEncounter | undefined,
  ) => PreparedVisibleWildInteraction | undefined
  /** À appeler seulement après que le moteur hôte a effectivement démarré la rencontre. */
  commitEncounterStarted: (actorId: string) => VisibleWildInteraction | undefined
  hasPendingRepopulation: (mapId: number) => boolean
  snapshotState: () => VisibleWildPokemonStateV1
  restoreState: (value: unknown) => void
}>

const visibleMethods = new Set<VisibleWildEncounterMethod>(['land', 'surfing', 'safari'])
const directions = Object.freeze<PlayerDirection[]>(['north', 'east', 'south', 'west'])
const coordinateDeltas: Readonly<Record<PlayerDirection, readonly [number, number]>> = Object.freeze({
  north: [0, -1] as const,
  east: [1, 0] as const,
  south: [0, 1] as const,
  west: [-1, 0] as const,
})

type NormalizedCandidate = Readonly<{
  encounterKey: string
  method: VisibleWildEncounterMethod
  speciesId: number
  form: number
  level: number
  spawnTile?: VisibleWildSpawnTile
}>

function requireMapId(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > dynamicWorldActorLimits.maxMapId) {
    throw new Error(`${label} est invalide.`)
  }
  return value as number
}

function requireCoordinate(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value)
    || (value as number) < -dynamicWorldActorLimits.maxCoordinate
    || (value as number) > dynamicWorldActorLimits.maxCoordinate) {
    throw new Error(`${label} est invalide.`)
  }
  return value as number
}

function requireDenseArray(value: unknown, maximum: number, label: string): readonly unknown[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximum) {
    throw new Error(`${label} est invalide.`)
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1 || keys[value.length] !== 'length') {
    throw new Error(`${label} doit être un tableau dense sans champ supplémentaire.`)
  }
  for (let index = 0; index < value.length; index += 1) {
    if (keys[index] !== String(index)) throw new Error(`${label} doit être un tableau dense.`)
  }
  return value
}

function stableHash32(value: string): number {
  let hash = 0x811c9dc5
  for (let index = 0; index < value.length; index += 1) {
    const codeUnit = value.charCodeAt(index)
    hash = Math.imul(hash ^ (codeUnit & 0xff), 0x01000193)
    hash = Math.imul(hash ^ (codeUnit >>> 8), 0x01000193)
  }
  hash ^= hash >>> 16
  hash = Math.imul(hash, 0x85ebca6b)
  hash ^= hash >>> 13
  hash = Math.imul(hash, 0xc2b2ae35)
  return (hash ^ (hash >>> 16)) >>> 0
}

function score(seed: string, domain: string, identity: readonly (string | number)[]): number {
  return stableHash32(JSON.stringify(['pokemaster-visible-wild', 1, seed, domain, ...identity]))
}

function compareScored<T>(
  left: Readonly<{ value: T, score: number, tieBreaker: string }>,
  right: Readonly<{ value: T, score: number, tieBreaker: string }>,
): number {
  if (left.score !== right.score) return left.score - right.score
  return left.tieBreaker < right.tieBreaker ? -1 : left.tieBreaker > right.tieBreaker ? 1 : 0
}

function normalizeCandidate(value: VisibleWildPreparedCandidate, mapId: number): NormalizedCandidate | undefined {
  if (!value || typeof value !== 'object') throw new Error('Une rencontre préparée pour le monde visible est invalide.')
  const encounterKey = requireVisibleWildEncounterKey(value.encounterKey, 'prepareEncounters[].encounterKey')
  const encounter = value.prepared?.encounter
  if (!encounter || typeof encounter !== 'object') {
    throw new Error(`La rencontre préparée « ${encounterKey} » ne contient aucune identité sauvage.`)
  }
  // Pêche et roamers conservent leurs déclencheurs HGSS dédiés : ils ne sont pas matérialisés ici.
  if (!visibleMethods.has(encounter.method as VisibleWildEncounterMethod)) return undefined
  if (!Number.isSafeInteger(encounter.speciesId) || encounter.speciesId < 1 || encounter.speciesId > 493) {
    throw new Error(`L'espèce de la rencontre visible « ${encounterKey} » est invalide sur la carte ${mapId}.`)
  }
  if (!Number.isSafeInteger(encounter.level) || encounter.level < 1 || encounter.level > 100) {
    throw new Error(`Le niveau de la rencontre visible « ${encounterKey} » est invalide sur la carte ${mapId}.`)
  }
  const form = value.form ?? 0
  if (!Number.isSafeInteger(form) || form < 0 || form > dynamicWorldActorLimits.maxForm) {
    throw new Error(`La forme de la rencontre visible « ${encounterKey} » est invalide.`)
  }
  if (value.spawnTile !== undefined
    && (!value.spawnTile || typeof value.spawnTile !== 'object' || Array.isArray(value.spawnTile))) {
    throw new Error(`La case preferee de la rencontre visible « ${encounterKey} » est invalide.`)
  }
  const spawnTile = value.spawnTile === undefined ? undefined : Object.freeze({
    tileX: requireCoordinate(value.spawnTile.tileX, `La coordonnee X preferee de la rencontre visible « ${encounterKey} »`),
    tileZ: requireCoordinate(value.spawnTile.tileZ, `La coordonnee Z preferee de la rencontre visible « ${encounterKey} »`),
  })
  return Object.freeze({
    encounterKey,
    method: encounter.method as VisibleWildEncounterMethod,
    speciesId: encounter.speciesId,
    form,
    level: encounter.level,
    ...(spawnTile === undefined ? {} : { spawnTile }),
  })
}

function toActor(record: PersistedVisibleWildActorV1): VisibleWildWorldActor {
  return Object.freeze({
    id: record.id,
    kind: 'visible-wild',
    mapId: record.mapId,
    tileX: record.tileX,
    tileZ: record.tileZ,
    direction: record.direction,
    collision: 'blocking',
    interaction: 'action',
    speciesId: record.speciesId,
    form: record.form,
    level: record.level,
  })
}

function toInteraction(record: PersistedVisibleWildActorV1): VisibleWildInteraction {
  return Object.freeze({
    actorId: record.id,
    encounterKey: record.encounterKey,
    mapId: record.mapId,
    source: 'visible-world',
    encounterMethod: record.encounterMethod,
    identity: Object.freeze({
      speciesId: record.speciesId,
      form: record.form,
      level: record.level,
    }),
  })
}

function retiredIdentity(mapId: number, encounterKey: string): string {
  return `${mapId}:${encounterKey}`
}

function actorIdentity(seed: string, mapId: number, encounterKey: string): string {
  const first = score(seed, 'actor-id-a', [mapId, encounterKey]).toString(16).padStart(8, '0')
  const second = score(seed, 'actor-id-b', [encounterKey, mapId]).toString(16).padStart(8, '0')
  return `ngp-visible-wild:${mapId}:${first}${second}`
}

function assertPreparedInteractionMatches(
  interaction: VisibleWildInteraction,
  prepared: PreparedFieldWildEncounter,
): void {
  const encounter = prepared?.encounter
  if (!encounter
    || encounter.method !== interaction.encounterMethod
    || encounter.speciesId !== interaction.identity.speciesId
    || encounter.level !== interaction.identity.level) {
    throw new Error(
      `La rencontre résolue pour l'acteur ${interaction.actorId} ne correspond pas à son identité persistée.`,
    )
  }
}

export function createVisibleWildPokemonRuntime(
  configValue: unknown = defaultVisibleWildPokemonConfig,
  stateValue: unknown = createEmptyVisibleWildPokemonState(),
): VisibleWildPokemonRuntime {
  const config = decodeVisibleWildPokemonConfig(configValue)
  const registry = createDynamicWorldActorRegistry()
  let actors = new Map<string, PersistedVisibleWildActorV1>()
  let retired = new Map<string, RetiredVisibleWildEncounterV1>()
  let populationCycles = new Map<number, VisibleWildPopulationCycleV1>()

  const restoreState = (value: unknown): void => {
    const state = parseVisibleWildPokemonStateV1(value)
    const nextActors = new Map(state.actors.map((actor) => [actor.id, actor]))
    const nextRetired = new Map(state.retiredEncounters.map((entry) => [
      retiredIdentity(entry.mapId, entry.encounterKey),
      entry,
    ]))
    const nextPopulationCycles = new Map(state.populationCycles.map((entry) => [entry.mapId, entry]))
    registry.restore({
      version: dynamicWorldActorSnapshotVersion,
      actors: state.actors.map(toActor),
    })
    actors = nextActors
    retired = nextRetired
    populationCycles = nextPopulationCycles
  }

  restoreState(stateValue)

  const getActorsOnMap = (mapId: number): readonly VisibleWildWorldActor[] => Object.freeze(
    registry.getActorsOnMap(mapId).filter((actor): actor is VisibleWildWorldActor => actor.kind === 'visible-wild'),
  )

  const setPopulationCycle = (entry: VisibleWildPopulationCycleV1): void => {
    if (!populationCycles.has(entry.mapId)
      && populationCycles.size >= visibleWildPokemonStateLimits.maximumPopulationCycles) {
      const oldestMapId = [...populationCycles.keys()].sort((left, right) => left - right)[0]
      if (oldestMapId === undefined) throw new Error('La memoire des cycles Pokemon visibles est saturee.')
      populationCycles.delete(oldestMapId)
    }
    populationCycles.set(entry.mapId, entry)
  }

  const syncMap = (preparation: VisibleWildMapPreparation): readonly VisibleWildWorldActor[] => {
    const mapId = requireMapId(preparation.mapId, 'La carte des Pokémon visibles')
    // Le runtime visible ne garde que la carte active : les rencontres retirees
    // restent persistantes, mais les acteurs d'une ancienne carte seront
    // reconstruits si le joueur y retourne. L'eviction n'est commitee qu'une
    // fois tous les callbacks de la nouvelle carte valides.
    const evictedIds = new Set([...actors].flatMap(([actorId, actor]) => (
      actor.mapId !== mapId || (!config.includeSafari && actor.encounterMethod === 'safari')
        ? [actorId]
        : []
    )))
    const evictInactiveActors = (): void => {
      for (const actorId of evictedIds) {
        actors.delete(actorId)
        registry.remove(actorId)
      }
    }
    const existing = getActorsOnMap(mapId).filter(({ id }) => !evictedIds.has(id))
    if (existing.length > 0) {
      evictInactiveActors()
      return existing
    }
    if (typeof preparation.prepareEncounters !== 'function') {
      throw new Error('Le callback de préparation des rencontres visibles est absent.')
    }
    if (preparation.canOccupy !== undefined && typeof preparation.canOccupy !== 'function') {
      throw new Error("Le callback d'occupation des Pokémon visibles est invalide.")
    }
    if (preparation.canPlaceCandidate !== undefined && typeof preparation.canPlaceCandidate !== 'function') {
      throw new Error("Le callback de placement des Pokémon visibles est invalide.")
    }
    const candidateValues = requireDenseArray(
      preparation.prepareEncounters(),
      512,
      'La liste des rencontres préparées visibles',
    )
    const candidateKeys = new Set<string>()
    const allCandidates: NormalizedCandidate[] = []
    for (const value of candidateValues) {
      const candidate = normalizeCandidate(value as VisibleWildPreparedCandidate, mapId)
      if (!candidate || (candidate.method === 'safari' && !config.includeSafari)) continue
      if (candidateKeys.has(candidate.encounterKey)) {
        throw new Error(`La clé de rencontre visible « ${candidate.encounterKey} » est déclarée plusieurs fois sur la carte ${mapId}.`)
      }
      candidateKeys.add(candidate.encounterKey)
      allCandidates.push(candidate)
    }
    const populationCycle = populationCycles.get(mapId)
    let normalizedCandidates = allCandidates.filter(({ encounterKey }) => !retired.has(retiredIdentity(mapId, encounterKey)))
    const candidatesExhausted = allCandidates.length > 0 && normalizedCandidates.length === 0
    const completesRepopulationWait = candidatesExhausted && populationCycle?.repopulationPending === true
    const startsRepopulationWait = candidatesExhausted && !completesRepopulationWait
    if (completesRepopulationWait) normalizedCandidates = allCandidates

    const tileValues = requireDenseArray(preparation.spawnTiles, 4_096, 'La liste des tuiles de Pokémon visibles')
    const tileKeys = new Set<string>()
    const tiles: VisibleWildSpawnTile[] = []
    for (let index = 0; index < tileValues.length; index += 1) {
      const tile = tileValues[index]
      if (!tile || typeof tile !== 'object' || Array.isArray(tile)) {
        throw new Error(`La tuile visible ${index} est invalide.`)
      }
      const tileX = requireCoordinate((tile as VisibleWildSpawnTile).tileX, `La coordonnée X de la tuile visible ${index}`)
      const tileZ = requireCoordinate((tile as VisibleWildSpawnTile).tileZ, `La coordonnée Z de la tuile visible ${index}`)
      const key = `${tileX}:${tileZ}`
      if (tileKeys.has(key)) throw new Error(`La tuile visible ${key} est déclarée plusieurs fois.`)
      tileKeys.add(key)
      const normalized = Object.freeze({ tileX, tileZ })
      if (preparation.canOccupy?.({ mapId, tileX, tileZ }) === false) continue
      if (registry.getBlockingActorsAt(mapId, tileX, tileZ).length > 0) continue
      tiles.push(normalized)
    }

    const orderedCandidates = normalizedCandidates.map((value) => ({
      value,
      score: score(config.seed, 'encounter', [mapId, value.encounterKey]),
      tieBreaker: value.encounterKey,
    })).sort(compareScored).map(({ value }) => value)
    const orderedTiles = tiles.map((value) => ({
      value,
      score: score(config.seed, 'tile', [mapId, value.tileX, value.tileZ]),
      tieBreaker: `${value.tileX}:${value.tileZ}`,
    })).sort(compareScored).map(({ value }) => value)
    const availableTiles = new Map(orderedTiles.map((tile) => [`${tile.tileX}:${tile.tileZ}`, tile]))
    const claimedTiles = new Set<string>()
    const pairings: Array<Readonly<{ candidate: NormalizedCandidate, tile: VisibleWildSpawnTile }>> = []
    const canPlace = (candidate: NormalizedCandidate, tile: VisibleWildSpawnTile) => (
      preparation.canPlaceCandidate?.(
        Object.freeze({ encounterKey: candidate.encounterKey, encounterMethod: candidate.method }),
        Object.freeze({ mapId, tileX: tile.tileX, tileZ: tile.tileZ }),
      ) !== false
    )
    for (const candidate of orderedCandidates) {
      if (pairings.length >= config.actorsPerMap) break
      const preferredKey = candidate.spawnTile && `${candidate.spawnTile.tileX}:${candidate.spawnTile.tileZ}`
      const tile = preferredKey
        ? (claimedTiles.has(preferredKey) ? undefined : availableTiles.get(preferredKey))
        : orderedTiles.find((entry) => !claimedTiles.has(`${entry.tileX}:${entry.tileZ}`) && canPlace(candidate, entry))
      // Une identite Safari ne doit jamais etre deplacee silencieusement dans une autre zone.
      if (!tile || !canPlace(candidate, tile)) continue
      claimedTiles.add(`${tile.tileX}:${tile.tileZ}`)
      pairings.push(Object.freeze({ candidate, tile }))
    }
    const spawnCount = pairings.length
    if (registry.size() - evictedIds.size + spawnCount > dynamicWorldActorLimits.maxActors) {
      throw new Error(`Le registre ne peut pas accueillir ${spawnCount} Pokémon visibles supplémentaires.`)
    }

    const planned: PersistedVisibleWildActorV1[] = []
    const plannedIds = new Set<string>()
    for (let index = 0; index < spawnCount; index += 1) {
      const { candidate, tile } = pairings[index]!
      const id = actorIdentity(config.seed, mapId, candidate.encounterKey)
      if ((actors.has(id) && !evictedIds.has(id)) || plannedIds.has(id)) {
        throw new Error(`Une collision d'identifiant empêche de créer l'acteur Pokémon visible ${id}.`)
      }
      plannedIds.add(id)
      planned.push(Object.freeze({
        id,
        mapId,
        tileX: tile.tileX,
        tileZ: tile.tileZ,
        direction: directions[score(config.seed, 'facing', [mapId, candidate.encounterKey]) % directions.length]!,
        speciesId: candidate.speciesId,
        form: candidate.form,
        level: candidate.level,
        encounterKey: candidate.encounterKey,
        encounterMethod: candidate.method,
        movementStep: 0,
      }))
    }
    if (completesRepopulationWait) {
      for (const [identity, entry] of retired) if (entry.mapId === mapId) retired.delete(identity)
      setPopulationCycle(Object.freeze({
        mapId,
        generation: ((populationCycle?.generation ?? 0) + 1) >>> 0,
        repopulationPending: false,
      }))
    } else if (startsRepopulationWait) {
      setPopulationCycle(Object.freeze({
        mapId,
        generation: populationCycle?.generation ?? 0,
        repopulationPending: true,
      }))
    } else if (populationCycle?.repopulationPending) {
      setPopulationCycle(Object.freeze({ ...populationCycle, repopulationPending: false }))
    }
    evictInactiveActors()
    for (const record of planned) {
      actors.set(record.id, record)
      registry.upsert(toActor(record))
    }
    return getActorsOnMap(mapId)
  }

  const advanceMovement = (context: VisibleWildMovementContext): readonly VisibleWildWorldActor[] => {
    const mapId = requireMapId(context.mapId, 'La carte de mouvement des Pokémon visibles')
    if (typeof context.canOccupy !== 'function') throw new Error('Le callback de mouvement des Pokémon visibles est absent.')
    const current = [...actors.values()].filter((actor) => actor.mapId === mapId).sort((left, right) => (
      left.id < right.id ? -1 : left.id > right.id ? 1 : 0
    ))
    if (config.movement === 'stationary' || current.length === 0) return getActorsOnMap(mapId)

    // Les positions de départ restent réservées pendant tout le tick : aucun échange ou croisement implicite.
    const occupied = new Set(current.map((actor) => `${actor.tileX}:${actor.tileZ}`))
    const planned: PersistedVisibleWildActorV1[] = []
    for (const record of current) {
      const nextStep = (record.movementStep + 1) >>> 0
      const firstDirection = score(config.seed, 'movement', [record.id, nextStep]) % directions.length
      let selected: PersistedVisibleWildActorV1 = Object.freeze({ ...record, movementStep: nextStep })
      for (let offset = 0; offset < directions.length; offset += 1) {
        const direction = directions[(firstDirection + offset) % directions.length]!
        const [deltaX, deltaZ] = coordinateDeltas[direction]
        const tileX = record.tileX + deltaX
        const tileZ = record.tileZ + deltaZ
        if (tileX < -dynamicWorldActorLimits.maxCoordinate
          || tileX > dynamicWorldActorLimits.maxCoordinate
          || tileZ < -dynamicWorldActorLimits.maxCoordinate
          || tileZ > dynamicWorldActorLimits.maxCoordinate
          || occupied.has(`${tileX}:${tileZ}`)) continue
        const nextActor = toActor({ ...record, tileX, tileZ, direction, movementStep: nextStep })
        if (!context.canOccupy({ mapId, tileX, tileZ }, nextActor)) continue
        occupied.add(`${tileX}:${tileZ}`)
        selected = Object.freeze({ ...record, tileX, tileZ, direction, movementStep: nextStep })
        break
      }
      planned.push(selected)
    }
    // Tous les callbacks ont réussi avant la première mutation du registre.
    for (const record of planned) {
      actors.set(record.id, record)
      registry.upsert(toActor(record))
    }
    return getActorsOnMap(mapId)
  }

  const getInteraction = (actorId: string): VisibleWildInteraction | undefined => {
    const record = actors.get(actorId)
    return record && toInteraction(record)
  }

  const resolvePreparedInteraction = (
    actorId: string,
    resolve: (interaction: VisibleWildInteraction) => PreparedFieldWildEncounter | undefined,
  ): PreparedVisibleWildInteraction | undefined => {
    if (typeof resolve !== 'function') throw new Error('Le résolveur de rencontre visible est invalide.')
    const interaction = getInteraction(actorId)
    if (!interaction) return undefined
    const prepared = resolve(interaction)
    if (!prepared) return undefined
    assertPreparedInteractionMatches(interaction, prepared)
    return Object.freeze({ ...interaction, prepared })
  }

  const commitEncounterStarted = (actorId: string): VisibleWildInteraction | undefined => {
    const interaction = getInteraction(actorId)
    if (!interaction) return undefined
    const entry = Object.freeze({ mapId: interaction.mapId, encounterKey: interaction.encounterKey })
    if (retired.size >= visibleWildPokemonStateLimits.maximumRetiredEncounters) {
      const removable = [...retired].filter(([, candidate]) => candidate.mapId !== interaction.mapId)
        .sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)[0]
        ?? [...retired].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)[0]
      if (!removable) throw new Error('La memoire des rencontres Pokemon visibles retirees est saturee.')
      retired.delete(removable[0])
    }
    retired.set(retiredIdentity(entry.mapId, entry.encounterKey), entry)
    actors.delete(actorId)
    registry.remove(actorId)
    return interaction
  }

  const hasPendingRepopulation = (mapIdValue: number): boolean => (
    populationCycles.get(requireMapId(mapIdValue, 'La carte du repeuplement Pokemon visible'))
      ?.repopulationPending === true
  )

  const snapshotState = (): VisibleWildPokemonStateV1 => parseVisibleWildPokemonStateV1({
    ...createEmptyVisibleWildPokemonState(),
    actors: [...actors.values()],
    retiredEncounters: [...retired.values()],
    populationCycles: [...populationCycles.values()],
  })

  const worldSessionExtensionPorts: WorldSessionExtensionPorts = Object.freeze({ dynamicActors: registry })
  return Object.freeze({
    config,
    registry,
    worldSessionExtensionPorts,
    syncMap,
    advanceMovement,
    getInteraction,
    resolvePreparedInteraction,
    commitEncounterStarted,
    hasPendingRepopulation,
    snapshotState,
    restoreState,
  })
}

/** Contributeur autonome pour les hôtes qui utilisent le registre d'extensions générique. */
export const visibleWildPokemonSaveExtension: VersionedSaveExtensionContributor<
  VisibleWildPokemonRuntime,
  VisibleWildPokemonRuntime
> = defineVersionedSaveExtension<
  VisibleWildPokemonRuntime,
  VisibleWildPokemonRuntime,
  VisibleWildPokemonStateV1
>({
  key: visibleWildPokemonSaveExtensionKey,
  version: visibleWildPokemonSaveExtensionVersion,
  save: (runtime) => runtime.snapshotState(),
  validate: isVisibleWildPokemonStateV1,
  load: (runtime, value) => runtime.restoreState(value),
})
