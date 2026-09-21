import { describe, expect, it } from 'vitest'
import { nativeFollowerScriptMovementIds, resolveFollowerScriptMovement } from './followerScriptMovement'

describe('native follower script movement', () => {
  it('resolves the three MapObject behaviour callbacks used by HGSS scripts', () => {
    expect(nativeFollowerScriptMovementIds.map(resolveFollowerScriptMovement)).toEqual([
      { movementId: 48, behavior: 'standard-follow' },
      { movementId: 55, behavior: 'script-follow-55' },
      { movementId: 56, behavior: 'script-follow-56' },
    ])
  })

  it('does not reinterpret neighbouring movement behaviours as directions or jumps', () => {
    expect(resolveFollowerScriptMovement(47)).toBeUndefined()
    expect(resolveFollowerScriptMovement(49)).toBeUndefined()
    expect(resolveFollowerScriptMovement(54)).toBeUndefined()
    expect(resolveFollowerScriptMovement(57)).toBeUndefined()
  })
})
