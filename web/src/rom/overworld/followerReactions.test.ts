import { describe, expect, it } from 'vitest'
import type { NarcMember, RomFile } from '../../ndsTypes'
import {
  decodeHgssFollowerReaction,
  decodeHgssFollowerReactionCatalog,
  decodeHgssFollowerReactionMotion,
  decodeHgssFollowerReactionRule,
  getHgssFollowerReactionMotionDuration,
  getHgssFollowerRuleOrder,
  hgssFollowerGlobalRuleCount,
  hgssFollowerReactionMovementCount,
  hgssFollowerReactionMovementSize,
  hgssFollowerReactionRuleSize,
  hgssFollowerReactionSize,
  hgssFollowerSectionRuleCount,
  hgssFollowerSpeciesReactionClassTableSize,
  sampleHgssFollowerReactionMotion,
} from './followerReactions'

function createArchive(path: string, members: NarcMember[]): RomFile {
  return {
    id: 0,
    path,
    offset: 0,
    size: members.reduce((size, member) => Math.max(size, member.offset + member.size), 0),
    signature: 'NARC',
    archiveEntries: members.length,
    archiveMembers: members,
  }
}

describe('HGSS follower reactions', () => {
  it('decodes the proven packed rule fields without naming unknown conditions', () => {
    const payload = new Uint8Array(hgssFollowerReactionRuleSize)
    const view = new DataView(payload.buffer)
    view.setUint16(10, (123 << 6) | 5, true)
    payload[17] = 75
    view.setUint16(18, 0x456, true)

    expect(decodeHgssFollowerReactionRule(payload)).toMatchObject({
      conditionBits: 5,
      conditions: {
        nearbyObjectCountClass: 5,
        timeOfDayClass: 0,
        mapIdPlusOne: 0,
        reservedObjectCondition: 0,
      },
      reactionId: 123,
      probability: 75,
      requiredFlag: 0x456,
    })
    expect(() => decodeHgssFollowerReactionRule(payload.subarray(1))).toThrow('19 octets au lieu de 20')
    payload[17] = 101
    expect(() => decodeHgssFollowerReactionRule(payload)).toThrow('101 dépasse 100')
  })

  it('decodes terminated reactions and accepts the native five-step form', () => {
    const terminatedPayload = new Uint8Array(hgssFollowerReactionSize)
    const terminatedView = new DataView(terminatedPayload.buffer)
    terminatedView.setUint16(0, 3, true)
    terminatedView.setUint16(2, 6, true)
    terminatedView.setUint16(4, 0, true)
    terminatedView.setUint16(6, 5, true)
    terminatedView.setUint16(8, 0xffff, true)
    terminatedPayload.set([1, 2, 3, 4], 40)

    expect(decodeHgssFollowerReaction(terminatedPayload, 1)).toMatchObject({
      reactionId: 1,
      steps: [{ movementId: 3, messageId: 6, soundId: 0, emoteId: 5, delay: 0 }],
      terminated: true,
      effects: {
        rawPrefix: [1, 2, 3, 4, 0, 0, 0, 0],
        friendshipDelta: 0,
        moodDelta: 0,
        fashionItemId: 0,
        shinyLeafIndex: 0,
      },
    })

    const fullPayload = new Uint8Array(hgssFollowerReactionSize)
    const fullView = new DataView(fullPayload.buffer)
    for (let index = 0; index < 5; index += 1) fullView.setUint16(index * 8, index + 1, true)
    expect(decodeHgssFollowerReaction(fullPayload, 1018)).toMatchObject({
      reactionId: 1018,
      terminated: false,
    })
    expect(decodeHgssFollowerReaction(fullPayload, 1018).steps).toHaveLength(5)
  })

  it('decodes and samples cumulative reaction motions before restoring the actor', () => {
    const payload = new Uint8Array(hgssFollowerReactionMovementSize).fill(0xff)
    payload.set([0, 0, 2, 0xfd, 4, 1, 0xff, 0xff], 0)
    payload.set([3, 2, 0xff, 5, 0xfe, 0, 0xff, 0xff], 8)
    const motion = decodeHgssFollowerReactionMotion(payload, 8)

    expect(motion).toEqual({
      movementId: 8,
      segments: [
        {
          facingDirection: 0,
          durationFrames: 0,
          offsetX: 2,
          heightAdjustment: -3,
          offsetZ: 4,
          triggerStepSound: true,
          reserved: [0xff, 0xff],
        },
        {
          facingDirection: 3,
          durationFrames: 2,
          offsetX: -1,
          heightAdjustment: 5,
          offsetZ: -2,
          triggerStepSound: false,
          reserved: [0xff, 0xff],
        },
      ],
      terminated: true,
    })
    expect(getHgssFollowerReactionMotionDuration(motion)).toBe(3)
    expect(sampleHgssFollowerReactionMotion(motion, 0)).toMatchObject({
      complete: false,
      segmentIndex: 0,
      frameInSegment: 0,
      offsetX: 2,
      heightAdjustment: -3,
      offsetZ: 4,
      facingDirection: undefined,
      triggerStepSound: true,
    })
    expect(sampleHgssFollowerReactionMotion(motion, 1)).toMatchObject({
      complete: false,
      segmentIndex: 1,
      frameInSegment: 0,
      offsetX: 1,
      heightAdjustment: 2,
      offsetZ: 2,
      facingDirection: 3,
      triggerStepSound: false,
    })
    expect(sampleHgssFollowerReactionMotion(motion, 2)).toMatchObject({ segmentIndex: 1, frameInSegment: 1 })
    expect(sampleHgssFollowerReactionMotion(motion, 3)).toEqual({
      complete: true,
      segmentIndex: 2,
      frameInSegment: 0,
      offsetX: 0,
      heightAdjustment: 0,
      offsetZ: 0,
      facingDirection: undefined,
      triggerStepSound: false,
    })
    expect(() => sampleHgssFollowerReactionMotion(motion, -1)).toThrow('frame follower HGSS -1')

    const fullPayload = new Uint8Array(hgssFollowerReactionMovementSize)
    expect(decodeHgssFollowerReactionMotion(fullPayload, 108)).toMatchObject({ terminated: false })
    expect(decodeHgssFollowerReactionMotion(fullPayload, 108).segments).toHaveLength(10)
  })

  it('builds the complete catalog and preserves the native 12 + 30 + 58 order', () => {
    const ruleMemberSizes = [
      hgssFollowerGlobalRuleCount * hgssFollowerReactionRuleSize,
      hgssFollowerSectionRuleCount * hgssFollowerReactionRuleSize,
    ]
    const ruleMembers = ruleMemberSizes.map((size, index) => ({
      index,
      offset: index === 0 ? 0 : ruleMemberSizes[0]!,
      size,
      signature: '',
    }))
    const reactionBase = ruleMemberSizes.reduce((total, size) => total + size, 0)
    const reactionMembers = Array.from({ length: 1023 }, (_, index) => ({
      index,
      offset: reactionBase + index * hgssFollowerReactionSize,
      size: hgssFollowerReactionSize,
      signature: '',
    }))
    const movementBase = reactionBase + reactionMembers.length * hgssFollowerReactionSize
    const movementMembers = Array.from({ length: hgssFollowerReactionMovementCount }, (_, index) => ({
      index,
      offset: movementBase + index * hgssFollowerReactionMovementSize,
      size: hgssFollowerReactionMovementSize,
      signature: '',
    }))
    const rom = new Uint8Array(movementBase + movementMembers.length * hgssFollowerReactionMovementSize)
    for (const member of reactionMembers) new DataView(rom.buffer).setUint16(member.offset, 0xffff, true)
    for (const member of movementMembers) rom[member.offset] = 0xff
    const catalog = decodeHgssFollowerReactionCatalog(
      rom,
      createArchive('/a/2/2/0', ruleMembers),
      createArchive('/a/2/2/1', reactionMembers),
      createArchive('/a/2/2/2', movementMembers),
      createArchive('/a/2/3/1', [{
        index: 0,
        offset: 0,
        size: hgssFollowerSpeciesReactionClassTableSize,
        signature: '',
      }]),
      { 0: 'interaction' },
      { 0: 'auxiliaire' },
    )

    expect(catalog.globalRules).toHaveLength(70)
    expect(catalog.sectionRules).toHaveLength(1)
    expect(catalog.sectionRules[0]).toHaveLength(30)
    expect(catalog.reactions).toHaveLength(1023)
    expect(catalog.movements).toHaveLength(108)
    expect(catalog.speciesReactionClasses).toHaveLength(493)
    const ordered = getHgssFollowerRuleOrder(catalog, 0)
    expect(ordered).toHaveLength(100)
    expect(ordered.slice(0, 12)).toEqual(catalog.globalRules.slice(0, 12))
    expect(ordered.slice(12, 42)).toEqual(catalog.sectionRules[0])
    expect(ordered.slice(42)).toEqual(catalog.globalRules.slice(12))
    expect(() => getHgssFollowerRuleOrder(catalog, 1)).toThrow('section de carte HGSS 1')
  })
})
