import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import { createFieldInputSimulator } from './fieldInputSimulator'
import type { HgssWildEncounterData } from '../../rom/encounters/wildEncounterData'
import { hgssWarpMetatileBehaviors } from '../world/hgssWarpActivation'

function createInputMap(): OpeningMapPreview {
  const bytes = new Uint8Array(4)
  new DataView(bytes.buffer).setUint16(0, 167, true)
  new DataView(bytes.buffer).setUint16(2, 2, true)
  return {
    id: 1,
    label: 'Carte ROM de test',
    header: { mapId: 1, mapSection: 126, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes, headerSize: 0, entryOffsets: [0] },
    initScripts: [],
    messages: {},
    matrix: {
      matrixIndex: 1,
      name: 'test',
      width: 1,
      height: 1,
      headers: new Uint16Array([1]),
      altitudes: new Uint8Array([0]),
      modelIds: new Uint16Array([1]),
    },
    terrain: { modelId: 1, width: 2, height: 1, attributes: new Uint16Array([0, 0]) },
    events: {
      backgroundEvents: 0,
      backgrounds: [],
      objects: [],
      warps: [],
      coordinateEvents: [{ scriptId: 1, x: 1, z: 0, width: 1, height: 1, y: 0, expectedValue: 0, variableId: 0x4000 }],
    },
  }
}

function addStateScript(map: OpeningMapPreview, scriptId: number, variableId: number, value: number): void {
  const offset = map.fieldScripts.bytes.byteLength
  const bytes = new Uint8Array(offset + 8)
  bytes.set(map.fieldScripts.bytes)
  const view = new DataView(bytes.buffer)
  view.setUint16(offset, 41, true)
  view.setUint16(offset + 2, variableId, true)
  view.setUint16(offset + 4, value, true)
  view.setUint16(offset + 6, 2, true)
  map.fieldScripts.bytes = bytes
  map.fieldScripts.entryOffsets[scriptId - 1] = offset
}

function createSoundMarkerScript(sequenceId: number, variableId: number, value: number): Uint8Array {
  const bytes = new Uint8Array(12)
  const view = new DataView(bytes.buffer)
  view.setUint16(0, 73, true)
  view.setUint16(2, sequenceId, true)
  view.setUint16(4, 41, true)
  view.setUint16(6, variableId, true)
  view.setUint16(8, value, true)
  view.setUint16(10, 2, true)
  return bytes
}

