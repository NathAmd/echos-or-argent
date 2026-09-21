import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createCanonicalPokemon } from '../pokemon/canonicalPokemon'
import { createHgssLcrng } from '../pokemon/hgssPokemonRng'
import { calculateHgssBallShakes, isHgssBallItem } from './hgssCapture'

function mon(speciesId: number, level = 5) {
  const catalog = createPokemonTestCatalog()
  return createCanonicalPokemon(catalog, {
    speciesId, level, rng: createHgssLcrng(speciesId), personality: { kind: 'fixed', value: speciesId }, individualValues: { kind: 'fixed', value: 0 },
    originalTrainer: { id: 1, name: 'J', gender: 'male' }, origin: { language: 3, gameVersion: 7, metLocation: 0, metLevel: level, metTerrain: 0 }, ballId: 4, moveIds: [33],
  })
}

describe('capture HGSS', () => {
  it('reconnaît uniquement les identifiants de Balls HGSS', () => {
    expect(isHgssBallItem(4)).toBe(true)
    expect(isHgssBallItem(492)).toBe(true)
    expect(isHgssBallItem(17)).toBe(false)
  })

  it('garantit les quatre secousses de la Master Ball', () => {
    const catalog = createPokemonTestCatalog()
    const result = calculateHgssBallShakes({ itemId: 1, player: mon(152), target: mon(155), catalog, turnCount: 0 }, createHgssLcrng(0))
    expect(result).toMatchObject({ caught: true, shakes: 4 })
  })

  it('applique le bonus de statut avant les tests de secousse', () => {
    const catalog = createPokemonTestCatalog()
    const target = mon(155)
    target.currentHp = 1
    const normal = calculateHgssBallShakes({ itemId: 4, player: mon(152), target, catalog, turnCount: 0 }, createHgssLcrng(1))
    target.status = 0x20
    const frozen = calculateHgssBallShakes({ itemId: 4, player: mon(152), target, catalog, turnCount: 0 }, createHgssLcrng(1))
    expect(frozen.modifiedCatchRate).toBe(normal.modifiedCatchRate * 2)
  })
})
