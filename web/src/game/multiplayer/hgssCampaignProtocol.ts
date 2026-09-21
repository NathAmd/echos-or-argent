import type { PlayerDirection } from '../../ndsTypes'
import {
  isPortablePokemonInstanceId,
  type PokemonInstanceId,
} from '../pokemon/pokemonInstanceId'
import type {
  DoubleBattleItemAction,
  DoubleBattleMoveAction,
  DoubleBattlePosition,
  DoubleBattleSwitchAction,
} from '../battle/doubleBattleSession'

export const hgssCampaignProtocolVersion = 2 as const
export const hgssCampaignMaximumPlayers = 2 as const

const maxIdentifierLength = 128
const maxMapId = 0xffff
const maxObjectId = 0xffff
const maxSpriteId = 0xffff
const maxCoordinate = 1_000_000
const maxPartyIndex = 5
const maxMoveIndex = 3
const maxMilestones = 512
const maxProgressionCounters = 256
const maxPendingEvents = 128
const maxBattleParticipants = 4
const maxCampaignEventEffects = 32

type UnknownRecord = Record<string, unknown>

function deepFreezeProtocolValue<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) deepFreezeProtocolValue(Reflect.get(value, key))
  return Object.freeze(value)
}

export type HgssCampaignFieldPosition = Readonly<{
  mapId: number
  x: number
  z: number
  direction: PlayerDirection
}>

type ExplicitDoubleBattleMoveAction = Omit<DoubleBattleMoveAction, 'kind'> & { kind: 'move' }

/**
 * Sous-ensemble sérialisable des commandes du moteur. Les objets Dresseur
 * restent exclusivement produits par le serveur et ne font pas partie de ce
 * contrat client.
 */
export type HgssCampaignDoubleBattleAction =
  | ExplicitDoubleBattleMoveAction
  | DoubleBattleSwitchAction
  | DoubleBattleItemAction

type HgssCampaignClientCommandBase = Readonly<{
  protocolVersion: typeof hgssCampaignProtocolVersion
  commandId: string
  expectedRevision: number
}>

export type HgssCampaignClientCommand = HgssCampaignClientCommandBase & (
  | Readonly<{
    kind: 'movement'
    sequence: number
    from: HgssCampaignFieldPosition
    to: HgssCampaignFieldPosition
    /** Position finale d'un warp ROM; `to` reste toujours le pas cardinal source. */
    arrival?: HgssCampaignFieldPosition
    mode: 'walk' | 'run'
  }>
  | Readonly<{
    kind: 'interaction'
    direction: PlayerDirection
    target:
      | Readonly<{ kind: 'object', mapId: number, objectId: number }>
      | Readonly<{ kind: 'coordinate', mapId: number, x: number, z: number }>
  }>
  | Readonly<{
    kind: 'double-battle-action'
    battleId: string
    turn: number
    action: HgssCampaignDoubleBattleAction
  }>
  | Readonly<{
    kind: 'shared-event'
    eventId: string
    milestoneIds: readonly string[]
    counters: readonly Readonly<{
      id: string
      expectedValue: number | null
      value: number
    }>[]
  }>
  | Readonly<{
    kind: 'event-ack'
    eventId: string
    eventRevision: number
  }>
)

export type HgssCampaignPlayerSnapshot = Readonly<{
  playerId: string
  displayName: string
  gender: 'male' | 'female'
  state: 'active' | 'away'
  position: HgssCampaignFieldPosition
  spriteId: number
  movementSequence: number
}>

export type HgssCampaignSharedProgression = Readonly<{
  milestoneIds: readonly string[]
  counters: readonly Readonly<{ id: string, value: number }>[]
}>

export type HgssCampaignPendingEvent = Readonly<{
  eventId: string
  eventRevision: number
  pendingPlayerIds: readonly string[]
}>

export type HgssCampaignBattlePokemonSnapshot = Readonly<{
  pokemonId: PokemonInstanceId
  speciesId: number
  form: number
  level: number
  currentHp: number
  maxHp: number
  status: number
}>

export type HgssCampaignBattleParticipantSnapshot = Readonly<{
  ownerId: string
  controllerPlayerId?: string
  position: DoubleBattlePosition
  partyIndex: number
  pokemon: HgssCampaignBattlePokemonSnapshot
}>

