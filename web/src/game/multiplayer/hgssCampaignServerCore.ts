import {
  hgssCampaignMaximumPlayers,
  hgssCampaignProtocolVersion,
  parseHgssCampaignClientCommand,
  parseHgssCampaignServerSnapshot,
  type HgssCampaignBattleSnapshot,
  type HgssCampaignClientCommand,
  type HgssCampaignPendingEvent,
  type HgssCampaignPlayerSnapshot,
  type HgssCampaignServerSnapshot,
  type HgssCampaignSharedProgression,
} from './hgssCampaignProtocol'
import { arbitrateHgssCampaignSnapshotRevision } from './hgssCampaignRevision'

export const hgssCampaignServerMaximumPlayers = hgssCampaignMaximumPlayers
export const hgssCampaignServerCommandCacheLimit = 2_048 as const

export type HgssCampaignServerPlayerInput = Readonly<Pick<
  HgssCampaignPlayerSnapshot,
  'playerId' | 'displayName' | 'gender' | 'position' | 'spriteId'
>>

export type HgssCampaignServerCreateSessionInput = Readonly<{
  sessionId: string
  host: HgssCampaignServerPlayerInput
  sharedProgression?: HgssCampaignSharedProgression
  pendingEvents?: readonly HgssCampaignPendingEvent[]
  battle?: HgssCampaignBattleSnapshot
}>

export type HgssCampaignServerStatePatch = Readonly<{
  players?: readonly HgssCampaignPlayerSnapshot[]
  sharedProgression?: HgssCampaignSharedProgression
  pendingEvents?: readonly HgssCampaignPendingEvent[]
  /** `null` termine et retire le combat courant. */
  battle?: HgssCampaignBattleSnapshot | null
}>

export type HgssCampaignMovementCommand = Extract<HgssCampaignClientCommand, { kind: 'movement' }>
type InteractionCommand = Extract<HgssCampaignClientCommand, { kind: 'interaction' }>
type DoubleBattleCommand = Extract<HgssCampaignClientCommand, { kind: 'double-battle-action' }>
type EventAcknowledgementCommand = Extract<HgssCampaignClientCommand, { kind: 'event-ack' }>

export type HgssCampaignServerPortContext<Command extends HgssCampaignClientCommand> = Readonly<{
  sessionId: string
  playerId: string
  command: Command
  snapshot: HgssCampaignServerSnapshot
}>

export type HgssCampaignServerPortDecision =
  | Readonly<{ kind: 'accept', patch?: HgssCampaignServerStatePatch }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

/**
 * Un port de mouvement valide uniquement l'intention. Le noyau reste seul
 * autorisé à appliquer la position et la séquence assainies de la commande.
 */
export type HgssCampaignServerMovementPortDecision =
  | Readonly<{
    kind: 'accept'
    /** Position finale recalculée par le validateur ROM, jamais fournie par le noyau. */
    authoritativePosition?: HgssCampaignPlayerSnapshot['position']
  }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

export type HgssCampaignServerMovementPort = (
  context: HgssCampaignServerPortContext<HgssCampaignMovementCommand>,
) => HgssCampaignServerMovementPortDecision

export type HgssCampaignServerPorts = Readonly<{
  movement?: HgssCampaignServerMovementPort
  interaction?: (context: HgssCampaignServerPortContext<InteractionCommand>) => HgssCampaignServerPortDecision
  doubleBattleAction?: (context: HgssCampaignServerPortContext<DoubleBattleCommand>) => HgssCampaignServerPortDecision
  eventAcknowledgement?: (context: HgssCampaignServerPortContext<EventAcknowledgementCommand>) => HgssCampaignServerPortDecision
}>

