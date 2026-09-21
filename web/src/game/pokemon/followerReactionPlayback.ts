import type { HgssFollowerReaction, HgssFollowerReactionStep } from '../../rom/overworld/followerReactions'

export type HgssFollowerReactionPlayback = {
  playMotion: (step: HgssFollowerReactionStep, stepIndex: number) => Promise<void>
  playEmote?: (emoteId: number, stepIndex: number) => Promise<void>
  showMessage: (messageId: number, stepIndex: number) => Promise<void>
  waitFrames: (frames: number, stepIndex: number) => Promise<void>
}

/** Reproduit l'ordre de l'automate FollowMonInteract de l'overlay HGSS. */
export async function playHgssFollowerReaction(
  reaction: HgssFollowerReaction,
  playback: HgssFollowerReactionPlayback,
): Promise<void> {
  for (let stepIndex = 0; stepIndex < reaction.steps.length; stepIndex += 1) {
    const step = reaction.steps[stepIndex]!
    if (step.movementId !== 0) await playback.playMotion(step, stepIndex)
    if (step.emoteId !== 0 && playback.playEmote) await playback.playEmote(step.emoteId, stepIndex)
    if (step.messageId !== 0) await playback.showMessage(step.messageId, stepIndex)
    if (step.delay !== 0) await playback.waitFrames(step.delay, stepIndex)
  }
}
