import { describe, expect, it, vi } from 'vitest'
import type { OpeningMapPreview, RomInventory } from '../../ndsTypes'
import type { HgssTrainer } from '../../rom/battle/trainerData'
import type { DoubleBattleSession } from '../battle/doubleBattleSession'
import { createCanonicalPokemon, type CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import type { TrainerEngagement, WorldState } from '../world/worldSession'
import { resolveBaseFieldBattleFormat, type FieldBattleFormatResolver } from '../battle/fieldBattleFormatResolver'
import { baseFieldWildEncounterIdentityPort, type FieldWildEncounterIdentityPort } from './fieldWildEncounterIdentityPort'
import { resolveBaseFieldWildEncounterRoute } from './fieldWildEncounterRouteResolver'
import {
  createFieldEncounterCoordinator,
  type ActivePreparedFieldWildEncounter,
  type FieldEncounterCoordinatorPorts,
} from './fieldEncounterCoordinator'
import type {
  EncounterMovementMode,
  HgssFieldEncounterSession,
  PreparedFieldWildEncounter,
  PreparedSafariWildEncounter,
} from './wildEncounterSelection'
import {
  noopWildEncounterStartedObserver,
  type WildEncounterStartedEvent,
} from './wildEncounterStartedObserver'

const landEncounter = {
  encounter: {
    bankId: 3,
    slotIndex: 0,
    method: 'land',
    time: 'day',
    speciesId: 155,
    level: 8,
  },
  rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 0 },
} as const satisfies PreparedFieldWildEncounter

const safariEncounter = {
  encounter: {
    areaId: 0,
    areaSlot: 0,
    method: 'safari',
    safariMethod: 'land',
    time: 'day',
    slotIndex: 0,
    speciesId: 19,
    level: 5,
  },
  rateRoll: { triggered: true, modifiedRate: 30, firstRoll: 0 },
} as const satisfies PreparedFieldWildEncounter

function createMap(id = 44): OpeningMapPreview {
  return {
    id,
    label: `Carte ${id}`,
    header: { mapSection: 12, wildEncounterBank: 3 },
    terrain: { width: 2, height: 2, attributes: [2, 3, 16, 119] },
  } as unknown as OpeningMapPreview
}

function createPokemon(
  catalog: ReturnType<typeof createPokemonTestCatalog>,
  speciesId: number,
  level: number,
  seed = speciesId,
): CanonicalPokemon {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level,
    rng: createHgssLcrng(seed),
    personality: { kind: 'fixed', value: seed },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 44, metLevel: level, metTerrain: 0 },
    ballId: 4,
  })
}

type HarnessOptions = Readonly<{
  map?: OpeningMapPreview
  worldPresent?: boolean
  observe?: boolean
  botRunning?: boolean
  simpleActive?: boolean
  doubleActive?: boolean
  scriptActive?: boolean
  scriptPresent?: boolean
  engagements?: TrainerEngagement[]
  movementMode?: EncounterMovementMode
  repelProtected?: boolean
  checkStep?: HgssFieldEncounterSession['checkStep']
  identityPort?: FieldWildEncounterIdentityPort
  battleFormatResolver?: FieldBattleFormatResolver
  doubleTrainerIds?: readonly number[]
}>

