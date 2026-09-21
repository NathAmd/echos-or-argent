import type { BrowserTitleSaveCampaignInvalidationEvent } from './browserTitleSaveAccess'

export type BrowserAccountCampaignInvalidationOptions = Readonly<{
  /** Sauvegarde synchrone : la façade Storage est encore ouverte pendant cet appel. */
  checkpointCampaign: () => boolean
  /** Coupe immédiatement toute admission de jeu, y compris si le checkpoint échoue. */
  blockCampaign: () => void
  /** Rend le sas visible avec une notice déjà bornée et sans identité. */
  returnToAccountGate: (notice: string) => void
  /** Ferme ensuite les transports ; plusieurs invalidations simultanées partagent ce travail. */
  teardownNetwork: () => void | Promise<void>
  reportError?: (message: string) => void
}>

export type BrowserAccountCampaignInvalidation = Readonly<{
  prepareCampaignInvalidation: () => boolean
  onCampaignInvalidated: (event: BrowserTitleSaveCampaignInvalidationEvent) => void
}>

function invalidationNotice(event: BrowserTitleSaveCampaignInvalidationEvent): string {
  return event.checkpointSaved
    ? 'Session interrompue · progression sauvegardée.'
    : 'Session interrompue · sauvegarde non confirmée.'
}

/**
 * Adapte la barrière synchrone de BrowserTitleSaveAccess aux propriétaires du
 * runtime. Le réseau est volontairement fermé après le blocage et le retour au
 * sas : une latence ou une erreur distante ne peut donc jamais prolonger la partie.
 */
export function createBrowserAccountCampaignInvalidation(
  options: BrowserAccountCampaignInvalidationOptions,
): BrowserAccountCampaignInvalidation {
  let activeNetworkTeardown: Promise<void> | undefined

  const reportError = (message: string): void => {
    try { options.reportError?.(message) }
    catch { /* Le diagnostic ne doit jamais modifier l'état terminal de la campagne. */ }
  }

  const startNetworkTeardown = (): void => {
    if (activeNetworkTeardown) return
    const operation = Promise.resolve().then(() => options.teardownNetwork())
    activeNetworkTeardown = operation
    void operation
      .catch(() => {
        reportError('La fermeture réseau de la campagne a échoué.')
      })
      .finally(() => {
        if (activeNetworkTeardown === operation) activeNetworkTeardown = undefined
      })
  }

  return Object.freeze({
    prepareCampaignInvalidation() {
      let checkpointSaved = false
      try {
        checkpointSaved = options.checkpointCampaign() === true
      } catch {
        reportError('Le checkpoint de campagne n’a pas pu être enregistré.')
      } finally {
        try { options.blockCampaign() }
        catch { reportError('La campagne n’a pas pu être bloquée proprement.') }
      }
      return checkpointSaved
    },
    onCampaignInvalidated(event) {
      try { options.returnToAccountGate(invalidationNotice(event)) }
      catch { reportError('Le retour visible au sas de compte a échoué.') }
      startNetworkTeardown()
    },
  })
}
