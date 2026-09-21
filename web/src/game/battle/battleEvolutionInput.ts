export type BattleEvolutionInputPhase = 'intro' | 'transforming' | 'complete' | 'cancelled'

export type BattleEvolutionInputAction = 'confirm' | 'cancel'

export type BattleEvolutionInputDecision = 'ignore' | 'cancel' | 'close'

/**
 * Resolves player input without advancing the evolution animation itself.
 * Intro and transformation remain timer-owned so repeated confirmation input
 * cannot skip animation frames or apply the evolution more than once.
 */
export function resolveBattleEvolutionInput(
  phase: BattleEvolutionInputPhase,
  action: BattleEvolutionInputAction,
  cancellable: boolean,
): BattleEvolutionInputDecision {
  if (phase === 'complete' || phase === 'cancelled') return 'close'
  if (action === 'cancel' && cancellable) return 'cancel'
  return 'ignore'
}
