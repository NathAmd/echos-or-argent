import { describe, expect, it } from 'vitest'
import type { ResolvedFieldBattleFormat } from '../fieldBattleFormatResolver'
import type { PreparedFieldBattle } from '../prepareFieldBattle'
import {
  createFieldBattleLauncher,
  resolvePreparedFieldBattleLaunch,
  type FieldBattleLaunchRoute,
  type FieldBattleLauncherPorts,
} from './fieldBattleHost'

const formats = [
  ['tutorial', { engine: 'tutorial' }],
  ['simple-trainer', { engine: 'simple', sessionKind: 'trainer' }],
  ['simple-wild', { engine: 'simple', sessionKind: 'wild' }],
  ['double', { engine: 'double', sessionKind: 'double' }],
  ['multi', { engine: 'double', sessionKind: 'multi' }],
] as const satisfies readonly (readonly [string, ResolvedFieldBattleFormat])[]

type PreparedKind = PreparedFieldBattle['kind']

const preparedKinds: readonly PreparedKind[] = [
  'tutorial',
  'trainerHouse',
  'tagTrainer',
  'multiTrainer',
  'trainer',
  'wild',
]

function createPreparedBattle(kind: PreparedKind, encounterType = 1): PreparedFieldBattle {
  const playerParty = { members: [] }
  if (kind === 'tutorial') {
    return { kind, script: { kind: 'tutorial' }, playerParty, party: [] } as unknown as PreparedFieldBattle
  }
  if (kind === 'trainerHouse') {
    return {
      kind,
      script: { kind: 'trainerHouse', trainerNumber: 0 },
      trainer: { trainerId: 90, name: 'Maison' },
      playerParty,
      party: [],
    } as unknown as PreparedFieldBattle
  }
  if (kind === 'tagTrainer') {
    return {
      kind,
      script: { kind: 'trainer', trainerId: 10, trainerParameter: 11, encounterType, battleParameter: 0 },
      opponentTrainers: [{ trainerId: 10 }, { trainerId: 11 }],
      playerParty,
      opponentParty: [],
      createdOpponentParty: [],
    } as unknown as PreparedFieldBattle
  }
  if (kind === 'multiTrainer') {
    return {
      kind,
      script: { kind: 'multiTrainer', allyTrainerId: 7, opponentTrainerIds: [20, 21], battleParameter: 0 },
      allyTrainer: { trainerId: 7 },
      opponentTrainers: [{ trainerId: 20 }, { trainerId: 21 }],
      playerParty,
      allyParty: [],
      opponentParty: [],
      createdAllyParty: [],
      createdOpponentParty: [],
    } as unknown as PreparedFieldBattle
  }
  if (kind === 'trainer') {
    return {
      kind,
      script: { kind: 'trainer', trainerId: 30, trainerParameter: 0, encounterType, battleParameter: 0 },
      trainer: { trainerId: 30, doubleBattle: false },
      playerParty,
      party: [],
      createdParty: [],
    } as unknown as PreparedFieldBattle
  }
  return {
    kind,
    script: { kind: 'wild', speciesId: 25, level: 5, battleParameter: 0 },
    playerParty,
    battleParameter: 0,
    party: [{ speciesId: 25, speciesName: 'Pikachu', level: 5, form: 0 }],
  } as unknown as PreparedFieldBattle
}

const supportedRoutes = new Map<string, FieldBattleLaunchRoute['kind']>([
  ['tutorial/tutorial', 'capture-tutorial'],
  ['trainerHouse/simple-trainer', 'trainer-house-simple'],
  ['tagTrainer/double', 'tag-trainer-double'],
  ['multiTrainer/multi', 'multi-trainer-double'],
  ['trainer/simple-trainer', 'trainer-simple'],
  ['trainer/double', 'trainer-double'],
  ['wild/simple-wild', 'wild-simple'],
  ['wild/double', 'wild-double'],
])

function getSupportedCases(): Array<Readonly<{
  battle: PreparedFieldBattle
  format: ResolvedFieldBattleFormat
  routeKind: FieldBattleLaunchRoute['kind']
}>> {
  const cases: Array<Readonly<{
    battle: PreparedFieldBattle
    format: ResolvedFieldBattleFormat
    routeKind: FieldBattleLaunchRoute['kind']
  }>> = []
  for (const kind of preparedKinds) {
    for (const [formatName, format] of formats) {
      const routeKind = supportedRoutes.get(`${kind}/${formatName}`)
      if (routeKind) cases.push({ battle: createPreparedBattle(kind), format, routeKind })
    }
  }
  return cases
}

