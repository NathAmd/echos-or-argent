import {
  hgssCampaignProtocolVersion,
  parseHgssCampaignClientCommand,
  parseHgssCampaignServerSnapshot,
  type HgssCampaignClientCommand,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import { arbitrateHgssCampaignSnapshotRevision } from './hgssCampaignRevision'

export type HgssCampaignClientConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'resyncing'
  | 'disconnected'
  | 'failed'

export type HgssCampaignClientState = Readonly<{
  status: HgssCampaignClientConnectionStatus
  snapshot?: HgssCampaignServerSnapshot
  error?: Error
}>

export type HgssCampaignClientTransportHandlers = Readonly<{
  onSnapshot: (snapshot: unknown) => void
  onDisconnect: () => void
  onError: (error: unknown) => void
}>

export type HgssCampaignClientTransportKind =
  | 'authoritative-websocket'
  | 'rtc-data-channel'
  | 'in-memory-test'

/**
 * Frontière de transport de la campagne. Le navigateur publié emploie le
 * WebSocket autoritaire du serveur ; RTC garde la compatibilité des anciennes
 * sessions pair-à-pair et `in-memory-test` les tests unitaires sans réseau.
 */
export type HgssCampaignClientTransport = Readonly<{
  transportKind: HgssCampaignClientTransportKind
  connect: (handlers: HgssCampaignClientTransportHandlers) => void | Promise<void>
  disconnect: () => void | Promise<void>
  // Un adaptateur qui réessaie un envoi incertain doit conserver exactement
  // cette commande et son commandId afin que l'autorité hôte puisse l'idempotenter.
  send: (command: HgssCampaignClientCommand) => unknown | Promise<unknown>
  requestSnapshot: () => unknown | Promise<unknown>
  /** Invité RTC uniquement : confirme que son snapshot initial est appliqué localement. */
  confirmReady?: () => void | Promise<void>
}>

export type HgssCampaignCommandAcknowledgement = Readonly<{
  appliedRevision: number
  replayed: boolean
  snapshot: HgssCampaignServerSnapshot
}>

type CommandEnvelopeKeys = 'protocolVersion' | 'commandId' | 'expectedRevision'

export type HgssCampaignCommandIntent = HgssCampaignClientCommand extends infer Command
  ? Command extends HgssCampaignClientCommand
    ? Omit<Command, CommandEnvelopeKeys>
    : never
  : never

export type HgssCampaignClientGateway = Readonly<{
  getState: () => HgssCampaignClientState
  connect: () => Promise<void>
  disconnect: () => Promise<void>
  send: (intent: HgssCampaignCommandIntent) => Promise<HgssCampaignClientCommand>
  subscribe: (listener: (state: HgssCampaignClientState) => void) => () => void
}>

export type HgssCampaignClientGatewayOptions = Readonly<{
  transport: HgssCampaignClientTransport
  /** Identité autorisée par le transport, requise pour prouver un `event-ack`. */
  localParticipantId: string
  commandIdFactory?: (serial: number) => string
  /**
   * Frontière applicative du premier snapshot. Pour un invité RTC, elle est
   * terminée avant l'envoi de `ready` à l'hôte et avant toute publication
   * `connected` : l'acquittement atteste donc une application réelle.
   */
  applyInitialSnapshot?: (snapshot: HgssCampaignServerSnapshot) => void | Promise<void>
}>

type HgssCampaignResynchronization = Readonly<{
  generation: number
  minimumObservedRevision: number
  candidate: HgssCampaignServerSnapshot
}>

const rememberedCommandIdLimit = 256

let fallbackGatewayId = 0

function createGatewayId(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  fallbackGatewayId += 1
  return `${Date.now().toString(36)}-${fallbackGatewayId.toString(36)}`
}

function toError(value: unknown, fallbackMessage: string): Error {
  return value instanceof Error ? value : new Error(fallbackMessage)
}

function freezeProtocolValue<Value>(value: Value): Value {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value
  for (const nestedValue of Object.values(value)) freezeProtocolValue(nestedValue)
  return Object.freeze(value)
}

function parseCommandAcknowledgement(value: unknown): HgssCampaignCommandAcknowledgement | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => typeof key !== 'string'
    || Object.getOwnPropertyDescriptor(value, key)?.enumerable !== true)) return undefined
  if (Object.keys(record).length !== 3
    || !Object.hasOwn(record, 'appliedRevision')
    || !Object.hasOwn(record, 'replayed')
    || !Object.hasOwn(record, 'snapshot')) {
    return undefined
  }
  const parsed = parseHgssCampaignServerSnapshot(record.snapshot)
  if (!parsed || !Number.isSafeInteger(record.appliedRevision)
    || (record.appliedRevision as number) < 0
    || (record.appliedRevision as number) > parsed.revision
    || typeof record.replayed !== 'boolean') return undefined
  return freezeProtocolValue({
    appliedRevision: record.appliedRevision as number,
    replayed: record.replayed,
    snapshot: parsed,
  })
}

