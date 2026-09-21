import {
  measurePeerDataMessageBytes,
  PeerDataChannelError,
  type PeerDataChannel,
  type PeerDataChannelBackpressure,
  type PeerDataChannelHandlers,
  type PeerDataChannelState,
  type PeerDataChannelWriteState,
} from './peerDataChannel'

export const peerDataChannelMultiplexerProtocol = 'pokemaster-peer-mux' as const
export const peerDataChannelMultiplexerProtocolVersion = 1 as const

export type PeerDataChannelMultiplexerOptions = Readonly<{
  channelIds: readonly string[]
  maximumPendingMessagesPerChannel?: number
  maximumPendingBytesPerChannel?: number
}>

export type PeerDataChannelMultiplexer = Readonly<{
  getChannel: (channelId: string) => PeerDataChannel
  /** Émet une preuve opaque liant exactement un canal logique à ce mux. */
  issueChannelBinding: (channelId: string) => PeerDataChannelMultiplexerChannelBinding
  close: () => void
}>

export type PeerDataChannelMultiplexerChannelBinding = Readonly<{
  channel: PeerDataChannel
  channelId: string
}>

type MultiplexedFrame = Readonly<{
  protocol: typeof peerDataChannelMultiplexerProtocol
  protocolVersion: typeof peerDataChannelMultiplexerProtocolVersion
  channel: string
}> & (
  | Readonly<{ kind: 'data', payload: string }>
  | Readonly<{ kind: 'close' }>
)

type PendingMessage = Readonly<{ payload: string, bytes: number }>

type LogicalChannel = {
  readonly id: string
  readonly pending: PendingMessage[]
  pendingBytes: number
  handlers?: PeerDataChannelHandlers
  attached: boolean
  localClosed: boolean
  remoteClosed: boolean
  openNotified: boolean
  closeNotified: boolean
  errorNotified: boolean
}

const channelIdPattern = /^[a-z][a-z0-9-]{0,31}$/
const maximumLogicalChannels = 16
const maximumPendingMessagesHardLimit = 256
const maximumPendingBytesHardLimit = 4 * 1_024 * 1_024
const issuedChannelBindings = new WeakSet<object>()
const consumedChannelBindings = new WeakSet<object>()

/** Consommation interne à une frontière d'autorité; les copies structurelles sont refusées. */
export function consumeIssuedPeerDataChannelMultiplexerBinding(
  value: unknown,
  expectedChannelId: string,
): value is PeerDataChannelMultiplexerChannelBinding {
  if (value === null || typeof value !== 'object'
    || !issuedChannelBindings.has(value)
    || consumedChannelBindings.has(value)
    || Reflect.get(value, 'channelId') !== expectedChannelId
    || !Reflect.get(value, 'channel')) return false
  consumedChannelBindings.add(value)
  return true
}

