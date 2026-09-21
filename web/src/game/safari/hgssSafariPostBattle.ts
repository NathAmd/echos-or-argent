import { applyHgssPostBattleProgression, type HgssPostBattleProgression } from '../battle/hgssPostBattleAbilities'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonParty } from '../pokemon/pokemonParty'

export type HgssSafariPostBattleFinalizer = () => HgssPostBattleProgression | undefined

/**
 * Le contrôleur natif exécute Party_GivePokerusAtRandom puis
 * Party_SpreadPokerus pour toute fin de combat Safari, sans passer par le
 * script de victoire Ramassage/Cherche Miel.
 *
 * Le finalizer conserve l'objet équipe vivant plutôt qu'un instantané :
 * battle_command.c ajoute d'abord une capture à l'équipe quand une place est
 * libre, puis battle_controller_player.c exécute ces deux appels. Une capture
 * envoyée au PC ne fait donc jamais partie des cibles.
 */
export function createHgssSafariPostBattleFinalizer(
  party: PokemonParty,
  rng: HgssLcrng,
): HgssSafariPostBattleFinalizer {
  let completed = false
  return () => {
    if (completed) return undefined
    completed = true
    return applyHgssPostBattleProgression(party, rng, false)
  }
}