export type HgssCampaignBattleSnapshot = Readonly<{
  battleId: string
  turn: number
  phase: 'command' | 'replacement' | 'ended'
  participants: readonly HgssCampaignBattleParticipantSnapshot[]
  pendingCommandActors: readonly DoubleBattlePosition[]
  result?: 'player-won' | 'opponent-won' | 'draw'
}>

export type HgssCampaignServerSnapshot = Readonly<{
  protocolVersion: typeof hgssCampaignProtocolVersion
  sessionId: string
  revision: number
  players: readonly HgssCampaignPlayerSnapshot[]
  sharedProgression: HgssCampaignSharedProgression
  pendingEvents: readonly HgssCampaignPendingEvent[]
  battle?: HgssCampaignBattleSnapshot
}>

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
  requiredKeys: readonly string[],
  optionalKeys: readonly string[] = [],
): value is UnknownRecord {
  if (!isRecord(value)) return false
  const keys = Object.keys(value)
  const allowedKeys = new Set([...requiredKeys, ...optionalKeys])
  return requiredKeys.every((key) => Object.hasOwn(value, key))
    && keys.every((key) => allowedKeys.has(key))
}

function isDenseArray(value: unknown, maximumLength: number): value is unknown[] {
  if (!Array.isArray(value) || value.length > maximumLength) return false
  if (Object.getPrototypeOf(value) !== Array.prototype) return false
  const ownKeys = Reflect.ownKeys(value)
  if (ownKeys.some((key) => typeof key === 'symbol')) return false
  if (Object.keys(value).length !== value.length) return false
  return value.every((_entry, index) => Object.hasOwn(value, index))
    && ownKeys.every((key) => key === 'length' || /^(0|[1-9]\d*)$/.test(key as string))
}

function isBoundedInteger(value: unknown, minimum: number, maximum: number): value is number {
  return Number.isSafeInteger(value) && (value as number) >= minimum && (value as number) <= maximum
}

function isRevision(value: unknown): value is number {
  return isBoundedInteger(value, 0, Number.MAX_SAFE_INTEGER)
}

function parseIdentifier(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > maxIdentifierLength) return undefined
  return /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value) ? value : undefined
}

function parseDisplayName(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() !== value) return undefined
  const characters = [...value]
  const hasControlCharacter = characters.some((character) => {
    const codePoint = character.codePointAt(0)!
    return codePoint <= 0x1f || codePoint === 0x7f
  })
  return characters.length >= 1 && characters.length <= 7 && !hasControlCharacter
    ? value
    : undefined
}

function parseDirection(value: unknown): PlayerDirection | undefined {
  return value === 'north' || value === 'south' || value === 'west' || value === 'east'
    ? value
    : undefined
}

function parseFieldPosition(value: unknown): HgssCampaignFieldPosition | undefined {
  if (!hasExactKeys(value, ['mapId', 'x', 'z', 'direction'])) return undefined
  const direction = parseDirection(value.direction)
  if (
    !isBoundedInteger(value.mapId, 0, maxMapId)
    || !isBoundedInteger(value.x, -maxCoordinate, maxCoordinate)
    || !isBoundedInteger(value.z, -maxCoordinate, maxCoordinate)
    || direction === undefined
  ) return undefined
  return { mapId: value.mapId, x: value.x, z: value.z, direction }
}

function parseBattlePosition(value: unknown, playerActorOnly = false): DoubleBattlePosition | undefined {
  if (!hasExactKeys(value, ['side', 'slot'])) return undefined
  const side = value.side
  const slot = value.slot
  if (side !== 'player' && side !== 'opponent') return undefined
  if (playerActorOnly && side !== 'player') return undefined
  if (slot !== 0 && slot !== 1) return undefined
  return { side, slot }
}

