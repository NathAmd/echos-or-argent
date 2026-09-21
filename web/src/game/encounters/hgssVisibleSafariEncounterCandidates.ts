import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssSafariEncounterAtRequest } from '../safari/hgssSafariRuntimeCoordinator'
import {
  HGSS_SAFARI_ENCOUNTER_SLOT_COUNT,
  resolveHgssSafariEncounterTimeByHour,
} from '../safari/hgssSafariEncounters'
import {
  HGSS_SAFARI_AREA_COLUMNS,
  HGSS_SAFARI_AREA_GRID_CELL_X,
  HGSS_SAFARI_AREA_GRID_CELL_Z,
  HGSS_SAFARI_AREA_ROWS,
  HGSS_SAFARI_MAP_ID,
} from '../safari/hgssSafariMap'
import { HGSS_SAFARI_AREAS_PER_SET } from '../safari/hgssSafariState'
import { getMapOrigin } from '../world/mapCoordinates'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  baseFieldWildEncounterIdentityPort,
  type FieldWildEncounterIdentityPort,
} from './fieldWildEncounterIdentityPort'
import type {
  PreparedFieldWildEncounter,
  PreparedSafariWildEncounter,
} from './wildEncounterSelection'
import type {
  HgssVisibleWildPreparedCandidate,
  HgssVisibleWildSpawnTile,
} from './hgssVisibleWildEncounterCandidates'

export type HgssVisibleSafariEncounterPreparer = (
  request: HgssSafariEncounterAtRequest,
) => PreparedSafariWildEncounter | undefined

export type HgssVisibleSafariCandidateSource = Readonly<{
  seed: string
  map: OpeningMapPreview
}>

export type HgssVisibleSafariCandidateRequest = HgssVisibleSafariCandidateSource & Readonly<{
  hour: number
  candidateCount: number
  prepareSafariEncounter: HgssVisibleSafariEncounterPreparer
  resolveSafeSpawnTiles: (method: 'land' | 'surfing') => readonly HgssVisibleWildSpawnTile[]
  fieldWildEncounterIdentityPort?: FieldWildEncounterIdentityPort
}>

export type HgssVisibleSafariMapCandidates = Readonly<{
  mapId: typeof HGSS_SAFARI_MAP_ID
  method: 'safari'
  time: PreparedSafariWildEncounter['time']
  spawnTiles: readonly HgssVisibleWildSpawnTile[]
  encounters: readonly HgssVisibleWildPreparedCandidate[]
  prepareEncounters: () => readonly HgssVisibleWildPreparedCandidate[]
  resolvePreparedEncounter: (
    reference: string | Readonly<{ encounterKey: string }>,
  ) => PreparedFieldWildEncounter | undefined
}>

export const hgssVisibleSafariCoverageCandidateCount = HGSS_SAFARI_AREAS_PER_SET
  * HGSS_SAFARI_ENCOUNTER_SLOT_COUNT * 2
const maximumCandidateCount = hgssVisibleSafariCoverageCandidateCount
const maximumRollAttemptsPerArea = 512
const maximumSpawnTileCount = 4_096
const maximumCoordinate = 1_000_000
const keyPattern = /^hgss-vs1:([0-9a-f]{8}):(\d{1,5}):(l|s):(m|d|n):(\d{1,2}):([0-5]):(\d):(\d{1,3}):(\d{1,3}):(-?\d{1,7}):(-?\d{1,7}):([0-9a-f]{8})$/
const representativeHours = Object.freeze({ morning: 6, day: 12, night: 22 })

type NormalizedSource = Readonly<{
  seed: string
  seedFingerprint: string
  map: OpeningMapPreview
  origin: Readonly<{ x: number, z: number }>
}>

type SafariKeyDescriptor = Readonly<{
  method: 'land' | 'surf'
  time: PreparedSafariWildEncounter['time']
  areaId: number
  areaSlot: number
  slotIndex: number
  speciesId: number
  level: number
  worldTileX: number
  worldTileZ: number
}>

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

function requireInteger(value: unknown, minimum: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum) {
    throw new Error(`${label} est invalide.`)
  }
  return value as number
}

function normalizeSource(source: HgssVisibleSafariCandidateSource): NormalizedSource {
  if (typeof source.seed !== 'string' || source.seed.length < 1 || source.seed.length > 128
    || source.seed.trim() !== source.seed || source.seed.normalize('NFC') !== source.seed
    || [...source.seed].some((character) => {
      const codePoint = character.codePointAt(0) ?? 0
      return codePoint <= 0x1f || codePoint === 0x7f
    })) {
    throw new Error('Le seed des candidats Safari visibles est invalide.')
  }
  if (!source.map || source.map.id !== HGSS_SAFARI_MAP_ID || source.map.header.mapId !== HGSS_SAFARI_MAP_ID) {
    throw new Error(`Les candidats Safari visibles exigent la carte ROM ${HGSS_SAFARI_MAP_ID}.`)
  }
  return Object.freeze({
    seed: source.seed,
    seedFingerprint: stableHash32(`hgss-visible-safari-seed-v1:${source.seed}`).toString(16).padStart(8, '0'),
    map: source.map,
    origin: Object.freeze(getMapOrigin(source.map)),
  })
}

