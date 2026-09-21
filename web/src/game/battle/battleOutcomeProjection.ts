import type { CanonicalPokemon } from '../pokemon/canonicalPokemon'
import {
  noopDetailedBattleOutcomeObserver,
  type BattleOutcomePokemonIdentity,
  type DetailedBattleOutcomeEvent,
  type DetailedBattleOutcomeObserver,
} from './battleOutcomeObserver'
import type {
  DoubleBattleEvent,
  DoubleBattleSide,
} from './doubleBattleSession'
import type {
  SimpleBattleEvent,
  SimpleBattleSide,
} from './simpleBattleSession'

type BattleOutcomePokemonReference = Pick<CanonicalPokemon, 'instanceId'>

export type SimpleBattleOutcomeParties = Readonly<
  Record<SimpleBattleSide, readonly BattleOutcomePokemonReference[]>
>

export type DoubleBattleOutcomeTeams = Readonly<
  Record<DoubleBattleSide, readonly Readonly<{
    party: readonly BattleOutcomePokemonReference[]
  }>[]>
>

function findUniquePartyIndex(
  parties: readonly (readonly BattleOutcomePokemonReference[])[],
  instanceId: CanonicalPokemon['instanceId'],
): number | undefined {
  const distinctParties = new Set<readonly BattleOutcomePokemonReference[]>()
  let foundIndex: number | undefined

  for (const party of parties) {
    if (distinctParties.has(party)) continue
    distinctParties.add(party)

    for (let partyIndex = 0; partyIndex < party.length; partyIndex += 1) {
      if (party[partyIndex]?.instanceId !== instanceId) continue
      if (foundIndex !== undefined) return undefined
      foundIndex = partyIndex
    }
  }

  return foundIndex
}

function observeOnce(
  observer: DetailedBattleOutcomeObserver,
  observedKeys: Set<string>,
  key: string,
  event: DetailedBattleOutcomeEvent,
): void {
  if (observedKeys.has(key)) return
  observedKeys.add(key)
  observer.observeBattleOutcome(event)
}

function simpleResultOutcome(
  result: Extract<SimpleBattleEvent, { kind: 'result' }>['result'],
): 'win' | 'loss' | 'flee' | undefined {
  if (result === 'won') return 'win'
  if (result === 'lost') return 'loss'
  if (result === 'escaped') return 'flee'
  return undefined
}

/**
 * Projette uniquement les événements détaillés dont l'identité est certaine.
 * Une capture est volontairement exclue : son index de combat doit être fourni
 * explicitement à observeExplicitOpponentCapture.
 */
export function observeSimpleBattleOutcomeEvents(
  events: readonly SimpleBattleEvent[],
  parties: SimpleBattleOutcomeParties,
  observer: DetailedBattleOutcomeObserver = noopDetailedBattleOutcomeObserver,
): void {
  const observedKeys = new Set<string>()

  for (const event of events) {
    if (event.kind === 'faint') {
      const partyIndex = findUniquePartyIndex([parties[event.side]], event.defeated.instanceId)
      if (partyIndex === undefined) continue
      const pokemon: BattleOutcomePokemonIdentity = {
        instanceId: event.defeated.instanceId,
        side: event.side,
        partyIndex,
      }
      observeOnce(
        observer,
        observedKeys,
        `knocked-out:${pokemon.side}:${pokemon.instanceId}:${pokemon.partyIndex}`,
        { kind: 'pokemon-knocked-out', pokemon },
      )
      continue
    }

    if (event.kind !== 'result') continue
    const outcome = simpleResultOutcome(event.result)
    if (!outcome) continue
    observeOnce(
      observer,
      observedKeys,
      `battle-finished:${outcome}`,
      { kind: 'battle-finished', outcome },
    )
  }
}

/** Projette les KO et l'issue d'un lot d'événements de combat double. */
export function observeDoubleBattleOutcomeEvents(
  events: readonly DoubleBattleEvent[],
  teams: DoubleBattleOutcomeTeams,
  observer: DetailedBattleOutcomeObserver = noopDetailedBattleOutcomeObserver,
): void {
  const observedKeys = new Set<string>()

  for (const event of events) {
    if (event.kind === 'faint') {
      const partyIndex = findUniquePartyIndex(
        teams[event.target.side].map((participant) => participant.party),
        event.defeated.instanceId,
      )
      if (partyIndex === undefined) continue
      const pokemon: BattleOutcomePokemonIdentity = {
        instanceId: event.defeated.instanceId,
        side: event.target.side,
        partyIndex,
      }
      observeOnce(
        observer,
        observedKeys,
        `knocked-out:${pokemon.side}:${pokemon.instanceId}:${pokemon.partyIndex}`,
        { kind: 'pokemon-knocked-out', pokemon },
      )
      continue
    }

    if (event.kind !== 'result') continue
    const outcome = event.result === 'won' ? 'win' : 'loss'
    observeOnce(
      observer,
      observedKeys,
      `battle-finished:${outcome}`,
      { kind: 'battle-finished', outcome },
    )
  }
}

/** Notifie une capture réussie avec l'index de l'adversaire dans le combat. */
export function observeExplicitOpponentCapture(
  capturedPokemon: BattleOutcomePokemonReference,
  battlePartyIndex: number,
  observer: DetailedBattleOutcomeObserver = noopDetailedBattleOutcomeObserver,
): void {
  const identity: BattleOutcomePokemonIdentity = {
    instanceId: capturedPokemon.instanceId,
    side: 'opponent',
    partyIndex: battlePartyIndex,
  }
  observer.observeBattleOutcome({
    kind: 'battle-finished',
    outcome: 'capture',
    capturedPokemon: identity,
  })
}