const recoverableCommandFailureCodes = new Set([
  'revision-conflict',
  'session-mutation-in-progress',
  'movement-state-conflict',
  'movement-sequence-conflict',
  'movement-origin-conflict',
  'movement-arrival-conflict',
  'movement-step-conflict',
  'movement-destination-occupied',
  'event-already-committed',
  'event-already-pending',
  'event-already-acknowledged',
  'event-capacity-reached',
  'event-not-pending',
  'event-revision-conflict',
  'event-state-conflict',
  'progression-capacity-reached',
  'progression-counter-conflict',
  'port-rejected',
  'port-failed',
  'transition-unattested',
  'unsupported-command',
])

const uncertainCommandFailureCodes = new Set([
  'command-outcome-uncertain',
  'request-timeout',
  'peer-request-timeout',
])

function commandFailureCode(value: unknown): string | undefined {
  const code = value !== null && typeof value === 'object' ? Reflect.get(value, 'code') : undefined
  return typeof code === 'string' ? code : undefined
}

function isSamePosition(
  first: Readonly<{ mapId: number, x: number, z: number, direction: string }>,
  second: Readonly<{ mapId: number, x: number, z: number, direction: string }>,
): boolean {
  return first.mapId === second.mapId
    && first.x === second.x
    && first.z === second.z
    && first.direction === second.direction
}

/**
 * Prouve l'effet final d'une commande dont l'ACK a pu être perdu. Cette
 * fonction n'infère jamais une réussite à partir de la seule révision.
 */
function commandEffectIsPresent(
  command: HgssCampaignClientCommand,
  authoritativeSnapshot: HgssCampaignServerSnapshot,
  localParticipantId: string,
): boolean {
  if (command.kind === 'movement') {
    const player = authoritativeSnapshot.players.find(({ playerId }) => playerId === localParticipantId)
    return player?.movementSequence === command.sequence
      && isSamePosition(player.position, command.arrival ?? command.to)
  }
  if (command.kind === 'shared-event') {
    const milestones = new Set(authoritativeSnapshot.sharedProgression.milestoneIds)
    if (!milestones.has(command.eventId)
      || command.milestoneIds.some((milestoneId) => !milestones.has(milestoneId))) return false
    return command.counters.every((mutation) => (
      authoritativeSnapshot.sharedProgression.counters
        .find(({ id }) => id === mutation.id)?.value === mutation.value
    ))
  }
  if (command.kind === 'event-ack') {
    const pending = authoritativeSnapshot.pendingEvents.find(({ eventId }) => eventId === command.eventId)
    return pending === undefined
      ? authoritativeSnapshot.sharedProgression.milestoneIds.includes(command.eventId)
      : pending.eventRevision === command.eventRevision
        && !pending.pendingPlayerIds.includes(localParticipantId)
  }
  return false
}

/**
 * Projection cliente stricte d'une campagne HGSS. Elle ne simule jamais une
 * autorité absente : sans snapshot autoritaire, aucune commande ne peut partir.
 */