function normalizeSpawnTiles(
  value: readonly HgssVisibleWildSpawnTile[],
  source: NormalizedSource,
): readonly HgssVisibleWildSpawnTile[] {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype || value.length > maximumSpawnTileCount) {
    throw new Error('Le callback des cases Safari visibles doit retourner un tableau dense borne.')
  }
  const keys = Reflect.ownKeys(value)
  if (keys.length !== value.length + 1 || keys[value.length] !== 'length') {
    throw new Error('Le callback des cases Safari visibles doit retourner un tableau dense sans champ supplementaire.')
  }
  const seen = new Set<string>()
  return Object.freeze(value.map((tile, index) => {
    if (keys[index] !== String(index) || !tile || typeof tile !== 'object' || Array.isArray(tile)) {
      throw new Error(`La case Safari visible ${index} est invalide.`)
    }
    const tileX = requireInteger(tile.tileX, -maximumCoordinate, maximumCoordinate, `La coordonnee X Safari ${index}`)
    const tileZ = requireInteger(tile.tileZ, -maximumCoordinate, maximumCoordinate, `La coordonnee Z Safari ${index}`)
    const identity = `${tileX}:${tileZ}`
    if (seen.has(identity)) throw new Error(`La case Safari visible ${identity} est declaree plusieurs fois.`)
    seen.add(identity)
    return Object.freeze({ tileX, tileZ })
  }).map((tile) => ({
    tile,
    score: stableHash32(JSON.stringify(['hgss-visible-safari-tile', 1, source.seed, tile.tileX, tile.tileZ])),
  })).sort((left, right) => (
    left.score - right.score || left.tile.tileX - right.tile.tileX || left.tile.tileZ - right.tile.tileZ
  )).map(({ tile }) => tile))
}

function timeCode(time: PreparedSafariWildEncounter['time']): 'm' | 'd' | 'n' {
  return time === 'morning' ? 'm' : time === 'day' ? 'd' : 'n'
}

function timeFromCode(code: string): PreparedSafariWildEncounter['time'] | undefined {
  return code === 'm' ? 'morning' : code === 'd' ? 'day' : code === 'n' ? 'night' : undefined
}

function keyPayload(source: NormalizedSource, descriptor: SafariKeyDescriptor): string {
  return [
    'hgss-vs1', source.seedFingerprint, source.map.id,
    descriptor.method === 'land' ? 'l' : 's', timeCode(descriptor.time),
    descriptor.areaId, descriptor.areaSlot, descriptor.slotIndex,
    descriptor.speciesId, descriptor.level, descriptor.worldTileX, descriptor.worldTileZ,
  ].join(':')
}

function createEncounterKey(source: NormalizedSource, descriptor: SafariKeyDescriptor): string {
  const payload = keyPayload(source, descriptor)
  const checksum = stableHash32(`hgss-visible-safari-key-v1:${source.seed}:${payload}`).toString(16).padStart(8, '0')
  return `${payload}:${checksum}`
}

function parseEncounterKey(source: NormalizedSource, encounterKey: string): SafariKeyDescriptor | undefined {
  const match = typeof encounterKey === 'string' ? keyPattern.exec(encounterKey) : null
  if (!match || match[1] !== source.seedFingerprint || Number(match[2]) !== source.map.id) return undefined
  const time = timeFromCode(match[4]!)
  if (!time) return undefined
  const descriptor = Object.freeze({
    method: match[3] === 'l' ? 'land' as const : 'surf' as const,
    time,
    areaId: Number(match[5]),
    areaSlot: Number(match[6]),
    slotIndex: Number(match[7]),
    speciesId: Number(match[8]),
    level: Number(match[9]),
    worldTileX: Number(match[10]),
    worldTileZ: Number(match[11]),
  })
  if (descriptor.areaId > 11 || descriptor.speciesId < 1 || descriptor.speciesId > 493
    || descriptor.level < 1 || descriptor.level > 100
    || Math.abs(descriptor.worldTileX) > maximumCoordinate || Math.abs(descriptor.worldTileZ) > maximumCoordinate) return undefined
  return createEncounterKey(source, descriptor) === encounterKey ? descriptor : undefined
}

function freezePrepared(encounter: PreparedSafariWildEncounter): PreparedFieldWildEncounter {
  return Object.freeze({
    rateRoll: Object.freeze({ triggered: true, modifiedRate: 100, firstRoll: 0 }),
    encounter: Object.freeze({ ...encounter }),
  })
}

