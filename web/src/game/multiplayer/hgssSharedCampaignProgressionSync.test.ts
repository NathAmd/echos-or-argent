import { describe, expect, it, vi } from 'vitest'
import { createFieldScriptState, type FieldScriptState } from '../scripts/fieldScriptRunner'
import type { HgssCampaignClientGateway } from './hgssCampaignClientGateway'
import {
  hgssCampaignProtocolVersion,
  type HgssCampaignServerSnapshot,
} from './hgssCampaignProtocol'
import { createHgssSharedCampaignProgressionSeed } from './hgssSharedCampaignProgression'
import { createHgssSharedCampaignProgressionSync } from './hgssSharedCampaignProgressionSync'
import { createHgssSharedCampaignFieldEventId } from './hgssSharedCampaignEventIdentity'
import {
  createHgssSharedCampaignSaveExtension,
  type HgssSharedCampaignSaveExtensionV1,
} from '../save/hgssSharedCampaignSaveExtension'

const campaignBranchId = '0123456789abcdef0123456789abcdef'
const eventId = createHgssSharedCampaignFieldEventId({
  rom: { gameCode: 'IPKE', gameVersion: 7, language: 2 },
  mapId: 1,
  source: { kind: 'object', objectId: 2 },
  scriptId: 3,
})

function state(flags: readonly number[] = []): FieldScriptState {
  const value = createFieldScriptState('male', 'JO')
  value.flags = new Set(flags)
  return value
}

function snapshot(
  revision: number,
  source: FieldScriptState,
  pendingPlayerIds: readonly string[] = [],
): HgssCampaignServerSnapshot {
  const progression = createHgssSharedCampaignProgressionSeed(
    source,
    campaignBranchId,
    pendingPlayerIds.length > 0 ? 1 : 0,
  )
  return Object.freeze({
    protocolVersion: hgssCampaignProtocolVersion,
    sessionId: 'campaign:test',
    revision,
    players: Object.freeze([Object.freeze({
      playerId: 'player:local',
      displayName: 'JO',
      gender: 'male' as const,
      state: 'active' as const,
      position: Object.freeze({ mapId: 1, x: 2, z: 3, direction: 'south' as const }),
      spriteId: 1,
      movementSequence: 0,
    })]),
    sharedProgression: Object.freeze({
      ...progression,
      milestoneIds: Object.freeze([
        ...progression.milestoneIds,
        ...(pendingPlayerIds.length > 0 ? [eventId] : []),
      ]),
    }),
    pendingEvents: pendingPlayerIds.length > 0
      ? Object.freeze([Object.freeze({
        eventId,
        eventRevision: revision,
        pendingPlayerIds: Object.freeze([...pendingPlayerIds]),
      })])
      : Object.freeze([]),
  })
}

function harness(initial = state()) {
  let current = initial
  let savedCampaign: HgssSharedCampaignSaveExtensionV1 | undefined
  let authoritative = snapshot(0, initial)
  const journal: string[] = []
  const gateway = {
    getState: () => ({ status: 'connected' as const, snapshot: authoritative }),
    send: vi.fn(async (intent: { kind: string, eventId?: string }) => {
      journal.push(`send:${intent.kind}`)
      if (intent.kind === 'event-ack') {
        authoritative = Object.freeze({
          ...authoritative,
          revision: authoritative.revision + 1,
          pendingEvents: Object.freeze([]),
        })
      }
      return Object.freeze({ intent }) as never
    }),
  } as unknown as HgssCampaignClientGateway
  const persistState = vi.fn(async (
    _candidate: FieldScriptState,
    campaign: HgssSharedCampaignSaveExtensionV1,
  ) => {
    journal.push('persist')
    savedCampaign = campaign
  })
  const publishState = vi.fn((candidate: FieldScriptState) => {
    journal.push('publish')
    current = candidate
  })
  const runtime = createHgssSharedCampaignProgressionSync({
    readState: () => current,
    readGateway: () => gateway,
    readSavedCampaign: () => savedCampaign,
    persistState,
    publishState,
  })
  return {
    runtime,
    gateway,
    journal,
    persistState,
    publishState,
    read: () => current,
    setSavedCampaign: (value: HgssSharedCampaignSaveExtensionV1) => { savedCampaign = value },
    setSnapshot: (value: HgssCampaignServerSnapshot) => { authoritative = value },
  }
}

