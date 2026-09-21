import { describe, expect, it } from 'vitest'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssSessionRng } from '../pokemon/hgssSessionRng'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import {
  materializeCanonicalPokemonFromP2pTrade,
  snapshotCanonicalPokemonForP2pTrade,
} from './hgssP2pTradePokemonAdapter'

function fixture() {
  const catalog = createPokemonTestCatalog()
  const trainer = { id: 0x12345678, name: 'JO', gender: 'male' as const, nameSource: 'user-text' as const }
  const pokemon = createCanonicalPokemon(catalog, {
    speciesId: 155,
    level: 12,
    rng: createHgssSessionRng(77).lc,
    personality: { kind: 'fixed', value: 12345 },
    individualValues: { kind: 'fixed', value: 12 },
    originalTrainer: { ...trainer, isPlayer: true },
    origin: { language: 3, gameVersion: 7, metLocation: 126, metLevel: 5, metTerrain: 12 },
    ballId: 4,
  })
  pokemon.nickname = 'FLAMME'
  pokemon.nicknameSource = 'user-text'
  pokemon.currentHp -= 2
  return { catalog, trainer, pokemon }
}

describe('HGSS P2P trade Pokémon adapter', () => {
  it('round-trips complete functional data while resolving ROM data locally', () => {
    const { catalog, trainer, pokemon } = fixture()
    pokemon.speciesName = 'ROM_CANARY_MUST_NOT_CROSS_THE_WIRE'
    pokemon.moves[0]!.data = { ...pokemon.moves[0]!.data, effect: 2_130_706_518 }

    const snapshot = snapshotCanonicalPokemonForP2pTrade(pokemon, { catalog, trainer })
    const wire = JSON.stringify(snapshot)
    expect(wire).not.toContain('ROM_CANARY')
    expect(wire).not.toContain('2130706518')

    const received = materializeCanonicalPokemonFromP2pTrade(snapshot, {
      catalog,
      trainer: { id: 999, name: 'LEA', gender: 'female', nameSource: 'user-text' },
    })
    expect(received).toMatchObject({
      instanceId: pokemon.instanceId,
      speciesId: pokemon.speciesId,
      speciesName: catalog.speciesNames[pokemon.speciesId],
      nickname: 'FLAMME',
      nicknameSource: 'user-text',
      currentHp: pokemon.currentHp,
      originalTrainer: { id: trainer.id, name: 'JO', isPlayer: false },
    })
    expect(received.moves[0]?.data).toBe(catalog.moves[received.moves[0]!.moveId])
  })

  it('recomputes ownership when a trainer receives back their original Pokémon', () => {
    const { catalog, trainer, pokemon } = fixture()
    const snapshot = snapshotCanonicalPokemonForP2pTrade(pokemon, { catalog, trainer })
    expect(materializeCanonicalPokemonFromP2pTrade(snapshot, { catalog, trainer }).originalTrainer.isPlayer).toBe(true)
  })

  it('rejects manipulated derived stats, PP and ambiguous text provenance', () => {
    const { catalog, trainer, pokemon } = fixture()
    const snapshot = snapshotCanonicalPokemonForP2pTrade(pokemon, { catalog, trainer })
    expect(() => materializeCanonicalPokemonFromP2pTrade({
      ...snapshot, stats: { ...snapshot.stats, attack: snapshot.stats.attack + 1 },
    }, { catalog, trainer })).toThrow('statistiques')
    expect(() => materializeCanonicalPokemonFromP2pTrade({
      ...snapshot,
      moves: snapshot.moves.map((move, index) => index === 0 ? { ...move, maxPp: move.maxPp + 1 } : move),
    }, { catalog, trainer })).toThrow('PP maximum')

    pokemon.nicknameSource = undefined
    expect(() => snapshotCanonicalPokemonForP2pTrade(pokemon, { catalog, trainer })).toThrow('provenance')
  })
})
