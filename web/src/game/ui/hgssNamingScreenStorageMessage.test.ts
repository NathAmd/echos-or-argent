import { describe, expect, it, vi } from 'vitest'
import type { RomAudioRuntime } from '../../audio/romAudioRuntime'
import { createHgssNamingScreenStorageMessageController, type HgssNamingScreenStorageMessageElements } from './hgssNamingScreenStorageMessage'

function createElements(): HgssNamingScreenStorageMessageElements {
  const element = () => ({ hidden: false })
  return {
    root: { ...element(), dataset: {} } as unknown as HTMLElement,
    label: { ...element(), textContent: '' } as unknown as HTMLElement,
    input: element() as unknown as HTMLInputElement,
    count: element() as unknown as HTMLElement,
    submit: element() as unknown as HTMLButtonElement,
    cancel: element() as unknown as HTMLButtonElement,
  }
}

describe('message de stockage du Naming Screen HGSS', () => {
  it('ne confond pas play-sound avec wait-sound', async () => {
    vi.useFakeTimers()
    vi.stubGlobal('window', globalThis)
    try {
      let finishSound!: () => void
      const sound = new Promise<void>((resolve) => { finishSound = resolve })
      const audio = {
        playSoundEffect: vi.fn(() => sound),
      } as unknown as RomAudioRuntime
      const elements = createElements()
      const controller = createHgssNamingScreenStorageMessageController(elements, () => audio)

      const presentation = controller.present('{202 4}RACAILLOU est transfere.', [])
      await Promise.resolve()
      await Promise.resolve()

      expect(elements.label.textContent).toBe('RACAILLOU est transfere.')
      expect(audio.playSoundEffect).toHaveBeenCalledWith(1510)
      expect(controller.isActive()).toBe(true)
      await vi.advanceTimersByTimeAsync(520)
      await presentation
      expect(controller.isActive()).toBe(false)
      finishSound()
    } finally {
      vi.unstubAllGlobals()
      vi.useRealTimers()
    }
  })
})
