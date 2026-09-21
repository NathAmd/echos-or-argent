import { hgssVBlanksToMilliseconds } from '../time/hgssFrameTiming'

export const HGSS_SWEET_SCENT_SOUND_EFFECT_ID = 1607 as const

export type HgssSweetScentFieldEffect = {
  present: () => Promise<void>
  dismiss: (successful: boolean) => Promise<void>
  close: () => void
}

const waitFrames = (frames: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, hgssVBlanksToMilliseconds(frames)))

/** Reproduit les deux fondus de masque blanc du Task natif, sans image ajoutée. */
export function createHgssSweetScentFieldEffect(
  overlay: HTMLElement,
  playSoundEffect: (sequenceId: number) => void,
): HgssSweetScentFieldEffect {
  let animation: Animation | undefined
  const close = (): void => {
    animation?.cancel()
    animation = undefined
    overlay.style.backgroundColor = '#fff'
    overlay.style.opacity = '0'
  }
  return {
    async present() {
      close()
      playSoundEffect(HGSS_SWEET_SCENT_SOUND_EFFECT_ID)
      animation = overlay.animate([{ opacity: 0 }, { opacity: 0.625 }], { duration: hgssVBlanksToMilliseconds(19), easing: 'linear', fill: 'forwards' })
      await animation.finished
      await waitFrames(22)
    },
    async dismiss(successful) {
      animation?.cancel()
      animation = undefined
      if (successful) { close(); return }
      animation = overlay.animate([{ opacity: 0.625 }, { opacity: 0 }], { duration: hgssVBlanksToMilliseconds(15), easing: 'linear', fill: 'forwards' })
      await animation.finished
      close()
    },
    close,
  }
}
