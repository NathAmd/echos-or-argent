import { describe, expect, it, vi } from 'vitest'
import type { MapRuntime } from '../../mapRuntime'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createWorldSession } from '../world/worldSession'
import { createBlackthornGymCoordinator } from './blackthornGymCoordinator'

function createBlackthornMap(): OpeningMapPreview {
  return {
    id: 141,
    label: 'Ebènelle',
    header: { mapId: 141, areaDataBank: 0, bikeAllowed: false } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array([0x13, 0xfd]), headerSize: 2, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: { matrixIndex: 141, name: 'blackthorn', width: 1, height: 1, headers: new Uint16Array([141]), altitudes: new Uint8Array([0]), modelIds: new Uint16Array([0]) },
    terrain: { modelId: 0, width: 100, height: 100, attributes: new Uint16Array(10_000).fill(44) },
  }
}

function initializeBlackthornState() {
  const state = createFieldScriptState('male')
  state.gymmick = { type: 6, data: new Uint8Array(0x20) }
  const view = new DataView(state.gymmick.data.buffer)
  ;[[13, 75, 0], [9, 58, 1], [14, 32, 0]].forEach(([x, z, rotation], index) => {
    view.setUint16(index * 2, x!, true)
    view.setUint16(6 + index * 2, z!, true)
    state.gymmick.data[12 + index] = rotation!
  })
  return state
}

describe('Blackthorn Gym coordinator', () => {
  it('syncs the native init step and moves world, presentation and save state together', async () => {
    const syncBlackthornGymMechanism = vi.fn()
    const setPlayerPosition = vi.fn()
    const playBlackthornGymAction = vi.fn(() => Promise.resolve())
    const runtime = { syncBlackthornGymMechanism, setPlayerPosition, setFollowerPosition: vi.fn(), playBlackthornGymAction } as unknown as MapRuntime
    const settled = vi.fn()
    const coordinator = createBlackthornGymCoordinator(runtime, settled)
    const state = initializeBlackthornState()
    const map = createBlackthornMap()
    const world = createWorldSession([map])
    world.loadMap(141, 14, 75)

    expect(coordinator.handleStep({ kind: 'gymMechanism', gymType: 6, action: 'init' }, state, world, undefined)).toBe(true)
    expect(syncBlackthornGymMechanism).toHaveBeenCalledWith(state.gymmick.data, undefined)
    expect(coordinator.tryInteract(state, world)).toBe(true)
    expect(world.getState()).toMatchObject({ tileX: 19, tileZ: 75 })
    expect(setPlayerPosition).toHaveBeenCalledWith(19, 75, 'south', true, undefined, 10, 'forced-slide')
    expect(playBlackthornGymAction).toHaveBeenCalledWith(expect.objectContaining({ applied: true, playerX: 19 }))
    await Promise.resolve()
    await Promise.resolve()
    expect(settled).toHaveBeenCalledWith()
  })
})
