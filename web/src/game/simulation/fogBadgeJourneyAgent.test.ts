import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapOrigin } from '../world/mapCoordinates'
import {
  createFogBadgeJourneyAgent,
  FOG_BADGE_TARGET,
  hasReleasedLegendaryBeasts,
  isFogBadgeJourneyReached,
} from './fogBadgeJourneyAgent'
import { PLAIN_BADGE_TARGET } from './plainBadgeJourneyAgent'

function createMap(id: number, width = 32, height = 40): OpeningMapPreview {
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

function addWarp(map: OpeningMapPreview, x: number, z: number, targetMapId: number): void {
  const origin = getMapOrigin(map)
  map.events!.warps.push({ x: origin.x + x, z: origin.z + z, header: targetMapId, anchor: 0 })
  map.terrain!.attributes[z * map.terrain!.width + x] = 108
}

function addObject(
  map: OpeningMapPreview,
  id: number,
  x: number,
  z: number,
  spriteId: number,
  scriptId: number,
  eventFlag = 0,
): MapEventPreview['objects'][number] {
  const origin = getMapOrigin(map)
  const object = {
    id,
    spriteId,
    movement: 0,
    type: 0,
    eventFlag,
    scriptId,
    facingDirection: 0,
    xRange: 0,
    zRange: 0,
    x: origin.x + x,
    z: origin.z + z,
  }
  map.events!.objects.push(object)
  return object
}

function createFogMaps(): OpeningMapPreview[] {
  const maps = [137, 76, 184, 101, 39, 40, 41, 78, 7, 217, 80]
    .map((id) => createMap(id, id === 80 ? 16 : 32, 40))
  const byId = new Map(maps.map((map) => [map.id, map]))
  addWarp(byId.get(137)!, 1, 1, 76)
  addWarp(byId.get(76)!, 1, 1, 184)
  addWarp(byId.get(76)!, 3, 1, 101)
  addWarp(byId.get(184)!, 1, 1, 76)
  addWarp(byId.get(101)!, 1, 1, 39)
  addWarp(byId.get(78)!, 1, 1, 7)
  addWarp(byId.get(78)!, 3, 1, 80)
  addWarp(byId.get(7)!, 1, 1, 78)
  addWarp(byId.get(7)!, 3, 1, 217)
  addWarp(byId.get(217)!, 1, 1, 7)
  addObject(byId.get(184)!, 0, 2, 1, 427, 1)
  addObject(byId.get(40)!, 4, 2, 1, 381, 1, 450)
  addObject(byId.get(7)!, 0, 4, 1, 148, 0, 454)
  addObject(byId.get(80)!, 1, 4, 0, 355, 2)
  byId.get(80)!.events!.coordinateEvents.push({
    scriptId: 3,
    x: 2,
    z: 1,
    width: 1,
    height: 1,
    y: 0,
    expectedValue: 0,
    variableId: 0x4109,
  })
  return maps
}

function completePlain(state: FieldScriptState): void {
  state.badges.add(PLAIN_BADGE_TARGET.badgeIndex)
  state.flags.add(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.hmReceivedFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.cutTreeFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)
}

describe('Fog Badge journey agent', () => {
  it('définit une preuve finale stricte pour Simularbre, les fauves et Mortimer', () => {
    const state = createFieldScriptState('male')
    completePlain(state)
    state.inventory.set(FOG_BADGE_TARGET.squirtBottleItemId, 1)
    state.flags.add(FOG_BADGE_TARGET.sudowoodoFlagId)
    for (const flagId of FOG_BADGE_TARGET.legendaryBeastFlagIds) state.flags.add(flagId)
    state.badges.add(FOG_BADGE_TARGET.badgeIndex)

    expect(hasReleasedLegendaryBeasts(state)).toBe(true)
    expect(isFogBadgeJourneyReached(state, new Set([30, 31]), FOG_BADGE_TARGET.ecruteakGymMapId)).toBe(true)
    expect(isFogBadgeJourneyReached(state, new Set([30]), FOG_BADGE_TARGET.ecruteakGymMapId)).toBe(false)
    expect(isFogBadgeJourneyReached(state, new Set([30, 31]), FOG_BADGE_TARGET.ecruteakCityMapId)).toBe(false)
  })

  it('va d’abord chercher le Carapuce à O puis remonte vers la Route 35', () => {
    const maps = createFogMaps()
    const state = createFieldScriptState('male')
    completePlain(state)
    const floristAgent = createFogBadgeJourneyAgent(maps)

    expect(floristAgent.nextInput({ mapId: 76, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(floristAgent.getCheckpoint().id).toBe('enter-flower-shop')

    state.inventory.set(FOG_BADGE_TARGET.squirtBottleItemId, 1)
    const routeAgent = createFogBadgeJourneyAgent(maps)
    expect(routeAgent.nextInput({ mapId: 76, tileX: 2, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(routeAgent.getCheckpoint().id).toBe('reach-route-35-gate')
  })

  it('enchaîne Eusine, le rival et la libération des fauves', () => {
    const maps = createFogMaps()
    const state = createFieldScriptState('male')
    completePlain(state)
    state.inventory.set(FOG_BADGE_TARGET.squirtBottleItemId, 1)
    state.flags.add(FOG_BADGE_TARGET.sudowoodoFlagId)
    const agent = createFogBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 7, tileX: 19, tileZ: 24, direction: 'north' }, state)).toBe('up')
    expect(agent.getCheckpoint().id).toBe('meet-eusine')
    state.variables.set(FOG_BADGE_TARGET.eusineSceneVariableId, 1)
    agent.invalidatePlan()
    expect(agent.nextInput({ mapId: 7, tileX: 3, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('defeat-burned-tower-rival')
    state.flags.add(FOG_BADGE_TARGET.towerRivalFlagId)
    agent.invalidatePlan()
    expect(agent.nextInput({ mapId: 7, tileX: 2, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('reach-legendary-beasts')
  })

  it('évite les coordonnées de chute sur le chemin de Mortimer', () => {
    const maps = createFogMaps()
    const state = createFieldScriptState('male')
    completePlain(state)
    state.inventory.set(FOG_BADGE_TARGET.squirtBottleItemId, 1)
    state.flags.add(FOG_BADGE_TARGET.sudowoodoFlagId)
    for (const flagId of FOG_BADGE_TARGET.legendaryBeastFlagIds) state.flags.add(flagId)
    const agent = createFogBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 80, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('up')
    expect(agent.getCheckpoint().id).toBe('fog-badge')
  })
})
