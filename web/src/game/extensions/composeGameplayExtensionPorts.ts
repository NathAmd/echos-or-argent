import {
  composeBattleActionPolicies,
  type BattleActionPolicy,
} from '../battle/battleActionPolicy'
import {
  composeDetailedBattleOutcomeObservers,
  type DetailedBattleOutcomeObserver,
} from '../battle/battleOutcomeObserver'
import {
  composeBattleProgressionPolicies,
  type BattleProgressionPolicy,
} from '../battle/battleProgressionPolicy'
import type { FieldBattleBagActionResolver } from '../battle/fieldBattleBagActionResolver'
import type { FieldBattleFormatResolver } from '../battle/fieldBattleFormatResolver'
import {
  composeFieldBattleRosterPolicies,
  type FieldBattleRosterPolicy,
} from '../battle/fieldBattleRosterPolicy'
import type { FieldWildEncounterIdentityPort } from '../encounters/fieldWildEncounterIdentityPort'
import type { FieldWildEncounterRouteResolver } from '../encounters/fieldWildEncounterRouteResolver'
import {
  composeWildEncounterStartedObservers,
  type WildEncounterStartedObserver,
} from '../encounters/wildEncounterStartedObserver'
import {
  composePokemonInitialTeamResolvers,
  type PokemonInitialTeamResolver,
} from '../pokemon/pokemonInitialTeamResolver'
import {
  composePokemonPartyHealingPolicies,
  type PokemonPartyHealingPolicy,
} from '../pokemon/pokemonPartyHealingPolicy'
import {
  composePokemonLevelPolicies,
  type PokemonLevelPolicy,
} from '../pokemon/pokemonLevelPolicy'
import {
  composePokemonTeamPolicies,
  type PokemonTeamPolicy,
} from '../pokemon/pokemonTeamPolicy'
import type { DynamicWorldActor } from '../world/dynamicWorldActorRegistry'
import type { WorldSessionExtensionPorts } from '../world/worldSession'
import type { GameplayExtensionPorts } from './gameplayExtensionPorts'

/**
 * Une contribution ne declare que les domaines qu'elle modifie. L'ordre du
 * tableau fourni a `composeGameplayExtensionPorts` est l'ordre d'application.
 */
export type GameplayExtensionPortContribution = Readonly<Partial<GameplayExtensionPorts>>

function selectLastOverride<T>(
  contributions: readonly GameplayExtensionPortContribution[],
  select: (contribution: GameplayExtensionPortContribution) => T | undefined,
  fallback: T,
): T {
  for (let index = contributions.length - 1; index >= 0; index -= 1) {
    const selected = select(contributions[index]!)
    if (selected !== undefined) return selected
  }
  return fallback
}

function composeFieldWildEncounterIdentityPorts(
  base: FieldWildEncounterIdentityPort,
  contributions: readonly FieldWildEncounterIdentityPort[],
): FieldWildEncounterIdentityPort {
  if (contributions.length === 0) return base
  const ordered = Object.freeze([base, ...contributions])
  return (prepared, context) => ordered.reduce(
    (current, port) => port(current, context),
    prepared,
  )
}

function mergeDynamicActors(
  actorGroups: readonly (readonly DynamicWorldActor[])[],
): readonly DynamicWorldActor[] {
  const ids = new Set<string>()
  const merged: DynamicWorldActor[] = []
  for (const actors of actorGroups) {
    for (const actor of actors) {
      // Le premier fournisseur ordonne conserve l'autorite sur un identifiant.
      if (ids.has(actor.id)) continue
      ids.add(actor.id)
      merged.push(actor)
    }
  }
  return Object.freeze(merged)
}

function composeWorldSessionExtensionPorts(
  base: WorldSessionExtensionPorts,
  contributions: readonly WorldSessionExtensionPorts[],
): WorldSessionExtensionPorts {
  if (contributions.length === 0) return base
  const providers = Object.freeze([
    base.dynamicActors,
    ...contributions.map((ports) => ports.dynamicActors),
  ])
  return Object.freeze({
    dynamicActors: Object.freeze({
      getBlockingActorsAt: (
        mapId: number,
        tileX: number,
        tileZ: number,
        excludedActorId?: string,
      ) => mergeDynamicActors(
        providers.map((provider) => provider.getBlockingActorsAt(mapId, tileX, tileZ, excludedActorId)),
      ),
      getInteractableActorsAt: (mapId: number, tileX: number, tileZ: number) => mergeDynamicActors(
        providers.map((provider) => provider.getInteractableActorsAt(mapId, tileX, tileZ)),
      ),
    }),
  })
}

/**
 * Compose le jeu de base avec des modules ordonnes :
 *
 * - roster, progression, identite sauvage et equipe initiale sont transformes
 *   sequentiellement, toujours apres le port de base ;
 * - les observateurs sont tous notifies ;
 * - action, soin et equipe s'arretent au premier veto ;
 * - le plafond de niveau le plus bas gagne ;
 * - les acteurs dynamiques sont concatenes, puis dedupliques par `id` en
 *   conservant la premiere occurrence ;
 * - format de combat, routage sauvage et resolution du Sac ne se cumulent pas :
 *   la derniere contribution qui declare le port remplace les precedentes, ou
 *   le port de base reste utilise si aucune ne le declare.
 *
 * Sans contribution, une base deja gelee est retournee telle quelle afin que
 * le jeu normal conserve aussi ses references neutres.
 */
