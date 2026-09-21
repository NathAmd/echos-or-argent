import { describe, expect, it } from 'vitest'
import type { HgssTrainer } from '../../../rom/battle/trainerData'
import { createCanonicalPokemon } from '../../pokemon/canonicalPokemon'
import { createPokemonTestCatalog } from '../../pokemon/pokemonTestCatalog'
import { createHgssLcrng } from '../../pokemon/hgssPokemonRng'
import { basePokemonTeamPolicy } from '../../pokemon/pokemonTeamPolicy'
import { createFieldScriptState, type FieldPokemonRuntime } from '../../scripts/fieldScriptRunner'
import type { FieldScriptBattle } from '../../scripts/fieldScriptProtocol'
import { baseFieldBattleRosterPolicy } from '../fieldBattleRosterPolicy'
import { resolveBaseFieldBattleFormat, type FieldBattleFormatResolver } from '../fieldBattleFormatResolver'
import {
  createBrowserFieldBattleLauncher,
  type BrowserFieldBattleLaunchContext,
  type BrowserFieldBattleLauncherEffects,
} from './browserFieldBattleLauncher'
import type { FieldBattleLaunchPolicy } from './fieldBattleHost'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: 152 | 155 | 158, seed: number = speciesId) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 12,
    rng: createHgssLcrng(seed),
    personality: { kind: 'fixed', value: seed },
    individualValues: { kind: 'fixed', value: 10 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 12, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function trainer(
  trainerId: number,
  speciesIds: readonly (152 | 155 | 158)[],
  doubleBattle = false,
): HgssTrainer {
  return {
    trainerId,
    trainerType: 0,
    trainerClass: trainerId,
    partySize: speciesIds.length,
    items: [trainerId + 100, 0, 0, 0],
    aiFlags: trainerId * 10,
    doubleBattle,
    party: speciesIds.map((speciesId) => ({
      difficulty: 0,
      genderOverride: 0,
      abilityOverride: 0,
      level: 8,
      speciesId,
      form: 0,
      capsule: 0,
    })),
  }
}

type SimpleCall = Parameters<BrowserFieldBattleLauncherEffects['startSimpleBattle']>
type DoubleCall = Parameters<BrowserFieldBattleLauncherEffects['startDoubleBattle']>

function createFixture(options: Readonly<{
  formatPolicy?: FieldBattleFormatResolver
  allBattlesInDuo?: boolean
}> = {}) {
  const trainers: HgssTrainer[] = []
  trainers[1] = trainer(1, [152])
  trainers[2] = trainer(2, [155])
  trainers[3] = trainer(3, [158])
  trainers[4] = trainer(4, [152, 155], true)
  const runtime: FieldPokemonRuntime = {
    catalog,
    rng: createHgssLcrng(0x1234),
    trainer: { id: 7, name: 'JO', gender: 'male' },
    language: 3,
    gameVersion: 7,
    now: () => new Date('2026-01-01T12:00:00Z'),
    trainerHouseDefaultName: 'HILBERT',
  }
  const state = createFieldScriptState('male', 'JO', {
    party: [pokemon(152, 100), pokemon(155, 101)],
    pokemonRuntime: runtime,
  })
  state.weather = 1
  state.trainerHouseEntries[0] = {
    trainerId: 99,
    spriteId: 1,
    language: 3,
    gameVersion: 7,
    gender: 'female',
    name: 'MAISON',
    introMessage: { bank: 0, messageId: 0, fields: [0xffff, 0xffff] },
    winMessage: { bank: 0, messageId: 1, fields: [0xffff, 0xffff] },
    loseMessage: { bank: 0, messageId: 2, fields: [0xffff, 0xffff] },
    party: [pokemon(158, 102)],
  }
  const context: BrowserFieldBattleLaunchContext = {
    inventory: {
      trainerCatalog: trainers,
      pokemonCatalog: catalog,
      itemCatalog: { items: [], pocketNames: [] },
      trainerNames: Array.from({ length: 100 }, (_, index) => `DRESSEUR ${index}`),
    },
    state,
    formatPolicy: options.formatPolicy ?? resolveBaseFieldBattleFormat,
    rosterPolicy: baseFieldBattleRosterPolicy,
    teamPolicy: basePokemonTeamPolicy,
    terrainId: 9,
    allBattlesInDuo: options.allBattlesInDuo ?? false,
  }
  const calls: string[] = []
  const policies: FieldBattleLaunchPolicy[] = []
  const simpleCalls: SimpleCall[] = []
  const doubleCalls: DoubleCall[] = []
  const wildPokemon: ReturnType<typeof pokemon>[] = []
  const observedWildPokemon: ReturnType<typeof pokemon>[] = []
  let tutorialCount = 0
  const effects: BrowserFieldBattleLauncherEffects = {
    startCatchingTutorialBattle: () => { tutorialCount += 1; calls.push('tutorial') },
    startSimpleBattle: (...args) => { simpleCalls.push(args); calls.push('simple') },
    startDoubleBattle: (...args) => { doubleCalls.push(args); calls.push('double') },
    startCanonicalFieldWildBattle: (wild) => { wildPokemon.push(wild); calls.push('wild') },
    observeStartedWildEncounter: (wild) => { observedWildPokemon.push(wild); calls.push('observe') },
    applyPolicy: (policy) => { policies.push(policy); calls.push('policy') },
  }
  const launcher = createBrowserFieldBattleLauncher({ readContext: () => context, ...effects })
  return {
    context,
    state,
    launcher,
    calls,
    policies,
    simpleCalls,
    doubleCalls,
    wildPokemon,
    observedWildPokemon,
    get tutorialCount() { return tutorialCount },
  }
}

describe('adaptateur navigateur du lancement de combat terrain', () => {
  it('prépare un Dresseur simple, construit son introduction et applique le soin scripté', () => {
    const fixture = createFixture()
    const route = fixture.launcher.launch({
      kind: 'trainer', trainerId: 1, trainerParameter: 0, encounterType: 1, battleParameter: 0,
    })

    expect(route.kind).toBe('trainer-simple')
    expect(fixture.calls).toEqual(['policy', 'simple'])
    expect(fixture.policies).toEqual([{ healAfterLoss: true, suppressProgression: false, restorePlayerParty: false }])
    const [kind, opponents, trainerId, introduction] = fixture.simpleCalls[0]!
    expect({ kind, trainerId }).toEqual({ kind: 'trainer', trainerId: 1 })
    expect(opponents).toMatchObject([{ speciesId: 152, level: 8 }])
    expect(introduction).toMatchObject({
      phase: 'introduction',
      battle: { format: 'single', trainer: { trainerId: 1 }, player: { openingSlots: [0] }, opponent: { openingSlots: [0] } },
    })
  })

  it('construit le tag battle 2v2 avec séparation des rosters, IA ROM et identité des Dresseurs', () => {
    const fixture = createFixture()
    const route = fixture.launcher.launch({
      kind: 'trainer', trainerId: 1, trainerParameter: 2, encounterType: 0, battleParameter: 0,
    })

    expect(route.kind).toBe('tag-trainer-double')
    const [session, trainerIds] = fixture.doubleCalls[0]!
    expect(trainerIds).toEqual([1, 2])
    expect(session).toMatchObject({ kind: 'double', weather: { kind: 'rain' }, terrainId: 9 })
    expect(session.teams.player).toHaveLength(2)
    expect(session.teams.opponent.map(({ ownerId, party, ai }) => ({
      ownerId,
      species: party[0]?.speciesId,
      aiFlags: ai.aiFlags,
      items: ai.items,
      trainerName: ai.trainerName,
    }))).toEqual([
      { ownerId: 'trainer-1', species: 152, aiFlags: 10, items: [101], trainerName: 'DRESSEUR 1' },
      { ownerId: 'trainer-2', species: 155, aiFlags: 20, items: [102], trainerName: 'DRESSEUR 2' },
    ])
  })

  it('construit le MultiBattle avec joueur, allié et deux équipes adverses distinctes', () => {
    const fixture = createFixture()
    const route = fixture.launcher.launch({
      kind: 'multiTrainer', allyTrainerId: 1, opponentTrainerIds: [2, 3], battleParameter: 0,
    })

    expect(route.kind).toBe('multi-trainer-double')
    const [session, trainerIds] = fixture.doubleCalls[0]!
    expect(trainerIds).toEqual([2, 3])
    expect(session.kind).toBe('multi')
    expect(session.teams.player.map(({ ownerId, controlled, party }) => ({ ownerId, controlled, species: party[0]?.speciesId }))).toEqual([
      { ownerId: 'player', controlled: true, species: 152 },
      { ownerId: 'ally', controlled: false, species: 152 },
    ])
    expect(session.teams.opponent.map(({ ownerId, party }) => ({ ownerId, species: party[0]?.speciesId }))).toEqual([
      { ownerId: 'trainer-2', species: 155 },
      { ownerId: 'trainer-3', species: 158 },
    ])
    expect(fixture.policies[0]?.healAfterLoss).toBe(true)
  })

  it('construit un Dresseur double partageant son roster entre les deux slots adverses', () => {
    const fixture = createFixture({ allBattlesInDuo: true })
    const route = fixture.launcher.launch({
      kind: 'trainer', trainerId: 4, trainerParameter: 0, encounterType: 2, battleParameter: 0,
    })

    expect(route).toMatchObject({ kind: 'trainer-double', allowSinglePlayerParticipant: true })
    const [session, trainerIds] = fixture.doubleCalls[0]!
    expect(trainerIds).toEqual([4])
    expect(session.teams.opponent).toHaveLength(2)
    expect(session.teams.opponent[0]?.ownerId).toBe('trainer-4')
    expect(session.teams.opponent[1]?.ownerId).toBe('trainer-4')
    expect(session.teams.opponent[0]?.party).toBe(session.teams.opponent[1]?.party)
    expect(session.teams.opponent[0]?.ai).toBe(session.teams.opponent[1]?.ai)
    expect(session.teams.opponent.map(({ activePartyIndex }) => activePartyIndex)).toEqual([0, 1])
  })

  it('matérialise les routes sauvages simple et double puis observe exactement le Pokémon démarré', () => {
    const simple = createFixture()
    expect(simple.launcher.launch({ kind: 'wild', speciesId: 158, level: 7, battleParameter: 1 }).kind).toBe('wild-simple')
    expect(simple.calls).toEqual(['policy', 'wild', 'observe'])
    expect(simple.wildPokemon[0]).toBe(simple.observedWildPokemon[0])
    expect(simple.wildPokemon[0]).toMatchObject({ speciesId: 158, level: 7, shiny: true })

    const doubleWildPolicy: FieldBattleFormatResolver = (battle) => battle.kind === 'wild'
      ? { engine: 'double', sessionKind: 'double' }
      : resolveBaseFieldBattleFormat(battle)
    const double = createFixture({ formatPolicy: doubleWildPolicy })
    expect(double.launcher.launch({ kind: 'wild', speciesId: 155, level: 9, battleParameter: 0 })).toMatchObject({
      kind: 'wild-double', allowSinglePlayerParticipant: true,
    })
    expect(double.wildPokemon[0]).toBe(double.observedWildPokemon[0])
  })

  it('conserve les routes temporaires tutoriel et Maison des Dresseurs', () => {
    const tutorial = createFixture()
    expect(tutorial.launcher.launch({ kind: 'tutorial' }).kind).toBe('capture-tutorial')
    expect(tutorial.tutorialCount).toBe(1)
    expect(tutorial.policies[0]).toEqual({ healAfterLoss: false, suppressProgression: true, restorePlayerParty: true })

    const house = createFixture()
    expect(house.launcher.launch({ kind: 'trainerHouse', trainerNumber: 0 }).kind).toBe('trainer-house-simple')
    const [kind, opponents, trainerId, introduction, playerParty, trainerName] = house.simpleCalls[0]!
    expect({ kind, trainerId, introduction, trainerName }).toEqual({
      kind: 'trainer', trainerId: undefined, introduction: undefined, trainerName: 'MAISON',
    })
    expect(opponents).toMatchObject([{ speciesId: 158 }])
    expect(playerParty).toMatchObject([{ speciesId: 152 }, { speciesId: 155 }])
    expect(house.policies[0]).toEqual({ healAfterLoss: false, suppressProgression: true, restorePlayerParty: true })
  })

  it('échoue avant toute politique ou effet si le contexte ROM est incomplet', () => {
    const fixture = createFixture()
    const missingInventory: BrowserFieldBattleLaunchContext = { ...fixture.context, inventory: undefined }
    const launcher = createBrowserFieldBattleLauncher({
      readContext: () => missingInventory,
      startCatchingTutorialBattle: () => { throw new Error('effet inattendu') },
      startSimpleBattle: () => { throw new Error('effet inattendu') },
      startDoubleBattle: () => { throw new Error('effet inattendu') },
      startCanonicalFieldWildBattle: () => { throw new Error('effet inattendu') },
      observeStartedWildEncounter: () => { throw new Error('effet inattendu') },
      applyPolicy: () => { throw new Error('effet inattendu') },
    })
    const battle: FieldScriptBattle = { kind: 'tutorial' }

    expect(() => launcher.launch(battle)).toThrow('catalogue ROM')

    const missingRuntime: BrowserFieldBattleLaunchContext = {
      ...fixture.context,
      state: { ...fixture.context.state, pokemonRuntime: undefined },
    }
    const runtimeLauncher = createBrowserFieldBattleLauncher({
      readContext: () => missingRuntime,
      startCatchingTutorialBattle: () => { throw new Error('effet inattendu') },
      startSimpleBattle: () => { throw new Error('effet inattendu') },
      startDoubleBattle: () => { throw new Error('effet inattendu') },
      startCanonicalFieldWildBattle: () => { throw new Error('effet inattendu') },
      observeStartedWildEncounter: () => { throw new Error('effet inattendu') },
      applyPolicy: () => { throw new Error('effet inattendu') },
    })
    expect(() => runtimeLauncher.launch(battle)).toThrow('runtime Pokemon')
  })
})