export type HgssCampaignServerErrorCode =
  | 'invalid-session'
  | 'invalid-player'
  | 'invalid-initial-state'
  | 'session-already-exists'
  | 'session-not-found'
  | 'session-full'
  | 'player-already-joined'
  | 'player-not-found'
  | 'player-in-battle'
  | 'session-mutation-in-progress'
  | 'invalid-command'
  | 'revision-conflict'
  | 'revision-exhausted'
  | 'command-id-conflict'
  | 'movement-sequence-conflict'
  | 'movement-sequence-exhausted'
  | 'movement-origin-conflict'
  | 'movement-arrival-conflict'
  | 'movement-state-conflict'
  | 'movement-step-conflict'
  | 'movement-destination-occupied'
  | 'battle-state-conflict'
  | 'battle-control-conflict'
  | 'unsupported-command'
  | 'port-rejected'
  | 'port-failed'
  | 'port-invalid-result'

export type HgssCampaignServerError = Readonly<{
  code: HgssCampaignServerErrorCode
  message: string
  sessionId?: string
  playerId?: string
  commandId?: string
  commandKind?: HgssCampaignClientCommand['kind']
  expectedRevision?: number
  receivedRevision?: number
  expectedSequence?: number
  receivedSequence?: number
  expectedFrom?: HgssCampaignPlayerSnapshot['position']
  receivedFrom?: HgssCampaignPlayerSnapshot['position']
  blockingPlayerId?: string
  portCode?: string
}>

export type HgssCampaignServerFailure = Readonly<{
  ok: false
  error: HgssCampaignServerError
}>

export type HgssCampaignServerMutationResult =
  | Readonly<{
    ok: true
    kind: 'created' | 'joined' | 'left'
    snapshot: HgssCampaignServerSnapshot
  }>
  | HgssCampaignServerFailure

export type HgssCampaignServerCommandResult =
  | Readonly<{
    ok: true
    kind: 'applied' | 'replayed'
    commandId: string
    appliedRevision: number
    snapshot: HgssCampaignServerSnapshot
  }>
  | HgssCampaignServerFailure

export type HgssCampaignServerSubscriptionResult =
  | Readonly<{
    ok: true
    snapshot: HgssCampaignServerSnapshot
    unsubscribe: () => void
  }>
  | HgssCampaignServerFailure

export type HgssCampaignServerDestroyResult =
  | Readonly<{ ok: true, kind: 'destroyed', sessionId: string }>
  | HgssCampaignServerFailure

export type HgssCampaignServerCore = Readonly<{
  createSession: (input: HgssCampaignServerCreateSessionInput) => HgssCampaignServerMutationResult
  joinSession: (
    sessionId: string,
    player: HgssCampaignServerPlayerInput,
  ) => HgssCampaignServerMutationResult
  leaveSession: (sessionId: string, playerId: string) => HgssCampaignServerMutationResult
  destroySession: (sessionId: string) => HgssCampaignServerDestroyResult
  getSnapshot: (sessionId: string) => HgssCampaignServerSnapshot | undefined
  subscribe: (
    sessionId: string,
    listener: (snapshot: HgssCampaignServerSnapshot) => void,
  ) => HgssCampaignServerSubscriptionResult
  submitCommand: (
    sessionId: string,
    playerId: string,
    command: unknown,
  ) => HgssCampaignServerCommandResult
}>

type CachedCommand = Readonly<{
  fingerprint: string
  appliedRevision: number
}>

type SessionState = {
  snapshot: HgssCampaignServerSnapshot
  readonly listeners: Set<(snapshot: HgssCampaignServerSnapshot) => void>
  readonly commandCache: Map<string, Map<string, CachedCommand>>
  readonly broadcastQueue: HgssCampaignServerSnapshot[]
  broadcasting: boolean
  evaluatingPort: boolean
}

const emptySharedProgression: HgssCampaignSharedProgression = {
  milestoneIds: [],
  counters: [],
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const key of Reflect.ownKeys(value)) deepFreeze(Reflect.get(value, key))
  return Object.freeze(value)
}

function failure(error: HgssCampaignServerError): HgssCampaignServerFailure {
  return deepFreeze({ ok: false, error })
}

function isIdentifier(value: unknown): value is string {
  return typeof value === 'string'
    && value.length <= 128
    && /^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(value)
}

