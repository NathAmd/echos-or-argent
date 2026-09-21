import { describe, expect, it } from 'vitest'
import { createPokemonTestCatalog } from '../pokemon/pokemonTestCatalog'
import { createBattleExperienceDisplay } from './battleExperienceDisplay'

describe("affichage de l'experience en combat", () => {
  it("affiche l'EXP acquise dans le niveau et non l'EXP totale", () => {
    const catalog = createPokemonTestCatalog()
    const display = createBattleExperienceDisplay({ speciesId: 152, level: 5, experience: 140 }, catalog)

    expect(display).toMatchObject({
      total: 140,
      levelStart: 125,
      levelEnd: 216,
      progress: 15,
      required: 91,
      remaining: 76,
    })
  })

  it("borne une sauvegarde incoherente au segment du niveau affiche", () => {
    const catalog = createPokemonTestCatalog()
    expect(createBattleExperienceDisplay({ speciesId: 152, level: 5, experience: 999 }, catalog).progress).toBe(91)
    expect(createBattleExperienceDisplay({ speciesId: 152, level: 5, experience: 1 }, catalog).progress).toBe(0)
  })

  it('garde une jauge vide et stable au niveau 100', () => {
    const catalog = createPokemonTestCatalog()
    expect(createBattleExperienceDisplay({ speciesId: 152, level: 100, experience: 1_000_000 }, catalog)).toMatchObject({
      progress: 0,
      required: 1,
      remaining: 0,
      levelCap: true,
    })
  })
})
