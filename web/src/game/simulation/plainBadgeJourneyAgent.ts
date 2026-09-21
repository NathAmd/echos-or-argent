import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput } from './fieldInputSimulator'
import { createHiveBadgeJourneyAgent, HIVE_BADGE_TARGET } from './hiveBadgeJourneyAgent'
import {
  findInputsToAdjacentMap,
  findInputsToNpc,
  findInputsToProgressEvent,
  findInputsToTile,
  findInputsToWarp,
  type JohtoJourneyPosition,
} from './johtoJourneyPlanner'

export const PLAIN_BADGE_TARGET = Object.freeze({
  id: 'plain-badge',
  label: 'Battre Blanche et recevoir le Badge Plaine',
  badgeIndex: 2,
  trainerId: 30,
  azaleaGymMapId: HIVE_BADGE_TARGET.azaleaGymMapId,
  azaleaGymEntranceMapId: HIVE_BADGE_TARGET.azaleaGymEntranceMapId,
  azaleaCityMapId: HIVE_BADGE_TARGET.azaleaCityMapId,
  ilexGateMapId: 100,
  ilexForestMapId: 117,
  route34GateMapId: 171,
  route34MapId: 38,
  daycareMapId: 331,
  goldenrodCityMapId: 76,
  radioTowerMapId: 112,
  goldenrodGymMapId: 137,
  firstFarfetchdFlagId: 0x7d,
  secondFarfetchdFlagId: 0x7e,
  hmReceivedFlagId: 0x80,
  cutTreeFlagId: 0x10,
  radioQuizCompleteFlagId: 792,
  whitneyCrySceneFlagId: 0xb7,
  hmItemId: 420,
  cutMoveId: 15,
  radioQuizObjectId: 2,
  leader: { spriteId: 354, scriptId: 1 },
})

export type PlainBadgeJourneyAction = FieldInput | Readonly<{ kind: 'teach-machine', itemId: number }>

type JourneyCheckpoint = Readonly<{ id: string, label: string }>

