import type { PlayerDirection } from '../../ndsTypes'

export const dynamicWorldActorSnapshotVersion = 1 as const

export const dynamicWorldActorLimits = Object.freeze({
  maxActors: 512,
  maxIdentifierLength: 128,
  maxDisplayNameLength: 32,
  maxMapId: 0xffff,
  maxCoordinate: 1_000_000,
  maxSpriteId: 0xffff,
  maxSpeciesId: 0xffff,
  maxForm: 0xff,
  maxLevel: 100,
})

export type DynamicWorldActorCollision = 'blocking' | 'non-blocking'
export type DynamicWorldActorInteraction = 'action' | 'none'

export type DynamicWorldTile = Readonly<{
  mapId: number
  tileX: number
  tileZ: number
}>

export type DynamicWorldActorPosition = DynamicWorldTile & Readonly<{
  direction: PlayerDirection
}>

type DynamicWorldActorBase = DynamicWorldActorPosition & Readonly<{
  /** Identité applicative stable : elle n'utilise jamais un objectId de la ROM. */
  id: string
  collision: DynamicWorldActorCollision
  interaction: DynamicWorldActorInteraction
}>

export type RemotePlayerWorldActor = DynamicWorldActorBase & Readonly<{
  kind: 'remote-player'
  displayName: string
  spriteId: number
}>

export type VisibleWildWorldActor = DynamicWorldActorBase & Readonly<{
  kind: 'visible-wild'
  speciesId: number
  form: number
  level: number
}>

export type DynamicWorldActor = RemotePlayerWorldActor | VisibleWildWorldActor

export type DynamicWorldActorSnapshotV1 = Readonly<{
  version: typeof dynamicWorldActorSnapshotVersion
  actors: readonly DynamicWorldActor[]
}>

export type DynamicWorldActorRegistry = Readonly<{
  size: () => number
  get: (id: string) => DynamicWorldActor | undefined
  list: () => readonly DynamicWorldActor[]
  getActorsOnMap: (mapId: number) => readonly DynamicWorldActor[]
  getActorsAt: (mapId: number, tileX: number, tileZ: number) => readonly DynamicWorldActor[]
  getBlockingActorsAt: (mapId: number, tileX: number, tileZ: number, excludedActorId?: string) => readonly DynamicWorldActor[]
  isTileBlocked: (mapId: number, tileX: number, tileZ: number, excludedActorId?: string) => boolean
  getInteractableActorsAt: (mapId: number, tileX: number, tileZ: number) => readonly DynamicWorldActor[]
  getInteractableActorsAhead: (position: DynamicWorldActorPosition) => readonly DynamicWorldActor[]
  upsert: (actor: DynamicWorldActor) => DynamicWorldActor
  remove: (id: string) => boolean
  clear: () => void
  snapshot: () => DynamicWorldActorSnapshotV1
  /** Valide entièrement le snapshot avant de remplacer l'état courant. */
  restore: (snapshot: unknown) => void
}>

type UnknownRecord = Record<string, unknown>

function isDataRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is UnknownRecord {
  if (!isDataRecord(value)) return false
  const actualKeys = Object.keys(value)
  if (actualKeys.length !== keys.length) return false
  const allowedKeys = new Set(keys)
  return keys.every((key) => Object.hasOwn(value, key))
    && actualKeys.every((key) => allowedKeys.has(key))
}

function isDenseArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) return false
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) return false
  if (Object.keys(value).length !== value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index))
    if (descriptor?.enumerable !== true || !('value' in descriptor)) return false
  }
  return ownKeys.every((key) => key === 'length' || /^(0|[1-9]\d*)$/.test(key as string))
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function parseIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > dynamicWorldActorLimits.maxIdentifierLength) return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ? value : undefined
}

function parseDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > dynamicWorldActorLimits.maxDisplayNameLength * 2) return undefined
  const characters = [...value]
  if (characters.length < 1 || characters.length > dynamicWorldActorLimits.maxDisplayNameLength) return undefined
  if (value.trim() !== value) return undefined
  const hasControlCharacter = characters.some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  return hasControlCharacter ? undefined : value
}

function parseDirection(value: unknown): PlayerDirection | undefined {
  return value === 'north' || value === 'south' || value === 'west' || value === 'east'
    ? value
    : undefined
}

