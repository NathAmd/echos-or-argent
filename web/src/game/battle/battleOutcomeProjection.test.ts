import { describe, expect, it } from 'vitest'
import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import type { DetailedBattleOutcomeEvent, DetailedBattleOutcomeObserver } from './battleOutcomeObserver'
import {
  observeDoubleBattleOutcomeEvents,
  observeExplicitOpponentCapture,
  observeSimpleBattleOutcomeEvents,
  type DoubleBattleOutcomeTeams,
} from './battleOutcomeProjection'
import type { DoubleBattleEvent } from './doubleBattleSession'
import type { SimpleBattleEvent } from './simpleBattleSession'

describe('battle outcome projection', () => {
  it("retrouve un KO simple par instanceId malgré une collision personnalité/dresseur d'origine", () => {
    const first = pokemon('simple-first', 152, 1234)
    const defeated = pokemon('simple-defeated', 155, 1234)
    defeated.currentHp = 0
    const events: readonly SimpleBattleEvent[] = [
      { kind: 'faint', side: 'opponent', pokemonName: defeated.speciesName, defeated },
    ]
    const output = collect((observer) => observeSimpleBattleOutcomeEvents(
      events,
      { player: [pokemon('simple-player', 158, 10)], opponent: [first, defeated] },
      observer,
    ))

    expect(first.originalTrainer).toEqual(defeated.originalTrainer)
    expect(first.personality).toBe(defeated.personality)
    expect(first.instanceId).not.toBe(defeated.instanceId)
    expect(output).toEqual([{
      kind: 'pokemon-knocked-out',
      pokemon: { instanceId: defeated.instanceId, side: 'opponent', partyIndex: 1 },
    }])
  })

  it('projette les résultats simples pris en charge et ignore la capture sans index explicite', () => {
    const output = collect((observer) => observeSimpleBattleOutcomeEvents(
      [
        { kind: 'result', result: 'won' },
        { kind: 'result', result: 'lost' },
        { kind: 'result', result: 'escaped' },
        { kind: 'result', result: 'captured' },
      ],
      { player: [], opponent: [] },
      observer,
    ))

    expect(output).toEqual([
      { kind: 'battle-finished', outcome: 'win' },
      { kind: 'battle-finished', outcome: 'loss' },
      { kind: 'battle-finished', outcome: 'flee' },
    ])
  })

  it('déduplique seulement les notifications strictement identiques dans un lot simple', () => {
    const defeated = pokemon('simple-deduplicated', 155, 44)
    const faint: SimpleBattleEvent = {
      kind: 'faint',
      side: 'opponent',
      pokemonName: defeated.speciesName,
      defeated,
    }
    const output = collect((observer) => observeSimpleBattleOutcomeEvents(
      [faint, faint, { kind: 'result', result: 'won' }, { kind: 'result', result: 'won' }],
      { player: [], opponent: [defeated] },
      observer,
    ))

    expect(output).toEqual([
      {
        kind: 'pokemon-knocked-out',
        pokemon: { instanceId: defeated.instanceId, side: 'opponent', partyIndex: 0 },
      },
      { kind: 'battle-finished', outcome: 'win' },
    ])
  })

  it('retrouve un KO double dans la bonne party et accepte une party partagée', () => {
    const defeated = pokemon('double-defeated', 155, 72)
    const collision = pokemon('double-collision', 155, 72)
    const sharedParty = [collision, defeated]
    const teams = {
      player: [{ party: [pokemon('double-player-a', 152, 1)] }, { party: [pokemon('double-player-b', 158, 2)] }],
      opponent: [{ party: sharedParty }, { party: sharedParty }],
    } satisfies DoubleBattleOutcomeTeams
    const faint: DoubleBattleEvent = {
      kind: 'faint',
      target: { side: 'opponent', slot: 1 },
      pokemonName: defeated.speciesName,
      defeated,
    }
    const output = collect((observer) => observeDoubleBattleOutcomeEvents(
      [faint, faint, { kind: 'result', result: 'won' }],
      teams,
      observer,
    ))

    expect(output).toEqual([
      {
        kind: 'pokemon-knocked-out',
        pokemon: { instanceId: defeated.instanceId, side: 'opponent', partyIndex: 1 },
      },
      { kind: 'battle-finished', outcome: 'win' },
    ])
  })

  it('projette une défaite double', () => {
    const output = collect((observer) => observeDoubleBattleOutcomeEvents(
      [{ kind: 'result', result: 'lost' }],
      { player: [], opponent: [] },
      observer,
    ))

    expect(output).toEqual([{ kind: 'battle-finished', outcome: 'loss' }])
  })

  it("n'émet pas un KO dont l'instanceId est absent ou ambigu", () => {
    const defeated = pokemon('ambiguous', 155, 72)
    const cloneWithDuplicatedIdentity = { ...defeated }
    const teams = {
      player: [{ party: [] }, { party: [] }],
      opponent: [{ party: [defeated] }, { party: [cloneWithDuplicatedIdentity] }],
    } satisfies DoubleBattleOutcomeTeams
    const output = collect((observer) => observeDoubleBattleOutcomeEvents([{
      kind: 'faint',
      target: { side: 'opponent', slot: 0 },
      pokemonName: defeated.speciesName,
      defeated,
    }], teams, observer))

    expect(output).toEqual([])
  })

  it("projette une capture adverse explicite et reste neutre sans observateur", () => {
    const captured = pokemon('captured', 155, 72)
    const output = collect((observer) => observeExplicitOpponentCapture(captured, 2, observer))

    expect(output).toEqual([{
      kind: 'battle-finished',
      outcome: 'capture',
      capturedPokemon: { instanceId: captured.instanceId, side: 'opponent', partyIndex: 2 },
    }])
    expect(() => {
      observeSimpleBattleOutcomeEvents([], { player: [], opponent: [] })
      observeDoubleBattleOutcomeEvents([], { player: [], opponent: [] })
      observeExplicitOpponentCapture(captured, 2)
    }).not.toThrow()
  })
})

function collect(run: (observer: DetailedBattleOutcomeObserver) => void): DetailedBattleOutcomeEvent[] {
  const events: DetailedBattleOutcomeEvent[] = []
  run({ observeBattleOutcome: (event) => events.push(event) })
  return events
}

function pokemon(instancePath: string, speciesId: number, personality: number): CanonicalPokemon {
  return createCanonicalPokemon(createPokemonTestCatalog(), {
    instanceId: deriveLegacyPokemonInstanceId('battle-outcome-projection', instancePath),
    speciesId,
    level: 10,
    rng: createHgssLcrng(personality),
    personality: { kind: 'fixed', value: personality },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 7, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
    ballId: 4,
  })
}
