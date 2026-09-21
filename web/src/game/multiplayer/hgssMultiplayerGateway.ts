import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { parsePortablePokemonInstanceId, type PokemonInstanceId } from '../pokemon/pokemonInstanceId'
import type { HgssSafariAreaSet } from '../safari/hgssSafariState'

export const hgssMultiplayerProtocolVersion = 1 as const

export type HgssMultiplayerPlayer = {
  trainerId: number
  name: string
  gender: 'male' | 'female'
}

/**
 * Projection de jeu minimale envoyée au pair distant. Elle ne contient ni
 * libellé d'espèce, ni ressource ROM ; seul un surnom saisi par le joueur peut
 * traverser cette frontière.
 */
export type HgssMultiplayerPokemon = {
  instanceId: PokemonInstanceId
  speciesId: number
  nickname?: string
  form: number
  personality: number
  level: number
  experience: number
  currentHp: number
  status: number
  heldItemId: number
  abilityId: number
  gender: CanonicalPokemon['gender']
  shiny: boolean
  isEgg: boolean
  moves: { moveId: number, pp: number, maxPp: number, ppUps: number }[]
  stats: CanonicalPokemon['stats']
  individualValues: CanonicalPokemon['individualValues']
  effortValues: CanonicalPokemon['effortValues']
}

export type HgssRemoteFieldAvatar = {
  peerId: string
  player: HgssMultiplayerPlayer
  spriteId: number
  x: number
  z: number
  direction: 0 | 1 | 2 | 3
}

type HgssMultiplayerRequestBase = {
  protocolVersion: typeof hgssMultiplayerProtocolVersion
  requestId: string
  /** Numéro exact dans gScriptCmdTable HGSS. */
  romOpcode: number
  player: HgssMultiplayerPlayer
}

export type HgssMultiplayerRequest = HgssMultiplayerRequestBase & (
  | { kind: 'profile-status' }
  | { kind: 'friend-roster-count' }
  | { kind: 'dwc-profile-app', mode: number }
  | { kind: 'geonet-app' }
  /**
   * Club de communication lance par ScrCmd_226/227. Le club etablit la
   * paire avant que l'activite Safari n'echange son set avec ScrCmd_822.
   */
  | {
    kind: 'communication-club'
    role: 'host' | 'join'
    communicationType: number
    parameter1: number
    parameter2: number
  }
  | { kind: 'union-handshake', command: number }
  | { kind: 'union-session-open', command: number }
  | { kind: 'union-session-close' }
  | { kind: 'union-set-command', command: number }
  | { kind: 'union-set-activity', side: number, activity: number }
  | { kind: 'union-interaction-query', objectId: number, command: number }
  | { kind: 'union-interaction-state', objectId: number }
  | { kind: 'union-wait-contact' }
  | { kind: 'union-sync-avatars' }
  | { kind: 'union-activity-app', activity: number, party: HgssMultiplayerPokemon[] }
  | { kind: 'wireless-trade', party: HgssMultiplayerPokemon[] }
  | { kind: 'safari-area-exchange', areaSet: HgssSafariAreaSet, language: number, gameVersion: number }
)

export function decodeHgssCommunicationClubCommand(
  romOpcode: number,
  bytes: Uint8Array,
  operandOffset: number,
  readScriptValue: (offset: number) => number,
): {
  nextOffset: number
  destination: number
  request: Pick<Extract<HgssMultiplayerRequest, { kind: 'communication-club' }>, 'kind' | 'role' | 'communicationType' | 'parameter1' | 'parameter2'>
} {
  if (romOpcode !== 226 && romOpcode !== 227) throw new Error(`Opcode de club de communication HGSS invalide (${romOpcode}).`)
  if (operandOffset < 0 || operandOffset + 8 > bytes.length) throw new Error(`Opérandes tronqués pour l'opcode HGSS ${romOpcode}.`)
  return {
    nextOffset: operandOffset + 8,
    destination: bytes[operandOffset + 6]! | (bytes[operandOffset + 7]! << 8),
    request: {
      kind: 'communication-club',
      role: romOpcode === 226 ? 'join' : 'host',
      communicationType: readScriptValue(operandOffset),
      parameter1: readScriptValue(operandOffset + 2),
      parameter2: readScriptValue(operandOffset + 4),
    },
  }
}

export type HgssMultiplayerResult = {
  protocolVersion: typeof hgssMultiplayerProtocolVersion
  requestId: string
  kind: HgssMultiplayerRequest['kind']
  /** Valeur que la fonction native aurait écrite dans la variable script. */
  romResult: number
  status: 'completed' | 'cancelled' | 'offline' | 'error'
  friendRosterCount?: number
  remoteAvatars?: HgssRemoteFieldAvatar[]
  safariAreaSet?: HgssSafariAreaSet
  safariPlayer?: HgssMultiplayerPlayer & { language: number, gameVersion: number }
  errorCode?: string
}

export type HgssMultiplayerGateway = {
  execute: (request: HgssMultiplayerRequest) => Promise<HgssMultiplayerResult>
  cancel?: (requestId?: string) => void
  destroy?: () => void
}

export const hgssMultiplayerDataChannelTransportKind = 'rtc-data-channel' as const

/**
 * Transport applicatif pair-à-pair. Le marqueur obligatoire empêche de
 * brancher par accident un client HTTP ou WebSocket à cette ancienne API.
 */
