import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import { createFieldMovementAction, type FieldMovementAction } from '../scripts/fieldMovement'
import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'
import { getMapOrigin } from './mapCoordinates'
import { hgssWarpMetatileBehaviors, type HgssWarpActivation } from './hgssWarpActivation'

export const hgssWarpTransitionAudio = {
  stairs: 1538,
  escalator: 1556,
  teleporter: 1614,
} as const

export const hgssWarpTransitionTiming = {
  fadeFrames: 6,
  verticalMotionFrames: 16,
  teleporterMotionFrames: 20,
} as const

export type HgssWarpTransitionPresentation = {
  exitMovement?: readonly FieldMovementAction[]
  entryMovement?: readonly FieldMovementAction[]
  entryOffset?: { x: number, z: number, direction: PlayerDirection }
  finalDirection?: PlayerDirection
  spinTeleporter: boolean
  soundEffectId?: number
  continuousSound: boolean
  fadeFrames: number
  fadeColor: 0 | 0x7fff
  transitionNo?: 0 | 2 | 3 | 4 | 5 | 6 | 7 | 8
  transitionMotion?: { kind: 'rise' | 'descend' | 'teleporter', durationFrames: number }
}

export type HgssWarpPlayerTransitionMotion = NonNullable<HgssWarpTransitionPresentation['transitionMotion']> & {
  phase: 'exit' | 'entry'
  direction: PlayerDirection
}

export type HgssWarpTransitionContext = {
  sourceMapType: number
  destinationMapType?: number
  destinationBehavior?: number
}

const directionIndex: Readonly<Record<PlayerDirection, number>> = {
  north: 0, south: 1, west: 2, east: 3,
}

function walkInPlace(direction: PlayerDirection, durationFrames: number): FieldMovementAction {
  return { ...createFieldMovementAction(24 + directionIndex[direction]), durationFrames }
}

function escalatorSourceDirection(activation: HgssWarpActivation): PlayerDirection {
  if (activation.behavior !== hgssWarpMetatileBehaviors.escalatorFlipFace) return activation.direction
  return activation.direction === 'east' ? 'west' : 'east'
}

export function resolveHgssDirectTransitionNo(sourceMapType: number, destinationMapType: number | undefined): 0 | 4 | 5 | 6 {
  if (sourceMapType === 3) return destinationMapType === 1 || destinationMapType === 2 ? 5 : 6
  if (sourceMapType === 1 || sourceMapType === 2) return destinationMapType === 3 ? 4 : 6
  if (sourceMapType === 4 || sourceMapType === 5) return destinationMapType === 4 || destinationMapType === 5 ? 6 : 0
  return 0
}

export function resolveHgssWarpTransitionContext(
  source: OpeningMapPreview,
  destination: OpeningMapPreview | undefined,
  anchor: number,
): HgssWarpTransitionContext {
  const entrance = destination?.events?.warps[anchor]
  const origin = destination ? getMapOrigin(destination) : undefined
  const x = entrance && origin ? entrance.x - origin.x : undefined
  const z = entrance && origin ? entrance.z - origin.z : undefined
  const destinationAttribute = destination?.terrain && x !== undefined && z !== undefined
    && x >= 0 && z >= 0 && x < destination.terrain.width && z < destination.terrain.height
    ? destination.terrain.attributes[z * destination.terrain.width + x]
    : undefined
  return {
    sourceMapType: source.header.mapType,
    destinationMapType: destination?.header.mapType,
    destinationBehavior: destinationAttribute === undefined ? undefined : destinationAttribute & 0xff,
  }
}

