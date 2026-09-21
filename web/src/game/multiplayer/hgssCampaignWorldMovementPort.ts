import type { PlayerLocomotionMode, PlayerMovementKind } from '../player/hgssPlayerMovement'
import type { DoorTransitionDescriptor } from '../../rom/maps/doorTransition'
import type { HgssWarpActivation } from '../world/hgssWarpActivation'
import type { WorldSession, WorldTransitionResult } from '../world/worldSession'
import type { HgssCampaignFieldPosition } from './hgssCampaignProtocol'
import type {
  HgssCampaignMovementCommand,
  HgssCampaignServerMovementPort,
  HgssCampaignServerMovementPortDecision,
  HgssCampaignServerPortContext,
} from './hgssCampaignServerCore'

export type HgssCampaignWorldMovementProbe = Readonly<Pick<WorldSession, 'getState' | 'tryMove'> & {
  /** Resolution ROM d'un WarpEvent; absente sur un probe limite aux pas ordinaires. */
  transitionTo?: WorldSession['transitionTo']
  /** Autorisation issue de l'état fiable de l'hôte, jamais de la commande distante. */
  isModeAllowed: (mode: HgssCampaignMovementCommand['mode']) => boolean
}>

export type HgssCampaignWorldMovementProbeFactory = (
  context: HgssCampaignServerPortContext<HgssCampaignMovementCommand>,
) => HgssCampaignWorldMovementProbe | undefined

export type HgssCampaignWorldMovementPortOptions = Readonly<{
  /**
   * Doit produire un probe neuf, déjà chargé depuis l'état autoritaire de
   * l'hôte. `WorldSession.tryMove` mute sa session : une session de jeu vive
   * ne doit donc jamais être retournée ici.
   */
  createProbe: HgssCampaignWorldMovementProbeFactory
}>

type TransitionArrival = NonNullable<Extract<WorldTransitionResult, { kind: 'transitioned' }>['arrival']>

export type HgssCampaignWorldTransitionPresentation = Readonly<{
  kind: 'warp' | 'map-boundary'
  /** Case produite par le pas avant chargement de la destination. */
  triggerPosition: HgssCampaignFieldPosition
  /** Position finale attestee et publiee dans le snapshot. */
  authoritativePosition: HgssCampaignFieldPosition
  activation?: HgssWarpActivation
  entryDoor?: DoorTransitionDescriptor
  destinationArrival?: TransitionArrival
}>

export type HgssCampaignWorldMovementResolution =
  | Readonly<{ kind: 'accept', movement: 'step' }>
  | Readonly<{
    kind: 'accept'
    movement: 'transition'
    /** Le pas cardinal source reste distinct de cette position finale. */
    to: HgssCampaignFieldPosition
    authoritativePosition: HgssCampaignFieldPosition
    presentation: HgssCampaignWorldTransitionPresentation
  }>
  | Readonly<{ kind: 'reject', code: string, message: string }>

const expectedLocomotionByMode: Readonly<Record<
  HgssCampaignMovementCommand['mode'],
  PlayerLocomotionMode
>> = Object.freeze({
  walk: 'walking',
  run: 'walking',
})

const expectedMovementByMode: Readonly<Record<
  HgssCampaignMovementCommand['mode'],
  PlayerMovementKind
>> = Object.freeze({
  walk: 'walk',
  run: 'run',
})

function reject(
  code: string,
  message: string,
): Extract<HgssCampaignWorldMovementResolution, { kind: 'reject' }> {
  return Object.freeze({ kind: 'reject', code, message })
}

function fieldPosition(state: NonNullable<ReturnType<WorldSession['getState']>>): HgssCampaignFieldPosition {
  return Object.freeze({
    mapId: state.map.id,
    x: state.tileX,
    z: state.tileZ,
    direction: state.direction,
  })
}

function samePosition(first: HgssCampaignFieldPosition, second: HgssCampaignFieldPosition): boolean {
  return first.mapId === second.mapId
    && first.x === second.x
    && first.z === second.z
    && first.direction === second.direction
}

function transitionResolution(
  command: HgssCampaignMovementCommand,
  triggerPosition: HgssCampaignFieldPosition,
  authoritativePosition: HgssCampaignFieldPosition,
  presentation: Omit<HgssCampaignWorldTransitionPresentation, 'triggerPosition' | 'authoritativePosition'>,
): HgssCampaignWorldMovementResolution {
  return Object.freeze({
    kind: 'accept',
    movement: 'transition',
    to: Object.freeze({ ...command.to }),
    authoritativePosition,
    presentation: Object.freeze({ ...presentation, triggerPosition, authoritativePosition }),
  })
}

/**
 * Resout une intention contre un probe ROM jetable. Le resultat conserve a la
 * fois `to` (pas cardinal) et la position finale afin que le client puisse
 * construire son attestation avant l'envoi, sans rejouer le probe apres ACK.
 */
