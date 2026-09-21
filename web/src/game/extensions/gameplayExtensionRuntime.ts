import type { GameplayExtensionPorts } from './gameplayExtensionPorts'

/**
 * Façade stable pour les contrôleurs qui capturent leurs ports à la création.
 * L'activation d'une campagne remplace uniquement la cible de délégation :
 * aucune UI ni session déjà construite ne conserve ainsi une ancienne règle.
 */
export type GameplayExtensionRuntime = Readonly<{
  ports: GameplayExtensionPorts
  activate: (ports: GameplayExtensionPorts) => void
  reset: () => void
  getActivePorts: () => GameplayExtensionPorts
}>

export function createGameplayExtensionRuntime(
  basePorts: GameplayExtensionPorts,
): GameplayExtensionRuntime {
  let activePorts = basePorts

  const pokemonInitialTeamResolver: GameplayExtensionPorts['pokemonInitialTeamResolver'] = Object.assign(
    (request: Parameters<GameplayExtensionPorts['pokemonInitialTeamResolver']>[0], currentTeam: Parameters<GameplayExtensionPorts['pokemonInitialTeamResolver']>[1]) => (
      activePorts.pokemonInitialTeamResolver(request, currentTeam)
    ),
    {
      onInitialTeamCommitted: (party: Parameters<NonNullable<GameplayExtensionPorts['pokemonInitialTeamResolver']['onInitialTeamCommitted']>>[0]) => (
        activePorts.pokemonInitialTeamResolver.onInitialTeamCommitted?.(party)
      ),
    },
  )
  const dynamicActors: GameplayExtensionPorts['worldSessionExtensionPorts']['dynamicActors'] = Object.freeze({
    getBlockingActorsAt: (mapId, tileX, tileZ, excludedActorId) => (
      activePorts.worldSessionExtensionPorts.dynamicActors.getBlockingActorsAt(mapId, tileX, tileZ, excludedActorId)
    ),
    getInteractableActorsAt: (mapId, tileX, tileZ) => (
      activePorts.worldSessionExtensionPorts.dynamicActors.getInteractableActorsAt(mapId, tileX, tileZ)
    ),
  })

  const ports: GameplayExtensionPorts = Object.freeze({
    fieldBattleFormatResolver: (battle) => activePorts.fieldBattleFormatResolver(battle),
    fieldBattleRosterPolicy: Object.freeze({
      transformTrainerParty: (party, context) => activePorts.fieldBattleRosterPolicy.transformTrainerParty(party, context),
      transformTrainerHouseParty: (party, context) => activePorts.fieldBattleRosterPolicy.transformTrainerHouseParty(party, context),
      transformScriptedWildPokemon: (pokemon) => activePorts.fieldBattleRosterPolicy.transformScriptedWildPokemon(pokemon),
    }),
    fieldWildEncounterRouteResolver: (encounter) => activePorts.fieldWildEncounterRouteResolver(encounter),
    fieldWildEncounterIdentityPort: (prepared, context) => activePorts.fieldWildEncounterIdentityPort(prepared, context),
    wildEncounterStartedObserver: Object.freeze({
      observeWildEncounterStarted: (event) => activePorts.wildEncounterStartedObserver.observeWildEncounterStarted(event),
    }),
    fieldBattleBagActionResolver: (item, context) => activePorts.fieldBattleBagActionResolver(item, context),
    battleActionPolicy: Object.freeze({
      vetoPlayerAction: (intent) => activePorts.battleActionPolicy.vetoPlayerAction(intent),
    }),
    battleProgressionPolicy: Object.freeze({
      transformDefeatedPokemonRequest: (request) => activePorts.battleProgressionPolicy.transformDefeatedPokemonRequest(request),
    }),
    pokemonLevelPolicy: Object.freeze({
      resolveLevelCap: (context) => activePorts.pokemonLevelPolicy.resolveLevelCap(context),
    }),
    pokemonInitialTeamResolver,
    pokemonPartyHealingPolicy: Object.freeze({
      vetoFullHealRestoration: (context) => activePorts.pokemonPartyHealingPolicy.vetoFullHealRestoration(context),
    }),
    pokemonTeamPolicy: Object.freeze({
      vetoBattleEligibility: (intent) => activePorts.pokemonTeamPolicy.vetoBattleEligibility(intent),
      vetoPartyMutation: (intent) => activePorts.pokemonTeamPolicy.vetoPartyMutation(intent),
    }),
    worldSessionExtensionPorts: Object.freeze({
      dynamicActors,
    }),
    detailedBattleOutcomeObserver: Object.freeze({
      observeBattleOutcome: (event) => activePorts.detailedBattleOutcomeObserver.observeBattleOutcome(event),
    }),
  } satisfies GameplayExtensionPorts)

  return Object.freeze({
    ports,
    activate: (nextPorts) => { activePorts = nextPorts },
    reset: () => { activePorts = basePorts },
    getActivePorts: () => activePorts,
  })
}
