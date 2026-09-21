import type { MapRuntime } from '../../mapRuntime'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { getMapOrigin } from '../world/mapCoordinates'
import { hgssFollowerObjectId, type WorldSession } from '../world/worldSession'
import type { FieldScriptState, FieldScriptStep } from '../scripts/fieldScriptRunner'
import { applyBlackthornGymAction, blackthornMagmaMetatileBehavior, getBlackthornGymActionAt, transformBlackthornGymPassenger } from './blackthornGymMechanism'

type GymMechanismStep = Extract<FieldScriptStep, { kind: 'gymMechanism' }>

export type BlackthornGymCoordinator = {
  sync: (map: OpeningMapPreview | undefined, state: FieldScriptState, resolver: RomInventory['mapPropModelResolver']) => void
  handleStep: (step: GymMechanismStep, state: FieldScriptState, world: WorldSession | undefined, resolver: RomInventory['mapPropModelResolver']) => boolean
  tryInteract: (state: FieldScriptState, world: WorldSession | undefined) => boolean
}

export function createBlackthornGymCoordinator(
  runtime: MapRuntime,
  onSettled: (error?: Error) => void = () => undefined,
): BlackthornGymCoordinator {
  let busy = false

  const sync = (map: OpeningMapPreview | undefined, state: FieldScriptState, resolver: RomInventory['mapPropModelResolver']): void => {
    if (map?.id === 141 && state.gymmick.type === 6) runtime.syncBlackthornGymMechanism(state.gymmick.data, resolver)
  }

  const handleStep = (step: GymMechanismStep, state: FieldScriptState, world: WorldSession | undefined, resolver: RomInventory['mapPropModelResolver']): boolean => {
    if (step.gymType !== 6 || step.action !== 'init') return false
    sync(world?.getState()?.map, state, resolver)
    return true
  }

  const tryInteract = (state: FieldScriptState, world: WorldSession | undefined): boolean => {
    const current = world?.getState()
    if (busy || !world || !current || current.map.id !== 141 || state.gymmick.type !== 6) return false
    const action = getBlackthornGymActionAt(state.gymmick.data, current.tileX, current.tileZ)
    if (!action) return false
    const follower = world.getFollowerState()
    const result = applyBlackthornGymAction(state.gymmick.data, action, (x, z) => (
      (world.getTerrainAttributeAt(x, z) ?? -1) % 256 === blackthornMagmaMetatileBehavior
      && !world.findEventAt(x, z)
      && (!follower || follower.tileX !== x || follower.tileZ !== z)
    ))
    const origin = getMapOrigin(current.map)
    const carriedFollower = follower && transformBlackthornGymPassenger(result, { x: follower.tileX, z: follower.tileZ })
    world.setObjectState(255, origin.x + result.playerX, origin.z + result.playerZ, current.direction)
    runtime.setPlayerPosition(result.playerX, result.playerZ, current.direction, true, current.groundHeight, result.durationFrames, 'forced-slide')
    if (carriedFollower) {
      world.setObjectState(hgssFollowerObjectId, origin.x + carriedFollower.x, origin.z + carriedFollower.z, follower.direction)
      runtime.setFollowerPosition(world.getFollowerState(), true, result.durationFrames)
    }
    busy = true
    void runtime.playBlackthornGymAction(result).then(
      () => onSettled(),
      (reason: unknown) => onSettled(reason instanceof Error ? reason : new Error('Animation Ébènelle interrompue.')),
    ).finally(() => { busy = false })
    return true
  }

  return { sync, handleStep, tryInteract }
}

export { resolveBlackthornGymCollision } from './blackthornGymMechanism'
