import { describe, expect, it, vi } from 'vitest'
import { createBrowserSessionAutosave } from './browserSessionAutosave'

class TimerWindow {
  callback?: () => void
  readonly clearTimeout = vi.fn(() => { this.callback = undefined })
  readonly setTimeout = vi.fn((callback: () => void) => {
    this.callback = callback
    return 7
  })
  fire(): void {
    const callback = this.callback
    this.callback = undefined
    callback?.()
  }
}

describe('autosauvegarde navigateur de session', () => {
  it('coalesce le timer, respecte le verrou de jeu et peut être annulée', () => {
    const window = new TimerWindow()
    const persist = vi.fn()
    let active = false
    const autosave = createBrowserSessionAutosave(
      window as unknown as Window,
      () => active,
      persist,
    )

    autosave.schedule()
    expect(window.setTimeout).not.toHaveBeenCalled()
    active = true
    autosave.schedule(10)
    autosave.schedule(20)
    expect(window.clearTimeout).toHaveBeenCalledWith(7)
    window.fire()
    expect(persist).toHaveBeenCalledOnce()

    autosave.schedule()
    autosave.cancel()
    window.fire()
    expect(persist).toHaveBeenCalledOnce()
  })
})
