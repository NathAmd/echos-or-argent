import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { BattleStat, BattleStatStages } from './hgssBattleRules'

export type DoubleBattleSide = 'player' | 'opponent'
export type DoubleBattleSlot = 0 | 1
export type DoubleBattlePosition = { side: DoubleBattleSide, slot: DoubleBattleSlot }
export type DoubleBattleWeather = 'clear' | 'rain' | 'sun' | 'sandstorm' | 'hail'

export type DoubleBattleEvent =
  | { kind: 'move', presentationId: number, actor: DoubleBattlePosition, target: DoubleBattlePosition, pokemonName: string, actorSpeciesId: number, targetSpeciesId: number, moveId: number, moveName: string, moveType: number, moveCategory: number }
  | { kind: 'item', actor: DoubleBattlePosition, itemId: number, itemName: string, applied: boolean, reason?: string, source?: 'bag' | 'trainer', trainerName?: string }
  | { kind: 'miss', actor: DoubleBattlePosition, target: DoubleBattlePosition, pokemonName: string }
  | { kind: 'damage', movePresentationId?: number, target: DoubleBattlePosition, damage: number, critical: boolean, typeMultiplier: number }
  | { kind: 'stat', target: DoubleBattlePosition, pokemonName: string, stat: BattleStat, change: number, applied: boolean }
  | { kind: 'status', target: DoubleBattlePosition, pokemonName: string, status: 'sleep' | 'poison' | 'badPoison' | 'burn' | 'freeze' | 'paralysis', applied: boolean }
  | { kind: 'cannotAct', actor: DoubleBattlePosition, pokemonName: string, reason: 'sleep' | 'freeze' | 'paralysis' | 'infatuation' | 'flinch' | 'recharge' | 'truant' }
  | { kind: 'confusion', target: DoubleBattlePosition, pokemonName: string, state: 'started' | 'active' | 'ended' }
  | { kind: 'selfDamage', target: DoubleBattlePosition, pokemonName: string, damage: number }
  | { kind: 'residual', target: DoubleBattlePosition, pokemonName: string, status: 'poison' | 'badPoison' | 'burn' | 'trap' | 'futureSight', damage: number }
  | { kind: 'recoil', target: DoubleBattlePosition, pokemonName: string, damage: number }
  | { kind: 'multiHit', hits: number }
  | { kind: 'heal', target: DoubleBattlePosition, pokemonName: string, amount: number }
  | { kind: 'statusCured', target: DoubleBattlePosition, pokemonName: string, applied: boolean }
  | { kind: 'statsReset' }
  | { kind: 'condition', target: DoubleBattlePosition, condition: string, applied: boolean }
  | { kind: 'formChange', target: DoubleBattlePosition, pokemon: CanonicalPokemon, types: readonly [number, number], stages: BattleStatStages }
  | { kind: 'abilityReveal', target: DoubleBattlePosition, pokemonName: string, abilityId: number, moveId?: number, itemId?: number }
  | { kind: 'screen', side: DoubleBattleSide, screen: 'reflect' | 'lightScreen' }
  | { kind: 'weather', weather: DoubleBattleWeather }
  | { kind: 'weatherDamage', target: DoubleBattlePosition, pokemonName: string, weather: 'sandstorm' | 'hail', damage: number }
  | { kind: 'noEffect', actor: DoubleBattlePosition, pokemonName: string }
  | { kind: 'faint', target: DoubleBattlePosition, pokemonName: string, defeated: CanonicalPokemon }
  | { kind: 'sendOut', target: DoubleBattlePosition, pokemonName: string, partyIndex: number, pokemon: CanonicalPokemon, types: readonly [number, number], stages: BattleStatStages }
  | { kind: 'replacementRequest', target: DoubleBattlePosition, reserveIndexes: readonly number[] }
  | { kind: 'result', result: 'won' | 'lost' }

export type DoubleBattleMoveAction = {
  kind?: 'move'
  actor: DoubleBattlePosition
  moveIndex: number
  target: DoubleBattlePosition
  switchPartyIndex?: number
}
export type DoubleBattleSwitchAction = { kind: 'switch', actor: DoubleBattlePosition, partyIndex: number }
export type DoubleBattleItemAction = { kind: 'item', actor: DoubleBattlePosition, itemId: number, targetPartyIndex: number, moveIndex?: number }
export type DoubleBattleTrainerItemAction = { kind: 'trainerItem', actor: DoubleBattlePosition, itemId: number, targetPartyIndex: number }
export type DoubleBattlePassAction = { kind: 'pass', actor: DoubleBattlePosition }
export type DoubleBattleAction = DoubleBattleMoveAction | DoubleBattleSwitchAction | DoubleBattleItemAction | DoubleBattleTrainerItemAction | DoubleBattlePassAction
