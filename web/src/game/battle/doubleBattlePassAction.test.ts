import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { executeAdmittedDoubleBattleTurn, validateDoubleBattlePlayerActions } from './doubleBattleActionAdmission'
import { chooseDoubleBattleAiAction } from './doubleBattleAi'
import { commitDoubleBattleCommandAction, createDoubleBattleCommandSelectionState } from './doubleBattleCommandSelection'
import { createDoubleBattleSession, type DoubleBattlePassAction } from './doubleBattleSession'

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

function session() {
  return createDoubleBattleSession({
    kind: 'double',
    catalog,
    player: [
      { ownerId: 'player-a', party: [pokemon(152)], activePartyIndex: 0, controlled: true },
      { ownerId: 'player-b', party: [pokemon(155)], activePartyIndex: 0, controlled: true },
    ],
    opponent: [
      { ownerId: 'opponent', party: [pokemon(158)], activePartyIndex: 0, controlled: false },
    ],
  })
}

const pass = (slot: 0 | 1): DoubleBattlePassAction => ({
  kind: 'pass',
  actor: { side: 'player', slot },
})

describe('commande pass du combat double', () => {
  it('traverse la sélection de commandes jusqu’au tour prêt', () => {
    const battle = session()
    const first = commitDoubleBattleCommandAction(battle, createDoubleBattleCommandSelectionState(), pass(0))
    expect(first).toMatchObject({ kind: 'awaiting-action', actor: { side: 'player', slot: 1 } })
    if (first.kind !== 'awaiting-action') throw new Error('Le second combattant devrait encore attendre sa commande.')

    const second = commitDoubleBattleCommandAction(battle, first.state, pass(1))

    expect(second).toMatchObject({ kind: 'turn-ready', actions: [pass(0), pass(1)] })
  })

  it('est admise uniquement pour les combattants joueur qui attendent une commande', () => {
    const battle = session()

    expect(validateDoubleBattlePlayerActions(battle, [pass(0), pass(1)])).toEqual({ accepted: true })
    expect(validateDoubleBattlePlayerActions(battle, [pass(0), {
      kind: 'pass',
      actor: { side: 'opponent', slot: 0 },
    }])).toMatchObject({ accepted: false, code: 'unexpected-actor' })
  })

  it('ne produit aucun effet direct mais laisse jouer l’IA, les résidus et la victoire', () => {
    const battle = session()
    const opponent = battle.teams.opponent[0]
    const opponentPokemon = opponent.party[0]!
    const opponentMove = opponentPokemon.moves[0]!
    opponentMove.data = { ...opponentMove.data, effect: 85, power: 0, accuracy: 0, priority: -2, range: 1 << 4 }
    opponentPokemon.currentHp = 1
    opponentPokemon.status = 0x8
    const playerPp = battle.teams.player.map((participant) => participant.party[0]!.moves[0]!.pp)

    const events = executeAdmittedDoubleBattleTurn(
      battle,
      [pass(0), pass(1)],
      catalog,
      createHgssLcrng(4),
    )

    expect(events.filter((event) => event.kind === 'move').map((event) => event.actor)).toEqual([
      { side: 'opponent', slot: 0 },
    ])
    expect(events.some((event) => 'actor' in event && event.actor.side === 'player')).toBe(false)
    expect(events).toContainEqual(expect.objectContaining({ kind: 'residual', target: { side: 'opponent', slot: 0 }, status: 'poison' }))
    expect(events).toContainEqual({ kind: 'result', result: 'won' })
    expect(battle).toMatchObject({ turn: 1, phase: 'ended', result: 'won' })
    expect(battle.teams.player.map((participant) => participant.volatile.actedThisTurn)).toEqual([true, true])
    expect(battle.teams.player.map((participant) => participant.party[0]!.moves[0]!.pp)).toEqual(playerPp)
  })

  it('n’est jamais produite par le sélecteur IA', () => {
    const battle = session()
    const action = chooseDoubleBattleAiAction(
      battle,
      { side: 'opponent', slot: 0 },
      catalog,
      createHgssLcrng(5),
      false,
    )

    expect(action.kind).not.toBe('pass')
  })
})
