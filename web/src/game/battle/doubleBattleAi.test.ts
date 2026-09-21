import { describe, expect, it } from 'vitest'
import { decodeHgssItemData, hgssItemDataSize, type HgssItemData } from '../../rom/items/itemData'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { chooseDoubleBattleAiMoveCandidate, chooseDoubleBattleAiReplacement } from './doubleBattleAi'
import { createDoubleBattleSession, executeDoubleBattleTurn } from './doubleBattleSession'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number, identity: number, moveIds: number[] = [33]) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 10,
    rng: createHgssLcrng(identity),
    personality: { kind: 'fixed', value: identity },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'IA', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds,
  })
}

function potion(): HgssItemData {
  const payload = new Uint8Array(hgssItemDataSize)
  payload[0x0c] = 1
  payload[0x13] = 0x04
  payload[0x1b] = 20
  return decodeHgssItemData(payload, 17, 'POTION', 'Restaure 20 PV.')
}

describe('stratégie IA du combat double', () => {
  it('expose un sélecteur pur qui privilégie une capacité super efficace', () => {
    const selected = chooseDoubleBattleAiMoveCandidate([
      {
        value: 'immune', power: 80, typeMultiplier: 0, targetCurrentHp: 50, targetMaximumHp: 100,
        targetHasPrimaryStatus: false, targetIsAlly: false, inflictsPrimaryStatus: false, healsTarget: false,
      },
      {
        value: 'effective', power: 60, typeMultiplier: 20, targetCurrentHp: 50, targetMaximumHp: 100,
        targetHasPrimaryStatus: false, targetIsAlly: false, inflictsPrimaryStatus: false, healsTarget: false,
      },
    ], 1, createHgssLcrng(1))
    expect(selected).toBe('effective')
  })

  it('sélectionne tactiquement une réserve lorsque les drapeaux IA sont actifs', () => {
    const selected = chooseDoubleBattleAiReplacement([
      { partyIndex: 2, currentHp: 10, maximumHp: 100, speed: 20, bestTypeMultiplier: 10 },
      { partyIndex: 3, currentHp: 100, maximumHp: 100, speed: 80, bestTypeMultiplier: 20 },
    ], 1, createHgssLcrng(2))
    expect(selected).toBe(3)
  })

  it('branche aiFlags au choix capacité-cible du moteur double', () => {
    const opponent = pokemon(155, 10, [33, 45])
    const session = createDoubleBattleSession({
      kind: 'multi', catalog,
      player: [
        { ownerId: 'player', party: [pokemon(152, 1)], activePartyIndex: 0, controlled: true },
        { ownerId: 'ally', party: [pokemon(158, 2)], activePartyIndex: 0, controlled: false },
      ],
      opponent: [
        { ownerId: 'trainer', party: [opponent], activePartyIndex: 0, controlled: false, ai: { aiFlags: 1 } },
        { ownerId: 'spectator', party: [pokemon(152, 11)], activePartyIndex: 0, controlled: true },
      ],
    })
    const actor = session.teams.opponent[0].party[0]!
    actor.moves[0]!.data = { ...actor.moves[0]!.data, power: 40, type: 13, accuracy: 0 }
    actor.moves[1]!.data = { ...actor.moves[1]!.data, power: 40, type: 10, accuracy: 0 }
    session.teams.player[0].types = [11, 11]
    session.teams.player[1].types = [11, 11]
    session.teams.player[0].party[0]!.moves[0]!.data = {
      ...session.teams.player[0].party[0]!.moves[0]!.data, effect: 85, power: 0, priority: -1,
    }

    const events = executeDoubleBattleTurn(session, [{
      actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 },
    }], catalog, { getSeed: () => 0, nextU16: () => 0 })

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'move', actor: { side: 'opponent', slot: 0 }, moveId: 33,
    }))
  })

  it("utilise et consomme l'inventaire propre d'un Dresseur double", () => {
    const item = potion()
    const items: HgssItemData[] = []
    items[17] = item
    const session = createDoubleBattleSession({
      kind: 'multi', catalog, itemCatalog: { items, pocketNames: [] },
      player: [
        { ownerId: 'player', party: [pokemon(152, 21)], activePartyIndex: 0, controlled: true },
        { ownerId: 'ally', party: [pokemon(158, 22)], activePartyIndex: 0, controlled: true },
      ],
      opponent: [
        {
          ownerId: 'trainer', party: [pokemon(155, 23)], activePartyIndex: 0, controlled: false,
          ai: { aiFlags: 1, items: [17], trainerName: 'DRESSEUR' },
        },
        { ownerId: 'spectator', party: [pokemon(152, 24)], activePartyIndex: 0, controlled: true },
      ],
    })
    const target = session.teams.opponent[0].party[0]!
    target.currentHp = 1
    for (const participant of session.teams.player) participant.party[0]!.moves[0]!.data = {
      ...participant.party[0]!.moves[0]!.data, effect: 85, power: 0,
    }

    const events = executeDoubleBattleTurn(session, [
      { actor: { side: 'player', slot: 0 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
      { actor: { side: 'player', slot: 1 }, moveIndex: 0, target: { side: 'opponent', slot: 0 } },
    ], catalog, createHgssLcrng(25))

    expect(events).toContainEqual(expect.objectContaining({
      kind: 'item', actor: { side: 'opponent', slot: 0 }, itemId: 17,
      source: 'trainer', trainerName: 'DRESSEUR', applied: true,
    }))
    expect(target.currentHp).toBeGreaterThan(1)
    expect(session.teams.opponent[0].ai.items).toEqual([])
  })
})
