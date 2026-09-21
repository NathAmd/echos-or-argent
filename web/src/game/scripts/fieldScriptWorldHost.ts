import type { RomInventory } from '../../ndsTypes'
import type { MapRuntime } from '../../mapRuntime'
import { getMapOrigin } from '../world/mapCoordinates'
import { hgssFollowerObjectId, type WorldSession } from '../world/worldSession'
import type { FieldScriptExecutionState } from './fieldScriptExecutionState'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptRunner, FieldScriptState, FieldScriptStep } from './fieldScriptRunner'

type FieldScriptWorldStep = Extract<FieldScriptStep, {
  kind:
    | 'daycareObjects'
    | 'movement'
    | 'objectState'
    | 'cameraTarget'
    | 'facePlayer'
    | 'objectVisibility'
    | 'followerMovement'
    | 'mapProps'
    | 'waiting'
}>

export type FieldScriptWorldHostPorts = Readonly<{
  execution: FieldScriptExecutionState<FieldScriptRunner>
  runtime: MapRuntime
  readWorldSession: () => WorldSession | undefined
  readFieldState: () => FieldScriptState
  readInventory: () => RomInventory | undefined
  dismissAcknowledgedMessage: () => void
  waitForPresentation: (waitKind: 'movement', task: Promise<unknown>, fallbackMessage: string) => void
}>

export type FieldScriptWorldHost = FieldScriptStepHandler & Readonly<{
  reset: () => void
}>

function isFieldScriptWorldStep(step: FieldScriptStep): step is FieldScriptWorldStep {
  return step.kind === 'daycareObjects'
    || step.kind === 'movement'
    || step.kind === 'objectState'
    || step.kind === 'cameraTarget'
    || step.kind === 'facePlayer'
    || step.kind === 'objectVisibility'
    || step.kind === 'followerMovement'
    || step.kind === 'mapProps'
    || step.kind === 'waiting'
}