describe('routeur de lancement des combats terrain', () => {
  it('couvre exhaustivement les 30 couples de variants préparés et de formats', () => {
    let supportedCount = 0
    let rejectedCount = 0
    for (const kind of preparedKinds) {
      for (const [formatName, format] of formats) {
        const battle = createPreparedBattle(kind)
        const expectedKind = supportedRoutes.get(`${kind}/${formatName}`)
        if (!expectedKind) {
          expect(() => resolvePreparedFieldBattleLaunch(battle, format)).toThrow(/(?:prend pas|pas pris) en charge/)
          rejectedCount += 1
          continue
        }
        const route = resolvePreparedFieldBattleLaunch(battle, format, { allowSinglePlayerParticipant: true })
        expect(route.kind).toBe(expectedKind)
        expect(route.battle).toBe(battle)
        expect(route.format).toBe(format)
        expect(Object.isFrozen(route)).toBe(true)
        supportedCount += 1
      }
    }
    expect({ supportedCount, rejectedCount }).toEqual({ supportedCount: 8, rejectedCount: 22 })
  })

  it('résout les politiques temporaires, de soin et standard sans état implicite', () => {
    const tutorial = resolvePreparedFieldBattleLaunch(createPreparedBattle('tutorial'), { engine: 'tutorial' })
    const trainerHouse = resolvePreparedFieldBattleLaunch(createPreparedBattle('trainerHouse'), { engine: 'simple', sessionKind: 'trainer' })
    const trainer = resolvePreparedFieldBattleLaunch(createPreparedBattle('trainer'), { engine: 'simple', sessionKind: 'trainer' })
    const trainerNoHeal = resolvePreparedFieldBattleLaunch(createPreparedBattle('trainer', 0), { engine: 'double', sessionKind: 'double' })
    const multi = resolvePreparedFieldBattleLaunch(createPreparedBattle('multiTrainer'), { engine: 'double', sessionKind: 'multi' })
    const wild = resolvePreparedFieldBattleLaunch(createPreparedBattle('wild'), { engine: 'simple', sessionKind: 'wild' })

    expect(tutorial.policy).toEqual({ healAfterLoss: false, suppressProgression: true, restorePlayerParty: true })
    expect(trainerHouse.policy).toBe(tutorial.policy)
    expect(trainer.policy).toEqual({ healAfterLoss: true, suppressProgression: false, restorePlayerParty: false })
    expect(multi.policy).toBe(trainer.policy)
    expect(trainerNoHeal.policy).toEqual({ healAfterLoss: false, suppressProgression: false, restorePlayerParty: false })
    expect(wild.policy).toBe(trainerNoHeal.policy)
  })

  it('transporte les identités adverses et les exceptions de participant duo', () => {
    const tag = resolvePreparedFieldBattleLaunch(
      createPreparedBattle('tagTrainer'),
      { engine: 'double', sessionKind: 'double' },
      { allowSinglePlayerParticipant: true },
    )
    const trainer = resolvePreparedFieldBattleLaunch(
      createPreparedBattle('trainer'),
      { engine: 'double', sessionKind: 'double' },
      { allowSinglePlayerParticipant: true },
    )
    const wild = resolvePreparedFieldBattleLaunch(
      createPreparedBattle('wild'),
      { engine: 'double', sessionKind: 'double' },
      { allowSinglePlayerParticipant: false },
    )

    expect(tag).toMatchObject({ opponentTrainerIds: [10, 11], allowSinglePlayerParticipant: true })
    expect(trainer).toMatchObject({ opponentTrainerIds: [30], allowSinglePlayerParticipant: true })
    expect(wild).toMatchObject({ allowSinglePlayerParticipant: true })
  })

  it('orchestre préparation, format, politique et exactement un port pour chacune des huit routes', () => {
    for (const supported of getSupportedCases()) {
      const calls: string[] = []
      const recordStart = (route: FieldBattleLaunchRoute): void => { calls.push(`start:${route.kind}`) }
      const ports: FieldBattleLauncherPorts = {
        prepareBattle: () => { calls.push('prepare'); return supported.battle },
        resolveFormat: (battle) => { calls.push(`format:${battle.kind}`); return supported.format },
        readRoutingOptions: () => { calls.push('options'); return { allowSinglePlayerParticipant: true } },
        applyPolicy: (policy) => { calls.push(`policy:${String(policy.healAfterLoss)}:${String(policy.suppressProgression)}`) },
        startCaptureTutorial: recordStart,
        startTrainerHouse: recordStart,
        startTagTrainer: recordStart,
        startMultiTrainer: recordStart,
        startSimpleTrainer: recordStart,
        startDoubleTrainer: recordStart,
        startSimpleWild: recordStart,
        startDoubleWild: recordStart,
      }
      const route = createFieldBattleLauncher(ports).launch({ kind: 'tutorial' })

      expect(route.kind).toBe(supported.routeKind)
      expect(calls.slice(0, 3)).toEqual(['prepare', `format:${supported.battle.kind}`, 'options'])
      expect(calls.at(-1)).toBe(`start:${supported.routeKind}`)
      expect(calls.filter((call) => call.startsWith('start:'))).toHaveLength(1)
      expect(calls.findIndex((call) => call.startsWith('policy:'))).toBe(calls.length - 2)
    }
  })

  it('propage un format non pris en charge sans appliquer de politique ni démarrer', () => {
    const calls: string[] = []
    const shouldNotStart = (): void => { calls.push('start') }
    const ports: FieldBattleLauncherPorts = {
      prepareBattle: () => { calls.push('prepare'); return createPreparedBattle('tutorial') },
      resolveFormat: () => { calls.push('format'); return { engine: 'simple', sessionKind: 'trainer' } },
      readRoutingOptions: () => ({ allowSinglePlayerParticipant: false }),
      applyPolicy: () => { calls.push('policy') },
      startCaptureTutorial: shouldNotStart,
      startTrainerHouse: shouldNotStart,
      startTagTrainer: shouldNotStart,
      startMultiTrainer: shouldNotStart,
      startSimpleTrainer: shouldNotStart,
      startDoubleTrainer: shouldNotStart,
      startSimpleWild: shouldNotStart,
      startDoubleWild: shouldNotStart,
    }

    expect(() => createFieldBattleLauncher(ports).launch({ kind: 'tutorial' })).toThrow(/(?:prend pas|pas pris) en charge/)
    expect(calls).toEqual(['prepare', 'format'])
  })
})
