export const hgssSharedCampaignFieldEventIdentityVersion = 1 as const
export const hgssSharedCampaignFieldEventIdPrefix = 'field-event.' as const

const maximumEventIdLength = 128
const maximumByte = 0xff
const maximumRomIdentifier = 0xffff
const maximumCoordinate = 1_000_000
const protocolIdentifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/
const gameCodePattern = /^[A-Z0-9]{4}$/
const canonicalBase36Pattern = /^(?:0|[1-9a-z][0-9a-z]*)$/

type UnknownRecord = Record<string, unknown>

export type HgssSharedCampaignFieldEventRomIdentity = Readonly<{
  gameCode: string
  gameVersion: number
  language: number
}>

export type HgssSharedCampaignFieldEventSource =
  | Readonly<{ kind: 'object', objectId: number }>
  | Readonly<{ kind: 'coordinate', x: number, z: number }>

export type HgssSharedCampaignFieldEventIdentity = Readonly<{
  rom: HgssSharedCampaignFieldEventRomIdentity
  mapId: number
  source: HgssSharedCampaignFieldEventSource
  scriptId: number
}>

export class HgssSharedCampaignFieldEventIdentityError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'HgssSharedCampaignFieldEventIdentityError'
  }
}

function isStrictRecord(value: unknown): value is UnknownRecord {
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
  if (!isStrictRecord(value)) return false
  const actual = Object.keys(value)
  const expected = new Set(keys)
  return actual.length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
    && actual.every((key) => expected.has(key))
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value)
    && !Object.is(value, -0)
    && (value as number) >= minimum
    && (value as number) <= maximum
}

function parseRomIdentity(value: unknown): HgssSharedCampaignFieldEventRomIdentity | undefined {
  if (!hasExactKeys(value, ['gameCode', 'gameVersion', 'language'])
    || typeof value.gameCode !== 'string'
    || !gameCodePattern.test(value.gameCode)
    || !isBoundedInteger(value.gameVersion, 0, maximumByte)
    || !isBoundedInteger(value.language, 0, maximumByte)) return undefined
  return Object.freeze({
    gameCode: value.gameCode,
    gameVersion: value.gameVersion,
    language: value.language,
  })
}

function parseSource(value: unknown): HgssSharedCampaignFieldEventSource | undefined {
  if (!isStrictRecord(value)) return undefined
  if (value.kind === 'object') {
    return hasExactKeys(value, ['kind', 'objectId'])
      && isBoundedInteger(value.objectId, 0, maximumRomIdentifier)
      ? Object.freeze({ kind: 'object', objectId: value.objectId })
      : undefined
  }
  if (value.kind === 'coordinate') {
    return hasExactKeys(value, ['kind', 'x', 'z'])
      && isBoundedInteger(value.x, -maximumCoordinate, maximumCoordinate)
      && isBoundedInteger(value.z, -maximumCoordinate, maximumCoordinate)
      ? Object.freeze({ kind: 'coordinate', x: value.x, z: value.z })
      : undefined
  }
  return undefined
}

/**
 * Reconstruit une identité sans prototype exotique, accesseur, symbole ou champ
 * non prévu. Aucune valeur (notamment le code ROM) n'est normalisée.
 */
export function parseHgssSharedCampaignFieldEventIdentity(
  value: unknown,
): HgssSharedCampaignFieldEventIdentity | undefined {
  if (!hasExactKeys(value, ['rom', 'mapId', 'source', 'scriptId'])) return undefined
  const rom = parseRomIdentity(value.rom)
  const source = parseSource(value.source)
  if (!rom
    || !source
    || !isBoundedInteger(value.mapId, 0, maximumRomIdentifier)
    || !isBoundedInteger(value.scriptId, 1, maximumRomIdentifier)) return undefined
  return Object.freeze({
    rom,
    mapId: value.mapId,
    source,
    scriptId: value.scriptId,
  })
}

function encodeBase36(value: number): string {
  return value.toString(36)
}

function encodeCoordinate(value: number): string {
  return encodeBase36(value >= 0 ? value * 2 : -value * 2 - 1)
}