export function createFieldScriptWorldHost(ports: FieldScriptWorldHostPorts): FieldScriptWorldHost {
  const handleWorldStep = (step: FieldScriptWorldStep): FieldScriptStepDisposition => {
    const world = ports.readWorldSession()
    if (step.kind === 'daycareObjects') {
      const inventory = ports.readInventory()
      if (!inventory?.followerTextureResolver) throw new Error('Les textures ROM des pensionnaires sont indisponibles.')
      world?.syncDaycareObjects(step.objects.map(({ objectId, x, z }) => ({ objectId, x, z })))
      ports.runtime.syncDaycareObjects(step.objects.map(({ objectId, x, z, pokemon }) => {
        const parameterIndex = inventory.pokemonCatalog.followers.modelIndexBySpecies[pokemon.speciesId]
        if (parameterIndex === undefined) throw new Error(`Le modèle follower ROM du pensionnaire ${pokemon.speciesId} est absent.`)
        const resource = inventory.followerTextureResolver!(parameterIndex, pokemon.shiny)
        if (!resource) throw new Error(`La texture follower ROM ${parameterIndex} du pensionnaire est absente.`)
        return { objectId, tileX: x, tileZ: z, resource }
      }))
      return 'continue'
    }

    if (step.kind === 'movement') {
      const state = ports.readFieldState()
      if (step.objectId !== 255 && step.objectId !== hgssFollowerObjectId) {
        ports.runtime.syncEventVisibility(state)
      }
      ports.execution.addMovementTask(ports.runtime.applyMovement(step.objectId, step.actions))
      const movementResult = world?.applyObjectMovement(step.objectId, step.actions, !state.followMonMovementPaused)
      if (step.objectId === 255 && movementResult && !state.followMonMovementPaused
        && movementResult.followerActions.length > 0) {
        ports.execution.addMovementTask(ports.runtime.applyMovement(hgssFollowerObjectId, movementResult.followerActions))
      }
      return 'continue'
    }

    if (step.kind === 'objectState') {
      const state = ports.readFieldState()
      const activeMap = world?.getState()?.map
      world?.setObjectState(step.objectId, step.x, step.z, step.direction)
      if (!activeMap) return 'continue'
      const origin = getMapOrigin(activeMap)
      if (step.objectId === 255) {
        if (step.x !== undefined && step.z !== undefined) {
          ports.runtime.setPlayerPosition(
            step.x - origin.x,
            step.z - origin.z,
            step.direction,
            false,
            world?.getState()?.groundHeight,
          )
        } else if (step.direction !== undefined) {
          ports.runtime.setPlayerDirection(step.direction)
        }
      } else if (step.x !== undefined && step.z !== undefined) {
        ports.runtime.syncEventVisibility(state)
        ports.runtime.setActorPosition(step.objectId, step.x - origin.x, step.z - origin.z, step.direction)
      } else if (step.direction !== undefined) {
        ports.runtime.syncEventVisibility(state)
        ports.runtime.setActorDirection(step.objectId, step.direction)
      }
      return 'continue'
    }

    if (step.kind === 'cameraTarget') {
      if (step.target === 'player') ports.runtime.setCameraTarget()
      else {
        const activeMap = world?.getState()?.map
        if (activeMap) {
          const origin = getMapOrigin(activeMap)
          ports.runtime.setCameraTarget(step.x - origin.x, step.z - origin.z)
        }
      }
      return 'continue'
    }

    if (step.kind === 'waiting') {
      if (step.waitFor === 'followerMovement') {
        if (!ports.runtime.isFollowerMoving()) return 'continue'
        ports.execution.beginWait('followerMovement')
        ports.dismissAcknowledgedMessage()
        return 'suspend'
      }
      if (step.waitFor !== 'movement') return 'unhandled'
      if (!ports.execution.hasMovementTasks()) {
        if (!ports.runtime.isScriptMoving()) return 'continue'
        ports.execution.beginWait('movement')
        ports.dismissAcknowledgedMessage()
        return 'suspend'
      }
      const tasks = ports.execution.drainMovementTasks()
      ports.waitForPresentation(
        'movement',
        Promise.all(tasks).then(() => undefined),
        'Le mouvement scripté ROM ne peut pas être terminé.',
      )
      return 'suspend'
    }

    if (step.kind === 'facePlayer') {
      if (step.objectId !== undefined) {
        const direction = world?.faceObjectAtPlayer(step.objectId)
        if (direction) ports.runtime.setActorDirection(step.objectId, direction)
      }
      return 'continue'
    }

    if (step.kind === 'objectVisibility') {
      ports.runtime.syncEventVisibility(ports.readFieldState())
      ports.runtime.setActorVisibility(step.objectId, step.visible)
      return 'continue'
    }

    if (step.kind === 'followerMovement') {
      if (step.action === 'pause') {
        ports.runtime.setFollowerMovementPaused(step.paused)
        return 'continue'
      }
      if (step.action === 'configure') {
        const follower = world?.configureFollower(...step.parameters)
        if (!follower) throw new Error('Le follower ROM actif ne peut pas être configure sur cette carte.')
        ports.runtime.setFollowerPosition(follower)
        return 'continue'
      }
      if (step.action === 'facePlayer') {
        const follower = world?.faceFollowerAtPlayer()
        if (!follower) throw new Error('Le follower ROM actif ne peut pas faire face au joueur.')
        ports.runtime.setFollowerPosition(follower)
        return 'continue'
      }
      if (step.action === 'movement') {
        const result = world?.applyFollowerScriptMovement(step.movement)
        if (!result) throw new Error(`Le mouvement follower ROM ${step.movement} ne peut pas être applique.`)
        ports.runtime.applyFollowerMovement(result.state, result.movement)
        return 'continue'
      }
      ports.runtime.refreshFollower()
      return 'continue'
    }

    ports.runtime.syncMapProps(
      step.props,
      ports.readInventory()?.mapPropModelResolver,
      ports.readInventory()?.mapPropAnimationResolver,
      ports.readInventory()?.mapPropAnimationMetadataResolver,
    )
    return 'continue'
  }

  return Object.freeze({
    handle: (step: FieldScriptStep): FieldScriptStepDisposition => (
      isFieldScriptWorldStep(step) ? handleWorldStep(step) : 'unhandled'
    ),
    reset: ports.execution.clearMovementTasks,
  })
}