/** Décrit les routines `sMapExitRoutines`/`sMapEnterRoutines` utilisées par HGSS. */
export function resolveHgssWarpTransitionPresentation(
  activation: HgssWarpActivation,
  context: HgssWarpTransitionContext = { sourceMapType: 0 },
): HgssWarpTransitionPresentation {
  const fadeFrames = hgssWarpTransitionTiming.fadeFrames
  if (activation.transition === 'door') {
    return { spinTeleporter: false, continuousSound: false, fadeFrames, fadeColor: 0 }
  }
  if (activation.transition === 'direct') {
    const transitionNo = resolveHgssDirectTransitionNo(context.sourceMapType, context.destinationMapType)
    return {
      spinTeleporter: false, continuousSound: false, soundEffectId: hgssWarpTransitionAudio.stairs,
      fadeFrames, fadeColor: transitionNo === 5 ? 0x7fff : 0, transitionNo,
    }
  }
  if (activation.transition === 'panel') {
    return {
      spinTeleporter: true, soundEffectId: hgssWarpTransitionAudio.teleporter,
      continuousSound: false, finalDirection: 'south', fadeFrames, fadeColor: 0,
      transitionMotion: { kind: 'teleporter', durationFrames: hgssWarpTransitionTiming.teleporterMotionFrames },
    }
  }
  const motionDirection = activation.heldDirection
    ?? (activation.transition === 'escalator' ? escalatorSourceDirection(activation) : activation.direction)
  if (activation.transition === 'stairs') {
    const exitAction = createFieldMovementAction(motionDirection === 'west' ? 10 : 11)
    const destinationDirection = context.destinationBehavior === hgssWarpMetatileBehaviors.stairsEast
      ? 'west' : context.destinationBehavior === hgssWarpMetatileBehaviors.stairsWest ? 'east' : undefined
    const entryAction = destinationDirection ? createFieldMovementAction(destinationDirection === 'west' ? 10 : 11) : undefined
    return {
      exitMovement: [exitAction],
      entryMovement: entryAction ? [entryAction] : [walkInPlace(activation.direction, 16)],
      entryOffset: destinationDirection ? { x: destinationDirection === 'west' ? 1 : -1, z: 0, direction: destinationDirection } : undefined,
      finalDirection: destinationDirection ?? activation.direction,
      spinTeleporter: false, continuousSound: false,
      soundEffectId: hgssWarpTransitionAudio.stairs,
      fadeFrames, fadeColor: 0, transitionNo: 3,
    }
  }
  if (activation.transition === 'escalator') {
    const action = createFieldMovementAction(motionDirection === 'west' ? 10 : 11)
    const entryDirection = activation.direction
    return {
      exitMovement: [action],
      entryMovement: [{ ...createFieldMovementAction(entryDirection === 'west' ? 10 : 11), repetitions: 2 }],
      entryOffset: { x: entryDirection === 'west' ? 2 : -2, z: 0, direction: entryDirection },
      finalDirection: entryDirection, spinTeleporter: false, continuousSound: true,
      soundEffectId: hgssWarpTransitionAudio.escalator, fadeFrames, fadeColor: 0, transitionNo: 2,
    }
  }
  const ladderDown = activation.transition === 'ladder-down'
  const entryDirection: PlayerDirection = ladderDown ? 'south' : 'north'
  return {
    exitMovement: ladderDown ? [createFieldMovementAction(0)] : undefined,
    entryMovement: [createFieldMovementAction(entryDirection === 'north' ? 12 : 13)],
    entryOffset: { x: 0, z: entryDirection === 'north' ? 1 : -1, direction: entryDirection },
    finalDirection: entryDirection, spinTeleporter: false, continuousSound: false,
    soundEffectId: hgssWarpTransitionAudio.stairs, fadeFrames, fadeColor: 0,
    transitionNo: ladderDown ? 8 : 7,
    transitionMotion: { kind: ladderDown ? 'descend' : 'rise', durationFrames: hgssWarpTransitionTiming.verticalMotionFrames },
  }
}

export type HgssWarpTransitionPlaybackHost = {
  activation: HgssWarpActivation
  context?: HgssWarpTransitionContext
  initialDirection: PlayerDirection
  movePlayer: (actions: FieldMovementAction[]) => Promise<void>
  movePlayerTransition?: (motion: HgssWarpPlayerTransitionMotion) => Promise<void>
  placePlayerAtEntryOffset?: (offset: NonNullable<HgssWarpTransitionPresentation['entryOffset']>) => void
  setDestinationDirection?: (direction: PlayerDirection) => void
  setPlayerDirection: (direction: PlayerDirection) => void
  playSoundEffect: (sequenceId: number) => void
  stopSoundEffect?: (sequenceId: number) => void
  fadeScreen: (phase: 'out' | 'in', durationFrames: number, color: 0 | 0x7fff) => void
  /** Retourne vrai lorsqu'une animation de porte de destination a déjà révélé la carte. */
  transition: () => boolean | Promise<boolean>
  waitFrames?: (frames: number) => Promise<void>
  assertCurrent?: () => void
}

const teleporterRotation: Readonly<Record<PlayerDirection, PlayerDirection>> = {
  north: 'west', west: 'south', south: 'east', east: 'north',
}

async function spinTeleporter(
  initialDirection: PlayerDirection,
  setDirection: (direction: PlayerDirection) => void,
  waitFrames: (frames: number) => Promise<void>,
  assertCurrent: () => void,
): Promise<void> {
  let direction = initialDirection
  for (let frame = 0; frame < hgssWarpTransitionTiming.teleporterMotionFrames; frame += 2) {
    direction = teleporterRotation[direction]
    setDirection(direction)
    await waitFrames(2)
    assertCurrent()
  }
}

