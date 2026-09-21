import type { OpeningMapPreview } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput } from './fieldInputSimulator'
import { findInputsToNpc, findInputsToWarp, type JohtoJourneyPosition, ZEPHYR_BADGE_TARGET } from './johtoJourneyPlanner'
import { createZephyrJourneyAgent } from './zephyrJourneyAgent'

export const TOGEPI_EGG_TARGET = Object.freeze({
  id: 'togepi-egg',
  label: 'Récupérer l’Œuf de Togepi à la Boutique de Mauville',
  violetGymMapId: 135,
  violetCityMapId: 73,
  violetShopMapId: 157,
  elmAideObjectId: 4,
  receivedFlagId: 407,
  deliveryVariableId: 16_500,
  deliveryVariableValue: 4,
  speciesId: 175,
})

type JourneyCheckpoint = Readonly<{ id: string, label: string }>

export type TogepiEggJourneyAgent = Readonly<{
  nextInput: (position: JohtoJourneyPosition, state: FieldScriptState) => FieldInput | undefined
  getCheckpoint: () => JourneyCheckpoint
  getChoiceIndex: (state: FieldScriptState) => number
  invalidatePlan: () => void
}>

const movements: Partial<Record<FieldInput, { x: number, z: number }>> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

export function hasTogepiEggGift(state: FieldScriptState): boolean {
  return state.flags.has(TOGEPI_EGG_TARGET.receivedFlagId)
    && state.party.members.some((pokemon) => pokemon.speciesId === TOGEPI_EGG_TARGET.speciesId && pokemon.isEgg)
}

export function hasRecordedTogepiEggDelivery(state: FieldScriptState): boolean {
  return state.flags.has(TOGEPI_EGG_TARGET.receivedFlagId)
    && state.variables.get(TOGEPI_EGG_TARGET.deliveryVariableId) === TOGEPI_EGG_TARGET.deliveryVariableValue
}

export function isTogepiEggJourneyReached(state: FieldScriptState, mapId: number | undefined): boolean {
  return mapId === TOGEPI_EGG_TARGET.violetCityMapId
    && hasTogepiEggGift(state)
    && hasRecordedTogepiEggDelivery(state)
}

export function createTogepiEggJourneyAgent(
  maps: OpeningMapPreview[],
  starterChoice: 0 | 1 | 2 = 1,
): TogepiEggJourneyAgent {
  const zephyrAgent = createZephyrJourneyAgent(maps, starterChoice)
  let checkpoint: JourneyCheckpoint = { id: ZEPHYR_BADGE_TARGET.id, label: ZEPHYR_BADGE_TARGET.label }
  let followingZephyr = true
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined

  const invalidateOwnPlan = (): void => {
    inputQueue = []
    queuedMapId = undefined
    expectedPosition = undefined
  }
  const invalidatePlan = (): void => {
    invalidateOwnPlan()
    zephyrAgent.invalidatePlan()
  }
  const takePlannedInput = (position: JohtoJourneyPosition, plan: () => FieldInput[]): FieldInput | undefined => {
    const positionKey = `${position.mapId}:${position.tileX}:${position.tileZ}`
    if (expectedPosition !== undefined && expectedPosition !== positionKey) invalidateOwnPlan()
    expectedPosition = undefined
    if (queuedMapId !== position.mapId || inputQueue.length === 0) {
      inputQueue = plan()
      queuedMapId = position.mapId
    }
    const input = inputQueue.shift()
    if (!input) return undefined
    const movement = movements[input]
    const facesInteraction = movement !== undefined && inputQueue[0] === 'confirm'
    expectedPosition = movement && !facesInteraction
      ? `${position.mapId}:${position.tileX + movement.x}:${position.tileZ + movement.z}`
      : positionKey
    return input
  }

  return Object.freeze({
    nextInput(position, state) {
      if (!state.badges.has(ZEPHYR_BADGE_TARGET.badgeIndex)) {
        checkpoint = zephyrAgent.getCheckpoint()
        return zephyrAgent.nextInput(position, state)
      }
      if (followingZephyr) {
        followingZephyr = false
        invalidatePlan()
      }
      if (isTogepiEggJourneyReached(state, position.mapId)) {
        checkpoint = { id: 'togepi-egg-complete', label: 'Œuf de Togepi récupéré' }
        return undefined
      }
      if (position.mapId === TOGEPI_EGG_TARGET.violetGymMapId) {
        checkpoint = { id: 'leave-violet-gym', label: 'Quitter l’Arène de Mauville' }
        return takePlannedInput(position, () => findInputsToWarp(maps, position, TOGEPI_EGG_TARGET.violetCityMapId, state))
      }
      if (position.mapId === TOGEPI_EGG_TARGET.violetCityMapId) {
        if (hasTogepiEggGift(state)) {
          throw new Error(`La remise de l’Œuf n’a pas finalisé la variable ROM ${TOGEPI_EGG_TARGET.deliveryVariableId}.`)
        }
        checkpoint = { id: 'enter-violet-shop', label: 'Entrer dans la Boutique de Mauville' }
        return takePlannedInput(position, () => findInputsToWarp(maps, position, TOGEPI_EGG_TARGET.violetShopMapId, state))
      }
      if (position.mapId === TOGEPI_EGG_TARGET.violetShopMapId) {
        if (hasTogepiEggGift(state)) {
          checkpoint = { id: 'leave-violet-shop', label: 'Quitter la Boutique avec l’Œuf' }
          return takePlannedInput(position, () => findInputsToWarp(maps, position, TOGEPI_EGG_TARGET.violetCityMapId, state))
        }
        const aide = maps.find((map) => map.id === position.mapId)?.events?.objects.find((object) => (
          object.id === TOGEPI_EGG_TARGET.elmAideObjectId
          && object.eventFlag === TOGEPI_EGG_TARGET.receivedFlagId
        ))
        if (!aide) throw new Error('L’assistant d’Orme attendu est absent de la Boutique de Mauville.')
        checkpoint = { id: TOGEPI_EGG_TARGET.id, label: TOGEPI_EGG_TARGET.label }
        return takePlannedInput(position, () => findInputsToNpc(maps, position, aide.id, state))
      }
      throw new Error(`Le jalon Togepi ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
    },
    getCheckpoint: () => checkpoint,
    getChoiceIndex: (state) => followingZephyr ? zephyrAgent.getChoiceIndex(state) : 0,
    invalidatePlan,
  })
}
