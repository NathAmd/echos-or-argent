import { describe, expect, it } from 'vitest'
import type { NitroGraphic, OpeningMapPreview } from '../../ndsTypes'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { hgssItemPocketLabels, type HgssItemCatalog } from '../../rom/items/itemData'
import { cloneFieldScriptState, createFieldScriptMapInitSequenceRunner, createFieldScriptRunner, createFieldScriptState, formatFieldMessage, initializeNewGameFieldScriptState, projectFieldScriptState, releaseFieldScriptExecutionState, resolveHgssApricornType, resolveObjectSpriteId, setFieldScriptMapState, type FieldPokemonRuntime } from './fieldScriptRunner'
import { hgssMultiplayerProtocolVersion } from '../multiplayer/hgssMultiplayerGateway'
import { decodeHgssEasyChatCatalog } from '../../rom/easyChat/easyChatData'
import { hgssMartConfirmNoChoice, hgssMartConfirmYesChoice, hgssMartExitChoice } from '../items/hgssMartSession'
import { HGSS_LEAGUE_WINS_GAME_STAT } from './hgssGameClear'
import { HGSS_GAME_CLEAR_SYSTEM_FLAG, HGSS_POST_GAME_RESET_SYSTEM_FLAG } from './hgssFieldSystemFlags'
import { basePokemonPartyHealingPolicy, type PokemonPartyHealingPolicy } from '../pokemon/pokemonPartyHealingPolicy'
import type { PokemonInitialTeamResolver } from '../pokemon/pokemonInitialTeamResolver'
import type { PokemonLevelPolicy } from '../pokemon/pokemonLevelPolicy'
import { PokemonTeamPolicyVetoError, type PokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'

const preventHpRestorationPolicy: PokemonPartyHealingPolicy = {
  vetoFullHealRestoration: ({ restoration }) => restoration === 'hp'
    ? { code: 'test.hp-locked', reason: 'Les PV restent inchangés dans ce test.' }
    : undefined,
}

describe('HGSS Apricorn tree presentation data', () => {
  it('resolves each native tree index to its fruit sprite colour', () => {
    expect(resolveHgssApricornType(0)).toBe(6)
    expect(resolveHgssApricornType(13)).toBe(0)
    expect(resolveHgssApricornType(30)).toBe(5)
    expect(resolveHgssApricornType(31)).toBeUndefined()
  })
})

function createTestPokemonRuntime(seed = 0): FieldPokemonRuntime {
  const alphGraphic: NitroGraphic = {
    width: 8,
    height: 8,
    pixels: new Uint8ClampedArray(8 * 8 * 4),
    graphicsOffset: 0,
    paletteOffset: 0,
    colorDepth: 4,
  }
  return {
    catalog: createPokemonTestCatalog(),
    itemCatalog: createTestItemCatalog(),
    rng: createHgssLcrng(seed),
    trainer: { id: 0x12345678, name: 'JO', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date(2026, 2, 12),
    trainerClassNames: Array.from({ length: 100 }, (_, index) => `CLASSE ${index}`),
    easyChatCatalog: decodeHgssEasyChatCatalog((bankId) => ({ 0: `MOT ${bankId}`, 1: `SECOND ${bankId}` })),
    mailMessageBanks: { 292: {}, 293: {}, 294: { 0: 'VIDE', 3: 'C’est {0100 0, 0} !' }, 295: {}, 296: {} },
    trainerHouseDefaultName: 'HILBERT',
    alphPuzzleTiles: Array.from({ length: 4 }, () => Array.from({ length: 16 }, () => alphGraphic)),
    alphPuzzleBackground: alphGraphic,
    alphPuzzleHints: ['KABUTO', 'PTÉRA', 'AMONITA', 'HO-OH'],
    alphHiddenRoomBackground: alphGraphic,
    alphHiddenRoomWords: ['SORTIE', 'LUMIÈRE', 'EAU', 'HO-OH'],
  }
}

function extendRuntimeWithGiftPokemon(runtime: FieldPokemonRuntime): void {
  const template = runtime.catalog.personalData[158]!
  for (let speciesId = runtime.catalog.personalData.length; speciesId <= 175; speciesId += 1) {
    runtime.catalog.personalData.push({
      ...template,
      speciesId,
      baseStats: { ...template.baseStats },
      evYield: { ...template.evYield },
      heldItems: [...template.heldItems],
      types: [...template.types],
      abilities: [...template.abilities],
      tmHmCompatibility: [...template.tmHmCompatibility],
      genderRatio: speciesId === 172 ? 127 : 31,
      eggCycles: speciesId === 175 ? 10 : template.eggCycles,
    })
    runtime.catalog.speciesNames.push(speciesId === 172 ? 'PICHU' : speciesId === 175 ? 'TOGEPI' : `ESPECE ${speciesId}`)
    runtime.catalog.levelUpLearnsets.push([])
    runtime.catalog.evolutions.push([])
  }
  const moveTemplate = runtime.catalog.moves[45]!
  for (let moveId = runtime.catalog.moves.length; moveId <= 344; moveId += 1) {
    runtime.catalog.moves.push({ ...moveTemplate, moveId, pp: 20 })
    runtime.catalog.moveNames.push(`CAPACITE ${moveId}`)
  }
}

function createTestItemCatalog(): HgssItemCatalog {
  return {
    pocketNames: hgssItemPocketLabels,
    items: Array.from({ length: 537 }, (_, itemId) => ({
      itemId,
      name: itemId === 5 ? 'SAFARI BALL' : `OBJET ${itemId}`,
      description: `Description ${itemId}`,
      price: 0,
      holdEffect: 0,
      holdEffectParameter: 0,
      pluckEffect: 0,
      flingEffect: 0,
      flingPower: 0,
      naturalGiftPower: 0,
      naturalGiftType: 0,
      preventToss: false,
      selectable: true,
      fieldPocket: itemId === 5 ? 2 : itemId === 17 ? 1 : itemId === 328 || itemId === 500 ? 3 : 0,
      battlePocket: 0,
      fieldUseFunction: 0,
      battleUseFunction: 0,
      partyUse: 0,
      partyParameters: {
        sleepHeal: false, poisonHeal: false, burnHeal: false, freezeHeal: false, paralysisHeal: false,
        confusionHeal: false, infatuationHeal: false, guardSpec: false, revive: false, reviveAll: false,
        levelUp: false, evolve: false, attackStages: 0, defenseStages: 0, specialAttackStages: 0,
        specialDefenseStages: 0, speedStages: 0, accuracyStages: 0, criticalRateStages: 0,
        ppUp: false, ppMax: false, ppRestore: false, ppRestoreAll: false, hpRestore: false,
        hpEvUp: false, attackEvUp: false, defenseEvUp: false, speedEvUp: false, specialAttackEvUp: false,
        specialDefenseEvUp: false, friendshipLow: false, friendshipMedium: false, friendshipHigh: false,
        hpEvParameter: 0, attackEvParameter: 0, defenseEvParameter: 0, speedEvParameter: 0,
        specialAttackEvParameter: 0, specialDefenseEvParameter: 0, hpRestoreParameter: 0,
        ppRestoreParameter: 0, friendshipLowParameter: 0, friendshipMediumParameter: 0, friendshipHighParameter: 0,
      },
    })),
  }
}

function createTestPokemon(speciesId = 152) {
  const runtime = createTestPokemonRuntime(speciesId)
  return createCanonicalPokemon(runtime.catalog, {
    speciesId,
    level: 5,
    rng: runtime.rng,
    personality: { kind: 'random' },
    individualValues: { kind: 'random' },
    originalTrainer: runtime.trainer,
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
}

function createBedroomMap(): OpeningMapPreview {
  const bytes = new Uint8Array(104)
  const view = new DataView(bytes.buffer)
  bytes.set([
    0x61, 0x02, 0x60, 0x00, 0x49, 0x00, 0x0b, 0x06, 0xbe, 0x00, 0x00, 0x2d, 0x00, 0x00,
    0x35, 0x00, 0x79, 0x01, 0x0c, 0x80, 0x11, 0x00, 0x0c, 0x80, 0x00, 0x00, 0x1c, 0x00,
    0x01, 0x20, 0x00, 0x00, 0x00, 0xae, 0x00, 0x06, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00,
    0x00, 0xaf, 0x00, 0x78, 0x01, 0x96, 0x00, 0xae, 0x00, 0x06, 0x00, 0x01, 0x00, 0x01,
    0x00, 0x00, 0x00, 0xaf, 0x00, 0x61, 0x00, 0x02, 0x00, 0x2d, 0x00, 0x01, 0x32, 0x00,
    0x35, 0x00, 0x61, 0x00, 0x02, 0x00,
  ], 10)
  view.setUint16(86, 73, true)
  view.setUint16(88, 1500, true)
  view.setUint16(90, 96, true)
  view.setUint16(92, 45, true)
  bytes[94] = 2
  view.setUint16(95, 50, true)
  view.setUint16(97, 53, true)
  view.setUint16(99, 97, true)
  view.setUint16(101, 2, true)

  return {
    id: 64,
    label: 'Chambre',
    header: { mapId: 64, msgBank: 546, mapSection: 126, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 846, bytes, headerSize: 10, entryOffsets: [10, 86] },
    initScripts: [],
    messages: { 0: 'Le joueur allume le PC.', 1: 'La boite aux lettres est vide.', 2: 'Message francais de la ROM' },
    matrix: {} as OpeningMapPreview['matrix'],
  }
}

function createBedroomMapWithNpc(): OpeningMapPreview {
  return {
    ...createBedroomMap(),
    events: {
      backgroundEvents: 0,
      backgrounds: [],
      coordinateEvents: [],
      objects: [{ id: 7, spriteId: 10, movement: 0, type: 0, eventFlag: 0, scriptId: 1, facingDirection: 0, xRange: 0, zRange: 0, x: 4, z: 8 }],
      warps: [],
    },
  }
}

describe('HGSS field script runner', () => {
  it('lit en direct les cinq périodes RTC, le jour de semaine et la météo locale', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(16)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 379, true); view.setUint16(2, 0x4000, true)
    view.setUint16(4, 484, true); view.setUint16(6, 0x4001, true)
    view.setUint16(8, 181, true)
    view.setUint16(10, 684, true); view.setUint16(12, 0x4002, true)
    view.setUint16(14, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runtime = createTestPokemonRuntime()
    runtime.now = () => new Date(2026, 2, 12, 18)
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(2)
    expect(state.variables.get(0x4001)).toBe(4)
    expect(state.variables.get(0x4002)).toBe(12)
  })

  it("exécute PartyHasPokerus sur l'octet PK4 de tous les membres", () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 238, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    const healthy = createTestPokemon(152)
    const cured = createTestPokemon(155)
    cured.pokerus = 0x20
    const healthyState = createFieldScriptState('male', 'JO', { party: [healthy] })
    const curedState = createFieldScriptState('male', 'JO', { party: [healthy, cured] })

    expect(createFieldScriptRunner(map, 1, healthyState).resume()).toEqual({ kind: 'ended' })
    expect(createFieldScriptRunner(map, 1, curedState).resume()).toEqual({ kind: 'ended' })
    expect(healthyState.variables.get(0x4000)).toBe(0)
    expect(curedState.variables.get(0x4000)).toBe(1)
  })

  it('harvests a native Apricorn tree once per day and stores its exact ROM colour', () => {
    const map = createBedroomMapWithNpc()
    map.events!.objects[0] = {
      ...map.events!.objects[0]!,
      id: 10,
      spriteId: 262,
      parameters: [30, 0, 0],
    }
    map.externalMessages = { 21: { 12: 'NOIGRUME BLANC' } }
    const bytes = new Uint8Array(23)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 623, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 624, true); cursor += 2
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 626, true); cursor += 2
    bytes[cursor] = 0; cursor += 1
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 625, true); cursor += 2
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 1, true); cursor += 2
    view.setUint16(cursor, 0x4002, true); cursor += 2
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createTestPokemonRuntime() })

    const first = createFieldScriptRunner(map, 1, state, 10)
    expect(first.resume()).toEqual({ kind: 'apricornTree', objectId: 10, treeIndex: 30, apricornType: 5 })
    expect(first.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(5)
    expect(state.variables.get(0x4002)).toBe(1)
    expect(state.buffers.get(0)).toBe('NOIGRUME BLANC')
    expect(state.apricornBox).toEqual([0, 0, 0, 0, 0, 1, 0])

    const checkBytes = new Uint8Array(6)
    const checkView = new DataView(checkBytes.buffer)
    checkView.setUint16(0, 623, true)
    checkView.setUint16(2, 0x4000, true)
    checkView.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes: checkBytes, headerSize: 0, entryOffsets: [0] }
    const second = createFieldScriptRunner(map, 1, state, 10)
    expect(second.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.apricornBox).toEqual([0, 0, 0, 0, 0, 1, 0])

    state.apricornTreeDay = '2026-3-11'
    const nextDay = createFieldScriptRunner(map, 1, state, 10)
    expect(nextDay.resume()).toMatchObject({ kind: 'apricornTree', treeIndex: 30, apricornType: 5 })
  })

  it('exposes OpenMsg, CloseMsg and HoldMsg instead of leaving stale dialogue visible', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 52, true)
    view.setUint16(2, 53, true)
    view.setUint16(4, 54, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'open' })
    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'close' })
    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'hold' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('runs the native engaged-trainer approach operands before battle', () => {
    const map = createBedroomMapWithNpc()
    const bytes = new Uint8Array(24)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 168, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 169, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 170, true); cursor += 2
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 171, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 0x4002, true); cursor += 2
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 4, 11, 'north')
    state.engagedTrainers = [{ objectId: 7, trainerId: 5, direction: 'north', distance: 3, encounterType: 0 }]
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'movement',
      objectId: 7,
      actions: [
        { action: 0, repetitions: 1, direction: 'north', tileDistance: 0, kind: 'face' },
        { action: 75, repetitions: 1, tileDistance: 0, kind: 'effect' },
        { action: 12, repetitions: 2, direction: 'north', tileDistance: 0, kind: 'walk' },
      ],
    })
    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'movement' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.variables.get(0x4002)).toBe(5)
    expect(state.objects.get(7)).toMatchObject({ x: 4, z: 6, direction: 'north' })
  })

  it('returns the first usable party slot through GetFollowPokePartyIndex', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 727, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    const fainted = createTestPokemon(152)
    fainted.currentHp = 0
    const ready = createTestPokemon(155)
    const state = createFieldScriptState('male', 'JO', { party: [fainted, ready] })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
  })

  it('replays the portrait and completion opcodes used by the Cut standard script', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 183, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 560, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 0x4000, true)
    view.setUint16(10, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    const pokemon = createTestPokemon(152)
    const state = createFieldScriptState('male', 'JO', { party: [pokemon] })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'pokemonPortrait', action: 'show', speciesId: 152, gender: 0 })
    expect(runner.resume()).toEqual({ kind: 'fieldMoveEffect', mode: 0, completionVariable: 0x4000 })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('continues after ScrCmd_459 so the Lighthouse Jasmine quest can finish its flag updates', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 459, true)
    view.setUint16(2, 30, true)
    view.setUint16(4, 0x96a, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'timer', frames: 1 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.flags.has(0x96a)).toBe(true)
  })

  it('supports the follower helper opcodes chained by standard field moves', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(15)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 730, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 732, true); cursor += 2
    bytes[cursor] = 20; cursor += 1
    view.setUint16(cursor, 733, true); cursor += 2
    bytes[cursor] = 12; cursor += 1
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 734, true); cursor += 2
    bytes[cursor] = 2
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    const state = createFieldScriptState('male', 'JO')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'timer', frames: 1 })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.followerMood).toBe(20)
  })

  it.each([
    ['inactif avec objet masqué', false, { present: true, visible: false }, 1],
    ['actif sans MapObject', true, { present: false, visible: false }, 0],
    ['actif avec MapObject masqué', true, { present: true, visible: false }, 0],
    ['actif avec MapObject visible', true, { present: true, visible: true }, 1],
  ])('applique la table native de ScrCmd_730 : %s', (_label, active, signal, expected) => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 730, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { followMonActive: active })
    const runner = createFieldScriptRunner(
      map, 1, state, undefined,
      undefined, undefined, undefined, undefined, undefined,
      () => signal,
    )

    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(expected)
  })

  it('uses native Force flag actions and continues the shared follower field-move animation', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(22)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 400, true); cursor += 2
    bytes[cursor] = 1; cursor += 1 // FLAG_ACTION_SET
    view.setUint16(cursor, 400, true); cursor += 2
    bytes[cursor] = 2; cursor += 1 // FLAG_ACTION_CHECK
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 400, true); cursor += 2
    bytes[cursor] = 0; cursor += 1 // FLAG_ACTION_CLEAR
    view.setUint16(cursor, 400, true); cursor += 2
    bytes[cursor] = 2; cursor += 1
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 598, true); cursor += 2
    view.setUint16(cursor, 1, true); cursor += 2
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', 'JO', { followMonActive: true })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'refresh' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.flags.has(0x962)).toBe(false)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('preserves the interacting ROM object as dialogue speaker context', () => {
    const map = createBedroomMapWithNpc()
    const bytes = new Uint8Array(5)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 45, true)
    bytes[2] = 2
    view.setUint16(3, 2, true)
    map.fieldScripts = { bank: 846, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male'), 7)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM', speakerObjectId: 7 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('branches on CheckTrainerFlag with the native TRUE/FALSE comparison encoding', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(19)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 38, true)
    view.setUint16(2, 4, true)
    view.setUint16(4, 28, true)
    bytes[6] = 1 // TRUE, identique a GoToIfDefeated dans les macros ROM.
    view.setInt32(7, 6, true)
    view.setUint16(11, 41, true)
    view.setUint16(13, 0x4000, true)
    view.setUint16(15, 123, true)
    view.setUint16(17, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    const undefeated = createFieldScriptState('male')
    expect(createFieldScriptRunner(map, 1, undefeated).resume()).toEqual({ kind: 'ended' })
    expect(undefeated.variables.get(0x4000)).toBe(123)

    const defeated = createFieldScriptState('male')
    defeated.trainerFlags.add(4)
    expect(createFieldScriptRunner(map, 1, defeated).resume()).toEqual({ kind: 'ended' })
    expect(defeated.variables.has(0x4000)).toBe(false)
  })

  it('applies ScrCmd_454 to the last interacted trainer without suspending the script', () => {
    const map = createBedroomMapWithNpc()
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 454, true)
    view.setUint16(2, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    map.events!.objects[0]!.scriptId = 3003
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 4, 9, 'north')

    expect(createFieldScriptRunner(map, 1, state, 7).resume()).toEqual({ kind: 'ended' })
    expect(state.objects.get(7)?.movement).toBe(14)
  })

  it('emits the native tagged door animation lifecycle with resolved world coordinates', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(28)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 307, true); cursor += 2
    view.setUint16(cursor, 2, true); cursor += 2
    view.setUint16(cursor, 3, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 0x4001, true); cursor += 2
    bytes[cursor++] = 77
    for (const opcode of [310, 308, 311, 308, 309]) {
      view.setUint16(cursor, opcode, true); cursor += 2
      bytes[cursor++] = 77
    }
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 5)
    state.variables.set(0x4001, 7)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'setup', tag: 77, worldX: 69, worldZ: 103 })
    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'play', tag: 77, animationIndex: 0 })
    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'wait', tag: 77 })
    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'play', tag: 77, animationIndex: 1 })
    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'wait', tag: 77 })
    expect(runner.resume()).toEqual({ kind: 'doorAnimation', action: 'unload', tag: 77 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('starts without invented story flags', () => {
    const state = createFieldScriptState('male')

    expect([...state.flags]).toEqual([])
    expect(state.money).toBe(3000)
  })

  it('initializes a new game by executing standard ROM script 9600', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 30, true)
    view.setUint16(2, 0x123, true)
    view.setUint16(4, 30, true)
    view.setUint16(6, 0x456, true)
    view.setUint16(8, 2, true)
    map.standardScriptBanks = [{ bank: 149, baseScriptId: 9600, bytes, headerSize: 0, entryOffsets: [0], messages: {} }]
    const state = createFieldScriptState('male')

    initializeNewGameFieldScriptState(map, state)

    expect([...state.flags]).toEqual([0x123, 0x456])
  })

  it('keeps a local script ahead of an overlapping attached standard bank', () => {
    const map = createBedroomMap()
    const localBytes = new Uint8Array(5)
    const localView = new DataView(localBytes.buffer)
    localView.setUint16(0, 45, true)
    localBytes[2] = 2
    localView.setUint16(3, 2, true)
    map.fieldScripts = { bank: 846, bytes: localBytes, headerSize: 0, entryOffsets: [0] }

    const standardBytes = new Uint8Array(8)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 41, true)
    standardView.setUint16(2, 0x4000, true)
    standardView.setUint16(4, 99, true)
    standardView.setUint16(6, 2, true)
    map.standardScriptBanks = [{
      bank: 1,
      baseScriptId: 1,
      bytes: standardBytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }]
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.has(0x4000)).toBe(false)
  })

  it('decodes the three native legendary cinematic identities', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 773, true)
    view.setUint16(2, 2, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'objectEffect', action: 'configure', objectIds: [], parameters: [773, 2] })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('resolves the friend object sprite through the ROM object variable', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 144, true)
    view.setUint16(12, 0x4020, true)
    view.setUint16(14, 2, true)
    const maleState = createFieldScriptState('male')
    const femaleState = createFieldScriptState('female')

    expect(createFieldScriptRunner(map, 2, maleState).resume()).toEqual({ kind: 'ended' })
    expect(createFieldScriptRunner(map, 2, femaleState).resume()).toEqual({ kind: 'ended' })
    expect(resolveObjectSpriteId(101, maleState)).toBe(97)
    expect(resolveObjectSpriteId(101, femaleState)).toBe(0)
    expect(() => resolveObjectSpriteId(102, maleState)).toThrow('0x4021')
  })

  it('writes the selected profile gender through GetPlayerGender without desynchronizing', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 281, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 45, true)
    map.fieldScripts.bytes[16] = 2
    view.setUint16(17, 2, true)
    const state = createFieldScriptState('female')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('heals synchronously and continues after the native overworld application commands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 282, true)
    view.setUint16(12, 436, true)
    view.setUint16(14, 150, true)
    view.setUint16(16, 45, true)
    map.fieldScripts.bytes[18] = 2
    view.setUint16(19, 2, true)
    const pokemon = createTestPokemon(155)
    pokemon.currentHp = 1
    pokemon.status = 4
    pokemon.moves[0]!.pp = 0
    const state = createFieldScriptState('male', '', { party: [pokemon] })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(state.party.members[0]).toMatchObject({ currentHp: pokemon.stats.hp, status: 0 })
    expect(state.party.members[0]?.moves[0]?.pp).toBe(pokemon.moves[0]!.maxPp)
  })

  it('honore la politique de soin injectée sans bloquer la restauration du statut et des PP', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 282, true)
    view.setUint16(2, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(155)
    pokemon.currentHp = 0
    pokemon.status = 4
    pokemon.moves[0]!.pp = 0
    const state = createFieldScriptState('male', '', { party: [pokemon] })

    expect(createFieldScriptRunner(map, 1, state, undefined, preventHpRestorationPolicy).resume()).toEqual({ kind: 'ended' })
    expect(state.party.members[0]).toMatchObject({ currentHp: 0, status: 0 })
    expect(state.party.members[0]?.moves[0]?.pp).toBe(pokemon.moves[0]!.maxPp)
  })

  it('applique TutorMoveTeachInSlot avec ses trois opérandes variables et les PP ROM', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 654, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 0x4001, true)
    view.setUint16(6, 0x4002, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runtime = createTestPokemonRuntime()
    const pokemon = createTestPokemon(152)
    const untouchedMove = pokemon.moves[1]
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime, party: [pokemon] })
    state.variables.set(0x4000, 0)
    state.variables.set(0x4001, 0)
    state.variables.set(0x4002, 43)

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.party.members[0]?.moves[0]).toMatchObject({
      moveId: 43,
      pp: runtime.catalog.moves[43]!.pp,
      maxPp: runtime.catalog.moves[43]!.pp,
      ppUps: 0,
      data: runtime.catalog.moves[43],
    })
    expect(state.party.members[0]?.moves[1]).toEqual(untouchedMove)
  })

  it('emits the native WhiteOut task without inventing a pre-script heal', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 219, true)
    view.setUint16(2, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(155)
    pokemon.currentHp = 1
    const state = createFieldScriptState('male', '', { party: [pokemon] })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'blackout' })
    expect(state.party.members[0]!.currentHp).toBe(1)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('checks and grants the Pokédex and running shoes through their ROM save flags', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 290, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 291, true)
    view.setUint16(16, 290, true)
    view.setUint16(18, 0x4001, true)
    view.setUint16(20, 292, true)
    view.setUint16(22, 0x4002, true)
    view.setUint16(24, 293, true)
    view.setUint16(26, 292, true)
    view.setUint16(28, 0x4003, true)
    view.setUint16(30, 2, true)
    const state = createFieldScriptState('male')

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(state.variables.get(0x4003)).toBe(1)
    expect(state.pokedex.enabled).toBe(true)
    expect(state.runningShoes).toBe(true)
  })

  it('projects map object variables without mutating the live field state', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 41, true)
    view.setUint16(12, 0x4020, true)
    view.setUint16(14, 97, true)
    view.setUint16(16, 95, true)
    view.setUint16(18, 99, true)
    view.setUint16(20, 7, true)
    view.setUint16(22, 94, true)
    view.setUint16(30, 0, true)
    view.setUint16(24, 7, true)
    view.setInt32(26, 2, true)
    view.setUint16(30, 2, true)
    map.fieldScripts.bytes.set([12, 0, 1, 0, 0xfe, 0, 0], 32)
    const liveState = createFieldScriptState('male')
    const projectedState = cloneFieldScriptState(liveState)

    projectFieldScriptState(createFieldScriptRunner(map, 2, projectedState))

    expect(projectedState.variables.get(0x4020)).toBe(97)
    expect(liveState.variables.has(0x4020)).toBe(false)
  })

  it('projects ROM object visibility commands into field state', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 101, true)
    view.setUint16(12, 7, true)
    view.setUint16(14, 100, true)
    view.setUint16(16, 8, true)
    view.setUint16(18, 2, true)
    const state = createFieldScriptState('male')
    state.hiddenObjectIds.add(8)

    projectFieldScriptState(createFieldScriptRunner(map, 2, state))

    expect([...state.hiddenObjectIds]).toEqual([7])
  })

  it('resolves a local script ID and suspends through its ROM dialogue', () => {
    const runner = createFieldScriptRunner(createBedroomMap(), 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'play', sequenceId: 1500 })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'inputWait', accepts: ['confirm', 'cancel', 'direction'] })
    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'close' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('executes the real empty-mailbox branch of bedroom script 1', () => {
    const runner = createFieldScriptRunner(createBedroomMap(), 1, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'play', sequenceId: 1547 })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 0, text: 'Le joueur allume le PC.' })
    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'close' })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 1, text: 'La boite aux lettres est vide.' })
    expect(runner.resume()).toEqual({ kind: 'inputWait', accepts: ['confirm', 'cancel', 'direction'] })
    expect(runner.resume()).toEqual({ kind: 'dialogue', action: 'close' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('decodes PlaySE, StopSE, and WaitSE operands without desynchronizing the next command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 73, true)
    view.setUint16(12, 1500, true)
    view.setUint16(14, 74, true)
    view.setUint16(16, 0x4000, true)
    view.setUint16(18, 75, true)
    view.setUint16(20, 0x4000, true)
    view.setUint16(22, 45, true)
    map.fieldScripts.bytes[24] = 2
    view.setUint16(25, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 1547)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'play', sequenceId: 1500 })
    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'stop', sequenceId: 1547 })
    expect(runner.resume()).toEqual({ kind: 'soundEffect', action: 'wait', sequenceId: 1547 })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('plays a variable-selected Pokémon cry and waits for its channel before continuing', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 76, true)
    view.setUint16(12, 152, true)
    view.setUint16(14, 0x4000, true)
    view.setUint16(16, 77, true)
    view.setUint16(18, 45, true)
    map.fieldScripts.bytes[20] = 2
    view.setUint16(21, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.variables.set(0x4000, 0)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'cry', action: 'play', speciesId: 152, pattern: 0 })
    expect(runner.resume()).toEqual({ kind: 'cry', action: 'wait' })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('plays a variable-selected fanfare and waits for its channel before continuing', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 78, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 79, true)
    view.setUint16(16, 45, true)
    map.fieldScripts.bytes[18] = 2
    view.setUint16(19, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 1547)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'fanfare', action: 'play', sequenceId: 1547 })
    expect(runner.resume()).toEqual({ kind: 'fanfare', action: 'wait' })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('buffers the friend name through BufferFriendsName without desynchronizing the next command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 192, true)
    map.fieldScripts.bytes[12] = 1
    view.setUint16(13, 2, true)
    const state = createFieldScriptState('male', '', { friendName: 'LYRA' })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(formatFieldMessage('Salut {103 1,0}!', state)).toBe('Salut LYRA!')
  })

  it('names and buffers the rival through the native naming command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 143, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 191, true)
    map.fieldScripts.bytes[16] = 1
    view.setUint16(17, 2, true)
    const state = createFieldScriptState('male', '', { rivalName: 'SILVER' })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'nickname', slot: -1, currentName: 'SILVER', maxLength: 7, cancellable: false, promptMessageId: 3 })
    runner.enterNickname('ARGENT')
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(formatFieldMessage('{103 1,0}', state)).toBe('ARGENT')
  })

  it('reads live player coordinates, player facing, and NPC coordinates from runtime state', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 105, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 386, true)
    view.setUint16(18, 0x4002, true)
    view.setUint16(20, 106, true)
    view.setUint16(22, 7, true)
    view.setUint16(24, 0x4003, true)
    view.setUint16(26, 0x4004, true)
    view.setUint16(28, 2, true)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 12, 18, 'west')

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(12)
    expect(state.variables.get(0x4001)).toBe(18)
    expect(state.variables.get(0x4002)).toBe(2)
    expect(state.variables.get(0x4003)).toBe(4)
    expect(state.variables.get(0x4004)).toBe(8)
  })

  it('faces the current object script actor toward the player for FacePlayer', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[0] = 10
    view.setUint16(10, 104, true)
    view.setUint16(12, 2, true)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 12, 8, 'west')
    const runner = createFieldScriptRunner(map, 1, state, 7)

    expect(runner.resume()).toEqual({ kind: 'facePlayer', objectId: 7 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.objects.get(7)?.direction).toBe('east')
  })

  it('updates runtime coordinates before later script coordinate reads', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 94, true)
    view.setUint16(12, 7, true)
    view.setInt32(14, 24, true)
    view.setUint16(18, 106, true)
    view.setUint16(20, 7, true)
    view.setUint16(22, 0x4000, true)
    view.setUint16(24, 0x4001, true)
    view.setUint16(26, 94, true)
    view.setUint16(28, 255, true)
    view.setInt32(30, 16, true)
    view.setUint16(34, 105, true)
    view.setUint16(36, 0x4002, true)
    view.setUint16(38, 0x4003, true)
    view.setUint16(40, 2, true)
    map.fieldScripts.bytes.set([7, 0, 1, 0, 254, 0, 0, 0], 42)
    map.fieldScripts.bytes.set([7, 0, 1, 0, 254, 0, 0, 0], 50)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 12, 18, 'west')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toMatchObject({ kind: 'movement', objectId: 7 })
    expect(runner.resume()).toMatchObject({ kind: 'movement', objectId: 255 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(5)
    expect(state.variables.get(0x4001)).toBe(8)
    expect(state.variables.get(0x4002)).toBe(13)
    expect(state.variables.get(0x4003)).toBe(18)
  })

  it('emits direct object placement and facing updates for ROM object commands', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 338, true)
    view.setUint16(12, 7, true)
    view.setUint16(14, 5, true)
    view.setUint16(16, 7, true)
    view.setUint16(18, 341, true)
    view.setUint16(20, 7, true)
    view.setUint16(22, 3, true)
    view.setUint16(24, 339, true)
    view.setUint16(26, 7, true)
    view.setUint16(28, 9, true)
    view.setUint16(32, 0, true)
    view.setUint16(32, 3, true)
    view.setUint16(34, 0, true)
    view.setUint16(36, 106, true)
    view.setUint16(38, 7, true)
    view.setUint16(40, 0x4000, true)
    view.setUint16(42, 0x4001, true)
    view.setUint16(44, 2, true)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 12, 18, 'west')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'objectState', objectId: 7, x: 5, z: 7 })
    expect(runner.resume()).toEqual({ kind: 'objectState', objectId: 7, direction: 'east' })
    expect(runner.resume()).toEqual({ kind: 'objectState', objectId: 7, x: 9, z: 3, direction: 'north' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(9)
    expect(state.variables.get(0x4001)).toBe(3)
    expect(state.objects.get(7)).toMatchObject({ x: 9, z: 3, direction: 'north' })
  })

  it('writes party count through GetPartyCount without desynchronizing the next command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 332, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 45, true)
    map.fieldScripts.bytes[16] = 2
    view.setUint16(17, 2, true)
    const state = createFieldScriptState('male', '', { party: [createTestPokemon(152), createTestPokemon(155), createTestPokemon(158)] })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(state.variables.get(0x4000)).toBe(3)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('runs SurvivePoisoning with a variable slot and writes its native boolean result', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 435, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 435, true)
    view.setUint16(18, 0x4002, true)
    view.setUint16(20, 0, true)
    view.setUint16(22, 2, true)
    const survivor = createTestPokemon(155)
    survivor.currentHp = 1
    survivor.status = 0x80 | 0x500
    const state = createFieldScriptState('male', '', { party: [survivor] })
    state.variables.set(0x4001, 0)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(state.party.members[0]?.status).toBe(0)
  })

  it('does not infer Pokédex captures from members loaded into Party', () => {
    const state = createFieldScriptState('male', '', { party: [createTestPokemon(155)] })

    expect(state.party.members.map((pokemon) => pokemon.speciesId)).toEqual([155])
    expect(state.pokedex.caughtSpeciesIds.has(155)).toBe(false)
  })

  it('resumes a parent CallStd after the nested RestartCurrentScript signal', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 20, true)
    view.setUint16(12, 2000, true)
    view.setUint16(14, 41, true)
    view.setUint16(16, 0x4001, true)
    view.setUint16(18, 9, true)
    view.setUint16(20, 2, true)
    const standardBytes = new Uint8Array(10)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 41, true)
    standardView.setUint16(2, 0x4000, true)
    standardView.setUint16(4, 7, true)
    standardView.setUint16(6, 21, true)
    standardView.setUint16(8, 2, true)
    map.standardScripts = {
      bank: 3,
      baseScriptId: 2000,
      bytes: standardBytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(7)
    expect(state.variables.get(0x4001)).toBe(9)
  })

  it('propage la politique d’équipe aux scripts standards imbriqués', () => {
    const map = createBedroomMap()
    const parentBytes = new Uint8Array(6)
    const parentView = new DataView(parentBytes.buffer)
    parentView.setUint16(0, 20, true)
    parentView.setUint16(2, 2000, true)
    parentView.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes: parentBytes, headerSize: 0, entryOffsets: [0] }
    const standardBytes = new Uint8Array(16)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 137, true)
    for (const [offset, value] of [152, 5, 0, 0, 0, 0x4000].entries()) {
      standardView.setUint16(2 + offset * 2, value, true)
    }
    standardView.setUint16(14, 2, true)
    map.standardScripts = { bank: 3, baseScriptId: 2000, bytes: standardBytes, headerSize: 0, entryOffsets: [0], messages: {} }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'gift-locked', reason: 'Cadeaux verrouillés.' }),
    }
    const runner = createFieldScriptRunner(map, 1, state, undefined, basePokemonPartyHealingPolicy, policy)

    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.party.members).toEqual([])
    expect(state.pokedex.caughtSpeciesIds.size).toBe(0)
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('propage le resolver d’équipe initiale aux scripts standards imbriqués', () => {
    const map = createBedroomMap()
    const parentBytes = new Uint8Array(6)
    const parentView = new DataView(parentBytes.buffer)
    parentView.setUint16(0, 20, true)
    parentView.setUint16(2, 2000, true)
    parentView.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes: parentBytes, headerSize: 0, entryOffsets: [0] }
    const standardBytes = new Uint8Array(8)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 167, true)
    standardView.setUint16(2, 206, true)
    standardView.setUint16(4, 0x4000, true)
    standardView.setUint16(6, 2, true)
    map.standardScripts = { bank: 3, baseScriptId: 2000, bytes: standardBytes, headerSize: 0, entryOffsets: [0], messages: {} }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createTestPokemonRuntime() })
    const initialTeamResolver: PokemonInitialTeamResolver = () => Array.from(
      { length: 6 },
      (_, index) => ({ speciesId: 152 + index, level: 5, form: 0 }),
    )
    const runner = createFieldScriptRunner(
      map,
      1,
      state,
      undefined,
      basePokemonPartyHealingPolicy,
      undefined,
      initialTeamResolver,
    )

    expect(runner.resume()).toMatchObject({ kind: 'choice', presentation: 'starter' })
    runner.choose(2)
    expect(runner.resume()).toMatchObject({ kind: 'mapProps' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.starterChoice).toBe(2)
    expect(state.starterStorySpeciesId).toBe(152)
    expect(state.variables.get(0x4000)).toBe(158)
    expect(state.party.members.map(({ speciesId }) => speciesId)).toEqual([152, 153, 154, 155, 156, 157])
  })

  it('propage le plafond de niveau aux scripts standards imbriqués', () => {
    const map = createBedroomMap()
    const parentBytes = new Uint8Array(6)
    const parentView = new DataView(parentBytes.buffer)
    parentView.setUint16(0, 20, true)
    parentView.setUint16(2, 2000, true)
    parentView.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes: parentBytes, headerSize: 0, entryOffsets: [0] }
    const standardBytes = new Uint8Array(8)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 371, true)
    standardView.setUint16(2, 0x4000, true)
    standardView.setUint16(4, 0, true)
    standardView.setUint16(6, 2, true)
    map.standardScripts = { bank: 3, baseScriptId: 2000, bytes: standardBytes, headerSize: 0, entryOffsets: [0], messages: {} }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.daycare.mons[0] = { pokemon: createTestPokemon(152), steps: 100_000 }
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 6 }

    expect(createFieldScriptRunner(
      map, 1, state, undefined, undefined, undefined, undefined, levelPolicy,
    ).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
  })

  it('decodes FadeOutBGM and FadeInBGM operands without desynchronizing the next command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 84, true)
    view.setUint16(12, 64, true)
    view.setUint16(14, 30, true)
    view.setUint16(16, 85, true)
    view.setUint16(18, 45, true)
    view.setUint16(20, 45, true)
    map.fieldScripts.bytes[22] = 2
    view.setUint16(23, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'music', action: 'fadeOut', targetVolume: 64, frames: 30 })
    expect(runner.resume()).toEqual({ kind: 'music', action: 'fadeIn', frames: 45 })
    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('rejects absent local scripts and unknown opcodes', () => {
    const map = createBedroomMap()
    expect(() => createFieldScriptRunner(map, 3, createFieldScriptState('male'))).toThrow('n’existe pas')
    new DataView(map.fieldScripts.bytes.buffer).setUint16(86, 0xffff, true)
    expect(() => createFieldScriptRunner(map, 2, createFieldScriptState('male')).resume()).toThrow('Opcode HGSS 65535')
  })

  it('persists the story effects used by the opening mother script', () => {
    const map = createBedroomMap()
    const bytes = map.fieldScripts.bytes
    const view = new DataView(bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 30, true)
    view.setUint16(12, 0x123, true)
    view.setUint16(14, 41, true)
    view.setUint16(16, 0x4106, true)
    view.setUint16(18, 1, true)
    view.setUint16(20, 132, true)
    bytes[22] = 0
    bytes[23] = 1
    view.setUint16(24, 2, true)
    const state = createFieldScriptState('female')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 1, text: 'La boite aux lettres est vide.' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.flags.has(0x123)).toBe(true)
    expect(state.variables.get(0x4106)).toBe(1)
  })

  it('branches on persistent flags and formats buffered player names', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 32, true)
    view.setUint16(12, 0x123, true)
    view.setUint16(14, 28, true)
    map.fieldScripts.bytes[16] = 1
    view.setInt32(17, 2, true)
    view.setUint16(21, 2, true)
    view.setUint16(23, 190, true)
    map.fieldScripts.bytes[25] = 0
    view.setUint16(26, 2, true)
    const state = createFieldScriptState('male', 'LUCAS')
    state.flags.add(0x123)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(formatFieldMessage('Bonjour {103 0,0}!', state)).toBe('Bonjour LUCAS!')
    state.buffers.set(1, 'Héricendre')
    expect(formatFieldMessage('{103 0,0} reçoit {100 1,0}\nde la part du Professeur Orme!', state))
      .toBe('LUCAS reçoit Héricendre\nde la part du Professeur Orme!')
    expect(formatFieldMessage('Voulez-vous donner un surnom au\n{100 1,0} obtenu? {200 0}', state))
      .toBe('Voulez-vous donner un surnom au\nHéricendre obtenu?')
    state.buffers.set(0, 'Potion')
    state.buffers.set(2, 'Objets')
    expect(formatFieldMessage('Obtenu: {108 0,0}! Poche {11f 2,0}.', state)).toBe('Obtenu: Potion! Poche Objets.')
    expect(formatFieldMessage('{101 1,0}, c’est bien ça?', state)).toBe('Héricendre, c’est bien ça?')
    expect(formatFieldMessage('Tu te souviens? {200 0}', state)).toBe('Tu te souviens?')
    state.buffers.set(3, 'VARIABLE ROM')
    expect(formatFieldMessage('{102 3,0} {401 3,0} {3403 3,0}', state)).toBe('VARIABLE ROM VARIABLE ROM VARIABLE ROM')
    expect(formatFieldMessage('{ff00 1}Centré{205 0}{201 12}{ff01 100}', state)).toBe('Centré')
    expect(() => formatFieldMessage('Texte {999 0}', state)).toThrow('999 non pris en charge')
  })

  it('sets, checks, and clears a flag addressed through a ROM variable', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 33, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 35, true)
    view.setUint16(16, 0x4000, true)
    view.setUint16(18, 0x4001, true)
    view.setUint16(20, 34, true)
    view.setUint16(22, 0x4000, true)
    view.setUint16(24, 35, true)
    view.setUint16(26, 0x4000, true)
    view.setUint16(28, 0x4002, true)
    view.setUint16(30, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 0x123)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.flags.has(0x123)).toBe(false)
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(0)
  })

  it('buffers a party species name through the generic field command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 845, true)
    map.fieldScripts.bytes[12] = 1
    view.setUint16(13, 0x4000, true)
    view.setUint16(15, 2, true)
    const state = createFieldScriptState('male', '', { party: [createTestPokemon(155)], pokemonRuntime: createTestPokemonRuntime() })
    state.variables.set(0x4000, 0)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(1)).toBe('HERICENDRE')
  })

  it.each([
    [152, 'GERMIGNON'],
    [155, 'HERICENDRE'],
    [158, 'KAIMINUS'],
  ])('buffers party species %i through BufferMonSpeciesName', (speciesId, speciesName) => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 193, true)
    map.fieldScripts.bytes[12] = 1
    view.setUint16(13, 0, true)
    view.setUint16(15, 2, true)
    const state = createFieldScriptState('male', '', { party: [createTestPokemon(speciesId)], pokemonRuntime: createTestPokemonRuntime() })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(1)).toBe(speciesName)
  })

  it('suspends NicknameInput and buffers the entered party nickname', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 173, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0x4000, true)
    view.setUint16(16, 199, true)
    map.fieldScripts.bytes[18] = 1
    view.setUint16(19, 0, true)
    view.setUint16(21, 2, true)
    const pokemonRuntime = createTestPokemonRuntime()
    const pokemon = createCanonicalPokemon(pokemonRuntime.catalog, {
      speciesId: 155,
      level: 5,
      rng: pokemonRuntime.rng,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: pokemonRuntime.trainer,
      origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
      ballId: 4,
    })
    const state = createFieldScriptState('male', '', { party: [pokemon], pokemonRuntime })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({
      kind: 'nickname', slot: 0, currentName: 'HERICENDRE', maxLength: 10,
      cancellable: true, promptMessageId: 1, promptValues: ['HERICENDRE'],
    })
    runner.enterNickname('FLAMME')
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.party.members[0]?.nickname).toBe('FLAMME')
    expect(state.buffers.get(1)).toBe('FLAMME')
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('buffers an item selected through a script variable', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 194, true)
    map.fieldScripts.bytes[12] = 2
    view.setUint16(13, 0x4000, true)
    view.setUint16(15, 843, true)
    map.fieldScripts.bytes[17] = 3
    view.setUint16(18, 0x4000, true)
    view.setUint16(20, 2, true)
    const runtime = createTestPokemonRuntime()
    runtime.itemCatalog = createTestItemCatalog()
    const state = createFieldScriptState('male', '', { pokemonRuntime: runtime })
    state.variables.set(0x4000, 5)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(2)).toBe('SAFARI BALL')
    expect(state.buffers.get(3)).toBe('SAFARI BALL')
  })

  it('reads the native item pocket into the requested script variable', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 130, true)
    view.setUint16(12, 5, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 2, true)
    const runtime = createTestPokemonRuntime()
    runtime.itemCatalog = createTestItemCatalog()
    const state = createFieldScriptState('male', '', { pokemonRuntime: runtime })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(2)
  })

  it('reads item quantity, pocket and ROM pocket name through their native commands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 669, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 130, true)
    view.setUint16(18, 17, true)
    view.setUint16(20, 0x4002, true)
    view.setUint16(22, 195, true)
    map.fieldScripts.bytes[24] = 4
    view.setUint16(25, 0x4003, true)
    view.setUint16(27, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.inventory.set(17, 7)
    state.variables.set(0x4000, 17)
    state.variables.set(0x4003, 1)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(7)
    expect(state.variables.get(0x4002)).toBe(1)
    expect(state.buffers.get(4)).toBe('MEDICAMENTS')
  })

  it('suspends for yes-no and ROM-authored list choices', () => {
    const map = createBedroomMap()
    map.messages[3] = 'Retirer'
    map.messages[4] = 'Deposer'
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 63, true)
    view.setUint16(12, 0x800c, true)
    view.setUint16(14, 750, true)
    map.fieldScripts.bytes.set([1, 1, 0, 1], 16)
    view.setUint16(20, 0x800c, true)
    view.setUint16(22, 751, true)
    view.setUint16(24, 3, true)
    view.setUint16(26, 255, true)
    view.setUint16(28, 7, true)
    view.setUint16(30, 751, true)
    view.setUint16(32, 4, true)
    view.setUint16(34, 255, true)
    view.setUint16(36, 8, true)
    view.setUint16(38, 752, true)
    view.setUint16(40, 2, true)
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({
      kind: 'choice',
      options: [{ label: 'Oui', value: 0 }, { label: 'Non', value: 1 }],
      cancellable: false,
    })
    runner.choose(0)
    expect(runner.resume()).toEqual({ kind: 'choice', options: [{ label: 'Retirer', value: 7 }, { label: 'Deposer', value: 8 }], cancellable: true })
    runner.choose(0xfffe)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x800c)).toBe(0xfffe)
  })

  it('executes bounded deposits and withdrawals through the generic bank command', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 793, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0x800c, true)
    view.setUint16(16, 793, true)
    view.setUint16(18, 1, true)
    view.setUint16(20, 0x800c, true)
    view.setUint16(22, 2, true)
    const state = createFieldScriptState('male')
    state.money = 5000
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'number', min: 0, max: 5000 })
    runner.enterNumber(1200)
    expect(runner.resume()).toEqual({ kind: 'number', min: 0, max: 1200 })
    runner.enterNumber(200)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect({ money: state.money, bank: state.bankBalance }).toEqual({ money: 4000, bank: 1000 })
  })

  it('writes follower activity and toggles follower movement state through ROM follower commands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    map.fieldScripts.entryOffsets[2] = 20
    view.setUint16(10, 729, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 602, true)
    view.setUint16(16, 1, true)
    view.setUint16(18, 2, true)
    view.setUint16(20, 602, true)
    view.setUint16(22, 0, true)
    view.setUint16(24, 2, true)
    const state = createFieldScriptState('male', '', { followMonActive: true })

    const pauseRunner = createFieldScriptRunner(map, 2, state)
    expect(pauseRunner.resume()).toEqual({ kind: 'followerMovement', action: 'pause', paused: true })
    expect(pauseRunner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.followMonMovementPaused).toBe(true)

    const resumeRunner = createFieldScriptRunner(map, 3, state)
    expect(resumeRunner.resume()).toEqual({ kind: 'followerMovement', action: 'pause', paused: false })
    expect(resumeRunner.resume()).toEqual({ kind: 'ended' })
    expect(state.followMonMovementPaused).toBe(false)
  })

  it('releases only ScriptEnvironment state when a field execution finishes', () => {
    const state = createFieldScriptState('male', '', { followMonActive: true, followMonMovementPaused: true })
    state.variables.set(0x4100, 7)
    state.variables.set(0x8000, 12)
    state.variables.set(0x800d, 4)
    state.pendingPhoneCall = { callerId: 1, parameter1: 2, parameter2: 0 }

    releaseFieldScriptExecutionState(state)

    expect([...state.variables]).toEqual([[0x4100, 7]])
    expect(state.pendingPhoneCall).toBeUndefined()
    expect(state.followMonMovementPaused).toBe(false)
    expect(state.followMonActive).toBe(true)
  })

  it('reinitializes map-local VAR_TEMP registers without erasing story variables', () => {
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 475)
    state.variables.set(0x400f, 12)
    state.variables.set(0x4010, 7)

    setFieldScriptMapState(state, createBedroomMap(), 4, 11, 'north')

    expect([...state.variables]).toEqual([[0x4010, 7]])
  })

  it('waits for follower movement lifecycle even while autonomous movement is paused', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 603, true)
    view.setUint16(12, 2, true)
    const state = createFieldScriptState('male', '', { followMonActive: true })
    state.followMonMovementPaused = true

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'waiting', waitFor: 'followerMovement' })
  })

  it('publishes the native follower movement, byte configuration, and refresh commands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 604, true)
    view.setUint16(12, 48, true)
    view.setUint16(14, 603, true)
    view.setUint16(16, 605, true)
    map.fieldScripts.bytes.set([3, 2], 18)
    view.setUint16(20, 608, true)
    view.setUint16(22, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male', '', { followMonActive: true }))

    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'movement', movement: 48 })
    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'followerMovement' })
    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'configure', parameters: [3, 2] })
    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'refresh' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('routes the standard follower interaction through FacePlayer and opcode 711', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 601, true)
    view.setUint16(12, 711, true)
    view.setUint16(14, 2, true)
    const state = createFieldScriptState('male', '', {
      party: [createTestPokemon(155)],
      pokemonRuntime: createTestPokemonRuntime(),
      followMonActive: true,
    })
    state.flags.add(0x6a)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'facePlayer' })
    expect(runner.resume()).toEqual({ kind: 'followerInteraction', slot: 0, speciesId: 155 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('reads direction signposts and their map metadata without desynchronizing the script', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 55, true)
    map.fieldScripts.bytes.set([2, 1, 42, 0, 0, 0], 12)
    view.setUint16(18, 56, true)
    map.fieldScripts.bytes.set([1, 42, 0], 20)
    view.setUint16(23, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('suspends at a trainer battle with the exact ROM command operands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 213, true)
    view.setUint16(12, 37, true)
    view.setUint16(14, 0x4000, true)
    map.fieldScripts.bytes[16] = 2
    map.fieldScripts.bytes[17] = 1
    view.setUint16(18, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 4)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'trainer', trainerId: 37, trainerParameter: 4, encounterType: 2, battleParameter: 1 },
    })
    expect(() => runner.resume()).toThrow(/attend encore/)
    runner.submitBattleResult(true)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('évalue PartyCheckForDouble depuis les Pokémon réellement aptes au combat', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 222, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const first = createTestPokemon(152)
    const second = createTestPokemon(155)
    const state = createFieldScriptState('male', '', { party: [first, second] })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)

    second.currentHp = 0
    const reducedState = createFieldScriptState('male', '', { party: [first, second] })
    expect(createFieldScriptRunner(map, 1, reducedState).resume()).toEqual({ kind: 'ended' })
    expect(reducedState.variables.get(0x4000)).toBe(0)
    const duoState = createFieldScriptState('male', '', { party: [first, second] })
    expect(createFieldScriptRunner(
      map, 1, duoState, undefined, undefined, undefined, undefined, undefined,
      () => ({ engine: 'double', sessionKind: 'double' }),
    ).resume()).toEqual({ kind: 'ended' })
    expect(duoState.variables.get(0x4000)).toBe(1)

    second.currentHp = second.stats.hp
    const phases: string[] = []
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: (intent) => {
        phases.push(`${intent.format}:${intent.phase}`)
        return intent.partyIndex === 1 ? { code: 'double-locked', reason: 'Second combattant verrouillé.' } : undefined
      },
      vetoPartyMutation: () => undefined,
    }
    const policyState = createFieldScriptState('male', '', { party: [first, second] })
    expect(createFieldScriptRunner(map, 1, policyState, undefined, basePokemonPartyHealingPolicy, policy).resume()).toEqual({ kind: 'ended' })
    expect(policyState.variables.get(0x4000)).toBe(0)
    const duoPolicyState = createFieldScriptState('male', '', { party: [first, second] })
    expect(createFieldScriptRunner(
      map, 1, duoPolicyState, undefined, basePokemonPartyHealingPolicy, policy, undefined, undefined,
      () => ({ engine: 'double', sessionKind: 'double' }),
    ).resume()).toEqual({ kind: 'ended' })
    expect(duoPolicyState.variables.get(0x4000)).toBe(1)
    expect(phases).toEqual(['double:initial', 'double:initial', 'double:initial', 'double:initial'])
  })

  it('décode MultiBattle comme un combat local avec allié et deux adversaires', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(9)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 562, true)
    view.setUint16(2, 700, true)
    view.setUint16(4, 701, true)
    view.setUint16(6, 702, true)
    bytes[8] = 1
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    expect(createFieldScriptRunner(map, 1, createFieldScriptState('male')).resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'multiTrainer', allyTrainerId: 700, opponentTrainerIds: [701, 702], battleParameter: 1 },
    })
  })

  it('reproduit les quatre avatars Salle Union dérivés des trois bits bas du Trainer ID', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 287, true)
    view.setUint16(2, 288, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 0x4000, true)
    view.setUint16(8, 558, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0x4001, true)
    view.setUint16(14, 289, true)
    view.setUint16(16, 0x4001, true)
    view.setUint16(18, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createTestPokemonRuntime() })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect([...state.buffers.entries()].slice(0, 4)).toEqual([
      [0, 'CLASSE 60'], [1, 'CLASSE 6'], [2, 'CLASSE 24'], [3, 'CLASSE 57'],
    ])
    expect(state.variables.get(0x4000)).toBe(60)
    expect(state.variables.get(0x4001)).toBe(3)
    expect(state.unionAvatarSpriteId).toBe(3)
  })

  it('suspend les requêtes DWC et Pal Pad jusqu’au résultat sérialisable du serveur', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 564, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 565, true)
    view.setUint16(6, 0x4001, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 1, state)

    const profileStep = runner.resume()
    expect(profileStep.kind).toBe('multiplayer')
    if (profileStep.kind !== 'multiplayer') throw new Error('Étape multijoueur attendue.')
    expect(profileStep.request).toMatchObject({
      romOpcode: 564,
      kind: 'profile-status',
      player: { trainerId: 0x12345678, name: 'JO' },
    })
    expect(() => runner.resume()).toThrow(/service multijoueur/)
    runner.submitMultiplayerResult({
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: profileStep.request.requestId,
      kind: profileStep.request.kind,
      romResult: 1,
      status: 'completed',
    })

    const friendsStep = runner.resume()
    expect(friendsStep.kind).toBe('multiplayer')
    if (friendsStep.kind !== 'multiplayer') throw new Error('Étape multijoueur attendue.')
    runner.submitMultiplayerResult({
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: friendsStep.request.requestId,
      kind: friendsStep.request.kind,
      romResult: 12,
      friendRosterCount: 12,
      status: 'completed',
    })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(12)
  })

  it('écrit le résultat natif lu ensuite par CheckBattleWon', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 213, true)
    view.setUint16(12, 37, true)
    view.setUint16(14, 0, true)
    map.fieldScripts.bytes[16] = 0
    map.fieldScripts.bytes[17] = 0
    view.setUint16(18, 220, true)
    view.setUint16(20, 0x4000, true)
    view.setUint16(22, 2, true)
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume().kind).toBe('battle')
    runner.submitBattleResult(false)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('propage le résultat d’un combat sauvage lancé par CallStd vers StaticWildWonOrCaughtCheck du parent', () => {
    const map = createBedroomMap()
    const parentBytes = new Uint8Array(11)
    const parentView = new DataView(parentBytes.buffer)
    parentView.setUint16(0, 20, true)
    parentView.setUint16(2, 3200, true)
    parentView.setUint16(4, 221, true)
    parentView.setUint16(6, 0x4000, true)
    parentBytes[8] = 0
    parentView.setUint16(9, 2, true)
    map.fieldScripts = { bank: 1, bytes: parentBytes, headerSize: 0, entryOffsets: [0] }

    const standardBytes = new Uint8Array(9)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 589, true)
    standardView.setUint16(2, 101, true)
    standardView.setUint16(4, 0x4001, true)
    standardBytes[6] = 0
    standardView.setUint16(7, 2, true)
    map.standardScripts = {
      bank: 3,
      baseScriptId: 3200,
      bytes: standardBytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }

    const state = createFieldScriptState('male')
    state.variables.set(0x4001, 23)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'wild', speciesId: 101, level: 23, battleParameter: 0 },
    })
    runner.submitBattleResult(true)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('conserve le résultat pour un nouveau CallStd créé après la bataille', () => {
    const map = createBedroomMap()
    const parentBytes = new Uint8Array(13)
    const parentView = new DataView(parentBytes.buffer)
    parentView.setUint16(0, 589, true)
    parentView.setUint16(2, 101, true)
    parentView.setUint16(4, 23, true)
    parentBytes[6] = 0
    parentView.setUint16(7, 20, true)
    parentView.setUint16(9, 3200, true)
    parentView.setUint16(11, 2, true)
    map.fieldScripts = { bank: 1, bytes: parentBytes, headerSize: 0, entryOffsets: [0] }

    const standardBytes = new Uint8Array(7)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 221, true)
    standardView.setUint16(2, 0x4000, true)
    standardBytes[4] = 0
    standardView.setUint16(5, 2, true)
    map.standardScripts = {
      bank: 3,
      baseScriptId: 3200,
      bytes: standardBytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }

    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'wild', speciesId: 101, level: 23, battleParameter: 0 },
    })
    runner.submitBattleResult(true)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('suspends at a wild battle with the exact ROM command operands', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 589, true)
    view.setUint16(12, 152, true)
    view.setUint16(14, 0x4000, true)
    map.fieldScripts.bytes[16] = 3
    view.setUint16(17, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 5)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'wild', speciesId: 152, level: 5, battleParameter: 3 },
    })
  })

  it('runs a directly addressed ROM standard script', () => {
    const map = createBedroomMap()
    const standardBytes = new Uint8Array(8)
    const standardView = new DataView(standardBytes.buffer)
    standardView.setUint16(0, 213, true)
    standardView.setUint16(2, 12, true)
    standardView.setUint16(4, 3, true)
    map.standardScripts = {
      bank: 3,
      baseScriptId: 3200,
      bytes: standardBytes,
      headerSize: 0,
      entryOffsets: [0],
      messages: {},
    }

    expect(createFieldScriptRunner(map, 3200, createFieldScriptState('male')).resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'trainer', trainerId: 12, trainerParameter: 3, encounterType: 0, battleParameter: 0 },
    })
  })

  it('does not replace an unavailable Mystery Gift standard script with a no-op', () => {
    const map = createBedroomMap()

    expect(() => createFieldScriptRunner(map, 10200, createFieldScriptState('male'))).toThrow('n’existe pas')
  })

  it('uses the live time and current lead slot required by Route 29 ROM scripts', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 379, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 529, true)
    view.setUint16(16, 0x4001, true)
    view.setUint16(18, 2, true)
    const fainted = createTestPokemon(152)
    fainted.currentHp = 0
    const pokemonRuntime = createTestPokemonRuntime()
    pokemonRuntime.now = () => new Date(2026, 2, 12, 18)
    const state = createFieldScriptState('male', '', {
      party: [fainted, createTestPokemon(155)],
      pokemonRuntime,
      timeOfDay: 4,
    })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(2)
    expect(state.variables.get(0x4001)).toBe(1)
  })

  it('stops at the parameterless ROM catching tutorial battle', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 251, true)

    expect(createFieldScriptRunner(map, 2, createFieldScriptState('male')).resume()).toEqual({
      kind: 'battle',
      battle: { kind: 'tutorial' },
    })
  })

  it('runs the starter selection as a ROM choice and persists the complete HGSS party data', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 167, true)
    view.setUint16(12, 206, true)
    view.setUint16(14, 0x4000, true)
    view.setUint16(16, 203, true)
    map.fieldScripts.bytes[18] = 1
    view.setUint16(19, 30, true)
    view.setUint16(21, 0x6a, true)
    view.setUint16(23, 2, true)
    const rng = createHgssLcrng(0)
    const state = createFieldScriptState('male', 'JO', {
      pokemonRuntime: {
        catalog: createPokemonTestCatalog(),
        rng,
        trainer: { id: 0x12345678, name: 'JO', gender: 'male' },
        language: 3,
        gameVersion: 7,
        now: () => new Date(2026, 2, 12),
      },
    })
    state.flags.add(0x160)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({
      kind: 'choice',
      options: [
        { label: 'GERMIGNON', value: 0 },
        { label: 'HERICENDRE', value: 1 },
        { label: 'KAIMINUS', value: 2 },
      ],
      cancellable: false,
      presentation: 'starter',
    })
    runner.choose(1)
    expect(state.followMonActive).toBe(false)
    expect(runner.resume()).toEqual({
      kind: 'mapProps',
      props: [
        { modelId: 0x8d, x: 131, y: 0, z: 65 },
        { modelId: 0x8d, x: 141, y: 0, z: 65 },
      ],
    })
    expect(state.followMonActive).toBe(false)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.starterChoice).toBe(1)
    expect(state.followMonActive).toBe(true)
    expect(state.party.members).toHaveLength(1)
    expect(state.party.members).toMatchObject([{
      speciesId: 155,
      speciesName: 'HERICENDRE',
      level: 5,
      personality: 0xe97e0000,
      individualValues: { hp: 17, attack: 19, defense: 20, speed: 16, specialAttack: 13, specialDefense: 12 },
      originalTrainer: { id: 0x12345678, name: 'JO', gender: 'male' },
      origin: {
        language: 3,
        gameVersion: 7,
        metLocation: 126,
        metLevel: 5,
        metTerrain: 12,
        metDate: { year: 2026, month: 3, day: 12 },
      },
      ballId: 4,
      moves: [{ moveId: 33, pp: 35 }, { moveId: 43, pp: 30 }],
    }])
    expect(rng.getSeed()).toBe(0x31b0dde4)
    expect([...state.pokedex.caughtSpeciesIds]).toEqual([155])
    expect(state.flags.has(0x6a)).toBe(true)
    expect(state.flags.has(0x160)).toBe(true)
    expect(state.variables.has(0x4108)).toBe(false)
    expect(state.variables.has(0x4072)).toBe(false)
    expect(state.variables.get(0x4000)).toBe(155)
    expect(state.buffers.get(1)).toBe('HERICENDRE')
  })

  it('consulte la politique d’équipe avant de publier le starter', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 167, true)
    view.setUint16(12, 2, true)
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createTestPokemonRuntime() })
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: (intent) => intent.reason === 'starter'
        ? { code: 'starter-locked', reason: 'Starter verrouillé.' }
        : undefined,
    }
    const runner = createFieldScriptRunner(map, 2, state, undefined, basePokemonPartyHealingPolicy, policy)

    expect(runner.resume()).toMatchObject({ kind: 'choice', presentation: 'starter' })
    expect(() => runner.choose(1)).toThrow(PokemonTeamPolicyVetoError)
    expect(state.starterChoice).toBeUndefined()
    expect(state.party.members).toEqual([])
    expect(state.pokedex.caughtSpeciesIds.size).toBe(0)
  })

  it.each([[0, 152], [1, 155], [2, 158]])('returns starter species %s through GetStarterChoice', (starterChoice, speciesId) => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 206, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 2, true)
    const state = createFieldScriptState('male', '', { starterChoice })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(speciesId)
  })

  it('registers Pokégear cards and phone contacts without losing script alignment', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 145, true)
    map.fieldScripts.bytes[12] = 1
    view.setUint16(13, 146, true)
    view.setUint16(15, 0x4000, true)
    view.setUint16(17, 147, true)
    view.setUint16(19, 1, true)
    view.setUint16(21, 0x4001, true)
    view.setUint16(23, 147, true)
    view.setUint16(25, 2, true)
    view.setUint16(27, 0x4002, true)
    view.setUint16(29, 45, true)
    map.fieldScripts.bytes[31] = 2
    view.setUint16(32, 2, true)
    const state = createFieldScriptState('male')
    state.variables.set(0x4000, 1)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(state.pokegearCards.has(1)).toBe(true)
    expect(state.phoneContacts.has(1)).toBe(true)
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('runs ScrCmd_Random from the shared HGSS LCRNG and respects its modulo operand', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 380, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 100, true)
    view.setUint16(16, 2, true)
    const pokemonRuntime = createTestPokemonRuntime()
    const state = createFieldScriptState('male', '', { pokemonRuntime })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(pokemonRuntime.rng.getSeed()).toBe(0x6073)
  })

  it('keeps the ROM lottery commands aligned and searches party before PC on equal matches', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    let cursor = 10
    const writeCommand = (opcode: number, ...operands: number[]) => {
      view.setUint16(cursor, opcode, true)
      cursor += 2
      for (const operand of operands) {
        view.setUint16(cursor, operand, true)
        cursor += 2
      }
    }
    writeCommand(380, 0x4000, 10)
    writeCommand(505)
    writeCommand(503, 0x4001)
    writeCommand(504, 0x4002, 0x4003, 0x4004, 0x403c)
    writeCommand(2)

    const pokemonRuntime = createTestPokemonRuntime()
    const partyPokemon = createTestPokemon()
    partyPokemon.originalTrainer.id = 105
    const boxedPokemon = createTestPokemon(155)
    boxedPokemon.originalTrainer.id = 105
    const state = createFieldScriptState('male', '', { pokemonRuntime, party: [partyPokemon] })
    state.variables.set(0x403d, 1)
    state.pokemonStorage.boxes[2]![4] = boxedPokemon

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x403c)).toBe(0x5271)
    expect(state.variables.get(0x4001)).toBe(0x5271)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(state.variables.get(0x4003)).toBe(3)
    expect(state.variables.get(0x4004)).toBe(0)
    expect(pokemonRuntime.rng.getSeed()).toBe(0x52713895)
  })

  it('creates the exact scripted Togepi egg and Spiky-eared Pichu gifts', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    let cursor = 10
    const writeCommand = (opcode: number, ...operands: number[]) => {
      view.setUint16(cursor, opcode, true)
      cursor += 2
      for (const operand of operands) {
        view.setUint16(cursor, operand, true)
        cursor += 2
      }
    }
    writeCommand(776)
    writeCommand(777, 0, 0x4000)
    writeCommand(778)
    writeCommand(779, 1510, 0x4001)
    writeCommand(2)
    const pokemonRuntime = createTestPokemonRuntime()
    extendRuntimeWithGiftPokemon(pokemonRuntime)
    const state = createFieldScriptState('male', '', { pokemonRuntime })
    state.radioMusicSequenceId = 1510

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.party.members[0]).toMatchObject({
      speciesId: 175,
      level: 1,
      nickname: 'ŒUF',
      nicknameSource: 'local-ref',
      isEgg: true,
      friendship: 10,
      ballId: 4,
      origin: { metLocation: 2013, metLevel: 0 },
    })
    expect(state.party.members[0]?.moves.at(-1)?.moveId).toBe(326)
    expect(state.togepiEggIdentity).toEqual({
      personality: state.party.members[0]?.personality,
      gender: state.party.members[0]?.gender,
    })
    expect(state.party.members[1]).toMatchObject({
      speciesId: 172,
      level: 30,
      form: 1,
      gender: 'female',
      nature: 4,
      heldItemId: 300,
      ballId: 4,
      origin: { metLocation: map.header.mapSection, metLevel: 30, metTerrain: 24 },
    })
    expect(state.party.members[1]?.moves.map((move) => move.moveId)).toEqual([270, 344, 207, 220])
    expect(state.pokedex.caughtSpeciesIds.has(172)).toBe(true)
  })

  it("runs the native EggHatchAnim task and persists Togepi's Elm trigger", () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[0] = 10
    view.setUint16(10, 776, true)
    view.setUint16(12, 2, true)
    map.fieldScripts.entryOffsets[1] = 20
    view.setUint16(20, 369, true)
    view.setUint16(22, 149, true)
    map.fieldScripts.bytes[24] = 0
    view.setUint16(25, 2, true)
    const pokemonRuntime = createTestPokemonRuntime()
    extendRuntimeWithGiftPokemon(pokemonRuntime)
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    const egg = state.party.members[0]!
    egg.friendship = 0
    const runner = createFieldScriptRunner(map, 2, state)
    expect(runner.resume()).toMatchObject({ kind: 'eggHatch', partySlot: 0, pokemon: { speciesId: 175, isEgg: true } })
    runner.finishEggHatch(undefined)

    expect(state.party.members[0]).toMatchObject({
      speciesId: 175,
      isEgg: false,
      friendship: 120,
      nickname: undefined,
      nicknameSource: undefined,
    })
    expect(state.pokedex.caughtSpeciesIds.has(175)).toBe(true)
    expect(state.flags.has(0x983)).toBe(true)
    expect(state.phoneCallTriggers.has(0)).toBe(true)
    expect(state.gameStats.get(12)).toBe(1)
    expect(state.gameScore).toBe(7)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.phoneCallTriggers.has(0)).toBe(false)
  })

  it('creates, validates and returns the ROM Kenya loan Pokémon', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 362, true)
    map.fieldScripts.bytes[12] = 7
    map.fieldScripts.bytes[13] = 20
    view.setUint16(14, 101, true)
    view.setUint16(16, 2, true)
    const pokemonRuntime = createTestPokemonRuntime()
    pokemonRuntime.mapSectionForMapId = (mapId) => mapId === 101 ? 44 : undefined
    pokemonRuntime.npcTradeCatalog = Array.from({ length: 8 }, (_, tradeId) => ({
      tradeId,
      givenSpeciesId: tradeId === 7 ? 21 : 1,
      requestedSpeciesId: 1,
      individualValues: { hp: 12, attack: 13, defense: 14, speed: 15, specialAttack: 16, specialDefense: 17 },
      ability: 0,
      originalTrainerId: 0x12345678,
      personality: 0x10203040,
      heldItemId: tradeId === 7 ? 137 : 0,
      originalTrainerGender: 'male',
      language: 3,
      nickname: tradeId === 7 ? 'KENYA' : 'PRÊT',
      originalTrainerName: 'RANDY',
      unusedFlag: 0,
    }))
    pokemonRuntime.itemCatalog = {
      pocketNames: [],
      items: Array.from({ length: 138 }, (_, itemId) => ({ itemId, fieldPocket: itemId === 137 ? 5 : 0 } as never)),
    }
    const state = createFieldScriptState('male', '', { pokemonRuntime, party: [createTestPokemon()] })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.party.members[1]).toMatchObject({
      speciesId: 21,
      nickname: 'KENYA',
      nicknameSource: 'local-ref',
      level: 20,
      heldItemId: 137,
      mailIdentity: 'kenya',
      personality: 0x10203040,
      originalTrainer: { id: 0x12345678, name: 'RANDY', gender: 'male' },
      individualValues: { hp: 12, attack: 13, defense: 14, speed: 15, specialAttack: 16, specialDefense: 17 },
      origin: { metLocation: 44, metLevel: 20, metTerrain: 0, language: 3 },
    })
    expect(state.pokedex.caughtSpeciesIds.has(21)).toBe(true)

    view.setUint16(10, 781, true)
    view.setUint16(12, 0x4001, true)
    view.setUint16(14, 2, true)
    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(1)

    view.setUint16(10, 426, true)
    view.setUint16(12, 0x4002, true)
    view.setUint16(14, 1, true)
    map.fieldScripts.bytes[16] = 1
    view.setUint16(17, 2, true)
    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4002)).toBe(1)

    view.setUint16(10, 363, true)
    map.fieldScripts.bytes[12] = 7
    view.setUint16(13, 1, true)
    view.setUint16(15, 0x4000, true)
    view.setUint16(17, 2, true)
    const loanPolicy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'loan-locked', reason: 'Retour du prêt verrouillé.' }),
    }
    expect(createFieldScriptRunner(map, 2, state, undefined, basePokemonPartyHealingPolicy, loanPolicy).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(4)
    expect(state.party.members[1]).toMatchObject({ heldItemId: 137, mailIdentity: 'kenya' })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(2)

    state.party.members[1]!.heldItemId = 0
    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)

    state.mailboxMailIdentities[4] = 'kenya'
    view.setUint16(10, 781, true)
    view.setUint16(12, 0x4001, true)
    view.setUint16(14, 2, true)
    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(1)

    view.setUint16(10, 364, true)
    view.setUint16(12, 1, true)
    view.setUint16(14, 2, true)
    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.party.members).toHaveLength(1)
  })

  it('executes the ROM Pokédex and party query commands used by later Johto scripts', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    let cursor = 10
    const writeCommand = (opcode: number, ...operands: number[]) => {
      view.setUint16(cursor, opcode, true)
      cursor += 2
      for (const operand of operands) {
        view.setUint16(cursor, operand, true)
        cursor += 2
      }
    }
    writeCommand(243, 0x4000) // CountJohtoDexSeen
    writeCommand(356, 0x4001) // PartyCountNotEgg
    writeCommand(545, 0x4002) // nombre de formes de Zarbi vues
    writeCommand(688, 0x4003, 155) // GetPartySlotWithFatefulEncounter
    writeCommand(770, 0x4004) // CheckSeenAllLetterUnown
    writeCommand(2)

    const runtime = createTestPokemonRuntime()
    runtime.pokedexCatalog = {
      johtoDexNumbers: Object.assign(Array<number>(494).fill(0), { 152: 1, 155: 4, 201: 61 }),
      uiMessages: [], heartGoldDescriptions: [], typeNames: [], categoryNames: [], heightLabels: [], weightLabels: [], heightsDecimeters: [], weightsTenthsKg: [],
    }
    const ordinary = createTestPokemon(152)
    const eventPokemon = createTestPokemon(155)
    eventPokemon.fatefulEncounter = true
    const egg = createTestPokemon(158)
    egg.isEgg = true
    const state = createFieldScriptState('male', '', { party: [ordinary, eventPokemon, egg], pokemonRuntime: runtime })
    state.pokedex.seenSpeciesIds.add(152)
    state.pokedex.seenSpeciesIds.add(201)
    state.pokedex.seenForms.set(201, Array.from({ length: 26 }, (_, form) => form))

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(2)
    expect(state.variables.get(0x4001)).toBe(2)
    expect(state.variables.get(0x4002)).toBe(26)
    expect(state.variables.get(0x4003)).toBe(1)
    expect(state.variables.get(0x4004)).toBe(1)
  })

  it('checks whether an item is a TM or HM without losing script alignment', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 129, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 129, true)
    view.setUint16(18, 17, true)
    view.setUint16(20, 0x4002, true)
    view.setUint16(22, 45, true)
    map.fieldScripts.bytes[24] = 2
    view.setUint16(25, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.variables.set(0x4000, 500)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 2, text: 'Message francais de la ROM' })
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('targets the current actor through VAR_SPECIAL_LAST_TALKED', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.events!.objects[0]!.eventFlag = 1081
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 101, true)
    view.setUint16(12, 0x800d, true)
    view.setUint16(14, 2, true)
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 2, state, 7)

    expect(runner.resume()).toEqual({ kind: 'objectVisibility', objectId: 7, visible: false })
    expect(state.hiddenObjectIds.has(7)).toBe(true)
    expect(state.flags.has(1081)).toBe(true)
  })

  it('limite HidePerson a la carte courante comme MapObject_Delete dans la ROM', () => {
    const firstMap = createBedroomMapWithNpc()
    const secondMap = createBedroomMapWithNpc()
    secondMap.id = firstMap.id + 1
    const view = new DataView(firstMap.fieldScripts.bytes.buffer)
    firstMap.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 101, true)
    view.setUint16(12, 7, true)
    view.setUint16(14, 2, true)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, firstMap, 0, 0, 'south')

    expect(createFieldScriptRunner(firstMap, 2, state).resume()).toEqual({ kind: 'objectVisibility', objectId: 7, visible: false })
    expect(state.hiddenObjectIds.has(7)).toBe(true)

    setFieldScriptMapState(state, secondMap, 0, 0, 'south')
    expect(state.hiddenObjectIds.size).toBe(0)
  })

  it('libere l’inhibition temporaire du suiveur a chaque transition de carte native', () => {
    const map = createBedroomMap()
    const state = createFieldScriptState('male')
    state.followMonInhibited = true

    setFieldScriptMapState(state, map, 0, 0, 'south')

    expect(state.followMonInhibited).toBe(false)
  })

  it('distingue la visibilité temporaire 374 de la suppression HidePerson', () => {
    const map = createBedroomMapWithNpc()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 374, true)
    view.setUint16(2, 7, true)
    view.setUint16(4, 375, true)
    view.setUint16(6, 7, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'objectVisibility', objectId: 7, visible: false })
    expect(state.invisibleObjectIds.has(7)).toBe(true)
    expect(state.hiddenObjectIds.has(7)).toBe(false)
    expect(runner.resume()).toEqual({ kind: 'objectVisibility', objectId: 7, visible: true })
    expect(state.invisibleObjectIds.has(7)).toBe(false)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('reproduit le résultat inversé des combats statiques et la validation système 530', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(19)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 589, true)
    view.setUint16(2, 101, true)
    view.setUint16(4, 23, true)
    bytes[6] = 0
    view.setUint16(7, 221, true)
    view.setUint16(9, 0x4000, true)
    bytes[11] = 0
    view.setUint16(12, 530, true)
    view.setUint16(14, 0, true)
    bytes[16] = 1
    view.setUint16(17, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'battle', battle: { kind: 'wild', speciesId: 101, level: 23, battleParameter: 0 } })
    runner.submitBattleResult(true)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4036)).toBe(0x6208)
  })

  it('reads MovePersonFacing XYZ operands without treating height as the map Z coordinate', () => {
    const map = createBedroomMapWithNpc()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.events!.objects[0] = {
      id: 0, spriteId: 99, movement: 0, type: 0, eventFlag: 0, scriptId: 1,
      facingDirection: 1, xRange: 0, zRange: 0, x: 6, z: 5,
    }
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 339, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 4, true)
    view.setUint16(16, 0, true)
    view.setUint16(18, 5, true)
    view.setUint16(20, 3, true)
    view.setUint16(22, 2, true)
    const state = createFieldScriptState('male')
    setFieldScriptMapState(state, map, 0, 0, 'south')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'objectState', objectId: 0, x: 4, z: 5, direction: 'east' })
    expect(state.objects.get(0)).toEqual({ x: 4, z: 5, direction: 'east', movement: 0 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it.each([
    { flags: [], hasParty: false, expectedCount: 3 },
    { flags: [], hasParty: true, expectedCount: 2 },
    { flags: [0x99], hasParty: true, expectedCount: 1 },
    { flags: [0x73], hasParty: false, expectedCount: 0 },
  ])('loads $expectedCount starter-ball MapProps from opcode 621', ({ flags, hasParty, expectedCount }) => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 621, true)
    view.setUint16(12, 2, true)
    const state = createFieldScriptState('male', '', { party: hasParty ? [createTestPokemon()] : [] })
    for (const flag of flags) state.flags.add(flag)
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({
      kind: 'mapProps',
      props: [
        { modelId: 0x8d, x: 131, y: 0, z: 65 },
        { modelId: 0x8d, x: 141, y: 0, z: 65 },
        { modelId: 0x8d, x: 136, y: 0, z: 72 },
      ].slice(0, expectedCount),
    })
    expect(state.mapProps).toHaveLength(expectedCount)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it.each([
    [0, 152],
    [1, 155],
    [2, 158],
  ])('keeps starter choice %i tied to ROM species %i', (choice, speciesId) => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 167, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume().kind).toBe('choice')
    runner.choose(choice)
    expect(state.party.members[0]?.speciesId).toBe(speciesId)
    expect(state.pokedex.caughtSpeciesIds.has(speciesId)).toBe(true)
  })

  it.each([254, 152])('keeps transformed starter %i tied to its native story choice', (storySpeciesId) => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 131, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 206, true)
    view.setUint16(16, 0x4001, true)
    view.setUint16(18, 2, true)
    const state = createFieldScriptState('male', '', {
      starterChoice: 1,
      starterStorySpeciesId: storySpeciesId,
    })
    state.variables.set(0x4000, storySpeciesId)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.starterChoice).toBe(1)
    expect(state.starterStorySpeciesId).toBe(storySpeciesId)
    expect(state.variables.get(0x4001)).toBe(155)

    state.variables.set(0x4000, 25)
    expect(() => createFieldScriptRunner(map, 2, state).resume()).toThrow('Starter HGSS 25 invalide')
  })

  it('exposes screen fades and waits their ROM-authored duration before continuing', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 174, true)
    view.setUint16(12, 8, true)
    view.setUint16(14, 1, true)
    view.setUint16(16, 2, true)
    view.setUint16(18, 0x7fff, true)
    view.setUint16(20, 175, true)
    view.setUint16(22, 41, true)
    view.setUint16(24, 0x4000, true)
    view.setUint16(26, 7, true)
    view.setUint16(28, 2, true)
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'screenFade', durationFrames: 8, type: 2, color: 0x7fff })
    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'timer', frames: 8 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(7)
  })

  it('resolves external standard message banks selected by ROM variables', () => {
    const map = createBedroomMap()
    map.externalMessages = { 752: { 4: 'Message externe' } }
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 438, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0x4000, true)
    view.setUint16(16, 440, true)
    view.setUint16(18, 0x4000, true)
    view.setUint16(20, 4, true)
    view.setUint16(22, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 4, text: 'Message externe' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('persists ROM item gifts and emits direct script warps', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 125, true)
    view.setUint16(12, 4, true)
    view.setUint16(14, 2, true)
    view.setUint16(16, 0x4000, true)
    view.setUint16(18, 176, true)
    view.setUint16(20, 63, true)
    view.setUint16(22, 0, true)
    view.setUint16(24, 3, true)
    view.setUint16(26, 2, true)
    view.setUint16(28, 3, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 2, state)

    expect(runner.resume()).toEqual({ kind: 'warp', mapId: 63, x: 3, z: 2, direction: 'east' })
    expect(state.inventory.get(4)).toBe(2)
    expect(state.variables.get(0x4000)).toBe(1)
  })

  it('removes a ROM item and reports the result without desynchronizing', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 126, true)
    view.setUint16(12, 4, true)
    view.setUint16(14, 2, true)
    view.setUint16(16, 0x4000, true)
    view.setUint16(18, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.inventory.set(4, 2)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.inventory.has(4)).toBe(false)
    expect(state.variables.get(0x4000)).toBe(1)
  })

  it('applique la pile CT/CS native à GiveItem et HasSpaceForItem', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 125, true)
    view.setUint16(12, 328, true)
    view.setUint16(14, 1, true)
    view.setUint16(16, 0x4000, true)
    view.setUint16(18, 127, true)
    view.setUint16(20, 328, true)
    view.setUint16(22, 1, true)
    view.setUint16(24, 0x4001, true)
    view.setUint16(26, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.inventory.set(328, 99)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.inventory.get(328)).toBe(99)
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4001)).toBe(0)
  })

  it('compte et sélectionne les fossiles dans l’ordre exact de la table ROM', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 429, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 432, true)
    view.setUint16(16, 0x4001, true)
    view.setUint16(18, 103, true)
    view.setUint16(20, 433, true)
    view.setUint16(22, 0x4002, true)
    view.setUint16(24, 0x4003, true)
    view.setUint16(26, 2, true)
    view.setUint16(28, 2, true)
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.inventory.set(103, 1)
    state.inventory.set(101, 2)
    state.inventory.set(99, 3)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(6)
    expect(state.variables.get(0x4001)).toBe(142)
    expect(state.variables.get(0x4002)).toBe(101)
    expect(state.variables.get(0x4003)).toBe(1)
  })

  it('traite une file Cadeau Mystère vide et assainit l’équipe pour la communication DS', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 489, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 489, true)
    view.setUint16(16, 1, true)
    view.setUint16(18, 0x4000, true)
    view.setUint16(20, 689, true)
    view.setUint16(22, 0x4001, true)
    view.setUint16(24, 2, true)
    const pokemon = createTestPokemon()
    pokemon.speciesId = 487
    pokemon.form = 1
    pokemon.heldItemId = 112
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime(), party: [pokemon] })

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.party.members[0]).toMatchObject({ form: 0, heldItemId: 0 })
    expect(state.inventory.get(112)).toBe(1)
  })

  it('ajoute au score GameStats le modificateur exact de l’événement ROM', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 515, true)
    view.setUint16(12, 25, true)
    view.setUint16(14, 515, true)
    view.setUint16(16, 9, true)
    view.setUint16(18, 2, true)
    const state = createFieldScriptState('male')

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.gameScore).toBe(502)
  })

  it('calcule les cinq étoiles de Carte Dresseur depuis les états natifs', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 590, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 2, true)
    const state = createFieldScriptState('male')
    const mythical = new Set([151, 251, 385, 386, 489, 490, 491, 492, 493])
    for (let speciesId = 1; speciesId <= 493; speciesId += 1) {
      if (!mythical.has(speciesId)) state.pokedex.caughtSpeciesIds.add(speciesId)
    }
    state.flags.add(0x964)
    state.flags.add(0x0f1)
    state.flags.add(0x184)
    state.frontierRecords.set(4, 100)

    expect(createFieldScriptRunner(map, 2, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(5)
  })

  it('émet les cibles caméra créées et supprimées par les commandes terrain ROM', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 102, true)
    view.setUint16(12, 130, true)
    view.setUint16(14, 72, true)
    view.setUint16(16, 103, true)
    view.setUint16(18, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'cameraTarget', target: 'position', x: 130, z: 72 })
    expect(runner.resume()).toEqual({ kind: 'cameraTarget', target: 'player' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('conserve les quatre paramètres natifs du tremblement de caméra', () => {
    const map = createBedroomMap()
    const view = new DataView(map.fieldScripts.bytes.buffer)
    map.fieldScripts.entryOffsets[1] = 10
    view.setUint16(10, 561, true)
    view.setUint16(12, 2, true)
    view.setUint16(14, 1, true)
    view.setUint16(16, 3, true)
    view.setUint16(18, 8, true)
    view.setUint16(20, 2, true)
    const runner = createFieldScriptRunner(map, 2, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'screenShake', x: 2, y: 1, repeats: 3, durationFrames: 8 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('reproduit le bloc Save_Gymmick et les résultats des poubelles de Carmin-sur-Mer', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(30)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 320, true); cursor += 2
    for (const canId of [0, 1, 2]) {
      view.setUint16(cursor, 322, true); cursor += 2
      bytes[cursor++] = canId
      view.setUint16(cursor, 0x4000 + canId, true); cursor += 2
    }
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes: bytes.subarray(0, cursor + 2), headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime(7) })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 3, action: 'init' })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.gymmick.type).toBe(3)
    expect(state.gymmick.data).toHaveLength(0x20)
    const firstSwitch = state.gymmick.data[0]!
    const secondSwitch = state.gymmick.data[1]!
    for (const canId of [0, 1, 2]) {
      expect(state.variables.get(0x4000 + canId)).toBe(canId === firstSwitch ? 1 : 0)
    }
    expect(firstSwitch).toBeLessThan(15)
    expect(secondSwitch).toBeLessThan(15)
  })

  it('initialise et commute les mécanismes d’arène avec le format brut de la ROM', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(24)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    for (const opcode of [324, 325, 325, 326]) {
      view.setUint16(cursor, opcode, true); cursor += 2
    }
    view.setUint16(cursor, 328, true); cursor += 2
    bytes[cursor++] = 1
    view.setUint16(cursor, 329, true); cursor += 2
    view.setUint16(cursor, 2, true); cursor += 2
    map.fieldScripts = { bank: 1, bytes: bytes.subarray(0, cursor), headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 4, action: 'init' })
    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 4, action: 'raiseElevator' })
    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 4, action: 'lowerElevator' })
    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 5, action: 'init', spiderNodes: [0, 1, 2, 7], switchState: 0 })
    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 5, action: 'flipSwitch', parameter: 1, spiderNodes: [0, 1, 2, 7], switchState: 2 })
    expect(new DataView(state.gymmick.data.buffer).getUint32(4, true)).toBe(2)
    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 6, action: 'init' })
    expect([...state.gymmick.data.subarray(0, 15)]).toEqual([13, 0, 9, 0, 14, 0, 75, 0, 58, 0, 32, 0, 0, 1, 0])
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('rejoue les destinations Spinarak exactes de l’overlay de l’arène d’Écorcia', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 326, true)
    view.setUint16(2, 327, true)
    bytes[4] = 0
    view.setUint16(5, 327, true)
    bytes[7] = 4
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'gymMechanism', gymType: 5, action: 'init', spiderNodes: [0, 1, 2, 7], switchState: 0 })
    expect(runner.resume()).toMatchObject({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'rideSpinarak',
      parameter: 0,
      destination: { x: 9, z: 23, direction: 'north' },
      followerDestination: { x: 9, z: 24, direction: 'north' },
      switchState: 0,
    })
    expect(state.gymmick.data[0]).toBe(4)
    expect(state.player).toEqual({ x: 9, z: 23, direction: 'north' })
    expect(runner.resume()).toMatchObject({
      kind: 'gymMechanism',
      gymType: 5,
      action: 'rideSpinarak',
      parameter: 4,
      destination: { x: 3, z: 33, direction: 'south' },
      followerDestination: { x: 3, z: 32, direction: 'south' },
    })
    expect(state.gymmick.data[0]).toBe(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('applique et contrôle le déguisement Rocket avec les états avatar natifs', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(22)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 188, true); cursor += 2
    view.setUint16(cursor, 1 << 10, true); cursor += 2
    view.setUint16(cursor, 189, true); cursor += 2
    view.setUint16(cursor, 620, true); cursor += 2
    bytes[cursor++] = 1
    view.setUint16(cursor, 187, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 619, true); cursor += 2
    view.setUint16(cursor, 0x4001, true); cursor += 2
    view.setUint16(cursor, 620, true); cursor += 2
    bytes[cursor++] = 0
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({ kind: 'waiting', waitFor: 'movement' })
    expect(state.playerState).toBe(3)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(3)
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.flags.has(0x969)).toBe(false)
  })

  it('suspend ScrCmd_492 sur les banques Easy Chat et restitue le mot sélectionné', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 492, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 0x4000, true)
    view.setUint16(6, 0x4002, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'easyChat', mode: 0 })
    runner.submitEasyChat(496)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(496)
  })

  it('reproduit les lectures, bornes et application Pokéathlon des opcodes 712/724/725/743', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 725, true); cursor += 2
    bytes[cursor++] = 0
    view.setUint16(cursor, 100, true); cursor += 2
    view.setUint16(cursor, 724, true); cursor += 2
    view.setUint16(cursor, 11, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 712, true); cursor += 2
    bytes[cursor++] = 2
    view.setUint16(cursor, 743, true); cursor += 2
    view.setUint16(cursor, 3, true); cursor += 2
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'pokeathlonApp', app: 'eventRecords' })
    expect(state.variables.get(0x4000)).toBe(100)
    runner.closePokeathlonApp()
    expect(runner.resume()).toMatchObject({ kind: 'pokeathlonApp', app: 'data', dataType: 3 })
    runner.closePokeathlonApp()
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('suspend ScrCmd_158 jusqu’à la fermeture des Boîtes PC', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(5)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 158, true)
    bytes[2] = 2
    view.setUint16(3, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'pcBox', mode: 2 })
    expect(() => runner.resume()).toThrow('Boîtes PC')
    runner.closePcBox()
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('execute le cycle natif du terminal autour de l’application des Boîtes PC', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(23)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    for (const opcode of [500, 501, 308]) { view.setUint16(cursor, opcode, true); cursor += 2; bytes[cursor++] = 90 }
    view.setUint16(cursor, 158, true); cursor += 2; bytes[cursor++] = 0
    for (const opcode of [502, 308, 309]) { view.setUint16(cursor, opcode, true); cursor += 2; bytes[cursor++] = 90 }
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male'))

    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'load', tag: 90, modelIds: [33, 138], animationCount: 2, loopCount: 1, reversed: false })
    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'play', tag: 90, animationIndex: 0 })
    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'wait', tag: 90 })
    expect(runner.resume()).toEqual({ kind: 'pcBox', mode: 0 })
    runner.closePcBox()
    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'play', tag: 90, animationIndex: 1 })
    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'wait', tag: 90 })
    expect(runner.resume()).toEqual({ kind: 'mapPropAnimation', action: 'unload', tag: 90 })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('attache les pistes differees des machines Rocket selon leurs drapeaux ROM', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 710, true)
    view.setUint16(2, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    state.flags.add(0x96c)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'mapPropAnimation',
      action: 'attach',
      bindings: [
        { modelId: 149, animationIndex: 0 },
        { modelId: 152, animationIndex: 1 },
        { modelId: 153, animationIndex: 0 },
      ],
    })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('rejette les modes PC absents de ScrCmd_158 dans la ROM', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(3)
    new DataView(bytes.buffer).setUint16(0, 158, true)
    bytes[2] = 5
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }

    expect(() => createFieldScriptRunner(map, 1, createFieldScriptState('male')).resume()).toThrow('Mode des Boîtes PC')
  })

  it('reproduit la boutique progressive des Cartes Données et ScrCmd_835', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 835, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 772, true)
    view.setUint16(6, 835, true)
    view.setUint16(8, 0x4002, true)
    view.setUint16(10, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.athletePoints = 500
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({
      kind: 'choice',
      options: expect.arrayContaining([{ label: 'OBJET 505 · 500 P.A.', value: 505 }]),
    })
    expect(state.variables.get(0x4000)).toBe(0)
    runner.choose(505)
    expect(state.athletePoints).toBe(0)
    expect(state.pokeathlonDataCards).toEqual(new Set([0]))
    runner.choose(0xfffe)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4002)).toBe(1)
  })

  it('mémorise et relit le premier Pokémon favori avec ScrCmd_671/672', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(14)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 409, true)
    view.setUint16(2, 671, true)
    view.setUint16(4, 672, true)
    view.setUint16(6, 0x4000, true)
    view.setUint16(8, 0x4001, true)
    view.setUint16(10, 0x4002, true)
    view.setUint16(12, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(152)
    pokemon.form = 3
    const state = createFieldScriptState('male', '', { party: [pokemon] })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.favoritePokemon).toEqual({ speciesId: 152, form: 3, isEgg: false })
    expect(state.variables.get(0x4000)).toBe(152)
    expect(state.variables.get(0x4001)).toBe(3)
    expect(state.variables.get(0x4002)).toBe(0)
  })

  it('charge, expose et exécute un échange interne avec les opcodes 470 à 474', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(19)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 470, true)
    bytes[2] = 0
    view.setUint16(3, 471, true)
    view.setUint16(5, 0x4000, true)
    view.setUint16(7, 472, true)
    view.setUint16(9, 0x4001, true)
    view.setUint16(11, 473, true)
    view.setUint16(13, 0, true)
    view.setUint16(15, 474, true)
    view.setUint16(17, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const baseRuntime = createTestPokemonRuntime()
    const runtime: FieldPokemonRuntime = {
      ...baseRuntime,
      npcTradeCatalog: [{
        tradeId: 0,
        givenSpeciesId: 153,
        requestedSpeciesId: 152,
        individualValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
        ability: 0,
        originalTrainerId: 0,
        personality: 0x12345678,
        heldItemId: 1,
        originalTrainerGender: 'female',
        language: 3,
        nickname: 'ROMEO',
        originalTrainerName: 'PNJ',
        unusedFlag: 0,
      }],
    }
    const state = createFieldScriptState('male', '', { party: [createTestPokemon(152)], pokemonRuntime: runtime })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'objectEffect',
      action: 'configure',
      objectIds: [],
      parameters: [473, 0, 0, 152, 153],
    })
    expect(state.variables.get(0x4000)).toBe(153)
    expect(state.variables.get(0x4001)).toBe(152)
    expect(state.party.members[0]).toMatchObject({
      speciesId: 153,
      nickname: 'ROMEO',
      nicknameSource: 'local-ref',
      heldItemId: 1,
      individualValues: { hp: 1, attack: 2, defense: 3, speed: 4, specialAttack: 5, specialDefense: 6 },
    })
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it("valide et restitue l'ordre d'équipe du Castel avec ScrCmd_637/639", () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(26)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 637, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 3, true)
    view.setUint16(6, 0x4000, true)
    view.setUint16(8, 637, true)
    view.setUint16(10, 4, true)
    view.setUint16(12, 0, true)
    view.setUint16(14, 0x4001, true)
    view.setUint16(16, 639, true)
    view.setUint16(18, 0x4002, true)
    view.setUint16(20, 0x4003, true)
    view.setUint16(22, 0x4004, true)
    view.setUint16(24, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', {
      party: [createTestPokemon(152), createTestPokemon(153), createTestPokemon(154)],
      pokemonRuntime: createTestPokemonRuntime(),
    })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'choice', presentation: 'party' })
    expect(state.variables.get(0x4000)).toBe(1)
    runner.choose(2)
    expect(runner.resume()).toMatchObject({ kind: 'choice' })
    runner.choose(0)
    expect(runner.resume()).toMatchObject({ kind: 'choice' })
    runner.choose(1)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect([state.variables.get(0x4002), state.variables.get(0x4003), state.variables.get(0x4004)]).toEqual([2, 0, 1])
  })

  it('crée et libère la session Tour de Combat utilisée par ScrCmd_412', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(18)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 410, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 412, true)
    view.setUint16(8, 1, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 0x4000, true)
    view.setUint16(14, 411, true)
    view.setUint16(16, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', {
      party: [createTestPokemon(152), createTestPokemon(153), createTestPokemon(154)],
      pokemonRuntime: createTestPokemonRuntime(),
    })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.frontierSession).toBeUndefined()
  })

  it('remet une seule fois chaque trophée de 20, 50 et 100 victoires', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 414, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 414, true)
    view.setUint16(6, 0x4001, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    state.frontierRecords.set(0, 50)

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4001)).toBe(2)
    expect([...state.frontierMilestoneRewards]).toEqual([20, 50])
  })

  it('reproduit les signatures Fashion Case des opcodes 255/256', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(18)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 256, true)
    view.setUint16(2, 496, true)
    view.setUint16(4, 255, true)
    view.setUint16(6, 0, true)
    view.setUint16(8, 0x4000, true)
    view.setUint16(10, 255, true)
    view.setUint16(12, 1, true)
    view.setUint16(14, 0x4002, true)
    view.setUint16(16, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')
    state.fashionPortraits.add(1)

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.fashionPortraitEasyChatWords.get(0)).toBe(496)
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4002)).toBe(1)
  })

  it('ouvre la Boutique Athlète du jour ROM et débite des Points Athlète', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(4)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 771, true)
    view.setUint16(2, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.athletePoints = 1000
    const runner = createFieldScriptRunner(map, 1, state)

    const shop = runner.resume()
    expect(shop.kind).toBe('choice')
    if (shop.kind !== 'choice') throw new Error('La Boutique Athlète HGSS ne s’est pas ouverte.')
    expect(shop.options.map(({ value }) => value)).toEqual([486, 489, 490, 33, 83, 51, 0xfffe])
    runner.choose(486)
    expect(state.athletePoints).toBe(800)
    expect(state.inventory.get(486)).toBe(1)
    expect(runner.resume().kind).toBe('choice')
    runner.choose(0xfffe)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('exécute directement les commandes ROM séparées d’achat et de vente', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 275, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 782, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemonRuntime = createTestPokemonRuntime()
    pokemonRuntime.itemCatalog!.items[4]!.price = 200
    pokemonRuntime.itemCatalog!.items[17]!.price = 300
    const state = createFieldScriptState('male', '', { pokemonRuntime })
    state.money = 500
    state.inventory.set(17, 2)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'choice', shop: { mode: 'buy', phase: 'browse' } })
    runner.choose(4)
    expect(runner.resume()).toMatchObject({ kind: 'number', min: 1, max: 2, shop: { mode: 'buy' } })
    runner.enterNumber(2)
    expect(runner.resume()).toMatchObject({ kind: 'choice', options: [{ value: hgssMartConfirmNoChoice }, { value: hgssMartConfirmYesChoice }], shop: { phase: 'confirm' } })
    runner.choose(hgssMartConfirmNoChoice)
    expect(state.money).toBe(500)
    runner.resume()
    runner.choose(4)
    runner.resume()
    runner.enterNumber(1)
    runner.resume()
    runner.choose(hgssMartConfirmYesChoice)
    expect(state.money).toBe(300)
    expect(state.inventory.get(4)).toBe(1)
    runner.resume()
    runner.choose(hgssMartExitChoice)
    expect(runner.resume()).toMatchObject({ kind: 'choice', shop: { mode: 'sell', phase: 'browse' } })
    runner.choose(17)
    expect(runner.resume()).toMatchObject({ kind: 'number', min: 1, max: 2, shop: { mode: 'sell' } })
    runner.enterNumber(2)
    runner.resume()
    runner.choose(hgssMartConfirmYesChoice)
    expect(state.money).toBe(600)
    expect(state.inventory.has(17)).toBe(false)
    runner.resume()
    runner.choose(hgssMartExitChoice)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('exécute les contrôles et remises natifs de la Boîte Mode', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(48)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    const word = (value: number) => { view.setUint16(cursor, value, true); cursor += 2 }
    word(830); word(0x4000)
    word(831); word(0x4001)
    word(404); word(0x4001); word(1); word(0x4002)
    word(403); word(0x4001); word(1)
    word(832); word(0x4003)
    word(833); word(0x4004)
    word(406); word(0x4004)
    word(407); word(0x4004); word(0x4005)
    word(2)
    map.fieldScripts = { bank: 1, bytes: bytes.slice(0, cursor), headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime(7) })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4002)).toBe(1)
    expect(state.fashionAccessories.get(state.variables.get(0x4001)!)).toBe(1)
    expect(state.variables.get(0x4003)).toBe(0)
    expect(state.fashionBackgrounds.has(state.variables.get(0x4004)!)).toBe(true)
    expect(state.variables.get(0x4005)).toBe(0)
  })

  it('compte les capacités et la somme des EV comme les commandes Pokémon natives', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(14)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 396, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 483, true)
    view.setUint16(8, 0x4001, true)
    view.setUint16(10, 0, true)
    view.setUint16(12, 2, true)
    const pokemon = createTestPokemon(152)
    pokemon.effortValues = { hp: 10, attack: 20, defense: 30, speed: 40, specialAttack: 50, specialDefense: 60 }
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { party: [pokemon] })

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(pokemon.moves.length)
    expect(state.variables.get(0x4001)).toBe(210)
  })

  it('exécute le flux natif du Maître des Capacités sans écran tactile', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(24)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 394, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 395, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 399, true); cursor += 2
    bytes[cursor++] = 0
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 397, true); cursor += 2
    view.setUint16(cursor, 0, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 2, true); cursor += 2
    map.fieldScripts = { bank: 1, bytes: bytes.slice(0, cursor), headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(152)
    const runtime = createTestPokemonRuntime()
    const forgottenName = runtime.catalog.moveNames[pokemon.moves[0]!.moveId]
    const initialMoveCount = pokemon.moves.length
    const state = createFieldScriptState('male', '', { party: [pokemon], pokemonRuntime: runtime })
    const runner = createFieldScriptRunner(map, 1, state)

    const selection = runner.resume()
    expect(selection.kind).toBe('choice')
    runner.choose(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(0)).toBe(forgottenName)
    expect(state.party.members[0]!.moves).toHaveLength(initialMoveCount - 1)
  })

  it('lit le MailMessage ROM puis lance le combat natif de la Maison des Dresseurs', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(10)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 809, true)
    view.setUint16(2, 10, true)
    view.setUint16(4, 808, true)
    view.setUint16(6, 10, true)
    view.setUint16(8, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runner = createFieldScriptRunner(map, 1, createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() }))

    expect(runner.resume()).toEqual({ kind: 'message', messageId: 3, text: 'C’est {0100 0, 0} !' })
    expect(runner.resume()).toEqual({ kind: 'battle', battle: { kind: 'trainerHouse', trainerNumber: 10 } })
    runner.submitBattleResult(true)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('applique les quatre commandes natives de Points de Combat', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    for (const [opcode, operands] of [[555, [50]], [557, [40, 0x4000]], [556, [20]], [554, [0x4002]]] as const) {
      view.setUint16(cursor, opcode, true); cursor += 2
      for (const operand of operands) { view.setUint16(cursor, operand, true); cursor += 2 }
    }
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male')

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state).toMatchObject({ battlePoints: 30, battlePointsReceived: 50, battlePointsSpent: 20 })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.variables.get(0x4002)).toBe(30)
  })

  it('suspend les applications natives des puzzles et inscriptions des Ruines d’Alpha', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 713, true)
    bytes[2] = 2
    view.setUint16(3, 714, true)
    bytes[5] = 2
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'alphPuzzle', puzzleIndex: 2, hint: 'AMONITA', tiles: expect.any(Array) })
    expect(state.flags.has(0x979)).toBe(false)
    runner.finishAlphPuzzle(true)
    expect(state.flags.has(0x979)).toBe(true)
    expect(runner.resume()).toMatchObject({ kind: 'alphHiddenRoom', roomIndex: 2, word: 'EAU' })
    runner.closeAlphHiddenRoom()
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('reconnaît les quatre métadonnées événementielles natives du Pokémon suiveur', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(9)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 698, true)
    bytes[2] = 3
    view.setUint16(3, 0, true)
    view.setUint16(5, 0x4000, true)
    view.setUint16(7, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const celebi = createTestPokemon(152)
    celebi.speciesId = 251
    celebi.speciesName = 'CELEBI'
    celebi.fatefulEncounter = true
    state.party.members.push(celebi)

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)

    celebi.fatefulEncounter = false
    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
  })

  it('applique le plafond injecté aux lectures et objets natifs de la Pension', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(40)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    view.setUint16(cursor, 313, true); cursor += 2
    view.setUint16(cursor, 0x4000, true); cursor += 2
    view.setUint16(cursor, 312, true); cursor += 2
    for (const [opcode, result] of [[367, 0x4001], [371, 0x4002]] as const) {
      view.setUint16(cursor, opcode, true); cursor += 2
      view.setUint16(cursor, result, true); cursor += 2
      view.setUint16(cursor, 0, true); cursor += 2
    }
    view.setUint16(cursor, 385, true); cursor += 2
    for (const operand of [3, 4, 5, 0]) { view.setUint16(cursor, operand, true); cursor += 2 }
    for (const [opcode, result] of [[387, 0x4003], [388, 0x4004]] as const) {
      view.setUint16(cursor, opcode, true); cursor += 2
      view.setUint16(cursor, result, true); cursor += 2
    }
    view.setUint16(cursor, 715, true); cursor += 2
    view.setUint16(cursor, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    const first = createTestPokemon(152)
    const second = createTestPokemon(155)
    first.gender = 'female'
    second.gender = 'male'
    second.originalTrainer.id += 1
    state.daycare.mons = [{ pokemon: first, steps: 91 }, { pokemon: second, steps: 0 }]
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 5 }
    const runner = createFieldScriptRunner(map, 1, state, undefined, undefined, undefined, undefined, levelPolicy)

    expect(runner.resume()).toMatchObject({
      kind: 'daycareObjects',
      objects: [
        { objectId: 250, x: 8, z: 5, pokemon: { speciesId: 152 } },
        { objectId: 251, x: 10, z: 9, pokemon: { speciesId: 155 } },
      ],
    })
    expect(state.variables.get(0x4000)).toBe(3)
    expect(state.variables.get(0x4001)).toBe(100)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(state.variables.get(0x4003)).toBe(1)
    expect(state.variables.get(0x4004)).toBe(0)
    expect(state.buffers.get(3)).toBe('GERMIGNON')
    expect(state.buffers.get(4)).toBe('5')
    expect(state.buffers.get(5)).toBe('♀')
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('applique le plafond injecté au retrait d’un pensionnaire', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 361, true)
    view.setUint16(2, 0x4000, true)
    view.setUint16(4, 0, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.daycare.mons[0] = { pokemon: createTestPokemon(152), steps: 100_000 }
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 6 }

    expect(createFieldScriptRunner(
      map, 1, state, undefined, undefined, undefined, undefined, levelPolicy,
    ).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(152)
    expect(state.party.members[0]).toMatchObject({ level: 6, experience: 6 ** 3 })
  })

  it('propage le plafond via les runners d’initialisation de carte et de nouvelle partie', () => {
    const levelPolicy: PokemonLevelPolicy = { resolveLevelCap: () => 6 }
    const createMap = (standard: boolean) => {
      const map = createBedroomMap()
      const bytes = new Uint8Array(8)
      const view = new DataView(bytes.buffer)
      view.setUint16(0, 371, true)
      view.setUint16(2, 0x4000, true)
      view.setUint16(4, 0, true)
      view.setUint16(6, 2, true)
      if (standard) map.standardScriptBanks = [{ bank: 149, baseScriptId: 9600, bytes, headerSize: 0, entryOffsets: [0], messages: {} }]
      else {
        map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
        map.initScripts = [{ type: 'onLoad', scriptId: 1 }]
      }
      return map
    }
    const mapInitState = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    mapInitState.daycare.mons[0] = { pokemon: createTestPokemon(152), steps: 100_000 }
    const mapInitRunner = createFieldScriptMapInitSequenceRunner(
      createMap(false), mapInitState, 'load', undefined, undefined, undefined, undefined, levelPolicy,
    )
    if (!mapInitRunner) throw new Error('Le runner map-init de test est absent.')
    projectFieldScriptState(mapInitRunner)
    expect(mapInitState.variables.get(0x4000)).toBe(1)

    const newGameState = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    newGameState.daycare.mons[0] = { pokemon: createTestPokemon(152), steps: 100_000 }
    initializeNewGameFieldScriptState(
      createMap(true), newGameState, undefined, undefined, undefined, levelPolicy,
    )
    expect(newGameState.variables.get(0x4000)).toBe(1)
  })

  it('renvoie l’échec natif de préparation Pension sans rendre objet ni changer la forme', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(8)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 690, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 0x4000, true)
    view.setUint16(6, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const giratina = createTestPokemon(152)
    giratina.speciesId = 487
    giratina.form = 1
    giratina.heldItemId = 112
    const state = createFieldScriptState('male', '', { party: [giratina], pokemonRuntime: createTestPokemonRuntime() })
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => ({ code: 'daycare-locked', reason: 'Pension verrouillée.' }),
    }

    expect(createFieldScriptRunner(map, 1, state, undefined, basePokemonPartyHealingPolicy, policy).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0xff)
    expect(state.party.members[0]).toMatchObject({ speciesId: 487, form: 1, heldItemId: 112 })
    expect(state.inventory.get(112)).toBeUndefined()
  })

  it('conserve le préflight Pension jusqu’au dépôt sans reconsulter la policy après le retour d’objet', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(12)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 690, true); view.setUint16(2, 0, true); view.setUint16(4, 0x4000, true)
    view.setUint16(6, 373, true); view.setUint16(8, 0, true); view.setUint16(10, 2, true)
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const giratina = createTestPokemon(152)
    giratina.speciesId = 487; giratina.form = 1; giratina.heldItemId = 112
    const state = createFieldScriptState('male', '', { party: [giratina], pokemonRuntime: createTestPokemonRuntime() })
    let calls = 0
    const policy: PokemonTeamPolicy = {
      vetoBattleEligibility: () => undefined,
      vetoPartyMutation: () => (++calls === 1 ? undefined : { code: 'late-veto', reason: 'Veto tardif.' }),
    }

    expect(createFieldScriptRunner(map, 1, state, undefined, basePokemonPartyHealingPolicy, policy).resume()).toEqual({ kind: 'ended' })
    expect(calls).toBe(1)
    expect(state.party.members).toEqual([])
    expect(state.daycare.mons[0]?.pokemon).toMatchObject({ speciesId: 487, form: 0, heldItemId: 0 })
    expect(state.inventory.get(112)).toBe(1)
  })

  it('sélectionne un pensionnaire et lit le paramètre ROM du follower sur la Route 34', () => {
    const map = createBedroomMapWithNpc()
    const bytes = new Uint8Array(24)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    for (const operand of [340, 7, 16, 551, 0, 552, 0x4000, 0x4001, 596, 0x4002, 597, 2]) {
      view.setUint16(cursor, operand, true)
      cursor += 2
    }
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const runtime = createTestPokemonRuntime()
    runtime.catalog.followers.parameters[152] = { modelIndex: 152, size: 0x12, values: [0, 0x1200, 0, 0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: runtime, party: [createTestPokemon(152)], followMonActive: true })
    state.flags.add(0x6a)
    setFieldScriptMapState(state, map, 1, 1, 'south')
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({ kind: 'choice', presentation: 'party', cancellable: true })
    expect(state.objects.get(7)?.movement).toBe(16)
    runner.choose(0)
    expect(runner.resume()).toEqual({ kind: 'followerMovement', action: 'refresh' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.variables.get(0x4002)).toBe(2)
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('reproduit la session et le transfert transactionnel du Parc des Amis', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(20)
    const view = new DataView(bytes.buffer)
    let cursor = 0
    for (const operand of [508, 2, 508, 0, 509, 0x4000, 510, 508, 1, 2]) {
      view.setUint16(cursor, operand, true)
      cursor += 2
    }
    map.fieldScripts = { bank: 1, bytes, headerSize: 0, entryOffsets: [0] }
    const state = createFieldScriptState('male', '', { pokemonRuntime: createTestPokemonRuntime() })
    state.palPark.migratedPokemon = Array.from({ length: 6 }, () => createTestPokemon(152))

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.flags.has(0x971)).toBe(false)
    expect(state.palPark).toEqual({ catchingShowActive: false, migratedPokemon: [], catchingPoints: 0, timePoints: 0, typePoints: 0 })
    const stored = state.pokemonStorage.boxes.flat().filter((pokemon) => pokemon !== undefined)
    expect(stored).toHaveLength(6)
    expect(stored.every((pokemon) => pokemon?.origin.metLocation === 55)).toBe(true)
    expect(state.pokedex.caughtSpeciesIds.has(152)).toBe(true)
  })

  it('applique HOFCredits de Peter avant de suspendre le Panthéon et distingue la première victoire', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 163, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 825, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(152)
    pokemon.currentHp = 1
    pokemon.status = 0x10
    for (const move of pokemon.moves) move.pp = 0
    const state = createFieldScriptState('male', 'JO', { party: [pokemon] })
    state.gameStats.set(HGSS_LEAGUE_WINS_GAME_STAT, 4)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toEqual({
      kind: 'gameClear', defeatedRed: false, firstClear: true,
      page: {
        facility: 'tower', facilityId: 1, title: 'Panthéon', view: 'single', viewLabel: 'Maître de Johto',
        rows: [{ label: 'GERMIGNON', value: 5, tone: 'record' }],
      },
    })
    expect(state.flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)).toBe(true)
    expect(state.flags.has(HGSS_POST_GAME_RESET_SYSTEM_FLAG)).toBe(true)
    expect(state.gameStats.get(HGSS_LEAGUE_WINS_GAME_STAT)).toBe(5)
    expect(state.party.members[0]).toMatchObject({ currentHp: pokemon.stats.hp, status: 0 })
    expect(state.party.members[0]!.moves.every((move) => move.pp === move.maxPp)).toBe(true)
    expect(() => runner.resume()).toThrow('attend encore la fermeture du Panthéon')
    runner.closeGameClear()
    expect(runner.resume()).toEqual({ kind: 'ended' })

    const replay = createFieldScriptRunner(map, 1, state)
    expect(replay.resume()).toMatchObject({ kind: 'gameClear', defeatedRed: false, firstClear: false })
    expect(state.gameStats.get(HGSS_LEAGUE_WINS_GAME_STAT)).toBe(6)
    replay.closeGameClear()
    expect(replay.resume()).toEqual({ kind: 'ended' })
  })

  it('ne transforme jamais HOFCredits de Red en premier déblocage de Ligue', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 163, true)
    view.setUint16(2, 1, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 107, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(155)
    pokemon.currentHp = 1
    const state = createFieldScriptState('female', 'JO', { party: [pokemon] })
    state.gameStats.set(HGSS_LEAGUE_WINS_GAME_STAT, 12)
    const runner = createFieldScriptRunner(map, 1, state)

    expect(runner.resume()).toMatchObject({
      kind: 'gameClear', defeatedRed: true, firstClear: false,
      page: { title: 'Panthéon', viewLabel: 'Maître de Johto · Red vaincu' },
    })
    expect(state.flags.has(HGSS_GAME_CLEAR_SYSTEM_FLAG)).toBe(true)
    expect(state.flags.has(HGSS_POST_GAME_RESET_SYSTEM_FLAG)).toBe(true)
    expect(state.gameStats.get(HGSS_LEAGUE_WINS_GAME_STAT)).toBe(12)
    expect(state.party.members[0]!.currentHp).toBe(pokemon.stats.hp)
    runner.closeGameClear()
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })

  it('propage la politique de soin injectée au Game Clear', () => {
    const map = createBedroomMap()
    const bytes = new Uint8Array(6)
    const view = new DataView(bytes.buffer)
    view.setUint16(0, 163, true)
    view.setUint16(2, 0, true)
    view.setUint16(4, 2, true)
    map.fieldScripts = { bank: 825, bytes, headerSize: 0, entryOffsets: [0] }
    const pokemon = createTestPokemon(152)
    pokemon.currentHp = 0
    pokemon.status = 0x10
    pokemon.moves[0]!.pp = 0
    const state = createFieldScriptState('male', 'JO', { party: [pokemon] })
    const runner = createFieldScriptRunner(map, 1, state, undefined, preventHpRestorationPolicy)

    expect(runner.resume()).toMatchObject({ kind: 'gameClear', defeatedRed: false, firstClear: true })
    expect(state.party.members[0]).toMatchObject({ currentHp: 0, status: 0 })
    expect(state.party.members[0]?.moves[0]?.pp).toBe(pokemon.moves[0]!.maxPp)
    runner.closeGameClear()
    expect(runner.resume()).toEqual({ kind: 'ended' })
  })
})
