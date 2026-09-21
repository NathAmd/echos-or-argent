import {
  parsePortablePokemonInstanceId,
  type PokemonInstanceId,
} from '../pokemon/pokemonInstanceId'
import { isOnlineOpaqueId } from '../../online/onlineServiceProtocol'

export const hgssP2pTradeProtocol = 'pokemaster-hgss-p2p-trade' as const
export const hgssP2pTradeProtocolVersion = 1 as const
export const hgssP2pTradeMaximumWireBytes = 128 * 1024

const maximumIdentifierLength = 128
const maximumRibbonCount = 128
const identifierPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/

type UnknownRecord = Record<string, unknown>

export type HgssP2pTradeStatValues = Readonly<{
  hp: number
  attack: number
  defense: number
  speed: number
  specialAttack: number
  specialDefense: number
}>

export type HgssP2pTradePokemonMove = Readonly<{
  moveId: number
  pp: number
  maxPp: number
  ppUps: number
}>

export type HgssP2pTradePokemonOrigin = Readonly<{
  language: number
  gameVersion: number
  metLocation: number
  metLevel: number
  metTerrain: number
  metDate?: Readonly<{ year: number, month: number, day: number }>
  eggLocation?: number
  eggDate?: Readonly<{ year: number, month: number, day: number }>
}>

/**
 * Capsule fonctionnelle complète d'un Pokémon échangé.
 *
 * Aucun libellé, sprite, ressource ou structure décodée depuis la ROM ne peut
 * franchir cette frontière. Les deux seuls textes admis sont un surnom et un
 * nom d'OT explicitement marqués comme saisie joueur. Les libellés locaux
 * d'Œuf et d'échange PNJ restent des références numériques à résoudre avec la
 * ROM du destinataire.
 */
export type HgssP2pTradePokemonSnapshot = Readonly<{
  instanceId: PokemonInstanceId
  speciesId: number
  nickname?: string
  nicknameSource?: 'user-text'
  nicknameLocalRef?: number
  form: number
  personality: number
  originalTrainer: Readonly<{
    id: number
    gender: 'male' | 'female'
    name?: string
    nameSource?: 'user-text'
    localTradeId?: number
  }>
  origin: HgssP2pTradePokemonOrigin
  level: number
  experience: number
  individualValues: HgssP2pTradeStatValues
  effortValues: HgssP2pTradeStatValues
  nature: number
  gender: 'male' | 'female' | 'genderless'
  abilityId: number
  shiny: boolean
  friendship: number
  moves: readonly HgssP2pTradePokemonMove[]
  stats: HgssP2pTradeStatValues
  currentHp: number
  status: number
  heldItemId: number
  mailIdentityCode?: number
  ballId: number
  isEgg: boolean
  fatefulEncounter: boolean
  shinyLeafMask: number
  contestValues: readonly [number, number, number, number, number, number]
  ribbonIds: readonly number[]
}>

/** Aperçu purement numérique, résolvable exclusivement avec la ROM locale. */
export type HgssP2pTradeOfferPreview = Readonly<{
  pokemonId: PokemonInstanceId
  speciesId: number
  nickname?: string
  nicknameSource?: 'user-text'
  nicknameLocalRef?: number
  form: number
  level: number
  gender: HgssP2pTradePokemonSnapshot['gender']
  shiny: boolean
  isEgg: boolean
  heldItemId: number
  currentHp: number
  maximumHp: number
  stats: HgssP2pTradeStatValues
  moveIds: readonly number[]
}>

export type HgssP2pTradeOfferReference = Readonly<{
  participantId: string
  revision: number
  pokemonId: PokemonInstanceId
}>

/** Toujours triée par participantId pour produire la même identité aux deux extrémités. */
export type HgssP2pTradeOfferPair = readonly [HgssP2pTradeOfferReference, HgssP2pTradeOfferReference]

type HgssP2pTradeFrameEnvelope = Readonly<{
  protocol: typeof hgssP2pTradeProtocol
  protocolVersion: typeof hgssP2pTradeProtocolVersion
  sessionId: string
  transactionId: string
  senderId: string
}>

export type HgssP2pTradeCancelReason =
  | 'user'
  | 'timeout'
  | 'disconnect'
  | 'offer-withdrawn'
  | 'local-rejected'
  | 'protocol-error'