/** Joue la sortie, charge la destination, puis joue l'entrée sans état visuel résiduel. */
export async function playHgssWarpTransition(host: HgssWarpTransitionPlaybackHost): Promise<void> {
  const presentation = resolveHgssWarpTransitionPresentation(host.activation, host.context)
  const waitFrames = host.waitFrames
    ?? ((frames: number) => new Promise<void>((resolve) => setTimeout(resolve, hgssVBlanksToMilliseconds(frames))))
  const assertCurrent = (): void => { host.assertCurrent?.() }
  const awaitCurrent = async <T>(task: Promise<T>): Promise<T> => { const result = await task; assertCurrent(); return result }
  const transitionMotion = (phase: 'exit' | 'entry', direction: PlayerDirection): Promise<void> | undefined => presentation.transitionMotion && host.movePlayerTransition?.({ ...presentation.transitionMotion, phase, direction })
  assertCurrent()
  if (host.activation.transition === 'door') {
    await awaitCurrent(Promise.resolve(host.transition()))
    return
  }
  let continuousSoundPlaying = false
  const startContinuousSound = (): void => {
    if (!presentation.continuousSound || presentation.soundEffectId === undefined) return
    host.playSoundEffect(presentation.soundEffectId); continuousSoundPlaying = true
  }
  const stopContinuousSound = (): void => {
    if (!continuousSoundPlaying || presentation.soundEffectId === undefined) return
    host.stopSoundEffect?.(presentation.soundEffectId); continuousSoundPlaying = false
  }
  try {
    if (presentation.spinTeleporter && presentation.soundEffectId !== undefined) host.playSoundEffect(presentation.soundEffectId)
    startContinuousSound()
    if (presentation.exitMovement) await awaitCurrent(host.movePlayer([...presentation.exitMovement]))
    if (presentation.spinTeleporter) {
      const tasks = [spinTeleporter(host.initialDirection, host.setPlayerDirection, waitFrames, assertCurrent)]
      const motion = transitionMotion('exit', host.initialDirection); if (motion) tasks.push(motion)
      await awaitCurrent(Promise.all(tasks).then(() => undefined))
    } else {
      const motion = transitionMotion('exit', host.initialDirection); if (motion) await awaitCurrent(motion)
    }
    if (!presentation.spinTeleporter && !presentation.continuousSound && presentation.soundEffectId !== undefined) {
      host.playSoundEffect(presentation.soundEffectId)
    }
    host.fadeScreen('out', presentation.fadeFrames, presentation.fadeColor)
    await awaitCurrent(waitFrames(presentation.fadeFrames))
    stopContinuousSound()
    const destinationDoorHandled = await awaitCurrent(Promise.resolve(host.transition()))
    if (destinationDoorHandled) return
    if (presentation.finalDirection && !presentation.spinTeleporter) host.setDestinationDirection?.(presentation.finalDirection)
    if (presentation.entryOffset) host.placePlayerAtEntryOffset?.(presentation.entryOffset)
    const fadeIn = async (): Promise<void> => {
      if (presentation.spinTeleporter) await awaitCurrent(waitFrames(2))
      host.fadeScreen('in', presentation.fadeFrames, presentation.fadeColor)
      await waitFrames(presentation.fadeFrames)
    }
    const entryTasks: Promise<void>[] = [fadeIn()]
    startContinuousSound()
    const entryMotion = transitionMotion('entry', presentation.finalDirection ?? host.activation.direction)
    if (entryMotion) entryTasks.push(entryMotion)
    if (presentation.entryMovement && !entryMotion) entryTasks.push(host.movePlayer([...presentation.entryMovement]))
    if (presentation.spinTeleporter) {
      host.playSoundEffect(hgssWarpTransitionAudio.teleporter)
      entryTasks.push(spinTeleporter(host.activation.direction, host.setPlayerDirection, waitFrames, assertCurrent))
    }
    await awaitCurrent(Promise.all(entryTasks).then(() => undefined))
    if (presentation.entryMovement && entryMotion) await awaitCurrent(host.movePlayer([...presentation.entryMovement]))
    stopContinuousSound()
    if (presentation.finalDirection) {
      host.setDestinationDirection?.(presentation.finalDirection)
      host.setPlayerDirection(presentation.finalDirection)
    }
  } finally {
    stopContinuousSound()
  }
}
