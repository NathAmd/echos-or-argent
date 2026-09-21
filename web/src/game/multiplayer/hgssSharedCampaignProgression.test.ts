import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  applyHgssSharedCampaignProgression,
  createHgssSharedCampaignEventIntent,
  createHgssSharedCampaignProgressionSeed,
  HgssSharedCampaignProgressionError,
  hgssSharedCampaignProgressionSchemaMilestone,
  projectHgssSharedCampaignProgression,
} from './hgssSharedCampaignProgression'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'

const campaignBranchId = '0123456789abcdef0123456789abcdef'
const fieldEventId = (scriptId: number) => createHgssSharedCampaignFieldEventId({
  rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
  mapId: 1,
  source: { kind: 'object', objectId: 2 },
  scriptId,
})

function state() {
  const value = createFieldScriptState('male', 'JO')
  value.flags = new Set([0x10, 0x20])
  value.badges = new Set([1])
  value.trainerFlags = new Set([7])
  value.variables = new Map([
    [0x4001, 99],
    [0x4010, 4],
    [0x8002, 88],
  ])
  return value
}

describe('projection de progression de campagne HGSS', () => {
  it('projette un état déterministe sans registres temporaires puis le réapplique', () => {
    const source = state()
    const progression = projectHgssSharedCampaignProgression(source)

    expect(progression).toEqual({
      milestoneIds: [
        hgssSharedCampaignProgressionSchemaMilestone,
        'field.flag.0010',
        'field.flag.0020',
        'field.badge.0001',
        'field.trainer.0007',
      ],
      counters: [{ id: 'field.variable.4010', value: 4 }],
    })

    const divergent = createFieldScriptState('female', 'LI')
    divergent.flags.add(0x99)
    divergent.variables.set(0x4001, 5)
    divergent.variables.set(0x8002, 6)
    const applied = applyHgssSharedCampaignProgression(
      divergent,
      createHgssSharedCampaignProgressionSeed(source, campaignBranchId),
    )
    expect([...applied.flags]).toEqual([0x10, 0x20])
    expect([...applied.badges]).toEqual([1])
    expect([...applied.trainerFlags]).toEqual([7])
    expect([...applied.variables]).toEqual([[0x4001, 5], [0x8002, 6], [0x4010, 4]])
    expect(divergent.flags.has(0x99)).toBe(true)
  })

  it('applique le même agrégat deux fois sans effet supplémentaire', () => {
    const source = state()
    const progression = projectHgssSharedCampaignProgression(source)
    const seed = createHgssSharedCampaignProgressionSeed(source, campaignBranchId)
    const once = applyHgssSharedCampaignProgression(source, seed)
    const twice = applyHgssSharedCampaignProgression(once, seed)
    expect(projectHgssSharedCampaignProgression(twice)).toEqual(progression)
  })

  it('produit un commit CAS pour ajouts, suppression de flag et variable', () => {
    const before = state()
    const authoritative = createHgssSharedCampaignProgressionSeed(before, campaignBranchId)
    const after = state()
    after.flags.delete(0x10)
    after.flags.add(0x30)
    after.variables.set(0x4010, 9)
    after.variables.set(0x4020, 3)

    const eventId = fieldEventId(3)
    expect(createHgssSharedCampaignEventIntent(
      eventId,
      authoritative,
      before,
      after,
    )).toEqual({
      kind: 'shared-event',
      eventId,
      milestoneIds: ['field.flag.0030'],
      counters: [
        { id: 'field.progression-revision', expectedValue: 0, value: 1 },
        { id: 'field.flag.0010', expectedValue: null, value: 0 },
        { id: 'field.variable.4010', expectedValue: 4, value: 9 },
        { id: 'field.variable.4020', expectedValue: null, value: 3 },
      ],
    })
  })

  it('refuse une base locale divergente et toute mutation de récompense personnelle', () => {
    const before = state()
    const authoritative = createHgssSharedCampaignProgressionSeed(before, campaignBranchId)
    const divergent = state()
    divergent.flags.add(0x77)
    expect(() => createHgssSharedCampaignEventIntent(
      fieldEventId(4), authoritative, divergent, divergent,
    )).toThrowError(expect.objectContaining({ code: 'baseline-conflict' }))

    const after = state()
    after.badges.clear()
    expect(() => createHgssSharedCampaignEventIntent(
      fieldEventId(5), authoritative, before, after,
    )).toThrowError(expect.objectContaining({ code: 'unsupported-mutation' }))

    const trainerReward = state()
    trainerReward.trainerFlags.add(8)
    expect(() => createHgssSharedCampaignEventIntent(
      fieldEventId(6), authoritative, before, trainerReward,
    )).toThrowError(expect.objectContaining({ code: 'unsupported-mutation' }))
  })

  it('refuse un schéma absent, un identifiant invalide et un événement déjà reçu', () => {
    const source = state()
    const progression = createHgssSharedCampaignProgressionSeed(source, campaignBranchId)
    expect(() => applyHgssSharedCampaignProgression(source, {
      milestoneIds: [], counters: [],
    })).toThrowError(HgssSharedCampaignProgressionError)
    expect(() => createHgssSharedCampaignEventIntent('event with spaces', progression, source, source))
      .toThrowError(expect.objectContaining({ code: 'invalid-event-id' }))
    const committedEventId = fieldEventId(7)
    expect(() => createHgssSharedCampaignEventIntent(committedEventId, {
      ...progression,
      milestoneIds: [...progression.milestoneIds, committedEventId],
    }, source, source)).toThrowError(expect.objectContaining({ code: 'event-already-committed' }))
  })

  it('refuse les namespaces inconnus, doublons et variables temporaires injectés', () => {
    const source = state()
    const progression = createHgssSharedCampaignProgressionSeed(source, campaignBranchId)
    expect(() => applyHgssSharedCampaignProgression(source, {
      ...progression,
      milestoneIds: [...progression.milestoneIds, 'foreign.milestone'],
    })).toThrowError(expect.objectContaining({ code: 'invalid-progression' }))
    expect(() => applyHgssSharedCampaignProgression(source, {
      ...progression,
      milestoneIds: [...progression.milestoneIds, progression.milestoneIds[0]!],
    })).toThrowError(expect.objectContaining({ code: 'invalid-progression' }))
    expect(() => applyHgssSharedCampaignProgression(source, {
      ...progression,
      counters: [...progression.counters, { id: 'foreign.counter', value: 1 }],
    })).toThrowError(expect.objectContaining({ code: 'invalid-progression' }))
    expect(() => applyHgssSharedCampaignProgression(source, {
      ...progression,
      counters: [...progression.counters, { id: 'field.variable.4001', value: 1 }],
    })).toThrowError(expect.objectContaining({ code: 'invalid-progression' }))
  })

  it('ne crée aucune commande lorsque la tranche partagée est inchangée', () => {
    const before = state()
    expect(createHgssSharedCampaignEventIntent(
      fieldEventId(8), createHgssSharedCampaignProgressionSeed(before, campaignBranchId), before, state(),
    )).toBeUndefined()
  })
})
