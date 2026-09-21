import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createZephyrJourneyAgent } from './zephyrJourneyAgent'

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

function createObject(id: number, x: number, z: number, eventFlag = 0): MapEventPreview['objects'][number] {
  return {
    id,
    spriteId: 290,
    movement: 0,
    type: 0,
    eventFlag,
    scriptId: 0,
    facingDirection: 0,
    xRange: 0,
    zRange: 0,
    x,
    z,
  }
}

function createOpeningAndRouteMaps(): OpeningMapPreview[] {
  const matrix: OpeningMapPreview['matrix'] = {
    matrixIndex: 71,
    name: 'new-bark-route-29',
    width: 2,
    height: 1,
    headers: new Uint16Array([60, 33]),
    altitudes: new Uint8Array([0, 0]),
    modelIds: new Uint16Array([0, 0]),
  }
  const town = createMap(60, 32, 32)
  town.matrix = matrix
  town.events!.warps.push(
    { x: 2, z: 1, header: 61, anchor: 0 },
    { x: 1, z: 2, header: 63, anchor: 0 },
  )
  town.events!.coordinateEvents.push({
    scriptId: 3,
    x: 4,
    z: 1,
    width: 1,
    height: 1,
    y: 0,
    expectedValue: 0,
    variableId: 0x4000,
  })
  town.events!.objects.push(createObject(12, 31, 1, 500))
  setBehavior(town, 2, 1, 108)
  setBehavior(town, 1, 2, 111)

  const route29 = createMap(33, 32, 32)
  route29.matrix = matrix

  const lab = createMap(61)
  lab.events!.backgroundEvents = 1
  lab.events!.backgrounds.push({ scriptId: 7, type: 0, x: 8, z: 4, y: 0, direction: 0 })
  lab.events!.warps.push({ x: 1, z: 0, header: 60, anchor: 0 })
  setBehavior(lab, 1, 0, 110)

  const home = createMap(63)
  home.events!.objects.push(createObject(0, 2, 1))
  home.events!.warps.push({ x: 1, z: 0, header: 60, anchor: 0 })
  setBehavior(home, 1, 0, 110)

  return [town, route29, lab, home]
}

describe('Zephyr journey agent', () => {
  it('composes the opening with Route 29 and invalidates queued movement after an interruption', () => {
    const agent = createZephyrJourneyAgent(createOpeningAndRouteMaps())
    const state = createFieldScriptState('male')

    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 60, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 61, tileX: 7, tileZ: 4, direction: 'east' }, state)).toBe('right')

    state.party.members.push({} as (typeof state.party.members)[number])
    state.flags.add(0x6a)
    state.variables.set(0x4108, 1)
    expect(agent.nextInput({ mapId: 61, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 60, tileX: 1, tileZ: 1, direction: 'south' }, state)).toBe('down')
    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')

    state.flags.add(0x9c)
    expect(agent.nextInput({ mapId: 63, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 60, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBeDefined()

    state.phoneContacts.add(1)
    state.flags.add(500)
    expect(agent.nextInput({ mapId: 60, tileX: 29, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint()).toEqual({ id: 'reach-route-29', label: 'Quitter Bourg Geon par la Route 29' })
    expect(agent.getChoiceIndex(state)).toBe(0)

    state.flags.delete(500)
    agent.invalidatePlan()
    const replannedInput = agent.nextInput({ mapId: 60, tileX: 30, tileZ: 1, direction: 'east' }, state)
    expect(replannedInput).toBeDefined()
    expect(replannedInput).not.toBe('right')
  })
})
