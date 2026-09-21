import type { PokemonParty } from '../pokemon/pokemonParty'
import { basePokemonPartyHealingPolicy, healPokemonPartyWithPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG, HGSS_POST_GAME_RESET_SYSTEM_FLAG } from './hgssFieldSystemFlags'

export const HGSS_LEAGUE_WINS_GAME_STAT = 74 as const
export const HGSS_LEAGUE_WINS_MAXIMUM = 9_999 as const

type HgssGameClearState = {
  flags: Set<number>
  gameStats: Map<number, number>
  party: PokemonParty
}

export type HgssGameClearResult = {
  defeatedRed: boolean
  firstClear: boolean
}

/**
 * Effets persistants appliqués immédiatement par CallTask_GameClear dans HGSS.
 * La présentation du Panthéon reste suspendue dans FieldScriptRunner.
 */
export function applyHgssGameClearState(
  state: HgssGameClearState,
  defeatedRed: boolean,
  healingPolicy: PokemonPartyHealingPolicy = basePokemonPartyHealingPolicy,
): HgssGameClearResult {
  const firstClear = !defeatedRed && !state.flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)
  state.flags.add(HGSS_GAME_CLEAR_SYSTEM_FLAG)
  state.flags.add(HGSS_POST_GAME_RESET_SYSTEM_FLAG)
  healPokemonPartyWithPolicy(state.party, healingPolicy)
  if (!defeatedRed) {
    const wins = state.gameStats.get(HGSS_LEAGUE_WINS_GAME_STAT) ?? 0
    state.gameStats.set(HGSS_LEAGUE_WINS_GAME_STAT, Math.min(HGSS_LEAGUE_WINS_MAXIMUM, wins + 1))
  }
  return { defeatedRed, firstClear }
}
