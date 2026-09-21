import type { MapRuntime } from '../../mapRuntime'
import type { RomInventory } from '../../ndsTypes'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { playRomPresentationWithSoundEffect, startRomSoundEffect } from '../../audio/romAudioPresentation'
import { resolveDoorSoundSequence, type DoorTransitionDescriptor } from '../../rom/maps/doorTransition'
import { getMapOrigin } from '../world/mapCoordinates'
import { hgssFollowerObjectId, type WorldSession } from '../world/worldSession'
import { resolveHgssFieldMoveEffectProfile } from '../world/hgssFieldMoveEffect'
import type { FieldScriptWaitKind } from '../ui/fieldDialogWait'
import type { FieldScriptStepDisposition, FieldScriptStepHandler } from './fieldScriptHost'
import type { FieldScriptState, FieldScriptStep } from './fieldScriptRunner'

type FieldScriptEffectsStep = Extract<FieldScriptStep, {
  kind:
    | 'screenFade'
    | 'screenShake'
    | 'specialCutscene'
    | 'gymMechanism'
    | 'fieldOverlay'
    | 'mapEventState'
    | 'apricornTree'
    | 'fieldMoveEffect'
    | 'mapPropAnimation'
    | 'objectEffect'
    | 'doorAnimation'
}>

type GymMechanismStep = Extract<FieldScriptEffectsStep, { kind: 'gymMechanism' }>

type FieldScriptEffectsRuntime = Pick<MapRuntime,
  | 'syncAzaleaGymMechanism'
  | 'setAzaleaGymSwitchState'
  | 'playAzaleaGymSwitch'
  | 'playAzaleaGymRide'
  | 'setPlayerPosition'
  | 'playApricornTreeAnimation'
  | 'playFieldMoveEffect'
  | 'clearFieldMoveEffect'
  | 'setMapPropDeferredAnimations'
  | 'loadMapPropOneShotAnimation'
  | 'playMapPropOneShotAnimation'
  | 'waitMapPropOneShotAnimation'
  | 'unloadMapPropOneShotAnimation'
  | 'playDoorAnimation'
>

type FieldScriptEffectsAudio = Pick<RomAudioRuntime, 'playSoundEffect' | 'stopSoundEffect'>
type FieldScriptEffectsWaitKind = Extract<FieldScriptWaitKind,
  'screenShake' | 'specialCutscene' | 'gymMechanism' | 'apricornTree' | 'mapPropAnimation' | 'doorAnimation'
>

export type FieldScriptEffectsSurface = Pick<HTMLElement, 'animate'>

export type FieldScriptEffectsHostPorts = Readonly<{
  runtime: FieldScriptEffectsRuntime
  context: Readonly<{
    readState: () => FieldScriptState
    readWorld: () => WorldSession | undefined
    readInventory: () => RomInventory | undefined
    readAudio: () => FieldScriptEffectsAudio | undefined
  }>
  presentation: Readonly<{
    surfaces: readonly FieldScriptEffectsSurface[]
    framesToMilliseconds: (frames: number) => number
    applyScreenFade: (durationFrames: number, type: number, color: number) => void
    waitForPresentation: (
      waitKind: FieldScriptEffectsWaitKind,
      task: Promise<unknown>,
      fallbackMessage: string,
      options?: Readonly<{ afterResume?: () => void }>,
    ) => void
  }>
  gym: Readonly<{
    handleStep: (
      step: GymMechanismStep,
      state: FieldScriptState,
      world: WorldSession | undefined,
      inventory: RomInventory | undefined,
    ) => boolean
  }>
  field: Readonly<{
    reportStatus: (message: string) => void
    refreshMainMenu: () => void
    syncFollowerPresentation: (force: boolean, preserveAnimation?: boolean) => void
    scheduleAutosave: (delayMs: number) => void
  }>
}>

export type FieldScriptEffectsHost = FieldScriptStepHandler & Readonly<{
  reset: () => void
}>

