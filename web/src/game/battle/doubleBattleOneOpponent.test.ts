import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  consumeDoubleBattleInitialEvents,
  createDoubleBattleSession,
  executeDoubleBattleTurn,
  getDoubleBattleExperienceParticipants,
  getDoubleBattleOccupiedPositions,
  getLivingDoubleBattleTargets,
  isDoubleBattlePositionOccupied,
} from './doubleBattleSession'
import { resolveDoubleBattleMoveTargets } from './doubleBattleTargeting'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 10,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 10, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function oneOpponentSession(opponentParty = [pokemon(158)]) {
  return createDoubleBattleSession({
    kind: 'double',
    catalog,
    player: [
      { ownerId: 'player-a', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'player-b', party: [pokemon(155)], activePartyIndex: 0, controlled: true },
    ],
    opponent: [
      { ownerId: 'opponent', party: opponentParty, activePartyIndex: 0, controlled: false },
    ],
  })
}

function makeIdle(participant: ReturnType<typeof oneOpponentSession>['teams']['player'][number], priority = -2): void {
  const move = participant.party[participant.activePartyIndex]!.moves[0]!
  move.data = { ...move.data, effect: 85, power: 0, accuracy: 0, priority, range: 1 << 4 }
}

function playerActions() {
  return [
    { actor: { side: 'player' as const, slot: 0 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } },
    { actor: { side: 'player' as const, slot: 1 as const }, moveIndex: 0, target: { side: 'opponent' as const, slot: 0 as const } },
  ]
}

describe('combat double à un seul participant adverse', () => {
  it('représente le slot absent sans Pokémon factice et ne le propose jamais comme cible', () => {
    const session = oneOpponentSession()

    expect(session.teams.player).toHaveLength(2)
    expect(session.teams.opponent).toHaveLength(1)
    expect(session.teams.opponent[1]).toBeUndefined()
    expect(getDoubleBattleOccupiedPositions(session)).toEqual([
      { side: 'player', slot: 0 },
      { side: 'player', slot: 1 },
      { side: 'opponent', slot: 0 },
    ])
    expect(isDoubleBattlePositionOccupied(session, { side: 'opponent', slot: 1 })).toBe(false)
    expect(getLivingDoubleBattleTargets(session, 'opponent')).toEqual([{ side: 'opponent', slot: 0 }])
    expect(resolveDoubleBattleMoveTargets(
      session,
      { side: 'player', slot: 0 },
      1 << 2,
      { side: 'opponent', slot: 1 },
      createHgssLcrng(1),
    )).toEqual([{ side: 'opponent', slot: 0 }])
  })

  it('exécute exactement les actions des deux joueurs et de l’unique adversaire', () => {
    const session = oneOpponentSession()
    for (const participant of [...session.teams.player, ...session.teams.opponent]) makeIdle(participant)

    const events = executeDoubleBattleTurn(session, playerActions(), catalog, createHgssLcrng(2))
    const actors = events.filter((event) => event.kind === 'move').map((event) => event.actor)

    expect(actors).toHaveLength(3)
    expect(actors).toEqual(expect.arrayContaining([
      { side: 'player', slot: 0 },
      { side: 'player', slot: 1 },
      { side: 'opponent', slot: 0 },
    ]))
    expect(events.some((event) => 'actor' in event && event.actor.side === 'opponent' && event.actor.slot === 1)).toBe(false)
    expect(events.some((event) => 'target' in event && event.target.side === 'opponent' && event.target.slot === 1)).toBe(false)
  })

  it('ne compte qu’une seule Pression adverse et aucune participation fantôme', () => {
    const session = oneOpponentSession()
    const attacker = session.teams.player[0]
    const move = attacker.party[0]!.moves[0]!
    move.data = { ...move.data, power: 20, accuracy: 0, priority: 2, range: 1 << 2 }
    session.teams.opponent[0].party[0]!.abilityId = 46
    makeIdle(session.teams.player[1])
    makeIdle(session.teams.opponent[0])
    const ppBefore = move.pp
    const defeated = session.teams.opponent[0].party[0]!

    const participants = getDoubleBattleExperienceParticipants(
      session,
      { side: 'opponent', slot: 0 },
      defeated,
    )
    executeDoubleBattleTurn(session, playerActions(), catalog, createHgssLcrng(3))

    expect(move.pp).toBe(ppBefore - 2)
    expect([...participants.keys()].sort()).toEqual(['player-a', 'player-b'])
    expect(session.experienceParticipation).toHaveLength(3)
  })

  it('applique les talents d’entrée sans événement du slot absent', () => {
    const opponent = pokemon(158)
    opponent.abilityId = 22
    const session = oneOpponentSession([opponent])
    const events = consumeDoubleBattleInitialEvents(session)

    expect(events.filter((event) => event.kind === 'stat')).toEqual(expect.arrayContaining([
      expect.objectContaining({ target: { side: 'player', slot: 0 }, change: -1 }),
      expect.objectContaining({ target: { side: 'player', slot: 1 }, change: -1 }),
    ]))
    expect(events.some((event) => 'target' in event && event.target.side === 'opponent' && event.target.slot === 1)).toBe(false)
  })

  it('termine sur une victoire dès que l’unique équipe adverse est épuisée', () => {
    const session = oneOpponentSession()
    const target = session.teams.opponent[0].party[0]!
    target.currentHp = 1
    const attack = session.teams.player[0].party[0]!.moves[0]!
    attack.data = { ...attack.data, power: 200, accuracy: 0, priority: 5, range: 0 }
    makeIdle(session.teams.player[1])
    makeIdle(session.teams.opponent[0])

    const events = executeDoubleBattleTurn(session, playerActions(), catalog, createHgssLcrng(4))

    expect(session).toMatchObject({ phase: 'ended', result: 'won' })
    expect(events).toContainEqual({ kind: 'result', result: 'won' })
    expect(events.some((event) => 'target' in event && event.target.side === 'opponent' && event.target.slot === 1)).toBe(false)
  })

  it('remplace dans le slot adverse existant sans créer un second participant', () => {
    const session = oneOpponentSession([pokemon(158), pokemon(152)])
    session.teams.opponent[0].party[0]!.currentHp = 1
    const attack = session.teams.player[0].party[0]!.moves[0]!
    attack.data = { ...attack.data, power: 200, accuracy: 0, priority: 5, range: 0 }
    makeIdle(session.teams.player[1])
    makeIdle(session.teams.opponent[0])

    const events = executeDoubleBattleTurn(session, playerActions(), catalog, createHgssLcrng(5))

    expect(session.teams.opponent).toHaveLength(1)
    expect(session.teams.opponent[0].activePartyIndex).toBe(1)
    expect(session.phase).toBe('command')
    expect(events).toContainEqual(expect.objectContaining({ kind: 'sendOut', target: { side: 'opponent', slot: 0 }, partyIndex: 1 }))
    expect(events.some((event) => 'target' in event && event.target.side === 'opponent' && event.target.slot === 1)).toBe(false)
  })
})
