export type TitleCampaignResumeResult =
  | Readonly<{ kind: 'completed' }>
  | Readonly<{ kind: 'failed', error: unknown, rollbackError?: unknown }>

/** Keeps menu closing outside the attempt: callers close it only for `completed`. */
export function runTitleCampaignResumeTransaction(options: {
  attempt: () => void
  rollback: () => void
}): TitleCampaignResumeResult {
  try {
    options.attempt()
    return { kind: 'completed' }
  } catch (error) {
    try {
      options.rollback()
      return { kind: 'failed', error }
    } catch (rollbackError) {
      return { kind: 'failed', error, rollbackError }
    }
  }
}