function parseDoubleBattleAction(value: unknown): HgssCampaignDoubleBattleAction | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined
  if (value.kind === 'move') {
    if (!hasExactKeys(value, ['kind', 'actor', 'moveIndex', 'target'], ['switchPartyIndex'])) return undefined
    const actor = parseBattlePosition(value.actor, true)
    const target = parseBattlePosition(value.target)
    if (!actor || !target || !isBoundedInteger(value.moveIndex, 0, maxMoveIndex)) return undefined
    if (Object.hasOwn(value, 'switchPartyIndex') && !isBoundedInteger(value.switchPartyIndex, 0, maxPartyIndex)) return undefined
    return {
      kind: 'move',
      actor,
      moveIndex: value.moveIndex,
      target,
      ...(Object.hasOwn(value, 'switchPartyIndex') ? { switchPartyIndex: value.switchPartyIndex as number } : {}),
    }
  }
  if (value.kind === 'switch') {
    if (!hasExactKeys(value, ['kind', 'actor', 'partyIndex'])) return undefined
    const actor = parseBattlePosition(value.actor, true)
    if (!actor || !isBoundedInteger(value.partyIndex, 0, maxPartyIndex)) return undefined
    return { kind: 'switch', actor, partyIndex: value.partyIndex }
  }
  if (value.kind === 'item') {
    if (!hasExactKeys(value, ['kind', 'actor', 'itemId', 'targetPartyIndex'], ['moveIndex'])) return undefined
    const actor = parseBattlePosition(value.actor, true)
    if (
      !actor
      || !isBoundedInteger(value.itemId, 1, 0xffff)
      || !isBoundedInteger(value.targetPartyIndex, 0, maxPartyIndex)
      || Object.hasOwn(value, 'moveIndex') && !isBoundedInteger(value.moveIndex, 0, maxMoveIndex)
    ) return undefined
    return {
      kind: 'item',
      actor,
      itemId: value.itemId,
      targetPartyIndex: value.targetPartyIndex,
      ...(Object.hasOwn(value, 'moveIndex') ? { moveIndex: value.moveIndex as number } : {}),
    }
  }
  return undefined
}

function parseInteractionTarget(value: unknown): Extract<HgssCampaignClientCommand, { kind: 'interaction' }>['target'] | undefined {
  if (!isRecord(value) || typeof value.kind !== 'string') return undefined
  if (value.kind === 'object') {
    if (!hasExactKeys(value, ['kind', 'mapId', 'objectId'])) return undefined
    if (!isBoundedInteger(value.mapId, 0, maxMapId) || !isBoundedInteger(value.objectId, 0, maxObjectId)) return undefined
    return { kind: 'object', mapId: value.mapId, objectId: value.objectId }
  }
  if (value.kind === 'coordinate') {
    if (!hasExactKeys(value, ['kind', 'mapId', 'x', 'z'])) return undefined
    if (
      !isBoundedInteger(value.mapId, 0, maxMapId)
      || !isBoundedInteger(value.x, -maxCoordinate, maxCoordinate)
      || !isBoundedInteger(value.z, -maxCoordinate, maxCoordinate)
    ) return undefined
    return { kind: 'coordinate', mapId: value.mapId, x: value.x, z: value.z }
  }
  return undefined
}