export function createHgssCampaignClientGateway(
  options: HgssCampaignClientGatewayOptions,
): HgssCampaignClientGateway {
  const { transport } = options
  if (
    transport?.transportKind !== 'authoritative-websocket'
    && transport?.transportKind !== 'rtc-data-channel'
    && transport?.transportKind !== 'in-memory-test'
  ) {
    throw new TypeError('La campagne HGSS exige un transport autoritaire reconnu.')
  }
  if (typeof options.localParticipantId !== 'string'
    || options.localParticipantId.length > 128
    || !/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/.test(options.localParticipantId)) {
    throw new TypeError("L'identité locale de la campagne HGSS est invalide.")
  }
  const localParticipantId = options.localParticipantId
  const gatewayId = createGatewayId()
  const commandIdFactory = options.commandIdFactory
    ?? ((serial: number) => `campaign-command:${gatewayId}:${serial}`)
  const listeners = new Set<(state: HgssCampaignClientState) => void>()
  const rememberedCommandIds = new Set<string>()
  const rememberedCommandIdOrder: string[] = []
  let state: HgssCampaignClientState = Object.freeze({ status: 'idle' })
  let snapshot: HgssCampaignServerSnapshot | undefined
  let connectionGeneration = 0
  let commandSerial = 0
  let connectOperation: Promise<void> | undefined
  let resyncOperation: Promise<void> | undefined
  let resynchronization: HgssCampaignResynchronization | undefined
  let commandInFlight = false
  const readState = (): HgssCampaignClientState => state
  const readSnapshot = (): HgssCampaignServerSnapshot | undefined => snapshot

  const publish = (status: HgssCampaignClientConnectionStatus, error?: Error): void => {
    state = Object.freeze({
      status,
      ...(snapshot ? { snapshot } : {}),
      ...(error ? { error } : {}),
    })
    for (const listener of listeners) {
      try {
        listener(state)
      } catch (listenerError) {
        void listenerError
      }
    }
  }

  const fail = (error: unknown, fallbackMessage: string): Error => {
    const failure = toError(error, fallbackMessage)
    resynchronization = undefined
    resyncOperation = undefined
    connectOperation = undefined
    publish('failed', failure)
    return failure
  }

  const parseSnapshot = (value: unknown): HgssCampaignServerSnapshot => {
    const parsed = parseHgssCampaignServerSnapshot(value)
    if (!parsed) throw new Error('Snapshot de campagne HGSS invalide.')
    return freezeProtocolValue(parsed)
  }

  const assertSameSession = (incoming: HgssCampaignServerSnapshot): void => {
    if (snapshot && incoming.sessionId !== snapshot.sessionId) {
      throw new Error(`Session de campagne HGSS inattendue : ${incoming.sessionId}.`)
    }
    if (!incoming.players.some(({ playerId }) => playerId === localParticipantId)) {
      throw new Error(`Le joueur local ${localParticipantId} est absent du snapshot de campagne HGSS.`)
    }
  }

  const applyAuthoritativeSnapshot = (incoming: HgssCampaignServerSnapshot): void => {
    assertSameSession(incoming)
    if (snapshot && incoming.revision < snapshot.revision) {
      throw new Error(`Snapshot de resynchronisation HGSS périmé (${incoming.revision} < ${snapshot.revision}).`)
    }
    snapshot = incoming
    publish('connected')
  }

  const retainResynchronizationCandidate = (
    incoming: HgssCampaignServerSnapshot,
    generation: number,
  ): void => {
    const current = resynchronization
    if (!current || current.generation !== generation) return
    resynchronization = {
      generation,
      minimumObservedRevision: Math.max(current.minimumObservedRevision, incoming.revision),
      candidate: incoming.revision > current.candidate.revision ? incoming : current.candidate,
    }
  }

  const requestResynchronization = (
    generation: number,
    gapSnapshot: HgssCampaignServerSnapshot,
  ): void => {
    if (resyncOperation || generation !== connectionGeneration) return
    resynchronization = {
      generation,
      minimumObservedRevision: gapSnapshot.revision,
      candidate: gapSnapshot,
    }
    publish('resyncing')
    const operation = (async (): Promise<void> => {
      try {
        const received = await transport.requestSnapshot()
        if (generation !== connectionGeneration || state.status !== 'resyncing') return
        const incoming = parseSnapshot(received)
        assertSameSession(incoming)
        retainResynchronizationCandidate(incoming, generation)
        const completed = resynchronization
        if (!completed || completed.generation !== generation) return
        if (completed.candidate.revision < completed.minimumObservedRevision) {
          throw new Error(
            `Resynchronisation HGSS insuffisante : révision ${completed.candidate.revision}, minimum ${completed.minimumObservedRevision}.`,
          )
        }
        resynchronization = undefined
        resyncOperation = undefined
        applyAuthoritativeSnapshot(completed.candidate)
      } catch (error) {
        if (generation === connectionGeneration && state.status === 'resyncing') {
          fail(error, 'La resynchronisation de la campagne HGSS a échoué.')
        }
      }
    })()
    resyncOperation = operation
    void operation.then(
      () => { if (resyncOperation === operation) resyncOperation = undefined },
      () => { if (resyncOperation === operation) resyncOperation = undefined },
    )
  }

  const receiveSnapshot = (value: unknown, generation: number): void => {
    if (generation !== connectionGeneration) return
    if (state.status === 'idle' || state.status === 'disconnected' || state.status === 'failed') return
    let incoming: HgssCampaignServerSnapshot
    try {
      incoming = parseSnapshot(value)
      assertSameSession(incoming)
    } catch (error) {
      fail(error, "L'autorité hôte a envoyé un snapshot de campagne HGSS invalide.")
      return
    }
    if (state.status === 'resyncing') {
      retainResynchronizationCandidate(incoming, generation)
      return
    }
    if (state.status === 'connecting') {
      if (!snapshot || incoming.revision > snapshot.revision) {
        snapshot = incoming
        publish('connecting')
      }
      return
    }
    const decision = arbitrateHgssCampaignSnapshotRevision(snapshot?.revision, incoming.revision)
    if (decision.kind === 'ignore') return
    if (decision.kind === 'gap') {
      requestResynchronization(generation, incoming)
      return
    }
    snapshot = incoming
    publish('connected')
  }

  const connect = (): Promise<void> => {
    if (state.status === 'connected' || state.status === 'resyncing') return Promise.resolve()
    if (connectOperation) return connectOperation
    const operation = (async (): Promise<void> => {
      snapshot = undefined
      resynchronization = undefined
      resyncOperation = undefined
      const generation = connectionGeneration + 1
      connectionGeneration = generation
      publish('connecting')
      try {
        await transport.connect({
          onSnapshot: (value) => receiveSnapshot(value, generation),
          onDisconnect: () => {
            if (generation !== connectionGeneration) return
            connectionGeneration += 1
            snapshot = undefined
            resynchronization = undefined
            resyncOperation = undefined
            connectOperation = undefined
            publish('disconnected')
          },
          onError: (error) => {
            if (generation === connectionGeneration) {
              fail(error, 'La connexion à la campagne HGSS a échoué.')
            }
          },
        })
        if (generation !== connectionGeneration) return
        if (readState().status === 'failed') throw readState().error ?? new Error('La connexion à la campagne HGSS a échoué.')
        const received = await transport.requestSnapshot()
        if (generation !== connectionGeneration) return
        if (readState().status === 'failed') throw readState().error ?? new Error('La connexion à la campagne HGSS a échoué.')
        const initialSnapshot = parseSnapshot(received)
        assertSameSession(initialSnapshot)
        const pushedSnapshot = readSnapshot()
        if (!pushedSnapshot || initialSnapshot.revision >= pushedSnapshot.revision) snapshot = initialSnapshot
        const authoritativeInitialSnapshot = readSnapshot()
        if (!authoritativeInitialSnapshot) throw new Error('Snapshot initial de campagne HGSS absent.')
        await options.applyInitialSnapshot?.(authoritativeInitialSnapshot)
        if (generation !== connectionGeneration) return
        if (readState().status === 'failed') throw readState().error ?? new Error('La connexion à la campagne HGSS a échoué.')
        await transport.confirmReady?.()
        if (generation !== connectionGeneration) return
        publish('connected')
      } catch (error) {
        if (generation !== connectionGeneration) return
        if (state.status !== 'failed') {
          fail(error, 'La connexion à la campagne HGSS a échoué.')
        }
        throw toError(error, 'La connexion à la campagne HGSS a échoué.')
      }
    })()
    connectOperation = operation
    void operation.then(
      () => { if (connectOperation === operation) connectOperation = undefined },
      () => { if (connectOperation === operation) connectOperation = undefined },
    )
    return operation
  }

  const disconnect = async (): Promise<void> => {
    connectionGeneration += 1
    snapshot = undefined
    resynchronization = undefined
    resyncOperation = undefined
    connectOperation = undefined
    publish('disconnected')
    try {
      await transport.disconnect()
    } catch (error) {
      throw fail(error, 'La déconnexion de la campagne HGSS a échoué.')
    }
  }

  const resynchronizeRejectedCommand = async (generation: number): Promise<void> => {
    if (resyncOperation) await resyncOperation
    if (generation !== connectionGeneration) return
    if (state.status === 'failed') throw state.error ?? new Error('La resynchronisation de campagne HGSS a échoué.')
    publish('resyncing')
    try {
      const received = await transport.requestSnapshot()
      if (generation !== connectionGeneration) return
      const incoming = parseSnapshot(received)
      assertSameSession(incoming)
      applyAuthoritativeSnapshot(incoming)
    } catch (error) {
      if (generation === connectionGeneration) {
        throw fail(error, 'La resynchronisation après refus de commande HGSS a échoué.')
      }
    }
  }

  const send = async (intent: HgssCampaignCommandIntent): Promise<HgssCampaignClientCommand> => {
    if (state.status !== 'connected' || !snapshot) {
      throw new Error("La campagne HGSS n'est pas synchronisée avec son autorité hôte.")
    }
    if (commandInFlight) throw new Error('command-in-flight: une commande de campagne HGSS est déjà en cours.')
    commandInFlight = true
    try {
      commandSerial += 1
      let command: HgssCampaignClientCommand
      try {
        const commandId = commandIdFactory(commandSerial)
        if (rememberedCommandIds.has(commandId)) throw new Error(`Identifiant de commande HGSS dupliqué : ${commandId}.`)
        const parsed = parseHgssCampaignClientCommand({
          ...intent,
          protocolVersion: hgssCampaignProtocolVersion,
          commandId,
          expectedRevision: snapshot.revision,
        })
        if (!parsed) throw new Error('Commande de campagne HGSS invalide.')
        command = freezeProtocolValue(parsed)
        rememberedCommandIds.add(command.commandId)
        rememberedCommandIdOrder.push(command.commandId)
        if (rememberedCommandIdOrder.length > rememberedCommandIdLimit) {
          rememberedCommandIds.delete(rememberedCommandIdOrder.shift()!)
        }
      } catch (error) {
        throw toError(error, 'La commande de campagne HGSS est invalide.')
      }
      try {
        const acknowledgement = parseCommandAcknowledgement(await transport.send(command))
        if (!acknowledgement
          || !acknowledgement.replayed && acknowledgement.appliedRevision <= command.expectedRevision) {
          throw new Error("L'autorité n'a pas acquitté la commande de campagne avec un snapshot valide.")
        }
        assertSameSession(acknowledgement.snapshot)
        if (!snapshot || acknowledgement.snapshot.revision >= snapshot.revision) {
          applyAuthoritativeSnapshot(acknowledgement.snapshot)
        } else if (acknowledgement.appliedRevision > snapshot.revision) {
          throw new Error("L'acquittement de commande dépasse le snapshot autoritaire courant.")
        }
        if (acknowledgement.replayed
          && (!snapshot || !commandEffectIsPresent(command, snapshot, localParticipantId))) {
          throw new Error("Le snapshot autoritaire ne prouve pas l'effet de la commande rejouée côté serveur.")
        }
        return command
      } catch (error) {
        const code = commandFailureCode(error)
        if (code && uncertainCommandFailureCodes.has(code)) {
          await resynchronizeRejectedCommand(connectionGeneration)
          if (snapshot && commandEffectIsPresent(command, snapshot, localParticipantId)) return command
          throw fail(error, "L'issue de la commande de campagne HGSS reste ambiguë après resynchronisation.")
        }
        if (code && recoverableCommandFailureCodes.has(code)) {
          await resynchronizeRejectedCommand(connectionGeneration)
          throw toError(error, 'La commande de campagne HGSS a été refusée.')
        }
        throw fail(error, "L'envoi de la commande de campagne HGSS a échoué.")
      }
    } finally {
      commandInFlight = false
    }
  }

  return {
    getState: () => state,
    connect,
    disconnect,
    send,
    subscribe(listener) {
      listeners.add(listener)
      try {
        listener(state)
      } catch (listenerError) {
        void listenerError
      }
      return () => { listeners.delete(listener) }
    },
  }
}
