import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { executeAdmittedDoubleBattleTurn, validateDoubleBattlePlayerActions } from './doubleBattleActionAdmission'
import { commitDoubleBattleCommandAction, createDoubleBattleCommandSelectionState } from './doubleBattleCommandSelection'
import {
  createDoubleBattleSession,
  getDoubleBattleExperienceParticipants,
  getDoubleBattleOccupiedPositions,
  getRequiredDoubleBattleActors,
  submitDoubleBattleReplacement,
  syncDoubleBattleParties,
  type DoubleBattleAction,
  type DoubleBattleParticipant,
  type DoubleBattleParticipantInput,
} from './doubleBattleSession'
import { resolveDoubleBattleMoveTargets } from './doubleBattleTargeting'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId, level: 20, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 10 }, originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 20, metTerrain: 0 }, ballId: 4,
    moveIds: [33],
  })
}

function onePlayerSession(withReserve = false) {
  return createDoubleBattleSession({
    kind: 'double', catalog, allowSinglePlayerParticipant: true,
    player: [{ ownerId: 'player', party: withReserve ? [pokemon(152), pokemon(155)] : [pokemon(152)], activePartyIndex: 0, controlled: true }],
    opponent: [
      { ownerId: 'opponent-a', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
      { ownerId: 'opponent-b', party: [pokemon(152)], activePartyIndex: 0, controlled: false },
    ],
  })
}

function setIdle(participant: DoubleBattleParticipant, priority = -2): void {
  const move = participant.party[participant.activePartyIndex]!.moves[0]!
  move.data = { ...move.data, effect: 85, power: 0, accuracy: 0, priority, range: 1 << 4 }
}

const playerMove = (targetSlot: 0 | 1 = 0): DoubleBattleAction => ({
  actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: targetSlot },
})

