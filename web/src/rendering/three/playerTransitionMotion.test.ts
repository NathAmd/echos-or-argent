import { describe, expect, it, vi } from 'vitest'
import {
  PlayerTransitionMotionController,
  samplePlayerTransitionMotion,
  scalePlayerTransitionOffset,
  type PlayerTransitionMotion,
} from './playerTransitionMotion'

const riseExit: PlayerTransitionMotion = {
  kind: 'rise', phase: 'exit', direction: 'north', durationFrames: 16,
}

describe('player transition motion', () => {
  it('reproduit les deux cases verticales des echelles sur seize VBlank', () => {
    expect(samplePlayerTransitionMotion(riseExit, 0)).toEqual({ offsetYTiles: 0, complete: false })
    expect(samplePlayerTransitionMotion(riseExit, 8)).toEqual({ offsetYTiles: 1, complete: false })
    expect(samplePlayerTransitionMotion(riseExit, 16)).toEqual({ offsetYTiles: 2, complete: true })
    expect(samplePlayerTransitionMotion({ ...riseExit, direction: 'south' }, 16).offsetYTiles).toBe(0.5)
    expect(scalePlayerTransitionOffset(2, true)).toBe(2)
    expect(scalePlayerTransitionOffset(2, false)).toBe(32)
  })

  it('inverse les bases visuelles d entree sans laisser d offset terminal', () => {
    const riseEntry = { ...riseExit, phase: 'entry' as const }
    const descendEntry = { ...riseEntry, kind: 'descend' as const }
    expect(samplePlayerTransitionMotion(riseEntry, 0).offsetYTiles).toBe(-2)
    expect(samplePlayerTransitionMotion(riseEntry, 16).offsetYTiles).toBe(0)
    expect(samplePlayerTransitionMotion(descendEntry, 0).offsetYTiles).toBe(2)
    expect(samplePlayerTransitionMotion(descendEntry, 16).offsetYTiles).toBe(-0)
  })

  it('reproduit la courbe parabolique du WarpPanel dans les deux sens', () => {
    const exit: PlayerTransitionMotion = {
      kind: 'teleporter', phase: 'exit', direction: 'west', durationFrames: 20,
    }
    const entry = { ...exit, phase: 'entry' as const }
    expect(samplePlayerTransitionMotion(exit, 0).offsetYTiles).toBe(0)
    expect(samplePlayerTransitionMotion(exit, 20).offsetYTiles).toBeCloseTo(15.25, 5)
    expect(samplePlayerTransitionMotion(entry, 0).offsetYTiles).toBeCloseTo(15.25, 5)
    expect(samplePlayerTransitionMotion(entry, 20).offsetYTiles).toBe(0)
  })

  it('resout une sortie au terme tout en gardant son offset jusqu a annulation', async () => {
    const controller = new PlayerTransitionMotionController()
    const resolved = vi.fn()
    void controller.play(riseExit, 100).then(resolved)
    expect(controller.update(100 + 16 * (1000 / 60), 1000 / 60)).toEqual({ offsetYTiles: 2, complete: true })
    await Promise.resolve()
    expect(resolved).toHaveBeenCalledOnce()
    expect(controller.isActive).toBe(true)
    controller.cancel()
    expect(controller.isActive).toBe(false)
  })

  it('annule et interrompt une motion en attente lors d un changement de carte', async () => {
    const controller = new PlayerTransitionMotionController()
    const pending = controller.play(riseExit, 0)
    controller.cancel()
    await expect(pending).rejects.toMatchObject({ name: 'PlayerTransitionMotionCancelledError' })
    expect(controller.update(1_000, 1000 / 60)).toBeUndefined()
  })
})