function descriptorPrepared(descriptor: SafariKeyDescriptor): PreparedFieldWildEncounter {
  return freezePrepared({
    method: 'safari',
    safariMethod: descriptor.method,
    time: descriptor.time,
    areaId: descriptor.areaId as PreparedSafariWildEncounter['areaId'],
    areaSlot: descriptor.areaSlot as PreparedSafariWildEncounter['areaSlot'],
    slotIndex: descriptor.slotIndex,
    speciesId: descriptor.speciesId,
    level: descriptor.level,
  })
}

function validatePrepared(
  prepared: PreparedFieldWildEncounter,
  expectedMethod: 'land' | 'surf',
  expectedTime: PreparedSafariWildEncounter['time'],
): asserts prepared is PreparedFieldWildEncounter & { encounter: PreparedSafariWildEncounter } {
  const encounter = prepared.encounter
  if (encounter.method !== 'safari' || encounter.safariMethod !== expectedMethod || encounter.time !== expectedTime
    || !Number.isInteger(encounter.areaId) || encounter.areaId < 0 || encounter.areaId > 11
    || !Number.isInteger(encounter.areaSlot) || encounter.areaSlot < 0 || encounter.areaSlot > 5
    || !Number.isInteger(encounter.slotIndex) || encounter.slotIndex < 0 || encounter.slotIndex > 9
    || !Number.isInteger(encounter.speciesId) || encounter.speciesId < 1 || encounter.speciesId > 493
    || !Number.isInteger(encounter.level) || encounter.level < 1 || encounter.level > 100) {
    throw new Error("Le preparateur Safari visible a produit une rencontre incoherente.")
  }
}

type MethodTile = Readonly<{
  method: 'land' | 'surf'
  areaSlot: number
  tile: HgssVisibleWildSpawnTile
}>

function resolveAreaSlot(source: NormalizedSource, tile: HgssVisibleWildSpawnTile): number | undefined {
  const worldTileX = source.origin.x + tile.tileX
  const worldTileZ = source.origin.z + tile.tileZ
  const column = Math.floor(worldTileX / 32) - HGSS_SAFARI_AREA_GRID_CELL_X
  const row = Math.floor(worldTileZ / 32) - HGSS_SAFARI_AREA_GRID_CELL_Z
  return column >= 0 && column < HGSS_SAFARI_AREA_COLUMNS && row >= 0 && row < HGSS_SAFARI_AREA_ROWS
    ? row * HGSS_SAFARI_AREA_COLUMNS + column
    : undefined
}

function createCandidate(
  source: NormalizedSource,
  tile: MethodTile,
  time: PreparedSafariWildEncounter['time'],
  rollIndex: number,
  prepareSafariEncounter: HgssVisibleSafariEncounterPreparer,
  identityPort: FieldWildEncounterIdentityPort,
): HgssVisibleWildPreparedCandidate | undefined {
  const method = tile.method
  const worldTileX = source.origin.x + tile.tile.tileX
  const worldTileZ = source.origin.z + tile.tile.tileZ
  const rng = createHgssLcrng(stableHash32(JSON.stringify([
    'hgss-visible-safari-candidate', 2, source.seed, source.map.id, method, time,
    tile.areaSlot, worldTileX, worldTileZ, rollIndex,
  ])))
  const encounter = prepareSafariEncounter({
    method,
    worldTileX,
    worldTileZ,
    hour: representativeHours[time],
    rng,
    isSweetScent: true,
  })
  if (!encounter) return undefined
  const nativePrepared = freezePrepared(encounter)
  validatePrepared(nativePrepared, method, time)
  if (nativePrepared.encounter.areaSlot !== tile.areaSlot) {
    throw new Error(`La case Safari visible appartient a l'emplacement ${nativePrepared.encounter.areaSlot}, pas ${tile.areaSlot}.`)
  }
  const transformed = identityPort(nativePrepared, { mapId: source.map.id, source: 'visible-world' })
  validatePrepared(transformed, method, time)
  const descriptor: SafariKeyDescriptor = Object.freeze({
    method,
    time,
    areaId: transformed.encounter.areaId,
    areaSlot: transformed.encounter.areaSlot,
    slotIndex: transformed.encounter.slotIndex,
    speciesId: transformed.encounter.speciesId,
    level: transformed.encounter.level,
    worldTileX,
    worldTileZ,
  })
  return Object.freeze({
    encounterKey: createEncounterKey(source, descriptor),
    prepared: freezePrepared(transformed.encounter),
    spawnTile: tile.tile,
  })
}

