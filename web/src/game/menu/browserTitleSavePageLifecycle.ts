type PageLifecycleWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type BrowserTitleSavePageLifecycle = Readonly<{
  retryPendingCloud: () => void
  destroy: () => void
}>

/**
 * Une page placée dans le bfcache rend son bail avant d'être gelée. Une
 * navigation terminale laisse au contraire le document conserver son transport
 * cloud jusqu'à sa destruction native, afin de ne pas annuler son dernier flush.
 */
export function installBrowserTitleSavePageLifecycle(options: Readonly<{
  window: PageLifecycleWindow
  beforeRelease?: () => Promise<void> | void
  releaseAuthorization: () => void
  restoreTitle: () => void
  hasPendingCloud?: () => boolean
  retryPendingCloud?: () => Promise<void>
}>): BrowserTitleSavePageLifecycle {
  let releasedForPageCache = false
  let releasePending = false
  let restorePending = false
  let generation = 0
  let destroyed = false
  let retryOperation: Promise<void> | undefined
  const retryPendingCloud = (): void => {
    if (destroyed || retryOperation || !options.hasPendingCloud?.() || !options.retryPendingCloud) return
    let operation: Promise<void>
    try {
      operation = options.retryPendingCloud()
    } catch {
      return
    }
    const guarded = operation.catch(() => undefined)
    const tracked = guarded.finally(() => {
      if (retryOperation === tracked) retryOperation = undefined
    })
    retryOperation = tracked
  }
  const completePageCacheRelease = (operationGeneration: number): void => {
    if (destroyed || operationGeneration !== generation) return
    releasePending = false
    releasedForPageCache = true
    options.releaseAuthorization()
    if (!restorePending) return
    restorePending = false
    releasedForPageCache = false
    options.restoreTitle()
  }
  const onPageHide = (event: PageTransitionEvent): void => {
    const operationGeneration = ++generation
    let checkpoint: Promise<void> | void
    try {
      checkpoint = options.beforeRelease?.()
    } catch (error) {
      if (event.persisted) completePageCacheRelease(operationGeneration)
      throw error
    }
    if (!event.persisted) {
      if (checkpoint) void checkpoint.catch(() => undefined)
      return
    }
    restorePending = false
    if (!checkpoint) {
      completePageCacheRelease(operationGeneration)
      return
    }
    releasePending = true
    // Ne jamais abort/vider le drain cloud que beforeRelease vient de lancer.
    // Une page restaurée avant son acquittement attendra la même opération.
    void checkpoint.catch(() => undefined).then(() => {
      completePageCacheRelease(operationGeneration)
    })
  }
  const onPageShow = (event: PageTransitionEvent): void => {
    if (!event.persisted) return
    if (releasePending) {
      restorePending = true
      return
    }
    if (!releasedForPageCache) return
    releasedForPageCache = false
    options.restoreTitle()
  }
  const onBeforeUnload = (event: BeforeUnloadEvent): void => {
    if (!options.hasPendingCloud?.()) return
    event.preventDefault()
    event.returnValue = ''
  }
  options.window.addEventListener('pagehide', onPageHide)
  options.window.addEventListener('pageshow', onPageShow)
  options.window.addEventListener('beforeunload', onBeforeUnload)
  options.window.addEventListener('online', retryPendingCloud)
  return Object.freeze({
    retryPendingCloud,
    destroy() {
      destroyed = true
      generation += 1
      options.window.removeEventListener('pagehide', onPageHide)
      options.window.removeEventListener('pageshow', onPageShow)
      options.window.removeEventListener('beforeunload', onBeforeUnload)
      options.window.removeEventListener('online', retryPendingCloud)
    },
  })
}
