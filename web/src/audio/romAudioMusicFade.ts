import { hgssVBlanksToSeconds } from '../game/time/hgssFrameTiming'

export type RomAudioMusicFadePlayback = {
  output: GainNode
  nominalVolume: number
}

export type RomAudioMusicFadeController = {
  fade: (
    playback: RomAudioMusicFadePlayback,
    targetVolume: number,
    frames: number,
    isCurrent: () => boolean,
  ) => Promise<void>
  cancel: () => void
}

/** Arbitre les fondus d'une BGM sans laisser un ancien timer gagner ensuite. */
export function createRomAudioMusicFadeController(): RomAudioMusicFadeController {
  let revision = 0
  return {
    async fade(playback, targetVolume, frames, isCurrent) {
      if (!Number.isFinite(targetVolume)) throw new Error(`Le volume BGM ROM ${targetVolume} est invalide.`)
      if (!Number.isFinite(frames) || frames < 0) throw new Error(`La duree de fondu BGM ROM ${frames} est invalide.`)
      const request = ++revision
      const duration = hgssVBlanksToSeconds(frames)
      const context = playback.output.context
      const targetGain = playback.nominalVolume * Math.max(0, Math.min(127, targetVolume)) / 127
      playback.output.gain.cancelScheduledValues(context.currentTime)
      playback.output.gain.setValueAtTime(playback.output.gain.value, context.currentTime)
      playback.output.gain.linearRampToValueAtTime(targetGain, context.currentTime + duration)
      await new Promise<void>((resolve) => globalThis.setTimeout(resolve, duration * 1000))
      if (request !== revision || !isCurrent()) return
      // AudioContext.currentTime peut rester fige lorsque l'onglet est masque.
      // Verrouiller la valeur finale empeche le script visuel de devancer le son.
      playback.output.gain.cancelScheduledValues(context.currentTime)
      playback.output.gain.setValueAtTime(targetGain, context.currentTime)
    },
    cancel(): void {
      revision += 1
    },
  }
}
