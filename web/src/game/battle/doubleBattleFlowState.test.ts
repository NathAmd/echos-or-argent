import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  createDoubleBattleSession,
  getDoubleBattleExperienceParticipantIndexes,
  getRequiredDoubleBattleReplacementPositions,
  submitDoubleBattleReplacement,
} from './doubleBattleSession'
import { replaceFaintedDoubleBattleParticipants, switchDoubleBattleParticipant } from './doubleBattleSwitching'

const catalog = createPokemonTestCatalog()

function pokemon(speciesId: number, identity: number) {
  return createCanonicalPokemon(catalog, {
    speciesId,
    level: 10,
    rng: createHgssLcrng(identity),
    personality: { kind: 'fixed', value: identity },
    individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'JOUEUR', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 5, metTerrain: 0 },
    ballId: 4,
    moveIds: [33],
  })
}

describe('état global du combat double', () => {
  it("conserve l'historique EXP d'un participant après son retrait", () => {
    const playerParty = [pokemon(152, 1), pokemon(155, 2), pokemon(158, 3)]
    const opponentA = pokemon(158, 11)
    const session = createDoubleBattleSession({
      kind: 'double', catalog,
      player: [
        { ownerId: 'player', party: playerParty, activePartyIndex: 0, controlled: true },
        { ownerId: 'player', party: playerParty, activePartyIndex: 1, controlled: true },
      ],
      opponent: [
        { ownerId: 'opponent-a', party: [opponentA], activePartyIndex: 0, controlled: false },
        { ownerId: 'opponent-b', party: [pokemon(152, 12)], activePartyIndex: 0, controlled: false },
      ],
    })
    const target = { side: 'opponent', slot: 0 } as const
    expect(getDoubleBattleExperienceParticipantIndexes(session, target, opponentA, 'player')).toEqual([0, 1])

    const events: Parameters<typeof switchDoubleBattleParticipant>[5] = []
    expect(switchDoubleBattleParticipant(
      session,
      { side: 'player', slot: 0 },
      2,
      catalog,
      createHgssLcrng(20),
      events,
    )).toBe(true)

    expect(getDoubleBattleExperienceParticipantIndexes(session, target, opponentA, 'player')).toEqual([0, 1, 2])
  })

  it('demande les remplacements contrôlés un par un après un double K.O.', () => {
    const party = [pokemon(152, 21), pokemon(155, 22), pokemon(158, 23), pokemon(152, 24)]
    const session = createDoubleBattleSession({
      kind: 'double', catalog,
      player: [
        { ownerId: 'player', party, activePartyIndex: 0, controlled: true },
        { ownerId: 'player', party, activePartyIndex: 1, controlled: true },
      ],
      opponent: [
        { ownerId: 'opponent-a', party: [pokemon(158, 31)], activePartyIndex: 0, controlled: false },
        { ownerId: 'opponent-b', party: [pokemon(152, 32)], activePartyIndex: 0, controlled: false },
      ],
    })
    session.teams.player[0].party[0]!.currentHp = 0
    session.teams.player[1].party[1]!.currentHp = 0
    const events: Parameters<typeof replaceFaintedDoubleBattleParticipants>[3] = []

    replaceFaintedDoubleBattleParticipants(session, catalog, createHgssLcrng(40), events)

    expect(session.phase).toBe('replacement')
    expect(getRequiredDoubleBattleReplacementPositions(session)).toEqual([{ side: 'player', slot: 0 }])
    expect(events).toContainEqual({
      kind: 'replacementRequest', target: { side: 'player', slot: 0 }, reserveIndexes: [2, 3],
    })
    expect(session.teams.player[0].activePartyIndex).toBe(0)

    const firstReplacement = submitDoubleBattleReplacement(
      session,
      { side: 'player', slot: 0 },
      2,
      catalog,
      createHgssLcrng(41),
    )
    expect(firstReplacement).toContainEqual(expect.objectContaining({
      kind: 'sendOut', target: { side: 'player', slot: 0 }, partyIndex: 2,
    }))
    expect(firstReplacement).toContainEqual({
      kind: 'replacementRequest', target: { side: 'player', slot: 1 }, reserveIndexes: [3],
    })
    expect(getRequiredDoubleBattleReplacementPositions(session)).toEqual([{ side: 'player', slot: 1 }])

    const secondReplacement = submitDoubleBattleReplacement(
      session,
      { side: 'player', slot: 1 },
      3,
      catalog,
      createHgssLcrng(42),
    )
    expect(secondReplacement).toContainEqual(expect.objectContaining({
      kind: 'sendOut', target: { side: 'player', slot: 1 }, partyIndex: 3,
    }))
    expect(session.phase).toBe('command')
    expect(getRequiredDoubleBattleReplacementPositions(session)).toEqual([])
  })
})
