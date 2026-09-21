export type OptionalFieldScriptStepHooks = {
  isCurrent: () => boolean
  reportFailure: (error: unknown) => void
  resume: () => void
}

/**
 * Attend une presentation facultative (audio ou animation) sans lui donner le
 * droit d'annuler le script ROM. Une promesse devenue obsolete ne touche pas
 * le nouveau script ; une presentation en echec libere en revanche l'attente
 * courante afin que les opcodes de progression continuent de s'executer.
 */
export async function settleOptionalFieldScriptStep(
  task: Promise<unknown>,
  hooks: OptionalFieldScriptStepHooks,
): Promise<'resumed' | 'stale'> {
  let failure: unknown
  try {
    await task
  } catch (error) {
    failure = error
  }
  if (!hooks.isCurrent()) return 'stale'
  try {
    if (failure !== undefined) hooks.reportFailure(failure)
  } finally {
    hooks.resume()
  }
  return 'resumed'
}