export type HgssP2pTradeFrame = HgssP2pTradeFrameEnvelope & (
  | Readonly<{
    kind: 'offer'
    revision: number
    pokemon: HgssP2pTradePokemonSnapshot | null
  }>
  | Readonly<{ kind: 'accept', pair: HgssP2pTradeOfferPair }>
  | Readonly<{ kind: 'prepared', pair: HgssP2pTradeOfferPair }>
  | Readonly<{ kind: 'commit', pair: HgssP2pTradeOfferPair }>
  | Readonly<{ kind: 'commit-ack', pair: HgssP2pTradeOfferPair }>
  | Readonly<{ kind: 'cancel', reason: HgssP2pTradeCancelReason }>
)

function isRecord(value: unknown): value is UnknownRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function hasExactKeys(
  value: unknown,
  required: readonly string[],
  optional: readonly string[] = [],
): value is UnknownRecord {
  if (!isRecord(value)) return false
  const allowed = new Set([...required, ...optional])
  return required.every((key) => Object.hasOwn(value, key))
    && Object.keys(value).every((key) => allowed.has(key))
}

function isDenseArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength || Object.getPrototypeOf(value) !== Array.prototype) return false
  if (Object.keys(value).length !== value.length) return false
  return Reflect.ownKeys(value).every((key) => (
    key === 'length' || typeof key === 'string' && /^(0|[1-9]\d*)$/.test(key)
  )) && value.every((_entry, index) => Object.hasOwn(value, index))
}

function freezeDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezeDeep(nested)
  return Object.freeze(value)
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function identifier(value: unknown): string | undefined {
  return typeof value === 'string'
    && value.length >= 1
    && value.length <= maximumIdentifierLength
    && identifierPattern.test(value)
    ? value
    : undefined
}

function userText(value: unknown, maximumCharacters: number): string | undefined {
  if (typeof value !== 'string' || value.length === 0 || value.normalize('NFC') !== value || value.trim() !== value) return undefined
  const characters = [...value]
  if (characters.length > maximumCharacters) return undefined
  return characters.some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f) || codePoint === 0x2028 || codePoint === 0x2029
  }) ? undefined : value
}

function parseStatValues(value: unknown, maximum: number): HgssP2pTradeStatValues | undefined {
  const keys = ['hp', 'attack', 'defense', 'speed', 'specialAttack', 'specialDefense'] as const
  if (!hasExactKeys(value, keys) || keys.some((key) => !integer(value[key], 0, maximum))) return undefined
  return {
    hp: value.hp as number,
    attack: value.attack as number,
    defense: value.defense as number,
    speed: value.speed as number,
    specialAttack: value.specialAttack as number,
    specialDefense: value.specialDefense as number,
  }
}

function parseDate(value: unknown): Readonly<{ year: number, month: number, day: number }> | undefined {
  if (!hasExactKeys(value, ['year', 'month', 'day'])) return undefined
  if (!integer(value.year, 0, 9999) || value.year > 99 && value.year < 1900) return undefined
  if (!integer(value.month, 1, 12) || !integer(value.day, 1, 31)) return undefined
  const monthLengths = [31, value.year % 4 === 0 && (value.year % 100 !== 0 || value.year % 400 === 0) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]
  return value.day <= monthLengths[value.month - 1]!
    ? { year: value.year, month: value.month, day: value.day }
    : undefined
}

function parseOrigin(value: unknown): HgssP2pTradePokemonOrigin | undefined {
  if (!hasExactKeys(
    value,
    ['language', 'gameVersion', 'metLocation', 'metLevel', 'metTerrain'],
    ['metDate', 'eggLocation', 'eggDate'],
  )) return undefined
  if (
    !integer(value.language, 0, 0xff)
    || !integer(value.gameVersion, 0, 0xff)
    || !integer(value.metLocation, 0, 0xffff)
    || !integer(value.metLevel, 0, 100)
    || !integer(value.metTerrain, 0, 0xff)
    || Object.hasOwn(value, 'eggLocation') && !integer(value.eggLocation, 0, 0xffff)
  ) return undefined
  const metDate = Object.hasOwn(value, 'metDate') ? parseDate(value.metDate) : undefined
  const eggDate = Object.hasOwn(value, 'eggDate') ? parseDate(value.eggDate) : undefined
  if (Object.hasOwn(value, 'metDate') && !metDate || Object.hasOwn(value, 'eggDate') && !eggDate) return undefined
  return {
    language: value.language,
    gameVersion: value.gameVersion,
    metLocation: value.metLocation,
    metLevel: value.metLevel,
    metTerrain: value.metTerrain,
    ...(metDate ? { metDate } : {}),
    ...(Object.hasOwn(value, 'eggLocation') ? { eggLocation: value.eggLocation as number } : {}),
    ...(eggDate ? { eggDate } : {}),
  }
}