export type PlainBadgeJourneyAgent = Readonly<{
  nextInput: (position: JohtoJourneyPosition, state: FieldScriptState) => PlainBadgeJourneyAction | undefined
  getCheckpoint: () => JourneyCheckpoint
  getChoiceIndex: (state: FieldScriptState) => number
  invalidatePlan: () => void
  notifyTrainerBattleWon: (trainerId: number) => void
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

function requireMap(maps: readonly OpeningMapPreview[], mapId: number): OpeningMapPreview {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`La carte ROM ${mapId} du parcours Badge Plaine est absente.`)
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

export function hasClearedIlexForest(state: FieldScriptState): boolean {
  return state.flags.has(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)
    && state.flags.has(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)
    && state.flags.has(PLAIN_BADGE_TARGET.hmReceivedFlagId)
    && state.flags.has(PLAIN_BADGE_TARGET.cutTreeFlagId)
}

export function isPlainBadgeJourneyReached(
  state: FieldScriptState,
  wonTrainerBattleIds: ReadonlySet<number>,
  mapId: number | undefined,
): boolean {
  return mapId === PLAIN_BADGE_TARGET.goldenrodGymMapId
    && hasClearedIlexForest(state)
    && state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
    && state.flags.has(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)
    && state.badges.has(PLAIN_BADGE_TARGET.badgeIndex)
    && wonTrainerBattleIds.has(PLAIN_BADGE_TARGET.trainerId)
}

export function createPlainBadgeJourneyAgent(maps: OpeningMapPreview[]): PlainBadgeJourneyAgent {
  const hiveAgent = createHiveBadgeJourneyAgent(maps, 2)
  let followingHive = true
  let checkpoint: JourneyCheckpoint = { id: HIVE_BADGE_TARGET.id, label: HIVE_BADGE_TARGET.label }
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined
  let pendingGymEvent: PlannedInputs['gymEvent']
  let lastMapId: number | undefined
  let radioQuizChoiceCursor = 0
  const wonTrainerBattleIds = new Set<number>()
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
    hiveAgent.invalidatePlan()
  }
  const rememberCompletedGymEvent = (state: FieldScriptState, expectedPositionReached: boolean): void => {
    if (!pendingGymEvent || inputQueue.length !== 0) return
    const currentStateKey = gymStateKey(state)
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
  const moveToTileThenInteract = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
    target: Readonly<{ tileX: number, tileZ: number }>,
    direction: Exclude<FieldInput, 'confirm'>,
    checkpointId: string,
    label: string,
    avoidCoordinateScriptIds?: ReadonlySet<number>,
  ): FieldInput | undefined => move(position, state, checkpointId, label, () => (
    position.tileX === target.tileX && position.tileZ === target.tileZ
      ? [direction, 'confirm']
      : findInputsToTile(maps, position, target, state, { avoidCoordinateScriptIds })
  ))

  const planAzaleaGymExit = (position: JohtoJourneyPosition, state: FieldScriptState): PlannedInputs => {
    const map = requireMap(maps, PLAIN_BADGE_TARGET.azaleaGymMapId)
    const exit = map.events?.warps.find((warp) => warp.header === PLAIN_BADGE_TARGET.azaleaGymEntranceMapId)
    if (!exit) throw new Error("La sortie de l'Arène d'Écorcia est absente de la ROM.")
    try {
      return { inputs: findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.azaleaGymEntranceMapId, state) }
    } catch (error) {
      if (!(error instanceof Error) || !error.message.startsWith("Aucun chemin d'inputs ROM vers la carte")) throw error
    }
    const stateKey = gymStateKey(state)
    visitedGymStates.add(stateKey)
    const excluded = new Set([
      ...[...attemptedGymEvents].filter((key) => key.startsWith('background:')),
      ...[...attemptedGymEvents]
        .filter((key) => key.startsWith(`${stateKey}:`))
        .map((key) => key.slice(stateKey.length + 1)),
    ])
    const event = findInputsToProgressEvent(maps, position, state, excluded, exit, visitedGymStates)
    return { inputs: event.inputs, gymEvent: { key: event.key, stateKey } }
  }

  return Object.freeze({
    nextInput(position, state) {
      if (position.mapId === PLAIN_BADGE_TARGET.radioTowerMapId && lastMapId !== position.mapId
        && !state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)) radioQuizChoiceCursor = 0
      lastMapId = position.mapId

      if (!state.badges.has(HIVE_BADGE_TARGET.badgeIndex)) {
        checkpoint = hiveAgent.getCheckpoint()
        return hiveAgent.nextInput(position, state)
      }
      if (followingHive) {
        followingHive = false
        invalidateOwnPlan()
      }
      if (isPlainBadgeJourneyReached(state, wonTrainerBattleIds, position.mapId)) {
        checkpoint = { id: 'plain-badge-complete', label: 'Badge Plaine obtenu' }
        return undefined
      }
      if (state.badges.has(PLAIN_BADGE_TARGET.badgeIndex)) {
        throw new Error(`Le Badge Plaine a été attribué hors de l'Arène ROM ${PLAIN_BADGE_TARGET.goldenrodGymMapId}.`)
      }

      switch (position.mapId) {
        case PLAIN_BADGE_TARGET.azaleaGymMapId:
          checkpoint = { id: 'leave-azalea-gym', label: "Quitter l'Arène d'Écorcia" }
          return takePlannedInput(position, state, () => planAzaleaGymExit(position, state))
        case PLAIN_BADGE_TARGET.azaleaGymEntranceMapId:
          return move(position, state, 'return-to-azalea', 'Retourner à Écorcia', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.azaleaCityMapId, state)
          ))
        case PLAIN_BADGE_TARGET.azaleaCityMapId:
          return move(position, state, 'reach-ilex-gate', 'Entrer dans le poste du Bois aux Chênes', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.ilexGateMapId, state)
          ))
        case PLAIN_BADGE_TARGET.ilexGateMapId:
          return move(position, state, 'enter-ilex-forest', 'Entrer dans le Bois aux Chênes', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.ilexForestMapId, state)
          ))
        case PLAIN_BADGE_TARGET.ilexForestMapId: {
          if (!state.flags.has(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)) {
            if (state.variables.get(0x4002) !== 1) {
              return move(position, state, 'first-farfetchd-twig', 'Faire craquer la première brindille', () => (
                findInputsToTile(maps, position, { tileX: 25, tileZ: 66 }, state)
              ))
            }
            return moveToTileThenInteract(position, state, { tileX: 25, tileZ: 61 }, 'down', 'catch-first-farfetchd', 'Rattraper le premier Canarticho')
          }
          if (!state.flags.has(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)) {
            const bird = state.objects.get(2) ?? requireObject(
              maps,
              position.mapId,
              (object) => object.id === 2,
              'Second Canarticho',
            )
            if (bird.x === 41 && bird.z === 54) {
              return moveToTileThenInteract(position, state, { tileX: 41, tileZ: 55 }, 'up', 'move-second-farfetchd', 'Faire fuir le second Canarticho')
            }
            if (state.variables.get(0x4003) !== 1) {
              return move(position, state, 'second-farfetchd-twig', 'Faire craquer la brindille à droite', () => (
                findInputsToTile(maps, position, { tileX: 52, tileZ: 53 }, state)
              ))
            }
            return moveToTileThenInteract(
              position,
              state,
              { tileX: 48, tileZ: 54 },
              'right',
              'catch-second-farfetchd',
              'Rattraper le second Canarticho',
              new Set([7]),
            )
          }
          if (!state.flags.has(PLAIN_BADGE_TARGET.hmReceivedFlagId)
            || (state.inventory.get(PLAIN_BADGE_TARGET.hmItemId) ?? 0) < 1) {
            throw new Error('La quête des Canarticho n’a pas remis la CS01 Coupe.')
          }
          if (!state.party.members.some((pokemon) => pokemon.moves.some((move) => move.moveId === PLAIN_BADGE_TARGET.cutMoveId))) {
            checkpoint = { id: 'learn-cut', label: 'Apprendre Coupe avec la CS01' }
            invalidateOwnPlan()
            return { kind: 'teach-machine', itemId: PLAIN_BADGE_TARGET.hmItemId }
          }
          if (!state.flags.has(PLAIN_BADGE_TARGET.cutTreeFlagId)) {
            const tree = requireObject(
              maps,
              position.mapId,
              (object) => object.spriteId === 86 && object.scriptId === 10000,
              'Arbre Coupe',
            )
            return move(position, state, 'use-cut', 'Couper l’arbre du Bois aux Chênes', () => (
              findInputsToNpc(maps, position, tree.id, state)
            ))
          }
          return move(position, state, 'leave-ilex-forest', 'Sortir du Bois aux Chênes', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.route34GateMapId, state)
          ))
        }
        case PLAIN_BADGE_TARGET.route34GateMapId:
          return move(position, state, 'reach-route-34', 'Rejoindre la Route 34', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.route34MapId, state)
          ))
        case PLAIN_BADGE_TARGET.route34MapId:
          if (state.variables.get(0x408e) !== 3) {
            return move(position, state, 'visit-daycare', 'Déclencher la visite de la Pension', () => (
              findInputsToTile(maps, position, { tileX: 17, tileZ: 29 }, state)
            ))
          }
          return move(position, state, 'reach-goldenrod', 'Atteindre Doublonville', () => (
            findInputsToAdjacentMap(maps, position, PLAIN_BADGE_TARGET.goldenrodCityMapId, state)
          ))
        case PLAIN_BADGE_TARGET.daycareMapId:
          return move(position, state, 'leave-daycare', 'Quitter la Pension', () => (
            findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.route34MapId, state)
          ))
        case PLAIN_BADGE_TARGET.goldenrodCityMapId:
          return state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
            ? move(position, state, 'enter-goldenrod-gym', "Entrer dans l'Arène de Doublonville", () => (
                findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.goldenrodGymMapId, state)
              ))
            : move(position, state, 'enter-radio-tower', 'Entrer dans la Tour Radio', () => (
                findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.radioTowerMapId, state)
              ))
        case PLAIN_BADGE_TARGET.radioTowerMapId:
          if (state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)) {
            return move(position, state, 'leave-radio-tower', 'Quitter la Tour Radio', () => (
              findInputsToWarp(maps, position, PLAIN_BADGE_TARGET.goldenrodCityMapId, state)
            ))
          }
          return move(position, state, 'radio-card-quiz', 'Réussir le quiz de la Carte Radio', () => (
            findInputsToNpc(maps, position, PLAIN_BADGE_TARGET.radioQuizObjectId, state)
          ))
        case PLAIN_BADGE_TARGET.goldenrodGymMapId: {
          const whitney = requireObject(
            maps,
            position.mapId,
            (object) => object.spriteId === PLAIN_BADGE_TARGET.leader.spriteId
              && object.scriptId === PLAIN_BADGE_TARGET.leader.scriptId,
            'Blanche',
          )
          if (wonTrainerBattleIds.has(PLAIN_BADGE_TARGET.trainerId)
            && !state.flags.has(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)) {
            return move(position, state, 'whitney-cry-scene', 'Amorcer la scène de sortie après Blanche', () => (
              findInputsToTile(maps, position, { tileX: 13, tileZ: 11 }, state)
            ))
          }
          return move(position, state, PLAIN_BADGE_TARGET.id, PLAIN_BADGE_TARGET.label, () => (
            findInputsToNpc(maps, position, whitney.id, state)
          ))
        }
        default:
          throw new Error(`Le parcours vers le Badge Plaine ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
      }
    },
    getCheckpoint: () => checkpoint,
    getChoiceIndex(state) {
      if (followingHive) return hiveAgent.getChoiceIndex(state)
      if (lastMapId !== PLAIN_BADGE_TARGET.radioTowerMapId
        || state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)) return 0
      const choices = [0, 0, 0, 1, 0, 1] as const
      return choices[radioQuizChoiceCursor++] ?? 0
    },
    invalidatePlan,
    notifyTrainerBattleWon(trainerId) {
      wonTrainerBattleIds.add(trainerId)
      invalidateOwnPlan()
    },
  })
}
