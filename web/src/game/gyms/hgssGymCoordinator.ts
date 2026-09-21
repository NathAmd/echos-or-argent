import type { MapRuntime } from '../../mapRuntime'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { FieldScriptState, FieldScriptStep } from '../scripts/fieldScriptRunner'
import { createFieldMovementAction } from '../scripts/fieldMovement'
import type { WorldMoveResult, WorldSession } from '../world/worldSession'
import { hgssVBlanksToMilliseconds } from '../world/hgssWorldAnimationClock'
import { createBlackthornGymCoordinator, resolveBlackthornGymCollision } from './blackthornGymCoordinator'
import { findFuchsiaGymWall } from './fuchsiaGymMechanism'
import { resolveHgssGymPropPresentations, type HgssGymPropAnimationBinding } from './hgssGymPropAnimations'
import { getViridianGymTileAnimationIndex } from './viridianGymMechanism'
import { getVioletGymElevatorHeight, isVioletGymElevatorTile, resolveVioletGymHeight, violetGymElevator } from './violetGymMechanism'
import { ecruteakGymCandleObjectIds, ecruteakGymPresentation } from './ecruteakGymMechanism'

type GymStep = Extract<FieldScriptStep, { kind: 'gymMechanism' }>
type PresentationWaiter = (task: Promise<void>, fallbackMessage: string) => void
const cianwoodBindings = [{ targetModelId: 173, animationModelId: 174 }, { targetModelId: 175, animationModelId: 175 }] as const

function resolvePresentations(map: OpeningMapPreview, bindings: readonly HgssGymPropAnimationBinding[], enabled: boolean, inventory: RomInventory | undefined) {
  return resolveHgssGymPropPresentations(map, bindings, enabled, inventory?.mapPropModelResolver, inventory?.mapPropAnimationResolver, inventory?.mapPropAnimationMetadataResolver)
}

function waitFrames(frames: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, hgssVBlanksToMilliseconds(Math.max(1, frames))))
}

function translateCamera(runtime: MapRuntime, from: { x: number, z: number }, to: { x: number, z: number } | undefined, frames: number): Promise<void> {
  const startedAt = performance.now()
  return new Promise((resolve) => {
    const update = (now: number): void => {
      const progress = Math.min(1, Math.max(0, (now - startedAt) / hgssVBlanksToMilliseconds(frames)))
      const eased = progress * progress * (3 - 2 * progress)
      if (to) runtime.setCameraTarget(from.x + (to.x - from.x) * eased, from.z + (to.z - from.z) * eased)
      else if (progress < 1) runtime.setCameraTarget(from.x, from.z)
      else runtime.setCameraTarget()
      if (progress < 1) requestAnimationFrame(update)
      else resolve()
    }
    requestAnimationFrame(update)
  })
}

