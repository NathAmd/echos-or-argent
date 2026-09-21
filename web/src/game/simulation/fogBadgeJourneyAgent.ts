import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import type { FieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldInput } from './fieldInputSimulator'
import {
  findInputsToAdjacentMap,
  findInputsToNpc,
  findInputsToTile,
  findInputsToWarp,
  type JohtoJourneyPosition,
} from './johtoJourneyPlanner'
import {
  createPlainBadgeJourneyAgent,
  hasClearedIlexForest,
  PLAIN_BADGE_TARGET,
  type PlainBadgeJourneyAction,
} from './plainBadgeJourneyAgent'

export const FOG_BADGE_TARGET = Object.freeze({
  id: 'fog-badge',
  label: 'Battre Mortimer et recevoir le Badge Brume',
  badgeIndex: 3,
  trainerId: 31,
  goldenrodGymMapId: PLAIN_BADGE_TARGET.goldenrodGymMapId,
  goldenrodCityMapId: PLAIN_BADGE_TARGET.goldenrodCityMapId,
  flowerShopMapId: 184,
  route35GateMapId: 101,
  route35MapId: 39,
  route36MapId: 40,
  route37MapId: 41,
  ecruteakCityMapId: 78,
  burnedTowerMapId: 7,
  burnedTowerBasementMapId: 217,
  ecruteakGymMapId: 80,
  squirtBottleItemId: 477,
  sudowoodoFlagId: 450,
  towerRivalFlagId: 454,
  eusineSceneVariableId: 0x40a2,
  legendaryBeastFlagIds: [457, 458, 459] as const,
  florist: { objectId: 0, scriptId: 1 },
  sudowoodo: { objectId: 4, scriptId: 1, spriteId: 381 },
  towerRival: { objectId: 0, spriteId: 148 },
  leader: { objectId: 1, spriteId: 355, scriptId: 2 },
  wrongFloorScriptId: 3,
})

type JourneyCheckpoint = Readonly<{ id: string, label: string }>

export type FogBadgeJourneyAgent = Readonly<{
  nextInput: (position: JohtoJourneyPosition, state: FieldScriptState) => PlainBadgeJourneyAction | undefined
  getCheckpoint: () => JourneyCheckpoint
  getChoiceIndex: (state: FieldScriptState) => number
  invalidatePlan: () => void
  notifyTrainerBattleWon: (trainerId: number) => void
}>

const movements: Partial<Record<FieldInput, { x: number, z: number }>> = {
  up: { x: 0, z: -1 },
  down: { x: 0, z: 1 },
  left: { x: -1, z: 0 },
  right: { x: 1, z: 0 },
}