describe('synchronisation durable de progression Coop HGSS', () => {
  it('sauvegarde et publie la projection avant d’acquitter l’événement', async () => {
    const test = harness(state())
    const incoming = snapshot(4, state([0x20]), ['player:local', 'player:remote'])
    test.setSnapshot(incoming)

    await test.runtime.observe(incoming, 'player:local')

    expect([...test.read().flags]).toEqual([0x20])
    expect(test.journal).toEqual(['persist', 'publish', 'send:event-ack'])
    expect(test.gateway.send).toHaveBeenCalledWith({
      kind: 'event-ack', eventId, eventRevision: 4,
    })
  })

  it('n’acquitte rien lorsque la sauvegarde durable échoue', async () => {
    const test = harness(state())
    test.persistState.mockRejectedValueOnce(new Error('disk-full'))
    const incoming = snapshot(2, state([0x30]), ['player:local'])
    test.setSnapshot(incoming)

    await expect(test.runtime.observe(incoming, 'player:local')).rejects.toThrow('disk-full')
    expect(test.publishState).not.toHaveBeenCalled()
    expect(test.gateway.send).not.toHaveBeenCalled()
  })

  it('force un checkpoint avant ACK même si l’effet est déjà en mémoire', async () => {
    const applied = state([0x40])
    const test = harness(applied)
    const incoming = snapshot(3, applied, ['player:local'])
    test.setSnapshot(incoming)

    await test.runtime.observe(incoming, 'player:local')

    expect(test.persistState).toHaveBeenCalledOnce()
    expect(test.publishState).not.toHaveBeenCalled()
    expect(test.gateway.send).toHaveBeenCalledOnce()
  })

  it('ignore une révision ancienne après avoir appliqué une révision récente', async () => {
    const test = harness(state())
    const recent = snapshot(8, state([0x50]))
    await test.runtime.observe(recent, 'player:local')
    await test.runtime.observe(snapshot(7, state([0x60])), 'player:local')

    expect([...test.read().flags]).toEqual([0x50])
    expect(test.persistState).toHaveBeenCalledOnce()
  })

  it('refuse une salle plus ancienne que le checkpoint durable local', async () => {
    const test = harness(state([0x50]))
    const recentProgression = createHgssSharedCampaignProgressionSeed(
      state([0x50]), campaignBranchId, 1,
    )
    test.setSavedCampaign(createHgssSharedCampaignSaveExtension(
      recentProgression, 'campaign:old', [], 'player:local',
    ))

    await expect(test.runtime.observe(snapshot(1, state()), 'player:local'))
      .rejects.toThrow('plus ancienne')
    expect([...test.read().flags]).toEqual([0x50])
    expect(test.persistState).not.toHaveBeenCalled()
    expect(test.publishState).not.toHaveBeenCalled()
  })

  it('refuse de remplacer silencieusement une autre branche locale', async () => {
    const test = harness(state([0x50]))
    const otherProgression = createHgssSharedCampaignProgressionSeed(
      state([0x50]), 'f'.repeat(32), 1,
    )
    test.setSavedCampaign(createHgssSharedCampaignSaveExtension(
      otherProgression, 'campaign:old', [], 'player:local',
    ))

    await expect(test.runtime.observe(snapshot(1, state()), 'player:local'))
      .rejects.toThrow('autre branche')
    expect([...test.read().flags]).toEqual([0x50])
    expect(test.persistState).not.toHaveBeenCalled()
  })

  it('soumet un diff CAS puis applique son snapshot accepté', async () => {
    const before = state()
    const after = state([0x70])
    const test = harness(before)
    const initial = snapshot(1, before)
    test.setSnapshot(initial)
    await test.runtime.observe(initial, 'player:local')
    test.persistState.mockClear()
    vi.spyOn(test.gateway, 'send').mockImplementation(async (intent) => {
      if (intent.kind === 'shared-event') {
        const accepted = snapshot(2, after, ['player:local'])
        test.setSnapshot(accepted)
      } else if (intent.kind === 'event-ack') {
        test.setSnapshot(Object.freeze({ ...snapshot(3, after), pendingEvents: Object.freeze([]) }))
      }
      return Object.freeze({ ...intent, protocolVersion: 2, commandId: 'test', expectedRevision: 1 })
    })

    await expect(test.runtime.commit(eventId, before, after)).resolves.toEqual({
      eventId, revision: 2,
    })
    expect([...test.read().flags]).toEqual([0x70])
    expect(test.persistState).toHaveBeenCalledOnce()
  })

  it('n’acquitte qu’une fois quand la publication gateway enfile le snapshot déjà réconcilié', async () => {
    const before = state()
    const after = state([0x71])
    const test = harness(before)
    const initial = snapshot(1, before)
    test.setSnapshot(initial)
    await test.runtime.observe(initial, 'player:local')
    vi.spyOn(test.gateway, 'send').mockImplementation(async (intent) => {
      if (intent.kind === 'shared-event') {
        const accepted = snapshot(2, after, ['player:local'])
        test.setSnapshot(accepted)
        void test.runtime.observe(accepted, 'player:local')
      } else if (intent.kind === 'event-ack') {
        const current = test.gateway.getState().snapshot!
        test.setSnapshot(Object.freeze({
          ...current,
          revision: current.revision + 1,
          pendingEvents: Object.freeze([]),
        }))
      }
      return Object.freeze({ ...intent }) as never
    })

    await test.runtime.commit(eventId, before, after)
    await test.runtime.flush()

    expect(test.gateway.send).toHaveBeenCalledTimes(2)
    expect(test.gateway.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'shared-event' }))
    expect(test.gateway.send).toHaveBeenCalledWith(expect.objectContaining({ kind: 'event-ack' }))
  })
})
