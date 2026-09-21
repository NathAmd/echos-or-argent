import type { PokemonCatalog } from '../../ndsTypes'
import type { HgssItemCatalog } from '../../rom/items/itemData'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createFieldDoubleBattlePlayerRoster } from './fieldDoubleBattlePlayerRoster'
import { createDoubleBattleSession, type DoubleBattleSession } from './doubleBattleSession'

export type FieldDoubleWildBattleOptions = Readonly<{
  playerParty: CanonicalPokemon[]
  opponent: CanonicalPokemon
  catalog: PokemonCatalog
  itemCatalog: HgssItemCatalog
  bagInventory: Map<number, number>
  rng: HgssLcrng
  playerTeamPolicy: PokemonTeamPolicy
  initialWeather: DoubleBattleSession['weather']['kind']
  initialTerrainId: number
}>

/** Construit le format sauvage NG+ jusqu'à 2v1 sans jamais cloner un côté. */
export function createFieldDoubleWildBattleSession(
  options: FieldDoubleWildBattleOptions,
): DoubleBattleSession {
  return createDoubleBattleSession({
    kind: 'wild',
    catalog: options.catalog,
    itemCatalog: options.itemCatalog,
    bagInventory: options.bagInventory,
    rng: options.rng,
    playerTeamPolicy: options.playerTeamPolicy,
    initialWeather: options.initialWeather,
    initialTerrainId: options.initialTerrainId,
    allowSinglePlayerParticipant: true,
    player: createFieldDoubleBattlePlayerRoster({
      party: options.playerParty, teamPolicy: options.playerTeamPolicy, allowSingleParticipant: true,
    }),
    opponent: [{ ownerId: 'wild', party: [options.opponent], activePartyIndex: 0, controlled: false }],
  })
}