function parseCollision(value: unknown): DynamicWorldActorCollision | undefined {
  return value === 'blocking' || value === 'non-blocking' ? value : undefined
}

function parseInteraction(value: unknown): DynamicWorldActorInteraction | undefined {
  return value === 'action' || value === 'none' ? value : undefined
}

const actorBaseKeys = [
  'id',
  'kind',
  'mapId',
  'tileX',
  'tileZ',
  'direction',
  'collision',
  'interaction',
] as const

function parseActorBase(value: UnknownRecord): DynamicWorldActorBase | undefined {
  const id = parseIdentifier(value.id)
  const direction = parseDirection(value.direction)
  const collision = parseCollision(value.collision)
  const interaction = parseInteraction(value.interaction)
  if (
    id === undefined
    || direction === undefined
    || collision === undefined
    || interaction === undefined
    || !isBoundedInteger(value.mapId, 0, dynamicWorldActorLimits.maxMapId)
    || !isBoundedInteger(value.tileX, -dynamicWorldActorLimits.maxCoordinate, dynamicWorldActorLimits.maxCoordinate)
    || !isBoundedInteger(value.tileZ, -dynamicWorldActorLimits.maxCoordinate, dynamicWorldActorLimits.maxCoordinate)
  ) return undefined
  return {
    id,
    mapId: value.mapId,
    tileX: value.tileX,
    tileZ: value.tileZ,
    direction,
    collision,
    interaction,
  }
}

export function parseDynamicWorldActor(value: unknown): DynamicWorldActor | undefined {
  if (!isDataRecord(value)) return undefined
  const base = parseActorBase(value)
  if (!base) return undefined

  if (value.kind === 'remote-player') {
    if (!hasExactKeys(value, [...actorBaseKeys, 'displayName', 'spriteId'])) return undefined
    const displayName = parseDisplayName(value.displayName)
    if (displayName === undefined || !isBoundedInteger(value.spriteId, 0, dynamicWorldActorLimits.maxSpriteId)) return undefined
    return Object.freeze({
      ...base,
      kind: 'remote-player',
      displayName,
      spriteId: value.spriteId,
    })
  }

  if (value.kind === 'visible-wild') {
    if (!hasExactKeys(value, [...actorBaseKeys, 'speciesId', 'form', 'level'])) return undefined
    if (
      !isBoundedInteger(value.speciesId, 1, dynamicWorldActorLimits.maxSpeciesId)
      || !isBoundedInteger(value.form, 0, dynamicWorldActorLimits.maxForm)
      || !isBoundedInteger(value.level, 1, dynamicWorldActorLimits.maxLevel)
    ) return undefined
    return Object.freeze({
      ...base,
      kind: 'visible-wild',
      speciesId: value.speciesId,
      form: value.form,
      level: value.level,
    })
  }

  return undefined
}

export function parseDynamicWorldActorSnapshot(value: unknown): DynamicWorldActorSnapshotV1 | undefined {
  if (!hasExactKeys(value, ['version', 'actors'])) return undefined
  if (value.version !== dynamicWorldActorSnapshotVersion || !isDenseArray(value.actors, dynamicWorldActorLimits.maxActors)) return undefined

  const actors: DynamicWorldActor[] = []
  const ids = new Set<string>()
  for (const candidate of value.actors) {
    const actor = parseDynamicWorldActor(candidate)
    if (!actor || ids.has(actor.id)) return undefined
    ids.add(actor.id)
    actors.push(actor)
  }
  return Object.freeze({ version: dynamicWorldActorSnapshotVersion, actors: Object.freeze(actors) })
}

export function isDynamicWorldActorSnapshot(value: unknown): value is DynamicWorldActorSnapshotV1 {
  return parseDynamicWorldActorSnapshot(value) !== undefined
}

function compareActors(left: DynamicWorldActor, right: DynamicWorldActor): number {
  if (left.mapId !== right.mapId) return left.mapId - right.mapId
  if (left.tileZ !== right.tileZ) return left.tileZ - right.tileZ
  if (left.tileX !== right.tileX) return left.tileX - right.tileX
  if (left.kind !== right.kind) return left.kind === 'remote-player' ? -1 : 1
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0
}

function ordered(actors: Iterable<DynamicWorldActor>): readonly DynamicWorldActor[] {
  return [...actors].sort(compareActors)
}

