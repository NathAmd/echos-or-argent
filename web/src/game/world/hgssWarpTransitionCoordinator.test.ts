import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, PlayerDirection } from '../../ndsTypes'
import type { PlayerTransitionMotion } from '../../rendering/three/playerTransitionMotion'
import { hgssWarpMetatileBehaviors as behavior, type HgssWarpActivation } from './hgssWarpActivation'
import {
  HgssWarpTransitionSupersededError,
  playHgssWarpTransitionWithRuntime,
  type HgssWarpTransitionCoordinatorOptions,
} from './hgssWarpTransitionCoordinator'
import { hgssFollowerObjectId, type WorldState } from './worldSession'

function createMap(id: number): OpeningMapPreview {
  return { id, label: `Map ${id}`, header: { mapType: 4 } } as OpeningMapPreview
}

function createHarness(activation: HgssWarpActivation) {
  let revision = 1
  let state: WorldState = {
    map: createMap(1), tileX: 4, tileZ: 5, direction: activation.direction, locomotion: 'walking',
  }
  const motions: PlayerTransitionMotion[] = []
  const runtime: HgssWarpTransitionCoordinatorOptions['runtime'] = {
    applyMovement: vi.fn(async () => undefined),
    playPlayerTransitionMotion: vi.fn(async (motion) => { motions.push(motion) }),
    setPlayerDirection: vi.fn(),
    setPlayerPosition: vi.fn(() => 'position'),
  }
  const world: HgssWarpTransitionCoordinatorOptions['world'] = {
    getState: () => state,
    setDirection: vi.fn((direction: PlayerDirection) => { state = { ...state, direction } }),
    setObjectState: vi.fn(),
  }
  const options: HgssWarpTransitionCoordinatorOptions = {
    activation, anchor: 0, source: state, runtime, world,
    getMapLoadRevision: () => revision,
    playSoundEffect: vi.fn(), stopSoundEffect: vi.fn(), fadeScreen: vi.fn(),
    transition: vi.fn(() => { revision += 1; state = { ...state, map: createMap(2) }; return false }),
    waitFrames: async () => undefined,
  }
  return { options, runtime, world, motions, advanceRevision: () => { revision += 1 } }
}

describe('HGSS warp transition coordinator', () => {
  it('applique la face Sud finale du panel au joueur et au follower', async () => {
    const harness = createHarness({
      trigger: 'completed-step', behavior: behavior.panel, transition: 'panel', direction: 'east',
    })
    await playHgssWarpTransitionWithRuntime(harness.options)
    expect(harness.world.setDirection).toHaveBeenLastCalledWith('south')
    expect(harness.world.setObjectState).toHaveBeenLastCalledWith(hgssFollowerObjectId, undefined, undefined, 'south')
    expect(harness.runtime.setPlayerDirection).toHaveBeenLastCalledWith('south')
    expect(harness.motions.map(({ kind, phase }) => `${kind}:${phase}`)).toEqual(['teleporter:exit', 'teleporter:entry'])
  })

  it('rejette une revision externe et ne lance jamais la motion d entree', async () => {
    const harness = createHarness({
      trigger: 'completed-step-held', behavior: behavior.ladderNorth,
      transition: 'ladder', direction: 'north', heldDirection: 'north',
    })
    harness.runtime.playPlayerTransitionMotion = vi.fn(async (motion) => {
      harness.motions.push(motion)
      if (motion.phase === 'exit') harness.advanceRevision()
    })
    await expect(playHgssWarpTransitionWithRuntime(harness.options)).rejects.toBeInstanceOf(HgssWarpTransitionSupersededError)
    expect(harness.motions.map(({ phase }) => phase)).toEqual(['exit'])
    expect(harness.options.transition).not.toHaveBeenCalled()
  })

  it('accepte la revision synchrone du chargement attendu puis joue l entree', async () => {
    const harness = createHarness({
      trigger: 'completed-step-held', behavior: behavior.ladderNorth,
      transition: 'ladder', direction: 'north', heldDirection: 'north',
    })
    await expect(playHgssWarpTransitionWithRuntime(harness.options)).resolves.toBeUndefined()
    expect(harness.motions.map(({ phase }) => phase)).toEqual(['exit', 'entry'])
    expect(harness.runtime.applyMovement).toHaveBeenCalledOnce()
  })

  it('refuse plusieurs chargements synchrones attribues a une seule transition', async () => {
    const harness = createHarness({
      trigger: 'completed-step', behavior: behavior.warpNorth, transition: 'direct', direction: 'north',
    })
    harness.options.transition = vi.fn(() => { harness.advanceRevision(); harness.advanceRevision(); return false })
    await expect(playHgssWarpTransitionWithRuntime(harness.options)).rejects.toBeInstanceOf(HgssWarpTransitionSupersededError)
  })
})
