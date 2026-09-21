import { isOnlineOpaqueId } from '../../online/onlineServiceProtocol'
import {
  parsePortablePokemonInstanceId,
  type PokemonInstanceId,
} from '../pokemon/pokemonInstanceId'

export const hgssP2pTradeReceiptLimit = 64

/**
 * Preuve locale minimale qu'une transaction P2P a deja modifie la sauvegarde.
 * Elle ne contient aucun libelle ni contenu issu de la ROM.
 */
export type HgssP2pTradeReceipt = Readonly<{
  transactionId: string
  sentPokemonInstanceId: PokemonInstanceId
  receivedPokemonInstanceId: PokemonInstanceId
}>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null
    && typeof value === 'object'
    && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
}

export function parseHgssP2pTradeReceipt(value: unknown): HgssP2pTradeReceipt {
  if (!isRecord(value)) throw new Error("Le recu d'echange P2P est invalide.")
  const keys = Object.keys(value).sort()
  if (
    keys.length !== 3
    || keys[0] !== 'receivedPokemonInstanceId'
    || keys[1] !== 'sentPokemonInstanceId'
    || keys[2] !== 'transactionId'
    || !isOnlineOpaqueId(value.transactionId)
  ) throw new Error("Le recu d'echange P2P est invalide.")

  const sentPokemonInstanceId = parsePortablePokemonInstanceId(value.sentPokemonInstanceId)
  const receivedPokemonInstanceId = parsePortablePokemonInstanceId(value.receivedPokemonInstanceId)
  if (sentPokemonInstanceId === receivedPokemonInstanceId) {
    throw new Error("Le recu d'echange P2P reference deux fois le meme Pokemon.")
  }
  return Object.freeze({
    transactionId: value.transactionId,
    sentPokemonInstanceId,
    receivedPokemonInstanceId,
  })
}

export function parseHgssP2pTradeReceipts(value: unknown): readonly HgssP2pTradeReceipt[] {
  if (!Array.isArray(value) || value.length > hgssP2pTradeReceiptLimit) {
    throw new Error("L'historique des echanges P2P est invalide.")
  }
  const receipts = value.map(parseHgssP2pTradeReceipt)
  if (new Set(receipts.map(({ transactionId }) => transactionId)).size !== receipts.length) {
    throw new Error("L'historique des echanges P2P contient une transaction dupliquee.")
  }
  return Object.freeze(receipts)
}

/** Ajout idempotent avec conservation bornee des transactions les plus recentes. */
export function appendHgssP2pTradeReceipt(
  receipts: readonly HgssP2pTradeReceipt[],
  receipt: HgssP2pTradeReceipt,
): HgssP2pTradeReceipt[] {
  const current = parseHgssP2pTradeReceipts(receipts)
  const parsed = parseHgssP2pTradeReceipt(receipt)
  const existing = current.find(({ transactionId }) => transactionId === parsed.transactionId)
  if (existing) {
    if (
      existing.sentPokemonInstanceId !== parsed.sentPokemonInstanceId
      || existing.receivedPokemonInstanceId !== parsed.receivedPokemonInstanceId
    ) throw new Error("La transaction P2P existe deja avec un autre resultat.")
    return current.map((entry) => ({ ...entry }))
  }
  return [...current, parsed]
    .slice(-hgssP2pTradeReceiptLimit)
    .map((entry) => ({ ...entry }))
}
