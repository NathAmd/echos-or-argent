import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { executeAdmittedDoubleBattleTurn, validateDoubleBattlePlayerActions } from './doubleBattleActionAdmission'
import { createDoubleBattleSession, type DoubleBattleAction } from './doubleBattleSession'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 5,
    rng: createHgssLcrng(speciesId),
    personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

function session() {
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

const move = (slot: 0 | 1): DoubleBattleAction => ({
  actor: { side: 'player', slot },
  moveIndex: 0,
  target: { side: 'opponent', slot },
})

describe('double battle player action admission', () => {
  it('accepte exactement une commande par acteur local requis', () => {
    expect(validateDoubleBattlePlayerActions(session(), [move(0), move(1)])).toEqual({ accepted: true })
  })

  it('refuse une commande manquante, dupliquée ou appartenant à l’IA', () => {
    expect(validateDoubleBattlePlayerActions(session(), [move(0)])).toMatchObject({ accepted: false, code: 'missing-actor' })
    expect(validateDoubleBattlePlayerActions(session(), [move(0), move(0)])).toMatchObject({ accepted: false, code: 'duplicate-actor' })
    expect(validateDoubleBattlePlayerActions(session(), [move(0), {
      actor: { side: 'opponent', slot: 0 }, moveIndex: 0, target: { side: 'player', slot: 0 },
    }])).toMatchObject({ accepted: false, code: 'unexpected-actor' })
  })

  it('refuse les objets Dresseur à la frontière joueur', () => {
    expect(validateDoubleBattlePlayerActions(session(), [move(0), {
      kind: 'trainerItem', actor: { side: 'player', slot: 1 }, itemId: 17, targetPartyIndex: 1,
    }])).toMatchObject({ accepted: false, code: 'trainer-item' })
  })

  it('rejette avant toute mutation du tour', () => {
    const battle = session()
    expect(() => executeAdmittedDoubleBattleTurn(battle, [move(0)], catalog, createHgssLcrng(10))).toThrow('absente')
    expect(battle.turn).toBe(0)
    expect(battle.turnOrder).toEqual([])
    expect(battle.teams.player[0].volatile.actedThisTurn).toBe(false)
  })

  it('applique aussi la politique d’action à la frontière autoritative', () => {
    const battle = session()
    const actionPolicy = {
      vetoPlayerAction: (intent: Parameters<import('./battleActionPolicy').BattleActionPolicy['vetoPlayerAction']>[0]) => intent.kind === 'switch'
        ? { code: 'hardcore-switch', reason: 'Changement gratuit interdit.' }
        : undefined,
    }
    const actions: DoubleBattleAction[] = [
      { kind: 'switch', actor: { side: 'player', slot: 0 }, partyIndex: 1 },
      move(1),
    ]

    expect(validateDoubleBattlePlayerActions(battle, actions, undefined, actionPolicy)).toEqual({
      accepted: false,
      code: 'action-policy',
      reason: 'Changement gratuit interdit.',
    })
    expect(battle.turn).toBe(0)
  })

  it('délègue une admission valide au moteur existant', () => {
    const battle = session()
    const events = executeAdmittedDoubleBattleTurn(battle, [move(0), move(1)], catalog, createHgssLcrng(11))
    expect(battle.turn).toBe(1)
    expect(events.some((event) => event.kind === 'move')).toBe(true)
  })
})
