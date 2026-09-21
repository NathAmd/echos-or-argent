import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import {
  baseFieldWildEncounterIdentityPort,
  type FieldWildEncounterIdentityPort,
} from './fieldWildEncounterIdentityPort'
import type { HgssMassOutbreakContext } from './hgssMassOutbreak'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  getHgssLandEncounterTime,
  prepareHgssLandOrSurfWildEncounter,
  type EncounterRadioEffect,
  type PreparedFieldWildEncounter,
  type PreparedLandWildEncounter,
  type PreparedWildEncounter,
} from './wildEncounterSelection'

export type HgssVisibleWildEncounterMethod = 'land' | 'surfing'

export type HgssVisibleWildSpawnTile = Readonly<{
  tileX: number
  tileZ: number
}>

export type HgssVisibleWildSpawnTileRequest = Readonly<{
  mapId: number
  encounterBankId: number
  method: HgssVisibleWildEncounterMethod
}>

/**
 * Le host reste seul propriétaire du terrain, des collisions, des objets ROM
 * et de la position du joueur. Il ne doit retourner ici que des cases sûres
 * pour la méthode demandée.
 */
export type HgssVisibleWildSafeSpawnTileResolver = (
  request: HgssVisibleWildSpawnTileRequest,
) => readonly HgssVisibleWildSpawnTile[]

export type HgssVisibleWildGenerationContext = Readonly<{
  radioEffect?: EncounterRadioEffect
  massOutbreak?: HgssMassOutbreakContext
}>

export type HgssVisibleWildCandidateSource = Readonly<{
  seed: string
  map: Pick<OpeningMapPreview, 'id' | 'header'>
  encounterCatalog: readonly HgssWildEncounterData[]
  /** Permet d'appliquer Randomizer/Tous-les-Pokémon après le tirage ROM natif. */
  fieldWildEncounterIdentityPort?: FieldWildEncounterIdentityPort
}>

export type HgssVisibleWildCandidateRequest = HgssVisibleWildCandidateSource & Readonly<{
  method: HgssVisibleWildEncounterMethod
  hour: number
  candidateCount: number
  generationContext?: HgssVisibleWildGenerationContext
  resolveSafeSpawnTiles: HgssVisibleWildSafeSpawnTileResolver
}>

export type HgssVisibleWildPreparedCandidate = Readonly<{
  encounterKey: string
  prepared: PreparedFieldWildEncounter
  /** Case d'origine obligatoire lorsque l'identite depend de la zone (Safari). */
  spawnTile?: HgssVisibleWildSpawnTile
}>

export type HgssVisibleWildMapCandidates = Readonly<{
  mapId: number
  encounterBankId: number
  method: HgssVisibleWildEncounterMethod
  /** Présent uniquement pour la méthode terrestre. */
  time?: PreparedLandWildEncounter['time']
  spawnTiles: readonly HgssVisibleWildSpawnTile[]
  encounters: readonly HgssVisibleWildPreparedCandidate[]
  /** Signature structurellement compatible avec VisibleWildMapPreparation. */
  prepareEncounters: () => readonly HgssVisibleWildPreparedCandidate[]
  /** Reconstruit aussi une ancienne clé horaire après sauvegarde/rechargement. */
  resolvePreparedEncounter: (
    reference: string | Readonly<{ encounterKey: string }>,
  ) => PreparedFieldWildEncounter | undefined
}>

