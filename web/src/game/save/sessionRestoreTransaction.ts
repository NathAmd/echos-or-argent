/** Executes one restore attempt and restores the exact previous owner state on any synchronous failure. */
export function runSessionRestoreTransaction<Snapshot, Result>(options: {
  snapshot: () => Snapshot
  restore: (snapshot: Snapshot) => void
  attempt: () => Result
}): Result {
  const previous = options.snapshot()
  try {
    return options.attempt()
  } catch (error) {
    options.restore(previous)
    throw error
  }
}
