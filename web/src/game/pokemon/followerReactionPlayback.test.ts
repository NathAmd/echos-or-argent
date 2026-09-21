import { describe, expect, it, vi } from 'vitest'
import type { HgssFollowerReaction } from '../../rom/overworld/followerReactions'
import { playHgssFollowerReaction } from './followerReactionPlayback'

function reaction(steps: HgssFollowerReaction['steps']): HgssFollowerReaction {
  return {
    reactionId: 495,
    steps,
    terminated: true,
    effects: { rawPrefix: [], friendshipDelta: 0, moodDelta: 0, fashionItemId: 0, shinyLeafIndex: 0 },
  }
}

describe('HGSS follower reaction playback', () => {
  it('plays every step in native motion, emote, message, delay order', async () => {
    const events: string[] = []
    await playHgssFollowerReaction(reaction([
      { movementId: 3, messageId: 0, soundId: 0, emoteId: 0, delay: 2 },
      { movementId: 13, messageId: 419, soundId: 2380, emoteId: 2, delay: 0 },
    ]), {
      playMotion: async (step, index) => { events.push(`motion:${index}:${step.movementId}:${step.soundId}`) },
      playEmote: async (emoteId, index) => { events.push(`emote:${index}:${emoteId}`) },
      showMessage: async (messageId, index) => { events.push(`message:${index}:${messageId}`) },
      waitFrames: async (frames, index) => { events.push(`delay:${index}:${frames}`) },
    })

    expect(events).toEqual([
      'motion:0:3:0',
      'delay:0:2',
      'motion:1:13:2380',
      'emote:1:2',
      'message:1:419',
    ])
  })

  it('skips native zero fields and waits for asynchronous confirmation', async () => {
    let confirmMessage: (() => void) | undefined
    const finished = vi.fn()
    const playback = playHgssFollowerReaction(reaction([
      { movementId: 0, messageId: 7, soundId: 0, emoteId: 0, delay: 0 },
    ]), {
      playMotion: vi.fn(async () => undefined),
      showMessage: () => new Promise<void>((resolve) => { confirmMessage = resolve }),
      waitFrames: vi.fn(async () => undefined),
    }).then(finished)

    await Promise.resolve()
    expect(finished).not.toHaveBeenCalled()
    expect(confirmMessage).toBeTypeOf('function')
    confirmMessage?.()
    await playback
    expect(finished).toHaveBeenCalledOnce()
  })
})
