import type { OnlineSignalingState } from './onlineSignalingClient'
import {
  generateOnlineOpaqueId,
  isOnlineNegotiationId,
  isOnlineUserId,
  type OnlineSignalPayload,
} from './onlineServiceProtocol'
import type { PeerDataChannel } from './peerDataChannel'
import {
  createRtcPeerDataChannelAdapter,
  type RtcPeerDataChannelAdapterOptions,
} from './rtcDataChannelAdapter'
import {
  isIssuedRtcSignalingRoute,
  RtcSignalingCoordinatorError,
  type RtcSignalingInboundSignal,
  type RtcSignalingRoute,
  type RtcSignalingRouteDescriptor,
  type RtcSignalingRouteRole,
} from './rtcSignalingCoordinator'

export const rtcPeerConnectionDefaultDataChannelLabel = 'pokemaster-hgss-campaign'
export const rtcPeerConnectionDefaultDataChannelProtocol = 'pokemaster-hgss-campaign-peer.v1'

export type RtcPeerConnectionRole = RtcSignalingRouteRole
export type RtcPeerConnectionSessionStatus = 'idle' | 'connecting' | 'connected' | 'closed' | 'failed'

export type RtcPeerConnectionSessionState = Readonly<{
  status: RtcPeerConnectionSessionStatus
  role: RtcPeerConnectionRole
  peerId: string
  negotiationId: string
  error?: Error
}>

export type RtcPeerConnectionSessionOptions = Readonly<{
  route: RtcSignalingRoute
  rtcConfiguration?: RTCConfiguration
  dataChannelLabel?: string
  dataChannelProtocol?: string
  dataChannelLimits?: RtcPeerDataChannelAdapterOptions
  connectTimeoutMs?: number
  maximumQueuedIceCandidates?: number
  peerConnectionFactory?: (configuration?: RTCConfiguration) => RTCPeerConnection
  onStateChange?: (state: RtcPeerConnectionSessionState) => void
}>

export type RtcPeerConnectionSession = Readonly<{
  getState: () => RtcPeerConnectionSessionState
  connect: () => Promise<RtcPeerConnectionLink>
  close: (reason?: string) => void
}>

/** Identite de rendez-vous conservee avec le canal remis au protocole applicatif. */
export type RtcPeerConnectionLink = Readonly<{
  channel: PeerDataChannel
  descriptor: RtcSignalingRouteDescriptor
  role: RtcPeerConnectionRole
}>

const issuedRtcPeerConnectionLinks = new WeakSet<object>()
const consumedRtcPeerConnectionLinks = new WeakSet<object>()

/**
 * Consomme une fois la preuve privée qu'un lien a réellement été produit par
 * ce module. Un objet structurellement identique ne peut pas passer ce contrôle.
 */
export function consumeIssuedRtcPeerConnectionLink(value: unknown): value is RtcPeerConnectionLink {
  if (value === null || typeof value !== 'object'
    || !issuedRtcPeerConnectionLinks.has(value)
    || consumedRtcPeerConnectionLinks.has(value)) return false
  consumedRtcPeerConnectionLinks.add(value)
  return true
}

export type RtcPeerConnectionSessionErrorCode =
  | 'rtc-session-closed'
  | 'rtc-session-timeout'
  | 'rtc-signaling-unavailable'
  | 'rtc-peer-connection-unavailable'
  | 'rtc-peer-protocol-error'
  | 'rtc-data-channel-invalid'
  | 'rtc-peer-hangup'
  | 'rtc-peer-connection-failed'

export class RtcPeerConnectionSessionError extends Error {
  readonly code: RtcPeerConnectionSessionErrorCode

  constructor(code: RtcPeerConnectionSessionErrorCode, message: string) {
    super(message)
    this.name = 'RtcPeerConnectionSessionError'
    this.code = code
  }
}

export type RtcPeerConnectionAvailability = Readonly<{
  available: boolean
  reason?: string
}>

