import type { PokemonCatalog } from '../../ndsTypes'
import {
  baseBattleActionPolicy,
  type BattleActionPolicy,
  type BattleActionVeto,
} from '../battle/battleActionPolicy'
import { calculateHgssBallShakes, type HgssCaptureResult } from '../battle/hgssCapture'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'

export const hgssSafariBallItemId = 5
export const hgssSafariInitialStage = 6
export const hgssSafariMinimumStage = 0
export const hgssSafariMaximumStage = 12

/** Table ROM partagee par le taux de capture et la fuite Safari. */
export const hgssSafariStageRatios = [
  [10, 40], [10, 35], [10, 30], [10, 25], [10, 20], [10, 15], [10, 10],
  [15, 10], [20, 10], [25, 10], [30, 10], [35, 10], [40, 10],
] as const

export type HgssSafariBattleAction = 'ball' | 'bait' | 'mud' | 'run'
export type HgssSafariBattleOutcome = 'active' | 'caught' | 'player-ran' | 'opponent-fled' | 'balls-out' | 'storage-full'

export type HgssSafariBattleState = {
  opponent: CanonicalPokemon
  ballsRemaining: number
  catchRateStage: number
  fleeRateStage: number
  turnCount: number
  outcome: HgssSafariBattleOutcome
}

export type HgssSafariBattleEvent =
  | { kind: 'ball', capture: HgssCaptureResult, ballsRemaining: number }
  | { kind: 'bait', strongReaction: boolean }
  | { kind: 'mud', strongReaction: boolean }
  | { kind: 'watching' }
  | { kind: 'opponent-fled' }
  | { kind: 'player-ran' }
  | { kind: 'balls-out' }
  | { kind: 'storage-full' }

export type HgssSafariBattleTurn = {
  state: HgssSafariBattleState
  events: HgssSafariBattleEvent[]
}

export type HgssSafariBattleActionAttempt =
  | Readonly<{
    accepted: true
    turn: HgssSafariBattleTurn
  }>
  | Readonly<{
    accepted: false
    action: HgssSafariBattleAction
    state: HgssSafariBattleState
    veto: BattleActionVeto
  }>

export type HgssSafariBattleContext = {
  catalog: PokemonCatalog
  rng: HgssLcrng
  hasStorageSpace: boolean
}

function clampStage(stage: number): number {
  if (!Number.isInteger(stage)) throw new Error(`Le stade Safari ${stage} est invalide.`)
  return Math.max(hgssSafariMinimumStage, Math.min(hgssSafariMaximumStage, stage))
}

export function createHgssSafariBattleState(opponent: CanonicalPokemon, ballsRemaining: number): HgssSafariBattleState {
  if (!Number.isInteger(ballsRemaining) || ballsRemaining < 0 || ballsRemaining > 30) {
    throw new Error(`Le nombre de Safari Balls ${ballsRemaining} est invalide.`)
  }
  return {
    opponent,
    ballsRemaining,
    catchRateStage: hgssSafariInitialStage,
    fleeRateStage: hgssSafariInitialStage,
    turnCount: 0,
    outcome: 'active',
  }
}

export function applyHgssSafariStage(baseRate: number, stage: number): number {
  if (!Number.isInteger(baseRate) || baseRate < 0) throw new Error(`Le taux Safari ${baseRate} est invalide.`)
  const [numerator, denominator] = hgssSafariStageRatios[clampStage(stage)]!
  return Math.floor(baseRate * numerator / denominator)
}

/** Port du choix adverse : le reste RNG modulo 255 est compare inclusivement. */
export function doesHgssSafariOpponentFlee(baseFleeRate: number, stage: number, rng: HgssLcrng): boolean {
  const fleeRate = applyHgssSafariStage(baseFleeRate, stage)
  return rng.nextU16() % 255 <= fleeRate
}

function resolveOpponentTurn(state: HgssSafariBattleState, context: HgssSafariBattleContext): HgssSafariBattleTurn {
  const personal = context.catalog.personalData[state.opponent.speciesId]
  if (!personal) throw new Error(`Le taux de fuite ROM de ${state.opponent.speciesName} est absent.`)
  if (doesHgssSafariOpponentFlee(personal.greatMarshFleeRate, state.fleeRateStage, context.rng)) {
    return { state: { ...state, outcome: 'opponent-fled' }, events: [{ kind: 'opponent-fled' }] }
  }
  return { state, events: [{ kind: 'watching' }] }
}

