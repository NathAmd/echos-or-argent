import { describe, expect, it } from 'vitest'
import { createFieldScriptState } from '../scripts/fieldScriptRunner'
import {
  createHgssSharedCampaignProgressionSeed,
  hgssSharedCampaignProgressionRevisionCounter,
} from '../multiplayer/hgssSharedCampaignProgression'
import {
  compareHgssSharedCampaignSaveProgression,
  createHgssSharedCampaignSaveExtension,
  hgssSharedCampaignSaveExtensionKey,
  parseHgssSharedCampaignSaveExtensionV1,
  readHgssSharedCampaignSaveExtension,
  replaceHgssSharedCampaignSaveExtension,
} from './hgssSharedCampaignSaveExtension'
import { parseHgssDataOnlyExtensions } from './hgssDataOnlyExtensions'
import { createHgssSharedCampaignFieldEventId } from '../multiplayer/hgssSharedCampaignEventIdentity'

const branchId = '0123456789abcdef0123456789abcdef'
const receiptId = createHgssSharedCampaignFieldEventId({
  rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
  mapId: 1,
  source: { kind: 'object', objectId: 2 },
  scriptId: 3,
})
const absentReceiptId = createHgssSharedCampaignFieldEventId({
  rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
  mapId: 1,
  source: { kind: 'object', objectId: 2 },
  scriptId: 4,
})

function progression(revision = 0, flags: readonly number[] = []) {
  const state = createFieldScriptState('male', 'JO')
  state.flags = new Set(flags)
  return createHgssSharedCampaignProgressionSeed(state, branchId, revision)
}

function extension(revision = 0, flags: readonly number[] = []) {
  return createHgssSharedCampaignSaveExtension(
    progression(revision, flags),
    'session:test',
    [],
    'player:local',
  )
}

describe('extension de sauvegarde de campagne partagée HGSS', () => {
  it('canonise la progression et les acquittements destinés au joueur local', () => {
    const applied = progression(2, [0x20])
    const withReceipt = {
      ...applied,
      milestoneIds: [...applied.milestoneIds, receiptId],
    }
    const saved = createHgssSharedCampaignSaveExtension(
      withReceipt,
      'session:test',
      [{
        eventId: receiptId,
        eventRevision: 8,
        pendingPlayerIds: ['player:remote', 'player:local'],
      }],
      'player:local',
    )

    expect(saved).toMatchObject({
      campaignBranchId: branchId,
      appliedProgressionRevision: 2,
      pendingAcks: [{
        authoritySessionId: 'session:test',
        eventId: receiptId,
        eventRevision: 8,
      }],
    })
    expect(saved.appliedProgression.milestoneIds).toEqual(
      [...withReceipt.milestoneIds].sort(),
    )
  })

  it('préserve les autres extensions lors du remplacement', () => {
    const merged = replaceHgssSharedCampaignSaveExtension({
      'new-game-plus.test': { version: 1, value: { enabled: true } },
    }, extension())

    expect(Object.keys(merged ?? {})).toEqual([
      hgssSharedCampaignSaveExtensionKey,
      'new-game-plus.test',
    ])
    expect(readHgssSharedCampaignSaveExtension(merged)?.campaignBranchId).toBe(branchId)
    const campaignOnly = replaceHgssSharedCampaignSaveExtension(undefined, extension())
    expect(parseHgssDataOnlyExtensions(campaignOnly)).toEqual(campaignOnly)
  })

  it('refuse branche/révision incohérentes, reçu absent et formes hostiles', () => {
    const valid = extension()
    expect(() => parseHgssSharedCampaignSaveExtensionV1({
      ...valid,
      campaignBranchId: 'f'.repeat(32),
    })).toThrow(/incohérente/)
    expect(() => parseHgssSharedCampaignSaveExtensionV1({
      ...valid,
      appliedProgressionRevision: 3,
    })).toThrow(/incohérente/)
    expect(() => parseHgssSharedCampaignSaveExtensionV1({
      ...valid,
      pendingAcks: [{ authoritySessionId: 'session:test', eventId: absentReceiptId, eventRevision: 1 }],
    })).toThrow(/sans reçu/)
    expect(() => parseHgssSharedCampaignSaveExtensionV1({
      ...valid,
      pendingAcks: [{ authoritySessionId: 'session:test', eventId: 'field.schema.v1', eventRevision: 1 }],
    })).toThrow(/invalide/)
    expect(() => parseHgssSharedCampaignSaveExtensionV1(Object.assign(Object.create({}), valid)))
      .toThrow(/invalide/)
  })

  it('ordonne une même branche par révision sans accepter une perte causale', () => {
    const first = extension(0)
    const secondProgression = progression(1, [0x10])
    const second = createHgssSharedCampaignSaveExtension(secondProgression, 'session:next', [], 'player:local')
    expect(compareHgssSharedCampaignSaveProgression(second, first)).toBe('left-ahead')
    expect(compareHgssSharedCampaignSaveProgression(first, second)).toBe('right-ahead')

    const regressed = {
      ...second,
      appliedProgressionRevision: 2,
      appliedProgression: {
        ...first.appliedProgression,
        counters: first.appliedProgression.counters.map((entry) => entry.id === hgssSharedCampaignProgressionRevisionCounter
          ? { ...entry, value: 2 }
          : entry),
      },
    }
    expect(compareHgssSharedCampaignSaveProgression(
      parseHgssSharedCampaignSaveExtensionV1(regressed),
      second,
    )).toBe('divergent')
  })

  it('refuse de fusionner implicitement deux branches', () => {
    const other = parseHgssSharedCampaignSaveExtensionV1({
      ...extension(),
      campaignBranchId: 'f'.repeat(32),
      appliedProgression: {
        ...progression(),
        milestoneIds: progression().milestoneIds.map((id) => id.startsWith('field.branch.')
          ? `field.branch.${'f'.repeat(32)}`
          : id),
      },
    })
    expect(compareHgssSharedCampaignSaveProgression(extension(), other)).toBe('different-branch')
  })
})