describe('combat double NG+ à un seul participant joueur', () => {
  it('exige une dérogation explicite et ne l’autorise jamais en combat Multi', () => {
    const player: [DoubleBattleParticipantInput] = [{ ownerId: 'player', party: [pokemon(152)], activePartyIndex: 0, controlled: true }]
    const opponent: [DoubleBattleParticipantInput] = [{ ownerId: 'opponent', party: [pokemon(158)], activePartyIndex: 0, controlled: false }]

    expect(() => createDoubleBattleSession({ kind: 'double', catalog, player, opponent })).toThrow('dérogation NG+')
    expect(() => createDoubleBattleSession({
      kind: 'multi', catalog, player, opponent, allowSinglePlayerParticipant: true,
    })).toThrow('dérogation NG+')
    expect(onePlayerSession().teams.player).toHaveLength(1)
  })

  it('n’expose aucun slot joueur fantôme au roster, aux commandes ou au ciblage', () => {
    const session = onePlayerSession()

    expect(getDoubleBattleOccupiedPositions(session)).toEqual([
      { side: 'player', slot: 0 }, { side: 'opponent', slot: 0 }, { side: 'opponent', slot: 1 },
    ])
    expect(getRequiredDoubleBattleActors(session)).toEqual([{ side: 'player', slot: 0 }])
    expect(resolveDoubleBattleMoveTargets(
      session, { side: 'opponent', slot: 0 }, 0, { side: 'player', slot: 1 }, createHgssLcrng(1),
    )).toEqual([{ side: 'player', slot: 0 }])
    expect(resolveDoubleBattleMoveTargets(
      session, { side: 'player', slot: 0 }, 1 << 2, { side: 'opponent', slot: 0 }, createHgssLcrng(2),
    )).toEqual([{ side: 'opponent', slot: 0 }, { side: 'opponent', slot: 1 }])
  })

  it('demande une seule commande, refuse player:1 et exécute les deux IA', () => {
    const session = onePlayerSession()
    for (const participant of [...session.teams.player, ...session.teams.opponent]) setIdle(participant)
    const action = playerMove()

    expect(validateDoubleBattlePlayerActions(session, [action])).toEqual({ accepted: true })
    expect(validateDoubleBattlePlayerActions(session, [action, {
      ...action, actor: { side: 'player', slot: 1 },
    }])).toMatchObject({ accepted: false, code: 'unexpected-actor' })
    const committed = commitDoubleBattleCommandAction(session, createDoubleBattleCommandSelectionState(), action)
    expect(committed.kind).toBe('turn-ready')

    const events = executeAdmittedDoubleBattleTurn(session, [action], catalog, createHgssLcrng(3))
    expect(events.filter(({ kind }) => kind === 'move').map((event) => 'actor' in event ? event.actor : undefined)).toEqual(expect.arrayContaining([
      { side: 'player', slot: 0 }, { side: 'opponent', slot: 0 }, { side: 'opponent', slot: 1 },
    ]))
    expect(events.some((event) => 'actor' in event && event.actor.side === 'player' && event.actor.slot === 1)).toBe(false)
  })

  it('fait échouer proprement Coup d’Main sans partenaire', () => {
    const session = onePlayerSession()
    const move = session.teams.player[0]!.party[0]!.moves[0]!
    move.data = { ...move.data, effect: 176, power: 0, range: 1 << 8, priority: 5 }
    session.teams.opponent.forEach((participant) => setIdle(participant))
    const targets = resolveDoubleBattleMoveTargets(
      session, { side: 'player', slot: 0 }, move.data.range, { side: 'player', slot: 1 }, createHgssLcrng(4), move.data,
    )

    expect(targets).toEqual([{ side: 'player', slot: 0 }])
    const events = executeAdmittedDoubleBattleTurn(session, [{
      actor: { side: 'player', slot: 0 }, moveIndex: 0, target: targets[0]!,
    }], catalog, createHgssLcrng(5))
    expect(events).toContainEqual(expect.objectContaining({ kind: 'condition', condition: 'helpingHand', applied: false }))
  })

  it('demande le remplacement du seul slot puis synchronise sa réserve', () => {
    const session = onePlayerSession(true)
    session.teams.player[0]!.party[0]!.currentHp = 1
    for (const opponent of session.teams.opponent) {
      const move = opponent.party[0]!.moves[0]!
      move.data = { ...move.data, effect: 0, power: 250, accuracy: 0, priority: 5, range: 0 }
    }

    const events = executeAdmittedDoubleBattleTurn(session, [{
      kind: 'pass', actor: { side: 'player', slot: 0 },
    }], catalog, createHgssLcrng(6))
    expect(session.phase).toBe('replacement')
    expect(events).toContainEqual(expect.objectContaining({
      kind: 'replacementRequest', target: { side: 'player', slot: 0 }, reserveIndexes: [1],
    }))

    submitDoubleBattleReplacement(session, { side: 'player', slot: 0 }, 1, catalog, createHgssLcrng(7))
    expect(session).toMatchObject({ phase: 'command', teams: { player: [{ activePartyIndex: 1 }] } })
    expect(syncDoubleBattleParties(session).get('player')).toHaveLength(2)
  })

  it('attribue l’EXP au seul actif et gagne contre les deux adversaires', () => {
    const session = onePlayerSession()
    const player = session.teams.player[0]!.party[0]!
    const defeated = session.teams.opponent[0]!.party[0]!
    expect(getDoubleBattleExperienceParticipants(session, { side: 'opponent', slot: 0 }, defeated).get('player')).toEqual([0])
    const move = player.moves[0]!
    move.data = { ...move.data, effect: 0, power: 250, accuracy: 0, priority: 5, range: 1 << 2 }
    session.teams.opponent.forEach((participant) => {
      participant.party[0]!.currentHp = 1
      setIdle(participant)
    })

    const events = executeAdmittedDoubleBattleTurn(session, [playerMove()], catalog, createHgssLcrng(8))
    expect(session).toMatchObject({ phase: 'ended', result: 'won' })
    expect(events).toContainEqual({ kind: 'result', result: 'won' })
  })

  it('perd normalement si son unique combattant tombe sans réserve', () => {
    const session = onePlayerSession()
    session.teams.player[0]!.party[0]!.currentHp = 1
    for (const opponent of session.teams.opponent) {
      const move = opponent.party[0]!.moves[0]!
      move.data = { ...move.data, effect: 0, power: 250, accuracy: 0, priority: 5, range: 0 }
    }

    const events = executeAdmittedDoubleBattleTurn(session, [{
      kind: 'pass', actor: { side: 'player', slot: 0 },
    }], catalog, createHgssLcrng(9))
    expect(session).toMatchObject({ phase: 'ended', result: 'lost' })
    expect(events).toContainEqual({ kind: 'result', result: 'lost' })
  })
})
