export const nativeFollowerScriptMovementIds = [48, 55, 56] as const

export type FollowerScriptMovementId = typeof nativeFollowerScriptMovementIds[number]

/**
 * Opcode 604 (`FollowingPokemonMovement`) changes the movement-behaviour
 * callback of the follower MapObject. It is not a directional movement.
 */
export type FollowerScriptMovement = {
  movementId: FollowerScriptMovementId
  behavior: 'standard-follow' | 'script-follow-55' | 'script-follow-56'
}

const nativeBehaviors: Readonly<Record<FollowerScriptMovementId, FollowerScriptMovement>> = {
  48: { movementId: 48, behavior: 'standard-follow' },
  55: { movementId: 55, behavior: 'script-follow-55' },
  56: { movementId: 56, behavior: 'script-follow-56' },
}

export function resolveFollowerScriptMovement(movement: number): FollowerScriptMovement | undefined {
  if (movement !== 48 && movement !== 55 && movement !== 56) return undefined
  return nativeBehaviors[movement]
}
