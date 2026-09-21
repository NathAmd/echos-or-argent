import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createDoubleBattleSession } from './doubleBattleSession'
import { resolveDoubleBattleMoveTargets } from './doubleBattleTargeting'

const catalog = createPokemonTestCatalog()

function mon(speciesId: number) {
  return createCanonicalPokemon(catalog, {
    speciesId, level: 20, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: 20, metTerrain: 0 }, ballId: 4, moveIds: [33],
  })
}

function session() {
  return createDoubleBattleSession({ kind: 'multi', catalog, player: [
    { ownerId: 'playerA', party: [mon(152)], activePartyIndex: 0, controlled: true },
    { ownerId: 'playerB', party: [mon(155)], activePartyIndex: 0, controlled: false },
  ], opponent: [
    { ownerId: 'opponentA', party: [mon(158)], activePartyIndex: 0, controlled: false },
    { ownerId: 'opponentB', party: [mon(152)], activePartyIndex: 0, controlled: false },
  ] })
}

describe('ciblage double HGSS', () => {
  it('donne la priorité à Suivez-moi avant Paratonnerre et respecte l’ordre du tour', () => {
    const battle = session()
    const actor = { side: 'player', slot: 0 } as const
    const chosen = { side: 'opponent', slot: 0 } as const
    const redirector = { side: 'opponent', slot: 1 } as const
    const move = { ...battle.teams.player[0].party[0]!.moves[0]!.data, type: 13, range: 0 }
    battle.teams.opponent[1].party[0]!.abilityId = 31
    battle.turnOrder = [redirector, chosen, actor, { side: 'player', slot: 1 }]

    expect(resolveDoubleBattleMoveTargets(battle, actor, 0, chosen, createHgssLcrng(1), move)).toEqual([redirector])
    battle.teams.opponent[0].volatile.followMe = true
    expect(resolveDoubleBattleMoveTargets(battle, actor, 0, chosen, createHgssLcrng(1), move)).toEqual([chosen])
  })

  it('applique Lavabo à l’eau mais ignore les redirections avec Brise Moule ou Normalise', () => {
    const battle = session()
    const actor = { side: 'player', slot: 0 } as const
    const chosen = { side: 'opponent', slot: 0 } as const
    const redirector = { side: 'opponent', slot: 1 } as const
    const move = { ...battle.teams.player[0].party[0]!.moves[0]!.data, type: 11, range: 0 }
    battle.teams.opponent[1].party[0]!.abilityId = 114
    battle.turnOrder = [redirector, chosen, actor, { side: 'player', slot: 1 }]

    expect(resolveDoubleBattleMoveTargets(battle, actor, 0, chosen, createHgssLcrng(2), move)).toEqual([redirector])
    battle.teams.player[0].party[0]!.abilityId = 104
    expect(resolveDoubleBattleMoveTargets(battle, actor, 0, chosen, createHgssLcrng(2), move)).toEqual([chosen])
    battle.teams.player[0].party[0]!.abilityId = 96
    expect(resolveDoubleBattleMoveTargets(battle, actor, 0, chosen, createHgssLcrng(2), move)).toEqual([chosen])
  })
})
