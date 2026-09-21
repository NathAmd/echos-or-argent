import { describe, expect, it } from 'vitest'
import { formatFieldItemEffect } from './formatFieldItemEffect'
import type { FieldItemEffect } from './useFieldItem'

function fieldItemEffect(overrides: Partial<FieldItemEffect> = {}): FieldItemEffect {
  return {
    hpRestored: 0,
    statusHealed: false,
    ppRestored: 0,
    ppUpsAdded: 0,
    revived: false,
    levelsGained: 0,
    learnedMoveIds: [],
    skippedMoveIds: [],
    effortValueChange: 0,
    friendshipChange: 0,
    ...overrides,
  }
}

describe('formatFieldItemEffect', () => {
  it('décrit un gain de niveau sans annoncer une évolution absente', () => {
    expect(formatFieldItemEffect(
      'Super Bonbon',
      'Héricendre',
      fieldItemEffect({ levelsGained: 1 }),
    )).toBe('Super Bonbon utilisé sur Héricendre : niveau +1.')
  })

  it("annonce l'évolution sans réutiliser le nom de la forme de départ comme cible", () => {
    expect(formatFieldItemEffect(
      'Super Bonbon',
      'Héricendre',
      fieldItemEffect({ levelsGained: 1, evolvedFromSpeciesId: 155, evolvedToSpeciesId: 156 }),
    )).toBe('Super Bonbon utilisé sur Héricendre : évolution déclenchée, niveau +1.')
  })

  it("ne présente pas davantage un surnom comme le nom de l'espèce évoluée", () => {
    const message = formatFieldItemEffect(
      'Super Bonbon',
      'Flamme',
      fieldItemEffect({ levelsGained: 1, evolvedFromSpeciesId: 155, evolvedToSpeciesId: 156 }),
    )

    expect(message).toBe('Super Bonbon utilisé sur Flamme : évolution déclenchée, niveau +1.')
    expect(message).not.toContain('évolution en Flamme')
  })
})
