import { describe, expect, it, vi } from 'vitest'
import type { MapRuntime } from '../../mapRuntime'
import type { NitroModelPreview, OpeningMapPreview, RomInventory } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import type { FieldMovementAction } from '../scripts/fieldMovement'
import type { WorldSession } from '../world/worldSession'
import { createHgssGymCoordinator } from './hgssGymCoordinator'
import type { HgssGymPropPresentation } from './hgssGymPropAnimations'

const model = (id: number, value = 0): NitroModelPreview => ({ modelId: id, vertexCount: 1, triangleCount: 0, quadCount: 0, materialCount: 1, pieceCount: 1, surfaces: [{ materialIndex: 0, positions: new Float32Array([value, 0, 0]) }] })
const map = { id: 365, label: 'Carmin-sur-Mer', header: { areaDataBank: 49 } } as OpeningMapPreview

describe('global HGSS gym coordinator', () => {
  it('restores each Vermilion gate from the Gymmick save block', () => {
    const presented: HgssGymPropPresentation[][] = []
    const presentGymProps = (items: readonly HgssGymPropPresentation[]) => { presented.push([...items]); return Promise.resolve() }
    const runtime = { presentGymProps, syncBlackthornGymMechanism: vi.fn() } as unknown as MapRuntime
    const inventory = {
      mapPropModelResolver: vi.fn((id: number) => model(id)),
      mapPropAnimationMetadataResolver: vi.fn((id: number) => ({ hasAnimations: true, flags: 2, isBicycleSlope: false, controlValue: 0, classId: 0, animationArchiveIds: [id - 7] })),
      mapPropAnimationResolver: vi.fn((id: number) => ({ frameCount: 1, frames: [model(id, 1)] })),
    } as unknown as RomInventory
    const state = createFieldScriptState('male')
    state.gymmick = { type: 3, data: new Uint8Array(0x20) }
    state.gymmick.data.set([0, 0, 0, 1])
    const world = { getState: () => ({ map }) } as unknown as WorldSession
    const coordinator = createHgssGymCoordinator(runtime, vi.fn(), vi.fn())

    expect(coordinator.handleStep({ kind: 'gymMechanism', gymType: 3, action: 'init' }, state, world, inventory)).toBe(true)
    expect(presented).toHaveLength(2)
    expect(presented[0]![0]!.frames).toHaveLength(1)
    expect(presented[1]![0]!.frames).toBeUndefined()
  })

  it('routes native Fuchsia collision segments to their ROM wall animation and sound', () => {
    const playFuchsiaGymWall = vi.fn(() => Promise.resolve())
    const playSound = vi.fn()
    const runtime = { playFuchsiaGymWall, syncBlackthornGymMechanism: vi.fn() } as unknown as MapRuntime
    const state = createFieldScriptState('male')
    state.gymmick = { type: 7, data: new Uint8Array(0x20) }
    const fuchsia = { ...map, id: 480, label: 'Parmanie' }
    const world = { getState: () => ({ map: fuchsia, groundHeight: 16 }) } as unknown as WorldSession
    const coordinator = createHgssGymCoordinator(runtime, vi.fn(), vi.fn(), playSound)
    const inventory = { gymOverlayModelResolver: vi.fn(), gymOverlayAnimationResolver: vi.fn() } as unknown as RomInventory

    expect(coordinator.handleBlockedMovement({ kind: 'blocked', reason: 'terrain', tileX: 8, tileZ: 5, attribute: 1 }, state, world, inventory)).toBe(true)
    expect(playFuchsiaGymWall).toHaveBeenCalledWith(expect.objectContaining({ id: 6, modelId: 0, xOffset: -1 }), 16, inventory.gymOverlayModelResolver, inventory.gymOverlayAnimationResolver)
    expect(playSound).toHaveBeenCalledWith(2307)
  })

  it('runs both native stopper cycles before changing a Vermilion gate', async () => {
    const applyMovement = vi.fn((objectId: number, actions: FieldMovementAction[]) => { void objectId; void actions; return Promise.resolve() })
    const presentGymProps = vi.fn(() => Promise.resolve())
    const runtime = { applyMovement, presentGymProps, syncBlackthornGymMechanism: vi.fn() } as unknown as MapRuntime
    const inventory = {
      mapPropModelResolver: vi.fn((id: number) => model(id)),
      mapPropAnimationMetadataResolver: vi.fn((id: number) => ({ hasAnimations: true, flags: 2, isBicycleSlope: false, controlValue: 0, classId: 0, animationArchiveIds: [id - 7] })),
      mapPropAnimationResolver: vi.fn((id: number) => ({ frameCount: 1, frames: [model(id, 1)] })),
    } as unknown as RomInventory
    const state = createFieldScriptState('male')
    state.gymmick = { type: 3, data: new Uint8Array(0x20) }
    const world = { getState: () => ({ map }) } as unknown as WorldSession
    const wait = vi.fn()
    const playSound = vi.fn()
    const coordinator = createHgssGymCoordinator(runtime, vi.fn(), wait, playSound)

    expect(coordinator.handleStep({ kind: 'gymMechanism', gymType: 3, action: 'openGate', parameter: 0 }, state, world, inventory)).toBe(true)
    await wait.mock.calls[0]![0]
    expect(applyMovement.mock.calls.map(([objectId, actions]) => [objectId, actions[0].action])).toEqual([[3, 22], [4, 22], [5, 23], [3, 22], [4, 22], [5, 23]])
    expect(presentGymProps).toHaveBeenCalledOnce()
    expect(playSound).toHaveBeenCalledWith(1571)
  })

  it('starts the matching Viridian overlay on forced directional tiles', () => {
    const playViridianGymTile = vi.fn(() => Promise.resolve())
    const runtime = { playViridianGymTile, syncBlackthornGymMechanism: vi.fn() } as unknown as MapRuntime
    const state = createFieldScriptState('male')
    state.gymmick = { type: 8, data: new Uint8Array(0x20) }
    const viridian = { ...map, id: 496, label: 'Jadielle' }
    const world = { getTerrainAttributeAt: () => 64 } as unknown as WorldSession
    const inventory = { gymOverlayModelResolver: vi.fn(), gymOverlayAnimationResolver: vi.fn() } as unknown as RomInventory
    const coordinator = createHgssGymCoordinator(runtime, vi.fn(), vi.fn())

    coordinator.handleMovedMovement({ kind: 'moved', state: { map: viridian, tileX: 7, tileZ: 8, direction: 'south', locomotion: 'walking', groundHeight: 32 }, movement: 'forced-slide' }, state, world, inventory)
    expect(playViridianGymTile).toHaveBeenCalledWith(64, 7, 8, 32, inventory.gymOverlayModelResolver, inventory.gymOverlayAnimationResolver)
  })

  it('moves the native Violet elevator and carries actors standing on its 3×3 floor', () => {
    const playVioletGymElevator = vi.fn(() => Promise.resolve())
    const runtime = { playVioletGymElevator, setPlayerPosition: vi.fn(), setFollowerPosition: vi.fn(), syncBlackthornGymMechanism: vi.fn() } as unknown as MapRuntime
    const state = createFieldScriptState('male')
    state.gymmick = { type: 4, data: new Uint8Array(0x20) }
    new DataView(state.gymmick.data.buffer).setUint32(0, 1, true)
    const player = { map: { ...map, id: 135 }, tileX: 15, tileZ: 20, direction: 'north' as const, locomotion: 'walking' as const, groundHeight: 32 }
    const follower = { map: player.map, tileX: 14, tileZ: 20, direction: 'south' as const, groundHeight: 32 }
    const world = { getState: () => player, getFollowerState: () => follower, setObjectState: vi.fn() } as unknown as WorldSession
    const playSound = vi.fn()
    const stopSound = vi.fn()
    const wait = vi.fn()
    const coordinator = createHgssGymCoordinator(runtime, vi.fn(), wait, playSound, stopSound)

    expect(coordinator.handleStep({ kind: 'gymMechanism', gymType: 4, action: 'raiseElevator' }, state, world, undefined)).toBe(true)
    expect(playVioletGymElevator).toHaveBeenCalledWith(496, 29)
    expect(runtime.setPlayerPosition).toHaveBeenCalledWith(15, 20, 'north', true, 496, 29)
    expect(runtime.setFollowerPosition).toHaveBeenCalledWith(follower, true, 29)
    expect(playSound).toHaveBeenCalledWith(1552)
    expect(wait).toHaveBeenCalledWith(expect.any(Promise), expect.stringContaining('Mauville'))
  })
})
