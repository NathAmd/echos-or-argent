export type HgssCampaignRevisionDecision =
  | Readonly<{ kind: 'apply', revision: number, bootstrap: boolean }>
  | Readonly<{ kind: 'ignore', revision: number, reason: 'duplicate' | 'stale' }>
  | Readonly<{ kind: 'gap', revision: number, expectedRevision: number }>

function assertRevision(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`${label} doit être une révision entière positive ou nulle.`)
}

/**
 * Arbitre pur pour une projection locale. Le premier snapshot établit le point
 * de départ ; ensuite une seule révision peut être appliquée à la fois.
 */
export function arbitrateHgssCampaignSnapshotRevision(
  currentRevision: number | undefined,
  incomingRevision: number,
): HgssCampaignRevisionDecision {
  assertRevision(incomingRevision, 'La révision reçue')
  if (currentRevision === undefined) return { kind: 'apply', revision: incomingRevision, bootstrap: true }
  assertRevision(currentRevision, 'La révision courante')
  if (incomingRevision === currentRevision) return { kind: 'ignore', revision: incomingRevision, reason: 'duplicate' }
  if (incomingRevision < currentRevision) return { kind: 'ignore', revision: incomingRevision, reason: 'stale' }
  if (incomingRevision === currentRevision + 1) return { kind: 'apply', revision: incomingRevision, bootstrap: false }
  return { kind: 'gap', revision: incomingRevision, expectedRevision: currentRevision + 1 }
}
