import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  clearPendingDoubleBattleMove,
  clearPendingDoubleBattleReplacement,
  commitDoubleBattleCommandAction,
  createDoubleBattleCommandSelectionState,
  getCurrentDoubleBattleCommandActor,
  setPendingDoubleBattleMove,
  setPendingDoubleBattleReplacement,
} from './doubleBattleCommandSelection'
import { createDoubleBattleSession, type DoubleBattlePosition } from './doubleBattleSession'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function doubleSession() {
  const playerParty = [pokemon(152), pokemon(155)]
  const opponentParty = [pokemon(158), pokemon(152)]
  return createDoubleBattleSession({
    kind: 'double',
    catalog,
    player: [
      { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
      { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
    ],
    opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 1, controlled: false },
    ],
  })
}

function multiSession() {
  return createDoubleBattleSession({
    kind: 'multi',
    catalog,
    player: [
      { ownerId: 'player', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'ally', party: [pokemon(155)], activePartyIndex: 0, controlled: false },
    ],
    opponent: [
      { ownerId: 'opponent-a', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent-b', party: [pokemon(152)], activePartyIndex: 0, controlled: false },
    ],
  })
}

describe('double battle command selection state', () => {
  it('collects both local double commands in slot order and drains a ready turn', () => {
    const session = doubleSession()
    const initial = createDoubleBattleCommandSelectionState()
    const withMove = setPendingDoubleBattleMove(initial, 0)

    expect(getCurrentDoubleBattleCommandActor(session, withMove)).toEqual({ side: 'player', slot: 0 })
    const first = commitDoubleBattleCommandAction(session, withMove, {
      actor: { side: 'player', slot: 0 },
      moveIndex: 0,
      target: { side: 'opponent', slot: 0 },
    })

    expect(first).toMatchObject({
      kind: 'awaiting-action',
      actor: { side: 'player', slot: 1 },
      state: { actorCursor: 1, pendingMoveIndex: undefined },
    })
    expect(initial).toEqual({ actions: [], actorCursor: 0 })
    if (first.kind !== 'awaiting-action') throw new Error('Le second slot joueur aurait dû demander une commande.')

    const second = commitDoubleBattleCommandAction(session, setPendingDoubleBattleMove(first.state, 0), {
      actor: { side: 'player', slot: 1 },
      moveIndex: 0,
      target: { side: 'opponent', slot: 1 },
    })

    expect(second.kind).toBe('turn-ready')
    if (second.kind !== 'turn-ready') throw new Error('Le tour double aurait dû être prêt.')
    expect(second.actions.map(({ actor }) => actor)).toEqual([
      { side: 'player', slot: 0 },
      { side: 'player', slot: 1 },
    ])
    expect(second.state).toEqual({ actions: [], actorCursor: 0, pendingMoveIndex: undefined })
  })

  it('requests only the locally controlled player in a multi battle', () => {
    const session = multiSession()
    const initial = createDoubleBattleCommandSelectionState()

    expect(getCurrentDoubleBattleCommandActor(session, initial)).toEqual({ side: 'player', slot: 0 })
    const result = commitDoubleBattleCommandAction(session, initial, {
      actor: { side: 'player', slot: 0 },
      moveIndex: 0,
      target: { side: 'opponent', slot: 0 },
    })

    expect(result.kind).toBe('turn-ready')
    if (result.kind !== 'turn-ready') throw new Error('Le tour multi aurait dû être prêt après la commande joueur.')
    expect(result.actions).toHaveLength(1)
    expect(result.actions[0]?.actor).toEqual({ side: 'player', slot: 0 })
  })

  it('uses the required actor list when slot zero is already charging', () => {
    const session = doubleSession()
    session.teams.player[0].volatile.chargingMove = {
      moveIndex: 0,
      target: { side: 'opponent', slot: 0 },
    }

    expect(getCurrentDoubleBattleCommandActor(session, createDoubleBattleCommandSelectionState())).toEqual({
      side: 'player',
      slot: 1,
    })
  })

  it('stores and clears move and replacement selections without mutating their sources', () => {
    const initial = createDoubleBattleCommandSelectionState()
    const withMove = setPendingDoubleBattleMove(initial, -1)
    const clearedMove = clearPendingDoubleBattleMove(withMove)
    const target: DoubleBattlePosition = { side: 'player', slot: 0 }
    const reserveIndexes = [2, 3]
    const withReplacement = setPendingDoubleBattleReplacement(clearedMove, { target, reserveIndexes })

    target.slot = 1
    reserveIndexes.push(4)
    expect(initial.pendingMoveIndex).toBeUndefined()
    expect(withMove.pendingMoveIndex).toBe(-1)
    expect(clearedMove.pendingMoveIndex).toBeUndefined()
    expect(withReplacement.pendingReplacement).toEqual({
      target: { side: 'player', slot: 0 },
      reserveIndexes: [2, 3],
    })
    expect(getCurrentDoubleBattleCommandActor(doubleSession(), withReplacement)).toBeUndefined()
    expect(clearPendingDoubleBattleReplacement(withReplacement).pendingReplacement).toBeUndefined()
    expect(withReplacement.pendingReplacement).toBeDefined()
  })

  it('rejects a command for another actor and any command during forced replacement', () => {
    const session = doubleSession()
    const initial = createDoubleBattleCommandSelectionState()
    const wrongActor = {
      actor: { side: 'player' as const, slot: 1 as const },
      moveIndex: 0,
      target: { side: 'opponent' as const, slot: 0 as const },
    }

    expect(() => commitDoubleBattleCommandAction(session, initial, wrongActor)).toThrow('slot joueur 0')
    expect(initial).toEqual({ actions: [], actorCursor: 0 })

    const replacement = setPendingDoubleBattleReplacement(initial, {
      target: { side: 'player', slot: 0 },
      reserveIndexes: [2],
    })
    expect(() => commitDoubleBattleCommandAction(session, replacement, {
      actor: { side: 'player', slot: 0 },
      moveIndex: 0,
      target: { side: 'opponent', slot: 0 },
    })).toThrow('remplacement joueur')
  })
})
