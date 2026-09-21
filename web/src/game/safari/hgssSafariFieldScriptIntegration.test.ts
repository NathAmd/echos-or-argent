import { describe, expect, it } from 'vitest'
import type { OpeningMapPreview } from '../../ndsTypes'
import type { HgssSafariAreaEncounterData, HgssSafariEncounterCatalog, HgssSafariEncounterMethodData } from '../../rom/safari/safariEncounterData'
import { hgssMultiplayerProtocolVersion } from '../multiplayer/hgssMultiplayerGateway'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { cloneFieldScriptState, createFieldScriptRunner, createFieldScriptState, type FieldPokemonRuntime } from '../scripts/fieldScriptRunner'
import { hgssSafariSystemFlag, synchronizeHgssSafariQuestState } from './hgssSafariFieldRuntime'
import { placeHgssSafariObject } from './hgssSafariState'

function encodeOpcode(opcode: number, ...parameters: number[]): number[] {
  return [opcode & 0xff, opcode >>> 8, ...parameters]
}

function createSafariScriptMap(bytes: number[]): OpeningMapPreview {
  return {
    id: 524,
    label: 'PARC SAFARI',
    header: { mapId: 524, msgBank: 0, mapSection: 202, followMode: 2 } as OpeningMapPreview['header'],
    fieldScripts: { bank: 1, bytes: Uint8Array.from(bytes), headerSize: 0, entryOffsets: [0] },
    initScripts: [],
    messages: {},
    matrix: {} as OpeningMapPreview['matrix'],
  }
}

function createSafariWorldScriptMap(bytes: number[], attribute = 0): OpeningMapPreview {
  const map = createSafariScriptMap(bytes)
  map.id = 357
  map.header.mapId = 357
  map.externalMessages = { 430: { 14: 'BLOC ROM' } }
  map.matrix = {
    matrixIndex: 212, name: 'm_safari_', width: 5, height: 4, hasHeaders: true,
    headers: new Uint16Array([0, 0, 0, 0, 0, 0, 357, 357, 357, 0, 0, 357, 357, 357, 0, 0, 0, 357, 0, 0]),
    altitudes: new Uint8Array(20), modelIds: new Uint16Array(20),
  }
  map.terrain = {
    modelId: 0,
    width: 96,
    height: 96,
    attributes: new Uint16Array(96 * 96).fill(attribute),
    collisionPlates: [{ minX: 0, maxX: 96, minZ: 0, maxZ: 96, normalX: 0, normalY: 1, normalZ: 0, distance: 0 }],
  }
  return map
}

function changingEncounterCatalog(): HgssSafariEncounterCatalog {
  const times = ['morning', 'day', 'night'] as const
  const methods = ['land', 'surf', 'oldRod', 'goodRod', 'superRod'] as const
  const methodData = (areaId: number, methodIndex: number): HgssSafariEncounterMethodData => ({
    bonusCount: 1,
    base: Object.fromEntries(times.map((time) => [time, Array.from({ length: 10 }, () => ({ speciesId: 10 + areaId + methodIndex, level: 10 }))])) as HgssSafariEncounterMethodData['base'],
    bonus: Object.fromEntries(times.map((time) => [time, [{ speciesId: 100 + areaId + methodIndex, level: 20 }]])) as HgssSafariEncounterMethodData['bonus'],
    bonusConditions: [{ blockType1: 1, blockCount1: 2, blockType2: 0, blockCount2: 0 }],
  })
  return Array.from({ length: 12 }, (_, areaId): HgssSafariAreaEncounterData => ({
    areaId: areaId as HgssSafariAreaEncounterData['areaId'],
    methods: Object.fromEntries(methods.map((method, index) => [method, methodData(areaId, index)])) as HgssSafariAreaEncounterData['methods'],
  }))
}

