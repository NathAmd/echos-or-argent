import {
  measurePeerDataMessageBytes,
  PeerDataChannelError,
  peerDataChannelDefaultMaximumBufferedBytes,
  peerDataChannelDefaultMaximumFrameBytes,
  peerDataChannelDefaultMaximumMessageBytes,
  type PeerDataChannel,
  type PeerDataChannelBackpressure,
  type PeerDataChannelHandlers,
  type PeerDataChannelState,
  type PeerDataChannelWriteState,
} from './peerDataChannel'

export type RtcPeerDataChannelAdapterOptions = Readonly<{
  maximumMessageBytes?: number
  maximumBufferedBytes?: number
  /** Seuil de reprise, strictement inférieur à `maximumBufferedBytes`. */
  bufferedAmountLowThresholdBytes?: number
  /** Borne locale conservatrice d'une trame SCTP. Elle ne peut pas dépasser 16 Kio. */
  maximumFrameBytes?: number
  /**
   * Permet à la session RTC de resserrer dynamiquement la borne avec
   * RTCSctpTransport.maxMessageSize. `0` ou `Infinity` signifient « sans borne
   * supplémentaire », conformément aux valeurs exposées par les navigateurs.
   */
  resolveMaximumTransportMessageBytes?: () => number | null | undefined
  maximumPendingMessages?: number
  maximumPendingBytes?: number
  maximumConcurrentAssemblies?: number
  maximumReassemblyBytes?: number
  maximumFragmentsPerMessage?: number
  reassemblyTimeoutMs?: number
  incomingRateWindowMs?: number
  maximumIncomingFramesPerWindow?: number
  maximumIncomingWireBytesPerWindow?: number
  maximumIncomingMessagesPerWindow?: number
}>

type PendingMessage = Readonly<{ message: string, bytes: number }>

type IncomingAssembly = {
  readonly fragmentCount: number
  readonly totalBytes: number
  readonly chunks: Array<Uint8Array | undefined>
  readonly timeout: ReturnType<typeof setTimeout>
  receivedFragments: number
  receivedBytes: number
}

type AttachedConsumer = {
  readonly handlers: PeerDataChannelHandlers
  active: boolean
  ready: boolean
  openNotified: boolean
  errorNotified: boolean
  closeNotified: boolean
}

type WriteStateObserver = {
  readonly listener: (state: PeerDataChannelWriteState) => void
  active: boolean
  lastChannelState?: PeerDataChannelState
  lastWritable?: boolean
}

const internalFrameMarker = '\u001ePMDC|1|'
const internalFrameHeaderReserveBytes = 128
const minimumFrameBytes = 256
const maximumPendingMessagesHardLimit = 256
const maximumAggregateBytesHardLimit = 4 * 1_024 * 1_024
const maximumConcurrentAssembliesHardLimit = 64
const maximumFragmentsPerMessageHardLimit = 4_096
const maximumReassemblyTimeoutMs = 120_000
const maximumIncomingRateWindowMs = 60_000
const maximumIncomingFramesPerWindowHardLimit = 32_768
const maximumIncomingWireBytesPerWindowHardLimit = 16 * 1_024 * 1_024
const maximumIncomingMessagesPerWindowHardLimit = 4_096
const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder('utf-8', { fatal: true })

