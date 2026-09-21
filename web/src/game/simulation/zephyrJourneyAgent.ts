import type { OpeningMapPreview } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput } from './fieldInputSimulator'
import {
  createJohtoJourneyPlanner,
  findInputsToAdjacentMap,
  findInputsToWarp,
  type JohtoJourneyPosition,
  ZEPHYR_BADGE_TARGET,
} from './johtoJourneyPlanner'
import { createOpeningJourneyAgent } from './openingJourneyAgent'

type JourneyCheckpoint = { id: string, label: string }

type StoryTransition = JourneyCheckpoint & {
  transition: { kind: 'warp' | 'adjacent-map', targetMapId: number }
}

export const ELM_PHONE_TO_LAB_RETURN_ROUTE = [
  { id: 'reach-route-29', label: 'Quitter Bourg Geon par la Route 29', transition: { kind: 'adjacent-map', targetMapId: 33 } },
  { id: 'reach-route-30', label: 'Traverser la Route 30', transition: { kind: 'adjacent-map', targetMapId: 67 } },
  { id: 'reach-cherrygrove', label: 'Atteindre Ville Griotte', transition: { kind: 'adjacent-map', targetMapId: 34 } },
  { id: 'visit-mr-pokemon', label: 'Entrer chez M. Pokémon', transition: { kind: 'warp', targetMapId: 143 } },
  { id: 'leave-mr-pokemon', label: 'Quitter la maison de M. Pokémon', transition: { kind: 'warp', targetMapId: 34 } },
  { id: 'return-route-30', label: 'Revenir sur la Route 30', transition: { kind: 'adjacent-map', targetMapId: 67 } },
  { id: 'rival-battle', label: 'Affronter le rival sur la Route 29', transition: { kind: 'adjacent-map', targetMapId: 33 } },
  { id: 'return-new-bark', label: 'Revenir à Bourg Geon', transition: { kind: 'adjacent-map', targetMapId: 60 } },
  { id: 'return-egg-to-elm', label: 'Rapporter l’Œuf Mystère au Professeur Orme', transition: { kind: 'warp', targetMapId: 61 } },
] as const satisfies readonly StoryTransition[]

export type ZephyrJourneyAgent = {
  nextInput: (position: JohtoJourneyPosition, state: FieldScriptState) => FieldInput | undefined
  getCheckpoint: () => JourneyCheckpoint
  getChoiceIndex: (state: FieldScriptState) => number
  /** Clears queued movement after a battle or any external field interruption. */
  invalidatePlan: () => void
}

const movements: Partial<Record<FieldInput, { x: number, z: number }>> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

export function createZephyrJourneyAgent(
  maps: OpeningMapPreview[],
  starterChoice: 0 | 1 | 2 = 1,
): ZephyrJourneyAgent {
  const openingAgent = createOpeningJourneyAgent(maps, starterChoice)
  const zephyrPlanner = createJohtoJourneyPlanner(maps, ZEPHYR_BADGE_TARGET)
  let phase: 'opening' | 'story' | 'zephyr' | 'complete' = 'opening'
  let storyIndex = 0
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined

  const invalidatePlan = (): void => {
    inputQueue = []
    queuedMapId = undefined
    expectedPosition = undefined
  }

  const takePlannedInput = (
    position: JohtoJourneyPosition,
    plan: () => FieldInput[] | undefined,
  ): FieldInput | undefined => {
    const positionKey = `${position.mapId}:${position.tileX}:${position.tileZ}`
    if (expectedPosition !== undefined && expectedPosition !== positionKey) invalidatePlan()
    expectedPosition = undefined
    if (queuedMapId !== position.mapId || inputQueue.length === 0) {
      inputQueue = plan() ?? []
      queuedMapId = position.mapId
    }
    const input = inputQueue.shift()
    if (!input) return undefined
    const movement = movements[input]
    const isFacingInteraction = movement !== undefined && inputQueue[0] === 'confirm'
    expectedPosition = movement && !isFacingInteraction
      ? `${position.mapId}:${position.tileX + movement.x}:${position.tileZ + movement.z}`
      : positionKey
    return input
  }

  const advanceStory = (position: JohtoJourneyPosition): void => {
    while (ELM_PHONE_TO_LAB_RETURN_ROUTE[storyIndex]?.transition.targetMapId === position.mapId) {
      storyIndex += 1
      invalidatePlan()
    }
    if (storyIndex >= ELM_PHONE_TO_LAB_RETURN_ROUTE.length) {
      phase = 'zephyr'
      invalidatePlan()
    }
  }

  return {
    nextInput(position, state) {
      if (phase === 'opening') {
        const input = openingAgent.nextInput(position, state)
        if (input !== undefined) return input
        phase = 'story'
        invalidatePlan()
      }
      if (phase === 'story') {
        advanceStory(position)
        if (phase === 'story') {
          const goal = ELM_PHONE_TO_LAB_RETURN_ROUTE[storyIndex]!
          return takePlannedInput(position, () => (
            goal.transition.kind === 'warp'
              ? findInputsToWarp(maps, position, goal.transition.targetMapId, state)
              : findInputsToAdjacentMap(maps, position, goal.transition.targetMapId, state)
          ))
        }
      }
      if (phase === 'zephyr') {
        if (zephyrPlanner.getMilestone(state).reached) {
          phase = 'complete'
          invalidatePlan()
          return undefined
        }
        return takePlannedInput(position, () => zephyrPlanner.planInputs(position, state))
      }
      return undefined
    },
    getCheckpoint() {
      if (phase === 'opening') return openingAgent.getCheckpoint()
      if (phase === 'story') {
        const goal = ELM_PHONE_TO_LAB_RETURN_ROUTE[storyIndex]
        return goal ? { id: goal.id, label: goal.label } : { id: ZEPHYR_BADGE_TARGET.id, label: ZEPHYR_BADGE_TARGET.label }
      }
      if (phase === 'zephyr') return { id: ZEPHYR_BADGE_TARGET.id, label: ZEPHYR_BADGE_TARGET.label }
      return { id: 'zephyr-badge-complete', label: 'Badge Zéphyr obtenu' }
    },
    getChoiceIndex(state) {
      return phase === 'opening' ? openingAgent.getChoiceIndex(state) : 0
    },
    invalidatePlan,
  }
}
