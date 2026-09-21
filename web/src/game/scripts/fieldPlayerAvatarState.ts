const playerStateByTransitionFlag = new Map<number, number>([
  [1 << 0, 0], [1 << 1, 1], [1 << 2, 2], [1 << 3, 4], [1 << 4, 5],
  [1 << 5, 7], [1 << 6, 8], [1 << 7, 9], [1 << 8, 10], [1 << 9, 11],
  [1 << 10, 3], [1 << 11, 12], [1 << 12, 6], [1 << 13, 13], [1 << 14, 14],
])

/** Reproduit le choix du bit de poids fort de PlayerAvatar_SetTransitionFlags. */
export function applyPlayerAvatarTransition(
  state: { playerState: number },
  transitionFlags: number,
): void {
  const transition = [...playerStateByTransitionFlag.keys()]
    .filter((flag) => (transitionFlags & flag) !== 0)
    .at(-1)
  if (transition !== undefined) state.playerState = playerStateByTransitionFlag.get(transition)!
}
