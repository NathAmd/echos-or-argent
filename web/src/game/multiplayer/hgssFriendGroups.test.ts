import { describe, expect, it } from 'vitest'
import { createHgssMersenneTwister } from '../pokemon/hgssSessionRng'
import { advanceHgssFriendGroupDays, areHgssFriendGroupsEqual, createHgssFriendGroupState, initializePlayerHgssFriendGroup, isHgssFriendGroupActive } from './hgssFriendGroups'

describe('HGSS friend groups', () => {
  it('advances all six daily PRandom values exactly like the ROM', () => {
    const state = createHgssFriendGroupState()
    state[1]!.randomValue = 7
    advanceHgssFriendGroupDays(state, 2)
    const once = (Math.imul(7, 1812433253) + 1) >>> 0
    expect(state[1]!.randomValue).toBe((Math.imul(once, 1812433253) + 1) >>> 0)
    expect(state[0]!.randomValue).toBe((1812433253 + 1) >>> 0)
  })

  it('initializes the owner and joined slots exactly from the local player profile', () => {
    const state = createHgssFriendGroupState()
    state[0]!.groupName = 'JOHTO'
    initializePlayerHgssFriendGroup(state, 'JOSEPHINE', 'female', createHgssMersenneTwister(7))

    expect(state[0]).toMatchObject({ groupName: 'JOHTO', memberName: 'JOSEPHI', memberGender: 'female', language: 2 })
    expect(isHgssFriendGroupActive(state[0])).toBe(true)
    expect(areHgssFriendGroupsEqual(state[1], state[0])).toBe(true)
    expect(state[0]!.randomValue).toBe((Math.imul(state[0]!.groupId, 1812433253) + 1) >>> 0)
  })
})
