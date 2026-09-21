import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createTogepiEggJourneyAgent, TOGEPI_EGG_TARGET } from './togepiEggJourneyAgent'

function createMap(id: number): OpeningMapPreview {
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
    terrain: { modelId: 0, width: 5, height: 5, attributes: new Uint16Array(25) },
    events: { backgroundEvents: 0, backgrounds: [], objects: [], warps: [], coordinateEvents: [] },
  }
}

function addWarp(map: OpeningMapPreview, x: number, z: number, targetMapId: number, behavior: number): void {
  map.events!.warps.push({ x, z, header: targetMapId, anchor: 0 })
  map.terrain!.attributes[z * map.terrain!.width + x] = behavior
}

function createAide(): MapEventPreview['objects'][number] {
  return {
    id: TOGEPI_EGG_TARGET.elmAideObjectId,
    spriteId: 290,
    movement: 0,
    type: 0,
    eventFlag: TOGEPI_EGG_TARGET.receivedFlagId,
    scriptId: 0,
    facingDirection: 0,
    xRange: 0,
    zRange: 0,
    x: 2,
    z: 1,
  }
}

function addOpeningPrerequisites(maps: OpeningMapPreview[]): OpeningMapPreview[] {
  const lab = createMap(61)
  lab.events!.backgrounds.push({ scriptId: 7, type: 0, x: 8, z: 4, y: 0, direction: 0 })
  const town = createMap(60)
  town.events!.coordinateEvents.push({ scriptId: 3, x: 1, z: 1, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 0x4000 })
  return [...maps, lab, town]
}

describe('Togepi Egg journey agent', () => {
  it('continues after Zephyr, receives the ROM egg and closes only back in Violet City', () => {
    const gym = createMap(TOGEPI_EGG_TARGET.violetGymMapId)
    const city = createMap(TOGEPI_EGG_TARGET.violetCityMapId)
    const shop = createMap(TOGEPI_EGG_TARGET.violetShopMapId)
    addWarp(gym, 2, 1, city.id, 108)
    addWarp(city, 2, 1, shop.id, 108)
    addWarp(shop, 1, 0, city.id, 110)
    shop.events!.objects.push(createAide())
    const agent = createTogepiEggJourneyAgent(addOpeningPrerequisites([gym, city, shop]))
    const state = createFieldScriptState('male')
    state.badges.add(0)

    expect(agent.nextInput({ mapId: gym.id, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: city.id, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: shop.id, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: shop.id, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('confirm')

    state.party.members.push({ speciesId: TOGEPI_EGG_TARGET.speciesId, isEgg: true } as (typeof state.party.members)[number])
    state.flags.add(TOGEPI_EGG_TARGET.receivedFlagId)
    expect(agent.nextInput({ mapId: shop.id, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')

    state.variables.set(TOGEPI_EGG_TARGET.deliveryVariableId, 3)
    expect(() => agent.nextInput({ mapId: city.id, tileX: 1, tileZ: 1, direction: 'south' }, state))
      .toThrow('n’a pas finalisé la variable ROM 16500')
    state.variables.set(TOGEPI_EGG_TARGET.deliveryVariableId, TOGEPI_EGG_TARGET.deliveryVariableValue)
    expect(agent.nextInput({ mapId: city.id, tileX: 1, tileZ: 1, direction: 'south' }, state)).toBeUndefined()
    expect(agent.getCheckpoint()).toEqual({ id: 'togepi-egg-complete', label: 'Œuf de Togepi récupéré' })
  })

  it('fails closed when resumed on an unsupported map after the first badge', () => {
    const agent = createTogepiEggJourneyAgent(addOpeningPrerequisites([]))
    const state = createFieldScriptState('male')
    state.badges.add(0)
    expect(() => agent.nextInput({ mapId: 999, tileX: 0, tileZ: 0, direction: 'south' }, state))
      .toThrow('ne sait pas reprendre depuis la carte ROM 999')
  })
})