export function getDynamicWorldActorFacingTile(position: DynamicWorldActorPosition): DynamicWorldTile {
  const deltaX = position.direction === 'west' ? -1 : position.direction === 'east' ? 1 : 0
  const deltaZ = position.direction === 'north' ? -1 : position.direction === 'south' ? 1 : 0
  return {
    mapId: position.mapId,
    tileX: position.tileX + deltaX,
    tileZ: position.tileZ + deltaZ,
  }
}

function requireActor(value: unknown): DynamicWorldActor {
  const actor = parseDynamicWorldActor(value)
  if (!actor) throw new Error('L’acteur dynamique est invalide.')
  return actor
}

function requireSnapshot(value: unknown): DynamicWorldActorSnapshotV1 {
  const snapshot = parseDynamicWorldActorSnapshot(value)
  if (!snapshot) throw new Error('Le snapshot des acteurs dynamiques est invalide.')
  return snapshot
}

/**
 * Registre applicatif sans dépendance au rendu, à la ROM ou au transport.
 * Les requêtes sont volontairement bornées par `maxActors`, donc un balayage
 * simple garde ici une sémantique claire et évite des index désynchronisés.
 */
export function createDynamicWorldActorRegistry(initialSnapshot?: unknown): DynamicWorldActorRegistry {
  const actorsById = new Map<string, DynamicWorldActor>()

  const list = (): readonly DynamicWorldActor[] => ordered(actorsById.values())
  const getActorsOnMap = (mapId: number): readonly DynamicWorldActor[] => ordered(
    [...actorsById.values()].filter((actor) => actor.mapId === mapId),
  )
  const getActorsAt = (mapId: number, tileX: number, tileZ: number): readonly DynamicWorldActor[] => ordered(
    [...actorsById.values()].filter((actor) => actor.mapId === mapId && actor.tileX === tileX && actor.tileZ === tileZ),
  )
  const getBlockingActorsAt = (
    mapId: number,
    tileX: number,
    tileZ: number,
    excludedActorId?: string,
  ): readonly DynamicWorldActor[] => getActorsAt(mapId, tileX, tileZ).filter((actor) => (
    actor.collision === 'blocking' && actor.id !== excludedActorId
  ))
  const getInteractableActorsAt = (mapId: number, tileX: number, tileZ: number): readonly DynamicWorldActor[] => (
    getActorsAt(mapId, tileX, tileZ).filter((actor) => actor.interaction === 'action')
  )

  const restore = (value: unknown): void => {
    const snapshot = requireSnapshot(value)
    const restored = new Map(snapshot.actors.map((actor) => [actor.id, actor]))
    actorsById.clear()
    for (const [id, actor] of restored) actorsById.set(id, actor)
  }

  const registry: DynamicWorldActorRegistry = {
    size: () => actorsById.size,
    get: (id) => actorsById.get(id),
    list,
    getActorsOnMap,
    getActorsAt,
    getBlockingActorsAt,
    isTileBlocked: (mapId, tileX, tileZ, excludedActorId) => (
      getBlockingActorsAt(mapId, tileX, tileZ, excludedActorId).length > 0
    ),
    getInteractableActorsAt,
    getInteractableActorsAhead: (position) => {
      const facing = getDynamicWorldActorFacingTile(position)
      return getInteractableActorsAt(facing.mapId, facing.tileX, facing.tileZ)
    },
    upsert: (value) => {
      const actor = requireActor(value)
      const existing = actorsById.get(actor.id)
      if (existing && existing.kind !== actor.kind) {
        throw new Error(`L’acteur dynamique « ${actor.id} » ne peut pas changer de type.`)
      }
      if (!existing && actorsById.size >= dynamicWorldActorLimits.maxActors) {
        throw new Error(`Le registre ne peut pas contenir plus de ${dynamicWorldActorLimits.maxActors} acteurs dynamiques.`)
      }
      actorsById.set(actor.id, actor)
      return actor
    },
    remove: (id) => actorsById.delete(id),
    clear: () => actorsById.clear(),
    snapshot: () => Object.freeze({
      version: dynamicWorldActorSnapshotVersion,
      actors: Object.freeze([...list()]),
    }),
    restore,
  }

  if (initialSnapshot !== undefined) restore(initialSnapshot)
  return Object.freeze(registry)
}
