import type { MapActorRuntime } from '../../mapRuntimeTypes'
import type { PlayerDirection } from '../../ndsTypes'
import type { HgssLcrng } from '../pokemon/hgssPokemonRng'
import type { FieldMovementAction } from '../scripts/fieldMovement'
import type { FieldScriptActorState } from '../scripts/fieldScriptRunner'
import { createHgssAmbientObjectMovementController } from './hgssAmbientObjectMovement'
import { getMapOrigin } from './mapCoordinates'
import type { WorldMoveResult, WorldSession } from './worldSession'

const walkingActionByDirection: Readonly<Record<PlayerDirection, number>> = {
  north: 12,
  south: 13,
  west: 14,
  east: 15,
}

const walkingInPlaceActionByDirection: Readonly<Record<PlayerDirection, number>> = {
  north: 32,
  south: 33,
  west: 34,
  east: 35,
}

const facingActionByDirection: Readonly<Record<PlayerDirection, number>> = {
  north: 0,
  south: 1,
  west: 2,
  east: 3,
}

export type BrowserFieldObjectMotionState = {
  objects: Map<number, FieldScriptActorState>
  flags: ReadonlySet<number>
  hiddenObjectIds: ReadonlySet<number>
}

export type BrowserFieldObjectMotionWorldPort = Pick<
  WorldSession,
  'getState' | 'setObjectState' | 'tryMoveObject'
>

export type BrowserFieldObjectMotionMapRuntime<TState extends BrowserFieldObjectMotionState> = Readonly<{
  applyMovement: MapActorRuntime['applyMovement']
  isActorMoving: MapActorRuntime['isActorMoving']
  setActorDirection: MapActorRuntime['setActorDirection']
  syncEventVisibility: (state: TState) => void
}>

export type BrowserFieldObjectMotionRuntimePorts<TState extends BrowserFieldObjectMotionState> = Readonly<{
  readState: () => TState
  readWorldSession: () => BrowserFieldObjectMotionWorldPort | undefined
  readRng: () => HgssLcrng | undefined
  readVBlankFrame: () => number
  isFieldScriptActive: () => boolean
  runtime: BrowserFieldObjectMotionMapRuntime<TState>
}>

export type BrowserFieldObjectMotionRuntime = Readonly<{
  applyMoveResult: (result: WorldMoveResult) => void
  tick: () => void
  reset: () => void
  invalidate: () => void
  isInputBlocked: () => boolean
}>

function createPushedObjectActions(
  movement: NonNullable<WorldMoveResult['objectMovements']>[number],
): FieldMovementAction[] {
  const actions: FieldMovementAction[] = movement.distance > 0
    ? [{
        action: walkingActionByDirection[movement.direction],
        repetitions: movement.distance,
        direction: movement.direction,
        tileDistance: 0,
        kind: 'walk',
      }]
    : []
  actions.push(movement.kind === 'strength-fall'
    ? { action: 69, repetitions: 1, tileDistance: 0, kind: 'effect' }
    : {
        action: facingActionByDirection[movement.finalDirection],
        repetitions: 1,
        direction: movement.finalDirection,
        tileDistance: 0,
        kind: 'face',
      })
  return actions
}

export function createBrowserFieldObjectMotionRuntime<TState extends BrowserFieldObjectMotionState>(
  ports: BrowserFieldObjectMotionRuntimePorts<TState>,
): BrowserFieldObjectMotionRuntime {
  const ambient = createHgssAmbientObjectMovementController()
  let pushedMovementInProgress = false
  let pushedMovementToken = 0

  const applyMoveResult = (result: WorldMoveResult): void => {
    const movements = result.objectMovements ?? []
    if (movements.length === 0) return
    const state = ports.readState()
    const tasks = movements.map((movement) => {
      const actor = state.objects.get(movement.objectId)
      if (actor) {
        actor.x = movement.worldX
        actor.z = movement.worldZ
        actor.direction = movement.finalDirection
      }
      return ports.runtime.applyMovement(movement.objectId, createPushedObjectActions(movement))
    })
    const token = ++pushedMovementToken
    pushedMovementInProgress = true
    const finish = (): void => {
      if (pushedMovementToken === token) pushedMovementInProgress = false
      ports.runtime.syncEventVisibility(ports.readState())
    }
    void Promise.all(tasks).then(finish, finish)
  }

  const tick = (): void => {
    const session = ports.readWorldSession()
    const world = session?.getState()
    const rng = ports.readRng()
    if (!session || !world || !rng) return
    const state = ports.readState()
    const origin = getMapOrigin(world.map)
    const templates = new Map((world.map.events?.objects ?? []).map((object) => [object.id, object]))
    ambient.update(ports.readVBlankFrame(), rng, {
      getObjectState: (objectId) => {
        const actor = state.objects.get(objectId)
        const movement = actor?.movement ?? templates.get(objectId)?.movement
        return actor && movement !== undefined ? { ...actor, movement } : undefined
      },
      getPlayerState: () => ({ x: origin.x + world.tileX, z: origin.z + world.tileZ }),
      isObjectActive: (object) => (object.eventFlag === 0 || !state.flags.has(object.eventFlag))
        && !state.hiddenObjectIds.has(object.id),
      isObjectBusy: (objectId) => ports.runtime.isActorMoving(objectId),
      faceObject: (objectId, direction) => {
        const actor = state.objects.get(objectId)
        if (!actor) return
        actor.direction = direction
        session.setObjectState(objectId, undefined, undefined, direction)
        ports.runtime.setActorDirection(objectId, direction)
      },
      tryMoveObject: (objectId, direction) => {
        const actor = state.objects.get(objectId)
        const moved = session.tryMoveObject(objectId, direction)
        if (!actor || !moved) return false
        actor.x = origin.x + moved.tileX
        actor.z = origin.z + moved.tileZ
        actor.direction = direction
        return true
      },
      startMotion: ({ objectId, direction, kind }, onComplete) => {
        const action = kind === 'walk'
          ? walkingActionByDirection[direction]
          : walkingInPlaceActionByDirection[direction]
        void ports.runtime.applyMovement(objectId, [{
          action,
          repetitions: 1,
          direction,
          tileDistance: 0,
          kind,
        }]).then(onComplete, onComplete)
      },
    }, ports.isFieldScriptActive())
  }

  const reset = (): void => {
    ambient.clear()
    const world = ports.readWorldSession()?.getState()
    const rng = ports.readRng()
    if (!world || !rng) return
    const state = ports.readState()
    ambient.reset(
      world.map.events?.objects ?? [],
      ports.readVBlankFrame(),
      rng,
      (object) => (object.eventFlag === 0 || !state.flags.has(object.eventFlag))
        && !state.hiddenObjectIds.has(object.id),
    )
  }

  const invalidate = (): void => {
    pushedMovementInProgress = false
    pushedMovementToken += 1
    ambient.clear()
  }

  return {
    applyMoveResult,
    tick,
    reset,
    invalidate,
    isInputBlocked: () => pushedMovementInProgress,
  }
}