function createHarness(options: HarnessOptions = {}) {
  const order: string[] = []
  const events: WildEncounterStartedEvent[] = []
  const catalog = createPokemonTestCatalog(493)
  const lead = createPokemon(catalog, 152, 16)
  const map = options.map ?? createMap()
  const fieldState = createFieldScriptState('male', 'JO', {
    party: [lead],
    pokemonRuntime: {
      catalog,
      rng: createHgssLcrng(0x12345678),
      trainer: { id: 7, name: 'JO', gender: 'male' },
      language: 3,
      gameVersion: 7,
      now: () => new Date('2026-08-27T12:00:00Z'),
    },
  })
  fieldState.currentMapId = map.id
  const inventory = {
    pokemonCatalog: catalog,
    itemCatalog: { items: [], pocketNames: [] } as unknown as RomInventory['itemCatalog'],
    trainerCatalog: Array.from({ length: 100 }, (_, trainerId): HgssTrainer => ({
      trainerId,
      trainerType: 0,
      trainerClass: 0,
      partySize: 0,
      items: [0, 0, 0, 0],
      aiFlags: 0,
      doubleBattle: options.doubleTrainerIds?.includes(trainerId) ?? false,
      party: [],
    })),
  }
  let worldState: WorldState | undefined = options.worldPresent === false
    ? undefined
    : { map, tileX: 1, tileZ: 1, direction: 'east', locomotion: 'walking' }
  const engagements = options.engagements ?? []
  const setObjectState = vi.fn()
  const worldSession = {
    getState: () => worldState,
    findEngagingTrainers: () => engagements,
    setObjectState,
  }
  const checkStep = options.checkStep ?? vi.fn(() => undefined)
  let preparedEncounter: ActivePreparedFieldWildEncounter | undefined
  let activeSafariPokemon: CanonicalPokemon | undefined
  let activeRoamerId: number | undefined
  let pendingWildEncounterCheck = true
  let scriptActive = options.scriptActive ?? false
  const startSimple = vi.fn((kind: 'wild', opponents: readonly CanonicalPokemon[]) => {
    void kind
    void opponents
    order.push('simple')
  })
  const startDouble = vi.fn((session: DoubleBattleSession) => {
    void session
    order.push('double')
  })
  const prepareSafari = vi.fn((
    method: 'land' | 'surf',
    repelLeadLevel?: number,
  ): PreparedSafariWildEncounter | undefined => {
    void method
    void repelLeadLevel
    return undefined
  })
  const materializeSafari = vi.fn(() => createPokemon(catalog, 19, 5))
  const startSafari = vi.fn((
    encounter: PreparedSafariWildEncounter,
    vblank: number,
    pokemon?: CanonicalPokemon,
  ) => {
    void encounter
    void vblank
    void pokemon
    order.push('safari')
  })
  const hasScript = vi.fn(() => options.scriptPresent ?? true)
  const startScript = vi.fn((mapToStart: OpeningMapPreview, scriptId: number, actorId?: number) => {
    void mapToStart
    void scriptId
    void actorId
    order.push('script')
    scriptActive = true
  })
  const setActorDirection = vi.fn()
  const resetPhoneRing = vi.fn(() => { order.push('phone') })
  const clearMovementInput = vi.fn(() => { order.push('clear') })
  const suspendBotForBattle = vi.fn(() => { order.push('suspend') })
  const setStatus = vi.fn((statusText: string) => {
    void statusText
    order.push('status')
  })

  const ports: FieldEncounterCoordinatorPorts = {
    context: {
      readFieldState: () => fieldState,
      readInventory: () => inventory,
      readWorldSession: () => worldSession,
      readEncounterSession: () => ({ checkStep }),
      readVblankCounter: () => 42,
      readMovementMode: () => options.movementMode ?? 'walking',
      isRepelProtected: () => options.repelProtected ?? false,
    },
    policies: {
      fieldWildEncounterRouteResolver: resolveBaseFieldWildEncounterRoute,
      fieldWildEncounterIdentityPort: options.identityPort ?? baseFieldWildEncounterIdentityPort,
      wildEncounterStartedObserver: options.observe
        ? { observeWildEncounterStarted: (event) => { order.push('observe'); events.push(event) } }
        : noopWildEncounterStartedObserver,
      fieldBattleFormatResolver: options.battleFormatResolver ?? resolveBaseFieldBattleFormat,
      pokemonTeamPolicy: basePokemonTeamPolicy,
    },
    battle: {
      isSimpleActive: () => options.simpleActive ?? false,
      isDoubleActive: () => options.doubleActive ?? false,
      startSimple,
      startDouble,
    },
    safari: { prepareEncounter: prepareSafari, materializeEncounter: materializeSafari, start: startSafari },
    script: {
      isActive: () => scriptActive,
      has: hasScript,
      start: startScript,
      setActorDirection,
    },
    state: {
      setPreparedEncounter: (prepared) => { order.push('prepared'); preparedEncounter = prepared },
      setActiveSafariPokemon: (pokemon) => { order.push('active-safari'); activeSafariPokemon = pokemon },
      setActiveBattleRoamerId: (roamerId) => { order.push('roamer'); activeRoamerId = roamerId },
      setPendingWildEncounterCheck: (pending) => { order.push('pending'); pendingWildEncounterCheck = pending },
    },
    effects: {
      resolveBattleTerrainId: () => 9,
      resetPhoneRing,
      clearMovementInput,
      isBotRunning: () => options.botRunning ?? false,
      suspendBotForBattle,
      setStatus,
    },
  }
  return {
    coordinator: createFieldEncounterCoordinator(ports),
    ports,
    catalog,
    fieldState,
    map,
    order,
    events,
    startSimple,
    startDouble,
    prepareSafari,
    materializeSafari,
    startSafari,
    hasScript,
    startScript,
    setActorDirection,
    setObjectState,
    setStatus,
    readPrepared: () => preparedEncounter,
    readActiveSafariPokemon: () => activeSafariPokemon,
    readActiveRoamerId: () => activeRoamerId,
    readPendingWildEncounterCheck: () => pendingWildEncounterCheck,
    setWorldState: (state: WorldState | undefined) => { worldState = state },
  }
}

