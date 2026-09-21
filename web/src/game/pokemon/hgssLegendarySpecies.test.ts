import { describe, expect, it } from 'vitest'
import {
  hgssLegendaryAndMythicalSpeciesIds,
  isHgssLegendaryOrMythicalSpecies,
} from './hgssLegendarySpecies'

describe('espèces légendaires et fabuleuses HGSS', () => {
  it('expose une liste nationale unique et un prédicat partagé', () => {
    expect(hgssLegendaryAndMythicalSpeciesIds).toHaveLength(35)
    expect(new Set(hgssLegendaryAndMythicalSpeciesIds).size).toBe(35)
    expect(isHgssLegendaryOrMythicalSpecies(144)).toBe(true)
    expect(isHgssLegendaryOrMythicalSpecies(493)).toBe(true)
    expect(isHgssLegendaryOrMythicalSpecies(143)).toBe(false)
  })
})
