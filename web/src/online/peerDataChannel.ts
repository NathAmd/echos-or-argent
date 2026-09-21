export type PeerDataChannelState = 'connecting' | 'open' | 'closing' | 'closed'

export type PeerDataChannelHandlers = Readonly<{
  onOpen: () => void
  onMessage: (message: string) => void
  onClose: () => void
  onError: (error: unknown) => void
}>

export type PeerDataChannelWriteState = Readonly<{
  channelState: PeerDataChannelState
  /**
   * Indicate que le canal est ouvert et que `bufferedAmount` est sous le seuil
   * bas. L'appel à `send` reste l'autorité pour la taille exacte d'un message.
   */
  writable: boolean
  /** `null` protège le consommateur si un runtime expose une valeur invalide. */
  bufferedAmountBytes: number | null
  availableBufferBytes: number
  lowThresholdBytes: number
  maximumBufferedBytes: number
}>

export type PeerDataChannelBackpressure = Readonly<{
  getState: () => PeerDataChannelWriteState
  /**
   * Installe l'unique observateur de backpressure du canal. Il reçoit
   * immédiatement l'état courant, puis uniquement les changements de
   * writability/état RTC. La fonction retournée est idempotente.
   */
  subscribe: (listener: (state: PeerDataChannelWriteState) => void) => () => void
}>

/**
 * Frontière minimale d'un canal pair-à-pair déjà négocié. La
 * signalisation reste volontairement hors de ce contrat : elle ne voit jamais
 * les messages applicatifs qui transitent entre les deux navigateurs.
 */
export type PeerDataChannel = Readonly<{
  getState: () => PeerDataChannelState
  attach: (handlers: PeerDataChannelHandlers) => () => void
  send: (message: string) => void
  close: () => void
  /** Capacité optionnelle pour conserver les transports simples existants. */
  backpressure?: PeerDataChannelBackpressure
}>

export type PeerDataChannelErrorCode =
  | 'peer-channel-already-attached'
  | 'peer-channel-not-open'
  | 'peer-channel-invalid-message'
  | 'peer-channel-message-too-large'
  | 'peer-channel-buffer-limit'
  | 'peer-channel-transport-limit'

export class PeerDataChannelError extends Error {
  readonly code: PeerDataChannelErrorCode

  constructor(code: PeerDataChannelErrorCode, message: string) {
    super(message)
    this.name = 'PeerDataChannelError'
    this.code = code
  }
}

// Le snapshot maximal accepté par le protocole de campagne dépasse 64 Kio.
// 256 Kio laisse passer une trame complète tout en conservant une borne stricte.
export const peerDataChannelDefaultMaximumMessageBytes = 256 * 1_024
export const peerDataChannelDefaultMaximumBufferedBytes = 1_024 * 1_024
export const peerDataChannelDefaultMaximumFrameBytes = 16 * 1_024

export function measurePeerDataMessageBytes(message: string): number {
  return new TextEncoder().encode(message).byteLength
}