describe('field encounter coordinator', () => {
  it('démarre une rencontre ROM standard dans l’ordre historique et publie son observation', () => {
    const harness = createHarness({ observe: true, botRunning: true })
    const pokemon = createPokemon(harness.catalog, 155, 8)

    expect(harness.coordinator.startPreparedWildEncounter(landEncounter, pokemon)).toBe(true)

    expect(harness.order).toEqual([
      'phone', 'prepared', 'roamer', 'clear', 'suspend', 'simple', 'observe', 'status',
    ])
    expect(harness.readPrepared()).toEqual({ ...landEncounter, speciesName: pokemon.speciesName, pokemon })
    expect(harness.readActiveRoamerId()).toBeUndefined()
    expect(harness.startSimple).toHaveBeenCalledWith('wild', [pokemon])
    expect(harness.events).toEqual([expect.objectContaining({
      kind: 'wild-encounter-started',
      mapId: harness.map.id,
      mapSectionId: 12,
      method: 'land',
      instanceId: pokemon.instanceId,
      speciesId: 155,
      level: 8,
    })])
    expect(harness.setStatus).toHaveBeenCalledWith('Combat sauvage ROM : HERICENDRE Nv.8.')
  })

  it('donne la priorité à la route Safari et fige le vblank et le Pokémon matérialisé', () => {
    const harness = createHarness({ observe: true, botRunning: true })
    const pokemon = createPokemon(harness.catalog, 19, 5)

    expect(harness.coordinator.startPreparedWildEncounter(safariEncounter, pokemon)).toBe(true)

    expect(harness.order).toEqual([
      'phone', 'safari', 'active-safari', 'prepared', 'roamer', 'clear', 'suspend', 'observe',
    ])
    expect(harness.startSafari).toHaveBeenCalledWith(safariEncounter.encounter, 42, pokemon)
    expect(harness.readActiveSafariPokemon()).toBe(pokemon)
    expect(harness.readPrepared()).toEqual({ ...safariEncounter, speciesName: pokemon.speciesName, pokemon })
    expect(harness.startSimple).not.toHaveBeenCalled()
    expect(harness.setStatus).not.toHaveBeenCalled()
    expect(harness.events[0]).toMatchObject({ method: 'safari', mapSectionId: 12 })
  })

  it('matérialise et démarre une quête scriptée uniquement sur sa carte sans combat actif', () => {
    const harness = createHarness({ observe: true })
    const interaction = {
      mapId: harness.map.id,
      captureScopeSectionId: 0xf09e,
      battle: { speciesId: 158, level: 12 },
    } as const

    expect(harness.coordinator.startAllPokemonQuestWildEncounter(interaction)).toBe(true)

    const pokemon = harness.startSimple.mock.calls[0]?.[1][0]
    expect(pokemon).toMatchObject({ speciesId: 158, level: 12, origin: { metLocation: harness.map.id, metTerrain: 9 } })
    expect(harness.order).toEqual(['phone', 'roamer', 'clear', 'simple', 'observe', 'status'])
    expect(harness.events[0]).toMatchObject({ method: 'scripted', mapSectionId: 0xf09e })
    expect(harness.setStatus).toHaveBeenCalledWith('Quête Pokémon : KAIMINUS Nv.12.')

    const blocked = createHarness({ simpleActive: true })
    expect(blocked.coordinator.startAllPokemonQuestWildEncounter(interaction)).toBe(false)
    expect(blocked.startSimple).not.toHaveBeenCalled()
  })

  it('construit fidèlement le contrôle de pas, applique l’identité puis démarre le résultat', () => {
    let stepRequest: Parameters<HgssFieldEncounterSession['checkStep']>[0] | undefined
    const checkStep: HgssFieldEncounterSession['checkStep'] = vi.fn((request) => {
      stepRequest = request
      return landEncounter
    })
    const identityPort = vi.fn<FieldWildEncounterIdentityPort>((prepared) => ({
      ...prepared,
      encounter: { ...prepared.encounter, speciesId: 158 },
    } as PreparedFieldWildEncounter))
    const harness = createHarness({
      checkStep,
      identityPort,
      movementMode: 'running',
      repelProtected: true,
    })
    harness.fieldState.radioMusicSequenceId = 1100
    harness.fieldState.weather = 7
    harness.fieldState.roamers.flutePlayed = 2
    harness.fieldState.roamers.massOutbreaksEnabled = true
    harness.fieldState.friendGroups[1]!.randomValue = 0x1234

    expect(harness.coordinator.tryPrepareWildEncounter(true)).toBe(true)

    expect(stepRequest).toMatchObject({
      mapId: harness.map.id,
      bankId: 3,
      terrainAttribute: 119,
      direction: 'east',
      movementMode: 'running',
      radioEffect: 'march',
      suppressOrdinaryEncounter: true,
      repelLeadLevel: 16,
      rateContext: { weatherType: 7, flutePlayed: 2 },
      generationContext: { massOutbreak: { active: true, randomValue: 0x1234 } },
    })
    expect(stepRequest?.rateContext?.lead).toBe(harness.fieldState.party.members[0])
    expect(stepRequest?.generationContext?.resolveSpeciesTypes?.(158)).toEqual([0, 0])
    expect(stepRequest?.prepareContextEncounter).toBeUndefined()
    expect(identityPort).toHaveBeenCalledWith(landEncounter, { mapId: harness.map.id, source: 'step' })
    expect(harness.startSimple.mock.calls[0]?.[1][0]).toMatchObject({ speciesId: 158, level: 8 })
  })

  it('branche la substitution Safari du pas avec le même niveau de Repousse', () => {
    const map = createMap(357)
    let contextEncounter: PreparedSafariWildEncounter | undefined
    const checkStep: HgssFieldEncounterSession['checkStep'] = vi.fn((request) => {
      contextEncounter = request.prepareContextEncounter?.('surf')
      return undefined
    })
    const harness = createHarness({ map, checkStep, repelProtected: true })
    harness.fieldState.safariZone.session.active = true
    harness.prepareSafari.mockReturnValue(safariEncounter.encounter)

    expect(harness.coordinator.tryPrepareWildEncounter()).toBe(false)

    expect(harness.prepareSafari).toHaveBeenCalledWith('surf', 16)
    expect(contextEncounter).toBe(safariEncounter.encounter)
  })

  it('prépare tous les Dresseurs engagés avant de lancer le script standard du premier', () => {
    const engagements: TrainerEngagement[] = [
      { objectId: 4, trainerId: 25, scriptId: 3025, direction: 'west', distance: 3, encounterType: 1 },
      { objectId: 9, trainerId: 31, scriptId: 3031, direction: 'north', distance: 2, encounterType: 2 },
    ]
    const harness = createHarness({ engagements })
    harness.fieldState.party.members.push(createPokemon(harness.catalog, 155, 5))

    expect(harness.coordinator.tryStartTrainerSightEncounter()).toBe(true)

    expect(harness.fieldState.engagedTrainers).toEqual([
      { objectId: 4, trainerId: 25, direction: 'west', distance: 3, encounterType: 1 },
      { objectId: 9, trainerId: 31, direction: 'north', distance: 2, encounterType: 2 },
    ])
    expect(harness.setObjectState.mock.calls).toEqual([
      [4, undefined, undefined, 'west'],
      [9, undefined, undefined, 'north'],
    ])
    expect(harness.setActorDirection.mock.calls).toEqual([[4, 'west'], [9, 'north']])
    expect(harness.readPendingWildEncounterCheck()).toBe(false)
    expect(harness.startScript).toHaveBeenCalledWith(harness.map, 3739, 4)
  })

  it('n’engage pas deux Dresseurs simples simultanés avec un seul Pokémon apte', () => {
    const harness = createHarness({ engagements: [
      { objectId: 7, trainerId: 79, scriptId: 3078, direction: 'east', distance: 5, encounterType: 2 },
      { objectId: 8, trainerId: 80, scriptId: 3079, direction: 'west', distance: 4, encounterType: 2 },
    ] })

    expect(harness.coordinator.tryStartTrainerSightEncounter()).toBe(false)
    expect(harness.fieldState.engagedTrainers).toEqual([])
    expect(harness.startScript).not.toHaveBeenCalled()
  })

  it('ignore le regard d’un Dresseur double lorsque moins de deux Pokémon sont aptes', () => {
    const engagements: TrainerEngagement[] = [
      { objectId: 2, trainerId: 10, scriptId: 5009, direction: 'south', distance: 1, encounterType: 0 },
      { objectId: 8, trainerId: 11, scriptId: 3010, direction: 'west', distance: 2, encounterType: 2 },
    ]
    const harness = createHarness({ engagements, doubleTrainerIds: [10] })

    expect(harness.coordinator.tryStartTrainerSightEncounter()).toBe(false)
    expect(harness.fieldState.engagedTrainers).toEqual([])
    expect(harness.setObjectState).not.toHaveBeenCalled()
    expect(harness.setActorDirection).not.toHaveBeenCalled()
    expect(harness.startScript).not.toHaveBeenCalled()
    expect(harness.readPendingWildEncounterCheck()).toBe(true)
  })

  it('autorise le regard double avec deux Pokémon aptes ou la dérogation duo NG+', () => {
    const engagement: TrainerEngagement = {
      objectId: 2,
      trainerId: 10,
      scriptId: 5009,
      direction: 'south',
      distance: 1,
      encounterType: 0,
    }
    const withTwo = createHarness({ engagements: [engagement], doubleTrainerIds: [10] })
    withTwo.fieldState.party.members.push(createPokemon(withTwo.catalog, 155, 5))

    expect(withTwo.coordinator.tryStartTrainerSightEncounter()).toBe(true)
    expect(withTwo.startScript).toHaveBeenCalledWith(withTwo.map, 3739, 2)

    const duoNgp = createHarness({
      engagements: [engagement],
      doubleTrainerIds: [10],
      battleFormatResolver: () => ({ engine: 'double', sessionKind: 'double' }),
    })
    expect(duoNgp.coordinator.tryStartTrainerSightEncounter()).toBe(true)
    expect(duoNgp.startScript).toHaveBeenCalledWith(duoNgp.map, 3739, 2)
  })

  it('échoue avant toute mutation lorsque le script standard d’approche manque', () => {
    const engagement: TrainerEngagement = {
      objectId: 4,
      trainerId: 25,
      scriptId: 3025,
      direction: 'west',
      distance: 3,
      encounterType: 1,
    }
    const harness = createHarness({ engagements: [engagement], scriptPresent: false })

    expect(() => harness.coordinator.tryStartTrainerSightEncounter())
      .toThrow("Le script standard d'approche des Dresseurs est absent de Carte 44.")
    expect(harness.fieldState.engagedTrainers).toEqual([])
    expect(harness.setObjectState).not.toHaveBeenCalled()
    expect(harness.readPendingWildEncounterCheck()).toBe(true)
  })

  it('crée une session sauvage double et rejette les formats incompatibles', () => {
    const double = createHarness({
      battleFormatResolver: () => ({ engine: 'double', sessionKind: 'double' }),
    })
    const pokemon = createPokemon(double.catalog, 155, 8)

    double.coordinator.startCanonicalFieldWildBattle(pokemon)

    expect(double.startSimple).not.toHaveBeenCalled()
    expect(double.startDouble).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'wild',
      weather: { kind: 'clear', turns: 0 },
      terrainId: 9,
    }))
    expect(double.startDouble.mock.calls[0]?.[0].teams.opponent[0]?.party[0]).toMatchObject({
      instanceId: pokemon.instanceId,
      speciesId: pokemon.speciesId,
    })

    const unsupported = createHarness({ battleFormatResolver: () => ({ engine: 'tutorial' }) })
    expect(() => unsupported.coordinator.startCanonicalFieldWildBattle(pokemon))
      .toThrow('Le moteur tutorial ne prend pas en charge cette rencontre sauvage.')
  })

  it('ne relit pas la carte pour l’observateur neutre mais exige la carte pour un observateur actif', () => {
    const neutral = createHarness({ worldPresent: false })
    const pokemon = createPokemon(neutral.catalog, 155, 8)
    expect(() => neutral.coordinator.observeStartedWildEncounter(pokemon, 'land')).not.toThrow()

    const observed = createHarness({ worldPresent: false, observe: true })
    expect(() => observed.coordinator.observeStartedWildEncounter(pokemon, 'land'))
      .toThrow('La carte de la rencontre sauvage démarrée est absente.')
  })
})
