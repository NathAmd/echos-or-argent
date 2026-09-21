import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import { basePokemonTeamPolicy, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { basePokemonPartyHealingPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { baseBattleActionPolicy, type BattleActionPolicy, type BattleBagActionRole, type PlayerBattleActionIntent } from './battleActionPolicy'
import { getDoubleBattleTeamPolicyVeto } from './doubleBattleSwitching'
import { resolveBaseFieldBattleBagAction } from './fieldBattleBagActionResolver'
import {
  executeDoubleBattleTurn,
  getRequiredDoubleBattleActors,
  type DoubleBattleAction,
  type DoubleBattleEvent,
  type DoubleBattlePosition,
  type DoubleBattleSession,
} from './doubleBattleSession'

export type DoubleBattleActionAdmissionRejection = Readonly<{
  accepted: false
  code: 'trainer-item' | 'duplicate-actor' | 'unexpected-actor' | 'missing-actor' | 'team-policy' | 'action-policy'
  reason: string
}>

export type DoubleBattleActionAdmission =
  | Readonly<{ accepted: true }>
  | DoubleBattleActionAdmissionRejection

function actorKey(actor: DoubleBattlePosition): string {
  return `${actor.side}:${actor.slot}`
}

/**
 * Frontière des commandes fournies par le client. Le moteur conserve ses
 * validations métier ; cette admission empêche seulement un client de jouer
 * pour l'IA, deux fois pour le même slot, ou d'injecter un objet Dresseur.
 */
export function validateDoubleBattlePlayerActions(
  session: DoubleBattleSession,
  actions: readonly DoubleBattleAction[],
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
  playerActionPolicy: BattleActionPolicy = baseBattleActionPolicy,
): DoubleBattleActionAdmission {
  const requiredKeys = new Set(getRequiredDoubleBattleActors(session).map(actorKey))
  const submittedKeys = new Set<string>()
  for (const action of actions) {
    if (action.kind === 'trainerItem') {
      return { accepted: false, code: 'trainer-item', reason: "Une commande joueur ne peut pas injecter l'objet d'un Dresseur adverse." }
    }
    const key = actorKey(action.actor)
    if (submittedKeys.has(key)) {
      return { accepted: false, code: 'duplicate-actor', reason: `Le combattant ${key} a reçu plusieurs commandes.` }
    }
    if (!requiredKeys.has(key)) {
      return { accepted: false, code: 'unexpected-actor', reason: `Le combattant ${key} n'attend aucune commande joueur.` }
    }
    let intent: PlayerBattleActionIntent | undefined
    if (action.kind === 'switch') {
      intent = { kind: 'switch', format: 'double', mode: 'voluntary', partyIndex: action.partyIndex }
    } else if (action.kind === 'item') {
      const item = session.itemCatalog?.items[action.itemId]
      if (item) {
        const resolved = resolveBaseFieldBattleBagAction(item, { opponent: 'trainer' })
        const role: BattleBagActionRole = resolved.kind === 'blocked'
          ? resolved.reason === 'trainer-capture' ? 'capture' : 'escape'
          : resolved.kind
        intent = { kind: 'bag', format: 'double', itemId: action.itemId, role }
      }
    }
    const actionVeto = intent && playerActionPolicy.vetoPlayerAction(intent)
    if (actionVeto) return { accepted: false, code: 'action-policy', reason: actionVeto.reason }
    const veto = action.kind === 'switch'
      ? getDoubleBattleTeamPolicyVeto(session, action.actor, action.partyIndex, 'voluntary-switch', playerTeamPolicy)
      : undefined
    if (veto) return { accepted: false, code: 'team-policy', reason: veto.reason }
    submittedKeys.add(key)
  }
  for (const key of requiredKeys) {
    if (!submittedKeys.has(key)) {
      return { accepted: false, code: 'missing-actor', reason: `La commande du combattant ${key} est absente.` }
    }
  }
  return { accepted: true }
}

/** Valide toutes les commandes avant que le moteur ou son RNG ne soient touchés. */
export function executeAdmittedDoubleBattleTurn(
  session: DoubleBattleSession,
  playerActions: readonly DoubleBattleAction[],
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  playerTeamPolicy: PokemonTeamPolicy = basePokemonTeamPolicy,
  playerActionPolicy: BattleActionPolicy = baseBattleActionPolicy,
  playerHealingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
): DoubleBattleEvent[] {
  const admission = validateDoubleBattlePlayerActions(session, playerActions, playerTeamPolicy, playerActionPolicy)
  if (!admission.accepted) throw new Error(admission.reason)
  return executeDoubleBattleTurn(session, playerActions, catalog, rng, playerTeamPolicy, playerHealingPolicy)
}
