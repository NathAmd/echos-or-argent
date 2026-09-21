import { isOnlineOpaqueId } from '../../online/onlineServiceProtocol'
import {
  getHgssP2pTradeOfferPairKey,
  hgssP2pTradeMaximumWireBytes,
  parseHgssP2pTradeOfferPair,
  parseHgssP2pTradePokemonSnapshot,
  type HgssP2pTradeOfferPair,
  type HgssP2pTradePokemonSnapshot,
} from './hgssP2pTradeProtocol'

export const hgssP2pTradeJournalLimit = 8
export const hgssP2pTradeJournalSchemaVersion = 1 as const

export type HgssP2pTradeJournalPhase = 'prepared' | 'committed'

export type HgssP2pTradeJournalDestination =
  | Readonly<{ kind: 'party', slot: number }>
  | Readonly<{ kind: 'storage', box: number, slot: number }>

export type HgssP2pTradeJournalEvolution = Readonly<{
  sourceSpeciesId: number
  targetSpeciesId: number
  consumedHeldItemId?: number
  learnedMoveIds: readonly number[]
  skippedMoveIds: readonly number[]
}>

export type HgssP2pTradeJournalResult = Readonly<{
  receivedSpeciesId: number
  evolution?: HgssP2pTradeJournalEvolution
}>

type HgssP2pTradeJournalBase = Readonly<{
  schemaVersion: typeof hgssP2pTradeJournalSchemaVersion
  sessionId: string
  transactionId: string
  localParticipantId: string
  remoteParticipantId: string
  pair: HgssP2pTradeOfferPair
  outgoing: HgssP2pTradePokemonSnapshot
  incoming: HgssP2pTradePokemonSnapshot
  destination: HgssP2pTradeJournalDestination
}>

/** Journal local uniquement : aucune donnée ROM décodée ne franchit cette frontière. */
export type HgssP2pTradeJournal = HgssP2pTradeJournalBase & (
  | Readonly<{ phase: 'prepared' }>
  | Readonly<{ phase: 'committed', result: HgssP2pTradeJournalResult }>
)

function isRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return false
  return Reflect.ownKeys(value).every((key) => {
    if (typeof key !== 'string') return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function hasExactKeys(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
  return isRecord(value)
    && Object.keys(value).length === keys.length
    && keys.every((key) => Object.hasOwn(value, key))
}

function integer(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function isDenseDataArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value)
    || Object.getPrototypeOf(value) !== Array.prototype
    || value.length > maximumLength
    || Object.keys(value).length !== value.length) return false
  return Reflect.ownKeys(value).every((key) => {
    if (key === 'length') return true
    if (typeof key !== 'string' || !/^(0|[1-9][0-9]*)$/.test(key)) return false
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable === true && 'value' in descriptor
  })
}

function participantId(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
}

function denseIdList(value: unknown): readonly number[] | undefined {
  if (!isDenseDataArray(value, 4)) return undefined
  if (!value.every((entry) => integer(entry, 1, 0xffff))) return undefined
  return [...value]
}

function parseDestination(value: unknown): HgssP2pTradeJournalDestination | undefined {
  if (!isRecord(value)) return undefined
  if (value.kind === 'party' && hasExactKeys(value, ['kind', 'slot']) && integer(value.slot, 0, 5)) {
    return { kind: 'party', slot: value.slot }
  }
  if (value.kind === 'storage' && hasExactKeys(value, ['kind', 'box', 'slot'])
    && integer(value.box, 0, 17) && integer(value.slot, 0, 29)) {
    return { kind: 'storage', box: value.box, slot: value.slot }
  }
  return undefined
}

function parseEvolution(value: unknown): HgssP2pTradeJournalEvolution | undefined {
  if (!isRecord(value)) return undefined
  const hasConsumedItem = Object.hasOwn(value, 'consumedHeldItemId')
  if (!hasExactKeys(value, hasConsumedItem
    ? ['sourceSpeciesId', 'targetSpeciesId', 'consumedHeldItemId', 'learnedMoveIds', 'skippedMoveIds']
    : ['sourceSpeciesId', 'targetSpeciesId', 'learnedMoveIds', 'skippedMoveIds'])) return undefined
  const learnedMoveIds = denseIdList(value.learnedMoveIds)
  const skippedMoveIds = denseIdList(value.skippedMoveIds)
  if (!integer(value.sourceSpeciesId, 1, 0xffff)
    || !integer(value.targetSpeciesId, 1, 0xffff)
    || hasConsumedItem && !integer(value.consumedHeldItemId, 1, 0xffff)
    || !learnedMoveIds || !skippedMoveIds) return undefined
  return {
    sourceSpeciesId: value.sourceSpeciesId,
    targetSpeciesId: value.targetSpeciesId,
    ...(hasConsumedItem ? { consumedHeldItemId: value.consumedHeldItemId as number } : {}),
    learnedMoveIds,
    skippedMoveIds,
  }
}