function parseOriginalTrainer(value: unknown): HgssP2pTradePokemonSnapshot['originalTrainer'] | undefined {
  if (!hasExactKeys(value, ['id', 'gender'], ['name', 'nameSource', 'localTradeId'])) return undefined
  if (!integer(value.id, 0, 0xffffffff) || value.gender !== 'male' && value.gender !== 'female') return undefined
  const hasName = Object.hasOwn(value, 'name')
  const hasNameSource = Object.hasOwn(value, 'nameSource')
  const hasLocalTrade = Object.hasOwn(value, 'localTradeId')
  const name = hasName ? userText(value.name, 7) : undefined
  if (hasName !== hasNameSource || hasName && (name === undefined || value.nameSource !== 'user-text')) return undefined
  if (hasLocalTrade && (!integer(value.localTradeId, 0, 12) || hasName || hasNameSource)) return undefined
  return {
    id: value.id,
    gender: value.gender,
    ...(name ? { name, nameSource: 'user-text' as const } : {}),
    ...(hasLocalTrade ? { localTradeId: value.localTradeId as number } : {}),
  }
}

function parseMoves(value: unknown): readonly HgssP2pTradePokemonMove[] | undefined {
  if (!isDenseArray(value, 4)) return undefined
  const moves: HgssP2pTradePokemonMove[] = []
  for (const entry of value) {
    if (!hasExactKeys(entry, ['moveId', 'pp', 'maxPp', 'ppUps'])) return undefined
    if (
      !integer(entry.moveId, 1, 0xffff)
      || !integer(entry.pp, 0, 0xff)
      || !integer(entry.maxPp, 1, 0xff)
      || entry.pp > entry.maxPp
      || !integer(entry.ppUps, 0, 3)
    ) return undefined
    moves.push({ moveId: entry.moveId, pp: entry.pp, maxPp: entry.maxPp, ppUps: entry.ppUps })
  }
  return moves
}

function parseContestValues(value: unknown): readonly [number, number, number, number, number, number] | undefined {
  if (!isDenseArray(value, 6) || value.length !== 6 || value.some((entry) => !integer(entry, 0, 0xff))) return undefined
  return [value[0] as number, value[1] as number, value[2] as number, value[3] as number, value[4] as number, value[5] as number]
}

function parseRibbonIds(value: unknown): readonly number[] | undefined {
  if (!isDenseArray(value, maximumRibbonCount) || value.some((entry) => !integer(entry, 0, 0xffff))) return undefined
  const ribbons = value as number[]
  return new Set(ribbons).size === ribbons.length ? [...ribbons] : undefined
}