function parseClientCommandUnsafe(value: unknown): HgssCampaignClientCommand | undefined {
  if (!isRecord(value) || value.protocolVersion !== hgssCampaignProtocolVersion) return undefined
  const commandId = parseIdentifier(value.commandId)
  if (!commandId || !isRevision(value.expectedRevision) || typeof value.kind !== 'string') return undefined
  const base = { protocolVersion: hgssCampaignProtocolVersion, commandId, expectedRevision: value.expectedRevision }
  if (value.kind === 'movement') {
    if (!hasExactKeys(
      value,
      ['protocolVersion', 'commandId', 'expectedRevision', 'kind', 'sequence', 'from', 'to', 'mode'],
      ['arrival'],
    )) return undefined
    const from = parseFieldPosition(value.from)
    const to = parseFieldPosition(value.to)
    const hasArrival = Object.hasOwn(value, 'arrival')
    const arrival = hasArrival ? parseFieldPosition(value.arrival) : undefined
    if (!from || !to || from.mapId !== to.mapId || !isRevision(value.sequence)) return undefined
    if (hasArrival && (!arrival
      || arrival.mapId === to.mapId
        && arrival.x === to.x
        && arrival.z === to.z
        && arrival.direction === to.direction)) return undefined
    if (value.mode !== 'walk' && value.mode !== 'run') return undefined
    return {
      ...base,
      kind: 'movement',
      sequence: value.sequence,
      from,
      to,
      ...(arrival ? { arrival } : {}),
      mode: value.mode,
    }
  }
  if (value.kind === 'interaction') {
    if (!hasExactKeys(value, ['protocolVersion', 'commandId', 'expectedRevision', 'kind', 'direction', 'target'])) return undefined
    const direction = parseDirection(value.direction)
    const target = parseInteractionTarget(value.target)
    return direction && target ? { ...base, kind: 'interaction', direction, target } : undefined
  }
  if (value.kind === 'double-battle-action') {
    if (!hasExactKeys(value, ['protocolVersion', 'commandId', 'expectedRevision', 'kind', 'battleId', 'turn', 'action'])) return undefined
    const battleId = parseIdentifier(value.battleId)
    const action = parseDoubleBattleAction(value.action)
    return battleId && isRevision(value.turn) && action
      ? { ...base, kind: 'double-battle-action', battleId, turn: value.turn, action }
      : undefined
  }
  if (value.kind === 'shared-event') {
    if (!hasExactKeys(
      value,
      ['protocolVersion', 'commandId', 'expectedRevision', 'kind', 'eventId', 'milestoneIds', 'counters'],
    )) return undefined
    const eventId = parseIdentifier(value.eventId)
    if (!eventId
      || !isDenseArray(value.milestoneIds, maxCampaignEventEffects)
      || !isDenseArray(value.counters, maxCampaignEventEffects)) return undefined
    const milestoneIds: string[] = []
    for (const entry of value.milestoneIds) {
      const milestoneId = parseIdentifier(entry)
      if (!milestoneId || milestoneIds.includes(milestoneId)) return undefined
      milestoneIds.push(milestoneId)
    }
    const counters: Array<Readonly<{ id: string, expectedValue: number | null, value: number }>> = []
    for (const entry of value.counters) {
      if (!hasExactKeys(entry, ['id', 'expectedValue', 'value'])) return undefined
      const id = parseIdentifier(entry.id)
      if (!id
        || counters.some((counter) => counter.id === id)
        || entry.expectedValue !== null
          && !isBoundedInteger(entry.expectedValue, -1_000_000_000, 1_000_000_000)
        || !isBoundedInteger(entry.value, -1_000_000_000, 1_000_000_000)) return undefined
      counters.push({ id, expectedValue: entry.expectedValue as number | null, value: entry.value })
    }
    return { ...base, kind: 'shared-event', eventId, milestoneIds, counters }
  }
  if (value.kind === 'event-ack') {
    if (!hasExactKeys(value, ['protocolVersion', 'commandId', 'expectedRevision', 'kind', 'eventId', 'eventRevision'])) return undefined
    const eventId = parseIdentifier(value.eventId)
    return eventId && isBoundedInteger(value.eventRevision, 1, Number.MAX_SAFE_INTEGER)
      ? { ...base, kind: 'event-ack', eventId, eventRevision: value.eventRevision }
      : undefined
  }
  return undefined
}

/** Valide et reconstruit une commande décodée depuis JSON sans jamais lever. */
export function parseHgssCampaignClientCommand(value: unknown): HgssCampaignClientCommand | undefined {
  try {
    const command = parseClientCommandUnsafe(value)
    return command && deepFreezeProtocolValue(command)
  } catch {
    return undefined
  }
}

function parsePlayerSnapshot(value: unknown): HgssCampaignPlayerSnapshot | undefined {
  if (!hasExactKeys(value, ['playerId', 'displayName', 'gender', 'state', 'position', 'spriteId', 'movementSequence'])) return undefined
  const playerId = parseIdentifier(value.playerId)
  const displayName = parseDisplayName(value.displayName)
  const position = parseFieldPosition(value.position)
  if (
    !playerId
    || !displayName
    || value.gender !== 'male' && value.gender !== 'female'
    || value.state !== 'active' && value.state !== 'away'
    || !position
    || !isBoundedInteger(value.spriteId, 0, maxSpriteId)
    || !isRevision(value.movementSequence)
  ) return undefined
  return {
    playerId,
    displayName,
    gender: value.gender,
    state: value.state,
    position,
    spriteId: value.spriteId,
    movementSequence: value.movementSequence,
  }
}

function parseSharedProgression(value: unknown): HgssCampaignSharedProgression | undefined {
  if (!hasExactKeys(value, ['milestoneIds', 'counters'])) return undefined
  if (!isDenseArray(value.milestoneIds, maxMilestones) || !isDenseArray(value.counters, maxProgressionCounters)) return undefined
  const milestoneIds: string[] = []
  for (const entry of value.milestoneIds) {
    const milestoneId = parseIdentifier(entry)
    if (!milestoneId || milestoneIds.includes(milestoneId)) return undefined
    milestoneIds.push(milestoneId)
  }
  const counters: Array<Readonly<{ id: string, value: number }>> = []
  for (const entry of value.counters) {
    if (!hasExactKeys(entry, ['id', 'value'])) return undefined
    const id = parseIdentifier(entry.id)
    if (!id || counters.some((counter) => counter.id === id) || !isBoundedInteger(entry.value, -1_000_000_000, 1_000_000_000)) return undefined
    counters.push({ id, value: entry.value })
  }
  return { milestoneIds, counters }
}