/** Un roll 0..99 reproduit exactement les poids de chacun des slots HGSS. */
export const hgssVisibleWildCoverageRollCount = 100 as const
const legacyMaximumCandidateCount = 64
const maximumCandidateCount = hgssVisibleWildCoverageRollCount
const maximumSpawnTileCount = 4_096
const maximumCoordinate = 1_000_000
const candidateKeyPattern = /^hgss-vw([12]):([0-9a-f]{8}):(\d{1,5}):(\d{1,3}):(l|s):(m|d|n|x):(n|m|l|h|s):(n|a[0-9a-f]{8}):(\d{1,2})$/
const radioCodes: Readonly<Record<EncounterRadioEffect, string>> = Object.freeze({
  none: 'n',
  march: 'm',
  lullaby: 'l',
  hoenn: 'h',
  sinnoh: 's',
})
const radioByCode = new Map(Object.entries(radioCodes).map(([effect, code]) => [code, effect as EncounterRadioEffect]))
const representativeHour: Readonly<Record<PreparedLandWildEncounter['time'], number>> = Object.freeze({
  morning: 6,
  day: 12,
  night: 22,
})

type CandidateDescriptor = Readonly<{
  keyVersion: 1 | 2
  mapId: number
  encounterBankId: number
  method: HgssVisibleWildEncounterMethod
  time?: PreparedLandWildEncounter['time']
  radioEffect: EncounterRadioEffect
  massOutbreak?: HgssMassOutbreakContext
  logicalSlot: number
}>

type NormalizedSource = Readonly<{
  seed: string
  seedFingerprint: string
  mapId: number
  encounterBankId: number
  encounters?: HgssWildEncounterData
  identityPort: FieldWildEncounterIdentityPort
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

function containsControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
}

function requireSeed(value: unknown): string {
  if (typeof value !== 'string'
    || value.length < 1
    || value.length > 128
    || value.trim() !== value
    || value.normalize('NFC') !== value
    || containsControlCharacter(value)) {
    throw new Error('Le seed des candidats sauvages visibles est invalide.')
  }
  return value
}

function requireUnsignedInteger(value: unknown, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > maximum) {
    throw new Error(`${label} est invalide.`)
  }
  return value as number
}

function requireCoordinate(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || Math.abs(value as number) > maximumCoordinate) {
    throw new Error(`${label} est invalide.`)
  }
  return value as number
}

function normalizeSource(source: HgssVisibleWildCandidateSource): NormalizedSource {
  if (!source || typeof source !== 'object') throw new Error('La source des candidats sauvages visibles est invalide.')
  const seed = requireSeed(source.seed)
  const mapId = requireUnsignedInteger(source.map?.id, 0xffff, 'La carte des candidats sauvages visibles')
  if (source.map.header?.mapId !== mapId) {
    throw new Error(`L'en-tête ROM de la carte visible ${mapId} est incohérent.`)
  }
  const encounterBankId = requireUnsignedInteger(
    source.map.header.wildEncounterBank,
    0xff,
    'La banque de rencontres sauvages visibles',
  )
  if (!Array.isArray(source.encounterCatalog)) {
    throw new Error('Le catalogue de rencontres sauvages visibles est invalide.')
  }
  const encounters = encounterBankId === 0xff ? undefined : source.encounterCatalog[encounterBankId]
  if (encounters && encounters.bankId !== encounterBankId) {
    throw new Error(`La table sauvage ${encounterBankId} ne porte pas son identifiant ROM.`)
  }
  if (encounterBankId !== 0xff && !encounters) {
    throw new Error(`La table sauvage ${encounterBankId} de la carte ${mapId} est absente.`)
  }
  const identityPort = source.fieldWildEncounterIdentityPort ?? baseFieldWildEncounterIdentityPort
  if (typeof identityPort !== 'function') throw new Error("Le port d'identité sauvage visible est invalide.")
  return Object.freeze({
    seed,
    seedFingerprint: stableHash32(`hgss-visible-seed-v1:${seed}`).toString(16).padStart(8, '0'),
    mapId,
    encounterBankId,
    encounters,
    identityPort,
  })
}

