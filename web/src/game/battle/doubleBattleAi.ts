import type { PokemonCatalog } from '../../ndsTypes'
import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import { calculateHgssTypeMultiplier, primaryStatusForMoveEffect } from './hgssBattleRules'
import { getSelectableDoubleBattleMoveIndexes } from './doubleBattleActionSelection'
import type {
  DoubleBattleMoveAction,
  DoubleBattleParticipant,
  DoubleBattlePosition,
  DoubleBattleSession,
  DoubleBattleSide,
  DoubleBattleTrainerItemAction,
} from './doubleBattleSession'
import { chooseDoubleBattleTrainerItemAction } from './doubleBattleTrainerItems'
import { requireDoubleBattleParticipantAt } from './doubleBattleRoster'

export type DoubleBattleAiOptions = {
  aiFlags?: number
  items?: readonly number[]
  trainerName?: string
}

export type DoubleBattleAiState = {
  aiFlags: number
  items: number[]
  trainerName?: string
}

export function createDoubleBattleTrainerAiOptions(trainer: HgssTrainer, trainerNames: readonly string[]): DoubleBattleAiOptions {
  return {
    aiFlags: trainer.aiFlags,
    items: trainer.items.filter((itemId) => itemId > 0),
    trainerName: trainerNames[trainer.trainerId] ?? `Dresseur ${trainer.trainerId}`,
  }
}

export type DoubleBattleAiMoveCandidate<T> = {
  value: T
  power: number
  typeMultiplier: number
  targetCurrentHp: number
  targetMaximumHp: number
  targetHasPrimaryStatus: boolean
  targetIsAlly: boolean
  inflictsPrimaryStatus: boolean
  healsTarget: boolean
}

export type DoubleBattleAiReplacementCandidate = {
  partyIndex: number
  currentHp: number
  maximumHp: number
  speed: number
  bestTypeMultiplier: number
}

export function createDoubleBattleAiState(options: DoubleBattleAiOptions = {}): DoubleBattleAiState {
  const aiFlags = options.aiFlags ?? 0
  if (!Number.isInteger(aiFlags) || aiFlags < 0 || aiFlags > 0xffff_ffff) {
    throw new Error(`Les drapeaux IA du combat double sont invalides (${aiFlags}).`)
  }
  const items = [...(options.items ?? [])]
  if (items.some((itemId) => !Number.isInteger(itemId) || itemId < 0)) {
    throw new Error("La liste d'objets IA du combat double est invalide.")
  }
  return {
    aiFlags,
    items,
    trainerName: options.trainerName,
  }
}

function chooseAtRandom<T>(values: readonly T[], rng: HgssLcrng): T {
  const value = values[rng.nextU16() % values.length]
  if (value === undefined) throw new Error("L'IA du combat double ne dispose d'aucun choix.")
  return value
}

/** Sélecteur pur, partageable par l'IA Dresseur, alliée et les futurs contrôleurs. */
export function chooseDoubleBattleAiMoveCandidate<T>(
  candidates: readonly DoubleBattleAiMoveCandidate<T>[],
  aiFlags: number,
  rng: HgssLcrng,
): T {
  if (candidates.length === 0) throw new Error("L'IA du combat double ne dispose d'aucune capacité candidate.")
  if (aiFlags === 0) return chooseAtRandom(candidates, rng).value
  const scored = candidates.map((candidate) => {
    let score = 100
    if ((aiFlags & 1) !== 0 && candidate.power > 0) {
      if (candidate.typeMultiplier === 0) score -= 100
      else if (candidate.typeMultiplier > 10) score += 4
      else if (candidate.typeMultiplier < 10) score -= 2
      if (candidate.targetCurrentHp * 4 <= candidate.targetMaximumHp) score += 1
    }
    if ((aiFlags & 2) !== 0) {
      if (candidate.targetIsAlly && candidate.power > 0) score -= 80
      if (candidate.inflictsPrimaryStatus && candidate.targetHasPrimaryStatus) score -= 12
      if (candidate.healsTarget) {
        if (candidate.targetCurrentHp === candidate.targetMaximumHp) score -= 12
        else if (candidate.targetCurrentHp * 2 <= candidate.targetMaximumHp) score += 4
      }
    }
    return { candidate, score }
  })
  const maximum = Math.max(...scored.map(({ score }) => score))
  return chooseAtRandom(scored.filter(({ score }) => score === maximum), rng).candidate.value
}