/** Valide une projection de progression isolée, notamment au POST de création. */
export function parseHgssCampaignSharedProgression(
  value: unknown,
): HgssCampaignSharedProgression | undefined {
  try {
    const progression = parseSharedProgression(value)
    return progression && deepFreezeProtocolValue(progression)
  } catch {
    return undefined
  }
}

function parseBattlePokemonSnapshot(value: unknown): HgssCampaignBattlePokemonSnapshot | undefined {
  if (!hasExactKeys(value, ['pokemonId', 'speciesId', 'form', 'level', 'currentHp', 'maxHp', 'status'])) return undefined
  if (
    !isPortablePokemonInstanceId(value.pokemonId)
    || !isBoundedInteger(value.speciesId, 1, 493)
    || !isBoundedInteger(value.form, 0, 0xff)
    || !isBoundedInteger(value.level, 1, 100)
    || !isBoundedInteger(value.currentHp, 0, 0xffff)
    || !isBoundedInteger(value.maxHp, 1, 0xffff)
    || value.currentHp > value.maxHp
    || !isBoundedInteger(value.status, 0, 0xffffffff)
  ) return undefined
  return {
    pokemonId: value.pokemonId,
    speciesId: value.speciesId,
    form: value.form,
    level: value.level,
    currentHp: value.currentHp,
    maxHp: value.maxHp,
    status: value.status,
  }
}

function parseBattleParticipantSnapshot(value: unknown): HgssCampaignBattleParticipantSnapshot | undefined {
  if (!hasExactKeys(value, ['ownerId', 'position', 'partyIndex', 'pokemon'], ['controllerPlayerId'])) return undefined
  const ownerId = parseIdentifier(value.ownerId)
  const position = parseBattlePosition(value.position)
  const pokemon = parseBattlePokemonSnapshot(value.pokemon)
  const hasController = Object.hasOwn(value, 'controllerPlayerId')
  const controllerPlayerId = hasController ? parseIdentifier(value.controllerPlayerId) : undefined
  if (!ownerId || !position || !pokemon || !isBoundedInteger(value.partyIndex, 0, maxPartyIndex)) return undefined
  if (hasController && !controllerPlayerId) return undefined
  return {
    ownerId,
    ...(controllerPlayerId ? { controllerPlayerId } : {}),
    position,
    partyIndex: value.partyIndex,
    pokemon,
  }
}

function battlePositionKey(position: DoubleBattlePosition): string {
  return `${position.side}:${position.slot}`
}

function parseBattleSnapshot(value: unknown, playerIds: ReadonlySet<string>): HgssCampaignBattleSnapshot | undefined {
  if (!hasExactKeys(value, ['battleId', 'turn', 'phase', 'participants', 'pendingCommandActors'], ['result'])) return undefined
  const battleId = parseIdentifier(value.battleId)
  if (!battleId || !isRevision(value.turn)) return undefined
  if (value.phase !== 'command' && value.phase !== 'replacement' && value.phase !== 'ended') return undefined
  const hasResult = Object.hasOwn(value, 'result')
  if (hasResult !== (value.phase === 'ended')) return undefined
  if (hasResult && value.result !== 'player-won' && value.result !== 'opponent-won' && value.result !== 'draw') return undefined
  if (!isDenseArray(value.participants, maxBattleParticipants) || value.participants.length === 0) return undefined
  if (!isDenseArray(value.pendingCommandActors, maxBattleParticipants)) return undefined
  const participants: HgssCampaignBattleParticipantSnapshot[] = []
  const participantPositions = new Set<string>()
  const pokemonIds = new Set<string>()
  for (const entry of value.participants) {
    const participant = parseBattleParticipantSnapshot(entry)
    if (!participant) return undefined
    if (participant.position.side === 'opponent' && participant.controllerPlayerId) return undefined
    const positionKey = battlePositionKey(participant.position)
    if (participantPositions.has(positionKey) || pokemonIds.has(participant.pokemon.pokemonId)) return undefined
    if (participant.controllerPlayerId && !playerIds.has(participant.controllerPlayerId)) return undefined
    participantPositions.add(positionKey)
    pokemonIds.add(participant.pokemon.pokemonId)
    participants.push(participant)
  }
  const pendingCommandActors: DoubleBattlePosition[] = []
  const pendingKeys = new Set<string>()
  for (const entry of value.pendingCommandActors) {
    const actor = parseBattlePosition(entry, true)
    if (!actor) return undefined
    const key = battlePositionKey(actor)
    const participant = participants.find((candidate) => battlePositionKey(candidate.position) === key)
    if (pendingKeys.has(key) || !participant?.controllerPlayerId || value.phase === 'ended') return undefined
    pendingKeys.add(key)
    pendingCommandActors.push(actor)
  }
  return {
    battleId,
    turn: value.turn,
    phase: value.phase,
    participants,
    pendingCommandActors,
    ...(hasResult ? { result: value.result as HgssCampaignBattleSnapshot['result'] } : {}),
  }
}