function normalizeGenerationContext(
  value: HgssVisibleWildGenerationContext | undefined,
): Readonly<{ radioEffect: EncounterRadioEffect, massOutbreak?: HgssMassOutbreakContext }> {
  const radioEffect = value?.radioEffect ?? 'none'
  if (!Object.hasOwn(radioCodes, radioEffect)) throw new Error(`L'effet Radio visible ${String(radioEffect)} est invalide.`)
  const outbreak = value?.massOutbreak
  if (outbreak === undefined || outbreak.active === false) return Object.freeze({ radioEffect })
  if (outbreak.active !== true) throw new Error("L'état d'essaim visible est invalide.")
  const randomValue = requireUnsignedInteger(outbreak.randomValue, 0xffff_ffff, "La valeur d'essaim visible")
  return Object.freeze({
    radioEffect,
    massOutbreak: Object.freeze({ active: true, randomValue }),
  })
}

function timeCode(time: PreparedLandWildEncounter['time'] | undefined): string {
  return time === 'morning' ? 'm' : time === 'day' ? 'd' : time === 'night' ? 'n' : 'x'
}

function timeFromCode(code: string): PreparedLandWildEncounter['time'] | undefined {
  return code === 'm' ? 'morning' : code === 'd' ? 'day' : code === 'n' ? 'night' : undefined
}

function outbreakCode(context: HgssMassOutbreakContext | undefined): string {
  return context?.active ? `a${context.randomValue.toString(16).padStart(8, '0')}` : 'n'
}

function createEncounterKey(source: NormalizedSource, descriptor: CandidateDescriptor): string {
  return [
    `hgss-vw${descriptor.keyVersion}`,
    source.seedFingerprint,
    descriptor.mapId,
    descriptor.encounterBankId,
    descriptor.method === 'land' ? 'l' : 's',
    timeCode(descriptor.time),
    radioCodes[descriptor.radioEffect],
    outbreakCode(descriptor.massOutbreak),
    descriptor.logicalSlot,
  ].join(':')
}

function parseEncounterKey(source: NormalizedSource, encounterKey: string): CandidateDescriptor | undefined {
  if (typeof encounterKey !== 'string') return undefined
  const match = candidateKeyPattern.exec(encounterKey)
  if (!match || match[2] !== source.seedFingerprint) return undefined
  const keyVersion = Number(match[1]) as 1 | 2
  const mapId = Number(match[3])
  const encounterBankId = Number(match[4])
  const method = match[5] === 'l' ? 'land' : 'surfing'
  const time = timeFromCode(match[6]!)
  const radioEffect = radioByCode.get(match[7]!)
  const outbreak = match[8]!
  const logicalSlot = Number(match[9])
  if (mapId !== source.mapId
    || encounterBankId !== source.encounterBankId
    || !radioEffect
    || logicalSlot < 0
    || logicalSlot >= (keyVersion === 1 ? legacyMaximumCandidateCount : maximumCandidateCount)
    || (method === 'land' ? time === undefined : match[6] !== 'x')) return undefined
  const massOutbreak = outbreak === 'n'
    ? undefined
    : Object.freeze({ active: true, randomValue: Number.parseInt(outbreak.slice(1), 16) })
  return Object.freeze({
    keyVersion,
    mapId,
    encounterBankId,
    method,
    ...(time === undefined ? {} : { time }),
    radioEffect,
    ...(massOutbreak === undefined ? {} : { massOutbreak }),
    logicalSlot,
  })
}

function candidateRngSeed(source: NormalizedSource, descriptor: CandidateDescriptor): number {
  return stableHash32(JSON.stringify([
    'hgss-visible-wild-candidate',
    descriptor.keyVersion,
    source.seed,
    descriptor.mapId,
    descriptor.encounterBankId,
    descriptor.method,
    descriptor.time ?? 'timeless',
    descriptor.radioEffect,
    descriptor.massOutbreak?.randomValue ?? 'no-outbreak',
    descriptor.logicalSlot,
  ]))
}

function createCandidateRng(source: NormalizedSource, descriptor: CandidateDescriptor): HgssLcrng {
  const rng = createHgssLcrng(candidateRngSeed(source, descriptor))
  if (descriptor.keyVersion === 1) return rng
  let slotRollPending = true
  return Object.freeze({
    getSeed: rng.getSeed,
    nextU16: () => {
      if (!slotRollPending) return rng.nextU16()
      slotRollPending = false
      return descriptor.logicalSlot
    },
  })
}

