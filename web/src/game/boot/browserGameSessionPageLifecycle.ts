import type { BrowserSessionPageCheckpoint } from '../save/browserSessionPageCheckpoint'
import {
  installBrowserTitleSavePageLifecycle,
  type BrowserTitleSavePageLifecycle,
} from '../menu/browserTitleSavePageLifecycle'

type VisibilityDocument = Pick<Document, 'visibilityState' | 'addEventListener' | 'removeEventListener'>

/** Composition navigateur du gel visuel, du checkpoint et du bail de sauvegarde. */
export function installBrowserGameSessionPageLifecycle(options: Readonly<{
  window: Window
  document: VisibilityDocument
  checkpoint: BrowserSessionPageCheckpoint
  animations: Readonly<{ pause: (now: number) => void, resume: (now: number) => void }>
  clock: Readonly<{ pause: () => void, resume: () => void, resynchronize: (now: number) => void }>
  resetInput: () => void
  isGameActive: () => boolean
  focus: () => void
  releaseAuthorization: () => void
  restoreTitle: () => void
  hasPendingCloud: () => boolean
  retryPendingCloud: () => Promise<void>
  now?: () => number
}>): BrowserTitleSavePageLifecycle {
  const now = options.now ?? (() => performance.now())
  const lifecycle = installBrowserTitleSavePageLifecycle({
    window: options.window,
    beforeRelease: () => {
      options.animations.pause(now())
      options.clock.pause()
      return options.checkpoint.release()
    },
    releaseAuthorization: options.releaseAuthorization,
    restoreTitle: options.restoreTitle,
    hasPendingCloud: options.hasPendingCloud,
    retryPendingCloud: options.retryPendingCloud,
  })
  const onVisibilityChange = (): void => {
    if (options.document.visibilityState === 'hidden') {
      options.animations.pause(now())
      options.clock.pause()
      options.resetInput()
      void options.checkpoint.checkpointVisibility()
      return
    }
    lifecycle.retryPendingCloud()
    const resumedAt = now()
    options.clock.resynchronize(resumedAt)
    options.animations.resume(resumedAt)
    if (options.isGameActive()) options.clock.resume()
    options.focus()
  }
  options.document.addEventListener('visibilitychange', onVisibilityChange)
  return Object.freeze({
    retryPendingCloud: lifecycle.retryPendingCloud,
    destroy() {
      options.document.removeEventListener('visibilitychange', onVisibilityChange)
      lifecycle.destroy()
    },
  })
}
