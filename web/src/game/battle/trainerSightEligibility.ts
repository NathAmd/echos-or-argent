import type { HgssTrainer } from '../../rom/battle/trainerData'
import type { PokemonParty } from '../pokemon/pokemonParty'
import { getPokemonBattleEligiblePartySlots, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import type { FieldBattleFormatResolver } from './fieldBattleFormatResolver'

/**
 * TryGetSeenByNpcTrainers refuse l'approche automatique d'un Dresseur double,
 * ou de plusieurs Dresseurs simultanés, tant que l'équipe ne peut pas ouvrir
 * tous les slots joueur requis.
 */
export function canStartHgssTrainerSightBattle(
  trainer: Pick<HgssTrainer, 'doubleBattle'> | undefined,
  party: PokemonParty,
  teamPolicy: PokemonTeamPolicy,
  formatResolver: FieldBattleFormatResolver,
  multipleTrainers = false,
): boolean {
  if (!multipleTrainers && !trainer?.doubleBattle) return true
  const usablePokemon = getPokemonBattleEligiblePartySlots(
    party.members,
    { format: 'double', phase: 'initial' },
    teamPolicy,
  ).length
  const requiredPokemon = formatResolver({ kind: 'wild' }).engine === 'double' ? 1 : 2
  return usablePokemon >= requiredPokemon
}
