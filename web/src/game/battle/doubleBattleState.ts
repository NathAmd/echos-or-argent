import type { PokemonMoveData } from '../../rom/pokemon/moveData'
import type { CanonicalPokemonMove } from '../pokemon/canonicalPokemon'
import type { PokemonStatValues } from '../pokemon/pokemonFormulas'
import type { DoubleBattlePosition } from './doubleBattleSession'
import type { SimpleBattleSemiInvulnerable } from './simpleBattleTemporalRules'

export type DoubleBattleVolatileState = {
  protected: boolean; flinched: boolean; protectStreak: number; endured: boolean; charged: boolean
  ingrain: boolean; yawnTurns: number; trappedTurns: number; rage: boolean; usedMoveIds: Set<number>
  defenseCurl: boolean; rolloutCount: number; furyCutterCount: number; focusEnergy: boolean; minimized: boolean
  followMe: boolean; helpingHand: boolean; actedThisTurn: boolean; lastDamageTaken: number; lastDamageCategory: -1 | 0 | 1
  rechargeTurns: number; stockpile: number; aquaRing: boolean; magnetRiseTurns: number; healBlockTurns: number
  mudSport: boolean; waterSport: boolean; recyclableItemId: number; disabledMoveId: number; disableTurns: number
  encoreMoveIndex: number; encoreTurns: number; tauntTurns: number; tormented: boolean; imprisoned: boolean
  lastMoveId: number; turnsActive: number; seededBy?: DoubleBattlePosition; nightmare: boolean; perishTurns: number
  substituteHp: number; magicCoat: boolean; snatch: boolean; roosted: boolean; bideTurns: number; bideDamage: number
  rampageTurns: number; uproarTurns: number; lockOnTarget?: DoubleBattlePosition; lockOnTurns: number
  identifiedGhost: boolean; identifiedDark: boolean; cursed: boolean
  embargoTurns: number; micleAccuracy: boolean
  powerTrick: boolean; lastDamageMoveType: number; destinyBond: boolean; grudge: boolean
  cannotSwitch: boolean; enteredThisTurn: boolean; canUnburden: boolean; flashFire: boolean
  mimicOriginalMoves: Map<number, CanonicalPokemonMove>
  transformOriginal?: { types: readonly [number, number], stats: PokemonStatValues, moves: CanonicalPokemonMove[] }
  battleFormOriginal?: { form: number, types: readonly [number, number] }
  chargingMove?: { moveIndex: number, target: DoubleBattlePosition }; semiInvulnerable?: SimpleBattleSemiInvulnerable
  confusionTurns: number; infatuated: boolean; abilityOverrideId?: number; abilitySuppressed: boolean; lastMoveData?: PokemonMoveData
  choiceMoveId: number; metronomeMoveId: number; metronomeTurns: number
}

export function createDoubleBattleVolatileState(canUnburden = false): DoubleBattleVolatileState {
  return {
    protected: false, flinched: false, protectStreak: 0, endured: false, charged: false, ingrain: false,
    yawnTurns: 0, trappedTurns: 0, rage: false, usedMoveIds: new Set(), defenseCurl: false, rolloutCount: 0,
    furyCutterCount: 0, focusEnergy: false, minimized: false, followMe: false, helpingHand: false,
    actedThisTurn: false, lastDamageTaken: 0, lastDamageCategory: -1, rechargeTurns: 0, stockpile: 0,
    aquaRing: false, magnetRiseTurns: 0, healBlockTurns: 0, mudSport: false, waterSport: false,
    recyclableItemId: 0, disabledMoveId: 0, disableTurns: 0, encoreMoveIndex: -1, encoreTurns: 0,
    tauntTurns: 0, tormented: false, imprisoned: false, lastMoveId: 0, turnsActive: 0, nightmare: false,
    perishTurns: 0, substituteHp: 0, magicCoat: false, snatch: false, roosted: false, bideTurns: 0,
    bideDamage: 0, rampageTurns: 0, uproarTurns: 0, lockOnTurns: 0, identifiedGhost: false,
    identifiedDark: false, cursed: false, embargoTurns: 0, micleAccuracy: false, powerTrick: false,
    lastDamageMoveType: -1, destinyBond: false, grudge: false, cannotSwitch: false, enteredThisTurn: false, canUnburden, flashFire: false, confusionTurns: 0, infatuated: false, abilitySuppressed: false,
    choiceMoveId: 0, metronomeMoveId: 0, metronomeTurns: 0, mimicOriginalMoves: new Map(),
  }
}

export function restoreDoubleBattleTemporaryForm(participant: { party: { form: number, moves: CanonicalPokemonMove[], stats: PokemonStatValues }[], activePartyIndex: number, types: readonly [number, number], volatile: DoubleBattleVolatileState }): void {
  const pokemon = participant.party[participant.activePartyIndex]
  if (!pokemon) return
  if (participant.volatile.transformOriginal) {
    participant.types = participant.volatile.transformOriginal.types
    pokemon.stats = { ...participant.volatile.transformOriginal.stats }
    pokemon.moves = participant.volatile.transformOriginal.moves.map((move) => ({ ...move, data: { ...move.data } }))
  } else for (const [index, move] of participant.volatile.mimicOriginalMoves) pokemon.moves[index] = { ...move, data: { ...move.data } }
  if (participant.volatile.battleFormOriginal) { pokemon.form = participant.volatile.battleFormOriginal.form; participant.types = participant.volatile.battleFormOriginal.types }
}