export function composeGameplayExtensionPorts(
  base: GameplayExtensionPorts,
  contributions: readonly GameplayExtensionPortContribution[] = [],
): GameplayExtensionPorts {
  if (contributions.length === 0) {
    return Object.isFrozen(base) ? base : Object.freeze({ ...base })
  }

  const ordered = Object.freeze([...contributions])
  const rosterPolicies: FieldBattleRosterPolicy[] = []
  const identityPorts: FieldWildEncounterIdentityPort[] = []
  const wildStartedObservers: WildEncounterStartedObserver[] = []
  const actionPolicies: BattleActionPolicy[] = []
  const progressionPolicies: BattleProgressionPolicy[] = []
  const levelPolicies: PokemonLevelPolicy[] = []
  const initialTeamResolvers: PokemonInitialTeamResolver[] = []
  const healingPolicies: PokemonPartyHealingPolicy[] = []
  const teamPolicies: PokemonTeamPolicy[] = []
  const worldPorts: WorldSessionExtensionPorts[] = []
  const outcomeObservers: DetailedBattleOutcomeObserver[] = []

  for (const contribution of ordered) {
    if (contribution.fieldBattleRosterPolicy) rosterPolicies.push(contribution.fieldBattleRosterPolicy)
    if (contribution.fieldWildEncounterIdentityPort) identityPorts.push(contribution.fieldWildEncounterIdentityPort)
    if (contribution.wildEncounterStartedObserver) wildStartedObservers.push(contribution.wildEncounterStartedObserver)
    if (contribution.battleActionPolicy) actionPolicies.push(contribution.battleActionPolicy)
    if (contribution.battleProgressionPolicy) progressionPolicies.push(contribution.battleProgressionPolicy)
    if (contribution.pokemonLevelPolicy) levelPolicies.push(contribution.pokemonLevelPolicy)
    if (contribution.pokemonInitialTeamResolver) initialTeamResolvers.push(contribution.pokemonInitialTeamResolver)
    if (contribution.pokemonPartyHealingPolicy) healingPolicies.push(contribution.pokemonPartyHealingPolicy)
    if (contribution.pokemonTeamPolicy) teamPolicies.push(contribution.pokemonTeamPolicy)
    if (contribution.worldSessionExtensionPorts) worldPorts.push(contribution.worldSessionExtensionPorts)
    if (contribution.detailedBattleOutcomeObserver) outcomeObservers.push(contribution.detailedBattleOutcomeObserver)
  }

  return Object.freeze({
    fieldBattleFormatResolver: selectLastOverride<FieldBattleFormatResolver>(
      ordered,
      (contribution) => contribution.fieldBattleFormatResolver,
      base.fieldBattleFormatResolver,
    ),
    fieldBattleRosterPolicy: rosterPolicies.length === 0
      ? base.fieldBattleRosterPolicy
      : composeFieldBattleRosterPolicies([base.fieldBattleRosterPolicy, ...rosterPolicies]),
    fieldWildEncounterRouteResolver: selectLastOverride<FieldWildEncounterRouteResolver>(
      ordered,
      (contribution) => contribution.fieldWildEncounterRouteResolver,
      base.fieldWildEncounterRouteResolver,
    ),
    fieldWildEncounterIdentityPort: composeFieldWildEncounterIdentityPorts(
      base.fieldWildEncounterIdentityPort,
      identityPorts,
    ),
    wildEncounterStartedObserver: wildStartedObservers.length === 0
      ? base.wildEncounterStartedObserver
      : composeWildEncounterStartedObservers([base.wildEncounterStartedObserver, ...wildStartedObservers]),
    fieldBattleBagActionResolver: selectLastOverride<FieldBattleBagActionResolver>(
      ordered,
      (contribution) => contribution.fieldBattleBagActionResolver,
      base.fieldBattleBagActionResolver,
    ),
    battleActionPolicy: actionPolicies.length === 0
      ? base.battleActionPolicy
      : composeBattleActionPolicies([base.battleActionPolicy, ...actionPolicies]),
    battleProgressionPolicy: progressionPolicies.length === 0
      ? base.battleProgressionPolicy
      : composeBattleProgressionPolicies([base.battleProgressionPolicy, ...progressionPolicies]),
    pokemonLevelPolicy: levelPolicies.length === 0
      ? base.pokemonLevelPolicy
      : composePokemonLevelPolicies([base.pokemonLevelPolicy, ...levelPolicies]),
    pokemonInitialTeamResolver: initialTeamResolvers.length === 0
      ? base.pokemonInitialTeamResolver
      : composePokemonInitialTeamResolvers([base.pokemonInitialTeamResolver, ...initialTeamResolvers]),
    pokemonPartyHealingPolicy: healingPolicies.length === 0
      ? base.pokemonPartyHealingPolicy
      : composePokemonPartyHealingPolicies([base.pokemonPartyHealingPolicy, ...healingPolicies]),
    pokemonTeamPolicy: teamPolicies.length === 0
      ? base.pokemonTeamPolicy
      : composePokemonTeamPolicies([base.pokemonTeamPolicy, ...teamPolicies]),
    worldSessionExtensionPorts: composeWorldSessionExtensionPorts(
      base.worldSessionExtensionPorts,
      worldPorts,
    ),
    detailedBattleOutcomeObserver: outcomeObservers.length === 0
      ? base.detailedBattleOutcomeObserver
      : composeDetailedBattleOutcomeObservers([base.detailedBattleOutcomeObserver, ...outcomeObservers]),
  })
}