export function readRtcPeerConnectionAvailability(
  constructor: typeof RTCPeerConnection | undefined = globalThis.RTCPeerConnection,
): RtcPeerConnectionAvailability {
  return typeof constructor === 'function'
    ? Object.freeze({ available: true })
    : Object.freeze({
      available: false,
      reason: "Le pair-à-pair WebRTC n'est pas disponible sur cet appareil.",
    })
}

/** Crée l'identifiant opaque que l'offreur transmet à l'invité avec son invitation. */
export function createRtcPeerConnectionNegotiationId(): string {
  return generateOnlineOpaqueId()
}

function positiveBound(value: number, maximum: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new RangeError(`${label} doit être un entier compris entre 1 et ${maximum}.`)
  }
  return value
}

function channelToken(value: string, maximum: number, label: string): string {
  if (value.length < 1 || value.length > maximum || !/^[A-Za-z0-9][A-Za-z0-9._:-]*$/.test(value)) {
    throw new TypeError(`${label} est invalide.`)
  }
  return value
}

function sessionError(
  code: RtcPeerConnectionSessionErrorCode,
  message: string,
): RtcPeerConnectionSessionError {
  return new RtcPeerConnectionSessionError(code, message)
}

function asSessionError(value: unknown): Error {
  if (value instanceof RtcSignalingCoordinatorError) {
    return sessionError('rtc-signaling-unavailable', value.message)
  }
  return value instanceof Error
    ? value
    : sessionError('rtc-peer-connection-failed', 'La négociation WebRTC pair-à-pair a échoué.')
}

function createBrowserPeerConnection(configuration?: RTCConfiguration): RTCPeerConnection {
  const constructor = globalThis.RTCPeerConnection
  const availability = readRtcPeerConnectionAvailability(constructor)
  if (!availability.available) {
    throw sessionError(
      'rtc-peer-connection-unavailable',
      availability.reason ?? "Le pair-à-pair WebRTC n'est pas disponible sur cet appareil.",
    )
  }
  return new constructor(configuration)
}

function icePayload(candidate: RTCIceCandidate): OnlineSignalPayload {
  return {
    type: 'ice',
    candidate: candidate.candidate,
    sdpMid: candidate.sdpMid,
    sdpMLineIndex: candidate.sdpMLineIndex,
    usernameFragment: candidate.usernameFragment,
  }
}

function iceCandidate(payload: Extract<OnlineSignalPayload, { type: 'ice' }>): RTCIceCandidateInit {
  return {
    candidate: payload.candidate,
    ...(payload.sdpMid !== undefined ? { sdpMid: payload.sdpMid } : {}),
    ...(payload.sdpMLineIndex !== undefined ? { sdpMLineIndex: payload.sdpMLineIndex } : {}),
    ...(payload.usernameFragment !== undefined ? { usernameFragment: payload.usernameFragment } : {}),
  }
}

/**
 * Négocie un canal WebRTC fiable à travers le seul vocabulaire offer/answer/ICE.
 * Le client de signalisation ne reçoit jamais les messages du PeerDataChannel.
 */