/** Valide puis recopie une capsule sans conserver aucune référence de l'appelant. */
export function parseHgssP2pTradePokemonSnapshot(value: unknown): HgssP2pTradePokemonSnapshot | undefined {
  try {
    if (!hasExactKeys(value, [
      'instanceId', 'speciesId', 'form', 'personality', 'originalTrainer', 'origin', 'level', 'experience',
      'individualValues', 'effortValues', 'nature', 'gender', 'abilityId', 'shiny', 'friendship', 'moves',
      'stats', 'currentHp', 'status', 'heldItemId', 'ballId', 'isEgg', 'fatefulEncounter', 'shinyLeafMask',
      'contestValues', 'ribbonIds',
    ], ['nickname', 'nicknameSource', 'nicknameLocalRef', 'mailIdentityCode'])) return undefined

    const instanceId = parsePortablePokemonInstanceId(value.instanceId)
    const originalTrainer = parseOriginalTrainer(value.originalTrainer)
    const origin = parseOrigin(value.origin)
    const individualValues = parseStatValues(value.individualValues, 31)
    const effortValues = parseStatValues(value.effortValues, 0xff)
    const stats = parseStatValues(value.stats, 0xffff)
    const moves = parseMoves(value.moves)
    const contestValues = parseContestValues(value.contestValues)
    const ribbonIds = parseRibbonIds(value.ribbonIds)
    if (!originalTrainer || !origin || !individualValues || !effortValues || !stats || !moves || !contestValues || !ribbonIds) return undefined

    const hasNickname = Object.hasOwn(value, 'nickname')
    const hasNicknameSource = Object.hasOwn(value, 'nicknameSource')
    const hasNicknameLocalRef = Object.hasOwn(value, 'nicknameLocalRef')
    const nickname = hasNickname ? userText(value.nickname, 10) : undefined
    if (hasNickname !== hasNicknameSource || hasNickname && (nickname === undefined || value.nicknameSource !== 'user-text')) return undefined
    if (hasNicknameLocalRef && (!integer(value.nicknameLocalRef, 0, 13) || hasNickname || hasNicknameSource)) return undefined

    if (
      !integer(value.speciesId, 1, 0xffff)
      || !integer(value.form, 0, 0xff)
      || !integer(value.personality, 0, 0xffffffff)
      || !integer(value.level, 1, 100)
      || !integer(value.experience, 0, 0xffffffff)
      || !integer(value.nature, 0, 24)
      || value.gender !== 'male' && value.gender !== 'female' && value.gender !== 'genderless'
      || !integer(value.abilityId, 0, 0xffff)
      || typeof value.shiny !== 'boolean'
      || !integer(value.friendship, 0, 0xff)
      || stats.hp < 1
      || !integer(value.currentHp, 0, stats.hp)
      || !integer(value.status, 0, 0xffffffff)
      || !integer(value.heldItemId, 0, 0xffff)
      || Object.hasOwn(value, 'mailIdentityCode') && !integer(value.mailIdentityCode, 1, 1)
      || !integer(value.ballId, 0, 0xffff)
      || typeof value.isEgg !== 'boolean'
      || typeof value.fatefulEncounter !== 'boolean'
      || !integer(value.shinyLeafMask, 0, 0x1f)
    ) return undefined

    return freezeDeep({
      instanceId,
      speciesId: value.speciesId,
      ...(nickname ? { nickname, nicknameSource: 'user-text' as const } : {}),
      ...(hasNicknameLocalRef ? { nicknameLocalRef: value.nicknameLocalRef as number } : {}),
      form: value.form,
      personality: value.personality,
      originalTrainer,
      origin,
      level: value.level,
      experience: value.experience,
      individualValues,
      effortValues,
      nature: value.nature,
      gender: value.gender,
      abilityId: value.abilityId,
      shiny: value.shiny,
      friendship: value.friendship,
      moves,
      stats,
      currentHp: value.currentHp,
      status: value.status,
      heldItemId: value.heldItemId,
      ...(Object.hasOwn(value, 'mailIdentityCode') ? { mailIdentityCode: value.mailIdentityCode as number } : {}),
      ballId: value.ballId,
      isEgg: value.isEgg,
      fatefulEncounter: value.fatefulEncounter,
      shinyLeafMask: value.shinyLeafMask,
      contestValues,
      ribbonIds,
    })
  } catch {
    return undefined
  }
}

export function projectHgssP2pTradeOfferPreview(
  snapshot: HgssP2pTradePokemonSnapshot,
): HgssP2pTradeOfferPreview {
  const pokemon = parseHgssP2pTradePokemonSnapshot(snapshot)
  if (!pokemon) throw new TypeError("Le Pokémon proposé à l'échange P2P est invalide.")
  return freezeDeep({
    pokemonId: pokemon.instanceId,
    speciesId: pokemon.speciesId,
    ...(pokemon.nickname ? { nickname: pokemon.nickname, nicknameSource: 'user-text' as const } : {}),
    ...(pokemon.nicknameLocalRef === undefined ? {} : { nicknameLocalRef: pokemon.nicknameLocalRef }),
    form: pokemon.form,
    level: pokemon.level,
    gender: pokemon.gender,
    shiny: pokemon.shiny,
    isEgg: pokemon.isEgg,
    heldItemId: pokemon.heldItemId,
    currentHp: pokemon.currentHp,
    maximumHp: pokemon.stats.hp,
    stats: { ...pokemon.stats },
    moveIds: pokemon.moves.map(({ moveId }) => moveId),
  })
}

function parseOfferReference(value: unknown): HgssP2pTradeOfferReference | undefined {
  if (!hasExactKeys(value, ['participantId', 'revision', 'pokemonId'])) return undefined
  const participantId = identifier(value.participantId)
  if (!participantId || !integer(value.revision, 1, Number.MAX_SAFE_INTEGER)) return undefined
  try {
    return {
      participantId,
      revision: value.revision,
      pokemonId: parsePortablePokemonInstanceId(value.pokemonId),
    }
  } catch {
    return undefined
  }
}

export function parseHgssP2pTradeOfferPair(value: unknown): HgssP2pTradeOfferPair | undefined {
  if (!isDenseArray(value, 2) || value.length !== 2) return undefined
  const first = parseOfferReference(value[0])
  const second = parseOfferReference(value[1])
  if (!first || !second || first.participantId >= second.participantId || first.pokemonId === second.pokemonId) return undefined
  return freezeDeep([first, second] as const)
}

