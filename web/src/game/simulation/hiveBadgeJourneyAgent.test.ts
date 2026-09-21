import { describe, expect, it } from 'vitest'
import type { MapEventPreview, OpeningMapPreview } from '../../ndsTypes'
import { initializeAzaleaGymData } from '../scripts/azaleaGymMechanism'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import { getMapOrigin } from '../world/mapCoordinates'
import {
  createHiveBadgeJourneyAgent,
  hasClearedSlowpokeWell,
  HIVE_BADGE_TARGET,
  isHiveBadgeJourneyReached,
} from './hiveBadgeJourneyAgent'
import { TOGEPI_EGG_TARGET } from './togepiEggJourneyAgent'

function createMap(id: number, width = 6, height = 6): OpeningMapPreview {
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

function connectAdjacent(left: OpeningMapPreview, right: OpeningMapPreview): void {
  const matrix: OpeningMapPreview['matrix'] = {
    matrixIndex: left.id,
    name: `${left.id}-${right.id}`,
    width: 2,
    height: 1,
    headers: new Uint16Array([left.id, right.id]),
    altitudes: new Uint8Array([0, 0]),
    modelIds: new Uint16Array([0, 0]),
  }
  left.matrix = matrix
  right.matrix = matrix
}

function connectAdjacentRoute(route: readonly OpeningMapPreview[]): void {
  const matrix: OpeningMapPreview['matrix'] = {
    matrixIndex: route[0]!.id,
    name: route.map(({ id }) => id).join('-'),
    width: route.length,
    height: 1,
    headers: new Uint16Array(route.map(({ id }) => id)),
    altitudes: new Uint8Array(route.length),
    modelIds: new Uint16Array(route.length),
  }
  for (const map of route) map.matrix = matrix
}

function addWarp(map: OpeningMapPreview, x: number, z: number, targetMapId: number): void {
  const origin = getMapOrigin(map)
  map.events!.warps.push({ x: x + origin.x, z: z + origin.z, header: targetMapId, anchor: 0 })
  map.terrain!.attributes[z * map.terrain!.width + x] = 108
}

function addObject(
  map: OpeningMapPreview,
  id: number,
  x: number,
  z: number,
  spriteId = 290,
  scriptId = 0,
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
    x: x + origin.x,
    z: z + origin.z,
  }
  map.events!.objects.push(object)
  return object
}

function createHiveMaps(): OpeningMapPreview[] {
  const ids = [34, 35, 36, 37, 67, 69, 73, 74, 97, 99, 114, 135, 136, 157, 164, 177, 180]
  const maps = new Map(ids.map((id) => [id, createMap(id, id === 69 ? 20 : 6, id === 69 ? 21 : 6)]))
  connectAdjacentRoute([maps.get(67)!, maps.get(34)!, maps.get(35)!])
  connectAdjacent(maps.get(73)!, maps.get(36)!)
  connectAdjacent(maps.get(37)!, maps.get(74)!)
  addWarp(maps.get(35)!, 1, 1, 97)
  addWarp(maps.get(97)!, 1, 1, 73)
  addWarp(maps.get(36)!, 1, 1, 99)
  addWarp(maps.get(99)!, 1, 1, 37)
  addWarp(maps.get(74)!, 1, 1, 164)
  addWarp(maps.get(74)!, 2, 1, 114)
  addWarp(maps.get(74)!, 3, 1, 136)
  addWarp(maps.get(164)!, 1, 0, 74)
  addWarp(maps.get(114)!, 1, 1, 177)
  addWarp(maps.get(114)!, 2, 1, 74)
  addWarp(maps.get(177)!, 1, 0, 114)
  addWarp(maps.get(136)!, 1, 1, 180)
  addWarp(maps.get(135)!, 1, 1, 73)
  addWarp(maps.get(157)!, 1, 1, 73)
  addWarp(maps.get(69)!, 8, 19, 67)
  addObject(maps.get(164)!, HIVE_BADGE_TARGET.kurtObjectId, 2, 1)
  addObject(maps.get(177)!, HIVE_BADGE_TARGET.protonObjectId, 2, 1)
  addObject(maps.get(180)!, 2, 2, 1, HIVE_BADGE_TARGET.leader.spriteId, HIVE_BADGE_TARGET.leader.scriptId)
  return [...maps.values()]
}