function isPlainDataRecord(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  try {
    const prototype = Object.getPrototypeOf(value)
    if (prototype !== Object.prototype && prototype !== null) return false
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== 'string') return false
      const descriptor = Object.getOwnPropertyDescriptor(value, key)
      return descriptor?.enumerable === true && 'value' in descriptor
    })
  } catch {
    return false
  }
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): boolean {
  const allowed = new Set(allowedKeys)
  return Object.keys(value).every((key) => allowed.has(key))
}

function canonicalSnapshot(value: unknown): HgssCampaignServerSnapshot | undefined {
  const snapshot = parseHgssCampaignServerSnapshot(value)
  if (!snapshot || snapshot.players.length > hgssCampaignServerMaximumPlayers) return undefined
  return deepFreeze(snapshot)
}

function materializePlayer(input: HgssCampaignServerPlayerInput): HgssCampaignPlayerSnapshot | undefined {
  try {
    const snapshot = canonicalSnapshot({
      protocolVersion: hgssCampaignProtocolVersion,
      sessionId: 'validation:player',
      revision: 0,
      players: [{
        playerId: input.playerId,
        displayName: input.displayName,
        gender: input.gender,
        state: 'active',
        position: input.position,
        spriteId: input.spriteId,
        movementSequence: 0,
      }],
      sharedProgression: emptySharedProgression,
      pendingEvents: [],
    })
    return snapshot?.players[0]
  } catch {
    return undefined
  }
}

function nextRevision(snapshot: HgssCampaignServerSnapshot): number | undefined {
  if (snapshot.revision === Number.MAX_SAFE_INTEGER) return undefined
  const decision = arbitrateHgssCampaignSnapshotRevision(snapshot.revision, snapshot.revision + 1)
  return decision.kind === 'apply' && !decision.bootstrap ? decision.revision : undefined
}

function samePosition(
  first: HgssCampaignPlayerSnapshot['position'],
  second: HgssCampaignPlayerSnapshot['position'],
): boolean {
  return first.mapId === second.mapId
    && first.x === second.x
    && first.z === second.z
    && first.direction === second.direction
}

function occupiesSameTile(
  first: HgssCampaignPlayerSnapshot['position'],
  second: HgssCampaignPlayerSnapshot['position'],
): boolean {
  return first.mapId === second.mapId
    && first.x === second.x
    && first.z === second.z
}

function isSingleCardinalStep(
  from: HgssCampaignPlayerSnapshot['position'],
  to: HgssCampaignPlayerSnapshot['position'],
): boolean {
  const deltaX = to.x - from.x
  const deltaZ = to.z - from.z
  const expectedDirection = deltaX === 1 && deltaZ === 0 ? 'east'
    : deltaX === -1 && deltaZ === 0 ? 'west'
      : deltaX === 0 && deltaZ === 1 ? 'south'
        : deltaX === 0 && deltaZ === -1 ? 'north'
          : undefined
  return from.mapId === to.mapId && expectedDirection === to.direction
}

function sameBattlePosition(
  first: Readonly<{ side: string, slot: number }>,
  second: Readonly<{ side: string, slot: number }>,
): boolean {
  return first.side === second.side && first.slot === second.slot
}

function samePlayerIds(
  first: readonly HgssCampaignPlayerSnapshot[],
  second: readonly HgssCampaignPlayerSnapshot[],
): boolean {
  if (first.length !== second.length) return false
  const secondIds = new Set(second.map(({ playerId }) => playerId))
  return first.every(({ playerId }) => secondIds.has(playerId))
}

function buildNextSnapshot(
  current: HgssCampaignServerSnapshot,
  patch: HgssCampaignServerStatePatch = {},
): HgssCampaignServerSnapshot | undefined {
  const revision = nextRevision(current)
  if (revision === undefined) return undefined
  const hasBattlePatch = Object.hasOwn(patch, 'battle')
  if (hasBattlePatch && patch.battle === undefined) return undefined
  const battle = hasBattlePatch
    ? patch.battle === null ? undefined : patch.battle
    : current.battle
  return canonicalSnapshot({
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId: current.sessionId,
    revision,
    players: patch.players ?? current.players,
    sharedProgression: patch.sharedProgression ?? current.sharedProgression,
    pendingEvents: patch.pendingEvents ?? current.pendingEvents,
    ...(battle ? { battle } : {}),
  })
}

