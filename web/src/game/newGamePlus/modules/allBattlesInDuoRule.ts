import {
  resolveBaseFieldBattleFormat,
  type FieldBattleFormatResolver,
} from '../../battle/fieldBattleFormatResolver'
import {
  baseFieldBattleRosterPolicy,
  type FieldBattleRosterPolicy,
} from '../../battle/fieldBattleRosterPolicy'
import {
  basePokemonInitialTeamResolver,
  type PokemonInitialTeamResolver,
} from '../../pokemon/pokemonInitialTeamResolver'
import { isHgssLegendaryOrMythicalSpecies } from '../../pokemon/hgssLegendarySpecies'

export type AllBattlesInDuoRuntime = Readonly<{
  enabled: boolean
  fieldBattleFormatResolver: FieldBattleFormatResolver
  fieldBattleRosterPolicy: FieldBattleRosterPolicy
  pokemonInitialTeamResolver: PokemonInitialTeamResolver
}>

/**
 * Demande le moteur double seulement aux familles de combats que le dispatch
 * de terrain peut convertir sans changer leur scénario :
 *
 * - les combats Dresseur simples et déjà doubles deviennent/restent doubles ;
 * - les combats sauvages, y compris les sauvages scriptés et les légendaires,
 *   demandent un double avec un unique adversaire (2 contre 1) ;
 * - tag et multi conservent leur format natif ;
 * - tutoriel et Maison des Dresseurs gardent leur moteur spécialisé/simple.
 *
 * Safari n'appelle pas ce resolver : son moteur dédié reste donc inchangé.
 */
const resolveAllBattlesInDuoFormat: FieldBattleFormatResolver = (battle) => {
  if (battle.kind === 'trainer') return { engine: 'double', sessionKind: 'double' }
  if (battle.kind === 'wild') return { engine: 'double', sessionKind: 'double' }
  return resolveBaseFieldBattleFormat(battle)
}

/**
 * Un Dresseur simple réduit à une définition reçoit une seconde définition
 * indépendante ; sa matérialisation créera donc bien deux instances. Les
 * équipes tag/multi et les sauvages scriptés (dont les légendaires) restent
 * strictement propriétaires de leur roster natif.
 */
const preserveAllBattlesInDuoRoster: FieldBattleRosterPolicy = Object.freeze({
  transformTrainerParty: (party, context) => context.battleKind === 'trainer' && party.length === 1
    && !isHgssLegendaryOrMythicalSpecies(party[0]!.speciesId)
    ? Object.freeze([party[0]!, Object.freeze({ ...party[0]! })])
    : party,
  transformTrainerHouseParty: (party) => party,
  transformScriptedWildPokemon: (pokemon) => pokemon,
})

/** Garantit deux instances au premier combat sans réécrire une équipe explicite. */
const ensureInitialDuoTeam: PokemonInitialTeamResolver = Object.freeze((request, currentTeam) => {
  const team = currentTeam.length > 0 ? currentTeam : [request.baseDefinition]
  return team.length >= 2 ? team : Object.freeze([team[0]!, Object.freeze({ ...team[0]! })])
})

export function createAllBattlesInDuoRuntime(enabled: boolean): AllBattlesInDuoRuntime {
  return Object.freeze({
    enabled,
    fieldBattleFormatResolver: enabled
      ? resolveAllBattlesInDuoFormat
      : resolveBaseFieldBattleFormat,
    fieldBattleRosterPolicy: enabled
      ? preserveAllBattlesInDuoRoster
      : baseFieldBattleRosterPolicy,
    pokemonInitialTeamResolver: enabled ? ensureInitialDuoTeam : basePokemonInitialTeamResolver,
  })
}