export function chooseDoubleBattleAiReplacement(
  candidates: readonly DoubleBattleAiReplacementCandidate[],
  aiFlags: number,
  rng: HgssLcrng,
): number {
  if (candidates.length === 0) throw new Error("L'IA du combat double ne dispose d'aucun remplaçant.")
  // Préserve le comportement historique des combats qui ne fournissent pas
  // de configuration IA. Les drapeaux activent explicitement le choix tactique.
  if (aiFlags === 0) return candidates[0]!.partyIndex
  const scored = candidates.map((candidate) => ({
    candidate,
    score: Math.floor(candidate.currentHp * 100 / Math.max(1, candidate.maximumHp))
      + candidate.bestTypeMultiplier * 4
      + Math.floor(candidate.speed / 32),
  }))
  const maximum = Math.max(...scored.map(({ score }) => score))
  return chooseAtRandom(scored.filter(({ score }) => score === maximum), rng).candidate.partyIndex
}

function activePokemon(participant: DoubleBattleParticipant) {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) throw new Error(`Le Pokémon actif ${participant.activePartyIndex} de ${participant.ownerId} est absent.`)
  return pokemon
}

function livingTargets(session: DoubleBattleSession, side: DoubleBattleSide): DoubleBattlePosition[] {
  return session.teams[side].flatMap((participant, slot) => (
    activePokemon(participant).currentHp > 0 ? [{ side, slot: slot as 0 | 1 }] : []
  ))
}

function candidateTargets(
  session: DoubleBattleSession,
  actor: DoubleBattlePosition,
  move: PokemonMoveData,
): DoubleBattlePosition[] {
  if ((move.range & ((1 << 4) | (1 << 5) | (1 << 6))) !== 0) return [actor]
  const targetSide = (move.range & ((1 << 8) | (1 << 9))) !== 0
    ? actor.side
    : actor.side === 'player' ? 'opponent' : 'player'
  let targets = livingTargets(session, targetSide)
  if ((move.range & (1 << 8)) !== 0) {
    targets = targets.filter((target) => target.slot !== actor.slot)
  }
  return targets.length > 0 ? targets : [actor]
}

export function chooseDoubleBattleAiAction(
  session: DoubleBattleSession,
  actor: DoubleBattlePosition,
  catalog: PokemonCatalog,
  rng: HgssLcrng,
  allowTrainerItem: boolean,
): DoubleBattleMoveAction | DoubleBattleTrainerItemAction {
  if (allowTrainerItem) {
    const item = chooseDoubleBattleTrainerItemAction(session, actor)
    if (item) return item
  }
  const usable = getSelectableDoubleBattleMoveIndexes(session, actor)
  const opponentSide = actor.side === 'player' ? 'opponent' : 'player'
  if (usable.length === 0) {
    const targets = livingTargets(session, opponentSide)
    const target = targets[rng.nextU16() % targets.length]
    if (!target || !catalog.moves[165]) throw new Error('Aucune cible ou donnée de Lutte ne reste disponible.')
    return { actor, moveIndex: -1, target }
  }
  const participant = requireDoubleBattleParticipantAt(session, actor)
  if (participant.ai.aiFlags === 0) {
    const targets = livingTargets(session, opponentSide)
    const target = targets[rng.nextU16() % targets.length]
    if (!target) throw new Error('Aucune cible de combat double HGSS ne reste disponible.')
    return { actor, moveIndex: usable[rng.nextU16() % usable.length]!, target }
  }
  const candidates = usable.flatMap((moveIndex) => {
    const move = activePokemon(participant).moves[moveIndex]!
    return candidateTargets(session, actor, move.data).map((target) => {
      const targetParticipant = requireDoubleBattleParticipantAt(session, target)
      const targetPokemon = activePokemon(targetParticipant)
      return {
        value: { actor, moveIndex, target } satisfies DoubleBattleMoveAction,
        power: move.data.power,
        typeMultiplier: move.data.power > 0
          ? calculateHgssTypeMultiplier(move.data.type, targetParticipant.types)
          : 10,
        targetCurrentHp: targetPokemon.currentHp,
        targetMaximumHp: targetPokemon.stats.hp,
        targetHasPrimaryStatus: (targetPokemon.status & 0xff) !== 0,
        targetIsAlly: target.side === actor.side,
        inflictsPrimaryStatus: primaryStatusForMoveEffect(move.data.effect) !== undefined,
        healsTarget: move.data.effect === 32 || move.data.effect === 37 || move.data.effect === 132,
      }
    })
  })
  return chooseDoubleBattleAiMoveCandidate(candidates, participant.ai.aiFlags, rng)
}
