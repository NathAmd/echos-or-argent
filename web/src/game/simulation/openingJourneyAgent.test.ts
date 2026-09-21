import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState, initializeNewGameFieldScriptState } from '../scripts/fieldScriptRunner'
import { createWorldSession } from '../world/worldSession'
import { createOpeningJourneyAgent } from './openingJourneyAgent'

function createMap(id: number, width = 10, height = 6): OpeningMapPreview {
  return {
    id,
    label: `Map ${id}`,
    header: { mapId: id, areaDataBank: 0, bikeAllowed: false } as OpeningMapPreview['header'],
    fieldScripts: { bank: 0, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: id,
      name: `matrix-${id}`,
      width: 1,
      height: 1,
      headers: new Uint16Array([id]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([0]),
    },
    terrain: { modelId: 0, width, height, attributes: new Uint16Array(width * height) },
    events: { backgroundEvents: 0, backgrounds: [], objects: [], warps: [], coordinateEvents: [] },
  }
}

function setBehavior(map: OpeningMapPreview, x: number, z: number, behavior: number): void {
  map.terrain!.attributes[z * map.terrain!.width + x] = behavior
}

function createRequiredMaps(): { town: OpeningMapPreview, lab: OpeningMapPreview } {
  const town = createMap(60)
  town.events!.coordinateEvents.push({
    scriptId: 3,
    x: 5,
    z: 5,
    width: 1,
    height: 1,
    y: 0,
    expectedValue: 0,
    variableId: 0x4000,
  })
  const lab = createMap(61)
  lab.events!.backgrounds.push({ scriptId: 7, type: 0, x: 8, z: 4, y: 0, direction: 0 })
  return { town, lab }
}

function blockingObject(id: number, x: number, z: number): MapEventPreview['objects'][number] {
  return {
    id,
    spriteId: 290,
    movement: 0,
    type: 0,
    eventFlag: 0,
    scriptId: 0,
    facingDirection: 0,
    xRange: 0,
    zRange: 0,
    x,
    z,
  }
}

describe('opening journey agent', () => {
  it('applies the native new-game hide flag before resolving the lab exit warp', () => {
    const bedroom = createMap(64)
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 30, true)
    view.setUint16(2, 0x1a6, true)
    view.setUint16(4, 2, true)
    bedroom.standardScriptBanks = [{
      bank: 149,
      baseScriptId: 9600,
      bytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }]
    const state = createFieldScriptState('male')

    initializeNewGameFieldScriptState(bedroom, state)

    expect(state.flags.has(0x1a6)).toBe(true)
    const lab = createMap(61, 3, 3)
    lab.events!.warps.push({ x: 1, z: 1, header: 60, anchor: 0 })
    lab.events!.objects.push({ ...blockingObject(3, 1, 1), eventFlag: 0x1a6 })
    setBehavior(lab, 1, 1, 101)
    const world = createWorldSession([lab], state.flags)
    world.loadMap(61, 1, 0, 'south')

    expect(world.tryMove(0, 1, 'south')).toMatchObject({
      kind: 'moved',
      state: { tileX: 1, tileZ: 1 },
      warp: { kind: 'warp', header: 60 },
    })
  })

  it('ignores an adjacent warp when the ROM movement result is blocked by an object', () => {
    const { town, lab } = createRequiredMaps()
    const bedroom = createMap(64, 4, 3)
    bedroom.events!.warps.push(
      { x: 1, z: 0, header: 63, anchor: 0 },
      { x: 3, z: 1, header: 63, anchor: 1 },
    )
    bedroom.events!.objects.push(blockingObject(0, 1, 0))
    setBehavior(bedroom, 1, 0, 110)
    setBehavior(bedroom, 3, 1, 108)

    const agent = createOpeningJourneyAgent([town, lab, bedroom])
    const input = agent.nextInput(
      { mapId: 64, tileX: 1, tileZ: 1, direction: 'north' },
      createFieldScriptState('male'),
    )

    expect(input).toBe('right')
  })

  it('keeps NPC and background interactions anchored before the attempted movement', () => {
    const { town, lab } = createRequiredMaps()
    const livingRoom = createMap(63)
    livingRoom.events!.warps.push({ x: 1, z: 0, header: 60, anchor: 0 })
    town.events!.warps.push({ x: 1, z: 0, header: 61, anchor: 0 })
    lab.events!.warps.push({ x: 1, z: 0, header: 60, anchor: 0 })
    town.events!.warps.push({ x: 2, z: 1, header: 63, anchor: 0 })
    livingRoom.events!.objects.push(blockingObject(0, 2, 1))
    setBehavior(livingRoom, 1, 0, 110)
    setBehavior(town, 1, 0, 110)
    setBehavior(lab, 1, 0, 110)
    setBehavior(town, 2, 1, 108)
    const agent = createOpeningJourneyAgent([town, lab, livingRoom])
    const state = createFieldScriptState('male')

    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 60, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 61, tileX: 7, tileZ: 4, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 61, tileX: 7, tileZ: 4, direction: 'east' }, state)).toBe('confirm')

    state.party.members.push({} as (typeof state.party.members)[number])
    state.flags.add(0x6a)
    state.variables.set(0x4108, 1)
    expect(agent.nextInput({ mapId: 61, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 60, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('confirm')
  })
})
