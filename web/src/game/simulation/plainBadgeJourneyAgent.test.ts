import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapOrigin } from '../world/mapCoordinates'
import {
  createPlainBadgeJourneyAgent,
  hasClearedIlexForest,
  isPlainBadgeJourneyReached,
  PLAIN_BADGE_TARGET,
} from './plainBadgeJourneyAgent'

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
): MapEventPreview['objects'][number] {
  const origin = getMapOrigin(map)
  const object = {
    id,
    spriteId,
    movement: 0,
    type: 0,
    eventFlag: 0,
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

function createPlainMaps(): OpeningMapPreview[] {
  const maps = new Map<number, OpeningMapPreview>([
    [180, createMap(180)],
    [136, createMap(136)],
    [74, createMap(74)],
    [100, createMap(100)],
    [117, createMap(117, 60, 90)],
    [171, createMap(171)],
    [38, createMap(38, 32, 40)],
    [331, createMap(331)],
    [76, createMap(76, 32, 40)],
    [112, createMap(112)],
    [137, createMap(137)],
  ])
  const routeMatrix: OpeningMapPreview['matrix'] = {
    matrixIndex: 38,
    name: 'route34-goldenrod',
    width: 2,
    height: 1,
    headers: new Uint16Array([38, 76]),
    altitudes: new Uint8Array([0, 0]),
    modelIds: new Uint16Array([0, 0]),
  }
  maps.get(38)!.matrix = routeMatrix
  maps.get(76)!.matrix = routeMatrix
  addWarp(maps.get(180)!, 1, 1, 136)
  addWarp(maps.get(136)!, 1, 1, 74)
  addWarp(maps.get(74)!, 1, 1, 100)
  addWarp(maps.get(100)!, 1, 1, 117)
  addWarp(maps.get(117)!, 12, 17, 171)
  addWarp(maps.get(171)!, 1, 1, 38)
  addWarp(maps.get(331)!, 1, 1, 38)
  addWarp(maps.get(76)!, 1, 1, 112)
  addWarp(maps.get(76)!, 3, 1, 137)
  addWarp(maps.get(112)!, 1, 0, 76)
  addObject(maps.get(117)!, 0, 25, 62, 1017, 2)
  addObject(maps.get(117)!, 2, 41, 54, 1017, 6)
  addObject(maps.get(117)!, 5, 16, 62, 86, 10000)
  addObject(maps.get(112)!, PLAIN_BADGE_TARGET.radioQuizObjectId, 2, 1, 427, 3)
  addObject(maps.get(137)!, 0, 13, 4, PLAIN_BADGE_TARGET.leader.spriteId, PLAIN_BADGE_TARGET.leader.scriptId)
  return [...maps.values()]
}

function completeHiveAndIlex(state: FieldScriptState): void {
  state.badges.add(1)
  state.flags.add(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.hmReceivedFlagId)
  state.flags.add(PLAIN_BADGE_TARGET.cutTreeFlagId)
  state.inventory.set(PLAIN_BADGE_TARGET.hmItemId, 1)
  state.party.members.push({
    speciesId: 158,
    moves: [{ moveId: PLAIN_BADGE_TARGET.cutMoveId }],
  } as (typeof state.party.members)[number])
}

describe('Plain Badge journey agent', () => {
  it('définit une preuve finale stricte pour Blanche et le Badge Plaine', () => {
    const state = createFieldScriptState('male')
    completeHiveAndIlex(state)
    state.flags.add(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)
    state.badges.add(PLAIN_BADGE_TARGET.badgeIndex)

    expect(PLAIN_BADGE_TARGET.trainerId).toBe(30)
    expect(hasClearedIlexForest(state)).toBe(true)
    expect(isPlainBadgeJourneyReached(state, new Set([30]), PLAIN_BADGE_TARGET.goldenrodGymMapId)).toBe(true)
    expect(isPlainBadgeJourneyReached(state, new Set(), PLAIN_BADGE_TARGET.goldenrodGymMapId)).toBe(false)
    expect(isPlainBadgeJourneyReached(state, new Set([30]), PLAIN_BADGE_TARGET.goldenrodCityMapId)).toBe(false)
  })

  it('exige l’apprentissage réel de Coupe avant de viser l’arbre', () => {
    const maps = createPlainMaps()
    const state = createFieldScriptState('male')
    state.badges.add(1)
    state.flags.add(PLAIN_BADGE_TARGET.firstFarfetchdFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.secondFarfetchdFlagId)
    state.flags.add(PLAIN_BADGE_TARGET.hmReceivedFlagId)
    state.inventory.set(PLAIN_BADGE_TARGET.hmItemId, 1)
    state.party.members.push({ speciesId: 158, moves: [] } as unknown as (typeof state.party.members)[number])
    const agent = createPlainBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 117, tileX: 15, tileZ: 62, direction: 'east' }, state))
      .toEqual({ kind: 'teach-machine', itemId: 420 })
    state.party.members[0]!.moves.push({ moveId: 15 } as (typeof state.party.members)[number]['moves'][number])
    expect(agent.nextInput({ mapId: 117, tileX: 15, tileZ: 62, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 117, tileX: 15, tileZ: 62, direction: 'east' }, state)).toBe('confirm')
  })

  it('enchaîne la Pension, le quiz Radio et ses six réponses natives', () => {
    const maps = createPlainMaps()
    const state = createFieldScriptState('male')
    completeHiveAndIlex(state)
    const agent = createPlainBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 38, tileX: 17, tileZ: 30, direction: 'north' }, state)).toBe('up')
    expect(agent.getCheckpoint().id).toBe('visit-daycare')
    state.variables.set(0x408e, 3)
    expect(agent.nextInput({ mapId: 38, tileX: 31, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 76, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 112, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('radio-card-quiz')
    expect(Array.from({ length: 6 }, () => agent.getChoiceIndex(state))).toEqual([0, 0, 0, 1, 0, 1])
  })

  it('amorce la scène de pleurs après la victoire puis reparle à Blanche', () => {
    const maps = createPlainMaps()
    const state = createFieldScriptState('male')
    completeHiveAndIlex(state)
    state.flags.add(PLAIN_BADGE_TARGET.radioQuizCompleteFlagId)
    const agent = createPlainBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 137, tileX: 13, tileZ: 5, direction: 'north' }, state)).toBe('up')
    agent.notifyTrainerBattleWon(PLAIN_BADGE_TARGET.trainerId)
    expect(agent.nextInput({ mapId: 137, tileX: 13, tileZ: 5, direction: 'north' }, state)).toBe('down')
    expect(agent.getCheckpoint().id).toBe('whitney-cry-scene')
    state.flags.add(PLAIN_BADGE_TARGET.whitneyCrySceneFlagId)
    expect(agent.nextInput({ mapId: 137, tileX: 13, tileZ: 5, direction: 'north' }, state)).toBe('up')
    expect(agent.getCheckpoint().id).toBe(PLAIN_BADGE_TARGET.id)
  })
})
