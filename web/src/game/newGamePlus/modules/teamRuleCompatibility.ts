import { NewGamePlusValidationError } from '../newGamePlusTypes'

export type NewGamePlusTeamRuleSelection = Readonly<{
  soloRun: boolean
  allBattlesInDuo: boolean
  eeveeTeam: boolean
  monotype: boolean
}>

export type NewGamePlusTeamRuleCompatibilityIssue = Readonly<{
  code: 'solo-run-eevee-team' | 'eevee-team-monotype'
  reason: string
}>

const compatibilityRules = Object.freeze([
  Object.freeze({
    code: 'solo-run-eevee-team' as const,
    conflicts: (selection: NewGamePlusTeamRuleSelection) => selection.soloRun && selection.eeveeTeam,
    reason: 'Solo Run est incompatible avec Équipe Évoli.',
  }),
  Object.freeze({
    code: 'eevee-team-monotype' as const,
    conflicts: (selection: NewGamePlusTeamRuleSelection) => selection.eeveeTeam && selection.monotype,
    reason: 'Équipe Évoli est incompatible avec Monotype.',
  }),
])

function requireSelection(value: NewGamePlusTeamRuleSelection): NewGamePlusTeamRuleSelection {
  const selection = value as unknown
  const record = !selection || typeof selection !== 'object' || Array.isArray(selection)
    ? undefined
    : selection as Record<string, unknown>
  const keys = record && Object.keys(record).sort()
  const expected = ['allBattlesInDuo', 'eeveeTeam', 'monotype', 'soloRun']
  if (!record || !keys || keys.length !== expected.length
    || keys.some((key, index) => key !== expected[index])
    || expected.some((key) => typeof record[key] !== 'boolean')) {
    throw new NewGamePlusValidationError('La sélection des règles d’équipe New Game+ est invalide.')
  }
  return Object.freeze({
    soloRun: record.soloRun as boolean,
    allBattlesInDuo: record.allBattlesInDuo as boolean,
    eeveeTeam: record.eeveeTeam as boolean,
    monotype: record.monotype as boolean,
  })
}

/** Retourne toutes les incompatibilités, dans un ordre stable et sans mutation. */
export function resolveNewGamePlusTeamRuleCompatibility(
  value: NewGamePlusTeamRuleSelection,
): readonly NewGamePlusTeamRuleCompatibilityIssue[] {
  const selection = requireSelection(value)
  return Object.freeze(compatibilityRules.flatMap((rule) => (
    rule.conflicts(selection) ? [Object.freeze({ code: rule.code, reason: rule.reason })] : []
  )))
}

export function assertNewGamePlusTeamRuleCompatibility(
  selection: NewGamePlusTeamRuleSelection,
): void {
  const issues = resolveNewGamePlusTeamRuleCompatibility(selection)
  if (issues[0]) throw new NewGamePlusValidationError(issues.map(({ reason }) => reason).join(' '))
}
