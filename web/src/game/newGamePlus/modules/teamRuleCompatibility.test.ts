import { describe, expect, it } from 'vitest'
import {
  assertNewGamePlusTeamRuleCompatibility,
  resolveNewGamePlusTeamRuleCompatibility,
  type NewGamePlusTeamRuleSelection,
} from './teamRuleCompatibility'

const selection = (overrides: Partial<NewGamePlusTeamRuleSelection> = {}): NewGamePlusTeamRuleSelection => ({
  soloRun: false,
  allBattlesInDuo: false,
  eeveeTeam: false,
  monotype: false,
  ...overrides,
})

describe('compatibilité des règles d’équipe NG+', () => {
  it.each([
    [selection({ soloRun: true, eeveeTeam: true }), 'solo-run-eevee-team'],
    [selection({ eeveeTeam: true, monotype: true }), 'eevee-team-monotype'],
  ] as const)('refuse chaque paire incompatible %#', (value, code) => {
    expect(resolveNewGamePlusTeamRuleCompatibility(value)).toContainEqual(expect.objectContaining({ code }))
    expect(() => assertNewGamePlusTeamRuleCompatibility(value)).toThrow('incompatible')
  })

  it('retourne toutes les incompatibilités dans un ordre déterministe', () => {
    const issues = resolveNewGamePlusTeamRuleCompatibility(selection({
      soloRun: true,
      allBattlesInDuo: true,
      eeveeTeam: true,
      monotype: true,
    }))
    expect(issues.map(({ code }) => code)).toEqual([
      'solo-run-eevee-team',
      'eevee-team-monotype',
    ])
    expect(Object.isFrozen(issues)).toBe(true)
    expect(JSON.parse(JSON.stringify(issues))).toEqual(issues)
  })

  it('autorise les combinaisons prévues, notamment Solo Run avec Monotype', () => {
    const compatible = [
      selection(),
      selection({ soloRun: true, monotype: true }),
      selection({ soloRun: true, allBattlesInDuo: true }),
      selection({ allBattlesInDuo: true, eeveeTeam: true }),
      selection({ allBattlesInDuo: true, monotype: true }),
    ]
    for (const value of compatible) {
      expect(resolveNewGamePlusTeamRuleCompatibility(value)).toEqual([])
      expect(() => assertNewGamePlusTeamRuleCompatibility(value)).not.toThrow()
    }
  })

  it('rejette une sélection runtime non booléenne ou enrichie', () => {
    expect(() => resolveNewGamePlusTeamRuleCompatibility({
      ...selection(), soloRun: 1,
    } as unknown as NewGamePlusTeamRuleSelection)).toThrow('invalide')
    expect(() => resolveNewGamePlusTeamRuleCompatibility({
      ...selection(), extra: true,
    } as unknown as NewGamePlusTeamRuleSelection)).toThrow('invalide')
  })
})