/** Reconstruit exactement l'identite encodee, sans contexte Safari ni RNG. */
export function resolveHgssVisibleSafariEncounterCandidate(
  sourceValue: HgssVisibleSafariCandidateSource,
  encounterKey: string,
): HgssVisibleWildPreparedCandidate | undefined {
  const source = normalizeSource(sourceValue)
  const descriptor = parseEncounterKey(source, encounterKey)
  if (!descriptor) return undefined
  return Object.freeze({
    encounterKey,
    prepared: descriptorPrepared(descriptor),
    spawnTile: Object.freeze({
      tileX: descriptor.worldTileX - source.origin.x,
      tileZ: descriptor.worldTileZ - source.origin.z,
    }),
  })
}

/** Peuplement Safari stable utilisant uniquement des LCRNG derives du seed NG+. */
export function prepareHgssVisibleSafariMapCandidates(
  request: HgssVisibleSafariCandidateRequest,
): HgssVisibleSafariMapCandidates {
  const source = normalizeSource(request)
  const hour = requireInteger(request.hour, 0, 23, "L'heure des candidats Safari visibles")
  const candidateCount = requireInteger(request.candidateCount, 0, maximumCandidateCount, 'Le nombre de candidats Safari visibles')
  if (typeof request.prepareSafariEncounter !== 'function' || typeof request.resolveSafeSpawnTiles !== 'function') {
    throw new Error('Les callbacks de preparation Safari visible sont incomplets.')
  }
  const identityPort = request.fieldWildEncounterIdentityPort ?? baseFieldWildEncounterIdentityPort
  if (typeof identityPort !== 'function') throw new Error("Le port d'identite Safari visible est invalide.")
  const time = resolveHgssSafariEncounterTimeByHour(hour)
  const empty = Object.freeze([]) as readonly HgssVisibleWildPreparedCandidate[]
  const resolvePreparedEncounter = (reference: string | Readonly<{ encounterKey: string }>) => (
    resolveHgssVisibleSafariEncounterCandidate(request, typeof reference === 'string' ? reference : reference.encounterKey)?.prepared
  )
  if (candidateCount === 0) return Object.freeze({
    mapId: HGSS_SAFARI_MAP_ID, method: 'safari', time,
    spawnTiles: Object.freeze([]), encounters: empty, prepareEncounters: () => empty, resolvePreparedEncounter,
  })
  const landTiles = normalizeSpawnTiles(request.resolveSafeSpawnTiles('land'), source)
  const surfTiles = normalizeSpawnTiles(request.resolveSafeSpawnTiles('surfing'), source)
  const representativeTiles = new Map<string, MethodTile>()
  for (const [method, tiles] of [['land', landTiles], ['surf', surfTiles]] as const) {
    for (const tile of tiles) {
      const areaSlot = resolveAreaSlot(source, tile)
      if (areaSlot === undefined) continue
      const key = `${areaSlot}:${method}`
      if (!representativeTiles.has(key)) representativeTiles.set(key, Object.freeze({ method, areaSlot, tile }))
    }
  }
  const methods = [...representativeTiles.values()].sort((left, right) => (
    left.areaSlot - right.areaSlot || left.method.localeCompare(right.method)
  ))
  const candidatesByMethod = methods.map((methodTile) => {
    const candidatesBySlot = new Map<number, HgssVisibleWildPreparedCandidate>()
    for (let rollIndex = 0; rollIndex < maximumRollAttemptsPerArea
      && candidatesBySlot.size < HGSS_SAFARI_ENCOUNTER_SLOT_COUNT; rollIndex += 1) {
      const candidate = createCandidate(
        source,
        methodTile,
        time,
        rollIndex,
        request.prepareSafariEncounter,
        identityPort,
      )
      if (candidate && candidate.prepared.encounter.method === 'safari') {
        candidatesBySlot.set(candidate.prepared.encounter.slotIndex, candidate)
      }
    }
    return [...candidatesBySlot].sort(([left], [right]) => left - right).map(([, candidate]) => candidate)
  })
  const encounters: HgssVisibleWildPreparedCandidate[] = []
  for (let slotOffset = 0; slotOffset < HGSS_SAFARI_ENCOUNTER_SLOT_COUNT; slotOffset += 1) {
    for (const candidates of candidatesByMethod) {
      const candidate = candidates[slotOffset]
      if (candidate) encounters.push(candidate)
      if (encounters.length >= candidateCount) break
    }
    if (encounters.length >= candidateCount) break
  }
  const frozenEncounters = Object.freeze(encounters)
  const spawnTiles = Object.freeze([...new Map(frozenEncounters.map(({ spawnTile }) => [
    `${spawnTile!.tileX}:${spawnTile!.tileZ}`,
    spawnTile!,
  ])).values()])
  return Object.freeze({
    mapId: HGSS_SAFARI_MAP_ID,
    method: 'safari',
    time,
    spawnTiles,
    encounters: frozenEncounters,
    prepareEncounters: () => frozenEncounters,
    resolvePreparedEncounter,
  })
}