export function createHgssGymCoordinator(runtime: MapRuntime, onSettled: (error?: Error) => void, waitForPresentation: PresentationWaiter, playSound: (sequenceId: number) => void = () => undefined, stopSound: (sequenceId: number) => void = () => undefined) {
  const blackthorn = createBlackthornGymCoordinator(runtime, onSettled)

  const sync = (map: OpeningMapPreview | undefined, state: FieldScriptState, inventory: RomInventory | undefined): void => {
    blackthorn.sync(map, state, inventory?.mapPropModelResolver)
    if (!map) return
    try {
      if (map.id === 139 && state.gymmick.type === 2) void runtime.presentGymProps(resolvePresentations(map, cianwoodBindings, new DataView(state.gymmick.data.buffer).getUint32(0, true) !== 0, inventory), false)
      if (map.id === 365 && state.gymmick.type === 3) for (let gate = 0; gate < 2; gate += 1) void runtime.presentGymProps(resolvePresentations(map, [{ targetModelId: 199 + gate, animationModelId: 199 + gate }], state.gymmick.data[2 + gate] === 0, inventory), false)
      if (map.id === 135 && state.gymmick.type === 4) runtime.syncVioletGymElevator(state.gymmick.data, inventory?.mapPropModelResolver)
      if (map.id === 80 && state.gymmick.type === 1) runtime.syncEcruteakGymCandles(state.gymmick.data, ecruteakGymCandleObjectIds.map((objectId) => { const actor = state.objects.get(objectId); if (!actor) throw new Error(`Le Dresseur ROM ${objectId} de Rosalia est absent.`); return { objectId, tileX: actor.x, tileZ: actor.z } }), inventory?.mapPropModelResolver)
    } catch (error) { onSettled(error instanceof Error ? error : new Error('Décor d’arène ROM indisponible.')) }
  }

  const handleStep = (step: GymStep, state: FieldScriptState, world: WorldSession | undefined, inventory: RomInventory | undefined): boolean => {
    if (blackthorn.handleStep(step, state, world, inventory?.mapPropModelResolver)) return true
    const current = world?.getState()
    if ((step.gymType === 1 || step.gymType === 2 || step.gymType === 3 || step.gymType === 4) && step.action === 'init') { sync(current?.map, state, inventory); return true }
    if (!current || !world) return false
    if (step.gymType === 2 && step.action === 'turnWinch') {
      const origin = { x: current.tileX, z: current.tileZ }
      const task = translateCamera(runtime, origin, { x: 50, z: 58 }, 24)
        .then(() => runtime.presentGymProps(resolvePresentations(current.map, cianwoodBindings, true, inventory), true))
        .then(() => translateCamera(runtime, { x: 50, z: 58 }, origin, 24))
        .then(() => runtime.setCameraTarget())
      waitForPresentation(task, 'La séquence ROM du treuil d’Irisia a été interrompue.')
      return true
    }
    if (step.gymType === 3 && (step.action === 'openGate' || step.action === 'closeGate') && step.parameter !== undefined) {
      const modelId = 199 + step.parameter
      const objectIds = step.parameter === 0 ? [3, 4, 5] : [0, 1, 2]
      const movementIds = step.action === 'openGate' ? [22, 22, 23] : [23, 23, 22]
      const runStopperCycle = () => Promise.all(objectIds.map((objectId, index) => runtime.applyMovement(objectId, [createFieldMovementAction(movementIds[index]!)])))
      const task = runStopperCycle().then(runStopperCycle).then(() => runtime.presentGymProps(resolvePresentations(current.map, [{ targetModelId: modelId, animationModelId: modelId }], step.action === 'closeGate', inventory), false)).then(() => { playSound(1571) })
      waitForPresentation(task, 'La séquence ROM des barrières de Carmin-sur-Mer a été interrompue.')
      return true
    }
    if (step.gymType === 4 && (step.action === 'raiseElevator' || step.action === 'lowerElevator')) {
      const targetY = getVioletGymElevatorHeight(state.gymmick.data)
      world.setObjectState(255)
      const player = world.getState()!
      const follower = world.getFollowerState()
      if (isVioletGymElevatorTile(player.tileX, player.tileZ)) runtime.setPlayerPosition(player.tileX, player.tileZ, player.direction, true, targetY, 29)
      if (follower && isVioletGymElevatorTile(follower.tileX, follower.tileZ)) { world.setObjectState(0xfd); runtime.setFollowerPosition(world.getFollowerState(), true, 29) }
      playSound(1552)
      const task = runtime.playVioletGymElevator(targetY, 29).finally(() => { stopSound(1552); playSound(1561) })
      waitForPresentation(task, 'La séquence ROM de l’ascenseur de Mauville a été interrompue.')
      return true
    }
    if (step.gymType === 1 && step.action === 'trackCandle') { runtime.trackEcruteakGymCandle(step.parameter); return true }
    if (step.gymType === 1 && step.action === 'stopCandleTracking') { runtime.trackEcruteakGymCandle(); return true }
    if (step.gymType === 1 && step.action === 'extinguishCandle' && step.parameter !== undefined) {
      const task = waitFrames(ecruteakGymPresentation.extinguishDelayFrames).then(() => { playSound(2308); return runtime.extinguishEcruteakGymCandle(step.parameter!) }).then(() => { runtime.setActorSpriteResource(step.parameter!, ecruteakGymPresentation.transformedTrainerSpriteId) })
      waitForPresentation(task, 'La séquence ROM de la chandelle de Rosalia a été interrompue.')
      return true
    }
    if (step.gymType === 1 && step.action === 'ignored') return true
    return false
  }

  const handleBlockedMovement = (result: Extract<WorldMoveResult, { kind: 'blocked' }>, state: FieldScriptState, world: WorldSession | undefined, inventory: RomInventory | undefined): boolean => {
    const current = world?.getState()
    if (!current || current.map.id !== 480 || state.gymmick.type !== 7 || (result.reason !== 'terrain' && result.reason !== 'bounds')) return false
    const wall = findFuchsiaGymWall(result.tileX, result.tileZ)
    if (!wall) { playSound(1536); return true }
    const animation = runtime.playFuchsiaGymWall(wall, current.groundHeight ?? 0, inventory?.gymOverlayModelResolver, inventory?.gymOverlayAnimationResolver)
    if (animation) { playSound(2307); void animation.catch((error: unknown) => onSettled(error instanceof Error ? error : new Error('Animation du mur de Parmanie interrompue.'))) }
    return true
  }

  const handleMovedMovement = (result: WorldMoveResult, state: FieldScriptState, world: WorldSession | undefined, inventory: RomInventory | undefined): void => {
    if (result.kind !== 'moved' || result.state.map.id !== 496 || state.gymmick.type !== 8 || !world) return
    const behavior = world.getTerrainAttributeAt(result.state.tileX, result.state.tileZ) ?? -1
    if (getViridianGymTileAnimationIndex(behavior) === undefined) return
    const animation = runtime.playViridianGymTile(behavior, result.state.tileX, result.state.tileZ, result.state.groundHeight ?? 0, inventory?.gymOverlayModelResolver, inventory?.gymOverlayAnimationResolver)
    if (animation) void animation.catch((error: unknown) => onSettled(error instanceof Error ? error : new Error('Animation des flèches de Jadielle interrompue.')))
  }

  return { sync, handleStep, handleBlockedMovement, handleMovedMovement, tryInteract: blackthorn.tryInteract }
}

export { resolveBlackthornGymCollision }
export { resolveVioletGymHeight, violetGymElevator }