function createSafariRuntime(igtMinutes?: () => number): FieldPokemonRuntime {
  return {
    catalog: createPokemonTestCatalog(),
    rng: createHgssLcrng(7),
    trainer: { id: 0x12345678, name: 'JO', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date(2026, 7, 22),
    igtMinutes,
  }
}

describe('HGSS Safari field opcodes', () => {
  it('initializes from the Trainer ID and deeply clones arrangements', () => {
    const runtime = createSafariRuntime()
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    state.safariZone = placeHgssSafariObject(state.safariZone, 0, 0, { objectId: 3, x: 4, y: 5, z: 6 })
    const clone = cloneFieldScriptState(state)
    clone.safariZone.areaSets[0].areas[0]!.placements[0]!.x = 99
    clone.safariProgression.baobaQuestStage = 7

    expect(state.safariZone.areaSets[0].areas.map((area) => area.areaId)).toEqual([9, 1, 10, 2, 3, 0])
    expect(state.safariZone.areaSets[0].areas[0]!.placements[0]!.x).toBe(4)
    expect(state.safariProgression.baobaQuestStage).toBe(0)
  })

  it('starts a 30-ball session, checks the native challenge and records IGT', () => {
    const runtime = createSafariRuntime(() => 321)
    const geodude = createCanonicalPokemon(runtime.catalog, {
      speciesId: 74,
      level: 15,
      rng: runtime.rng,
      personality: { kind: 'random' },
      individualValues: { kind: 'random' },
      originalTrainer: runtime.trainer,
      origin: { language: 3, gameVersion: 7, metLocation: 202, eggLocation: 0, metLevel: 15, metTerrain: 2 },
      ballId: 5,
    })
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime, party: [geodude] })
    const map = createSafariScriptMap([
      ...encodeOpcode(447, 0, 0),
      ...encodeOpcode(791, 0, 0x00, 0x40),
      ...encodeOpcode(792),
      ...encodeOpcode(2),
    ])

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.safariZone).toMatchObject({ activeAreaSet: 0, session: { active: true, balls: 30 } })
    expect(state.flags.has(hgssSafariSystemFlag)).toBe(true)
    expect(state.variables.get(0x4000)).toBe(1)
    expect(state.safariProgression.baobaIgtReferenceMinutes).toBe(321)
  })

  it('synchronizes Baoba contact/stage and closes without a step limit', () => {
    const runtime = createSafariRuntime(() => 400)
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    state.safariZone.session = { active: true, balls: 17 }
    state.safariZone.activeAreaSet = 0
    const map = createSafariScriptMap([
      ...encodeOpcode(146, 24, 0),
      ...encodeOpcode(41, 0x57, 0x40, 5, 0),
      ...encodeOpcode(447, 1, 0),
      ...encodeOpcode(2),
    ])

    expect(createFieldScriptRunner(map, 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.phoneContacts.has(24)).toBe(true)
    expect(state.safariProgression).toMatchObject({ baobaContactRegistered: true, baobaQuestStage: 5 })
    expect(state.safariZone).toMatchObject({ activeAreaSet: 1, session: { active: false, balls: 0 } })
    expect(state.flags.has(hgssSafariSystemFlag)).toBe(false)
    expect(state.safariZone).not.toHaveProperty('steps')
  })

  it('réconcilie la quête Baoba de façon idempotente', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    state.variables.set(0x4057, 5)
    state.phoneContacts.add(24)

    synchronizeHgssSafariQuestState(state)
    const progression = state.safariProgression
    synchronizeHgssSafariQuestState(state)

    expect(state.safariProgression).toBe(progression)
    expect(state.safariProgression).toMatchObject({ baobaContactRegistered: true, baobaQuestStage: 5 })
    expect(state.variables.get(0x4057)).toBe(5)
    expect(state.phoneContacts.has(24)).toBe(true)
  })

  it('refuses to substitute wall-clock time for the missing IGT counter', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    const runner = createFieldScriptRunner(createSafariScriptMap([
      ...encodeOpcode(792),
      ...encodeOpcode(2),
    ]), 1, state)

    expect(() => runner.resume()).toThrow('compteur IGT HGSS est absent')
  })

  it('suspend le customizer 716, valide ses opérations et reproduit FLAG_UNK_99D', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    const runner = createFieldScriptRunner(createSafariWorldScriptMap([
      ...encodeOpcode(716), ...encodeOpcode(2),
    ]), 1, state)
    expect(runner.resume()).toEqual({
      kind: 'safariCustomizer',
      areas: [9, 1, 10, 2, 3, 0],
      blockCounts: Array.from({ length: 6 }, () => [0, 0, 0, 0, 0]),
      showBlockCounts: false,
    })
    runner.submitSafariCustomizerChange?.({
      areas: [5, 1, 10, 2, 3, 0], sourceSlot: 0, targetAreaId: 5, operation: 'replace',
    })
    expect(() => runner.resume()).toThrow(/application Safari/)
    runner.closeSafariCustomizer?.()
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.flags.has(0x99d)).toBe(true)
    expect(state.safariZone.areaSets[0].areas[0]).toEqual({ areaId: 5, placements: [] })
  })

  it('suspend le décorateur 717, place son candidat ROM et renvoie 255 à l’annulation', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    state.safariZone.objectUnlockLevel = 4
    state.player = { x: 40, z: 40, direction: 'north' }
    const runner = createFieldScriptRunner(createSafariWorldScriptMap([
      ...encodeOpcode(717, 0x00, 0x40), ...encodeOpcode(2),
    ]), 1, state)
    const step = runner.resume()
    expect(step.kind).toBe('safariDecorator')
    if (step.kind !== 'safariDecorator') throw new Error('étape inattendue')
    expect(step.candidates.find(({ objectId }) => objectId === 0)?.placement).toEqual({ objectId: 0, x: 8, y: 0, z: 7 })
    expect(step.candidates.find(({ objectId }) => objectId === 10)).toEqual({ objectId: 10, unavailableReason: 2 })
    runner.submitSafariDecoratorSelection?.(10)
    expect(() => runner.resume()).toThrow(/application Safari/)
    expect(state.safariZone.areaSets[0].areas[0].placements).toEqual([])
    runner.submitSafariDecoratorSelection?.(0)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4000)).toBe(0)
    expect(state.safariZone.areaSets[0].areas[0].placements).toEqual([{ objectId: 0, x: 8, y: 0, z: 7 }])

    const cancelled = createFieldScriptRunner(createSafariWorldScriptMap([
      ...encodeOpcode(717, 0x01, 0x40), ...encodeOpcode(2),
    ]), 1, state)
    cancelled.resume()
    cancelled.submitSafariDecoratorSelection?.(undefined)
    expect(cancelled.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(255)
  })

  it('exécute 718–721 avec les noms ROM et l’empreinte du Bloc devant l’avatar', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    state.player = { x: 36, z: 39, direction: 'north' }
    state.safariZone = placeHgssSafariObject(state.safariZone, 0, 0, { objectId: 3, x: 4, y: 0, z: 6 })
    state.variables.set(0x4002, 0)
    const runner = createFieldScriptRunner(createSafariWorldScriptMap([
      ...encodeOpcode(718, 0, 0, 0),
      ...encodeOpcode(719, 0x00, 0x40, 0x01, 0x40),
      ...encodeOpcode(720, 0x01, 0x40),
      ...encodeOpcode(721, 0x02, 0x40),
      ...encodeOpcode(2),
    ]), 1, state)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(0)).toBe('BLOC ROM')
    expect(state.variables.get(0x4000)).toBe(3)
    expect(state.variables.get(0x4001)).toBe(0)
    expect(state.variables.get(0x4002)).toBe(0)
    expect(state.safariZone.areaSets[0].areas[0].placements).toEqual([])
  })

  it('échange le set 0 avec 822, bufferise le meneur avec 823 et teste le lien avec 824', () => {
    const runtime = createSafariRuntime()
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    state.variables.set(0x4000, 2)
    const runner = createFieldScriptRunner(createSafariWorldScriptMap([
      ...encodeOpcode(822),
      ...encodeOpcode(823, 0x00, 0x40),
      ...encodeOpcode(824, 0x01, 0x40),
      ...encodeOpcode(2),
    ]), 1, state)
    const step = runner.resume()
    expect(step.kind).toBe('multiplayer')
    if (step.kind !== 'multiplayer') throw new Error('étape inattendue')
    expect(step.request).toMatchObject({ kind: 'safari-area-exchange', romOpcode: 822, language: 3, gameVersion: 7 })
    runner.submitMultiplayerResult({
      protocolVersion: hgssMultiplayerProtocolVersion,
      requestId: step.request.requestId,
      kind: 'safari-area-exchange',
      romResult: 0,
      status: 'completed',
      safariAreaSet: state.safariZone.areaSets[0],
      safariPlayer: { trainerId: 77, name: 'BAOBA', gender: 'male', language: 2, gameVersion: 8 },
    })
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.buffers.get(2)).toBe('BAOBA')
    expect(state.variables.get(0x4001)).toBe(1)
    expect(state.safariZone.linkLeader).toMatchObject({ linked: true, trainerId: 77, name: 'BAOBA' })
  })

  it('conserve le set lié pendant 24 h civiles malgré un changement DST du navigateur', () => {
    let now = new Date(2026, 2, 28, 12)
    Object.defineProperty(now, 'getTimezoneOffset', { value: () => -60 })
    const runtime = { ...createSafariRuntime(), now: () => now, ownerRtcOffset: () => 42 }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    const exchange = createFieldScriptRunner(createSafariWorldScriptMap([...encodeOpcode(822), ...encodeOpcode(2)]), 1, state)
    const step = exchange.resume()
    if (step.kind !== 'multiplayer') throw new Error('étape échange Safari inattendue')
    exchange.submitMultiplayerResult({
      protocolVersion: hgssMultiplayerProtocolVersion, requestId: step.request.requestId,
      kind: 'safari-area-exchange', romResult: 0, status: 'completed',
      safariAreaSet: state.safariZone.areaSets[0],
      safariPlayer: { trainerId: 77, name: 'BAOBA', gender: 'male', language: 2, gameVersion: 8 },
    })
    expect(exchange.resume()).toEqual({ kind: 'ended' })
    now = new Date(2026, 2, 29, 12)
    Object.defineProperty(now, 'getTimezoneOffset', { value: () => -120 })
    const expiry = createFieldScriptRunner(createSafariWorldScriptMap([...encodeOpcode(824, 0x01, 0x40), ...encodeOpcode(2)]), 1, state)
    expect(expiry.resume()).toEqual({ kind: 'ended' })
    expect(state.variables.get(0x4001)).toBe(1)
  })

  it('publie les zones de rencontres modifiées et le trigger Baoba 6 à SafariZoneAction 1', () => {
    const runtime = { ...createSafariRuntime(), safariEncounterCatalog: changingEncounterCatalog() }
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: runtime })
    state.safariZone.objectUnlockLevel = 1
    state.safariZone.session = { active: true, balls: 5 }
    state.safariZone.pendingAreaDays = 10
    state.safariZone = placeHgssSafariObject(state.safariZone, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })
    const firstAreaId = state.safariZone.areaSets[0].areas[0].areaId
    const runner = createFieldScriptRunner(createSafariScriptMap([
      ...encodeOpcode(447, 1, 0), ...encodeOpcode(2),
    ]), 1, state)
    expect(runner.resume()).toEqual({ kind: 'ended' })
    expect(state.phoneCallTriggers.has(6)).toBe(true)
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual([firstAreaId])
  })

  it('préserve un appel Baoba déjà publié quand aucune journée différée ne doit être appliquée', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    state.safariZone.session = { active: true, balls: 5 }
    state.safariProgression.pendingEncounterAreaIds = [9]
    state.phoneCallTriggers.add(6)
    expect(createFieldScriptRunner(createSafariScriptMap([
      ...encodeOpcode(447, 1, 0), ...encodeOpcode(2),
    ]), 1, state).resume()).toEqual({ kind: 'ended' })
    expect(state.safariProgression.pendingEncounterAreaIds).toEqual([9])
    expect(state.phoneCallTriggers.has(6)).toBe(true)
  })

  it('refuse de perdre les zones changées si le catalogue Safari ROM manque au runtime', () => {
    const state = createFieldScriptState('male', 'JO', { pokemonRuntime: createSafariRuntime() })
    state.safariZone.objectUnlockLevel = 1
    state.safariZone.session = { active: true, balls: 5 }
    state.safariZone.pendingAreaDays = 1
    const runner = createFieldScriptRunner(createSafariScriptMap([
      ...encodeOpcode(447, 1, 0), ...encodeOpcode(2),
    ]), 1, state)
    expect(() => runner.resume()).toThrow(/catalogue ROM des rencontres Safari/)
    expect(state.safariZone).toMatchObject({ pendingAreaDays: 1, session: { active: true, balls: 5 } })
  })
})
