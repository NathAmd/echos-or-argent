type ApplicationPageLifecycleWindow = Pick<Window, 'addEventListener' | 'removeEventListener'>

export type BrowserApplicationPageLifecycle = Readonly<{ destroy: () => void }>

/** Exécute tout le nettoyage terminal, même si un propriétaire échoue. */
export async function cleanupBrowserApplication(options: Readonly<{
  destroyNetwork?: () => Promise<void>
  dispose: readonly (() => void)[]
}>): Promise<void> {
  try { await options.destroyNetwork?.() } catch { /* Le document est déjà terminal. */ }
  for (const dispose of options.dispose) {
    try { dispose() } catch { /* Les autres propriétaires doivent quand même être libérés. */ }
  }
}

/**
 * Réserve le nettoyage destructif à la destruction réelle du document. Un
 * passage en bfcache doit conserver tous les runtimes nécessaires à sa reprise.
 */
export function installTerminalPageCleanup(
  window: ApplicationPageLifecycleWindow,
  cleanup: () => void,
): BrowserApplicationPageLifecycle {
  let cleaned = false
  const onPageHide = (event: PageTransitionEvent): void => {
    if (event.persisted || cleaned) return
    cleaned = true
    cleanup()
  }
  window.addEventListener('pagehide', onPageHide)
  return Object.freeze({
    destroy() {
      window.removeEventListener('pagehide', onPageHide)
    },
  })
}
