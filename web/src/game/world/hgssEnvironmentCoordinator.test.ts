import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssTimeOfDay } from '../time/hgssRtc'
import { createHgssEnvironmentCoordinator } from './hgssEnvironmentCoordinator'

const map = { id: 42 } as OpeningMapPreview

function snapshot(overrides: Partial<{
  map: OpeningMapPreview
  timeOfDay: HgssTimeOfDay
  allowMusicTransition: boolean
  radioMusicSequenceId: number
}> = {}) {
  return {
    map: overrides.map ?? map,
    now: new Date('2026-08-24T12:00:00Z'),
    timeOfDay: overrides.timeOfDay ?? 1,
    weather: 0 as const,
    mapType: 0,
    allowMusicTransition: overrides.allowMusicTransition ?? true,
    radioMusicSequenceId: overrides.radioMusicSequenceId ?? 0,
  }
}

describe('coordination de l’environnement HGSS', () => {
  it('differe un changement jour/nuit pendant un autre proprietaire audio', async () => {
    let current = snapshot()
    const playMapMusic = vi.fn(async () => undefined)
    const coordinator = createHgssEnvironmentCoordinator({
      readSnapshot: () => current,
      applyPresentation: vi.fn(),
      playMapMusic,
    })

    coordinator.update(true)
    current = snapshot({ timeOfDay: 3, allowMusicTransition: false })
    coordinator.update(true)
    expect(playMapMusic).not.toHaveBeenCalled()

    current = snapshot({ timeOfDay: 3, allowMusicTransition: true })
    coordinator.update(true)
    expect(playMapMusic).toHaveBeenCalledExactlyOnceWith(map, current.now)
    await Promise.resolve()
    coordinator.update(true)
    expect(playMapMusic).toHaveBeenCalledOnce()
  })

  it('laisse la Radio acquitter le creneau et restaurer elle-meme la carte', () => {
    let current = snapshot()
    const playMapMusic = vi.fn(async () => undefined)
    const coordinator = createHgssEnvironmentCoordinator({
      readSnapshot: () => current,
      applyPresentation: vi.fn(),
      playMapMusic,
    })

    coordinator.update(true)
    current = snapshot({ timeOfDay: 3, radioMusicSequenceId: 1100 })
    coordinator.update(true)
    current = snapshot({ timeOfDay: 3 })
    coordinator.update(true)

    expect(playMapMusic).not.toHaveBeenCalled()
  })

  it('reessaie une transition qui echoue sans dupliquer une demande active', async () => {
    let current = snapshot()
    let rejectFirst!: (reason?: unknown) => void
    const first = new Promise<void>((_, reject) => { rejectFirst = reject })
    const playMapMusic = vi.fn()
      .mockReturnValueOnce(first)
      .mockResolvedValue(undefined)
    const coordinator = createHgssEnvironmentCoordinator({
      readSnapshot: () => current,
      applyPresentation: vi.fn(),
      playMapMusic,
    })

    coordinator.update(true)
    current = snapshot({ timeOfDay: 3 })
    coordinator.update(true)
    coordinator.update(true)
    expect(playMapMusic).toHaveBeenCalledOnce()

    rejectFirst(new Error('autoplay'))
    await first.catch(() => undefined)
    await Promise.resolve()
    coordinator.update(true)
    expect(playMapMusic).toHaveBeenCalledTimes(2)
  })

  it('ignore l’acquittement tardif d’une ancienne carte', async () => {
    let current = snapshot()
    let resolveTransition!: () => void
    const transition = new Promise<void>((resolve) => { resolveTransition = resolve })
    const playMapMusic = vi.fn(() => transition)
    const coordinator = createHgssEnvironmentCoordinator({
      readSnapshot: () => current,
      applyPresentation: vi.fn(),
      playMapMusic,
    })

    coordinator.update(true)
    current = snapshot({ timeOfDay: 3 })
    coordinator.update(true)
    current = snapshot({ map: { id: 43 } as OpeningMapPreview, timeOfDay: 1 })
    coordinator.update(true)
    resolveTransition()
    await transition
    current = snapshot({ map: { id: 43 } as OpeningMapPreview, timeOfDay: 3 })
    coordinator.update(true)

    expect(playMapMusic).toHaveBeenCalledTimes(2)
  })
})