function requireMap(maps: readonly OpeningMapPreview[], mapId: number): OpeningMapPreview {
  const map = maps.find((candidate) => candidate.id === mapId)
  if (!map) throw new Error(`La carte ROM ${mapId} du parcours Badge Brume est absente.`)
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

export function hasReleasedLegendaryBeasts(state: FieldScriptState): boolean {
  return FOG_BADGE_TARGET.legendaryBeastFlagIds.every((flagId) => state.flags.has(flagId))
}

export function isFogBadgeJourneyReached(
  state: FieldScriptState,
  wonTrainerBattleIds: ReadonlySet<number>,
  mapId: number | undefined,
): boolean {
  return mapId === FOG_BADGE_TARGET.ecruteakGymMapId
    && hasClearedIlexForest(state)
    && state.flags.has(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
    && state.badges.has(PLAIN_BADGE_TARGET.badgeIndex)
    && wonTrainerBattleIds.has(PLAIN_BADGE_TARGET.trainerId)
    && (state.inventory.get(FOG_BADGE_TARGET.squirtBottleItemId) ?? 0) > 0
    && state.flags.has(FOG_BADGE_TARGET.sudowoodoFlagId)
    && hasReleasedLegendaryBeasts(state)
    && state.badges.has(FOG_BADGE_TARGET.badgeIndex)
    && wonTrainerBattleIds.has(FOG_BADGE_TARGET.trainerId)
}

export function createFogBadgeJourneyAgent(maps: OpeningMapPreview[]): FogBadgeJourneyAgent {
  const plainAgent = createPlainBadgeJourneyAgent(maps)
  let followingPlain = true
  let checkpoint: JourneyCheckpoint = { id: PLAIN_BADGE_TARGET.id, label: PLAIN_BADGE_TARGET.label }
  let inputQueue: FieldInput[] = []
  let queuedMapId: number | undefined
  let expectedPosition: string | undefined
  const wonTrainerBattleIds = new Set<number>()

  const invalidateOwnPlan = (): void => {
    inputQueue = []
    queuedMapId = undefined
    expectedPosition = undefined
  }
  const invalidatePlan = (): void => {
    invalidateOwnPlan()
    plainAgent.invalidatePlan()
  }
  const move = (
    position: JohtoJourneyPosition,
    _state: FieldScriptState,
    checkpointId: string,
    label: string,
    plan: () => FieldInput[],
  ): FieldInput | undefined => {
    checkpoint = { id: checkpointId, label }
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
  const interact = (
    position: JohtoJourneyPosition,
    state: FieldScriptState,
    object: MapEventPreview['objects'][number],
    checkpointId: string,
    label: string,
  ): FieldInput | undefined => move(position, state, checkpointId, label, () => (
    findInputsToNpc(maps, position, object.id, state)
  ))

  return Object.freeze({
    nextInput(position, state) {
      if (!state.badges.has(PLAIN_BADGE_TARGET.badgeIndex)) {
        checkpoint = plainAgent.getCheckpoint()
        return plainAgent.nextInput(position, state)
      }
      if (followingPlain) {
        followingPlain = false
        invalidateOwnPlan()
      }
      if (isFogBadgeJourneyReached(state, wonTrainerBattleIds, position.mapId)) {
        checkpoint = { id: 'fog-badge-complete', label: 'Badge Brume obtenu' }
        return undefined
      }
      if (state.badges.has(FOG_BADGE_TARGET.badgeIndex)) {
        throw new Error(`Le Badge Brume a été attribué hors de l'Arène ROM ${FOG_BADGE_TARGET.ecruteakGymMapId}.`)
      }

      switch (position.mapId) {
        case FOG_BADGE_TARGET.goldenrodGymMapId:
          return move(position, state, 'leave-goldenrod-gym', "Quitter l'Arène de Doublonville", () => (
            findInputsToWarp(maps, position, FOG_BADGE_TARGET.goldenrodCityMapId, state)
          ))
        case FOG_BADGE_TARGET.goldenrodCityMapId:
          return (state.inventory.get(FOG_BADGE_TARGET.squirtBottleItemId) ?? 0) > 0
            ? move(position, state, 'reach-route-35-gate', 'Rejoindre le poste de la Route 35', () => (
                findInputsToWarp(maps, position, FOG_BADGE_TARGET.route35GateMapId, state)
              ))
            : move(position, state, 'enter-flower-shop', 'Entrer chez la fleuriste', () => (
                findInputsToWarp(maps, position, FOG_BADGE_TARGET.flowerShopMapId, state)
              ))
        case FOG_BADGE_TARGET.flowerShopMapId: {
          const florist = requireObject(
            maps,
            position.mapId,
            (object) => object.id === FOG_BADGE_TARGET.florist.objectId
              && object.scriptId === FOG_BADGE_TARGET.florist.scriptId,
            'Fleuriste',
          )
          return (state.inventory.get(FOG_BADGE_TARGET.squirtBottleItemId) ?? 0) > 0
            ? move(position, state, 'leave-flower-shop', 'Quitter la boutique avec le Carapuce à O', () => (
                findInputsToWarp(maps, position, FOG_BADGE_TARGET.goldenrodCityMapId, state)
              ))
            : interact(position, state, florist, 'receive-squirtbottle', 'Recevoir le Carapuce à O')
        }
        case FOG_BADGE_TARGET.route35GateMapId:
          return move(position, state, 'reach-route-35', 'Traverser le poste de la Route 35', () => (
            findInputsToWarp(maps, position, FOG_BADGE_TARGET.route35MapId, state)
          ))
        case FOG_BADGE_TARGET.route35MapId:
          return move(position, state, 'reach-route-36', 'Rejoindre la Route 36', () => (
            findInputsToAdjacentMap(maps, position, FOG_BADGE_TARGET.route36MapId, state)
          ))
        case FOG_BADGE_TARGET.route36MapId: {
          if (!state.flags.has(FOG_BADGE_TARGET.sudowoodoFlagId)) {
            const sudowoodo = requireObject(
              maps,
              position.mapId,
              (object) => object.id === FOG_BADGE_TARGET.sudowoodo.objectId
                && object.scriptId === FOG_BADGE_TARGET.sudowoodo.scriptId
                && object.spriteId === FOG_BADGE_TARGET.sudowoodo.spriteId,
              'Simularbre',
            )
            return interact(position, state, sudowoodo, 'clear-sudowoodo', 'Arroser et vaincre Simularbre')
          }
          return move(position, state, 'reach-route-37', 'Rejoindre la Route 37', () => (
            findInputsToAdjacentMap(maps, position, FOG_BADGE_TARGET.route37MapId, state)
          ))
        }
        case FOG_BADGE_TARGET.route37MapId:
          return move(position, state, 'reach-ecruteak', 'Atteindre Rosalia', () => (
            findInputsToAdjacentMap(maps, position, FOG_BADGE_TARGET.ecruteakCityMapId, state)
          ))
        case FOG_BADGE_TARGET.ecruteakCityMapId:
          return move(position, state, hasReleasedLegendaryBeasts(state) ? 'enter-ecruteak-gym' : 'enter-burned-tower', hasReleasedLegendaryBeasts(state) ? "Entrer dans l'Arène de Rosalia" : 'Entrer dans la Tour Cendrée', () => (
            findInputsToWarp(
              maps,
              position,
              hasReleasedLegendaryBeasts(state) ? FOG_BADGE_TARGET.ecruteakGymMapId : FOG_BADGE_TARGET.burnedTowerMapId,
              state,
            )
          ))
        case FOG_BADGE_TARGET.burnedTowerMapId: {
          if (hasReleasedLegendaryBeasts(state)) {
            return move(position, state, 'leave-burned-tower', 'Retourner à Rosalia', () => (
              findInputsToWarp(maps, position, FOG_BADGE_TARGET.ecruteakCityMapId, state)
            ))
          }
          if (state.variables.get(FOG_BADGE_TARGET.eusineSceneVariableId) !== 1) {
            return move(position, state, 'meet-eusine', 'Rencontrer Eusine dans la Tour Cendrée', () => (
              findInputsToTile(maps, position, { tileX: 19, tileZ: 23 }, state)
            ))
          }
          if (!state.flags.has(FOG_BADGE_TARGET.towerRivalFlagId)) {
            const rival = requireObject(
              maps,
              position.mapId,
              (object) => object.id === FOG_BADGE_TARGET.towerRival.objectId
                && object.spriteId === FOG_BADGE_TARGET.towerRival.spriteId,
              'Rival',
            )
            return interact(position, state, rival, 'defeat-burned-tower-rival', 'Vaincre le rival dans la Tour Cendrée')
          }
          return move(position, state, 'reach-legendary-beasts', 'Descendre auprès des fauves légendaires', () => (
            findInputsToWarp(maps, position, FOG_BADGE_TARGET.burnedTowerBasementMapId, state)
          ))
        }
        case FOG_BADGE_TARGET.burnedTowerBasementMapId:
          return hasReleasedLegendaryBeasts(state)
            ? move(position, state, 'leave-burned-tower-basement', 'Remonter après le départ des fauves légendaires', () => (
                findInputsToWarp(maps, position, FOG_BADGE_TARGET.burnedTowerMapId, state)
              ))
            : move(position, state, 'release-legendary-beasts', 'Libérer Raikou, Entei et Suicune', () => (
                findInputsToTile(maps, position, { tileX: 20, tileZ: 16 }, state)
              ))
        case FOG_BADGE_TARGET.ecruteakGymMapId: {
          const morty = requireObject(
            maps,
            position.mapId,
            (object) => object.id === FOG_BADGE_TARGET.leader.objectId
              && object.spriteId === FOG_BADGE_TARGET.leader.spriteId
              && object.scriptId === FOG_BADGE_TARGET.leader.scriptId,
            'Mortimer',
          )
          checkpoint = { id: FOG_BADGE_TARGET.id, label: FOG_BADGE_TARGET.label }
          return move(position, state, checkpoint.id, checkpoint.label, () => (
            position.tileX === morty.x && position.tileZ === morty.z + 1
              ? ['up', 'confirm']
              : findInputsToTile(
                  maps,
                  position,
                  { tileX: morty.x, tileZ: morty.z + 1 },
                  state,
                  { avoidCoordinateScriptIds: new Set([FOG_BADGE_TARGET.wrongFloorScriptId]) },
                )
          ))
        }
        default:
          throw new Error(`Le parcours vers le Badge Brume ne sait pas reprendre depuis la carte ROM ${position.mapId}.`)
      }
    },
    getCheckpoint: () => checkpoint,
    getChoiceIndex(state) {
      return followingPlain ? plainAgent.getChoiceIndex(state) : 0
    },
    invalidatePlan,
    notifyTrainerBattleWon(trainerId) {
      wonTrainerBattleIds.add(trainerId)
      plainAgent.notifyTrainerBattleWon(trainerId)
      invalidateOwnPlan()
    },
  })
}
