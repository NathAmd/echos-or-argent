import {
  assertHgssMultiplayerResult,
  createOfflineHgssMultiplayerGateway,
  createOfflineHgssMultiplayerResult,
  hgssMultiplayerProtocolVersion,
  type HgssMultiplayerGateway,
  type HgssMultiplayerPlayer,
  type HgssMultiplayerRequest,
  type HgssMultiplayerResult,
} from './hgssMultiplayerGateway'
import {
  createHgssLocalWirelessExchangePayload,
  createHgssLocalWirelessSessionId,
  getHgssLocalWirelessMatch,
  hgssLocalWirelessNamespace,
  parseHgssLocalWirelessMessage,
  sameHgssLocalWirelessMatch,
  sameHgssLocalWirelessPlayer,
  type HgssLocalWirelessExchangePayload,
  type HgssLocalWirelessMatch,
  type HgssLocalWirelessMessage,
} from './hgssLocalWirelessProtocol'

export const hgssLocalWirelessDefaultChannelName = 'pokemaster-hgss-local-wireless-v1' as const
export const hgssLocalWirelessDefaultTimeoutMs = 30_000 as const

export type HgssLocalWirelessChannel = {
  postMessage: (message: unknown) => void
  addEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  removeEventListener: (type: 'message', listener: (event: { data: unknown }) => void) => void
  close: () => void
}

export type HgssLocalWirelessScheduler = {
  setTimeout: (callback: () => void, delayMs: number) => unknown
  clearTimeout: (handle: unknown) => void
}

export type HgssLocalWirelessGatewayOptions = {
  instanceId: string
  channelFactory: (name: string) => HgssLocalWirelessChannel
  channelName?: string
  timeoutMs?: number
  scheduler?: HgssLocalWirelessScheduler
  fallbackGateway?: HgssMultiplayerGateway
}

type CommunicationRequest = Extract<HgssMultiplayerRequest, { kind: 'communication-club' }>
type ExchangeRequest = Extract<HgssMultiplayerRequest, { kind: 'safari-area-exchange' }>
type LocalStatus = HgssMultiplayerResult['status']
type SessionCloseReason = Extract<HgssLocalWirelessMessage, { type: 'session-close' }>['reason']
type OutgoingWireMessage<T = HgssLocalWirelessMessage> = T extends HgssLocalWirelessMessage
  ? Omit<T, 'namespace' | 'protocolVersion' | 'from'>
  : never

type PeerCandidate = {
  peerId: string
  remoteOperationId: string
  sessionId: string
  remotePlayer: HgssMultiplayerPlayer
}

type PendingClub = {
  request: CommunicationRequest
  operationId: string
  match: HgssLocalWirelessMatch
  timer: unknown
  resolve: (result: HgssMultiplayerResult) => void
  candidate?: PeerCandidate
}

type ActiveSession = {
  sessionId: string
  peerId: string
  match: HgssLocalWirelessMatch
  localRole: 'host' | 'join'
  localPlayer: HgssMultiplayerPlayer
  remotePlayer: HgssMultiplayerPlayer
  localOperationId: string
  remoteOperationId: string
  exchangeRound: number
}

type PendingExchange = {
  request: ExchangeRequest
  round: number
  payload: HgssLocalWirelessExchangePayload
  timer: unknown
  resolve: (result: HgssMultiplayerResult) => void
}

const defaultScheduler: HgssLocalWirelessScheduler = {
  setTimeout: (callback, delayMs) => globalThis.setTimeout(callback, delayMs),
  clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
}

function localResult(
  request: HgssMultiplayerRequest,
  status: LocalStatus,
  remote?: HgssLocalWirelessExchangePayload,
  errorCode?: string,
): HgssMultiplayerResult {
  const result: HgssMultiplayerResult = {
    protocolVersion: hgssMultiplayerProtocolVersion,
    requestId: request.requestId,
    kind: request.kind,
    romResult: request.kind === 'communication-club' ? status === 'completed' ? 2 : status === 'error' ? 3 : 4 : 0,
    status,
    safariAreaSet: remote?.areaSet,
    safariPlayer: remote?.player,
    errorCode,
  }
  assertHgssMultiplayerResult(request, result)
  return result
}

