import {
  baseBattleActionPolicy,
  type BattleActionPolicy,
} from '../battle/battleActionPolicy'
import {
  noopDetailedBattleOutcomeObserver,
  type DetailedBattleOutcomeObserver,
} from '../battle/battleOutcomeObserver'
import {
  resolveBaseFieldBattleBagAction,
  type FieldBattleBagActionResolver,
} from '../battle/fieldBattleBagActionResolver'
import {
  resolveBaseFieldBattleFormat,
  type FieldBattleFormatResolver,
} from '../battle/fieldBattleFormatResolver'
import {
  baseFieldBattleRosterPolicy,
  type FieldBattleRosterPolicy,
} from '../battle/fieldBattleRosterPolicy'
import {
  baseBattleProgressionPolicy,
  type BattleProgressionPolicy,
} from '../battle/battleProgressionPolicy'
import {
  baseFieldWildEncounterIdentityPort,
  type FieldWildEncounterIdentityPort,
} from '../encounters/fieldWildEncounterIdentityPort'
import {
  resolveBaseFieldWildEncounterRoute,
  type FieldWildEncounterRouteResolver,
} from '../encounters/fieldWildEncounterRouteResolver'
import {
  noopWildEncounterStartedObserver,
  type WildEncounterStartedObserver,
} from '../encounters/wildEncounterStartedObserver'
import {
  basePokemonInitialTeamResolver,
  type PokemonInitialTeamResolver,
} from '../pokemon/pokemonInitialTeamResolver'
import {
  basePokemonPartyHealingPolicy,
  type PokemonPartyHealingPolicy,
} from '../pokemon/pokemonPartyHealingPolicy'
import {
  basePokemonLevelPolicy,
  type PokemonLevelPolicy,
} from '../pokemon/pokemonLevelPolicy'
import {
  basePokemonTeamPolicy,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'
import {
  baseWorldSessionExtensionPorts,
  type WorldSessionExtensionPorts,
} from '../world/worldSession'

/**
 * Point de composition des règles de gameplay remplaçables. Les propriétaires
 * de domaine gardent leurs contrats précis ; ce bundle ne leur ajoute ni état,
 * ni ordre d'exécution implicite.
 *
 * Les runners de scripts qui ne reçoivent pas encore ce bundle conservent
 * volontairement leurs paramètres neutres par défaut.
 */
export type GameplayExtensionPorts = Readonly<{
  fieldBattleFormatResolver: FieldBattleFormatResolver
  fieldBattleRosterPolicy: FieldBattleRosterPolicy
  fieldWildEncounterRouteResolver: FieldWildEncounterRouteResolver
  fieldWildEncounterIdentityPort: FieldWildEncounterIdentityPort
  wildEncounterStartedObserver: WildEncounterStartedObserver
  fieldBattleBagActionResolver: FieldBattleBagActionResolver
  battleActionPolicy: BattleActionPolicy
  battleProgressionPolicy: BattleProgressionPolicy
  pokemonLevelPolicy: PokemonLevelPolicy
  pokemonInitialTeamResolver: PokemonInitialTeamResolver
  pokemonPartyHealingPolicy: PokemonPartyHealingPolicy
  pokemonTeamPolicy: PokemonTeamPolicy
  worldSessionExtensionPorts: WorldSessionExtensionPorts
  detailedBattleOutcomeObserver: DetailedBattleOutcomeObserver
}>

/** Configuration du jeu de base : chaque référence est l'implémentation neutre existante. */
export const baseGameplayExtensionPorts: GameplayExtensionPorts = Object.freeze({
  fieldBattleFormatResolver: resolveBaseFieldBattleFormat,
  fieldBattleRosterPolicy: baseFieldBattleRosterPolicy,
  fieldWildEncounterRouteResolver: resolveBaseFieldWildEncounterRoute,
  fieldWildEncounterIdentityPort: baseFieldWildEncounterIdentityPort,
  wildEncounterStartedObserver: noopWildEncounterStartedObserver,
  fieldBattleBagActionResolver: resolveBaseFieldBattleBagAction,
  battleActionPolicy: baseBattleActionPolicy,
  battleProgressionPolicy: baseBattleProgressionPolicy,
  pokemonLevelPolicy: basePokemonLevelPolicy,
  pokemonInitialTeamResolver: basePokemonInitialTeamResolver,
  pokemonPartyHealingPolicy: basePokemonPartyHealingPolicy,
  pokemonTeamPolicy: basePokemonTeamPolicy,
  worldSessionExtensionPorts: baseWorldSessionExtensionPorts,
  detailedBattleOutcomeObserver: noopDetailedBattleOutcomeObserver,
})
