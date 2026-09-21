import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import {
  applyHgssRoamerBattleResult,
  createCanonicalHgssRoamerPokemon,
  createHgssRoamer,
  createHgssRoamerSaveState,
  hgssRoamerMapIds,
  selectHgssRoamerEncounter,
  updateHgssRoamersForMapTransition,
} from './hgssRoamers'

describe('HGSS roaming Pokémon', () => {
  it('creates the four native roamers with persistent battle data and regional routes', () => {
    const state = createHgssRoamerSaveState()
    const rng = createHgssLcrng(0x12345678)
    const catalog = createPokemonTestCatalog(493)
    const trainer = { id: 0x89abcdef, name: 'JO', gender: 'male' as const }
    const roamers = [0, 1, 2, 3].map((roamerId) => (
      createHgssRoamer(state, roamerId, catalog, rng, trainer, 3, 7)
    ))

    expect(roamers.map(({ speciesId, level }) => ({ speciesId, level }))).toEqual([
      { speciesId: 243, level: 40 },
      { speciesId: 244, level: 40 },
      { speciesId: 380, level: 35 },
      { speciesId: 381, level: 35 },
    ])
    expect(roamers.every((roamer) => roamer.active && roamer.currentHp > 0 && roamer.status === 0)).toBe(true)
    expect(roamers.slice(0, 2).every((roamer) => roamer.locationIndex < 16)).toBe(true)
    expect(roamers.slice(2).every((roamer) => roamer.locationIndex >= 16 && roamer.locationIndex < 41)).toBe(true)
    expect(roamers.every((roamer) => roamer.metLocation === hgssRoamerMapIds[roamer.locationIndex])).toBe(true)
    expect(roamers[0]?.locationIndex).not.toBe(0)
  })

  it('moves roamers on map transitions and preserves their battle HP and status', () => {
    const state = createHgssRoamerSaveState()
    const catalog = createPokemonTestCatalog(493)
    const trainer = { id: 0x89abcdef, name: 'JO', gender: 'male' as const }
    const rng = createHgssLcrng(0x87654321)
    const created = createHgssRoamer(state, 0, catalog, rng, trainer, 3, 7)
    const initialLocation = created.locationIndex

    updateHgssRoamersForMapTransition(state, 40, rng)
    expect(state.playerLocationHistory).toEqual([40, 0])
    expect(state.roamers[0]?.locationIndex).not.toBe(initialLocation)

    const roamer = state.roamers[0]!
    const encounterRng = { getSeed: () => 0, nextU16: () => 1 }
    expect(selectHgssRoamerEncounter(state, roamer.metLocation, encounterRng)?.roamerId).toBe(0)
    const pokemon = createCanonicalHgssRoamerPokemon(roamer, catalog, encounterRng, trainer, 3, 7)
    expect(pokemon.instanceId).toBe(roamer.instanceId)
    const transformed = createCanonicalHgssRoamerPokemon(roamer, catalog, encounterRng, trainer, 3, 7, { speciesId: 244, level: 41 })
    expect(transformed).toMatchObject({ instanceId: roamer.instanceId, speciesId: 244, level: 41, origin: { metLevel: 41 } })
    expect(roamer).toMatchObject({ speciesId: 243, level: 40 })
    pokemon.currentHp = 12
    pokemon.status = 4
    applyHgssRoamerBattleResult(state, 0, pokemon, 'escaped', roamer.metLocation, rng)
    expect(state.roamers[0]).toMatchObject({ currentHp: 12, status: 4, active: true })

    const second = state.roamers[0]!
    const defeated = createCanonicalHgssRoamerPokemon(second, catalog, encounterRng, trainer, 3, 7)
    expect(defeated.instanceId).toBe(pokemon.instanceId)
    defeated.currentHp = 0
    applyHgssRoamerBattleResult(state, 0, defeated, 'won', second.metLocation, rng)
    expect(state.roamers[0]).toBeUndefined()
  })
})