describe('field input simulator', () => {
  it('synchronise le MapObject follower headless avant les scripts init', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 730, true)
    view.setUint16(2, 0x4001, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    map.initScripts = [{ type: 'onLoad', scriptId: 1 }]
    const state = createFieldScriptState('male', '', { followMonActive: true })

    const simulator = createFieldInputSimulator([map], state, { mapId: 1, tileX: 0, tileZ: 0 })

    expect(simulator.getWorld().getFollowerState()).toBeDefined()
    expect(state.variables.get(0x4001)).toBe(1)
  })

  it('rejoue un pas bloqué une fois pour échanger sa place avec le follower', () => {
    const state = createFieldScriptState('male', '', { followMonActive: true })
    const simulator = createFieldInputSimulator(
      [createInputMap()],
      state,
      { mapId: 1, tileX: 1, tileZ: 0, direction: 'east' },
    )

    expect(simulator.input('left')).toEqual([
      { kind: 'blocked', reason: 'follower', tileX: 0, tileZ: 0, attribute: undefined },
    ])
    expect(simulator.input('left')).toEqual([
      { kind: 'moved', mapId: 1, tileX: 0, tileZ: 0 },
    ])
    expect(simulator.getWorld().getFollowerState()).toMatchObject({ tileX: 1, tileZ: 0 })
  })

  it('prepares a ROM land encounter after the native post-map inhibition without starting battle', () => {
    const map = createInputMap()
    map.header.wildEncounterBank = 1
    map.terrain = { modelId: 1, width: 5, height: 1, attributes: new Uint16Array([2, 2, 2, 2, 2]) }
    map.events = { backgroundEvents: 0, backgrounds: [], objects: [], warps: [], coordinateEvents: [] }
    const catalog = createPokemonTestCatalog()
    const rngValues = [0, 0, 98, 7, 1, 0, 7, 0, 0xffff, 0, 96]
    const state = createFieldScriptState('male', 'JO', {
      pokemonRuntime: {
        catalog,
        rng: { getSeed: () => 0, nextU16: () => rngValues.shift() ?? 99 },
        trainer: { id: 1, name: 'JO', gender: 'male' },
        language: 3,
        gameVersion: 7,
        now: () => new Date(2026, 2, 12, 9),
      },
    })
    const land = Array.from({ length: 12 }, (_, index) => ({ speciesId: index === 10 ? 152 : 155, level: index + 2 }))
    const encounters = {
      bankId: 1,
      rates: { walking: 25 },
      land: { morning: land, day: land, night: land },
    } as HgssWildEncounterData
    const simulator = createFieldInputSimulator([map], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' }, {
      wildEncounterCatalog: [undefined, encounters] as unknown as HgssWildEncounterData[],
    })

    expect(simulator.input('right')).toEqual([{ kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 }])
    expect(simulator.input('right')).toEqual([{ kind: 'moved', mapId: 1, tileX: 2, tileZ: 0 }])
    expect(simulator.input('right')).toEqual([{ kind: 'moved', mapId: 1, tileX: 3, tileZ: 0 }])
    expect(simulator.input('right')).toMatchObject([
      { kind: 'moved', mapId: 1, tileX: 4, tileZ: 0 },
      {
        kind: 'wildEncounterPrepared',
        encounter: { bankId: 1, slotIndex: 10, time: 'morning', speciesId: 152, speciesName: 'GERMIGNON', level: 12 },
        rateRoll: { triggered: true, modifiedRate: 20, firstRoll: 0, secondRoll: 0 },
        pokemon: {
          speciesId: 152,
          level: 12,
          personality: 7,
          heldItemId: 0,
        },
      },
    ])
    expect(simulator.hasActiveScript()).toBe(false)
    expect(simulator.getPreparedWildEncounter()).toMatchObject({ kind: 'wildEncounterPrepared' })
    expect(simulator.isWaitingForBattle()).toBe(true)
    expect(simulator.input('left')).toEqual([])
    expect(simulator.submitWildEncounterResult('escaped')).toEqual([{
      kind: 'wildEncounterResolved',
      result: 'escaped',
      method: 'land',
      speciesId: 152,
    }])
    expect(simulator.getPreparedWildEncounter()).toBeUndefined()
    expect(simulator.isWaitingForBattle()).toBe(false)
    expect(simulator.input('left')).toEqual([{ kind: 'moved', mapId: 1, tileX: 3, tileZ: 0 }])
    expect(() => simulator.submitWildEncounterResult('won')).toThrow('Aucune rencontre sauvage')
  })

  it('replays movement, collision, a coordinate trigger, and starter choice through player inputs', () => {
    const state = createFieldScriptState('male', 'JO', {
      pokemonRuntime: {
        catalog: createPokemonTestCatalog(),
        rng: createHgssLcrng(0),
        trainer: { id: 0x12345678, name: 'JO', gender: 'male' },
        language: 3,
        gameVersion: 7,
        now: () => new Date(2026, 2, 12),
      },
    })
    const simulator = createFieldInputSimulator([createInputMap()], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })

    expect(simulator.input('up')).toEqual([{ kind: 'blocked', reason: 'bounds', tileX: 0, tileZ: -1, attribute: undefined }])
    expect(simulator.input('right')).toEqual(expect.arrayContaining([
      { kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 },
      expect.objectContaining({ kind: 'choice' }),
    ]))
    expect(simulator.getChoiceIndex()).toBe(0)
    expect(simulator.input('down')).toEqual([{ kind: 'choiceCursor', index: 1 }])
    simulator.input('confirm')

    expect(simulator.getFieldState().starterChoice).toBe(1)
    expect(simulator.getFieldState().party.members[0]).toMatchObject({
      speciesId: 155,
      level: 5,
      origin: { metLocation: 126, metLevel: 5, metTerrain: 12 },
    })
    expect(simulator.getHistory()).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: 'blocked', reason: 'bounds' }),
      expect.objectContaining({ kind: 'choice' }),
    ]))
  })

  it('settles a ROM screen fade before continuing without player input', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 174, true)
    view.setUint16(2, 8, true)
    view.setUint16(4, 1, true)
    view.setUint16(6, 2, true)
    view.setUint16(8, 0x7fff, true)
    view.setUint16(10, 175, true)
    view.setUint16(12, 41, true)
    view.setUint16(14, 0x4000, true)
    view.setUint16(16, 7, true)
    view.setUint16(18, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([map], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })

    expect(simulator.input('right')).toEqual(expect.arrayContaining([
      { kind: 'screenFade', durationFrames: 8, type: 2, color: 0x7fff },
    ]))
    expect(simulator.settle()).toEqual(expect.arrayContaining([
      { kind: 'waiting', waitFor: 'timer', frames: 8 },
      { kind: 'ended' },
    ]))
    expect(state.variables.get(0x4000)).toBe(7)
    expect(simulator.hasActiveScript()).toBe(false)
  })

  it('acquitte immédiatement la variable de complétion de ScrCmd_560 en headless', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 560, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 0x5000, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([map], state, {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    })

    expect(simulator.input('right')).toEqual([
      { kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 },
      { kind: 'fieldMoveEffect', mode: 0, completionVariable: 0x5000 },
      { kind: 'ended' },
    ])
    expect(state.variables.get(0x5000)).toBe(1)
    expect(simulator.hasActiveScript()).toBe(false)
  })

  it('keeps a ROM battle suspended until its result is submitted', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 213, true)
    view.setUint16(2, 37, true)
    view.setUint16(4, 0, true)
    bytes[6] = 1
    bytes[7] = 0
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([map], state, {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    })

    expect(simulator.input('right')).toEqual(expect.arrayContaining([
      { kind: 'battle', battle: { kind: 'trainer', trainerId: 37, trainerParameter: 0, encounterType: 1, battleParameter: 0 } },
    ]))
    expect(simulator.isWaitingForBattle()).toBe(true)
    expect(simulator.hasWonTrainerBattle(37)).toBe(false)
    expect(simulator.settle()).toEqual([])
    expect(simulator.submitBattleResult(true)).toEqual([{ kind: 'ended' }])
    expect(simulator.hasWonTrainerBattle(37)).toBe(true)
    expect(simulator.getWonTrainerBattleIds()).toEqual([37])
    expect(state.trainerFlags.has(37)).toBe(false)
    expect(simulator.isWaitingForBattle()).toBe(false)
    expect(simulator.hasActiveScript()).toBe(false)
  })

  it('does not count a lost trainer battle as an observed victory', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 213, true)
    view.setUint16(2, 20, true)
    view.setUint16(4, 0, true)
    bytes[6] = 0
    bytes[7] = 0
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const simulator = createFieldInputSimulator([map], createFieldScriptState('male'), {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    })

    simulator.input('right')
    simulator.submitBattleResult(false)

    expect(simulator.hasWonTrainerBattle(20)).toBe(false)
    expect(simulator.getWonTrainerBattleIds()).toEqual([])
  })

  it('exécute un blackout ROM puis les init, le suivi Centre Pokémon et le script interrompu dans cet ordre', () => {
    const source = createInputMap()
    const interruptedMarker = createSoundMarkerScript(3003, 0x5002, 3)
    const sourceScript = new Uint8Array(2 + interruptedMarker.byteLength)
    new DataView(sourceScript.buffer).setUint16(0, 219, true)
    sourceScript.set(interruptedMarker, 2)
    source.fieldScripts = { bank: 1, bytes: sourceScript, headerSize: 0, entryOffsets: [0] }

    const destination = createInputMap()
    destination.id = 69
    destination.header = { ...destination.header, mapId: 69 }
    destination.matrix = { ...destination.matrix, headers: new Uint16Array([69]) }
    destination.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [] }
    destination.fieldScripts = {
      bank: 69,
      bytes: createSoundMarkerScript(3001, 0x5000, 1),
      headerSize: 0,
      entryOffsets: [0],
    }
    destination.initScripts = [{ type: 'onTransition', scriptId: 1 }]
    const standardEntryOffsets: number[] = []
    standardEntryOffsets[2013 - 2000] = 0
    destination.standardScripts = {
      bank: 3,
      baseScriptId: 2000,
      bytes: createSoundMarkerScript(3002, 0x5001, 2),
      headerSize: 0,
      entryOffsets: standardEntryOffsets,
      messages: {},
    }

    const pokemon = createCanonicalPokemon(createPokemonTestCatalog(), {
      speciesId: 152,
      level: 5,
      rng: createHgssLcrng(1),
      personality: { kind: 'fixed', value: 1 },
      individualValues: { kind: 'fixed', value: 0 },
      originalTrainer: { id: 1, name: 'JO', gender: 'male' },
      origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 1 },
      ballId: 4,
      moveIds: [33],
    })
    const state = createFieldScriptState('male', 'JO', { party: [pokemon], followMonActive: true })
    const destinationLookups: number[] = []
    const spawnLookups: number[] = []
    const simulator = createFieldInputSimulator([source, destination], state, {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    }, {
      blackoutSpawnForMapResolver(mapId) {
        spawnLookups.push(mapId)
        return mapId === 1 ? 2 : undefined
      },
      blackoutDestinationResolver(spawnId) {
        destinationLookups.push(spawnId)
        return { spawnId, mapId: 69, x: 8, z: 13, direction: 'north', followup: 'pokemonCenter' }
      },
    })
    const partyMember = state.party.members[0]!
    partyMember.currentHp = 0
    partyMember.status = 4
    partyMember.moves[0]!.pp = 0
    state.gymmick.type = 5
    state.gymmick.data.fill(0xaa)
    state.followMonMovementPaused = true
    expect(simulator.getWorld().getFollowerState()).toBeDefined()

    expect(simulator.input('right')).toEqual([
      { kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 },
      { kind: 'blackout' },
      { kind: 'moved', mapId: 69, tileX: 8, tileZ: 13 },
      { kind: 'soundEffect', action: 'play', sequenceId: 3001 },
    ])
    expect(destinationLookups).toEqual([2])
    expect(spawnLookups).toEqual([1, 69])
    expect(simulator.getWorld().getState()).toMatchObject({
      map: { id: 69 },
      tileX: 8,
      tileZ: 13,
      direction: 'north',
    })
    expect(partyMember).toMatchObject({ currentHp: partyMember.stats.hp, status: 0 })
    expect(partyMember.moves[0]!.pp).toBe(partyMember.moves[0]!.maxPp)
    expect(state.gymmick.type).toBe(0)
    expect([...state.gymmick.data]).toEqual(Array(0x20).fill(0))
    expect(state.followMonActive).toBe(false)
    expect(state.followMonMovementPaused).toBe(false)
    expect(simulator.getWorld().getFollowerState()).toBeUndefined()
    expect(state.variables.get(0x5000)).toBeUndefined()

    expect(simulator.settle()).toEqual([{ kind: 'soundEffect', action: 'play', sequenceId: 3002 }])
    expect(state.variables.get(0x5000)).toBe(1)
    expect(state.variables.get(0x5001)).toBeUndefined()
    expect(simulator.settle()).toEqual([{ kind: 'soundEffect', action: 'play', sequenceId: 3003 }])
    expect(state.variables.get(0x5001)).toBe(2)
    expect(state.variables.get(0x5002)).toBeUndefined()
    expect(simulator.settle()).toEqual([{ kind: 'ended' }])
    expect(state.variables.get(0x5002)).toBe(3)
    expect(simulator.hasActiveScript()).toBe(false)
    expect(simulator.getHistory().flatMap((event) => (
      event.kind === 'soundEffect' && event.action === 'play' ? [event.sequenceId] : []
    ))).toEqual([3001, 3002, 3003])
  })

  it('starts the shared ROM trainer-approach script when a trainer sees the player', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 213, true)
    view.setUint16(2, 37, true)
    view.setUint16(4, 0, true)
    bytes[6] = 1
    bytes[7] = 0
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [] }
    map.fieldScripts.entryOffsets[3738] = 0
    map.terrain = { modelId: 1, width: 5, height: 1, attributes: new Uint16Array(5) }
    map.events = {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      warps: [],
      objects: [{
        id: 7,
        spriteId: 1,
        movement: 0,
        type: 1,
        eventFlag: 0,
        scriptId: 3036,
        facingDirection: 2,
        parameters: [4, 0, 0],
        xRange: 0,
        zRange: 0,
        x: 4,
        z: 0,
      }],
    }
    const simulator = createFieldInputSimulator([map], createFieldScriptState('male'), {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    })

    expect(simulator.input('right')).toEqual(expect.arrayContaining([
      { kind: 'battle', battle: { kind: 'trainer', trainerId: 37, trainerParameter: 0, encounterType: 1, battleParameter: 0 } },
    ]))
    expect(simulator.getFieldState().engagedTrainers).toEqual([{
      objectId: 7,
      trainerId: 37,
      direction: 'west',
      distance: 4,
      encounterType: 0,
    }])
    expect(simulator.isWaitingForBattle()).toBe(true)
  })

  it('rejoue les scripts onLoad avant de reprendre un combat terrain suspendu', () => {
    const map = createInputMap()
    const bytes = new Uint8Array(38)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 30, true)
    view.setUint16(2, 0x345, true)
    view.setUint16(4, 589, true)
    view.setUint16(6, 152, true)
    view.setUint16(8, 5, true)
    bytes[10] = 0
    view.setUint16(11, 41, true)
    view.setUint16(13, 0x5000, true)
    view.setUint16(15, 9, true)
    view.setUint16(17, 2, true)
    view.setUint16(19, 32, true)
    view.setUint16(21, 0x345, true)
    view.setUint16(23, 29, true)
    bytes[25] = 1
    view.setInt32(26, 2, true)
    view.setUint16(30, 2, true)
    view.setUint16(32, 101, true)
    view.setUint16(34, 7, true)
    view.setUint16(36, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0, 19] }
    map.initScripts = [{ type: 'onLoad', scriptId: 2 }]
    const simulator = createFieldInputSimulator([map], createFieldScriptState('male'), {
      mapId: 1,
      tileX: 0,
      tileZ: 0,
      direction: 'east',
    })

    expect(simulator.input('right')).toEqual(expect.arrayContaining([
      { kind: 'battle', battle: { kind: 'wild', speciesId: 152, level: 5, battleParameter: 0 } },
    ]))
    expect(simulator.getFieldState().hiddenObjectIds.has(7)).toBe(false)

    expect(simulator.submitBattleResult(true)).toEqual([
      { kind: 'objectVisibility', objectId: 7, visible: false },
      { kind: 'ended' },
    ])
    expect(simulator.getFieldState().hiddenObjectIds.has(7)).toBe(true)
    expect(simulator.getFieldState().variables.get(0x5000)).toBe(9)
  })

  it('enters doors through movement and does not reactivate an arrival door with confirm', () => {
    const source = createInputMap()
    source.id = 1
    source.matrix.headers = new Uint16Array([1])
    source.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 0, header: 2, anchor: 0 }] }
    source.terrain!.attributes[1] = hgssWarpMetatileBehaviors.warpEast
    const destination = createInputMap()
    destination.id = 2
    destination.matrix = { ...destination.matrix, headers: new Uint16Array([2]) }
    destination.terrain = { modelId: 2, width: 2, height: 1, attributes: new Uint16Array([0, 0x8000]) }
    destination.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 0, z: 0, header: 1, anchor: 0 }] }
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([source, destination], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })
    state.hiddenObjectIds.add(7)

    expect(simulator.input('right')).toEqual([
      { kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 },
      { kind: 'moved', mapId: 2, tileX: 0, tileZ: 0 },
    ])
    expect(state.hiddenObjectIds.has(7)).toBe(false)
    expect(simulator.input('confirm')).toEqual([])
    expect(simulator.input('right')).toEqual([{ kind: 'blocked', reason: 'terrain', tileX: 1, tileZ: 0, attribute: 0x8000 }])
    expect(simulator.getWorld().getState()).toMatchObject({ map: { id: 2 }, tileX: 0, tileZ: 0 })
  })

  it('runs transition, load, and resume scripts in native order when entering a map', () => {
    const source = createInputMap()
    source.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 0, header: 2, anchor: 0 }] }
    source.terrain!.attributes[1] = hgssWarpMetatileBehaviors.warpEast
    const destination = createInputMap()
    destination.id = 2
    destination.matrix = { ...destination.matrix, headers: new Uint16Array([2]) }
    destination.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 0, z: 0, header: 1, anchor: 0 }] }
    destination.fieldScripts = { bank: 2, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] }
    addStateScript(destination, 1, 0x5000, 1)
    addStateScript(destination, 2, 0x5000, 2)
    addStateScript(destination, 3, 0x5000, 3)
    destination.initScripts = [
      { type: 'onResume', scriptId: 3 },
      { type: 'onLoad', scriptId: 2 },
      { type: 'onTransition', scriptId: 1 },
    ]
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([source, destination], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })

    simulator.input('right')

    expect(state.variables.get(0x5000)).toBe(3)
  })

  it('resumes the ROM script after ScrCmd_Warp so its completion flag is not lost', () => {
    const source = createInputMap()
    const script = new Uint8Array(18)
    const view = new DataView(script.buffer)
    view.setUint16(0, 176, true)
    view.setUint16(2, 2, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0, true)
    view.setUint16(10, 3, true)
    view.setUint16(12, 30, true)
    view.setUint16(14, 0x345, true)
    view.setUint16(16, 2, true)
    source.fieldScripts = { bank: 1, bytes: script, headerSize: 0, entryOffsets: [0] }

    const destination = createInputMap()
    destination.id = 2
    destination.matrix = { ...destination.matrix, headers: new Uint16Array([2]) }
    destination.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [] }
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([source, destination], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })

    simulator.input('right')

    expect(simulator.getWorld().getState()).toMatchObject({ map: { id: 2 }, tileX: 0, tileZ: 0 })
    expect(state.flags.has(0x345)).toBe(true)
    expect(simulator.hasActiveScript()).toBe(false)
  })

  it('runs a matching ON_FRAME script immediately after map initialization', () => {
    const source = createInputMap()
    source.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 1, z: 0, header: 2, anchor: 0 }] }
    source.terrain!.attributes[1] = hgssWarpMetatileBehaviors.warpEast
    const destination = createInputMap()
    destination.id = 2
    destination.matrix = { ...destination.matrix, headers: new Uint16Array([2]) }
    destination.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [{ x: 0, z: 0, header: 1, anchor: 0 }] }
    destination.fieldScripts = { bank: 2, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] }
    addStateScript(destination, 1, 0x5000, 7)
    destination.initScripts = [{
      type: 'onFrame',
      conditionsOffset: 0,
      conditions: [{ variable: 0x5000, value: 0, scriptId: 1 }],
    }]
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([source, destination], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })
    state.variables.set(0x8000, 751)
    state.variables.set(0x800d, 4)
    state.followMonMovementPaused = true
    state.pendingPhoneCall = { callerId: 0, parameter1: 2, parameter2: 0 }

    simulator.input('right')

    expect(state.variables.get(0x5000)).toBe(7)
    expect(state.variables.has(0x8000)).toBe(false)
    expect(state.variables.has(0x800d)).toBe(false)
    expect(state.followMonMovementPaused).toBe(false)
    expect(state.pendingPhoneCall).toBeUndefined()
    expect(simulator.hasActiveScript()).toBe(false)
  })

  it('checks matching ON_FRAME scripts during initial map activation', () => {
    const map = createInputMap()
    map.events = { backgroundEvents: 0, backgrounds: [], coordinateEvents: [], objects: [], warps: [] }
    map.fieldScripts = { bank: 1, bytes: new Uint8Array(), headerSize: 0, entryOffsets: [] }
    addStateScript(map, 1, 0x5001, 9)
    map.initScripts = [{
      type: 'onFrame',
      conditionsOffset: 0,
      conditions: [{ variable: 0x5001, value: 0, scriptId: 1 }],
    }]
    const state = createFieldScriptState('male')
    const simulator = createFieldInputSimulator([map], state, { mapId: 1, tileX: 0, tileZ: 0, direction: 'east' })

    expect(state.variables.get(0x5001)).toBe(9)
    expect(simulator.input('right')).toEqual([
      { kind: 'moved', mapId: 1, tileX: 1, tileZ: 0 },
    ])
    expect(simulator.input('right')).toEqual([{ kind: 'blocked', reason: 'bounds', tileX: 2, tileZ: 0, attribute: undefined }])
  })
})
