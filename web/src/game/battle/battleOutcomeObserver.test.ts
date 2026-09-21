import { describe, expect, it } from 'vitest'
import {
  composeDetailedBattleOutcomeObservers,
  noopDetailedBattleOutcomeObserver,
  type DetailedBattleOutcomeEvent,
  type DetailedBattleOutcomeObserver,
} from './battleOutcomeObserver'
import { deriveLegacyPokemonInstanceId } from '../pokemon/pokemonInstanceId'

const identity = {
  instanceId: deriveLegacyPokemonInstanceId('battle-outcome-observer', 'party/0'),
  side: 'player',
  partyIndex: 0,
} as const

const events: readonly DetailedBattleOutcomeEvent[] = [
  { kind: 'pokemon-knocked-out', pokemon: identity },
  { kind: 'battle-finished', outcome: 'win' },
  { kind: 'battle-finished', outcome: 'loss' },
  { kind: 'battle-finished', outcome: 'flee' },
  { kind: 'battle-finished', outcome: 'capture', capturedPokemon: identity },
]

describe('detailed battle outcome observer', () => {
  it('reste un no-op pour tous les événements détaillés du jeu de base', () => {
    expect(() => {
      for (const event of events) noopDetailedBattleOutcomeObserver.observeBattleOutcome(event)
    }).not.toThrow()
  })

  it('notifie les observateurs dans leur ordre déclaré et fige leur liste', () => {
    const calls: string[] = []
    const observers: DetailedBattleOutcomeObserver[] = [
      { observeBattleOutcome: (event) => calls.push(`first:${event.kind}`) },
      { observeBattleOutcome: (event) => calls.push(`second:${event.kind}`) },
    ]
    const composite = composeDetailedBattleOutcomeObservers(observers)
    observers.reverse()

    composite.observeBattleOutcome(events[0]!)

    expect(calls).toEqual(['first:pokemon-knocked-out', 'second:pokemon-knocked-out'])
  })

  it('conserve les issues et identités KO directement sérialisables en JSON', () => {
    expect(JSON.parse(JSON.stringify(events))).toEqual(events)
  })
})
