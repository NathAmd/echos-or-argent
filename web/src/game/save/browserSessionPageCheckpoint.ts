export type BrowserSessionPageCheckpoint = Readonly<{
  isReleasing: () => boolean
  checkpointVisibility: () => Promise<void>
  release: () => Promise<void>
  reset: () => void
}>

/**
 * Sépare le simple gel d'onglet de la fermeture terminale d'une campagne.
 * Une page masquée sauvegarde sans quitter la Coop ; une vraie sortie draine
 * d'abord son autorité partagée, puis publie le dernier checkpoint local/cloud.
 */
export function createBrowserSessionPageCheckpoint(options: Readonly<{
  cancelAutosave: () => void
  /** Étapes strictement séquentielles : une étape ne peut pas fermer le transport de la précédente. */
  prepareForRelease: readonly (() => Promise<void>)[]
  activatePresentedMap: () => void
  /** `false` signifie qu'aucun état de terrain cohérent n'a pu être projeté. */
  persistSession: () => boolean
  flushCloud: () => Promise<void>
  reportError: (error: unknown) => void
}>): BrowserSessionPageCheckpoint {
  let releaseRequested = false
  let releaseOperation: Promise<void> | undefined
  const protect = (operation: Promise<void>): Promise<void> => operation.catch(options.reportError)
  const persist = (): boolean => {
    try {
      return options.persistSession()
    } catch (error) {
      options.reportError(error)
      return false
    }
  }

  return Object.freeze({
    isReleasing: () => releaseRequested,
    checkpointVisibility() {
      if (releaseOperation) return releaseOperation
      if (!persist()) options.reportError(new Error('Checkpoint local en attente.'))
      return protect(options.flushCloud())
    },
    release() {
      if (releaseOperation) return releaseOperation
      releaseRequested = true
      options.cancelAutosave()
      // `pagehide` terminal ne sait pas attendre une promesse : conserver
      // synchroniquement le dernier état autoritaire déjà appliqué avant le
      // premier await, puis le réécrire après le drain Coop.
      const initialPersisted = persist()
      releaseOperation = protect((async () => {
        const errors: unknown[] = []
        for (const prepare of options.prepareForRelease) {
          try { await prepare() } catch (error) { errors.push(error) }
        }
        try { options.activatePresentedMap() } catch (error) { errors.push(error) }
        const finalPersisted = persist()
        try { await options.flushCloud() } catch (error) { errors.push(error) }
        if (!initialPersisted && !finalPersisted) {
          errors.push(new Error('Checkpoint local en attente.'))
        }
        if (errors.length === 1) throw errors[0]
        if (errors.length > 1) throw new AggregateError(errors, 'Sortie de campagne incomplète.')
      })())
      return releaseOperation
    },
    reset() {
      releaseRequested = false
      releaseOperation = undefined
    },
  })
}
