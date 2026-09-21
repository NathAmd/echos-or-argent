import { describe, expect, it } from 'vitest'
import { baseBattleActionPolicy } from '../battle/battleActionPolicy'
import { noopDetailedBattleOutcomeObserver } from '../battle/battleOutcomeObserver'
import { resolveBaseFieldBattleBagAction } from '../battle/fieldBattleBagActionResolver'
import { resolveBaseFieldBattleFormat } from '../battle/fieldBattleFormatResolver'
import { baseFieldBattleRosterPolicy } from '../battle/fieldBattleRosterPolicy'
import { baseBattleProgressionPolicy } from '../battle/battleProgressionPolicy'
import { baseFieldWildEncounterIdentityPort } from '../encounters/fieldWildEncounterIdentityPort'
import { resolveBaseFieldWildEncounterRoute } from '../encounters/fieldWildEncounterRouteResolver'
import { noopWildEncounterStartedObserver } from '../encounters/wildEncounterStartedObserver'
import { basePokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'
import { basePokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import { basePokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { baseWorldSessionExtensionPorts } from '../world/worldSession'
import { baseGameplayExtensionPorts } from './gameplayExtensionPorts'

describe('point de composition des extensions de gameplay', () => {
  it('selectionne uniquement les implementations neutres pour le jeu de base', () => {
    expect(baseGameplayExtensionPorts).toEqual({
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
    expect(Object.isFrozen(baseGameplayExtensionPorts)).toBe(true)
  })
})