export type HgssMultiplayerDataChannelTransport = Readonly<{
  transportKind: typeof hgssMultiplayerDataChannelTransportKind
  execute: (
    request: HgssMultiplayerRequest,
    signal?: AbortSignal,
  ) => Promise<HgssMultiplayerResult>
}>

/** @deprecated Utiliser `HgssMultiplayerDataChannelTransport`. */
export type HgssMultiplayerTransport = HgssMultiplayerDataChannelTransport

export function serializeHgssMultiplayerPokemon(pokemon: CanonicalPokemon): HgssMultiplayerPokemon {
  return {
    instanceId: parsePortablePokemonInstanceId(pokemon.instanceId),
    speciesId: pokemon.speciesId,
    ...(pokemon.nickname !== undefined && pokemon.nicknameSource === 'user-text'
      ? { nickname: pokemon.nickname }
      : {}),
    form: pokemon.form,
    personality: pokemon.personality,
    level: pokemon.level,
    experience: pokemon.experience,
    currentHp: pokemon.currentHp,
    status: pokemon.status,
    heldItemId: pokemon.heldItemId,
    abilityId: pokemon.abilityId,
    gender: pokemon.gender,
    shiny: pokemon.shiny,
    isEgg: pokemon.isEgg,
    moves: pokemon.moves.map(({ moveId, pp, maxPp, ppUps }) => ({ moveId, pp, maxPp, ppUps })),
    stats: { ...pokemon.stats },
    individualValues: { ...pokemon.individualValues },
    effortValues: { ...pokemon.effortValues },
  }
}

export function assertHgssMultiplayerResult(
  request: HgssMultiplayerRequest,
  result: HgssMultiplayerResult,
): void {
  if (result.protocolVersion !== hgssMultiplayerProtocolVersion) {
    throw new Error(`Version multijoueur HGSS ${result.protocolVersion} incompatible.`)
  }
  if (result.requestId !== request.requestId || result.kind !== request.kind) {
    throw new Error(`Réponse multijoueur HGSS désynchronisée pour ${request.requestId}.`)
  }
  if (!Number.isInteger(result.romResult) || result.romResult < 0 || result.romResult > 0xffff) {
    throw new Error(`Résultat ROM multijoueur invalide pour ${request.requestId}.`)
  }
  if (request.kind === 'safari-area-exchange' && result.status === 'completed') {
    if (!result.safariAreaSet || !result.safariPlayer) throw new Error(`Échange de set Safari incomplet pour ${request.requestId}.`)
    if (!Number.isInteger(result.safariPlayer.language) || !Number.isInteger(result.safariPlayer.gameVersion)) {
      throw new Error(`Profil du meneur Safari invalide pour ${request.requestId}.`)
    }
  }
}

/** Crée la passerelle historique sur un RTCDataChannel exclusivement. */
export function createDataChannelHgssMultiplayerGateway(
  transport: HgssMultiplayerDataChannelTransport,
): HgssMultiplayerGateway {
  if (transport?.transportKind !== hgssMultiplayerDataChannelTransportKind
    || typeof transport.execute !== 'function') {
    throw new TypeError('La passerelle multijoueur HGSS exige un transport RTCDataChannel pair-à-pair.')
  }
  return {
    async execute(request) {
      const result = await transport.execute(request)
      assertHgssMultiplayerResult(request, result)
      return result
    },
  }
}

/** @deprecated Alias conservé pour les appelants existants, avec la même restriction DataChannel. */
export function createTransportHgssMultiplayerGateway(
  transport: HgssMultiplayerDataChannelTransport,
): HgssMultiplayerGateway {
  return createDataChannelHgssMultiplayerGateway(transport)
}

export function createOfflineHgssMultiplayerResult(request: HgssMultiplayerRequest): HgssMultiplayerResult {
  // Le code 4 est une sortie native du club de communication. Il permet aux
  // scripts des guichets de fermer proprement le dialogue sans fabriquer un
  // pair distant ni poursuivre vers l'echange de donnees.
  const romResult = request.kind === 'union-wait-contact'
    ? 2
    : request.kind === 'communication-club'
      ? 4
      : 0
  return {
    protocolVersion: hgssMultiplayerProtocolVersion,
    requestId: request.requestId,
    kind: request.kind,
    romResult,
    status: 'offline',
    friendRosterCount: request.kind === 'friend-roster-count' ? 0 : undefined,
    remoteAvatars: request.kind === 'union-sync-avatars' ? [] : undefined,
  }
}

/**
 * HGSS sans connexion ne fabrique ni ami ni avatar distant. Les attentes de la
 * Salle Union reçoivent 2, valeur traitée par ses scripts comme une annulation.
 */
export function createOfflineHgssMultiplayerGateway(): HgssMultiplayerGateway {
  return {
    async execute(request) { return createOfflineHgssMultiplayerResult(request) },
  }
}

export async function executeHgssMultiplayerWithOfflineFallback(
  gateway: HgssMultiplayerGateway,
  request: HgssMultiplayerRequest,
): Promise<{ result: HgssMultiplayerResult } | { result: HgssMultiplayerResult, error: unknown }> {
  try {
    return { result: await gateway.execute(request) }
  } catch (error) {
    return { result: createOfflineHgssMultiplayerResult(request), error }
  }
}