function portPatch(value: unknown): HgssCampaignServerStatePatch | undefined {
  if (!isPlainDataRecord(value)) return undefined
  if (!hasOnlyKeys(value, ['players', 'sharedProgression', 'pendingEvents', 'battle'])) return undefined
  return value as HgssCampaignServerStatePatch
}

/**
 * Noyau autoritaire en mémoire. Il ne crée aucun transport et n'accède ni au
 * DOM ni au stockage : un adaptateur réseau pourra rester entièrement externe.
 */
export function createHgssCampaignServerCore(
  options: Readonly<{ ports?: HgssCampaignServerPorts }> = {},
): HgssCampaignServerCore {
  const sessions = new Map<string, SessionState>()
  const ports = options.ports ?? {}

  const publish = (session: SessionState, snapshot: HgssCampaignServerSnapshot): void => {
    session.broadcastQueue.push(snapshot)
    if (session.broadcasting) return
    session.broadcasting = true
    try {
      while (session.broadcastQueue.length > 0) {
        const next = session.broadcastQueue.shift()!
        for (const listener of [...session.listeners]) {
          try { listener(next) } catch { /* Un abonné ne peut pas bloquer les autres. */ }
        }
      }
    } finally {
      session.broadcasting = false
    }
  }

  const install = (session: SessionState, snapshot: HgssCampaignServerSnapshot): void => {
    session.snapshot = snapshot
    publish(session, snapshot)
  }

  const missingSession = (sessionId: string): HgssCampaignServerFailure => failure({
    code: 'session-not-found',
    message: `La session de campagne ${sessionId} n'existe pas.`,
    sessionId,
  })

  const createSession = (input: HgssCampaignServerCreateSessionInput): HgssCampaignServerMutationResult => {
    let sessionId: unknown
    try { sessionId = input.sessionId } catch { sessionId = undefined }
    if (!isIdentifier(sessionId)) return failure({
      code: 'invalid-session',
      message: "L'identifiant de session de campagne est invalide.",
    })
    if (sessions.has(sessionId)) return failure({
      code: 'session-already-exists',
      message: `La session de campagne ${sessionId} existe déjà.`,
      sessionId,
    })
    let host: HgssCampaignPlayerSnapshot | undefined
    try { host = materializePlayer(input.host) } catch { host = undefined }
    if (!host) return failure({
      code: 'invalid-player',
      message: "Le profil de l'hôte de campagne est invalide.",
      sessionId,
    })
    let snapshot: HgssCampaignServerSnapshot | undefined
    try {
      snapshot = canonicalSnapshot({
        protocolVersion: hgssCampaignProtocolVersion,
        sessionId,
        revision: 0,
        players: [host],
        sharedProgression: input.sharedProgression ?? emptySharedProgression,
        pendingEvents: input.pendingEvents ?? [],
        ...(input.battle ? { battle: input.battle } : {}),
      })
    } catch {
      snapshot = undefined
    }
    if (!snapshot) return failure({
      code: 'invalid-initial-state',
      message: "L'état initial de la campagne est invalide.",
      sessionId,
    })
    sessions.set(sessionId, {
      snapshot,
      listeners: new Set(),
      commandCache: new Map(),
      broadcastQueue: [],
      broadcasting: false,
      evaluatingPort: false,
    })
    return deepFreeze({ ok: true, kind: 'created', snapshot })
  }

  const joinSession = (
    sessionId: string,
    input: HgssCampaignServerPlayerInput,
  ): HgssCampaignServerMutationResult => {
    const session = sessions.get(sessionId)
    if (!session) return missingSession(sessionId)
    if (session.evaluatingPort) return failure({
      code: 'session-mutation-in-progress',
      message: `La session de campagne ${sessionId} évalue déjà une commande autoritaire.`,
      sessionId,
    })
    const player = materializePlayer(input)
    if (!player) return failure({
      code: 'invalid-player',
      message: 'Le profil du joueur de campagne est invalide.',
      sessionId,
    })
    if (session.snapshot.players.some(({ playerId }) => playerId === player.playerId)) return failure({
      code: 'player-already-joined',
      message: `Le joueur ${player.playerId} a déjà rejoint la campagne.`,
      sessionId,
      playerId: player.playerId,
    })
    if (session.snapshot.players.length >= hgssCampaignServerMaximumPlayers) return failure({
      code: 'session-full',
      message: 'La campagne coopérative accepte au maximum deux joueurs.',
      sessionId,
      playerId: player.playerId,
    })
    const snapshot = buildNextSnapshot(session.snapshot, {
      players: [...session.snapshot.players, player],
    })
    if (!snapshot) return failure({
      code: 'revision-exhausted',
      message: 'La révision de la campagne ne peut plus être incrémentée.',
      sessionId,
    })
    install(session, snapshot)
    return deepFreeze({ ok: true, kind: 'joined', snapshot })
  }

  const leaveSession = (sessionId: string, playerId: string): HgssCampaignServerMutationResult => {
    const session = sessions.get(sessionId)
    if (!session) return missingSession(sessionId)
    if (session.evaluatingPort) return failure({
      code: 'session-mutation-in-progress',
      message: `La session de campagne ${sessionId} évalue déjà une commande autoritaire.`,
      sessionId,
      playerId,
    })
    if (!session.snapshot.players.some((player) => player.playerId === playerId)) return failure({
      code: 'player-not-found',
      message: `Le joueur ${playerId} ne fait pas partie de la campagne.`,
      sessionId,
      playerId,
    })
    if (session.snapshot.battle?.participants.some(({ controllerPlayerId }) => controllerPlayerId === playerId)) {
      return failure({
        code: 'player-in-battle',
        message: `Le joueur ${playerId} contrôle encore un participant au combat.`,
        sessionId,
        playerId,
      })
    }
    const snapshot = buildNextSnapshot(session.snapshot, {
      players: session.snapshot.players.filter((player) => player.playerId !== playerId),
      pendingEvents: session.snapshot.pendingEvents.flatMap((event) => {
        const pendingPlayerIds = event.pendingPlayerIds.filter((id) => id !== playerId)
        return pendingPlayerIds.length > 0 ? [{ ...event, pendingPlayerIds }] : []
      }),
    })
    if (!snapshot) return failure({
      code: 'revision-exhausted',
      message: 'La révision de la campagne ne peut plus être incrémentée.',
      sessionId,
      playerId,
    })
    session.commandCache.delete(playerId)
    install(session, snapshot)
    return deepFreeze({ ok: true, kind: 'left', snapshot })
  }

  const destroySession = (sessionId: string): HgssCampaignServerDestroyResult => {
    const session = sessions.get(sessionId)
    if (!session) return missingSession(sessionId)
    if (session.evaluatingPort) return failure({
      code: 'session-mutation-in-progress',
      message: `La session de campagne ${sessionId} évalue déjà une commande autoritaire.`,
      sessionId,
    })
    session.listeners.clear()
    session.commandCache.clear()
    session.broadcastQueue.length = 0
    sessions.delete(sessionId)
    return deepFreeze({ ok: true, kind: 'destroyed', sessionId })
  }

  const getSnapshot = (sessionId: string): HgssCampaignServerSnapshot | undefined => sessions.get(sessionId)?.snapshot

  const subscribe = (
    sessionId: string,
    listener: (snapshot: HgssCampaignServerSnapshot) => void,
  ): HgssCampaignServerSubscriptionResult => {
    const session = sessions.get(sessionId)
    if (!session) return missingSession(sessionId)
    session.listeners.add(listener)
    try { listener(session.snapshot) } catch { /* L'abonnement reste actif. */ }
    let subscribed = true
    return deepFreeze({
      ok: true,
      snapshot: session.snapshot,
      unsubscribe: () => {
        if (!subscribed) return
        subscribed = false
        session.listeners.delete(listener)
      },
    })
  }

  const submitCommand = (
    sessionId: string,
    playerId: string,
    rawCommand: unknown,
  ): HgssCampaignServerCommandResult => {
    const session = sessions.get(sessionId)
    if (!session) return missingSession(sessionId)
    if (session.evaluatingPort) return failure({
      code: 'session-mutation-in-progress',
      message: `La session de campagne ${sessionId} évalue déjà une commande autoritaire.`,
      sessionId,
      playerId,
    })
    const parsedCommand = parseHgssCampaignClientCommand(rawCommand)
    if (!parsedCommand) return failure({
      code: 'invalid-command',
      message: 'La commande de campagne ne respecte pas le protocole.',
      sessionId,
      playerId,
    })
    const command = deepFreeze(parsedCommand)
    const player = session.snapshot.players.find((entry) => entry.playerId === playerId)
    if (!player) return failure({
      code: 'player-not-found',
      message: `Le joueur ${playerId} ne fait pas partie de la campagne.`,
      sessionId,
      playerId,
      commandId: command.commandId,
      commandKind: command.kind,
    })
    const fingerprint = JSON.stringify(command)
    const playerCache = session.commandCache.get(playerId)
    const cached = playerCache?.get(command.commandId)
    if (cached) {
      if (cached.fingerprint !== fingerprint) return failure({
        code: 'command-id-conflict',
        message: `La commande ${command.commandId} a déjà été utilisée avec un autre contenu.`,
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
      })
      return deepFreeze({
        ok: true,
        kind: 'replayed',
        commandId: command.commandId,
        appliedRevision: cached.appliedRevision,
        snapshot: session.snapshot,
      })
    }
    if (command.expectedRevision !== session.snapshot.revision) return failure({
      code: 'revision-conflict',
      message: `La commande attend la révision ${command.expectedRevision}, mais le serveur est à ${session.snapshot.revision}.`,
      sessionId,
      playerId,
      commandId: command.commandId,
      commandKind: command.kind,
      expectedRevision: session.snapshot.revision,
      receivedRevision: command.expectedRevision,
    })

    let next: HgssCampaignServerSnapshot | undefined
    if (command.kind === 'shared-event') return failure({
      code: 'unsupported-command',
      message: "Le fallback local ne simule pas l'agrégat de progression du serveur.",
      sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
    })

    if (command.kind === 'movement') {
      if (player.state !== 'active' || session.snapshot.battle && session.snapshot.battle.phase !== 'ended') return failure({
        code: 'movement-state-conflict',
        message: `Le joueur ${playerId} ne peut pas se déplacer dans son état autoritaire actuel.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      if (player.movementSequence === Number.MAX_SAFE_INTEGER) return failure({
        code: 'movement-sequence-exhausted',
        message: `La séquence de déplacement de ${playerId} ne peut plus être incrémentée.`,
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
      })
      const expectedSequence = player.movementSequence + 1
      if (command.sequence !== expectedSequence) return failure({
        code: 'movement-sequence-conflict',
        message: `Le déplacement attend la séquence ${expectedSequence}, mais a reçu ${command.sequence}.`,
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
        expectedSequence,
        receivedSequence: command.sequence,
      })
      if (!samePosition(player.position, command.from)) return failure({
        code: 'movement-origin-conflict',
        message: "L'origine du déplacement ne correspond pas à la position autoritaire.",
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
        expectedFrom: player.position,
        receivedFrom: command.from,
      })
      if (!isSingleCardinalStep(command.from, command.to)) return failure({
        code: 'movement-step-conflict',
        message: 'Le déplacement doit être un unique pas cardinal cohérent avec sa direction.',
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      const blockingPlayer = session.snapshot.players.find((entry) => (
        entry.playerId !== playerId && occupiesSameTile(entry.position, command.to)
      ))
      if (blockingPlayer) return failure({
        code: 'movement-destination-occupied',
        message: `La destination du déplacement est occupée par ${blockingPlayer.playerId}.`,
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
        blockingPlayerId: blockingPlayer.playerId,
      })
      if (!ports.movement) return failure({
        code: 'unsupported-command',
        message: "Aucun port autoritaire de déplacement n'est branché.",
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      let decision: unknown
      session.evaluatingPort = true
      try {
        decision = ports.movement({ sessionId, playerId, command, snapshot: session.snapshot })
      } catch {
        return failure({
          code: 'port-failed',
          message: `Le port autoritaire a échoué pour la commande ${command.commandId}.`,
          sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
        })
      } finally {
        session.evaluatingPort = false
      }
      if (!isPlainDataRecord(decision) || decision.kind !== 'accept' && decision.kind !== 'reject') return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé un résultat invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      if (decision.kind === 'reject') {
        if (!hasOnlyKeys(decision, ['kind', 'code', 'message'])) return failure({
          code: 'port-invalid-result',
          message: `Le port autoritaire a renvoyé un refus invalide pour ${command.commandId}.`,
          sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
        })
        const portCode = decision.code
        const message = decision.message
        if (typeof portCode !== 'string' || portCode.length === 0 || typeof message !== 'string' || message.length === 0) {
          return failure({
            code: 'port-invalid-result',
            message: `Le port autoritaire a renvoyé un refus invalide pour ${command.commandId}.`,
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
        }
        return failure({
          code: 'port-rejected',
          message,
          sessionId,
          playerId,
          commandId: command.commandId,
          commandKind: command.kind,
          portCode,
        })
      }
      if (!hasOnlyKeys(decision, ['kind', 'authoritativePosition'])) return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé une acceptation invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      const hasAuthoritativePosition = Object.hasOwn(decision, 'authoritativePosition')
      const authoritativePosition = hasAuthoritativePosition
        ? materializePlayer({ ...player, position: decision.authoritativePosition as HgssCampaignPlayerSnapshot['position'] })?.position
        : undefined
      if (hasAuthoritativePosition && !authoritativePosition) return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé une arrivée invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      if (Boolean(command.arrival) !== Boolean(authoritativePosition)
        || command.arrival && authoritativePosition && !samePosition(command.arrival, authoritativePosition)) {
        return failure({
          code: 'movement-arrival-conflict',
          message: "L'arrivée annoncée ne correspond pas à l'attestation du monde autoritaire.",
          sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
        })
      }
      const finalPosition = command.arrival ?? command.to
      const arrivalBlockingPlayer = command.arrival && session.snapshot.players.find((entry) => (
        entry.playerId !== playerId && occupiesSameTile(entry.position, finalPosition)
      ))
      if (arrivalBlockingPlayer) return failure({
        code: 'movement-destination-occupied',
        message: `L'arrivée du déplacement est occupée par ${arrivalBlockingPlayer.playerId}.`,
        sessionId,
        playerId,
        commandId: command.commandId,
        commandKind: command.kind,
        blockingPlayerId: arrivalBlockingPlayer.playerId,
      })
      next = buildNextSnapshot(session.snapshot, {
        players: session.snapshot.players.map((entry) => entry.playerId === playerId ? {
          ...entry,
          position: finalPosition,
          movementSequence: command.sequence,
        } : entry),
      })
    } else {
      let decision: unknown
      session.evaluatingPort = true
      try {
        if (command.kind === 'interaction') {
          if (!ports.interaction) return failure({
            code: 'unsupported-command',
            message: "Aucun port autoritaire d'interaction n'est branché.",
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
          decision = ports.interaction({ sessionId, playerId, command, snapshot: session.snapshot })
        } else if (command.kind === 'double-battle-action') {
          const battle = session.snapshot.battle
          const actor = battle?.participants.find((participant) => sameBattlePosition(participant.position, command.action.actor))
          const actorPending = battle?.pendingCommandActors.some((pending) => sameBattlePosition(pending, command.action.actor))
          const phaseAllowsAction = battle?.phase === 'command'
            || battle?.phase === 'replacement' && command.action.kind === 'switch'
          if (!battle || battle.battleId !== command.battleId || battle.turn !== command.turn || !phaseAllowsAction) return failure({
            code: 'battle-state-conflict',
            message: `Le combat ${command.battleId} n'est pas dans l'état autoritaire attendu.`,
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
          if (!actorPending || actor?.controllerPlayerId !== playerId) return failure({
            code: 'battle-control-conflict',
            message: `Le joueur ${playerId} ne contrôle pas cet acteur de combat en attente.`,
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
          if (!ports.doubleBattleAction) return failure({
            code: 'unsupported-command',
            message: "Aucun port autoritaire de combat double n'est branché.",
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
          decision = ports.doubleBattleAction({ sessionId, playerId, command, snapshot: session.snapshot })
        } else {
          if (!ports.eventAcknowledgement) return failure({
            code: 'unsupported-command',
            message: "Aucun port autoritaire d'acquittement d'événement n'est branché.",
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
          decision = ports.eventAcknowledgement({ sessionId, playerId, command, snapshot: session.snapshot })
        }
      } catch {
        return failure({
          code: 'port-failed',
          message: `Le port autoritaire a échoué pour la commande ${command.commandId}.`,
          sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
        })
      } finally {
        session.evaluatingPort = false
      }
      if (!isPlainDataRecord(decision) || decision.kind !== 'accept' && decision.kind !== 'reject') return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé un résultat invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      if (decision.kind === 'reject') {
        if (!hasOnlyKeys(decision, ['kind', 'code', 'message'])) return failure({
          code: 'port-invalid-result',
          message: `Le port autoritaire a renvoyé un refus invalide pour ${command.commandId}.`,
          sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
        })
        const portCode = decision.code
        const message = decision.message
        if (typeof portCode !== 'string' || portCode.length === 0 || typeof message !== 'string' || message.length === 0) {
          return failure({
            code: 'port-invalid-result',
            message: `Le port autoritaire a renvoyé un refus invalide pour ${command.commandId}.`,
            sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
          })
        }
        return failure({
          code: 'port-rejected',
          message,
          sessionId,
          playerId,
          commandId: command.commandId,
          commandKind: command.kind,
          portCode,
        })
      }
      if (!hasOnlyKeys(decision, ['kind', 'patch'])) return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé une acceptation invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      const rawPatch = decision.patch
      const patch = rawPatch === undefined ? {} : portPatch(rawPatch)
      if (!patch) return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a renvoyé un patch invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
      next = buildNextSnapshot(session.snapshot, patch)
      if (next && !samePlayerIds(session.snapshot.players, next.players)) next = undefined
      if (!next) return failure({
        code: 'port-invalid-result',
        message: `Le port autoritaire a produit un état invalide pour ${command.commandId}.`,
        sessionId, playerId, commandId: command.commandId, commandKind: command.kind,
      })
    }

    if (!next) return failure({
      code: 'revision-exhausted',
      message: 'La révision de la campagne ne peut plus être incrémentée.',
      sessionId,
      playerId,
      commandId: command.commandId,
      commandKind: command.kind,
    })
    session.snapshot = next
    const cache = playerCache ?? new Map<string, CachedCommand>()
    if (!playerCache) session.commandCache.set(playerId, cache)
    cache.set(command.commandId, { fingerprint, appliedRevision: next.revision })
    while (cache.size > hgssCampaignServerCommandCacheLimit) cache.delete(cache.keys().next().value!)
    publish(session, next)
    return deepFreeze({
      ok: true,
      kind: 'applied',
      commandId: command.commandId,
      appliedRevision: next.revision,
      snapshot: next,
    })
  }

  return {
    createSession,
    joinSession,
    leaveSession,
    destroySession,
    getSnapshot,
    subscribe,
    submitCommand,
  }
}
