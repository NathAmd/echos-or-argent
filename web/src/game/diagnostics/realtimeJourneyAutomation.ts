import type { OpeningMapPreview } from '../../ndsTypes'
import { inspectPokemonMachineCompatibility, usePokemonMachine } from '../items/usePokemonMachine'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { createFogBadgeJourneyAgent, FOG_BADGE_TARGET, hasReleasedLegendaryBeasts, isFogBadgeJourneyReached, type FogBadgeJourneyAgent } from '../simulation/fogBadgeJourneyAgent'
import { createHiveBadgeJourneyAgent, hasClearedSlowpokeWell, HIVE_BADGE_TARGET, isHiveBadgeJourneyReached, type HiveBadgeJourneyAgent } from '../simulation/hiveBadgeJourneyAgent'
import { ZEPHYR_BADGE_TARGET } from '../simulation/johtoJourneyPlanner'
import { createOpeningJourneyAgent, type OpeningJourneyAgent } from '../simulation/openingJourneyAgent'
import { createPlainBadgeJourneyAgent, hasClearedIlexForest, isPlainBadgeJourneyReached, PLAIN_BADGE_TARGET, type PlainBadgeJourneyAgent } from '../simulation/plainBadgeJourneyAgent'
import { createTogepiEggJourneyAgent, hasRecordedTogepiEggDelivery, isTogepiEggJourneyReached, type TogepiEggJourneyAgent } from '../simulation/togepiEggJourneyAgent'
import { createZephyrJourneyAgent, type ZephyrJourneyAgent } from '../simulation/zephyrJourneyAgent'
import type { RealtimeTestBotJourney } from './realtimeTestScript'

export type RealtimeJourneyAgent = OpeningJourneyAgent | ZephyrJourneyAgent | TogepiEggJourneyAgent | HiveBadgeJourneyAgent | PlainBadgeJourneyAgent | FogBadgeJourneyAgent

export function runBotMachine(
  state: FieldScriptState,
  itemId: number,
  checkpointId: string,
  fail: (message: string, error: Error) => void,
  succeed: (message: string) => void,
): void {
  const runtime = state.pokemonRuntime
  const learner = runtime && state.party.members.find((pokemon) => (
    inspectPokemonMachineCompatibility(pokemon, itemId, runtime.catalog).kind === 'compatible'
  ))
  if (!runtime || !learner) {
    const error = new Error(`Aucun Pokémon ne peut apprendre la machine ${itemId}.`)
    fail(`Blocage audit ${checkpointId} · ${error.message}`, error)
    return
  }
  let result = usePokemonMachine(state.inventory, itemId, learner, runtime.catalog)
  if (result.kind === 'replacement-required') result = usePokemonMachine(state.inventory, itemId, learner, runtime.catalog, 0)
  if (result.kind !== 'learned') {
    const error = new Error(result.kind === 'unavailable' ? result.reason : 'Aucune capacité n’a été remplacée.')
    fail(`Blocage audit ${checkpointId} · ${error.message}`, error)
    return
  }
  succeed(`Bot audit : ${result.machine.kind}${result.machine.number} apprise ·`)
}

export function recordBotWins(
  wonTrainerBattleIds: Set<number>,
  agent: RealtimeJourneyAgent | undefined,
  trainerIds: readonly number[],
): void {
  for (const trainerId of trainerIds) {
    wonTrainerBattleIds.add(trainerId)
    if (agent && 'notifyTrainerBattleWon' in agent) agent.notifyTrainerBattleWon(trainerId)
  }
}

export type RealtimeJourneyEvidence = Readonly<{
  zephyrBadge: boolean
  falknerDefeated: boolean
  togepiEggReceived: boolean
  togepiReturnComplete: boolean
  slowpokeWellCleared: boolean
  hiveBadge: boolean
  bugsyDefeated: boolean
  hiveGymComplete: boolean
  ilexForestCleared: boolean
  cutLearned: boolean
  radioQuizComplete: boolean
  plainBadge: boolean
  whitneyDefeated: boolean
  plainGymComplete: boolean
  squirtBottleReceived: boolean
  sudowoodoCleared: boolean
  legendaryBeastsReleased: boolean
  fogBadge: boolean
  mortyDefeated: boolean
  fogGymComplete: boolean
}>

export function createRealtimeJourneyAgent(
  journey: RealtimeTestBotJourney,
  maps: OpeningMapPreview[],
): RealtimeJourneyAgent {
  switch (journey) {
    case 'opening': return createOpeningJourneyAgent(maps)
    case 'zephyr': return createZephyrJourneyAgent(maps)
    case 'togepi': return createTogepiEggJourneyAgent(maps)
    case 'hive': return createHiveBadgeJourneyAgent(maps)
    case 'plain': return createPlainBadgeJourneyAgent(maps)
    case 'fog': return createFogBadgeJourneyAgent(maps)
    default: throw new Error(`Parcours d’audit navigateur inconnu: ${String(journey)}.`)
  }
}

export function collectRealtimeJourneyEvidence(
  state: FieldScriptState,
  wonTrainerBattleIds: ReadonlySet<number>,
  mapId: number | undefined,
): RealtimeJourneyEvidence {
  return Object.freeze({
    zephyrBadge: state.badges.has(ZEPHYR_BADGE_TARGET.badgeIndex),
    falknerDefeated: wonTrainerBattleIds.has(ZEPHYR_BADGE_TARGET.trainerId),
    togepiEggReceived: hasRecordedTogepiEggDelivery(state),
    togepiReturnComplete: isTogepiEggJourneyReached(state, mapId),
    slowpokeWellCleared: hasClearedSlowpokeWell(state),
    hiveBadge: state.badges.has(HIVE_BADGE_TARGET.badgeIndex),
    bugsyDefeated: wonTrainerBattleIds.has(HIVE_BADGE_TARGET.trainerId),
    hiveGymComplete: isHiveBadgeJourneyReached(state, mapId),
    ilexForestCleared: hasClearedIlexForest(state),
    cutLearned: state.party.members.some((pokemon) => pokemon.moves?.some((move) => move.moveId === PLAIN_BADGE_TARGET.cutMoveId) ?? false),
    radioQuizComplete: state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId),
    plainBadge: state.badges.has(PLAIN_BADGE_TARGET.badgeIndex),
    whitneyDefeated: wonTrainerBattleIds.has(PLAIN_BADGE_TARGET.trainerId),
    plainGymComplete: isPlainBadgeJourneyReached(state, wonTrainerBattleIds, mapId),
    squirtBottleReceived: (state.inventory.get(FOG_BADGE_TARGET.squirtBottleItemId) ?? 0) > 0,
    sudowoodoCleared: state.flags.has(FOG_BADGE_TARGET.sudowoodoFlagId),
    legendaryBeastsReleased: hasReleasedLegendaryBeasts(state),
    fogBadge: state.badges.has(FOG_BADGE_TARGET.badgeIndex),
    mortyDefeated: wonTrainerBattleIds.has(FOG_BADGE_TARGET.trainerId),
    fogGymComplete: isFogBadgeJourneyReached(state, wonTrainerBattleIds, mapId),
  })
}