function createOperationId(instanceId: string, serial: number): string {
  return JSON.stringify([instanceId, serial])
}

function createBrowserChannel(name: string): HgssLocalWirelessChannel {
  const channel = new BroadcastChannel(name)
  const listeners = new Map<(event: { data: unknown }) => void, (event: MessageEvent<unknown>) => void>()
  return {
    postMessage: (message) => channel.postMessage(message),
    addEventListener: (_type, listener) => {
      const wrapped = (event: MessageEvent<unknown>) => listener(event)
      listeners.set(listener, wrapped)
      channel.addEventListener('message', wrapped)
    },
    removeEventListener: (_type, listener) => {
      const wrapped = listeners.get(listener)
      if (wrapped) channel.removeEventListener('message', wrapped)
      listeners.delete(listener)
    },
    close: () => { listeners.clear(); channel.close() },
  }
}

function createBrowserInstanceId(): string | undefined {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  if (typeof globalThis.crypto?.getRandomValues !== 'function') return undefined
  const bytes = globalThis.crypto.getRandomValues(new Uint32Array(4))
  return Array.from(bytes, (value) => value.toString(16).padStart(8, '0')).join('')
}

/**
 * Transport local wireless same-origin. Le canal ne décide aucune donnée de
 * jeu : il apparie deux requêtes ROM compatibles puis échange leurs payloads.
 */