export function resolveHgssCampaignWorldMovement(
  options: HgssCampaignWorldMovementPortOptions,
  context: HgssCampaignServerPortContext<HgssCampaignMovementCommand>,
): HgssCampaignWorldMovementResolution {
  const probe = options.createProbe(context)
  if (!probe) return reject(
    'world-probe-unavailable',
    "L'état du monde autoritaire n'est pas disponible pour valider ce déplacement.",
  )

  const initial = probe.getState()
  if (!initial) return reject(
    'world-probe-unloaded',
    "Le probe du monde autoritaire n'est pas chargé.",
  )

  const { command } = context
  if (
    initial.map.id !== command.from.mapId
    || initial.tileX !== command.from.x
    || initial.tileZ !== command.from.z
    || initial.direction !== command.from.direction
  ) return reject(
    'world-origin-conflict',
    "Le probe du monde ne correspond pas à l'origine autoritaire du déplacement.",
  )

  if (
    initial.locomotion !== expectedLocomotionByMode[command.mode]
    || !probe.isModeAllowed(command.mode)
  ) return reject(
    'world-mode-conflict',
    "Le mode de déplacement n'est pas autorisé par l'état fiable de l'hôte.",
  )

  const deltaX = command.to.x - command.from.x
  const deltaZ = command.to.z - command.from.z
  const result = probe.tryMove(deltaX, deltaZ, command.to.direction, {
    enforceTurn: false,
    forced: false,
    running: command.mode === 'run',
  })
  if (!result) return reject(
    'world-probe-failed',
    "Le probe du monde n'a pas pu évaluer ce déplacement.",
  )

  if (result.objectMovements !== undefined) return reject(
    'world-side-effect-required',
    "Ce déplacement exige une mutation d'objet qui n'est pas encore transactionnelle.",
  )

  if (result.kind === 'blocked') return reject(
    `world-${result.reason}`,
    `La collision autoritaire du monde bloque ce déplacement (${result.reason}).`,
  )

  if (result.kind === 'turned') return reject(
    'world-turn-only',
    "Le probe du monde n'a validé qu'une rotation sur place.",
  )

  if (result.coordinate !== undefined) return reject(
    'world-event-required',
    "Ce déplacement déclenche un événement qui n'est pas encore transactionnel.",
  )

  if (
    result.continuationDirection !== undefined
    || result.movement !== expectedMovementByMode[command.mode]
  ) return reject(
    'world-special-movement-required',
    "Ce déplacement spécial exige une résolution autoritaire dédiée.",
  )

  if (result.state.locomotion !== initial.locomotion) return reject(
    'world-transition-required',
    "Ce déplacement change de locomotion sans transaction autoritaire dédiée.",
  )

  const triggerPosition = fieldPosition(result.state)
  if (result.warp !== undefined || result.warpActivation !== undefined || result.door !== undefined) {
    if (!result.warp || !result.warpActivation || !probe.transitionTo
      || command.mode !== 'walk' && command.mode !== 'run') return reject(
      'world-transition-required',
      "Ce déplacement exige une transition autoritaire qui n'est pas disponible.",
    )
    const transitioned = probe.transitionTo(
      result.warp.header,
      result.warp.anchor,
      result.warpActivation.direction,
    )
    if (transitioned.kind !== 'transitioned' || transitioned.state.locomotion !== 'walking') return reject(
      'world-transition-unavailable',
      "La destination du warp ROM ne peut pas être résolue par l'autorité.",
    )
    return transitionResolution(command, triggerPosition, fieldPosition(transitioned.state), {
      kind: 'warp',
      activation: Object.freeze({ ...result.warpActivation }),
      ...(result.door ? { entryDoor: result.door } : {}),
      ...(transitioned.arrival ? { destinationArrival: transitioned.arrival } : {}),
    })
  }

  if (result.state.map.id !== command.to.mapId) {
    return transitionResolution(command, triggerPosition, triggerPosition, { kind: 'map-boundary' })
  }

  if (
    result.state.tileX !== command.to.x
    || result.state.tileZ !== command.to.z
    || result.state.direction !== command.to.direction
  ) return reject(
    'world-destination-conflict',
    "La destination calculée par le monde ne correspond pas à la commande.",
  )

  return Object.freeze({ kind: 'accept', movement: 'step' })
}

/**
 * Adapte la collision ROM de `WorldSession` au port autoritaire du pair hôte.
 * Seul un pas ordinaire, exact et sans effet secondaire est admis. Les warps,
 * scripts, poussées et mouvements forcés resteront fermés jusqu'à disposer
 * d'une transaction autoritaire dédiée.
 */
export function createHgssCampaignWorldMovementPort(
  options: HgssCampaignWorldMovementPortOptions,
): HgssCampaignServerMovementPort {
  return (context) => {
    const resolution = resolveHgssCampaignWorldMovement(options, context)
    if (resolution.kind === 'reject') return resolution
    if (resolution.movement === 'step') {
      return context.command.arrival
        ? reject('world-unexpected-arrival', "Le client a annoncé une arrivée sans warp ROM autoritaire.")
        : Object.freeze({ kind: 'accept' })
    }
    if (!context.command.arrival
      || !samePosition(context.command.arrival, resolution.authoritativePosition)) return reject(
      'world-arrival-conflict',
      "L'arrivée annoncée ne correspond pas à la destination calculée par la ROM hôte.",
    )
    return Object.freeze({
      kind: 'accept',
      authoritativePosition: resolution.authoritativePosition,
    }) satisfies HgssCampaignServerMovementPortDecision
  }
}
