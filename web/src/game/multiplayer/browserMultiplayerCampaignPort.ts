import type { PeerDataChannel } from '../../online/peerDataChannel'
import type { HgssCampaignPeerHostBinding } from './hgssCampaignPeerBridge'

/**
 * Fermeture applicative envoyée par l'autorité lorsqu'un même compte reprend
 * sa campagne depuis un appareil plus récent. L'ancien appareil ne possède
 * alors plus l'adhésion serveur et ne doit surtout pas tenter de la libérer.
 */
export const browserMultiplayerCampaignConnectionReplacedErrorCode =
  'campaign-connection-replaced' as const

export type BrowserMultiplayerCampaignConnectionReplacedError = Error & Readonly<{
  code: typeof browserMultiplayerCampaignConnectionReplacedErrorCode
}>

export function isBrowserMultiplayerCampaignConnectionReplacedError(
  value: unknown,
): value is BrowserMultiplayerCampaignConnectionReplacedError {
  return value instanceof Error
    && Reflect.get(value, 'code') === browserMultiplayerCampaignConnectionReplacedErrorCode
}

type BrowserMultiplayerCampaignContextBase = Readonly<{
  sessionId: string
  localParticipantId: string
  remoteParticipantId: string
  role: 'host' | 'guest'
  /** Annule immédiatement un bootstrap, un rendez-vous ou une session quittée. */
  signal: AbortSignal
  /** Rend au runtime la fermeture distante ou applicative d'une session déjà armée. */
  onTerminated: (error?: Error) => void
}>

/** Route historique pair-à-pair. L'absence du discriminant préserve les appelants RTC existants. */
export type BrowserMultiplayerPeerCampaignStartContext = BrowserMultiplayerCampaignContextBase & Readonly<{
  transport?: 'peer'
  channel: PeerDataChannel
  rendezvousExpiresAt?: never
  /** Présent uniquement chez l'hôte, émis après consommation du lien RTC physique. */
  hostBinding?: HgssCampaignPeerHostBinding
}>

/** Route Coop serveur : aucun canal ni binding pair-à-pair ne peut y être injecté. */
export type BrowserMultiplayerDirectCampaignStartContext = BrowserMultiplayerCampaignContextBase & Readonly<{
  transport: 'server'
  rendezvousExpiresAt: number
  channel?: never
  hostBinding?: never
}>

export type BrowserMultiplayerCampaignStartContext =
  | BrowserMultiplayerPeerCampaignStartContext
  | BrowserMultiplayerDirectCampaignStartContext

export type BrowserMultiplayerCampaignSession = Readonly<{
  close: () => Promise<void> | void
}>

/** Port applicatif optionnel : son absence garde la Coop invisible et fermée. */
export type BrowserMultiplayerCampaignPort = Readonly<{
  start: (
    context: BrowserMultiplayerCampaignStartContext,
  ) => Promise<BrowserMultiplayerCampaignSession> | BrowserMultiplayerCampaignSession
}>