function parseServerSnapshotUnsafe(value: unknown): HgssCampaignServerSnapshot | undefined {
  if (!hasExactKeys(value, ['protocolVersion', 'sessionId', 'revision', 'players', 'sharedProgression', 'pendingEvents'], ['battle'])) return undefined
  if (value.protocolVersion !== hgssCampaignProtocolVersion) return undefined
  const sessionId = parseIdentifier(value.sessionId)
  if (!sessionId || !isRevision(value.revision) || !isDenseArray(value.players, hgssCampaignMaximumPlayers)) return undefined
  const players: HgssCampaignPlayerSnapshot[] = []
  const playerIds = new Set<string>()
  for (const entry of value.players) {
    const player = parsePlayerSnapshot(entry)
    if (!player || playerIds.has(player.playerId)) return undefined
    playerIds.add(player.playerId)
    players.push(player)
  }
  const sharedProgression = parseSharedProgression(value.sharedProgression)
  if (!sharedProgression || !isDenseArray(value.pendingEvents, maxPendingEvents)) return undefined
  const pendingEvents: HgssCampaignPendingEvent[] = []
  const pendingEventRevisions = new Set<number>()
  for (const entry of value.pendingEvents) {
    if (!hasExactKeys(entry, ['eventId', 'eventRevision', 'pendingPlayerIds'])) return undefined
    const eventId = parseIdentifier(entry.eventId)
    if (!eventId
      || pendingEvents.some((event) => event.eventId === eventId)
      || !isBoundedInteger(entry.eventRevision, 1, Number.MAX_SAFE_INTEGER)
      || pendingEventRevisions.has(entry.eventRevision)
      || entry.eventRevision > value.revision
      || !sharedProgression.milestoneIds.includes(eventId)
      || !isDenseArray(entry.pendingPlayerIds, hgssCampaignMaximumPlayers)
      || entry.pendingPlayerIds.length === 0) return undefined
    const pendingPlayerIds: string[] = []
    for (const pendingPlayerIdValue of entry.pendingPlayerIds) {
      const pendingPlayerId = parseIdentifier(pendingPlayerIdValue)
      if (!pendingPlayerId
        || !playerIds.has(pendingPlayerId)
        || pendingPlayerIds.includes(pendingPlayerId)) return undefined
      pendingPlayerIds.push(pendingPlayerId)
    }
    pendingEventRevisions.add(entry.eventRevision)
    pendingEvents.push({ eventId, eventRevision: entry.eventRevision, pendingPlayerIds })
  }
  const hasBattle = Object.hasOwn(value, 'battle')
  const battle = hasBattle ? parseBattleSnapshot(value.battle, playerIds) : undefined
  if (hasBattle && !battle) return undefined
  return {
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId,
    revision: value.revision,
    players,
    sharedProgression,
    pendingEvents,
    ...(battle ? { battle } : {}),
  }
}

/** Valide et reconstruit un snapshot décodé depuis JSON sans jamais lever. */
export function parseHgssCampaignServerSnapshot(value: unknown): HgssCampaignServerSnapshot | undefined {
  try {
    const snapshot = parseServerSnapshotUnsafe(value)
    return snapshot && deepFreezeProtocolValue(snapshot)
  } catch {
    return undefined
  }
}