export function createRtcPeerConnectionSession(
  options: RtcPeerConnectionSessionOptions,
): RtcPeerConnectionSession {
  if (!isIssuedRtcSignalingRoute(options.route)) {
    throw new TypeError('La route WebRTC doit être émise par le coordinateur de signalisation actif.')
  }
  const role = options.route.role
  if (role !== 'offerer' && role !== 'answerer') throw new TypeError('Le rôle WebRTC de la route est invalide.')
  const descriptor = options.route.descriptor
  if (!descriptor || !Object.isFrozen(descriptor)) throw new TypeError('Le descripteur de route WebRTC doit être immuable.')
  if (!isOnlineUserId(descriptor.peerId)) throw new TypeError("L'identifiant du pair WebRTC est invalide.")
  if (!isOnlineNegotiationId(descriptor.negotiationId)) throw new TypeError("L'identifiant de négociation WebRTC est invalide.")
  const label = channelToken(
    options.dataChannelLabel ?? rtcPeerConnectionDefaultDataChannelLabel,
    64,
    'Le label du canal WebRTC',
  )
  const protocol = channelToken(
    options.dataChannelProtocol ?? rtcPeerConnectionDefaultDataChannelProtocol,
    128,
    'Le protocole du canal WebRTC',
  )
  const connectTimeoutMs = positiveBound(options.connectTimeoutMs ?? 15_000, 120_000, 'Le délai de connexion WebRTC')
  const maximumQueuedIceCandidates = positiveBound(
    options.maximumQueuedIceCandidates ?? 256,
    1_024,
    'La limite de candidats ICE en attente',
  )
  const connectionFactory = options.peerConnectionFactory
    ?? createBrowserPeerConnection

  let state: RtcPeerConnectionSessionState = Object.freeze({
    status: 'idle', role, peerId: descriptor.peerId, negotiationId: descriptor.negotiationId,
  })
  let peerConnection: RTCPeerConnection | undefined
  let rtcChannel: RTCDataChannel | undefined
  let peerChannel: PeerDataChannel | undefined
  let peerLink: RtcPeerConnectionLink | undefined
  let detachSignal: (() => void) | undefined
  let detachSignalState: (() => void) | undefined
  let connectPromise: Promise<RtcPeerConnectionLink> | undefined
  let resolveConnect: ((link: RtcPeerConnectionLink) => void) | undefined
  let rejectConnect: ((error: Error) => void) | undefined
  let timeout: ReturnType<typeof setTimeout> | undefined
  let operationQueue = Promise.resolve()
  let queuedOperationCount = 0
  let signalingReady = false
  let negotiationStarted = false
  let localDescriptionSent = false
  let remoteDescriptionApplied = false
  let negotiationComplete = false
  let channelOpen = false
  let terminal = false
  let connected = false
  const queuedIceCandidates: RTCIceCandidateInit[] = []

  const publish = (status: RtcPeerConnectionSessionStatus, error?: Error): void => {
    state = Object.freeze({
      status,
      role,
      peerId: descriptor.peerId,
      negotiationId: descriptor.negotiationId,
      ...(error ? { error } : {}),
    })
    try { options.onStateChange?.(state) } catch { /* L'observateur ne pilote pas le cycle de vie RTC. */ }
  }
  const clearTimeoutHandle = (): void => {
    if (timeout !== undefined) clearTimeout(timeout)
    timeout = undefined
  }
  const removeRtcListeners = (): void => {
    peerConnection?.removeEventListener('icecandidate', onIceCandidate)
    peerConnection?.removeEventListener('datachannel', onDataChannel)
    peerConnection?.removeEventListener('connectionstatechange', onConnectionStateChange)
    rtcChannel?.removeEventListener('open', onChannelOpen)
    rtcChannel?.removeEventListener('close', onChannelClose)
    rtcChannel?.removeEventListener('error', onChannelError)
  }
  const cleanup = (): void => {
    clearTimeoutHandle()
    try { detachSignal?.() } catch { /* La session reste terminale. */ }
    detachSignal = undefined
    try { detachSignalState?.() } catch { /* La session reste terminale. */ }
    detachSignalState = undefined
    removeRtcListeners()
    queuedIceCandidates.length = 0
    signalingReady = false
    try {
      if (rtcChannel && rtcChannel.readyState !== 'closed' && rtcChannel.readyState !== 'closing') rtcChannel.close()
    } catch { /* Le canal est déjà terminal. */ }
    try { peerConnection?.close() } catch { /* La connexion est déjà terminale. */ }
    try { options.route.close() } catch { /* La route est déjà terminale. */ }
  }
  const sendSignal = async (payload: OnlineSignalPayload): Promise<void> => {
    if (terminal) throw sessionError('rtc-session-closed', 'La session WebRTC est déjà fermée.')
    if (!signalingReady || options.route.getState().status !== 'ready') {
      throw sessionError('rtc-signaling-unavailable', "La signalisation WebRTC n'est pas prête.")
    }
    await options.route.send(payload)
  }
  const sendHangup = (): void => {
    if (!signalingReady || options.route.getState().status !== 'ready') return
    try {
      void options.route.send({ type: 'hangup' }).catch(() => undefined)
    }
    catch { /* Le nettoyage local ne dépend jamais du rendez-vous. */ }
  }
  const fail = (value: unknown): void => {
    if (terminal) return
    terminal = true
    connected = false
    const error = asSessionError(value)
    sendHangup()
    rejectConnect?.(error)
    resolveConnect = undefined
    rejectConnect = undefined
    publish('failed', error)
    cleanup()
  }
  const closeRemote = (error?: Error): void => {
    if (terminal) return
    const wasConnected = connected
    terminal = true
    connected = false
    const terminalError = error ?? (!wasConnected
      ? sessionError('rtc-peer-connection-failed', 'La connexion WebRTC distante a été fermée avant son ouverture.')
      : undefined)
    if (terminalError) rejectConnect?.(terminalError)
    resolveConnect = undefined
    rejectConnect = undefined
    publish('closed', terminalError)
    cleanup()
  }
  const maybeComplete = (): void => {
    if (terminal || connected || !channelOpen || !negotiationComplete || !peerChannel) return
    connected = true
    clearTimeoutHandle()
    const complete = resolveConnect
    resolveConnect = undefined
    rejectConnect = undefined
    publish('connected')
    if (!peerLink) {
      peerLink = Object.freeze({ channel: peerChannel, descriptor, role })
      issuedRtcPeerConnectionLinks.add(peerLink)
    }
    complete?.(peerLink)
  }
  const validateAndAdoptChannel = (candidate: RTCDataChannel): void => {
    if (rtcChannel && rtcChannel !== candidate) {
      try { candidate.close() } catch { /* Canal surnuméraire non fiable. */ }
      throw sessionError('rtc-peer-protocol-error', 'Le pair a créé plusieurs canaux WebRTC pour la même session.')
    }
    if (candidate.label !== label || candidate.protocol !== protocol || !candidate.ordered
      || candidate.maxPacketLifeTime !== null || candidate.maxRetransmits !== null) {
      try { candidate.close() } catch { /* Canal rejeté. */ }
      throw sessionError('rtc-data-channel-invalid', 'Le canal WebRTC reçu ne respecte pas le contrat de campagne.')
    }
    if (rtcChannel) return
    rtcChannel = candidate
    peerChannel = createRtcPeerDataChannelAdapter(candidate, {
      ...options.dataChannelLimits,
      // Résolue au moment de chaque envoi : certains navigateurs ne renseignent
      // `sctp` qu'après l'application des descriptions distante et locale.
      resolveMaximumTransportMessageBytes: () => peerConnection?.sctp?.maxMessageSize,
    })
    candidate.addEventListener('open', onChannelOpen)
    candidate.addEventListener('close', onChannelClose)
    candidate.addEventListener('error', onChannelError)
    if (candidate.readyState === 'open') queueMicrotask(onChannelOpen)
    else if (candidate.readyState === 'closed') queueMicrotask(onChannelClose)
  }
  const flushIceCandidates = async (): Promise<void> => {
    const connection = peerConnection
    if (!connection || !remoteDescriptionApplied) return
    while (!terminal && queuedIceCandidates.length > 0) await connection.addIceCandidate(queuedIceCandidates.shift()!)
  }
  const applyRemoteDescription = async (type: 'offer' | 'answer', sdp: string): Promise<void> => {
    const connection = peerConnection
    if (!connection || remoteDescriptionApplied) {
      throw sessionError('rtc-peer-protocol-error', 'Le pair a envoyé une description WebRTC inattendue ou dupliquée.')
    }
    remoteDescriptionApplied = true
    try {
      await connection.setRemoteDescription({ type, sdp })
      await flushIceCandidates()
    } catch (error) {
      remoteDescriptionApplied = false
      throw error
    }
  }
  const localSdp = (expectedType: 'offer' | 'answer', fallback: RTCSessionDescriptionInit): string => {
    const description = peerConnection?.localDescription
    if (description && description.type !== expectedType) {
      throw sessionError('rtc-peer-protocol-error', 'La description WebRTC locale possède un type inattendu.')
    }
    const sdp = description?.sdp ?? fallback.sdp
    if (typeof sdp !== 'string' || sdp.length < 1) {
      throw sessionError('rtc-peer-protocol-error', 'La description WebRTC locale ne contient aucun SDP.')
    }
    return sdp
  }
  const beginOffer = async (): Promise<void> => {
    if (negotiationStarted || terminal) return
    negotiationStarted = true
    const connection = peerConnection!
    validateAndAdoptChannel(connection.createDataChannel(label, { ordered: true, protocol }))
    const offer = await connection.createOffer()
    if (terminal) return
    await connection.setLocalDescription(offer)
    if (terminal) return
    // Le serveur relaie l'offre avant d'envoyer son accusé. Une réponse très
    // rapide peut donc revenir pendant l'attente de cet accusé : l'offre est
    // considérée envoyée dès que la requête a été remise à la signalisation.
    const offerAccepted = sendSignal({ type: 'offer', sdp: localSdp('offer', offer) })
    localDescriptionSent = true
    await offerAccepted
  }
  const receiveOffer = async (sdp: string): Promise<void> => {
    if (role !== 'answerer' || negotiationStarted) {
      throw sessionError('rtc-peer-protocol-error', 'Le pair a envoyé une offre WebRTC inattendue ou dupliquée.')
    }
    negotiationStarted = true
    await applyRemoteDescription('offer', sdp)
    if (terminal) return
    const answer = await peerConnection!.createAnswer()
    if (terminal) return
    await peerConnection!.setLocalDescription(answer)
    if (terminal) return
    await sendSignal({ type: 'answer', sdp: localSdp('answer', answer) })
    localDescriptionSent = true
    negotiationComplete = true
    maybeComplete()
  }
  const receiveAnswer = async (sdp: string): Promise<void> => {
    if (role !== 'offerer' || !localDescriptionSent || negotiationComplete) {
      throw sessionError('rtc-peer-protocol-error', 'Le pair a envoyé une réponse WebRTC inattendue ou dupliquée.')
    }
    await applyRemoteDescription('answer', sdp)
    if (terminal) return
    negotiationComplete = true
    maybeComplete()
  }
  const receiveIce = async (payload: Extract<OnlineSignalPayload, { type: 'ice' }>): Promise<void> => {
    const candidate = iceCandidate(payload)
    if (!remoteDescriptionApplied) {
      if (queuedIceCandidates.length >= maximumQueuedIceCandidates) {
        throw sessionError('rtc-peer-protocol-error', 'Le pair a dépassé la limite de candidats ICE en attente.')
      }
      queuedIceCandidates.push(candidate)
      return
    }
    await peerConnection!.addIceCandidate(candidate)
  }
  const receivePayload = async (payload: OnlineSignalPayload): Promise<void> => {
    if (payload.type === 'hangup') {
      closeRemote(sessionError('rtc-peer-hangup', 'Le pair distant a fermé la session WebRTC.'))
      return
    }
    if (payload.type === 'ice') { await receiveIce(payload); return }
    if (payload.type === 'offer') { await receiveOffer(payload.sdp); return }
    await receiveAnswer(payload.sdp)
  }
  const enqueue = (operation: () => Promise<void>): void => {
    if (queuedOperationCount >= maximumQueuedIceCandidates + 16) {
      fail(sessionError('rtc-peer-protocol-error', 'Le pair a saturé la file de négociation WebRTC.'))
      return
    }
    queuedOperationCount += 1
    operationQueue = operationQueue.then(async () => {
      if (!terminal) await operation()
    }).catch(fail).finally(() => { queuedOperationCount -= 1 })
  }
  const receiveSignalingEvent = (signal: RtcSignalingInboundSignal): void => {
    if (terminal) return
    enqueue(() => receivePayload(signal.payload))
  }
  const receiveSignalingState = (next: OnlineSignalingState): void => {
    if (terminal) return
    if (next.status === 'ready') {
      if (!isOnlineUserId(next.userId) || next.userId === descriptor.peerId) {
        fail(sessionError('rtc-signaling-unavailable', "L'identité de signalisation WebRTC est invalide."))
        return
      }
      signalingReady = true
      if (role === 'offerer') enqueue(beginOffer)
      return
    }
    signalingReady = false
    if (!connected && (next.status === 'closed' || next.status === 'failed')) {
      fail(next.error ?? sessionError('rtc-signaling-unavailable', 'La signalisation WebRTC a été fermée avant la connexion.'))
    }
  }
  function onIceCandidate(event: RTCPeerConnectionIceEvent): void {
    if (!terminal && event.candidate) {
      void sendSignal(icePayload(event.candidate)).catch((error: unknown) => {
        // Une fois le DataChannel établi, le VPS n'est plus une dépendance de
        // disponibilité. Un ACK ICE tardif ne doit donc jamais tuer le P2P.
        if (!connected) fail(error)
      })
    }
  }
  function onDataChannel(event: RTCDataChannelEvent): void {
    if (terminal) { try { event.channel.close() } catch { /* Session déjà fermée. */ } return }
    if (role !== 'answerer') {
      try { event.channel.close() } catch { /* Canal distant inattendu. */ }
      fail(sessionError('rtc-peer-protocol-error', "L'offreur ne doit pas recevoir un second canal WebRTC."))
      return
    }
    try { validateAndAdoptChannel(event.channel) } catch (error) { fail(error) }
  }
  function onConnectionStateChange(): void {
    if (terminal) return
    if (peerConnection?.connectionState === 'failed') {
      fail(sessionError('rtc-peer-connection-failed', 'La connexion WebRTC pair-à-pair a échoué.'))
    } else if (peerConnection?.connectionState === 'closed') closeRemote()
  }
  function onChannelOpen(): void {
    if (terminal || channelOpen) return
    channelOpen = true
    maybeComplete()
  }
  function onChannelClose(): void {
    if (terminal) return
    if (connected) closeRemote()
    else fail(sessionError('rtc-peer-connection-failed', "Le canal WebRTC s'est fermé avant la fin de la négociation."))
  }
  function onChannelError(): void {
    fail(sessionError('rtc-peer-connection-failed', 'Le canal WebRTC pair-à-pair a signalé une erreur.'))
  }

  return Object.freeze({
    getState: () => state,
    connect() {
      if (terminal) return Promise.reject(sessionError('rtc-session-closed', 'La session WebRTC est déjà fermée.'))
      if (connectPromise) return connectPromise
      publish('connecting')
      connectPromise = new Promise<RtcPeerConnectionLink>((resolve, reject) => {
        resolveConnect = resolve
        rejectConnect = reject
        try {
          peerConnection = connectionFactory(options.rtcConfiguration)
          peerConnection.addEventListener('icecandidate', onIceCandidate)
          peerConnection.addEventListener('datachannel', onDataChannel)
          peerConnection.addEventListener('connectionstatechange', onConnectionStateChange)
          const unsubscribeSignal = options.route.subscribe(receiveSignalingEvent)
          if (terminal) { unsubscribeSignal(); return }
          detachSignal = unsubscribeSignal
          const unsubscribeState = options.route.subscribeState(receiveSignalingState)
          if (terminal) { unsubscribeState(); return }
          detachSignalState = unsubscribeState
          timeout = setTimeout(() => fail(sessionError(
            'rtc-session-timeout',
            `La connexion WebRTC avec ${descriptor.peerId} a expiré.`,
          )), connectTimeoutMs)
        } catch (error) { fail(error) }
      })
      return connectPromise
    },
    close(reason = 'Session WebRTC fermée localement.') {
      if (terminal) return
      terminal = true
      connected = false
      sendHangup()
      const error = sessionError('rtc-session-closed', reason)
      rejectConnect?.(error)
      resolveConnect = undefined
      rejectConnect = undefined
      publish('closed')
      cleanup()
    },
  })
}
