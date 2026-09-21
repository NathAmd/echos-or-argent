import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { createPokemonStorage } from '../pokemon/pokemonStorage'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { basePokemonTeamPolicy } from '../pokemon/pokemonTeamPolicy'
import { attemptFieldWildCapture } from './fieldWildCaptureAttempt'
import { createFieldDoubleWildBattleSession } from './fieldDoubleWildBattle'
import { escapeDoubleWildBattleWithItem, tryRunFromDoubleWildBattle } from './doubleWildBattleEscape'
import { getDoubleBattlePokemon, syncDoubleBattleParties } from './doubleBattleSession'

function pokemon(speciesId: number, speed: number) {
  const catalog = createPokemonTestCatalog()
  const created = createCanonicalPokemon(catalog, {
    speciesId, level: 5, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId },
    individualValues: { kind: 'fixed', value: 10 }, originalTrainer: { id: 1, name: 'JO', gender: 'male' },
    origin: { language: 3, gameVersion: 7, metLocation: 1, metLevel: 5, metTerrain: 0 }, ballId: 4,
  })
  created.stats.speed = speed
  return created
}

describe('combat sauvage duo de terrain', () => {
  it('crée deux joueurs contre un seul sauvage, sans clone adverse', () => {
    const catalog = createPokemonTestCatalog()
    const opponent = pokemon(158, 10)
    const session = createFieldDoubleWildBattleSession({
      playerParty: [pokemon(152, 20), pokemon(155, 15)], opponent, catalog,
      itemCatalog: { items: [] } as never, bagInventory: new Map(), rng: createHgssLcrng(1),
      playerTeamPolicy: basePokemonTeamPolicy, initialWeather: 'clear', initialTerrainId: 0,
    })
    expect(session.kind).toBe('wild')
    expect(session.teams.player).toHaveLength(2)
    expect(session.teams.opponent).toHaveLength(1)
    expect(session.teams.opponent[0]!.party).toHaveLength(1)
  })

  it('crée un seul slot joueur si aucun second Pokémon apte n’est disponible', () => {
    const catalog = createPokemonTestCatalog()
    const onlyPlayer = pokemon(152, 20)
    const fainted = pokemon(155, 15)
    fainted.currentHp = 0
    const session = createFieldDoubleWildBattleSession({
      playerParty: [onlyPlayer, fainted], opponent: pokemon(158, 10), catalog,
      itemCatalog: { items: [] } as never, bagInventory: new Map(), rng: createHgssLcrng(1),
      playerTeamPolicy: basePokemonTeamPolicy, initialWeather: 'clear', initialTerrainId: 0,
    })

    expect(session.teams.player).toHaveLength(1)
    expect(session.teams.player[0]!.activePartyIndex).toBe(0)
    expect(session.teams.opponent).toHaveLength(1)
  })

  it('termine immédiatement lorsque le joueur est plus rapide', () => {
    const catalog = createPokemonTestCatalog()
    const session = createFieldDoubleWildBattleSession({
      playerParty: [pokemon(152, 30), pokemon(155, 20)], opponent: pokemon(158, 10), catalog,
      itemCatalog: { items: [] } as never, bagInventory: new Map(), rng: createHgssLcrng(1),
      playerTeamPolicy: basePokemonTeamPolicy, initialWeather: 'clear', initialTerrainId: 0,
    })
    expect(tryRunFromDoubleWildBattle(session, { side: 'player', slot: 0 }, createHgssLcrng(2))).toBe('escaped')
    expect(session).toMatchObject({ phase: 'ended', result: 'escaped' })
  })

  it('reste jouable après une fuite ratée et autorise un objet de fuite terminal', () => {
    const catalog = createPokemonTestCatalog()
    const bagInventory = new Map([[23, 1]])
    const session = createFieldDoubleWildBattleSession({
      playerParty: [pokemon(152, 10), pokemon(155, 9)], opponent: pokemon(158, 30), catalog,
      itemCatalog: { items: [] } as never, bagInventory, rng: createHgssLcrng(1),
      playerTeamPolicy: basePokemonTeamPolicy, initialWeather: 'clear', initialTerrainId: 0,
    })
    session.teams.player[0]!.volatile.cannotSwitch = true

    expect(tryRunFromDoubleWildBattle(session, { side: 'player', slot: 0 }, createHgssLcrng(3))).toBe('failed')
    expect(session.phase).toBe('command')
    expect(session.result).toBeUndefined()
    escapeDoubleWildBattleWithItem(session, bagInventory, { itemId: 23, name: 'Poké Poupée' })
    expect(session).toMatchObject({ phase: 'ended', result: 'escaped' })
    expect(bagInventory.has(23)).toBe(false)
  })

  it('capture une seule instance puis la restitue avec l’équipe à la sortie', () => {
    const catalog = createPokemonTestCatalog()
    const bagInventory = new Map([[1, 1]])
    const session = createFieldDoubleWildBattleSession({
      playerParty: [pokemon(152, 20), pokemon(155, 15)], opponent: pokemon(158, 10), catalog,
      itemCatalog: { items: [] } as never, bagInventory, rng: createHgssLcrng(1),
      playerTeamPolicy: basePokemonTeamPolicy, initialWeather: 'clear', initialTerrainId: 0,
    })
    const target = getDoubleBattlePokemon(session, { side: 'opponent', slot: 0 })
    const attempt = attemptFieldWildCapture({ item: { itemId: 1, name: 'Master Ball' },
      player: getDoubleBattlePokemon(session, { side: 'player', slot: 0 }), target,
      party: { members: session.teams.player[0]!.party }, storage: createPokemonStorage(), inventory: bagInventory,
      catalog, rng: createHgssLcrng(4), turnCount: session.turn, alreadyCaught: false, isNight: false,
      terrain: 'normal', teamPolicy: basePokemonTeamPolicy })
    expect(attempt.kind).toBe('caught')
    if (attempt.kind !== 'caught') throw new Error('La Master Ball devrait terminer la capture.')
    session.phase = 'ended'; session.result = 'captured'

    const restored = syncDoubleBattleParties(session).get('player')!
    expect(restored.filter(({ instanceId }) => instanceId === attempt.caught.instanceId)).toHaveLength(1)
    expect(restored).toHaveLength(3)
    expect(session).toMatchObject({ phase: 'ended', result: 'captured' })
  })
})