function parseResult(value: unknown, incoming: HgssP2pTradePokemonSnapshot): HgssP2pTradeJournalResult | undefined {
  if (!isRecord(value)) return undefined
  const hasEvolution = Object.hasOwn(value, 'evolution')
  if (!hasExactKeys(value, hasEvolution ? ['receivedSpeciesId', 'evolution'] : ['receivedSpeciesId'])) return undefined
  if (!integer(value.receivedSpeciesId, 1, 0xffff)) return undefined
  const evolution = hasEvolution ? parseEvolution(value.evolution) : undefined
  if (hasEvolution && !evolution) return undefined
  if (evolution) {
    if (evolution.sourceSpeciesId !== incoming.speciesId
      || evolution.targetSpeciesId !== value.receivedSpeciesId
      || evolution.consumedHeldItemId !== undefined && evolution.consumedHeldItemId !== incoming.heldItemId) return undefined
  } else if (value.receivedSpeciesId !== incoming.speciesId) return undefined
  return {
    receivedSpeciesId: value.receivedSpeciesId,
    ...(evolution ? { evolution } : {}),
  }
}

function freezeDeep<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nested of Object.values(value)) freezeDeep(nested)
  return Object.freeze(value)
}

function assertBoundedJournal(value: HgssP2pTradeJournal): void {
  if (new TextEncoder().encode(JSON.stringify(value)).byteLength > hgssP2pTradeMaximumWireBytes) {
    throw new Error("Le journal local d'échange P2P dépasse la taille maximale autorisée.")
  }
}

/** Validation stricte avec copie défensive, utilisable aussi sur les frames de reprise. */
export function parseHgssP2pTradeJournal(value: unknown): HgssP2pTradeJournal {
  if (!isRecord(value) || (value.phase !== 'prepared' && value.phase !== 'committed')) {
    throw new Error("Le journal local d'échange P2P est invalide.")
  }
  const expectedKeys = value.phase === 'committed'
    ? ['schemaVersion', 'sessionId', 'transactionId', 'localParticipantId', 'remoteParticipantId', 'pair', 'outgoing', 'incoming', 'destination', 'phase', 'result']
    : ['schemaVersion', 'sessionId', 'transactionId', 'localParticipantId', 'remoteParticipantId', 'pair', 'outgoing', 'incoming', 'destination', 'phase']
  if (!hasExactKeys(value, expectedKeys)
    || value.schemaVersion !== hgssP2pTradeJournalSchemaVersion
    || !isOnlineOpaqueId(value.sessionId)
    || !isOnlineOpaqueId(value.transactionId)
    || !participantId(value.localParticipantId)
    || !participantId(value.remoteParticipantId)
    || value.localParticipantId === value.remoteParticipantId) {
    throw new Error("Le journal local d'échange P2P est invalide.")
  }
  const pair = parseHgssP2pTradeOfferPair(value.pair)
  const outgoing = parseHgssP2pTradePokemonSnapshot(value.outgoing)
  const incoming = parseHgssP2pTradePokemonSnapshot(value.incoming)
  const destination = parseDestination(value.destination)
  if (!pair || !outgoing || !incoming || !destination) {
    throw new Error("Le journal local d'échange P2P est invalide.")
  }
  const localReference = pair.find(({ participantId }) => participantId === value.localParticipantId)
  const remoteReference = pair.find(({ participantId }) => participantId === value.remoteParticipantId)
  if (!localReference || !remoteReference
    || localReference.pokemonId !== outgoing.instanceId
    || remoteReference.pokemonId !== incoming.instanceId) {
    throw new Error("Le journal local d'échange P2P ne correspond pas à sa paire acceptée.")
  }
  const result = value.phase === 'committed' ? parseResult(value.result, incoming) : undefined
  if (value.phase === 'committed' && !result) {
    throw new Error("Le résultat durable de l'échange P2P est invalide.")
  }
  const journal = {
    schemaVersion: hgssP2pTradeJournalSchemaVersion,
    sessionId: value.sessionId,
    transactionId: value.transactionId,
    localParticipantId: value.localParticipantId,
    remoteParticipantId: value.remoteParticipantId,
    pair,
    outgoing,
    incoming,
    destination: { ...destination },
    phase: value.phase,
    ...(result ? { result } : {}),
  } as HgssP2pTradeJournal
  assertBoundedJournal(journal)
  return freezeDeep(journal)
}