function requirePositiveLimit(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} doit être un entier compris entre 1 et ${maximum}.`)
  }
  return value
}

function exactRecord(value: unknown): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const prototype = Object.getPrototypeOf(value)
  if (prototype !== Object.prototype && prototype !== null) return undefined
  if (Reflect.ownKeys(value).some((key) => {
    if (typeof key !== 'string') return true
    const descriptor = Object.getOwnPropertyDescriptor(value, key)
    return descriptor?.enumerable !== true || !('value' in descriptor)
  })) return undefined
  return value as Record<string, unknown>
}

function hasExactKeys(record: Record<string, unknown>, keys: readonly string[]): boolean {
  const expected = new Set(keys)
  return keys.every((key) => Object.hasOwn(record, key))
    && Object.keys(record).every((key) => expected.has(key))
}

function parseFrame(value: unknown, allowedChannels: ReadonlySet<string>): MultiplexedFrame | undefined {
  const record = exactRecord(value)
  if (!record
    || record.protocol !== peerDataChannelMultiplexerProtocol
    || record.protocolVersion !== peerDataChannelMultiplexerProtocolVersion
    || typeof record.channel !== 'string'
    || !allowedChannels.has(record.channel)) return undefined
  if (record.kind === 'close') {
    return hasExactKeys(record, ['protocol', 'protocolVersion', 'channel', 'kind'])
      ? Object.freeze({
        protocol: peerDataChannelMultiplexerProtocol,
        protocolVersion: peerDataChannelMultiplexerProtocolVersion,
        channel: record.channel,
        kind: 'close' as const,
      })
      : undefined
  }
  if (record.kind !== 'data' || typeof record.payload !== 'string'
    || !hasExactKeys(record, ['protocol', 'protocolVersion', 'channel', 'kind', 'payload'])) return undefined
  return Object.freeze({
    protocol: peerDataChannelMultiplexerProtocol,
    protocolVersion: peerDataChannelMultiplexerProtocolVersion,
    channel: record.channel,
    kind: 'data' as const,
    payload: record.payload,
  })
}

function encodeFrame(frame: MultiplexedFrame): string {
  return JSON.stringify(frame)
}

function multiplexError(code: ConstructorParameters<typeof PeerDataChannelError>[0], message: string): PeerDataChannelError {
  return new PeerDataChannelError(code, message)
}

/**
 * Partage l'unique RTCDataChannel fiable entre des protocoles applicatifs
 * indépendants. Le multiplexeur ne comprend jamais leur payload : il impose
 * seulement une route machine fermée et une borne d'attente par route.
 */
export function createPeerDataChannelMultiplexer(
  physical: PeerDataChannel,
  options: PeerDataChannelMultiplexerOptions,
): PeerDataChannelMultiplexer {
  if (!physical || typeof physical.attach !== 'function' || typeof physical.send !== 'function'
    || typeof physical.close !== 'function' || typeof physical.getState !== 'function') {
    throw new TypeError('Le multiplexeur exige un PeerDataChannel valide.')
  }
  const ids = [...options.channelIds]
  if (ids.length < 1 || ids.length > maximumLogicalChannels
    || new Set(ids).size !== ids.length
    || ids.some((id) => !channelIdPattern.test(id))) {
    throw new TypeError('La liste des canaux logiques pair-à-pair est invalide.')
  }
  const maximumPendingMessages = requirePositiveLimit(
    options.maximumPendingMessagesPerChannel ?? 32,
    maximumPendingMessagesHardLimit,
    'La limite de messages logiques en attente',
  )
  const maximumPendingBytes = requirePositiveLimit(
    options.maximumPendingBytesPerChannel ?? 512 * 1_024,
    maximumPendingBytesHardLimit,
    'La limite d’octets logiques en attente',
  )
  const allowedChannels = new Set(ids)
  const records = new Map(ids.map((id): [string, LogicalChannel] => [id, {
    id,
    pending: [],
    pendingBytes: 0,
    attached: false,
    localClosed: false,
    remoteClosed: false,
    openNotified: false,
    closeNotified: false,
    errorNotified: false,
  }]))
  const logicalChannels = new Map<string, PeerDataChannel>()
  const channelBindings = new Map<string, PeerDataChannelMultiplexerChannelBinding>()
  const backpressureListeners = new Set<(state: PeerDataChannelWriteState) => void>()
  let detachPhysical: (() => void) | undefined
  let detachBackpressure: (() => void) | undefined
  let physicalOpen = physical.getState() === 'open'
  let terminal = physical.getState() === 'closed'
  let terminalError: unknown

  const stateOf = (record: LogicalChannel): PeerDataChannelState => {
    if (terminal || record.localClosed || record.remoteClosed) return 'closed'
    const physicalState = physical.getState()
    return physicalState === 'closing' ? 'closing' : physicalState
  }
  const notifyOpen = (record: LogicalChannel): void => {
    if (!record.attached || record.openNotified || !physicalOpen || terminal
      || record.localClosed || record.remoteClosed) return
    record.openNotified = true
    record.handlers!.onOpen()
    while (record.pending.length > 0 && !terminal && !record.localClosed && !record.remoteClosed) {
      const pending = record.pending.shift()!
      record.pendingBytes -= pending.bytes
      record.handlers!.onMessage(pending.payload)
    }
  }
  const notifyClose = (record: LogicalChannel): void => {
    if (!record.attached || record.closeNotified || (!terminal && !record.localClosed && !record.remoteClosed)) return
    record.closeNotified = true
    record.handlers!.onClose()
  }
  const notifyError = (record: LogicalChannel): void => {
    if (!record.attached || record.errorNotified || terminalError === undefined) return
    record.errorNotified = true
    record.handlers!.onError(terminalError)
  }
  const closeRecord = (record: LogicalChannel, notifyPeer: boolean): void => {
    if (record.localClosed) return
    if (notifyPeer && !terminal && physical.getState() === 'open') {
      physical.send(encodeFrame({
        protocol: peerDataChannelMultiplexerProtocol,
        protocolVersion: peerDataChannelMultiplexerProtocolVersion,
        channel: record.id,
        kind: 'close',
      }))
    }
    record.localClosed = true
    record.pending.length = 0
    record.pendingBytes = 0
    notifyClose(record)
  }
  const fail = (error: unknown): never => {
    if (!terminal) {
      terminal = true
      terminalError = error
      for (const record of records.values()) {
        record.pending.length = 0
        record.pendingBytes = 0
        notifyError(record)
        notifyClose(record)
      }
      try { physical.close() } catch { /* Le transport est déjà terminal. */ }
    }
    throw error
  }
  const enqueue = (record: LogicalChannel, payload: string): void => {
    const bytes = measurePeerDataMessageBytes(payload)
    if (record.pending.length >= maximumPendingMessages
      || record.pendingBytes > maximumPendingBytes - bytes) {
      fail(multiplexError('peer-channel-buffer-limit', `Le canal logique ${record.id} a saturé sa file d'attente.`))
    }
    record.pending.push(Object.freeze({ payload, bytes }))
    record.pendingBytes += bytes
  }
  const receive = (message: string): void => {
    let decoded: unknown
    try { decoded = JSON.parse(message) } catch {
      fail(multiplexError('peer-channel-invalid-message', 'Une trame multiplexée pair-à-pair contient un JSON invalide.'))
    }
    const frame = parseFrame(decoded, allowedChannels)
    if (!frame) return fail(multiplexError('peer-channel-invalid-message', 'Une trame multiplexée pair-à-pair est invalide.'))
    const record = records.get(frame.channel)!
    if (frame.kind === 'close') {
      if (record.remoteClosed) fail(multiplexError('peer-channel-invalid-message', `Le canal logique ${record.id} a été fermé deux fois.`))
      record.remoteClosed = true
      record.pending.length = 0
      record.pendingBytes = 0
      notifyClose(record)
      return
    }
    if (record.localClosed || record.remoteClosed) {
      fail(multiplexError('peer-channel-invalid-message', `Le canal logique ${record.id} a reçu des données après sa fermeture.`))
    }
    if (record.attached && record.openNotified) record.handlers!.onMessage(frame.payload)
    else enqueue(record, frame.payload)
  }

  detachPhysical = physical.attach({
    onOpen() {
      physicalOpen = true
      for (const record of records.values()) notifyOpen(record)
    },
    onMessage: receive,
    onClose() {
      terminal = true
      physicalOpen = false
      for (const record of records.values()) notifyClose(record)
    },
    onError(error) {
      terminal = true
      terminalError = error
      for (const record of records.values()) {
        notifyError(record)
        notifyClose(record)
      }
    },
  })

  if (physical.backpressure) {
    detachBackpressure = physical.backpressure.subscribe((state) => {
      for (const listener of [...backpressureListeners]) listener(state)
    })
  }

  const sharedBackpressure: PeerDataChannelBackpressure | undefined = physical.backpressure && Object.freeze({
    getState: physical.backpressure.getState,
    subscribe(listener: (state: PeerDataChannelWriteState) => void) {
      backpressureListeners.add(listener)
      listener(physical.backpressure!.getState())
      return () => { backpressureListeners.delete(listener) }
    },
  })

  const createLogicalChannel = (record: LogicalChannel): PeerDataChannel => Object.freeze({
    getState: () => stateOf(record),
    attach(handlers: PeerDataChannelHandlers) {
      if (record.attached) throw multiplexError('peer-channel-already-attached', `Le canal logique ${record.id} possède déjà un consommateur.`)
      record.attached = true
      record.handlers = handlers
      record.openNotified = false
      record.closeNotified = false
      record.errorNotified = false
      try {
        notifyOpen(record)
        notifyError(record)
        notifyClose(record)
      } catch (error) {
        fail(error)
      }
      let active = true
      return () => {
        if (!active) return
        active = false
        record.handlers = undefined
        record.attached = false
      }
    },
    send(payload: string) {
      if (typeof payload !== 'string') throw multiplexError('peer-channel-invalid-message', 'Le canal logique accepte uniquement du texte.')
      if (stateOf(record) !== 'open') throw multiplexError('peer-channel-not-open', `Le canal logique ${record.id} n'est pas ouvert.`)
      physical.send(encodeFrame({
        protocol: peerDataChannelMultiplexerProtocol,
        protocolVersion: peerDataChannelMultiplexerProtocolVersion,
        channel: record.id,
        kind: 'data',
        payload,
      }))
    },
    close: () => closeRecord(record, true),
    ...(sharedBackpressure ? { backpressure: sharedBackpressure } : {}),
  })

  for (const record of records.values()) logicalChannels.set(record.id, createLogicalChannel(record))

  return Object.freeze({
    getChannel(channelId: string) {
      const channel = logicalChannels.get(channelId)
      if (!channel) throw new TypeError(`Le canal logique ${channelId} n'est pas déclaré.`)
      return channel
    },
    issueChannelBinding(channelId: string) {
      const channel = logicalChannels.get(channelId)
      if (!channel) throw new TypeError(`Le canal logique ${channelId} n'est pas déclaré.`)
      const existing = channelBindings.get(channelId)
      if (existing) return existing
      const binding = Object.freeze({ channel, channelId })
      issuedChannelBindings.add(binding)
      channelBindings.set(channelId, binding)
      return binding
    },
    close() {
      if (terminal) return
      terminal = true
      physicalOpen = false
      for (const record of records.values()) {
        record.localClosed = true
        record.pending.length = 0
        record.pendingBytes = 0
        notifyClose(record)
      }
      backpressureListeners.clear()
      detachBackpressure?.()
      detachBackpressure = undefined
      detachPhysical?.()
      detachPhysical = undefined
      physical.close()
    },
  })
}
