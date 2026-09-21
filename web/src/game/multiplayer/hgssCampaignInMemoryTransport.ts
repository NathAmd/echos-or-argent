import type {
  HgssCampaignClientTransport,
  HgssCampaignClientTransportHandlers,
} from './hgssCampaignClientGateway'
import type {
  HgssCampaignServerCore,
  HgssCampaignServerError,
  HgssCampaignServerErrorCode,
} from './hgssCampaignServerCore'

export type HgssCampaignInMemoryTransportLocalErrorCode =
  | 'transport-already-connected'
  | 'transport-not-connected'

export type HgssCampaignInMemoryTransportErrorCode =
  | HgssCampaignServerErrorCode
  | HgssCampaignInMemoryTransportLocalErrorCode

/** Erreur conservant le code et le détail structurés de l'autorité serveur. */
export class HgssCampaignInMemoryTransportError extends Error {
  readonly code: HgssCampaignInMemoryTransportErrorCode
  readonly serverError?: HgssCampaignServerError

  constructor(
    code: HgssCampaignInMemoryTransportErrorCode,
    message: string,
    serverError?: HgssCampaignServerError,
  ) {
    super(message)
    this.name = 'HgssCampaignInMemoryTransportError'
    this.code = code
    this.serverError = serverError
  }
}

export type HgssCampaignInMemoryTransportOptions = Readonly<{
  server: HgssCampaignServerCore
  sessionId: string
  playerId: string
}>

function serverFailure(error: HgssCampaignServerError): HgssCampaignInMemoryTransportError {
  return new HgssCampaignInMemoryTransportError(error.code, error.message, error)
}

function missingSession(sessionId: string): HgssCampaignInMemoryTransportError {
  return serverFailure(Object.freeze({
    code: 'session-not-found',
    message: `La session de campagne ${sessionId} n'existe pas.`,
    sessionId,
  }))
}

function missingPlayer(sessionId: string, playerId: string): HgssCampaignInMemoryTransportError {
  return serverFailure(Object.freeze({
    code: 'player-not-found',
    message: `Le joueur ${playerId} ne fait pas partie de la campagne.`,
    sessionId,
    playerId,
  }))
}

/**
 * Relie une passerelle cliente au noyau autoritaire sans réseau ni stockage.
 * Une déconnexion retire uniquement l'abonnement local, jamais le joueur de
 * la session : l'entrée et la sortie de campagne restent des décisions métier.
 */
export function createHgssCampaignInMemoryTransport(
  options: HgssCampaignInMemoryTransportOptions,
): HgssCampaignClientTransport {
  const { server, sessionId, playerId } = options
  let handlers: HgssCampaignClientTransportHandlers | undefined
  let unsubscribe: (() => void) | undefined

  const requireConnection = (): HgssCampaignClientTransportHandlers => {
    if (!handlers || !unsubscribe) {
      throw new HgssCampaignInMemoryTransportError(
        'transport-not-connected',
        "Le transport de campagne en mémoire n'est pas connecté.",
      )
    }
    return handlers
  }

  const requirePlayerSnapshot = () => {
    const snapshot = server.getSnapshot(sessionId)
    if (!snapshot) throw missingSession(sessionId)
    if (!snapshot.players.some((player) => player.playerId === playerId)) {
      throw missingPlayer(sessionId, playerId)
    }
    return snapshot
  }

  return {
    transportKind: 'in-memory-test',
    connect(nextHandlers) {
      if (handlers || unsubscribe) {
        throw new HgssCampaignInMemoryTransportError(
          'transport-already-connected',
          'Le transport de campagne en mémoire est déjà connecté.',
        )
      }
      requirePlayerSnapshot()
      handlers = nextHandlers
      const subscription = server.subscribe(sessionId, (snapshot) => {
        if (!handlers) return
        if (!snapshot.players.some((player) => player.playerId === playerId)) {
          handlers.onError(missingPlayer(sessionId, playerId))
          return
        }
        handlers.onSnapshot(snapshot)
      })
      if (!subscription.ok) {
        handlers = undefined
        throw serverFailure(subscription.error)
      }
      unsubscribe = subscription.unsubscribe
    },
    disconnect() {
      unsubscribe?.()
      unsubscribe = undefined
      handlers = undefined
    },
    send(command) {
      requireConnection()
      const result = server.submitCommand(sessionId, playerId, command)
      if (!result.ok) throw serverFailure(result.error)
      return Object.freeze({
        appliedRevision: result.appliedRevision,
        replayed: result.kind === 'replayed',
        snapshot: result.snapshot,
      })
    },
    requestSnapshot() {
      requireConnection()
      return requirePlayerSnapshot()
    },
  }
}