function freezePreparedEncounter(prepared: PreparedFieldWildEncounter): PreparedFieldWildEncounter {
  return Object.freeze({
    rateRoll: Object.freeze({ ...prepared.rateRoll }),
    encounter: Object.freeze({ ...prepared.encounter }) as PreparedWildEncounter,
  })
}

function createCandidate(
  source: NormalizedSource,
  descriptor: CandidateDescriptor,
): HgssVisibleWildPreparedCandidate | undefined {
  const encounters = source.encounters
  if (!encounters) return undefined
  const encounterRate = descriptor.method === 'land' ? encounters.rates.walking : encounters.rates.surfing
  if (!Number.isInteger(encounterRate) || encounterRate < 0 || encounterRate > 0xff) {
    throw new Error(`Le taux ${descriptor.method} de la table sauvage ${encounters.bankId} est invalide.`)
  }
  if (encounterRate === 0) return undefined
  const hour = descriptor.time === undefined ? 12 : representativeHour[descriptor.time]
  const encounter = prepareHgssLandOrSurfWildEncounter(
    encounters,
    descriptor.method === 'land' ? 'land' : 'surf',
    hour,
    createCandidateRng(source, descriptor),
    {
      mapId: source.mapId,
      radioEffect: descriptor.radioEffect,
      massOutbreak: descriptor.massOutbreak,
      isSweetScent: true,
    },
  )
  if (!encounter) throw new Error('La préparation sauvage visible sans talent ne doit pas être supprimée.')
  const nativePrepared = freezePreparedEncounter({
    rateRoll: { triggered: true, modifiedRate: encounterRate, firstRoll: 0 },
    encounter,
  })
  const transformed = source.identityPort(nativePrepared, { mapId: source.mapId, source: 'visible-world' })
  if (!transformed?.encounter
    || transformed.encounter.method !== nativePrepared.encounter.method
    || !Number.isInteger(transformed.encounter.speciesId)
    || transformed.encounter.speciesId < 1
    || transformed.encounter.speciesId > 493
    || !Number.isInteger(transformed.encounter.level)
    || transformed.encounter.level < 1
    || transformed.encounter.level > 100) {
    throw new Error("Le port d'identité a produit une rencontre sauvage visible invalide.")
  }
  return Object.freeze({
    encounterKey: createEncounterKey(source, descriptor),
    prepared: freezePreparedEncounter(transformed),
  })
}

function normalizeSpawnTiles(
  value: readonly HgssVisibleWildSpawnTile[],
  source: NormalizedSource,
  method: HgssVisibleWildEncounterMethod,
): readonly HgssVisibleWildSpawnTile[] {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumSpawnTileCount) {
    throw new Error('Le callback des cases sauvages visibles doit retourner un tableau dense borné.')
  }
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.length !== value.length + 1 || ownKeys[value.length] !== 'length') {
    throw new Error('Le callback des cases sauvages visibles doit retourner un tableau dense sans champ supplémentaire.')
  }
  const seen = new Set<string>()
  const tiles = value.map((tile, index) => {
    if (ownKeys[index] !== String(index) || !tile || typeof tile !== 'object' || Array.isArray(tile)) {
      throw new Error(`La case sauvage visible ${index} est invalide.`)
    }
    const tileX = requireCoordinate(tile.tileX, `La coordonnée X de la case visible ${index}`)
    const tileZ = requireCoordinate(tile.tileZ, `La coordonnée Z de la case visible ${index}`)
    const key = `${tileX}:${tileZ}`
    if (seen.has(key)) throw new Error(`La case sauvage visible ${key} est déclarée plusieurs fois.`)
    seen.add(key)
    return Object.freeze({ tileX, tileZ })
  })
  return Object.freeze(tiles.map((tile) => ({
    tile,
    score: stableHash32(JSON.stringify([
      'hgss-visible-wild-tile', 1, source.seed, source.mapId, method, tile.tileX, tile.tileZ,
    ])),
  })).sort((left, right) => (
    left.score - right.score || left.tile.tileX - right.tile.tileX || left.tile.tileZ - right.tile.tileZ
  )).map(({ tile }) => tile))
}

