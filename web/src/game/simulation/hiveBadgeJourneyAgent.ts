import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput } from './fieldInputSimulator'
import {
  findInputsToAdjacentMap,
  findInputsToNpc,
  findInputsToProgressEvent,
  findInputsToWarp,
  type JohtoJourneyPosition,
} from './johtoJourneyPlanner'
import {
  createTogepiEggJourneyAgent,
  hasRecordedTogepiEggDelivery,
  TOGEPI_EGG_TARGET,
} from './togepiEggJourneyAgent'

export const HIVE_BADGE_TARGET = Object.freeze({
  id: 'hive-badge',
  label: 'Battre Hector et recevoir le Badge Essaim',
  badgeIndex: 1,
  trainerId: 21,
  cherrygroveCityMapId: 67,
  route30MapId: 34,
  route31MapId: 35,
  violetGateMapId: 97,
  violetCityMapId: 73,
  route32MapId: 36,
  unionCaveMapId: 99,
  route33MapId: 37,
  azaleaCityMapId: 74,
  kurtHouseMapId: 164,
  kurtObjectId: 0,
  kurtDepartedFlagId: 0x77,
  slowpokeWellEntranceMapId: 114,
  slowpokeWellMapId: 177,
  protonObjectId: 4,
  rocketsDefeatedFlagId: 0x7b,
  gymGuardRemovedFlagId: 0x1a9,
  azaleaGymEntranceMapId: 136,
  azaleaGymMapId: 180,
  leader: { spriteId: 353, scriptId: 2 },
})

type JourneyCheckpoint = Readonly<{ id: string, label: string }>

export type HiveBadgeJourneyAgent = Readonly<{
  nextInput: (position: JohtoJourneyPosition, state: FieldScriptState) => FieldInput | undefined
  getCheckpoint: () => JourneyCheckpoint
  getChoiceIndex: (state: FieldScriptState) => number
  invalidatePlan: () => void
}>

type PlannedInputs = Readonly<{
  inputs: FieldInput[]
  gymEvent?: Readonly<{ key: string, stateKey: string }>
}>

const movements: Partial<Record<FieldInput, { x: number, z: number }>> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

function hasCompletedTogepiDelivery(state: FieldScriptState): boolean {
  return state.badges.has(0)
    && hasRecordedTogepiEggDelivery(state)
}

