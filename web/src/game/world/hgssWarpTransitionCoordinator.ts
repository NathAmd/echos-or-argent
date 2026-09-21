import type { OpeningMapPreview } from '../../ndsTypes'
import type { MapRuntime } from '../../mapRuntimeTypes'
import { hgssFollowerObjectId, type WorldSession, type WorldState } from './worldSession'
import type { HgssWarpActivation } from './hgssWarpActivation'
import {
  playHgssWarpTransition,
  resolveHgssWarpTransitionContext,
  type HgssWarpTransitionPlaybackHost,
} from './hgssWarpTransitionPresentation'

type WarpRuntime = Pick<MapRuntime,
  'applyMovement' | 'playPlayerTransitionMotion' | 'setPlayerDirection' | 'setPlayerPosition'
>

type WarpWorld = Pick<WorldSession, 'getState' | 'setDirection' | 'setObjectState'>

export type HgssWarpTransitionCoordinatorOptions = {
  activation: HgssWarpActivation
  anchor: number
  source: WorldState
  destination?: OpeningMapPreview
  runtime: WarpRuntime
  world: WarpWorld
  getMapLoadRevision: () => number
  playSoundEffect: (sequenceId: number) => void
  stopSoundEffect: (sequenceId: number) => void
  fadeScreen: HgssWarpTransitionPlaybackHost['fadeScreen']
  transition: HgssWarpTransitionPlaybackHost['transition']
  waitFrames?: HgssWarpTransitionPlaybackHost['waitFrames']
}

export class HgssWarpTransitionSupersededError extends Error {
  override readonly name = 'HgssWarpTransitionSupersededError'

  constructor() { super('La carte active a change pendant la transition ROM.') }
}

/**
 * Adaptateur unique entre le flux ROM et les etats monde/rendu. La revision est
 * acquittee juste apres `transition()`, dont le chargement de carte est
 * synchrone dans le runtime web; toute autre revision annule l'ancien flux.
 */
export async function playHgssWarpTransitionWithRuntime(options: HgssWarpTransitionCoordinatorOptions): Promise<void> {
  let expectedMapLoadRevision = options.getMapLoadRevision()
  const assertCurrent = (): void => {
    if (options.getMapLoadRevision() !== expectedMapLoadRevision) throw new HgssWarpTransitionSupersededError()
  }
  const transition = (): boolean | Promise<boolean> => {
    assertCurrent()
    const task = options.transition()
    const loadedRevision = options.getMapLoadRevision()
    if (loadedRevision !== expectedMapLoadRevision + 1) {
      void Promise.resolve(task).catch(() => undefined)
      return Promise.reject(new HgssWarpTransitionSupersededError())
    }
    expectedMapLoadRevision = loadedRevision
    return task
  }
  const setDestinationDirection = (direction: WorldState['direction']): void => {
    options.world.setDirection(direction)
    options.world.setObjectState(hgssFollowerObjectId, undefined, undefined, direction)
    options.runtime.setPlayerDirection(direction)
  }
  await playHgssWarpTransition({
    activation: options.activation,
    context: resolveHgssWarpTransitionContext(options.source.map, options.destination, options.anchor),
    initialDirection: options.source.direction,
    movePlayer: (actions) => options.runtime.applyMovement(255, actions),
    movePlayerTransition: options.runtime.playPlayerTransitionMotion,
    placePlayerAtEntryOffset: ({ x, z, direction }) => {
      const current = options.world.getState()
      if (current) options.runtime.setPlayerPosition(current.tileX + x, current.tileZ + z, direction, false, current.groundHeight)
    },
    setDestinationDirection,
    setPlayerDirection: options.runtime.setPlayerDirection,
    playSoundEffect: options.playSoundEffect,
    stopSoundEffect: options.stopSoundEffect,
    fadeScreen: options.fadeScreen,
    transition,
    waitFrames: options.waitFrames,
    assertCurrent,
  })
}
