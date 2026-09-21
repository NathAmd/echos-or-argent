import { describe, expect, it } from 'vitest'
import {
  HGSS_SAFARI_BALL_COUNT,
  HGSS_SAFARI_HAS_STEP_LIMIT,
  HGSS_SAFARI_MAX_OBJECTS_PER_AREA,
  consumeHgssSafariBall,
  createHgssSafariState,
  getHgssSafariObjectCategoryCounts,
  getHgssSafariObjectScores,
  getHgssSafariUnlockedObjectIds,
  migrateHgssSafariLegacySession,
  placeHgssSafariObject,
  replaceHgssSafariArea,
  setHgssSafariObjectUnlockLevel,
  startHgssSafariSession,
} from './hgssSafariState'
import { advanceHgssSafariAreaDays, finishHgssSafariSession } from './hgssSafariProgression'

describe('état du Parc Safari HGSS', () => {
  it('reproduit les dix arrangements initiaux indexés par RNG modulo 10', () => {
    expect(createHgssSafariState(0).areaSets[0].areas.map((area) => area.areaId)).toEqual([0, 7, 1, 5, 3, 6])
    expect(createHgssSafariState(9).areaSets[0].areas.map((area) => area.areaId)).toEqual([0, 2, 5, 7, 3, 9])
    expect(createHgssSafariState(10).areaSets[0].areas.map((area) => area.areaId)).toEqual([0, 7, 1, 5, 3, 6])
    expect(createHgssSafariState(0).areaSets[1].areas.map((area) => area.areaId)).toEqual([0, 0, 0, 0, 0, 0])
    expect(createHgssSafariState(0).areaSets.every((set) => set.areaLevels.length === 12)).toBe(true)
  })

  it('ouvre une session de 30 Balls sans introduire de limite de pas', () => {
    const initial = createHgssSafariState(0)
    const started = startHgssSafariSession(initial, 0)
    const afterBall = consumeHgssSafariBall(started)

    expect(started.session).toEqual({ active: true, balls: HGSS_SAFARI_BALL_COUNT })
    expect(afterBall.session.balls).toBe(29)
    expect(initial.session).toEqual({ active: false, balls: 0 })
    expect(HGSS_SAFARI_HAS_STEP_LIMIT).toBe(false)
    expect('steps' in started.session).toBe(false)
  })

  it('migre l’ancien compteur sans donner de sens au champ steps inutilisé par la ROM', () => {
    const migrated = migrateHgssSafariLegacySession({ active: true, areaSet: 1, balls: 17, steps: 65_535 }, 0)
    expect(migrated.activeAreaSet).toBe(1)
    expect(migrated.session).toEqual({ active: true, balls: 17 })
    expect('steps' in migrated.session).toBe(false)
  })

  it('débloque six objets par palier selon le dernier chiffre du Trainer ID', () => {
    expect(getHgssSafariUnlockedObjectIds(0, 1)).toEqual([0, 1, 2, 19, 20, 12])
    expect(getHgssSafariUnlockedObjectIds(3, 1)).toEqual([3, 4, 5, 13, 14, 17])
    expect(getHgssSafariUnlockedObjectIds(6, 1)).toEqual([6, 7, 8, 21, 22, 23])
    expect(getHgssSafariUnlockedObjectIds(8, 1)).toEqual([9, 10, 11, 15, 16, 18])
    expect(new Set(getHgssSafariUnlockedObjectIds(8, 4)).size).toBe(24)
  })

  it('limite globalement chaque zone à 30 placements sans muter l’état source', () => {
    let state = createHgssSafariState(0)
    const untouched = state
    for (let index = 0; index < HGSS_SAFARI_MAX_OBJECTS_PER_AREA; index++) {
      state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: index, y: 0, z: 0 })
    }
    expect(state.areaSets[0].areas[0].placements).toHaveLength(30)
    expect(untouched.areaSets[0].areas[0].placements).toHaveLength(0)
    expect(() => placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 30, y: 0, z: 0 })).toThrow(/30 objets/)
  })

  it('applique les paliers distincts Plains, Forest, Peak et Water tirés de la ROM', () => {
    let state = createHgssSafariState(0)
    for (const objectId of [0, 3, 6, 9, 12] as const) {
      state = placeHgssSafariObject(state, 0, 0, { objectId, x: objectId, y: 0, z: 0 })
    }
    const areaId = state.areaSets[0].areas[0].areaId
    expect(getHgssSafariObjectCategoryCounts(state.areaSets[0].areas[0])).toEqual([1, 1, 1, 1, 1])
    expect(getHgssSafariObjectScores(state.areaSets[0], 0)).toEqual({ counts: [1, 1, 1, 1], effectiveLevels: [1, 1, 1, 1] })

    state.areaSets[0].areaLevels[areaId] = 10
    expect(getHgssSafariObjectScores(state.areaSets[0], 0).effectiveLevels).toEqual([2, 1, 1, 1])
    state.areaSets[0].areaLevels[areaId] = 20
    expect(getHgssSafariObjectScores(state.areaSets[0], 0).effectiveLevels).toEqual([2, 2, 1, 1])
    state.areaSets[0].areaLevels[areaId] = 30
    expect(getHgssSafariObjectScores(state.areaSets[0], 0).effectiveLevels).toEqual([2, 2, 2, 1])
    state.areaSets[0].areaLevels[areaId] = 40
    expect(getHgssSafariObjectScores(state.areaSets[0], 0).effectiveLevels).toEqual([2, 2, 2, 2])
    state.areaSets[0].areaLevels[areaId] = 250
    expect(getHgssSafariObjectScores(state.areaSets[0], 0).effectiveLevels).toEqual([7, 7, 7, 7])
  })

  it('diffère le vieillissement pendant la session puis signale les tables réellement modifiées', () => {
    let state = setHgssSafariObjectUnlockLevel(createHgssSafariState(0), 1)
    state = placeHgssSafariObject(state, 0, 0, { objectId: 0, x: 1, y: 0, z: 1 })
    const areaId = state.areaSets[0].areas[0].areaId
    state = startHgssSafariSession(state)
    const signature = (areaSet: typeof state.areaSets[0], slot: 0 | 1 | 2 | 3 | 4 | 5) => (
      getHgssSafariObjectScores(areaSet, slot).effectiveLevels.join(',')
    )

    const deferred = advanceHgssSafariAreaDays(state, 10, signature)
    expect(deferred.state.pendingAreaDays).toBe(10)
    expect(deferred.state.areaSets[0].areaLevels[areaId]).toBe(0)
    expect(deferred.changedAreaIds).toEqual([])

    const finished = finishHgssSafariSession(deferred.state, signature)
    expect(finished.state.areaSets[0].areaLevels[areaId]).toBe(10)
    expect(finished.changedAreaIds).toEqual([areaId])
    expect(finished.state.session).toEqual({ active: false, balls: 0 })
    expect(finished.state.activeAreaSet).toBe(1)
    expect(finished.state.pendingAreaDays).toBe(0)
  })

  it('ne vieillit chaque identité de zone active qu’une fois et attend le déblocage des objets', () => {
    let state = createHgssSafariState(0)
    state = replaceHgssSafariArea(state, 0, 1, state.areaSets[0].areas[0].areaId)
    const areaId = state.areaSets[0].areas[0].areaId
    expect(advanceHgssSafariAreaDays(state, 10).state.areaSets[0].areaLevels[areaId]).toBe(0)

    state = setHgssSafariObjectUnlockLevel(state, 1)
    const aged = advanceHgssSafariAreaDays(state, 10)
    expect(aged.state.areaSets[0].areaLevels[areaId]).toBe(10)
  })
})
