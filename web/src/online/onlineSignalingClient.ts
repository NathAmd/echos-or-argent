import type { OnlineClientConfig } from './onlineClientConfig'
import { generateOnlineOpaqueId, isOnlineOpaqueId, isOnlineUserId, parseOnlineRealtimeEvent, parseOnlineSignalPayload, type OnlineRealtimeEvent, type OnlineRealtimeTicket, type OnlineSignalPayload } from './onlineServiceProtocol'

export type OnlineSignalingStatus = 'connecting' | 'ready' | 'closed' | 'failed'
export type OnlineSignalingState = Readonly<{ status: OnlineSignalingStatus, userId?: string, error?: Error }>

type WebSocketEventMap = Readonly<{
  open: Event
  message: MessageEvent
  close: CloseEvent
  error: Event
}>

export type OnlineWebSocket = Readonly<{
  readyState: number
  send: (data: string) => void
  close: (code?: number, reason?: string) => void
  addEventListener: <Kind extends keyof WebSocketEventMap>(kind: Kind, listener: (event: WebSocketEventMap[Kind]) => void) => void
  removeEventListener: <Kind extends keyof WebSocketEventMap>(kind: Kind, listener: (event: WebSocketEventMap[Kind]) => void) => void
}>

export type OnlineSignalingClient = Readonly<{
  getState: () => OnlineSignalingState
  sendSignal: (to: string, negotiationId: string, payload: OnlineSignalPayload, requestId?: string) => string
  subscribe: (listener: (event: OnlineRealtimeEvent) => void) => () => void
  subscribeState: (listener: (state: OnlineSignalingState) => void) => () => void
  close: () => void
}>

export type OnlineSignalingClientOptions = Readonly<{
  config: OnlineClientConfig
  ticket: OnlineRealtimeTicket
  socketFactory?: (url: string, protocol: string) => OnlineWebSocket
  requestIdFactory?: (serial: number) => string
}>

function defaultRequestId(): string { return generateOnlineOpaqueId() }

export function createOnlineSignalingClient(options: OnlineSignalingClientOptions): OnlineSignalingClient {
  if (!/^[A-Za-z0-9_-]{43}$/.test(options.ticket.ticket)) throw new Error('Ticket temps réel invalide.')
  const url = new URL(`${options.config.webSocketBaseUrl}/v1/realtime`)
  url.searchParams.set('ticket', options.ticket.ticket)
  const socket = (options.socketFactory ?? ((address, protocol) => new WebSocket(address, protocol)))(url.toString(), 'social-signaling.v1')
  const eventListeners = new Set<(event: OnlineRealtimeEvent) => void>()
  const stateListeners = new Set<(state: OnlineSignalingState) => void>()
  let state: OnlineSignalingState = Object.freeze({ status: 'connecting' })
  let serial = 0
  let closedByClient = false

  const publishState = (next: OnlineSignalingState): void => {
    state = Object.freeze(next)
    for (const listener of stateListeners) { try { listener(state) } catch (error) { void error } }
  }
  const fail = (message: string): void => {
    if (state.status === 'closed' || state.status === 'failed') return
    const error = new Error(message)
    publishState({ status: 'failed', error })
    socket.close(1002, 'Invalid signaling protocol')
  }
  const onOpen = (): void => undefined
  const onMessage = (message: MessageEvent): void => {
    if (typeof message.data !== 'string' || message.data.length > 64 * 1024) { fail('Message de signalisation invalide ou trop volumineux.'); return }
    let decoded: unknown
    try { decoded = JSON.parse(message.data) } catch { fail('Message JSON de signalisation invalide.'); return }
    const event = parseOnlineRealtimeEvent(decoded)
    if (!event) { fail('Événement de signalisation non conforme.'); return }
    if (event.type === 'ready') {
      if (state.status !== 'connecting') { fail('Événement ready de signalisation dupliqué.'); return }
      publishState({ status: 'ready', userId: event.userId })
    } else if (state.status !== 'ready') {
      fail("La signalisation n'a pas envoyé son événement ready initial.")
      return
    }
    for (const listener of eventListeners) { try { listener(event) } catch (error) { void error } }
  }
  const onClose = (event: CloseEvent): void => {
    if (state.status === 'failed') return
    publishState({ status: 'closed', ...(closedByClient || event.code === 1000 ? {} : { error: new Error(`Signalisation fermée (${event.code}).`) }) })
  }
  const onError = (): void => {
    if (state.status === 'connecting') publishState({ status: 'failed', error: new Error('Connexion au service de signalisation impossible.') })
  }
  socket.addEventListener('open', onOpen)
  socket.addEventListener('message', onMessage)
  socket.addEventListener('close', onClose)
  socket.addEventListener('error', onError)

  return Object.freeze({
    getState: () => state,
    sendSignal(to, negotiationId, payload, requestId) {
      if (state.status !== 'ready' || socket.readyState !== WebSocket.OPEN) throw new Error("La signalisation n'est pas prête.")
      if (!isOnlineUserId(to) || to === state.userId) throw new Error('Destinataire de signalisation invalide.')
      if (!isOnlineOpaqueId(negotiationId)) throw new Error('Identifiant opaque de négociation WebRTC invalide.')
      const parsedPayload = parseOnlineSignalPayload(payload)
      if (!parsedPayload) throw new Error('Payload WebRTC invalide.')
      serial += 1
      const id = requestId ?? (options.requestIdFactory ?? defaultRequestId)(serial)
      if (!isOnlineOpaqueId(id)) throw new Error('Identifiant opaque de signalisation invalide.')
      socket.send(JSON.stringify({ type: 'signal', requestId: id, negotiationId, to, payload: parsedPayload }))
      return id
    },
    subscribe(listener) {
      eventListeners.add(listener)
      return () => { eventListeners.delete(listener) }
    },
    subscribeState(listener) {
      stateListeners.add(listener)
      try { listener(state) } catch (error) { void error }
      return () => { stateListeners.delete(listener) }
    },
    close() {
      if (closedByClient) return
      closedByClient = true
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('message', onMessage)
      socket.removeEventListener('close', onClose)
      socket.removeEventListener('error', onError)
      if (socket.readyState < WebSocket.CLOSING) socket.close(1000, 'Client closed')
      publishState({ status: 'closed' })
      eventListeners.clear()
      stateListeners.clear()
    },
  })
}
