import { describe, expect, it, vi } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng, type HgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  applyHgssSafariStage,
  attemptHgssSafariBattleAction,
  createHgssSafariBattleState,
  doesHgssSafariOpponentFlee,
  performHgssSafariBattleAction,
} from './hgssSafariBattle'

function opponent() {
  const catalog = createPokemonTestCatalog()
  return createCanonicalPokemon(catalog, {
    speciesId: 74,
    level: 17,
    rng: createHgssLcrng(74),
    personality: { kind: 'fixed', value: 74 },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 0, name: 'SAFARI', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 202, metLevel: 17, metTerrain: 0 },
    ballId: 5,
    moveIds: [33],
  })
}

function sequence(...values: number[]): HgssLcrng {
  let index = 0
  return { getSeed: () => index, nextU16: () => values[index++] ?? 0xffff }
}

describe('combat Parc Safari HGSS', () => {
  it('reproduit les treize ratios ROM autour du stade neutre 6', () => {
    expect(applyHgssSafariStage(120, 0)).toBe(30)
    expect(applyHgssSafariStage(120, 6)).toBe(120)
    expect(applyHgssSafariStage(120, 12)).toBe(480)
  })

  it('compare le reste modulo 255 inclusivement au taux de fuite', () => {
    expect(doesHgssSafariOpponentFlee(60, 6, sequence(60))).toBe(true)
    expect(doesHgssSafariOpponentFlee(60, 6, sequence(61))).toBe(false)
  })

  it('fait toujours baisser la fuite avec l Appat et ne baisse la capture que neuf fois sur dix', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[74]!.greatMarshFleeRate = 0
    const strong = performHgssSafariBattleAction(createHgssSafariBattleState(opponent(), 30), 'bait', {
      catalog, rng: sequence(0, 254), hasStorageSpace: true,
    })
    expect(strong.state).toMatchObject({ catchRateStage: 6, fleeRateStage: 5 })
    expect(strong.events[0]).toEqual({ kind: 'bait', strongReaction: true })

    const normal = performHgssSafariBattleAction(createHgssSafariBattleState(opponent(), 30), 'bait', {
      catalog, rng: sequence(1, 254), hasStorageSpace: true,
    })
    expect(normal.state).toMatchObject({ catchRateStage: 5, fleeRateStage: 5 })
  })

  it('fait toujours monter la capture avec la Boue et monte la fuite neuf fois sur dix', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[74]!.greatMarshFleeRate = 0
    const normal = performHgssSafariBattleAction(createHgssSafariBattleState(opponent(), 30), 'mud', {
      catalog, rng: sequence(1, 254), hasStorageSpace: true,
    })
    expect(normal.state).toMatchObject({ catchRateStage: 7, fleeRateStage: 7 })
  })

  it('consomme la Safari Ball avant la tentative et termine immediatement a zero', () => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[74]!.catchRate = 1
    const turn = performHgssSafariBattleAction(createHgssSafariBattleState(opponent(), 1), 'ball', {
      catalog, rng: sequence(0xffff, 0xffff, 0xffff, 0xffff), hasStorageSpace: true,
    })
    expect(turn.state).toMatchObject({ ballsRemaining: 0, outcome: 'balls-out' })
    expect(turn.events.map(({ kind }) => kind)).toEqual(['ball', 'balls-out'])
  })

  it('debite la Ball puis ferme le combat quand equipe et PC sont pleins, comme le sous-script 275', () => {
    const catalog = createPokemonTestCatalog()
    const turn = performHgssSafariBattleAction(createHgssSafariBattleState(opponent(), 30), 'ball', {
      catalog, rng: sequence(), hasStorageSpace: false,
    })
    expect(turn.state).toMatchObject({ ballsRemaining: 29, outcome: 'storage-full' })
    expect(turn.events).toEqual([{ kind: 'storage-full' }])
  })

  it('refuse une action par la policy avant tout RNG et toute mutation', () => {
    const catalog = createPokemonTestCatalog()
    const rng = { getSeed: () => 0, nextU16: vi.fn(() => 0) }
    const state = createHgssSafariBattleState(opponent(), 30)
    const snapshot = structuredClone(state)
    const veto = { code: 'challenge.safari-ball-disabled', reason: 'Capture deja tentee dans cette zone.' }
    const policy = { vetoPlayerAction: vi.fn(() => veto) }

    const attempt = attemptHgssSafariBattleAction(state, 'ball', { catalog, rng, hasStorageSpace: true }, policy)

    expect(attempt).toEqual({ accepted: false, action: 'ball', state, veto })
    expect(policy.vetoPlayerAction).toHaveBeenCalledWith({ kind: 'safari', action: 'ball' })
    expect(rng.nextU16).not.toHaveBeenCalled()
    expect(state).toEqual(snapshot)
  })

  it.each(['ball', 'bait', 'mud', 'run'] as const)('conserve le moteur de base pour l action %s avec la policy neutre', (action) => {
    const catalog = createPokemonTestCatalog()
    catalog.personalData[74]!.catchRate = 1
    catalog.personalData[74]!.greatMarshFleeRate = 0
    const state = createHgssSafariBattleState(opponent(), 30)
    const attempted = attemptHgssSafariBattleAction(state, action, {
      catalog, rng: sequence(1, 254, 0xffff, 0xffff), hasStorageSpace: true,
    })
    const performed = performHgssSafariBattleAction(state, action, {
      catalog, rng: sequence(1, 254, 0xffff, 0xffff), hasStorageSpace: true,
    })

    expect(attempted).toEqual({ accepted: true, turn: performed })
  })
})