function requireLimit(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} doit être un entier compris entre 1 et ${maximum}.`)
  }
  return value
}

function requireLowThreshold(value: number, maximumBufferedBytes: number): number {
  if (!Number.isSafeInteger(value) || value < 0 || value >= maximumBufferedBytes) {
    throw new RangeError(
      `Le seuil bas du tampon pair-à-pair doit être un entier compris entre 0 et ${maximumBufferedBytes - 1}.`,
    )
  }
  return value
}

function asChannelState(value: RTCDataChannelState): PeerDataChannelState {
  return value
}

function peerError(
  code: ConstructorParameters<typeof PeerDataChannelError>[0],
  message: string,
): PeerDataChannelError {
  return new PeerDataChannelError(code, message)
}

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function decodeCanonicalBase64(value: string): Uint8Array {
  if (value.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(value)) {
    throw peerError('peer-channel-invalid-message', 'Une trame pair-à-pair contient une charge invalide.')
  }
  let binary: string
  try { binary = atob(value) } catch {
    throw peerError('peer-channel-invalid-message', 'Une trame pair-à-pair contient une charge invalide.')
  }
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0))
  if (encodeBase64(bytes) !== value) {
    throw peerError('peer-channel-invalid-message', 'Une trame pair-à-pair contient une charge non canonique.')
  }
  return bytes
}

function parseCanonicalInteger(value: string, maximum: number): number {
  if (!/^(?:0|[1-9][0-9]*)$/.test(value)) {
    throw peerError('peer-channel-invalid-message', 'Une trame pair-à-pair contient un entier invalide.')
  }
  const parsed = Number(value)
  if (!Number.isSafeInteger(parsed) || parsed > maximum) {
    throw peerError('peer-channel-invalid-message', 'Une trame pair-à-pair dépasse les bornes du protocole.')
  }
  return parsed
}

/**
 * Adapte un RTCDataChannel existant sans créer ni signaler de RTCPeerConnection.
 *
 * Les écouteurs natifs sont volontairement installés avant le premier `attach` :
 * le pair peut ainsi envoyer son snapshot initial immédiatement après l'ouverture
 * sans créer de course avec le consommateur applicatif.
 */
export function createRtcPeerDataChannelAdapter(
  channel: RTCDataChannel,
  options: RtcPeerDataChannelAdapterOptions = {},
): PeerDataChannel {
  const maximumMessageBytes = requireLimit(
    options.maximumMessageBytes ?? peerDataChannelDefaultMaximumMessageBytes,
    peerDataChannelDefaultMaximumMessageBytes,
    'La taille maximale d’un message pair-à-pair',
  )
  const maximumBufferedBytes = requireLimit(
    options.maximumBufferedBytes ?? peerDataChannelDefaultMaximumBufferedBytes,
    maximumAggregateBytesHardLimit,
    'La taille maximale du tampon pair-à-pair',
  )
  const requestedLowThresholdBytes = requireLowThreshold(
    options.bufferedAmountLowThresholdBytes ?? Math.floor(maximumBufferedBytes / 2),
    maximumBufferedBytes,
  )
  const maximumFrameBytes = requireLimit(
    options.maximumFrameBytes ?? peerDataChannelDefaultMaximumFrameBytes,
    peerDataChannelDefaultMaximumFrameBytes,
    'La taille maximale d’une trame pair-à-pair',
  )
  if (maximumFrameBytes < minimumFrameBytes) {
    throw new RangeError(`La taille maximale d’une trame pair-à-pair doit atteindre ${minimumFrameBytes} octets.`)
  }
  if (
    options.resolveMaximumTransportMessageBytes !== undefined
    && typeof options.resolveMaximumTransportMessageBytes !== 'function'
  ) throw new TypeError('Le résolveur de limite SCTP doit être une fonction.')
  const maximumPendingMessages = requireLimit(
    options.maximumPendingMessages ?? 32,
    maximumPendingMessagesHardLimit,
    'Le nombre maximal de messages pair-à-pair en attente',
  )
  const maximumPendingBytes = requireLimit(
    options.maximumPendingBytes ?? maximumBufferedBytes,
    maximumAggregateBytesHardLimit,
    'La taille maximale des messages pair-à-pair en attente',
  )
  const maximumConcurrentAssemblies = requireLimit(
    options.maximumConcurrentAssemblies ?? 8,
    maximumConcurrentAssembliesHardLimit,
    'Le nombre maximal de réassemblages pair-à-pair',
  )
  const maximumReassemblyBytes = requireLimit(
    options.maximumReassemblyBytes ?? maximumBufferedBytes,
    maximumAggregateBytesHardLimit,
    'La taille maximale des réassemblages pair-à-pair',
  )
  const maximumFragmentsPerMessage = requireLimit(
    options.maximumFragmentsPerMessage ?? maximumFragmentsPerMessageHardLimit,
    maximumFragmentsPerMessageHardLimit,
    'Le nombre maximal de fragments pair-à-pair',
  )
  const reassemblyTimeoutMs = requireLimit(
    options.reassemblyTimeoutMs ?? 15_000,
    maximumReassemblyTimeoutMs,
    'Le délai maximal de réassemblage pair-à-pair',
  )
  const incomingRateWindowMs = requireLimit(
    options.incomingRateWindowMs ?? 1_000,
    maximumIncomingRateWindowMs,
    'La fenêtre des quotas entrants pair-à-pair',
  )
  const maximumIncomingFramesPerWindow = requireLimit(
    options.maximumIncomingFramesPerWindow ?? 8_192,
    maximumIncomingFramesPerWindowHardLimit,
    'Le nombre maximal de trames entrantes pair-à-pair',
  )
  const maximumIncomingWireBytesPerWindow = requireLimit(
    options.maximumIncomingWireBytesPerWindow ?? 2 * 1_024 * 1_024,
    maximumIncomingWireBytesPerWindowHardLimit,
    'La taille maximale des trames entrantes pair-à-pair',
  )
  const maximumIncomingMessagesPerWindow = requireLimit(
    options.maximumIncomingMessagesPerWindow ?? 256,
    maximumIncomingMessagesPerWindowHardLimit,
    'Le nombre maximal de messages entrants pair-à-pair',
  )

  // Safari et les autres navigateurs modernes exposent la propriété et
  // l'événement standard. Si un runtime refuse silencieusement le seuil demandé,
  // on se cale sur sa valeur réellement exposée (généralement zéro).
  try { channel.bufferedAmountLowThreshold = requestedLowThresholdBytes } catch { /* Repli lu ci-dessous. */ }
  const nativeLowThreshold = channel.bufferedAmountLowThreshold
  const lowThresholdBytes = (
    Number.isSafeInteger(nativeLowThreshold)
    && nativeLowThreshold >= 0
    && nativeLowThreshold < maximumBufferedBytes
  ) ? nativeLowThreshold : 0

  const pendingMessages: PendingMessage[] = []
  const assemblies = new Map<string, IncomingAssembly>()
  let pendingMessageBytes = 0
  let reservedAssemblyBytes = 0
  let messageSerial = 0
  let incomingRateWindowStartedAt = Date.now()
  let incomingFrameCount = 0
  let incomingWireBytes = 0
  let incomingMessageCount = 0
  let currentConsumer: AttachedConsumer | undefined
  let writeStateObserver: WriteStateObserver | undefined
  let hasOpened = channel.readyState === 'open'
  let hasClosed = channel.readyState === 'closed'
  let failed = false
  let fatalError: unknown

  const getWriteState = (): PeerDataChannelWriteState => {
    const channelState = asChannelState(channel.readyState)
    const rawBufferedAmount = channel.bufferedAmount
    const bufferedAmountBytes = Number.isFinite(rawBufferedAmount) && rawBufferedAmount >= 0
      ? rawBufferedAmount
      : null
    return Object.freeze({
      channelState,
      writable: !failed
        && !hasClosed
        && channelState === 'open'
        && bufferedAmountBytes !== null
        && bufferedAmountBytes <= lowThresholdBytes,
      bufferedAmountBytes,
      availableBufferBytes: bufferedAmountBytes === null
        ? 0
        : Math.max(0, maximumBufferedBytes - bufferedAmountBytes),
      lowThresholdBytes,
      maximumBufferedBytes,
    })
  }

  const notifyWriteState = (force = false): void => {
    const observer = writeStateObserver
    if (!observer?.active) return
    const state = getWriteState()
    if (
      !force
      && observer.lastChannelState === state.channelState
      && observer.lastWritable === state.writable
    ) return
    observer.lastChannelState = state.channelState
    observer.lastWritable = state.writable
    try { observer.listener(state) } catch (error) {
      observer.active = false
      if (writeStateObserver === observer) writeStateObserver = undefined
      fail(error)
    }
  }

  const effectiveMaximumFrameBytes = (): number => {
    let resolved: number | null | undefined
    try { resolved = options.resolveMaximumTransportMessageBytes?.() } catch (error) {
      throw peerError(
        'peer-channel-transport-limit',
        `La limite SCTP pair-à-pair n'a pas pu être déterminée : ${error instanceof Error ? error.message : 'erreur inconnue'}.`,
      )
    }
    if (resolved === undefined || resolved === null || resolved === 0 || resolved === Infinity) return maximumFrameBytes
    if (!Number.isSafeInteger(resolved) || resolved < 1) {
      throw peerError('peer-channel-transport-limit', 'La limite SCTP pair-à-pair est invalide.')
    }
    const effective = Math.min(maximumFrameBytes, resolved)
    if (effective < minimumFrameBytes) {
      throw peerError(
        'peer-channel-transport-limit',
        `Le transport SCTP doit accepter des trames d'au moins ${minimumFrameBytes} octets.`,
      )
    }
    return effective
  }

  const clearAssemblies = (): void => {
    for (const assembly of assemblies.values()) clearTimeout(assembly.timeout)
    assemblies.clear()
    reservedAssemblyBytes = 0
  }

  const clearPendingMessages = (): void => {
    pendingMessages.length = 0
    pendingMessageBytes = 0
  }

  const refreshIncomingRateWindow = (): void => {
    const now = Date.now()
    if (now >= incomingRateWindowStartedAt && now - incomingRateWindowStartedAt < incomingRateWindowMs) return
    incomingRateWindowStartedAt = now
    incomingFrameCount = 0
    incomingWireBytes = 0
    incomingMessageCount = 0
  }

  const accountIncomingFrame = (wireBytes: number): void => {
    refreshIncomingRateWindow()
    if (
      incomingFrameCount >= maximumIncomingFramesPerWindow
      || incomingWireBytes > maximumIncomingWireBytesPerWindow - wireBytes
    ) throw peerError('peer-channel-buffer-limit', 'Le pair a dépassé le débit de trames entrant autorisé.')
    incomingFrameCount += 1
    incomingWireBytes += wireBytes
  }

  const accountIncomingMessage = (): void => {
    refreshIncomingRateWindow()
    if (incomingMessageCount >= maximumIncomingMessagesPerWindow) {
      throw peerError('peer-channel-buffer-limit', 'Le pair a dépassé le débit de messages entrant autorisé.')
    }
    incomingMessageCount += 1
  }

  const notifyError = (consumer: AttachedConsumer): void => {
    if (!consumer.active || !consumer.ready || consumer.errorNotified || !failed) return
    consumer.errorNotified = true
    try { consumer.handlers.onError(fatalError) } catch { /* Une erreur terminale reste terminale. */ }
  }

  const notifyClose = (consumer: AttachedConsumer): void => {
    if (!consumer.active || !consumer.ready || consumer.closeNotified || !hasClosed) return
    consumer.closeNotified = true
    try { consumer.handlers.onClose() } catch { /* La fermeture reste terminale. */ }
  }

  const fail = (error: unknown): void => {
    if (failed) return
    failed = true
    fatalError = error
    clearAssemblies()
    clearPendingMessages()
    notifyWriteState()
    if (writeStateObserver) writeStateObserver.active = false
    writeStateObserver = undefined
    channel.removeEventListener('bufferedamountlow', onBufferedAmountLow)
    if (currentConsumer) notifyError(currentConsumer)
    try {
      if (channel.readyState !== 'closed' && channel.readyState !== 'closing') channel.close()
    } catch { /* Le canal est déjà considéré fatal. */ }
    if (channel.readyState === 'closed') {
      hasClosed = true
      if (currentConsumer) notifyClose(currentConsumer)
    }
  }

  const notifyOpen = (consumer: AttachedConsumer): void => {
    if (!consumer.active || !consumer.ready || consumer.openNotified || !hasOpened || hasClosed) return
    consumer.openNotified = true
    try { consumer.handlers.onOpen() } catch (error) { fail(error) }
  }

  const deliverMessage = (consumer: AttachedConsumer, message: string): void => {
    if (!consumer.active || !consumer.ready || failed || hasClosed) return
    try { consumer.handlers.onMessage(message) } catch (error) { fail(error) }
  }

  const drainPendingMessages = (consumer: AttachedConsumer): void => {
    if (!consumer.active || !consumer.ready || !consumer.openNotified || failed || hasClosed) return
    while (pendingMessages.length > 0 && consumer.active && !failed && !hasClosed) {
      const pending = pendingMessages.shift()!
      pendingMessageBytes -= pending.bytes
      deliverMessage(consumer, pending.message)
    }
  }

  const enqueueOrDeliver = (message: string, bytes: number): void => {
    const consumer = currentConsumer
    if (consumer?.ready && consumer.openNotified && !failed && !hasClosed) {
      deliverMessage(consumer, message)
      return
    }
    if (pendingMessages.length >= maximumPendingMessages || pendingMessageBytes + bytes > maximumPendingBytes) {
      fail(peerError(
        'peer-channel-buffer-limit',
        'Le pair a saturé la file de messages reçus avant leur consommation.',
      ))
      return
    }
    pendingMessages.push(Object.freeze({ message, bytes }))
    pendingMessageBytes += bytes
  }

  const completeAssembly = (id: string, assembly: IncomingAssembly): void => {
    if (assembly.receivedFragments !== assembly.fragmentCount || assembly.receivedBytes !== assembly.totalBytes) {
      throw peerError('peer-channel-invalid-message', 'Le réassemblage pair-à-pair est incomplet.')
    }
    accountIncomingMessage()
    const bytes = new Uint8Array(assembly.totalBytes)
    let offset = 0
    for (const chunk of assembly.chunks) {
      if (!chunk) throw peerError('peer-channel-invalid-message', 'Le réassemblage pair-à-pair contient un trou.')
      bytes.set(chunk, offset)
      offset += chunk.byteLength
    }
    let message: string
    try { message = textDecoder.decode(bytes) } catch {
      throw peerError('peer-channel-invalid-message', "Le message pair-à-pair n'est pas du texte UTF-8 valide.")
    }
    assemblies.delete(id)
    reservedAssemblyBytes -= assembly.totalBytes
    clearTimeout(assembly.timeout)
    enqueueOrDeliver(message, assembly.totalBytes)
  }

  const receiveFrame = (wireMessage: string): void => {
    if (wireMessage.length > maximumFrameBytes) {
      throw peerError('peer-channel-message-too-large', 'Une trame pair-à-pair reçue dépasse la limite SCTP autorisée.')
    }
    const wireBytes = measurePeerDataMessageBytes(wireMessage)
    if (wireBytes > maximumFrameBytes) {
      throw peerError('peer-channel-message-too-large', 'Une trame pair-à-pair reçue dépasse la limite SCTP autorisée.')
    }
    accountIncomingFrame(wireBytes)
    const fields = wireMessage.split('|')
    if (
      fields.length !== 7
      || fields[0] !== '\u001ePMDC'
      || fields[1] !== '1'
      || !/^[0-9a-z]{1,13}$/.test(fields[2]!)
    ) throw peerError('peer-channel-invalid-message', 'Le protocole interne de la trame pair-à-pair est invalide.')

    const id = fields[2]!
    const fragmentIndex = parseCanonicalInteger(fields[3]!, maximumFragmentsPerMessage - 1)
    const fragmentCount = parseCanonicalInteger(fields[4]!, maximumFragmentsPerMessage)
    const totalBytes = parseCanonicalInteger(fields[5]!, maximumMessageBytes)
    const chunk = decodeCanonicalBase64(fields[6]!)
    if (
      fragmentCount < 1
      || fragmentIndex >= fragmentCount
      || (totalBytes === 0 && (fragmentCount !== 1 || fragmentIndex !== 0 || chunk.byteLength !== 0))
      || (totalBytes > 0 && (fragmentCount > totalBytes || chunk.byteLength === 0))
      || chunk.byteLength > totalBytes
    ) throw peerError('peer-channel-invalid-message', 'La structure des fragments pair-à-pair est incohérente.')

    let assembly = assemblies.get(id)
    if (!assembly) {
      if (assemblies.size >= maximumConcurrentAssemblies || reservedAssemblyBytes + totalBytes > maximumReassemblyBytes) {
        throw peerError('peer-channel-buffer-limit', 'Le pair a saturé les réassemblages de messages autorisés.')
      }
      const timeout = setTimeout(() => fail(peerError(
        'peer-channel-buffer-limit',
        "Le pair n'a pas terminé un message fragmenté dans le délai autorisé.",
      )), reassemblyTimeoutMs)
      assembly = {
        fragmentCount,
        totalBytes,
        chunks: new Array<Uint8Array | undefined>(fragmentCount),
        timeout,
        receivedFragments: 0,
        receivedBytes: 0,
      }
      assemblies.set(id, assembly)
      reservedAssemblyBytes += totalBytes
    } else if (assembly.fragmentCount !== fragmentCount || assembly.totalBytes !== totalBytes) {
      throw peerError('peer-channel-invalid-message', 'Les fragments pair-à-pair ne décrivent pas le même message.')
    }
    if (assembly.chunks[fragmentIndex]) {
      throw peerError('peer-channel-invalid-message', 'Le pair a envoyé deux fois le même fragment.')
    }
    if (assembly.receivedBytes + chunk.byteLength > totalBytes) {
      throw peerError('peer-channel-invalid-message', 'Les fragments pair-à-pair dépassent la taille annoncée.')
    }
    assembly.chunks[fragmentIndex] = chunk
    assembly.receivedFragments += 1
    assembly.receivedBytes += chunk.byteLength
    if (assembly.receivedFragments < assembly.fragmentCount && assembly.receivedBytes >= assembly.totalBytes) {
      throw peerError('peer-channel-invalid-message', 'Les fragments pair-à-pair atteignent trop tôt la taille annoncée.')
    }
    if (assembly.receivedFragments === assembly.fragmentCount) completeAssembly(id, assembly)
  }

  const onOpen = (): void => {
    if (hasClosed) return
    hasOpened = true
    notifyWriteState()
    const consumer = currentConsumer
    if (!consumer) return
    notifyOpen(consumer)
    drainPendingMessages(consumer)
  }
  const onClose = (): void => {
    if (hasClosed) return
    hasClosed = true
    clearAssemblies()
    clearPendingMessages()
    notifyWriteState()
    if (writeStateObserver) writeStateObserver.active = false
    writeStateObserver = undefined
    channel.removeEventListener('bufferedamountlow', onBufferedAmountLow)
    if (currentConsumer) notifyClose(currentConsumer)
  }
  const onError = (): void => { fail(new Error('Le RTCDataChannel pair-à-pair a signalé une erreur.')) }
  const onMessage = (event: MessageEvent<unknown>): void => {
    if (failed || hasClosed) return
    if (typeof event.data !== 'string') {
      fail(peerError('peer-channel-invalid-message', 'Le canal pair-à-pair accepte uniquement des trames texte.'))
      return
    }
    try { receiveFrame(event.data) } catch (error) { fail(error) }
  }
  function onBufferedAmountLow(): void { notifyWriteState() }

  channel.addEventListener('open', onOpen)
  channel.addEventListener('close', onClose)
  channel.addEventListener('error', onError)
  channel.addEventListener('message', onMessage)
  if (!hasClosed) channel.addEventListener('bufferedamountlow', onBufferedAmountLow)

  const attach = (handlers: PeerDataChannelHandlers): (() => void) => {
    if (currentConsumer?.active) {
      throw new PeerDataChannelError(
        'peer-channel-already-attached',
        'Le canal pair-à-pair possède déjà un consommateur.',
      )
    }
    const consumer: AttachedConsumer = {
      handlers,
      active: true,
      ready: false,
      openNotified: false,
      errorNotified: false,
      closeNotified: false,
    }
    currentConsumer = consumer
    const detach = (): void => {
      if (!consumer.active) return
      consumer.active = false
      if (currentConsumer === consumer) currentConsumer = undefined
    }
    queueMicrotask(() => {
      if (!consumer.active || currentConsumer !== consumer) return
      consumer.ready = true
      notifyOpen(consumer)
      drainPendingMessages(consumer)
      notifyError(consumer)
      notifyClose(consumer)
    })
    return detach
  }

  const backpressure: PeerDataChannelBackpressure = Object.freeze({
    getState: getWriteState,
    subscribe(listener) {
      if (typeof listener !== 'function') throw new TypeError("L'observateur de backpressure doit être une fonction.")
      if (writeStateObserver?.active) {
        throw new PeerDataChannelError(
          'peer-channel-already-attached',
          'Le canal pair-à-pair possède déjà un observateur de backpressure.',
        )
      }
      const observer: WriteStateObserver = { listener, active: true }
      writeStateObserver = observer
      notifyWriteState(true)
      if (failed || hasClosed || channel.readyState === 'closed') {
        observer.active = false
        if (writeStateObserver === observer) writeStateObserver = undefined
      }
      return () => {
        if (!observer.active) return
        observer.active = false
        if (writeStateObserver === observer) writeStateObserver = undefined
      }
    },
  })

  return Object.freeze({
    getState: () => asChannelState(channel.readyState),
    attach,
    backpressure,
    send(message) {
      if (typeof message !== 'string') {
        throw new PeerDataChannelError('peer-channel-invalid-message', 'Le message pair-à-pair doit être du texte.')
      }
      if (channel.readyState !== 'open') {
        throw new PeerDataChannelError('peer-channel-not-open', "Le canal pair-à-pair n'est pas ouvert.")
      }
      const encodedMessage = textEncoder.encode(message)
      let normalizedMessage: string
      try { normalizedMessage = textDecoder.decode(encodedMessage) } catch {
        throw peerError('peer-channel-invalid-message', "Le message pair-à-pair n'est pas du texte UTF-8 valide.")
      }
      if (normalizedMessage !== message) {
        throw peerError('peer-channel-invalid-message', 'Le message pair-à-pair contient un caractère Unicode isolé.')
      }
      const messageBytes = encodedMessage.byteLength
      if (messageBytes > maximumMessageBytes) {
        throw new PeerDataChannelError(
          'peer-channel-message-too-large',
          'Le message pair-à-pair à envoyer dépasse la limite autorisée.',
        )
      }
      const frameBytes = effectiveMaximumFrameBytes()
      const rawChunkBytes = Math.floor((frameBytes - internalFrameHeaderReserveBytes) / 4) * 3
      const fragmentCount = Math.max(1, Math.ceil(messageBytes / rawChunkBytes))
      if (fragmentCount > maximumFragmentsPerMessage) {
        throw peerError(
          'peer-channel-transport-limit',
          'La limite SCTP imposerait un nombre excessif de fragments pair-à-pair.',
        )
      }
      messageSerial += 1
      if (!Number.isSafeInteger(messageSerial)) {
        throw peerError('peer-channel-transport-limit', "L'identifiant des messages pair-à-pair est épuisé.")
      }
      const id = messageSerial.toString(36)
      const frames: string[] = []
      let totalWireBytes = 0
      for (let fragmentIndex = 0; fragmentIndex < fragmentCount; fragmentIndex += 1) {
        const start = fragmentIndex * rawChunkBytes
        const chunk = encodedMessage.subarray(start, Math.min(start + rawChunkBytes, messageBytes))
        const frame = `${internalFrameMarker}${id}|${fragmentIndex}|${fragmentCount}|${messageBytes}|${encodeBase64(chunk)}`
        const wireBytes = measurePeerDataMessageBytes(frame)
        if (wireBytes > frameBytes) {
          throw peerError('peer-channel-transport-limit', 'Une trame pair-à-pair dépasse la limite SCTP calculée.')
        }
        frames.push(frame)
        totalWireBytes += wireBytes
      }
      if (
        !Number.isFinite(channel.bufferedAmount)
        || channel.bufferedAmount < 0
        || channel.bufferedAmount + totalWireBytes > maximumBufferedBytes
      ) {
        notifyWriteState()
        throw new PeerDataChannelError(
          'peer-channel-buffer-limit',
          'Le tampon du canal pair-à-pair est saturé.',
        )
      }
      try {
        for (const frame of frames) channel.send(frame)
        notifyWriteState()
      } catch (error) {
        const failure = peerError(
          'peer-channel-not-open',
          `L'envoi pair-à-pair a échoué : ${error instanceof Error ? error.message : 'erreur RTC inconnue'}.`,
        )
        fail(failure)
        throw failure
      }
    },
    close() {
      if (channel.readyState !== 'closed' && channel.readyState !== 'closing') channel.close()
      notifyWriteState()
    },
  })
}
