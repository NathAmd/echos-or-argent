import { createRomAudioExclusiveChannel, type RomAudioExclusiveChannel } from './romAudioExclusiveChannel'

export type RomAudioPlayerLease<T> = {
  playerId: number
  sequenceId: number
  playback: T
}

type PlayerOwner<T> = {
  sequenceId: number
  lease?: RomAudioPlayerLease<T>
}

type PlayerState<T> = {
  channel: RomAudioExclusiveChannel<T>
  owner?: PlayerOwner<T>
}

export type RomAudioPlayerChannels<T> = {
  play: (playerId: number, sequenceId: number, start: () => Promise<T>) => Promise<RomAudioPlayerLease<T> | undefined>
  stop: (playerId: number, sequenceId: number) => boolean
  finish: (lease: RomAudioPlayerLease<T>) => boolean
  current: (playerId: number) => RomAudioPlayerLease<T> | undefined
  isOccupied: (playerId: number) => boolean
  hasOccupiedPlayer: () => boolean
  stopAll: () => void
}

/**
 * Reproduit l'arbitrage SDAT : un Nitro sequence player ne possede qu'une
 * lecture, meme lorsque plusieurs identifiants de sequence le partagent.
 */
export function createRomAudioPlayerChannels<T>(
  release: (playback: T) => void,
): RomAudioPlayerChannels<T> {
  const states = new Map<number, PlayerState<T>>()
  const stateFor = (playerId: number): PlayerState<T> => {
    let state = states.get(playerId)
    if (!state) {
      state = { channel: createRomAudioExclusiveChannel(release) }
      states.set(playerId, state)
    }
    return state
  }

  return {
    async play(playerId, sequenceId, start) {
      const state = stateFor(playerId)
      const owner: PlayerOwner<T> = { sequenceId }
      state.owner = owner
      try {
        const playback = await state.channel.replace(start)
        if (!playback || state.owner !== owner) return undefined
        const lease = { playerId, sequenceId, playback }
        owner.lease = lease
        return lease
      } catch (error) {
        if (state.owner === owner) state.owner = undefined
        throw error
      }
    },
    stop(playerId, sequenceId) {
      const state = states.get(playerId)
      if (!state?.owner || state.owner.sequenceId !== sequenceId) return false
      state.owner = undefined
      state.channel.stop()
      return true
    },
    finish(lease) {
      const state = states.get(lease.playerId)
      if (state?.owner?.lease !== lease) return false
      if (!state.channel.releaseIfCurrent(lease.playback)) return false
      state.owner = undefined
      return true
    },
    current: (playerId) => states.get(playerId)?.owner?.lease,
    isOccupied: (playerId) => states.get(playerId)?.owner !== undefined,
    hasOccupiedPlayer: () => [...states.values()].some((state) => state.owner !== undefined),
    stopAll() {
      for (const state of states.values()) {
        state.owner = undefined
        state.channel.stop()
      }
    },
  }
}