function isFieldScriptEffectsStep(step: FieldScriptStep): step is FieldScriptEffectsStep {
  return step.kind === 'screenFade'
    || step.kind === 'screenShake'
    || step.kind === 'specialCutscene'
    || step.kind === 'gymMechanism'
    || step.kind === 'fieldOverlay'
    || step.kind === 'mapEventState'
    || step.kind === 'apricornTree'
    || step.kind === 'fieldMoveEffect'
    || step.kind === 'mapPropAnimation'
    || step.kind === 'objectEffect'
    || step.kind === 'doorAnimation'
}

function resolveSpecialCutsceneDuration(effect: Extract<FieldScriptEffectsStep, { kind: 'specialCutscene' }>['effect']): number {
  if (effect === 'hallOfFame') return 2200
  if (effect === 'sinjohStage') return 720
  if (effect === 'sinjohCircle') return 1900
  if (effect === 'sinjohEgg') return 2400
  if (effect === 'sinjohRestore') return 360
  if (effect === 'linkReturn') return 460
  return 1500
}

function resolveSpecialCutsceneKeyframes(
  step: Extract<FieldScriptEffectsStep, { kind: 'specialCutscene' }>,
): Keyframe[] {
  if (step.effect === 'hallOfFame') {
    return [
      { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
      { filter: 'brightness(1.8) saturate(1.35)', transform: 'scale(1.015)' },
      { filter: 'brightness(3.2) saturate(.2)', transform: 'scale(1.035)' },
      { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
    ]
  }
  if (step.effect === 'sinjohStage') {
    return [
      { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
      { filter: `brightness(2.2) saturate(1.7) hue-rotate(${(step.parameter ?? 0) * 70}deg)`, transform: 'scale(1.02)' },
      { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
    ]
  }
  if (step.effect === 'sinjohCircle' || step.effect === 'sinjohEgg') {
    return [
      { filter: 'brightness(1) saturate(1)', transform: 'rotate(0deg) scale(1)' },
      { filter: 'brightness(2.5) saturate(1.9) hue-rotate(110deg)', transform: 'rotate(.6deg) scale(1.04)' },
      { filter: 'brightness(.45) saturate(2.4) hue-rotate(230deg)', transform: 'rotate(-.6deg) scale(.98)' },
      { filter: 'brightness(4) saturate(0)', transform: 'rotate(0deg) scale(1.06)' },
      { filter: 'brightness(1) saturate(1)', transform: 'rotate(0deg) scale(1)' },
    ]
  }
  if (step.effect === 'linkReturn') {
    return [
      { filter: 'brightness(1)', opacity: 1 },
      { filter: 'brightness(2.2) saturate(.4)', opacity: .65 },
      { filter: 'brightness(1)', opacity: 1 },
    ]
  }
  return [
    { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
    { filter: 'brightness(2.6) saturate(1.8) hue-rotate(80deg)', transform: 'scale(1.025)' },
    { filter: 'brightness(0.65) saturate(2.2) hue-rotate(190deg)', transform: 'scale(0.985)' },
    { filter: 'brightness(3) saturate(0)', transform: 'scale(1.04)' },
    { filter: 'brightness(1) saturate(1)', transform: 'scale(1)' },
  ]
}

function animateSurfaces(
  surfaces: readonly FieldScriptEffectsSurface[],
  keyframes: Keyframe[],
  options: KeyframeAnimationOptions,
): Promise<unknown> {
  const animations = surfaces.map((surface) => surface.animate(keyframes, options))
  return Promise.all(animations.map((animation) => animation.finished))
}

export function createFieldScriptEffectsHost(ports: FieldScriptEffectsHostPorts): FieldScriptEffectsHost {
  const doorDescriptors = new Map<number, DoorTransitionDescriptor>()
  const doorAnimations = new Map<number, Promise<Error | undefined>>()
  let fieldMoveGeneration = 0

  const playSound = (sequenceId: number): void => {
    startRomSoundEffect(ports.context.readAudio(), sequenceId, () => undefined)
  }

  const handleGymMechanism = (step: GymMechanismStep): FieldScriptStepDisposition => {
    const state = ports.context.readState()
    const world = ports.context.readWorld()
    const inventory = ports.context.readInventory()
    if (ports.gym.handleStep(step, state, world, inventory)) return 'continue'

    if (step.gymType === 5 && step.action === 'init') {
      if (inventory && step.spiderNodes && step.switchState !== undefined) {
        ports.runtime.syncAzaleaGymMechanism(
          step.spiderNodes,
          step.switchState,
          inventory.mapPropModelResolver,
          inventory.mapPropAnimationResolver,
          inventory.mapPropAnimationMetadataResolver,
        )
      }
      return 'continue'
    }

    if (step.gymType === 5 && step.action === 'flipSwitch') {
      if (inventory && step.parameter !== undefined && step.switchState !== undefined) {
        playSound(1561)
        ports.presentation.waitForPresentation(
          'gymMechanism',
          ports.runtime.playAzaleaGymSwitch(
            step.parameter,
            step.switchState,
            inventory.mapPropAnimationResolver,
            inventory.mapPropAnimationMetadataResolver,
          ),
          "L'animation ROM de l'aiguillage a été interrompue.",
          { afterResume: () => ports.field.scheduleAutosave(0) },
        )
        return 'suspend'
      }
      if (inventory && step.switchState !== undefined) {
        ports.runtime.setAzaleaGymSwitchState(
          step.switchState,
          inventory.mapPropAnimationResolver,
          inventory.mapPropAnimationMetadataResolver,
        )
      }
      playSound(1561)
      ports.field.scheduleAutosave(0)
      return 'continue'
    }

    if (step.gymType === 5 && step.action === 'rideSpinarak' && step.ride && step.destination) {
      const activeMap = world?.getState()?.map
      const origin = activeMap ? getMapOrigin(activeMap) : { x: 0, z: 0 }
      world?.setObjectState(
        255,
        origin.x + step.destination.x,
        origin.z + step.destination.z,
        step.destination.direction,
      )
      if (step.followerDestination) {
        world?.setObjectState(
          hgssFollowerObjectId,
          origin.x + step.followerDestination.x,
          origin.z + step.followerDestination.z,
          step.followerDestination.direction,
        )
      }
      ports.presentation.waitForPresentation(
        'gymMechanism',
        ports.runtime.playAzaleaGymRide(step.ride, () => playSound(2171)),
        'Le trajet Spinarak ROM a été interrompu.',
        {
          afterResume: () => {
            ports.context.readAudio()?.stopSoundEffect(2171)
            ports.field.scheduleAutosave(0)
          },
        },
      )
      return 'suspend'
    }

    if (step.destination) {
      const activeMap = world?.getState()?.map
      world?.setObjectState(255, step.destination.x, step.destination.z, step.destination.direction)
      if (activeMap) {
        const origin = getMapOrigin(activeMap)
        ports.runtime.setPlayerPosition(
          step.destination.x - origin.x,
          step.destination.z - origin.z,
          step.destination.direction,
          false,
          world?.getState()?.groundHeight,
        )
      }
    }
    return 'continue'
  }

  const handleFieldOverlay = (step: Extract<FieldScriptEffectsStep, { kind: 'fieldOverlay' }>): void => {
    const state = ports.context.readState()
    if (step.action === 'hide') {
      ports.field.reportStatus(ports.context.readWorld()?.getState()?.map.label ?? '')
      return
    }
    if (step.overlay === 'saveStats') {
      ports.field.reportStatus(`${state.playerName} · ${state.badges.size} badge${state.badges.size > 1 ? 's' : ''} · ₽${state.money}`)
      return
    }
    if (step.overlay === 'floor') {
      ports.field.reportStatus(state.buffers.get(0) ?? `${step.type ?? 0}F`)
      return
    }
    const labels = ['Jetons', 'Points de Combat', 'Points Athlète']
    const values = [state.coins, state.battlePoints, state.athletePoints]
    const type = step.type ?? 0
    ports.field.reportStatus(`${labels[type] ?? `Compteur ROM ${type}`} · ${values[type] ?? 0}`)
  }

  const handleFieldMoveEffect = (
    step: Extract<FieldScriptEffectsStep, { kind: 'fieldMoveEffect' }>,
  ): FieldScriptStepDisposition => {
    const state = ports.context.readState()
    const inventory = ports.context.readInventory()
    if (!inventory?.gymOverlayModelResolver || !inventory.gymOverlayAnimationResolver) {
      throw new Error(`Les ressources Nitro de l'effet terrain ${step.mode} sont absentes.`)
    }
    const generation = ++fieldMoveGeneration
    const completion = ports.runtime.playFieldMoveEffect(
      step.mode,
      inventory.gymOverlayModelResolver,
      inventory.gymOverlayAnimationResolver,
    )
    playSound(resolveHgssFieldMoveEffectProfile(step.mode).soundSequenceId)
    void completion.then((result) => {
      if (result === 'completed' && generation === fieldMoveGeneration && ports.context.readState() === state) {
        state.variables.set(step.completionVariable, 1)
      }
    })
    return 'continue'
  }

  const handleMapPropAnimation = (
    step: Extract<FieldScriptEffectsStep, { kind: 'mapPropAnimation' }>,
  ): FieldScriptStepDisposition => {
    if (step.action === 'attach') {
      ports.runtime.setMapPropDeferredAnimations(step.bindings)
      return 'continue'
    }
    if (step.action === 'load') {
      const animationResolver = ports.context.readInventory()?.mapPropAnimationResolver
      const metadataResolver = ports.context.readInventory()?.mapPropAnimationMetadataResolver
      if (!animationResolver || !metadataResolver) {
        throw new Error(`Les ressources MapProp ROM du tag ${step.tag} sont absentes.`)
      }
      ports.runtime.loadMapPropOneShotAnimation(
        step.tag,
        step.modelIds,
        step.animationCount,
        step.loopCount,
        step.reversed,
        animationResolver,
        metadataResolver,
      )
      return 'continue'
    }
    if (step.action === 'play') {
      ports.runtime.playMapPropOneShotAnimation(step.tag, step.animationIndex)
      return 'continue'
    }
    if (step.action === 'unload') {
      ports.runtime.unloadMapPropOneShotAnimation(step.tag)
      return 'continue'
    }
    ports.presentation.waitForPresentation(
      'mapPropAnimation',
      ports.runtime.waitMapPropOneShotAnimation(step.tag),
      `L'animation MapProp ROM ${step.tag} ne peut pas etre terminee.`,
    )
    return 'suspend'
  }

  const handleDoorAnimation = (
    step: Extract<FieldScriptEffectsStep, { kind: 'doorAnimation' }>,
  ): FieldScriptStepDisposition => {
    if (step.tag === 0) throw new Error('Le tag ROM zero est invalide pour une animation de porte.')
    if (step.action === 'setup') {
      const door = ports.context.readWorld()?.resolveScriptDoor(step.worldX, step.worldZ)
      if (!door) {
        throw new Error(`La porte ROM du tag ${step.tag} est absente aux coordonnees ${step.worldX}, ${step.worldZ}.`)
      }
      doorDescriptors.set(step.tag, door)
      doorAnimations.delete(step.tag)
      return 'continue'
    }
    if (step.action === 'unload') {
      if (!doorDescriptors.has(step.tag)) throw new Error(`Le tag de porte ROM ${step.tag} n'est pas charge.`)
      doorDescriptors.delete(step.tag)
      doorAnimations.delete(step.tag)
      return 'continue'
    }
    if (step.action === 'play') {
      const door = doorDescriptors.get(step.tag)
      const resolver = ports.context.readInventory()?.mapPropAnimationResolver
      if (!door || !resolver) throw new Error(`Les ressources ROM du tag de porte ${step.tag} sont absentes.`)
      const sound = resolveDoorSoundSequence(door.classId, step.animationIndex === 0)
      const animation = (async (): Promise<Error | undefined> => {
        try {
          await playRomPresentationWithSoundEffect(
            () => ports.runtime.playDoorAnimation(door, step.animationIndex, resolver),
            ports.context.readAudio(),
            sound,
          )
          return undefined
        } catch (error) {
          return error instanceof Error ? error : new Error(`Animation ROM du tag ${step.tag} interrompue.`)
        }
      })()
      doorAnimations.set(step.tag, animation)
      return 'continue'
    }
    const animation = doorAnimations.get(step.tag)
    if (!animation) throw new Error(`Le tag de porte ROM ${step.tag} n'a aucune animation active.`)
    ports.presentation.waitForPresentation(
      'doorAnimation',
      animation.then((error) => {
        if (error) throw error
      }),
      `L'animation ROM de la porte ${step.tag} ne peut pas être jouée.`,
    )
    return 'suspend'
  }

  const handleEffectsStep = (step: FieldScriptEffectsStep): FieldScriptStepDisposition => {
    if (step.kind === 'screenFade') {
      ports.presentation.applyScreenFade(step.durationFrames, step.type, step.color)
      return 'continue'
    }
    if (step.kind === 'screenShake') {
      const x = Math.max(-32, Math.min(32, step.x))
      const y = Math.max(-32, Math.min(32, step.y))
      const options: KeyframeAnimationOptions = {
        duration: ports.presentation.framesToMilliseconds(Math.max(1, step.durationFrames)),
        iterations: Math.max(1, step.repeats),
        easing: 'linear',
      }
      const keyframes: Keyframe[] = [
        { transform: 'translate(0, 0)' },
        { transform: `translate(${x}px, ${y}px)` },
        { transform: `translate(${-x}px, ${-y}px)` },
        { transform: 'translate(0, 0)' },
      ]
      ports.presentation.waitForPresentation(
        'screenShake',
        animateSurfaces(ports.presentation.surfaces, keyframes, options),
        "L'animation de tremblement ROM a été interrompue.",
      )
      return 'suspend'
    }
    if (step.kind === 'specialCutscene') {
      const options: KeyframeAnimationOptions = {
        duration: resolveSpecialCutsceneDuration(step.effect),
        easing: 'steps(12, end)',
      }
      ports.presentation.waitForPresentation(
        'specialCutscene',
        animateSurfaces(ports.presentation.surfaces, resolveSpecialCutsceneKeyframes(step), options),
        'La mise en scène ROM a été interrompue.',
      )
      return 'suspend'
    }
    if (step.kind === 'gymMechanism') return handleGymMechanism(step)
    if (step.kind === 'fieldOverlay') {
      handleFieldOverlay(step)
      return 'continue'
    }
    if (step.kind === 'mapEventState') return 'continue'
    if (step.kind === 'apricornTree') {
      ports.presentation.waitForPresentation(
        'apricornTree',
        ports.runtime.playApricornTreeAnimation(step.objectId, step.apricornType),
        "L'animation ROM du Noigrume ne peut pas être jouée.",
        { afterResume: () => ports.field.scheduleAutosave(0) },
      )
      return 'suspend'
    }
    if (step.kind === 'fieldMoveEffect') return handleFieldMoveEffect(step)
    if (step.kind === 'mapPropAnimation') return handleMapPropAnimation(step)
    if (step.kind === 'objectEffect') {
      if (step.parameters[0] === 151) {
        ports.field.refreshMainMenu()
        ports.field.syncFollowerPresentation(false, true)
      }
      return 'continue'
    }
    return handleDoorAnimation(step)
  }

  return Object.freeze({
    handle: (step: FieldScriptStep): FieldScriptStepDisposition => (
      isFieldScriptEffectsStep(step) ? handleEffectsStep(step) : 'unhandled'
    ),
    reset: () => {
      fieldMoveGeneration += 1
      ports.runtime.clearFieldMoveEffect()
      doorDescriptors.clear()
      doorAnimations.clear()
    },
  })
}