export function createHgssP2pTradeOfferPair(
  first: HgssP2pTradeOfferReference,
  second: HgssP2pTradeOfferReference,
): HgssP2pTradeOfferPair {
  const pair = first.participantId < second.participantId ? [first, second] : [second, first]
  const parsed = parseHgssP2pTradeOfferPair(pair)
  if (!parsed) throw new TypeError("La paire d'offres P2P est invalide.")
  return parsed
}

export function getHgssP2pTradeOfferPairKey(pair: HgssP2pTradeOfferPair): string {
  const parsed = parseHgssP2pTradeOfferPair(pair)
  if (!parsed) throw new TypeError("La paire d'offres P2P est invalide.")
  return JSON.stringify(parsed)
}

function parseEnvelope(value: UnknownRecord): HgssP2pTradeFrameEnvelope | undefined {
  if (value.protocol !== hgssP2pTradeProtocol || value.protocolVersion !== hgssP2pTradeProtocolVersion) return undefined
  const senderId = identifier(value.senderId)
  return isOnlineOpaqueId(value.sessionId) && isOnlineOpaqueId(value.transactionId) && senderId
    ? { protocol: hgssP2pTradeProtocol, protocolVersion: hgssP2pTradeProtocolVersion, sessionId: value.sessionId, transactionId: value.transactionId, senderId }
    : undefined
}

const cancelReasons: ReadonlySet<unknown> = new Set<HgssP2pTradeCancelReason>([
  'user', 'timeout', 'disconnect', 'offer-withdrawn', 'local-rejected', 'protocol-error',
])

/** Décode une valeur JSON avec clés exactes, limites et copie défensive. */
export function parseHgssP2pTradeFrame(value: unknown): HgssP2pTradeFrame | undefined {
  try {
    if (!isRecord(value) || typeof value.kind !== 'string') return undefined
    const envelope = parseEnvelope(value)
    if (!envelope) return undefined
    if (value.kind === 'offer') {
      if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'sessionId', 'transactionId', 'senderId', 'kind', 'revision', 'pokemon'])) return undefined
      if (!integer(value.revision, 1, Number.MAX_SAFE_INTEGER)) return undefined
      if (value.pokemon === null) {
        return freezeDeep({ ...envelope, kind: 'offer' as const, revision: value.revision, pokemon: null })
      }
      const pokemon = parseHgssP2pTradePokemonSnapshot(value.pokemon)
      return pokemon
        ? freezeDeep({ ...envelope, kind: 'offer' as const, revision: value.revision, pokemon })
        : undefined
    }
    if (value.kind === 'cancel') {
      if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'sessionId', 'transactionId', 'senderId', 'kind', 'reason'])) return undefined
      return cancelReasons.has(value.reason)
        ? freezeDeep({ ...envelope, kind: 'cancel' as const, reason: value.reason as HgssP2pTradeCancelReason })
        : undefined
    }
    if (value.kind !== 'accept' && value.kind !== 'prepared' && value.kind !== 'commit' && value.kind !== 'commit-ack') return undefined
    if (!hasExactKeys(value, ['protocol', 'protocolVersion', 'sessionId', 'transactionId', 'senderId', 'kind', 'pair'])) return undefined
    const pair = parseHgssP2pTradeOfferPair(value.pair)
    return pair ? freezeDeep({ ...envelope, kind: value.kind, pair }) : undefined
  } catch {
    return undefined
  }
}

export function encodeHgssP2pTradeFrame(frame: HgssP2pTradeFrame): string {
  const parsed = parseHgssP2pTradeFrame(frame)
  if (!parsed) throw new TypeError("La trame d'échange P2P est invalide.")
  const encoded = JSON.stringify(parsed)
  if (new TextEncoder().encode(encoded).length > hgssP2pTradeMaximumWireBytes) {
    throw new RangeError("La trame d'échange P2P dépasse la taille maximale autorisée.")
  }
  return encoded
}

export function decodeHgssP2pTradeFrame(message: string): HgssP2pTradeFrame | undefined {
  if (typeof message !== 'string' || new TextEncoder().encode(message).length > hgssP2pTradeMaximumWireBytes) return undefined
  try {
    return parseHgssP2pTradeFrame(JSON.parse(message))
  } catch {
    return undefined
  }
}

export function assertHgssP2pTradeIdentifier(value: string, label: string): string {
  const parsed = identifier(value)
  if (!parsed) throw new TypeError(`${label} d'échange P2P est invalide.`)
  return parsed
}

export function assertHgssP2pTradeOpaqueId(value: string, label: string): string {
  if (!isOnlineOpaqueId(value)) throw new TypeError(`${label} opaque d'échange P2P est invalide.`)
  return value
}
