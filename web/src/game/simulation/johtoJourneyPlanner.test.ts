import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createJohtoJourneyPlanner,
  findInputsToAdjacentMap,
  findInputsToBackground,
  findInputsToNpc,
  findInputsToTile,
  findInputsToWarp,
  isJohtoJourneyTargetReached,
  ZEPHYR_BADGE_TARGET,
} from './johtoJourneyPlanner'

function createMap(id: number, width = 5, height = 4): OpeningMapPreview {
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

function createObject(id: number, x: number, z: number, spriteId = 290, scriptId = 0): MapEventPreview['objects'][number] {
  return {
    id,
    spriteId,
    movement: 0,
    type: 0,
    eventFlag: 0,
    scriptId,
    facingDirection: 0,
    xRange: 0,
    zRange: 0,
    x,
    z,
  }
}

describe('Johto journey planner', () => {
  it('defines the stable first-badge route while leaving battle-20 proof to the journey audit', () => {
    const state = createFieldScriptState('male')

    expect(ZEPHYR_BADGE_TARGET).toMatchObject({
      id: 'zephyr-badge',
      routeStartMapId: 61,
      destinationMapId: 135,
      leader: { spriteId: 352, scriptId: 2 },
      badgeIndex: 0,
      trainerId: 20,
    })
    expect(ZEPHYR_BADGE_TARGET.route.map(({ kind, targetMapId }) => `${kind}:${targetMapId}`)).toEqual([
      'warp:60',
      'adjacent-map:33',
      'adjacent-map:67',
      'adjacent-map:34',
      'adjacent-map:35',
      'warp:97',
      'warp:73',
      'warp:135',
    ])
    expect(isJohtoJourneyTargetReached(state, ZEPHYR_BADGE_TARGET)).toBe(false)
    state.badges.add(0)
    state.trainerFlags.add(47)
    expect(isJohtoJourneyTargetReached(state, ZEPHYR_BADGE_TARGET)).toBe(true)
    expect(state.trainerFlags.has(ZEPHYR_BADGE_TARGET.trainerId)).toBe(false)
  })

  it('plans a real warp movement and ignores a warp tile blocked by an object', () => {
    const map = createMap(61)
    map.events!.warps.push(
      { x: 1, z: 0, header: 60, anchor: 0 },
      { x: 3, z: 1, header: 60, anchor: 1 },
    )
    map.events!.objects.push(createObject(0, 1, 0))
    setBehavior(map, 1, 0, 110)
    setBehavior(map, 3, 1, 108)

    expect(findInputsToWarp(
      [map],
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'north' },
      60,
      createFieldScriptState('male'),
    )).toEqual(['right', 'right'])
  })

  it('anchors background and NPC interactions before confirmation', () => {
    const backgroundMap = createMap(61)
    backgroundMap.events!.backgroundEvents = 1
    backgroundMap.events!.backgrounds.push({ scriptId: 7, type: 0, x: 2, z: 1, y: 0, direction: 0 })
    const npcMap = createMap(135)
    npcMap.events!.objects.push(createObject(4, 2, 1, 352, 2))
    const state = createFieldScriptState('male')

    expect(findInputsToBackground(
      [backgroundMap],
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'north' },
      7,
      state,
    )).toEqual(['right', 'confirm'])
    expect(findInputsToNpc(
      [npcMap],
      { mapId: 135, tileX: 1, tileZ: 1, direction: 'north' },
      4,
      state,
    )).toEqual(['right', 'confirm'])
  })

  it('reaches one exact puzzle approach tile without crossing a warp', () => {
    const map = createMap(117, 6, 5)
    map.events!.warps.push({ x: 5, z: 1, header: 171, anchor: 0 })
    map.events!.objects.push(createObject(0, 3, 1))
    setBehavior(map, 5, 1, 108)

    expect(findInputsToTile(
      [map],
      { mapId: 117, tileX: 1, tileZ: 1, direction: 'south' },
      { tileX: 3, tileZ: 2 },
      createFieldScriptState('male'),
    )).toEqual(['down', 'right', 'right'])
  })

  it('can avoid a coordinate script that would undo a puzzle state', () => {
    const map = createMap(117)
    map.events!.coordinateEvents.push({
      scriptId: 7,
      x: 2,
      z: 1,
      width: 1,
      height: 1,
      y: 0,
      variableId: 0x4099,
      expectedValue: 1,
    })
    const state = createFieldScriptState('male')
    state.variables.set(0x4099, 1)

    expect(findInputsToTile(
      [map],
      { mapId: 117, tileX: 1, tileZ: 1, direction: 'east' },
      { tileX: 3, tileZ: 1 },
      state,
      { avoidCoordinateScriptIds: new Set([7]) },
    )).toEqual(['up', 'right', 'right', 'down'])
  })

  it('plans a direct field-map seam from shared matrix data', () => {
    const matrix: OpeningMapPreview['matrix'] = {
      matrixIndex: 71,
      name: 'shared-field',
      width: 2,
      height: 1,
      headers: new Uint16Array([60, 61]),
      altitudes: new Uint8Array([0, 0]),
      modelIds: new Uint16Array([0, 0]),
    }
    const leftMap = createMap(60, 32, 32)
    const rightMap = createMap(61, 32, 32)
    leftMap.matrix = matrix
    rightMap.matrix = matrix

    expect(findInputsToAdjacentMap(
      [leftMap, rightMap],
      { mapId: 60, tileX: 31, tileZ: 1, direction: 'east' },
      61,
      createFieldScriptState('male'),
    )).toEqual(['right'])
  })

  it('exposes a stateless browser-safe Zephyr objective with inputs and milestone state', () => {
    const lab = createMap(61)
    lab.events!.warps.push({ x: 2, z: 1, header: 60, anchor: 0 })
    setBehavior(lab, 2, 1, 108)
    const gym = createMap(135)
    gym.events!.objects.push(createObject(9, 2, 1, 352, 2))
    const planner = createJohtoJourneyPlanner([lab, gym])
    const state = createFieldScriptState('male')

    expect(planner.getMilestone(state)).toEqual({
      id: 'zephyr-badge',
      label: 'Battre Albert et recevoir le Badge Zéphyr',
      reached: false,
    })
    expect(planner.planInputs(
      { mapId: 61, tileX: 1, tileZ: 1, direction: 'east' },
      state,
    )).toEqual(['right'])
    expect(planner.planInputs(
      { mapId: 135, tileX: 1, tileZ: 1, direction: 'east' },
      state,
    )).toEqual(['right', 'confirm'])

    state.badges.add(0)
    expect(planner.getMilestone(state).reached).toBe(true)
    expect(planner.planInputs(
      { mapId: 135, tileX: 1, tileZ: 1, direction: 'east' },
      state,
    )).toBeUndefined()
  })
})