function buildEventId(identity: HgssSharedCampaignFieldEventIdentity): string {
  const common = [
    'field-event',
    String(hgssSharedCampaignFieldEventIdentityVersion),
    identity.rom.gameCode,
    encodeBase36(identity.rom.gameVersion),
    encodeBase36(identity.rom.language),
    encodeBase36(identity.mapId),
  ]
  const source = identity.source.kind === 'object'
    ? ['o', encodeBase36(identity.source.objectId)]
    : ['c', encodeCoordinate(identity.source.x), encodeCoordinate(identity.source.z)]
  return [...common, ...source, encodeBase36(identity.scriptId)].join('.')
}

/** Produit l'identifiant one-shot canonique accepté par le protocole campagne. */
export function createHgssSharedCampaignFieldEventId(identity: unknown): string {
  const parsed = parseHgssSharedCampaignFieldEventIdentity(identity)
  if (!parsed) {
    throw new HgssSharedCampaignFieldEventIdentityError(
      "L'identité de l'événement terrain partagé est invalide.",
    )
  }
  const eventId = buildEventId(parsed)
  if (eventId.length > maximumEventIdLength || !protocolIdentifierPattern.test(eventId)) {
    throw new HgssSharedCampaignFieldEventIdentityError(
      "L'identifiant de l'événement terrain partagé dépasse le protocole.",
    )
  }
  return eventId
}

function parseBase36(value: string, maximum: number, minimum = 0): number | undefined {
  if (!canonicalBase36Pattern.test(value)) return undefined
  const decoded = Number.parseInt(value, 36)
  return isBoundedInteger(decoded, minimum, maximum) ? decoded : undefined
}

function decodeCoordinate(value: string): number | undefined {
  const encoded = parseBase36(value, maximumCoordinate * 2)
  if (encoded === undefined) return undefined
  return encoded % 2 === 0 ? encoded / 2 : -(encoded + 1) / 2
}

/**
 * Décode uniquement la forme canonique : tout changement de version, casse,
 * zéro de tête, séparateur ou nombre de segments est refusé.
 */
export function parseHgssSharedCampaignFieldEventId(
  value: unknown,
): HgssSharedCampaignFieldEventIdentity | undefined {
  if (typeof value !== 'string'
    || value.length > maximumEventIdLength
    || !value.startsWith(hgssSharedCampaignFieldEventIdPrefix)
    || !protocolIdentifierPattern.test(value)) return undefined
  const segments = value.split('.')
  if (segments[0] !== 'field-event'
    || segments[1] !== String(hgssSharedCampaignFieldEventIdentityVersion)) return undefined

  const gameCode = segments[2]
  const gameVersion = segments[3] === undefined
    ? undefined
    : parseBase36(segments[3], maximumByte)
  const language = segments[4] === undefined
    ? undefined
    : parseBase36(segments[4], maximumByte)
  const mapId = segments[5] === undefined
    ? undefined
    : parseBase36(segments[5], maximumRomIdentifier)
  const sourceKind = segments[6]
  const scriptToken = sourceKind === 'o' && segments.length === 9
    ? segments[8]
    : sourceKind === 'c' && segments.length === 10
      ? segments[9]
      : undefined
  const scriptId = scriptToken === undefined
    ? undefined
    : parseBase36(scriptToken, maximumRomIdentifier, 1)
  if (gameCode === undefined
    || !gameCodePattern.test(gameCode)
    || gameVersion === undefined
    || language === undefined
    || mapId === undefined
    || scriptId === undefined) return undefined

  let source: HgssSharedCampaignFieldEventSource | undefined
  if (sourceKind === 'o') {
    const objectId = segments[7] === undefined
      ? undefined
      : parseBase36(segments[7], maximumRomIdentifier)
    if (objectId !== undefined) source = { kind: 'object', objectId }
  } else if (sourceKind === 'c') {
    const x = segments[7] === undefined ? undefined : decodeCoordinate(segments[7])
    const z = segments[8] === undefined ? undefined : decodeCoordinate(segments[8])
    if (x !== undefined && z !== undefined) source = { kind: 'coordinate', x, z }
  }
  if (!source) return undefined

  const identity = parseHgssSharedCampaignFieldEventIdentity({
    rom: { gameCode, gameVersion, language },
    mapId,
    source,
    scriptId,
  })
  return identity && buildEventId(identity) === value ? identity : undefined
}