export function createHgssLocalWirelessGateway(options: HgssLocalWirelessGatewayOptions): HgssMultiplayerGateway {
  if (!options.instanceId || options.instanceId.length > 128) throw new Error("L'identifiant d'instance local wireless HGSS est invalide.")
  const timeoutMs = options.timeoutMs ?? hgssLocalWirelessDefaultTimeoutMs
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) throw new Error('Le délai local wireless HGSS est invalide.')
  const scheduler = options.scheduler ?? defaultScheduler
  const fallback = options.fallbackGateway ?? createOfflineHgssMultiplayerGateway()
  const channel = options.channelFactory(options.channelName ?? hgssLocalWirelessDefaultChannelName)
  const instanceId = options.instanceId
  let destroyed = false
  let operationSerial = 0
  let pendingClub: PendingClub | undefined
  let activeSession: ActiveSession | undefined
  let pendingExchange: PendingExchange | undefined
  const cachedExchangePayloads = new Map<number, HgssLocalWirelessExchangePayload>()

  const post = (message: OutgoingWireMessage): boolean => {
    if (destroyed) return false
    try {
      channel.postMessage({
        namespace: hgssLocalWirelessNamespace,
        protocolVersion: hgssMultiplayerProtocolVersion,
        from: instanceId,
        ...message,
      })
      return true
    } catch {
      return false
    }
  }

  const settleClub = (status: LocalStatus, errorCode?: string): void => {
    const pending = pendingClub
    if (!pending) return
    pendingClub = undefined
    scheduler.clearTimeout(pending.timer)
    pending.resolve(localResult(pending.request, status, undefined, errorCode))
  }

  const settleExchange = (
    status: LocalStatus,
    remote?: HgssLocalWirelessExchangePayload,
    errorCode?: string,
  ): void => {
    const pending = pendingExchange
    if (!pending) return
    pendingExchange = undefined
    scheduler.clearTimeout(pending.timer)
    cachedExchangePayloads.delete(pending.round)
    if (status === 'completed' && activeSession) activeSession.exchangeRound += 1
    pending.resolve(localResult(pending.request, status, remote, errorCode))
  }

  const closeSession = (
    reason: SessionCloseReason,
    notifyPeer: boolean,
    pendingStatus: 'cancelled' | 'offline' = 'cancelled',
  ): void => {
    const session = activeSession
    if (session && notifyPeer) post({ type: 'session-close', to: session.peerId, sessionId: session.sessionId, reason })
    settleExchange(pendingStatus, undefined, `session-${reason}`)
    activeSession = undefined
    cachedExchangePayloads.clear()
  }

  const clubWire = (pending: PendingClub, candidate: PeerCandidate) => {
    const hostOperationId = pending.request.role === 'host' ? pending.operationId : candidate.remoteOperationId
    const joinOperationId = pending.request.role === 'join' ? pending.operationId : candidate.remoteOperationId
    return {
      to: candidate.peerId,
      hostOperationId,
      joinOperationId,
      sessionId: createHgssLocalWirelessSessionId(hostOperationId, joinOperationId),
      match: pending.match,
    }
  }

  const advertiseClub = (pending: PendingClub): boolean => post({
    type: 'club-advertise',
    operationId: pending.operationId,
    role: pending.request.role,
    match: pending.match,
    player: pending.request.player,
  })

  const establishSession = (pending: PendingClub, candidate: PeerCandidate): ActiveSession => ({
    sessionId: candidate.sessionId,
    peerId: candidate.peerId,
    match: pending.match,
    localRole: pending.request.role,
    localPlayer: { ...pending.request.player },
    remotePlayer: { ...candidate.remotePlayer },
    localOperationId: pending.operationId,
    remoteOperationId: candidate.remoteOperationId,
    exchangeRound: 0,
  })

  const handleClubAdvertise = (message: Extract<HgssLocalWirelessMessage, { type: 'club-advertise' }>): void => {
    const pending = pendingClub
    if (!pending || pending.request.role === message.role || !sameHgssLocalWirelessMatch(pending.match, message.match)) return
    const hostOperationId = pending.request.role === 'host' ? pending.operationId : message.operationId
    const joinOperationId = pending.request.role === 'join' ? pending.operationId : message.operationId
    const candidate: PeerCandidate = {
      peerId: message.from,
      remoteOperationId: message.operationId,
      sessionId: createHgssLocalWirelessSessionId(hostOperationId, joinOperationId),
      remotePlayer: message.player,
    }
    if (pending.candidate && (pending.candidate.peerId !== candidate.peerId || pending.candidate.remoteOperationId !== candidate.remoteOperationId)) return
    pending.candidate ??= candidate
    if (pending.request.role === 'join') {
      advertiseClub(pending)
      return
    }
    post({ type: 'club-offer', ...clubWire(pending, candidate), player: pending.request.player })
  }

  const validCandidateMessage = (
    pending: PendingClub,
    message: Extract<HgssLocalWirelessMessage, { type: 'club-offer' | 'club-accept' | 'club-ready' }>,
    expectedLocalRole: 'host' | 'join',
  ): boolean => {
    const localOperationId = expectedLocalRole === 'host' ? message.hostOperationId : message.joinOperationId
    const remoteOperationId = expectedLocalRole === 'host' ? message.joinOperationId : message.hostOperationId
    return message.to === instanceId
      && pending.request.role === expectedLocalRole
      && pending.operationId === localOperationId
      && message.sessionId === createHgssLocalWirelessSessionId(message.hostOperationId, message.joinOperationId)
      && sameHgssLocalWirelessMatch(pending.match, message.match)
      && (!pending.candidate || pending.candidate.peerId === message.from && pending.candidate.remoteOperationId === remoteOperationId)
  }

  const handleClubOffer = (message: Extract<HgssLocalWirelessMessage, { type: 'club-offer' }>): void => {
    const pending = pendingClub
    if (!pending || !validCandidateMessage(pending, message, 'join')) return
    if (pending.candidate && !sameHgssLocalWirelessPlayer(pending.candidate.remotePlayer, message.player)) return
    pending.candidate ??= {
      peerId: message.from,
      remoteOperationId: message.hostOperationId,
      sessionId: message.sessionId,
      remotePlayer: message.player,
    }
    post({ type: 'club-accept', ...clubWire(pending, pending.candidate), player: pending.request.player })
  }

  const handleClubAccept = (message: Extract<HgssLocalWirelessMessage, { type: 'club-accept' }>): void => {
    const pending = pendingClub
    if (!pending) {
      const session = activeSession
      if (session?.localRole === 'host' && session.peerId === message.from && session.sessionId === message.sessionId) {
        post({
          type: 'club-ready', to: session.peerId, hostOperationId: session.localOperationId,
          joinOperationId: session.remoteOperationId, sessionId: session.sessionId, match: session.match,
        })
      }
      return
    }
    if (!validCandidateMessage(pending, message, 'host') || !pending.candidate
      || !sameHgssLocalWirelessPlayer(pending.candidate.remotePlayer, message.player)) return
    activeSession = establishSession(pending, pending.candidate)
    post({ type: 'club-ready', ...clubWire(pending, pending.candidate) })
    settleClub('completed')
  }

  const handleClubReady = (message: Extract<HgssLocalWirelessMessage, { type: 'club-ready' }>): void => {
    const pending = pendingClub
    if (!pending || !validCandidateMessage(pending, message, 'join') || !pending.candidate) return
    activeSession = establishSession(pending, pending.candidate)
    settleClub('completed')
  }

  const handleClubWithdraw = (message: Extract<HgssLocalWirelessMessage, { type: 'club-withdraw' }>): void => {
    const candidate = pendingClub?.candidate
    if (candidate?.peerId === message.from && candidate.remoteOperationId === message.operationId) settleClub('cancelled', 'peer-withdrew')
  }

  const handleExchange = (message: Extract<HgssLocalWirelessMessage, { type: 'safari-exchange' }>): void => {
    const session = activeSession
    if (!session || message.to !== instanceId || message.from !== session.peerId || message.sessionId !== session.sessionId
      || message.round !== session.exchangeRound || !sameHgssLocalWirelessPlayer(message.payload.player, session.remotePlayer)) return
    cachedExchangePayloads.set(message.round, message.payload)
    if (pendingExchange?.round === message.round) settleExchange('completed', message.payload)
  }

  const handleMessage = (event: { data: unknown }): void => {
    const message = parseHgssLocalWirelessMessage(event.data)
    if (!message || message.from === instanceId) return
    if (message.type === 'club-advertise') handleClubAdvertise(message)
    else if (message.type === 'club-offer') handleClubOffer(message)
    else if (message.type === 'club-accept') handleClubAccept(message)
    else if (message.type === 'club-ready') handleClubReady(message)
    else if (message.type === 'club-withdraw') handleClubWithdraw(message)
    else if (message.type === 'safari-exchange') handleExchange(message)
    else if (message.type === 'session-close' && message.to === instanceId && activeSession?.peerId === message.from
      && activeSession.sessionId === message.sessionId) {
      closeSession(message.reason, false, message.reason === 'cancelled' || message.reason === 'replaced' ? 'cancelled' : 'offline')
    }
  }

  channel.addEventListener('message', handleMessage)

  const executeClub = (request: CommunicationRequest): Promise<HgssMultiplayerResult> => {
    if (pendingClub) {
      post({ type: 'club-withdraw', operationId: pendingClub.operationId })
      settleClub('cancelled', 'replaced')
    }
    if (activeSession) closeSession('replaced', true)
    return new Promise((resolve) => {
      const operationId = createOperationId(instanceId, operationSerial++)
      const pending: PendingClub = {
        request,
        operationId,
        match: getHgssLocalWirelessMatch(request),
        timer: undefined,
        resolve,
      }
      pending.timer = scheduler.setTimeout(() => {
        if (pendingClub !== pending) return
        post({ type: 'club-withdraw', operationId: pending.operationId })
        settleClub('offline', 'timeout')
      }, timeoutMs)
      pendingClub = pending
      if (!advertiseClub(pending)) settleClub('offline', 'channel-unavailable')
    })
  }

  const executeExchange = (request: ExchangeRequest): Promise<HgssMultiplayerResult> => {
    const session = activeSession
    if (!session) return Promise.resolve(createOfflineHgssMultiplayerResult(request))
    if (!sameHgssLocalWirelessPlayer(request.player, session.localPlayer)) {
      return Promise.resolve(localResult(request, 'error', undefined, 'session-player-mismatch'))
    }
    if (pendingExchange) return Promise.resolve(localResult(request, 'error', undefined, 'exchange-already-pending'))
    let payload: HgssLocalWirelessExchangePayload
    try {
      payload = createHgssLocalWirelessExchangePayload(request)
    } catch {
      return Promise.resolve(localResult(request, 'error', undefined, 'invalid-local-payload'))
    }
    return new Promise((resolve) => {
      const pending: PendingExchange = {
        request,
        round: session.exchangeRound,
        payload,
        timer: undefined,
        resolve,
      }
      pending.timer = scheduler.setTimeout(() => {
        if (pendingExchange !== pending) return
        settleExchange('offline', undefined, 'timeout')
        closeSession('timeout', true, 'offline')
      }, timeoutMs)
      pendingExchange = pending
      const sent = post({
        type: 'safari-exchange', to: session.peerId, sessionId: session.sessionId,
        round: pending.round, requestId: request.requestId, payload,
      })
      const cached = cachedExchangePayloads.get(pending.round)
      if (!sent) {
        settleExchange('offline', undefined, 'channel-unavailable')
        closeSession('timeout', false, 'offline')
      } else if (cached) settleExchange('completed', cached)
    })
  }

  const gateway: HgssMultiplayerGateway = {
    execute(request) {
      if (destroyed) return Promise.resolve(createOfflineHgssMultiplayerResult(request))
      if (request.protocolVersion !== hgssMultiplayerProtocolVersion) {
        return Promise.resolve(localResult(request, 'error', undefined, 'protocol-mismatch'))
      }
      if (request.kind === 'communication-club') return executeClub(request)
      if (request.kind === 'safari-area-exchange') return executeExchange(request)
      if (request.kind === 'union-handshake' && activeSession) return Promise.resolve(localResult(request, 'completed'))
      if (request.kind === 'union-session-close' && activeSession) {
        closeSession('cancelled', true)
        return Promise.resolve(localResult(request, 'completed'))
      }
      return fallback.execute(request)
    },
    cancel(requestId) {
      if (pendingClub && (requestId === undefined || requestId === pendingClub.request.requestId)) {
        post({ type: 'club-withdraw', operationId: pendingClub.operationId })
        settleClub('cancelled', 'cancelled')
      }
      if (pendingExchange && (requestId === undefined || requestId === pendingExchange.request.requestId)) {
        closeSession('cancelled', true, 'cancelled')
      } else if (requestId === undefined && activeSession) closeSession('cancelled', true)
      fallback.cancel?.(requestId)
    },
    destroy() {
      if (destroyed) return
      if (pendingClub) {
        post({ type: 'club-withdraw', operationId: pendingClub.operationId })
        settleClub('cancelled', 'destroyed')
      }
      if (activeSession) closeSession('destroyed', true, 'cancelled')
      else settleExchange('cancelled', undefined, 'destroyed')
      destroyed = true
      channel.removeEventListener('message', handleMessage)
      channel.close()
      fallback.destroy?.()
    },
  }
  return gateway
}

/** Choisit BroadcastChannel quand le navigateur le permet, sinon le mode natif hors ligne. */
export function createBrowserHgssMultiplayerGateway(): HgssMultiplayerGateway {
  if (typeof BroadcastChannel === 'undefined') return createOfflineHgssMultiplayerGateway()
  const instanceId = createBrowserInstanceId()
  if (!instanceId) return createOfflineHgssMultiplayerGateway()
  try {
    return createHgssLocalWirelessGateway({ instanceId, channelFactory: createBrowserChannel })
  } catch {
    return createOfflineHgssMultiplayerGateway()
  }
}
