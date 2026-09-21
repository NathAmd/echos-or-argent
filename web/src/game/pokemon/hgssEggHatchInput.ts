export type HgssEggHatchInputPhase = 'cracking' | 'hatched' | 'nickname-choice' | 'naming'

export type HgssEggHatchInputDecision = 'ignore' | 'request-nickname'

/** Keeps the cracking animation timer-owned while accepting A/B once hatched. */
export function resolveHgssEggHatchInput(
  phase: HgssEggHatchInputPhase,
  action: string,
): HgssEggHatchInputDecision {
  return phase === 'hatched' && (action === 'confirm' || action === 'cancel')
    ? 'request-nickname'
    : 'ignore'
}