export function hasClearedSlowpokeWell(state: FieldScriptState): boolean {
  return state.flags.has(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    && state.flags.has(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
}

export function isHiveBadgeJourneyReached(state: FieldScriptState, mapId: number | undefined): boolean {
  return mapId === HIVE_BADGE_TARGET.azaleaGymMapId
    && hasCompletedTogepiDelivery(state)
    && hasClearedSlowpokeWell(state)
    && state.badges.has(HIVE_BADGE_TARGET.badgeIndex)
}

function requireMap(maps: readonly OpeningMapPreview[], mapId: number): OpeningMapPreview {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`La carte ROM ${mapId} du parcours Badge Essaim est absente.`)
  return map
}

function requireObject(
  maps: readonly OpeningMapPreview[],
  mapId: number,
  predicate: (object: MapEventPreview['objects'][number]) => boolean,
  label: string,
): MapEventPreview['objects'][number] {
  const object = requireMap(maps, mapId).events?.objects.find(predicate)
  if (!object) throw new Error(`${label} attendu est absent de la carte ROM ${mapId}.`)
  return object
}

export function createHiveBadgeJourneyAgent(
  maps: OpeningMapPreview[],
  starterChoice: 0 | 1 | 2 = 1,
): HiveBadgeJourneyAgent {
  let togepiAgent: ReturnType<typeof createTogepiEggJourneyAgent> | undefined
  const getTogepiAgent = (): ReturnType<typeof createTogepiEggJourneyAgent> => (
    togepiAgent ??= createTogepiEggJourneyAgent(maps, starterChoice)
  )
  let checkpoint: JourneyCheckpoint = { id: TOGEPI_EGG_TARGET.id, label: TOGEPI_EGG_TARGET.label }
  let followingTogepi = true
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined
  let pendingGymEvent: PlannedInputs['gymEvent']
  const attemptedGymEvents = new Set<string>()
  const visitedGymStates = new Set<string>()

  const gymStateKey = (state: FieldScriptState): string => [...state.gymmick.data].join(',')
  const invalidateOwnPlan = (): void => {
    inputQueue = []
    queuedMapId = undefined
    expectedPosition = undefined
    pendingGymEvent = undefined
  }
  const invalidatePlan = (): void => {
    invalidateOwnPlan()
    togepiAgent?.invalidatePlan()
  }
  const rememberCompletedGymEvent = (state: FieldScriptState, expectedPositionReached: boolean): void => {
    if (!pendingGymEvent || inputQueue.length !== 0) return
    const currentStateKey = gymStateKey(state)
    // Le dernier input peut n'avoir fait que tourner, ou avoir été préempté
    // par un Dresseur : une file vide ne prouve alors pas l'événement ROM.
    if (!expectedPositionReached && currentStateKey === pendingGymEvent.stateKey) return
    attemptedGymEvents.add(pendingGymEvent.key.startsWith('background:')
      ? pendingGymEvent.key
      : `${pendingGymEvent.stateKey}:${pendingGymEvent.key}`)
    visitedGymStates.add(currentStateKey)
    pendingGymEvent = undefined
  }
  const takePlannedInput = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
    plan: () => PlannedInputs,
  ): FieldInput | undefined => {
    const positionKey = `${position.mapId}:${position.tileX}:${position.tileZ}`
    const expectedPositionReached = expectedPosition === undefined || expectedPosition === positionKey
    rememberCompletedGymEvent(state, expectedPositionReached)
    if (!expectedPositionReached) invalidateOwnPlan()
    expectedPosition = undefined
    if (queuedMapId !== position.mapId || inputQueue.length === 0) {
      const planned = plan()
      inputQueue = planned.inputs
      pendingGymEvent = planned.gymEvent
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
  const move = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
    checkpointId: string,
    label: string,
    plan: () => FieldInput[],
  ): FieldInput | undefined => {
    checkpoint = { id: checkpointId, label }
    return takePlannedInput(position, state, () => ({ inputs: plan() }))
  }
  const interactWith = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
    objectId: number,
    checkpointId: string,
    label: string,
  ): FieldInput | undefined => move(
    position,
    state,
    checkpointId,
    label,
    () => findInputsToNpc(maps, position, objectId, state),
  )

  const approachRoute = (() => {
    return [
      { sourceMapId: HIVE_BADGE_TARGET.cherrygroveCityMapId, transition: { kind: 'adjacent-map' as const, targetMapId: HIVE_BADGE_TARGET.route30MapId } },
      { sourceMapId: HIVE_BADGE_TARGET.route30MapId, transition: { kind: 'adjacent-map' as const, targetMapId: HIVE_BADGE_TARGET.route31MapId } },
      { sourceMapId: HIVE_BADGE_TARGET.route31MapId, transition: { kind: 'warp' as const, targetMapId: HIVE_BADGE_TARGET.violetGateMapId } },
      { sourceMapId: HIVE_BADGE_TARGET.violetGateMapId, transition: { kind: 'warp' as const, targetMapId: HIVE_BADGE_TARGET.violetCityMapId } },
      { sourceMapId: HIVE_BADGE_TARGET.violetCityMapId, transition: { kind: 'adjacent-map' as const, targetMapId: HIVE_BADGE_TARGET.route32MapId } },
      { sourceMapId: HIVE_BADGE_TARGET.route32MapId, transition: { kind: 'warp' as const, targetMapId: HIVE_BADGE_TARGET.unionCaveMapId } },
      { sourceMapId: HIVE_BADGE_TARGET.unionCaveMapId, transition: { kind: 'warp' as const, targetMapId: HIVE_BADGE_TARGET.route33MapId } },
      { sourceMapId: HIVE_BADGE_TARGET.route33MapId, transition: { kind: 'adjacent-map' as const, targetMapId: HIVE_BADGE_TARGET.azaleaCityMapId } },
    ]
  })()
  const approachMapIds = new Set<number>([
    ...approachRoute.map(({ sourceMapId }) => sourceMapId),
    HIVE_BADGE_TARGET.azaleaCityMapId,
  ])
  const nativePreKurtApproachMapIds = new Set<number>([
    HIVE_BADGE_TARGET.violetCityMapId,
    HIVE_BADGE_TARGET.route32MapId,
    HIVE_BADGE_TARGET.unionCaveMapId,
    HIVE_BADGE_TARGET.route33MapId,
  ])
  const followApproachRoute = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
  ): FieldInput | undefined => {
    const step = approachRoute.find(({ sourceMapId }) => sourceMapId === position.mapId)
    if (!step) return undefined
    if (!state.flags.has(HIVE_BADGE_TARGET.kurtDepartedFlagId)
      && nativePreKurtApproachMapIds.has(step.sourceMapId)) return undefined
    return move(position, state, 'return-to-azalea', 'Rejoindre Écorcia après le blackout', () => (
      step.transition.kind === 'warp'
        ? findInputsToWarp(maps, position, step.transition.targetMapId, state)
        : findInputsToAdjacentMap(maps, position, step.transition.targetMapId, state)
    ))
  }
  const resumeFromApproachInterior = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
  ): FieldInput | undefined => {
    const map = maps.find((candidate) => candidate.id === position.mapId)
    const returnMapId = map?.events?.warps.find((warp) => approachMapIds.has(warp.header))?.header
    if (returnMapId === undefined) return undefined
    return move(position, state, 'return-to-azalea', 'Rejoindre Écorcia après le blackout', () => (
      findInputsToWarp(maps, position, returnMapId, state)
    ))
  }

  const planAzaleaGym = (position: JohtoJourneyPosition, state: FieldScriptState): PlannedInputs => {
    const map = requireMap(maps, HIVE_BADGE_TARGET.azaleaGymMapId)
    const leader = map.events?.objects.find((object) => (
      object.spriteId === HIVE_BADGE_TARGET.leader.spriteId
      && object.scriptId === HIVE_BADGE_TARGET.leader.scriptId
    ))
    if (!leader) throw new Error("Hector attendu est absent de l'Arène d'Écorcia.")
    try {
      return { inputs: findInputsToNpc(maps, position, leader.id, state) }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Aucun chemin d'inputs ROM vers le PNJ")) throw error
    }
    if (state.gymmick.type !== 5) {
      throw new Error(`Le mécanisme AzaleaGym attendu est inactif (type ${state.gymmick.type}).`)
    }
    const stateKey = gymStateKey(state)
    visitedGymStates.add(stateKey)
    const target = state.objects.get(leader.id) ?? leader
    const excluded = new Set([
      ...[...attemptedGymEvents].filter((key) => key.startsWith('background:')),
      ...[...attemptedGymEvents]
        .filter((key) => key.startsWith(`${stateKey}:`))
        .map((key) => key.slice(stateKey.length + 1)),
    ])
    const event = findInputsToProgressEvent(maps, position, state, excluded, target, visitedGymStates)
    return { inputs: event.inputs, gymEvent: { key: event.key, stateKey } }
  }

  return Object.freeze({
    nextInput(position, state) {
      if (position.mapId !== HIVE_BADGE_TARGET.azaleaGymMapId) {
        if (queuedMapId === HIVE_BADGE_TARGET.azaleaGymMapId) invalidateOwnPlan()
        attemptedGymEvents.clear()
        visitedGymStates.clear()
      }
      if (!hasCompletedTogepiDelivery(state)) {
        const prerequisiteAgent = getTogepiAgent()
        checkpoint = prerequisiteAgent.getCheckpoint()
        return prerequisiteAgent.nextInput(position, state)
      }
      if (followingTogepi) {
        if (position.mapId === TOGEPI_EGG_TARGET.violetShopMapId) {
          return move(position, state, 'leave-violet-shop', 'Quitter la Boutique avec l’Œuf', () => (
            findInputsToWarp(maps, position, TOGEPI_EGG_TARGET.violetCityMapId, state)
          ))
        }
        if (position.mapId === TOGEPI_EGG_TARGET.violetGymMapId) {
          return move(position, state, 'leave-violet-gym', 'Quitter l’Arène de Mauville', () => (
            findInputsToWarp(maps, position, TOGEPI_EGG_TARGET.violetCityMapId, state)
          ))
        }
        followingTogepi = false
        invalidatePlan()
      }
      if (isHiveBadgeJourneyReached(state, position.mapId)) {
        checkpoint = { id: 'hive-badge-complete', label: 'Badge Essaim obtenu' }
        return undefined
      }
      if (state.badges.has(HIVE_BADGE_TARGET.badgeIndex)) {
        throw new Error(`Le Badge Essaim a été attribué hors de l'Arène ROM ${HIVE_BADGE_TARGET.azaleaGymMapId}.`)
      }
      const approachInput = followApproachRoute(position, state)
      if (approachInput) return approachInput

      if (!state.flags.has(HIVE_BADGE_TARGET.kurtDepartedFlagId)) {
        switch (position.mapId) {
          case HIVE_BADGE_TARGET.violetCityMapId:
            return move(position, state, 'reach-route-32', 'Quitter Mauville par la Route 32', () => findInputsToAdjacentMap(maps, position, HIVE_BADGE_TARGET.route32MapId, state))
          case HIVE_BADGE_TARGET.route32MapId:
            return move(position, state, 'cross-union-cave', 'Entrer dans les Caves Jumelles', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.unionCaveMapId, state))
          case HIVE_BADGE_TARGET.unionCaveMapId:
            return move(position, state, 'reach-route-33', 'Sortir des Caves Jumelles vers la Route 33', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.route33MapId, state))
          case HIVE_BADGE_TARGET.route33MapId:
            return move(position, state, 'reach-azalea', 'Atteindre Écorcia', () => findInputsToAdjacentMap(maps, position, HIVE_BADGE_TARGET.azaleaCityMapId, state))
          case HIVE_BADGE_TARGET.azaleaCityMapId:
            return move(position, state, 'meet-kurt', 'Entrer chez Fargas', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.kurtHouseMapId, state))
          case HIVE_BADGE_TARGET.kurtHouseMapId: {
            const kurt = requireObject(maps, position.mapId, (object) => object.id === HIVE_BADGE_TARGET.kurtObjectId, 'Fargas')
            return interactWith(position, state, kurt.id, 'send-kurt-to-well', 'Envoyer Fargas au Puits Ramoloss')
          }
          default: {
            const resumeInput = resumeFromApproachInterior(position, state)
            if (resumeInput) return resumeInput
            throw new Error(`Le parcours vers Fargas ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
          }
        }
      }

      if (!state.flags.has(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)) {
        switch (position.mapId) {
          case HIVE_BADGE_TARGET.kurtHouseMapId:
            return move(position, state, 'leave-kurt-house', 'Quitter la maison de Fargas', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.azaleaCityMapId, state))
          case HIVE_BADGE_TARGET.azaleaCityMapId:
            return move(position, state, 'enter-slowpoke-well', 'Entrer dans le Puits Ramoloss', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.slowpokeWellEntranceMapId, state))
          case HIVE_BADGE_TARGET.slowpokeWellEntranceMapId:
            return move(position, state, 'descend-slowpoke-well', 'Descendre dans le Puits Ramoloss', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.slowpokeWellMapId, state))
          case HIVE_BADGE_TARGET.slowpokeWellMapId: {
            const proton = requireObject(maps, position.mapId, (object) => object.id === HIVE_BADGE_TARGET.protonObjectId, 'Proton')
            return interactWith(position, state, proton.id, 'defeat-proton', 'Battre Proton et libérer les Ramoloss')
          }
          default: {
            const resumeInput = resumeFromApproachInterior(position, state)
            if (resumeInput) return resumeInput
            throw new Error(`Le parcours du Puits Ramoloss ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
          }
        }
      }

      if (!state.flags.has(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)) {
        throw new Error(`La victoire du Puits n'a pas posé le flag ROM ${HIVE_BADGE_TARGET.gymGuardRemovedFlagId}.`)
      }
      switch (position.mapId) {
        case HIVE_BADGE_TARGET.kurtHouseMapId:
          return move(position, state, 'return-azalea', 'Retourner à Écorcia', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.azaleaCityMapId, state))
        case HIVE_BADGE_TARGET.slowpokeWellMapId:
          return move(position, state, 'leave-slowpoke-well', 'Remonter du Puits Ramoloss', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.slowpokeWellEntranceMapId, state))
        case HIVE_BADGE_TARGET.slowpokeWellEntranceMapId:
          return move(position, state, 'return-azalea', 'Retourner à Écorcia', () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.azaleaCityMapId, state))
        case HIVE_BADGE_TARGET.azaleaCityMapId:
          return move(position, state, 'enter-azalea-gym', "Entrer dans l'Arène d'Écorcia", () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.azaleaGymEntranceMapId, state))
        case HIVE_BADGE_TARGET.azaleaGymEntranceMapId:
          return move(position, state, HIVE_BADGE_TARGET.id, HIVE_BADGE_TARGET.label, () => findInputsToWarp(maps, position, HIVE_BADGE_TARGET.azaleaGymMapId, state))
        case HIVE_BADGE_TARGET.azaleaGymMapId:
          checkpoint = { id: HIVE_BADGE_TARGET.id, label: HIVE_BADGE_TARGET.label }
          return takePlannedInput(position, state, () => planAzaleaGym(position, state))
        default: {
          const resumeInput = resumeFromApproachInterior(position, state)
          if (resumeInput) return resumeInput
          throw new Error(`Le parcours vers le Badge Essaim ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
        }
      }
    },
    getCheckpoint: () => checkpoint,
    getChoiceIndex: (state) => followingTogepi ? getTogepiAgent().getChoiceIndex(state) : 0,
    invalidatePlan,
  })
}