/** Reconstruit une clé persistée sans consulter ni avancer le RNG normal du jeu. */
export function resolveHgssVisibleWildEncounterCandidate(
  sourceValue: HgssVisibleWildCandidateSource,
  encounterKey: string,
): HgssVisibleWildPreparedCandidate | undefined {
  const source = normalizeSource(sourceValue)
  const descriptor = parseEncounterKey(source, encounterKey)
  return descriptor && createCandidate(source, descriptor)
}

/**
 * Prépare au plus `candidateCount` rencontres et cases sûres. Chaque slot
 * possède son propre LCRNG dérivé ; modifier le nombre demandé ne change donc
 * jamais les slots précédents et aucun RNG de la partie n'est consommé.
 */
export function prepareHgssVisibleWildMapCandidates(
  request: HgssVisibleWildCandidateRequest,
): HgssVisibleWildMapCandidates {
  const source = normalizeSource(request)
  if (request.method !== 'land' && request.method !== 'surfing') {
    throw new Error(`La méthode sauvage visible ${String(request.method)} est invalide.`)
  }
  requireUnsignedInteger(request.hour, 23, "L'heure des candidats sauvages visibles")
  const candidateCount = requireUnsignedInteger(
    request.candidateCount,
    maximumCandidateCount,
    'Le nombre de candidats sauvages visibles',
  )
  if (typeof request.resolveSafeSpawnTiles !== 'function') {
    throw new Error('Le callback des cases sauvages visibles est absent.')
  }
  const generationContext = normalizeGenerationContext(request.generationContext)
  const rate = source.encounters && (request.method === 'land'
    ? source.encounters.rates.walking
    : source.encounters.rates.surfing)
  const time = request.method === 'land' ? getHgssLandEncounterTime(request.hour) : undefined
  const resolvePreparedEncounter = (
    reference: string | Readonly<{ encounterKey: string }>,
  ): PreparedFieldWildEncounter | undefined => (
    resolveHgssVisibleWildEncounterCandidate(
      request,
      typeof reference === 'string' ? reference : reference.encounterKey,
    )?.prepared
  )
  if (!source.encounters || rate === 0 || candidateCount === 0) {
    const encounters = Object.freeze([]) as readonly HgssVisibleWildPreparedCandidate[]
    return Object.freeze({
      mapId: source.mapId,
      encounterBankId: source.encounterBankId,
      method: request.method,
      ...(time === undefined ? {} : { time }),
      spawnTiles: Object.freeze([]),
      encounters,
      prepareEncounters: () => encounters,
      resolvePreparedEncounter,
    })
  }
  const spawnTiles = normalizeSpawnTiles(request.resolveSafeSpawnTiles(Object.freeze({
    mapId: source.mapId,
    encounterBankId: source.encounterBankId,
    method: request.method,
  })), source, request.method)
  const count = spawnTiles.length === 0 ? 0 : candidateCount
  const encounters = Object.freeze(Array.from({ length: count }, (_, logicalSlot) => createCandidate(source, {
    keyVersion: 2,
    mapId: source.mapId,
    encounterBankId: source.encounterBankId,
    method: request.method,
    ...(time === undefined ? {} : { time }),
    radioEffect: generationContext.radioEffect,
    massOutbreak: generationContext.massOutbreak,
    logicalSlot,
  })!))
  return Object.freeze({
    mapId: source.mapId,
    encounterBankId: source.encounterBankId,
    method: request.method,
    ...(time === undefined ? {} : { time }),
    spawnTiles,
    encounters,
    prepareEncounters: () => encounters,
    resolvePreparedEncounter,
  })
}