export function performHgssSafariBattleAction(
  current: HgssSafariBattleState,
  action: HgssSafariBattleAction,
  context: HgssSafariBattleContext,
): HgssSafariBattleTurn {
  if (current.outcome !== 'active') throw new Error(`Le combat Safari est deja termine (${current.outcome}).`)

  const state = { ...current, turnCount: current.turnCount + 1 }
  if (action === 'run') return { state: { ...state, outcome: 'player-ran' }, events: [{ kind: 'player-ran' }] }

  if (action === 'ball') {
    if (state.ballsRemaining <= 0) {
      return { state: { ...state, outcome: 'balls-out' }, events: [{ kind: 'balls-out' }] }
    }
    // BattleControllerPlayer_SafariThrowBall débite la Ball avant que le
    // sous-script 275 exécute CheckSafariGameDone (équipe et PC pleins).
    state.ballsRemaining -= 1
    if (!context.hasStorageSpace) {
      return { state: { ...state, outcome: 'storage-full' }, events: [{ kind: 'storage-full' }] }
    }
    const personal = context.catalog.personalData[state.opponent.speciesId]
    if (!personal) throw new Error(`Le taux de capture ROM de ${state.opponent.speciesName} est absent.`)
    const capture = calculateHgssBallShakes({
      itemId: hgssSafariBallItemId,
      target: state.opponent,
      catalog: context.catalog,
      turnCount: state.turnCount,
      baseCatchRateOverride: applyHgssSafariStage(personal.catchRate, state.catchRateStage),
    }, context.rng)
    const events: HgssSafariBattleEvent[] = [{ kind: 'ball', capture, ballsRemaining: state.ballsRemaining }]
    if (capture.caught) return { state: { ...state, outcome: 'caught' }, events }
    if (state.ballsRemaining === 0) {
      return { state: { ...state, outcome: 'balls-out' }, events: [...events, { kind: 'balls-out' }] }
    }
    const opponentTurn = resolveOpponentTurn(state, context)
    return { state: opponentTurn.state, events: [...events, ...opponentTurn.events] }
  }

  const roll = context.rng.nextU16() % 10
  if (action === 'bait') {
    state.fleeRateStage = clampStage(state.fleeRateStage - 1)
    if (roll !== 0) state.catchRateStage = clampStage(state.catchRateStage - 1)
    const event: HgssSafariBattleEvent = { kind: 'bait', strongReaction: roll === 0 }
    const opponentTurn = resolveOpponentTurn(state, context)
    return { state: opponentTurn.state, events: [event, ...opponentTurn.events] }
  }

  state.catchRateStage = clampStage(state.catchRateStage + 1)
  if (roll !== 0) state.fleeRateStage = clampStage(state.fleeRateStage + 1)
  const event: HgssSafariBattleEvent = { kind: 'mud', strongReaction: roll === 0 }
  const opponentTurn = resolveOpponentTurn(state, context)
  return { state: opponentTurn.state, events: [event, ...opponentTurn.events] }
}

/**
 * Frontière autoritaire des commandes Safari fournies par le joueur. Un veto
 * est résolu avant que le moteur incrémente le tour, débite une Ball ou lise le
 * RNG. La politique neutre conserve exactement le chemin du jeu de base.
 */
export function attemptHgssSafariBattleAction(
  current: HgssSafariBattleState,
  action: HgssSafariBattleAction,
  context: HgssSafariBattleContext,
  policy: BattleActionPolicy = baseBattleActionPolicy,
): HgssSafariBattleActionAttempt {
  if (current.outcome !== 'active') throw new Error(`Le combat Safari est deja termine (${current.outcome}).`)
  const veto = policy.vetoPlayerAction({ kind: 'safari', action })
  if (veto) return { accepted: false, action, state: current, veto }
  return { accepted: true, turn: performHgssSafariBattleAction(current, action, context) }
}
