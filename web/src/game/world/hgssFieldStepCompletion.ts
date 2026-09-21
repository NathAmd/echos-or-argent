import type { RomInventory } from '../../ndsTypes'
import { advanceHgssDaycareStep } from '../daycare/hgssDaycare'
import { advanceHgssRepelStep } from '../encounters/hgssRepel'
import { advanceHgssFriendGroupDays } from '../multiplayer/hgssFriendGroups'
import { advancePokemonPartyPokerusDays } from '../pokemon/pokemonParty'
import { updateHgssSafariHostStep } from '../safari/hgssSafariHostRuntime'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import { advanceHgssRtcPenaltyState, hasHgssRtcPenalty, type HgssRtcPenaltyState } from '../time/hgssRtcPenalty'
import type { WorldMoveResult } from './worldSession'
import {
  advanceHgssFieldPoisonStep,
  advanceHgssWalkingFriendshipStep,
  type HgssFieldPoisonStepResult,
  type HgssWalkingFriendshipStepResult,
} from './hgssPartyStepEffects'

export type HgssFieldStepCompletion = {
  rtcPenaltyState: HgssRtcPenaltyState
  hadRtcPenaltyForDailyTasks: boolean
  eggReadyToHatch: boolean
  poison: HgssFieldPoisonStepResult
  repel?: ReturnType<typeof advanceHgssRepelStep>
  walkingFriendship?: HgssWalkingFriendshipStepResult
}

export const hgssFieldStepInterruptScripts = {
  survivePoisoning: 2003,
  hatchEgg: 2021,
  repelWoreOff: 2022,
} as const

/** Un effet qui ouvre un script natif interrompt tout le reste du cycle terrain. */
export function resolveHgssFieldStepInterruptScript(completion: HgssFieldStepCompletion): number | undefined {
  if (completion.poison.effect === 'survive') return hgssFieldStepInterruptScripts.survivePoisoning
  if (completion.eggReadyToHatch) return hgssFieldStepInterruptScripts.hatchEgg
  if (completion.repel?.expired) return hgssFieldStepInterruptScripts.repelWoreOff
  return undefined
}

export function isHgssProcessableFieldStep(
  result: WorldMoveResult,
): result is Extract<WorldMoveResult, { kind: 'moved' }> {
  return result.kind === 'moved'
    && result.continuationDirection === undefined
    && result.coordinate === undefined
    && (result.warp === undefined || result.warpActivation?.trigger === 'completed-step-held')
}

/** Applique les tâches de pas situées entre les transitions immédiates et les rencontres. */
export function completeHgssFieldStep(options: {
  state: FieldScriptState
  inventory?: RomInventory
  rtcPenaltyState: HgssRtcPenaltyState
  currentIgtMinutes: number
  mapSectionId: number
  onUrgentTriggerScheduled: () => void
}): HgssFieldStepCompletion {
  const { state, inventory } = options
  const runtime = state.pokemonRuntime
  const rtcAdvance = runtime ? advanceHgssRtcPenaltyState(options.rtcPenaltyState, runtime.now()) : undefined
  const nextRtcPenaltyState = rtcAdvance?.state ?? options.rtcPenaltyState
  const hadRtcPenaltyForDailyTasks = rtcAdvance?.hadPenaltyForDailyTasks ?? hasHgssRtcPenalty(nextRtcPenaltyState)
  if (rtcAdvance) {
    advanceHgssFriendGroupDays(state.friendGroups, rtcAdvance.elapsedDays)
    advancePokemonPartyPokerusDays(state.party, rtcAdvance.elapsedDays)
  }

  const poison = advanceHgssFieldPoisonStep(state)
  if (poison.effect === 'survive') {
    return { rtcPenaltyState: nextRtcPenaltyState, hadRtcPenaltyForDailyTasks, eggReadyToHatch: false, poison }
  }

  if (runtime && inventory) {
    updateHgssSafariHostStep({
      state,
      inventory,
      now: runtime.now(),
      currentIgtMinutes: options.currentIgtMinutes,
      rtcPenalty: hadRtcPenaltyForDailyTasks,
      onUrgentTriggerScheduled: options.onUrgentTriggerScheduled,
    })
  }

  const eggReadyToHatch = runtime ? advanceHgssDaycareStep(
    state.daycare,
    runtime.catalog,
    runtime.rng,
    state.party,
    runtime.now(),
    runtime.mt,
    hasHgssRtcPenalty(nextRtcPenaltyState),
  ) : false

  const repel = eggReadyToHatch ? undefined : advanceHgssRepelStep(state.roamers)
  const walkingFriendship = runtime && !eggReadyToHatch && !repel?.expired
    ? advanceHgssWalkingFriendshipStep({
        state, mapSectionId: options.mapSectionId, rng: runtime.rng, itemCatalog: inventory?.itemCatalog,
      })
    : undefined
  return {
    rtcPenaltyState: nextRtcPenaltyState,
    hadRtcPenaltyForDailyTasks,
    eggReadyToHatch,
    poison,
    repel,
    walkingFriendship,
  }
}