function completeTogepiPrerequisites(state: FieldScriptState): void {
  state.badges.add(0)
  state.party.members.push({ speciesId: TOGEPI_EGG_TARGET.speciesId, isEgg: true } as (typeof state.party.members)[number])
  state.flags.add(TOGEPI_EGG_TARGET.receivedFlagId)
  state.variables.set(TOGEPI_EGG_TARGET.deliveryVariableId, TOGEPI_EGG_TARGET.deliveryVariableValue)
}

describe('Hive Badge journey agent', () => {
  it('enchaîne le chemin ROM de Mauville à Fargas puis au Puits Ramoloss', () => {
    const maps = createHiveMaps()
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    const agent = createHiveBadgeJourneyAgent(maps)

    expect(agent.nextInput({ mapId: 73, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('reach-route-32')
    expect(agent.nextInput({ mapId: 36, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 99, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 37, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 74, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')

    expect(agent.nextInput({ mapId: 164, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 164, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('confirm')
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    expect(agent.nextInput({ mapId: 164, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')

    expect(agent.nextInput({ mapId: 74, tileX: 3, tileZ: 1, direction: 'east' }, state)).toBe('left')
    expect(agent.nextInput({ mapId: 114, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 177, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 177, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('confirm')
    expect(agent.getCheckpoint().id).toBe('defeat-proton')
  })

  it('rejoint Hector, exige les deux flags du Puits et clôt seulement dans son Arène', () => {
    const maps = createHiveMaps()
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    const agent = createHiveBadgeJourneyAgent(maps)

    expect(hasClearedSlowpokeWell(state)).toBe(false)
    expect(() => agent.nextInput({ mapId: 164, tileX: 1, tileZ: 1, direction: 'north' }, state))
      .toThrow("n'a pas posé le flag ROM 425")

    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    expect(agent.nextInput({ mapId: 164, tileX: 1, tileZ: 1, direction: 'north' }, state)).toBe('up')
    expect(agent.nextInput({ mapId: 74, tileX: 3, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 136, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 180, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 180, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('confirm')

    state.badges.add(HIVE_BADGE_TARGET.badgeIndex)
    expect(isHiveBadgeJourneyReached(state, 74)).toBe(false)
    expect(agent.nextInput({ mapId: 180, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBeUndefined()
    expect(agent.getCheckpoint()).toEqual({ id: 'hive-badge-complete', label: 'Badge Essaim obtenu' })
  })

  it('utilise un événement de mécanisme si Hector est physiquement inaccessible', () => {
    const gym = createMap(HIVE_BADGE_TARGET.azaleaGymMapId, 20, 35)
    addObject(gym, 2, 30, 1, HIVE_BADGE_TARGET.leader.spriteId, HIVE_BADGE_TARGET.leader.scriptId)
    gym.events!.coordinateEvents.push({
      scriptId: 3,
      x: 3,
      z: 31,
      width: 1,
      height: 1,
      y: 0,
      expectedValue: 0,
      variableId: 0,
    })
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    state.gymmick.type = 5
    initializeAzaleaGymData(state.gymmick.data)

    const agent = createHiveBadgeJourneyAgent([gym])
    expect(agent.nextInput({ mapId: gym.id, tileX: 3, tileZ: 32, direction: 'north' }, state)).toBe('up')
    expect(agent.getCheckpoint().id).toBe(HIVE_BADGE_TARGET.id)
  })

  it('replanifie un événement non atteint au lieu de l’exclure après un simple demi-tour', () => {
    const gym = createMap(HIVE_BADGE_TARGET.azaleaGymMapId, 20, 35)
    addObject(gym, 2, 30, 1, HIVE_BADGE_TARGET.leader.spriteId, HIVE_BADGE_TARGET.leader.scriptId)
    gym.events!.coordinateEvents.push({
      scriptId: 8,
      x: 15,
      z: 24,
      width: 1,
      height: 1,
      y: 0,
      expectedValue: 0,
      variableId: 0,
    })
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    state.gymmick.type = 5
    initializeAzaleaGymData(state.gymmick.data)
    state.gymmick.data[1] = 5

    const agent = createHiveBadgeJourneyAgent([gym])
    const landing = { mapId: gym.id, tileX: 15, tileZ: 23, direction: 'north' } as const
    expect(agent.nextInput(landing, state)).toBe('down')
    expect(agent.nextInput({ ...landing, direction: 'south' }, state)).toBe('down')
  })

  it('reprend du Centre Pokémon après un blackout dans l’Arène et repart vers Écorcia', () => {
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    const agent = createHiveBadgeJourneyAgent(createHiveMaps())

    for (let tileZ = 13; tileZ <= 18; tileZ += 1) {
      expect(agent.nextInput({ mapId: 69, tileX: 8, tileZ, direction: 'south' }, state)).toBe('down')
    }
    expect(agent.getCheckpoint()).toEqual({
      id: 'return-to-azalea',
      label: 'Rejoindre Écorcia après le blackout',
    })
    expect(agent.nextInput({ mapId: 67, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 34, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 35, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 97, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 73, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 36, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 99, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 37, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 74, tileX: 3, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('enter-azalea-gym')
    expect(agent.nextInput({ mapId: 136, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.nextInput({ mapId: 180, tileX: 1, tileZ: 1, direction: 'east' }, state)).toBe('right')
  })

  it('réessaie après blackout un événement de mécanisme mémorisé dans l’Arène', () => {
    const gym = createMap(HIVE_BADGE_TARGET.azaleaGymMapId, 20, 35)
    addObject(gym, 2, 30, 1, HIVE_BADGE_TARGET.leader.spriteId, HIVE_BADGE_TARGET.leader.scriptId)
    gym.events!.coordinateEvents.push({
      scriptId: 3,
      x: 3,
      z: 31,
      width: 1,
      height: 1,
      y: 0,
      expectedValue: 0,
      variableId: 0,
    })
    const maps = createHiveMaps().filter(({ id }) => id !== HIVE_BADGE_TARGET.azaleaGymMapId)
    maps.push(gym)
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    state.flags.add(HIVE_BADGE_TARGET.kurtDepartedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.rocketsDefeatedFlagId)
    state.flags.add(HIVE_BADGE_TARGET.gymGuardRemovedFlagId)
    state.gymmick.type = 5
    initializeAzaleaGymData(state.gymmick.data)
    const agent = createHiveBadgeJourneyAgent(maps)
    const trigger = { mapId: gym.id, tileX: 3, tileZ: 32, direction: 'north' } as const

    expect(agent.nextInput(trigger, state)).toBe('up')
    expect(() => agent.nextInput({
      mapId: gym.id,
      tileX: 3,
      tileZ: 31,
      direction: 'north',
    }, state)).toThrow('Aucun événement ROM de progression')

    expect(agent.nextInput({ mapId: 69, tileX: 8, tileZ: 13, direction: 'south' }, state)).toBe('down')
    expect(agent.nextInput(trigger, state)).toBe('up')
  })

  it('échoue explicitement sur une carte non bornée au lieu d’explorer au hasard', () => {
    const state = createFieldScriptState('male')
    completeTogepiPrerequisites(state)
    const agent = createHiveBadgeJourneyAgent(createHiveMaps())

    expect(() => agent.nextInput({ mapId: 999, tileX: 0, tileZ: 0, direction: 'south' }, state))
      .toThrow('ne sait pas reprendre depuis la carte ROM 999')
  })

  it('reprend après une livraison Togepi enregistrée même si l’Œuf a depuis éclos ou été rangé', () => {
    const state = createFieldScriptState('male')
    state.badges.add(0)
    state.flags.add(TOGEPI_EGG_TARGET.receivedFlagId)
    state.variables.set(TOGEPI_EGG_TARGET.deliveryVariableId, TOGEPI_EGG_TARGET.deliveryVariableValue)

    const agent = createHiveBadgeJourneyAgent(createHiveMaps())
    expect(agent.nextInput({ mapId: 157, tileX: 0, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('leave-violet-shop')
    expect(agent.nextInput({ mapId: 73, tileX: 5, tileZ: 1, direction: 'east' }, state)).toBe('right')
    expect(agent.getCheckpoint().id).toBe('reach-route-32')
  })
})
