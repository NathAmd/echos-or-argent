export type RomAudioMusicBus = {
  /** Route toute BGM, y compris une piste creee pendant une fanfare. */
  route: (context: AudioContext) => AudioNode
  setMuted: (muted: boolean) => void
  isMuted: () => boolean
  disconnect: () => void
}

/** Bus BGM global, separe des gains propres a chaque sequence ROM. */
export function createRomAudioMusicBus(): RomAudioMusicBus {
  let bus: GainNode | undefined
  let muted = false

  const disconnect = (): void => {
    bus?.disconnect()
    bus = undefined
  }

  return {
    route(context) {
      if (!bus || bus.context !== context) {
        disconnect()
        bus = context.createGain()
        bus.gain.value = muted ? 0 : 1
        bus.connect(context.destination)
      }
      return bus
    },
    setMuted(nextMuted) {
      muted = nextMuted
      if (!bus) return
      bus.gain.cancelScheduledValues(bus.context.currentTime)
      bus.gain.setValueAtTime(muted ? 0 : 1, bus.context.currentTime)
    },
    isMuted: () => muted,
    disconnect,
  }
}
