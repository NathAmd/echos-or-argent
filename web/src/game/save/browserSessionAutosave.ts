type AutosaveTimerWindow = Pick<Window, 'setTimeout' | 'clearTimeout'>

export type BrowserSessionAutosave = Readonly<{
  schedule: (delayMs?: number) => void
  cancel: () => void
}>

/** Timer coalescé : le point d'entrée ne possède plus sa durée de vie. */
export function createBrowserSessionAutosave(
  window: AutosaveTimerWindow,
  canSchedule: () => boolean,
  persist: () => void,
  defaultDelayMs = 450,
): BrowserSessionAutosave {
  let timer: number | undefined
  const cancel = (): void => {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
  }
  return Object.freeze({
    schedule(delayMs = defaultDelayMs) {
      if (!canSchedule()) return
      cancel()
      timer = window.setTimeout(() => {
        timer = undefined
        persist()
      }, delayMs)
    },
    cancel,
  })
}