export function parseHgssP2pTradeJournals(value: unknown): readonly HgssP2pTradeJournal[] {
  if (!isDenseDataArray(value, hgssP2pTradeJournalLimit)) {
    throw new Error("L'historique de reprise des échanges P2P est invalide.")
  }
  const journals = value.map(parseHgssP2pTradeJournal)
  if (new Set(journals.map(({ transactionId }) => transactionId)).size !== journals.length) {
    throw new Error("L'historique de reprise contient une transaction dupliquée.")
  }
  const reservedPokemonIds = journals.flatMap(({ outgoing, incoming }) => [outgoing.instanceId, incoming.instanceId])
  if (new Set(reservedPokemonIds).size !== reservedPokemonIds.length) {
    throw new Error("L'historique de reprise réserve une instance Pokémon dans plusieurs transactions.")
  }
  const destinations = journals.map(({ destination }) => JSON.stringify(destination))
  if (new Set(destinations).size !== destinations.length) {
    throw new Error("L'historique de reprise réserve un emplacement dans plusieurs transactions.")
  }
  return Object.freeze(journals)
}

function sameImmutableTransaction(left: HgssP2pTradeJournal, right: HgssP2pTradeJournal): boolean {
  return left.sessionId === right.sessionId
    && left.localParticipantId === right.localParticipantId
    && left.remoteParticipantId === right.remoteParticipantId
    && getHgssP2pTradeOfferPairKey(left.pair) === getHgssP2pTradeOfferPairKey(right.pair)
    && JSON.stringify(left.outgoing) === JSON.stringify(right.outgoing)
    && JSON.stringify(left.incoming) === JSON.stringify(right.incoming)
    && JSON.stringify(left.destination) === JSON.stringify(right.destination)
}

export function upsertHgssP2pTradeJournal(
  journals: readonly HgssP2pTradeJournal[],
  journal: HgssP2pTradeJournal,
): HgssP2pTradeJournal[] {
  const current = parseHgssP2pTradeJournals(journals)
  const parsed = parseHgssP2pTradeJournal(journal)
  const existingIndex = current.findIndex(({ transactionId }) => transactionId === parsed.transactionId)
  if (existingIndex < 0) return parseHgssP2pTradeJournals([...current, parsed]).map((entry) => entry)
  const existing = current[existingIndex]!
  if (!sameImmutableTransaction(existing, parsed)) {
    throw new Error("La transaction P2P durable existe déjà avec un autre contenu.")
  }
  if (existing.phase === 'committed' && parsed.phase !== 'committed') {
    throw new Error("Une transaction P2P commitée ne peut pas revenir à l'état préparé.")
  }
  if (existing.phase === 'committed' && parsed.phase === 'committed'
    && JSON.stringify(existing.result) !== JSON.stringify(parsed.result)) {
    throw new Error("Une transaction P2P commitée existe déjà avec un autre résultat.")
  }
  const next = [...current]
  next[existingIndex] = parsed
  return parseHgssP2pTradeJournals(next).map((entry) => entry)
}

export function removeHgssP2pTradeJournal(
  journals: readonly HgssP2pTradeJournal[],
  transactionId: string,
): HgssP2pTradeJournal[] {
  if (!isOnlineOpaqueId(transactionId)) throw new Error("L'identifiant de transaction P2P est invalide.")
  return parseHgssP2pTradeJournals(journals)
    .filter((journal) => journal.transactionId !== transactionId)
    .map((journal) => journal)
}

/** Les deux côtés doivent décrire la même paire avec des directions inversées. */
export function areHgssP2pTradeJournalsMirrored(
  local: HgssP2pTradeJournal,
  remote: HgssP2pTradeJournal,
): boolean {
  const left = parseHgssP2pTradeJournal(local)
  const right = parseHgssP2pTradeJournal(remote)
  return left.transactionId === right.transactionId
    && left.sessionId === right.sessionId
    && left.localParticipantId === right.remoteParticipantId
    && left.remoteParticipantId === right.localParticipantId
    && getHgssP2pTradeOfferPairKey(left.pair) === getHgssP2pTradeOfferPairKey(right.pair)
    && JSON.stringify(left.outgoing) === JSON.stringify(right.incoming)
    && JSON.stringify(left.incoming) === JSON.stringify(right.outgoing)
}
