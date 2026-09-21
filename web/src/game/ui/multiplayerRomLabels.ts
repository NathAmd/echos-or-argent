import { stripMessageControls } from '../../rom/messages/hgssMessageBank'

export type MultiplayerRomLabelKey =
  | 'multiplayer'
  | 'play'
  | 'friends'
  | 'requests'
  | 'session'
  | 'trade'
  | 'account'
  | 'back'
  | 'close'

export type MultiplayerRomLabels = Readonly<Record<MultiplayerRomLabelKey, string>>

type RomUiBanks = Readonly<Record<number, Readonly<Record<number, string>>>>

const fallbackLabels: MultiplayerRomLabels = Object.freeze({
  multiplayer: 'Multijoueur',
  play: 'Jouer',
  friends: 'Amis',
  requests: 'Demandes',
  session: 'Session',
  trade: 'Échange',
  account: 'Compte',
  back: 'Retour',
  close: 'Fermer',
})

function readLabel(banks: RomUiBanks | undefined, bankId: number, messageId: number): string {
  return stripMessageControls(banks?.[bankId]?.[messageId] ?? '').replace(/[\f\r\n]+/g, ' ').trim()
}

function withoutInputPrefix(value: string): string {
  return value.replace(/^\S{1,3}:\s*/u, '').trim()
}

function withoutQuestion(value: string): string {
  return value.replace(/[?¿]\s*$/u, '').trim()
}

function firstWord(value: string): string {
  return /^\p{L}+(?:[’'-]\p{L}+)?/u.exec(value)?.[0] ?? ''
}

/**
 * Réemploie des messages réseau HGSS proches des concepts du remaster. Les
 * coordonnées sont stables entre langues : seule la ROM choisie fournit le
 * texte, puis des coupes neutres retirent le contexte trop spécifique.
 */
export function resolveMultiplayerRomLabels(banks: RomUiBanks | undefined): MultiplayerRomLabels {
  return Object.freeze({
    multiplayer: readLabel(banks, 19, 45) || fallbackLabels.multiplayer,
    play: withoutInputPrefix(readLabel(banks, 191, 336)) || fallbackLabels.play,
    friends: readLabel(banks, 191, 282) || fallbackLabels.friends,
    requests: withoutQuestion(readLabel(banks, 191, 156)) || fallbackLabels.requests,
    session: firstWord(readLabel(banks, 442, 3)) || fallbackLabels.session,
    trade: readLabel(banks, 191, 23) || fallbackLabels.trade,
    account: readLabel(banks, 282, 5) || fallbackLabels.account,
    back: readLabel(banks, 196, 21) || fallbackLabels.back,
    close: readLabel(banks, 45, 8) || fallbackLabels.close,
  })
}
